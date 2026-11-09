#!/usr/bin/env node
/**
 * End-to-end UI sign-in verification against the deployed serverless artifact.
 *
 * This exercises the REAL React AuthPage + AuthContext + AuthProvider from `src/`,
 * bundled for Node, mounted into a lightweight DOM, driven by simulated user input,
 * and talking over real HTTP to the exact `dist/functions/api.cjs` Netlify Function
 * (with `node:sqlite` blocked, reproducing the AWS Lambda runtime that caused the
 * reported "Request failed with status 502").
 *
 * A pass means: a human clicking "Admin → sign in → submit" gets a signed-in session,
 * not an error toast.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import crypto from 'node:crypto';
import * as esbuild from 'esbuild';

const root = process.cwd();
const port = Number(process.env.PORT || 3210);
const baseUrl = `http://127.0.0.1:${port}`;

// ---------------------------------------------------------------------------
// 1. AWS Lambda simulation: no experimental `node:sqlite`.
// ---------------------------------------------------------------------------
const originalLoad = Module._load;
Module._load = function (request) {
  if (String(request).includes('sqlite')) {
    const err = new Error(`No such built-in module: ${request}`);
    err.code = 'ERR_UNKNOWN_BUILTIN_MODULE';
    throw err;
  }
  return originalLoad.apply(this, arguments);
};

process.env.NETLIFY = 'true';
process.env.DATABASE_PATH = `/tmp/ui-login-${process.pid}.sqlite`;
process.env.PUBLIC_APP_URL = baseUrl;

const fnBundle = path.join(root, 'dist/functions/api.cjs');
const { handler } = originalLoad(fnBundle, null, false);

// ---------------------------------------------------------------------------
// 2. Minimal but faithful DOM (enough for React 18 + this login page)
// ---------------------------------------------------------------------------
class ClassList {
  constructor(el) {
    this.el = el;
  }
  get set() {
    return new Set(String(this.el.className || '').split(/\s+/).filter(Boolean));
  }
  add(...names) {
    const s = this.set;
    names.forEach((n) => s.add(n));
    this.el.className = [...s].join(' ');
  }
  remove(...names) {
    const s = this.set;
    names.forEach((n) => s.delete(n));
    this.el.className = [...s].join(' ');
  }
  contains(n) {
    return this.set.has(n);
  }
  toggle(n, force) {
    const has = this.contains(n);
    const next = force === undefined ? !has : force;
    next ? this.add(n) : this.remove(n);
    return next;
  }
}

class Node {
  constructor() {
    this.childNodes = [];
    this.parentNode = null;
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  insertBefore(child, ref) {
    const idx = this.childNodes.indexOf(ref);
    child.parentNode = this;
    if (idx === -1) this.childNodes.push(child);
    else this.childNodes.splice(idx, 0, child);
    return child;
  }
  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) this.childNodes.splice(idx, 1);
    child.parentNode = null;
    return child;
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] || null;
  }
  get textContent() {
    return this.childNodes.map((c) => c.textContent ?? '').join('');
  }
  set textContent(v) {
    this.childNodes.forEach((c) => (c.parentNode = null));
    this.childNodes = [];
    if (v !== '' && v !== null && v !== undefined) this.appendChild(new TextNode(String(v)));
  }
}

class TextNode extends Node {
  constructor(text) {
    super();
    this.nodeType = 3;
    this.data = text;
    this.nodeValue = text;
  }
  get textContent() {
    return this.data;
  }
  set textContent(v) {
    this.data = String(v);
    this.nodeValue = String(v);
  }
  get nodeName() {
    return '#text';
  }
}

class Element extends Node {
  constructor(tagName) {
    super();
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.attributes = new Map();
    this.style = {};
    this.className = '';
    this.classList = new ClassList(this);
    this._listeners = new Map();
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.namespaceURI = 'http://www.w3.org/1999/xhtml';
  }
  get id() {
    return this.attributes.get('id') || '';
  }
  set id(v) {
    this.attributes.set('id', String(v));
  }
  setAttribute(k, v) {
    this.attributes.set(k, String(v));
    if (k === 'class') this.className = String(v);
    if (k === 'value') this.value = String(v);
    if (k === 'type') this.type = String(v);
    if (k === 'placeholder') this.placeholder = String(v);
    if (k.startsWith('data-')) this[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
  }
  getAttribute(k) {
    return this.attributes.has(k) ? this.attributes.get(k) : null;
  }
  removeAttribute(k) {
    this.attributes.delete(k);
  }
  hasAttribute(k) {
    return this.attributes.has(k);
  }
  addEventListener(type, cb) {
    const list = this._listeners.get(type) || [];
    list.push(cb);
    this._listeners.set(type, list);
  }
  removeEventListener(type, cb) {
    const list = this._listeners.get(type) || [];
    this._listeners.set(
      type,
      list.filter((f) => f !== cb)
    );
  }
  dispatchEvent(evt) {
    evt.target = evt.target || this;
    (this._listeners.get(evt.type) || []).forEach((cb) => cb.call(this, evt));
    // bubble
    let node = this.parentNode;
    while (node) {
      (node._listeners?.get(evt.type) || []).forEach((cb) => cb.call(node, evt));
      node = node.parentNode;
    }
    return true;
  }
  // User-interaction helpers used by the verification script
  click() {
    this.dispatchEvent(new Event('click', { bubbles: true }));
  }
  fill(text) {
    this.value = text;
    // React 18 stores props on the fiber's host node; invoking onChange directly makes the
    // simulated typing deterministic instead of relying on value-tracker heuristics.
    const propsKey =
    Object.keys(this).find((k) => k.startsWith('__reactProps$')) ||
    (this.__fiberHostKey ? this.__fiberHostKey : null);
  if (!propsKey) {
    globalThis.__brsDebugMissingProps = (globalThis.__brsDebugMissingProps || 0) + 1;
  } else if (typeof this[propsKey].onChange !== 'function') {
    globalThis.__brsDebugNoOnChange = (globalThis.__brsDebugNoOnChange || 0) + 1;
  }
    const props = propsKey ? this[propsKey] : null;
    if (props && typeof props.onChange === 'function') {
      props.onChange({
        target: this,
        currentTarget: this,
        preventDefault() {},
        stopPropagation() {},
        persist() {},
      });
      return;
    }
    this.dispatchEvent(new Event('input', { bubbles: true }));
    this.dispatchEvent(new Event('change', { bubbles: true }));
  }
  submit() {
    const form =
      this.tagName === 'FORM'
        ? this
        : (() => {
            let n = this;
            while (n && n.tagName !== 'FORM') n = n.parentNode;
            return n;
          })();
    const evt = new Event('submit', { bubbles: true, cancelable: true });
    form?.dispatchEvent(evt);
  }
  get children() {
    return this.childNodes.filter((c) => c.nodeType === 1);
  }
  querySelectorAll(selector) {
    const out = [];
    const parts = selector.split(',').map((s) => s.trim());
    const match = (el, sel) => {
      if (!el.tagName) return false;
      const m = sel.match(/^([a-zA-Z0-9]*)((?:\[[^\]]+\]|\.[\w-]+|#[\w-]+)*)$/);
      if (!m) return false;
      const [, tag, rest] = m;
      if (tag && el.tagName !== tag.toUpperCase()) return false;
      const tokens = rest.match(/\[[^\]]+\]|\.[\w-]+|#[\w-]+/g) || [];
      for (const t of tokens) {
        if (t.startsWith('[')) {
          const [k, v] = t.slice(1, -1).split('=');
          const val = v?.replace(/^["']|["']$/g, '');
          if (val !== undefined ? el.getAttribute(k) !== val : !el.hasAttribute(k)) return false;
        } else if (t.startsWith('.')) {
          if (!el.classList.contains(t.slice(1))) return false;
        } else if (t.startsWith('#')) {
          if (el.id !== t.slice(1)) return false;
        }
      }
      return true;
    };
    const walk = (node) => {
      for (const child of node.children) {
        if (parts.some((p) => match(child, p))) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  getBoundingClientRect() {
    return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 };
  }
  get ownerDocument() {
    return documentShim;
  }
  contains(node) {
    let n = node;
    while (n) {
      if (n === this) return true;
      n = n.parentNode;
    }
    return false;
  }
  focus() {}
  blur() {}
}

class Event {
  constructor(type, opts = {}) {
    this.type = type;
    this.bubbles = Boolean(opts.bubbles);
    this.cancelable = Boolean(opts.cancelable);
    this.defaultPrevented = false;
    this.target = null;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {}
}

const documentElement = new Element('html');
const head = new Element('head');
const body = new Element('body');
documentElement.appendChild(head);
documentElement.appendChild(body);
const rootEl = new Element('div');
rootEl.id = 'root';
body.appendChild(rootEl);

const documentShim = {
  nodeType: 9,
  documentElement,
  body,
  head,
  createElement: (tag) => new Element(tag),
  createElementNS: (_ns, tag) => new Element(tag),
  createTextNode: (t) => new TextNode(t),
  createDocumentFragment: () => new Element('#fragment'),
  getElementById: (id) => documentElement.querySelector(`#${id}`),
  querySelector: (s) => documentElement.querySelector(s),
  querySelectorAll: (s) => documentElement.querySelectorAll(s),
  addEventListener() {},
  removeEventListener() {},
  visibilityState: 'visible',
  get activeElement() {
    return null;
  },
};
documentShim.defaultView = globalThis;

const storage = new Map();
const sessionStorageShim = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
};

const locationShim = {
  href: `${baseUrl}/`,
  origin: baseUrl,
  protocol: 'http:',
  host: `127.0.0.1:${port}`,
  hostname: '127.0.0.1',
  pathname: '/',
  search: '',
  hash: '',
};

globalThis.document = documentShim;
globalThis.window = globalThis;
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'BRS-SignIn-Verification/1.0', language: 'en-AE' },
    configurable: true,
    writable: true,
  });
} catch {
  // Node already exposes a read-only navigator; it is sufficient for React DOM.
}
globalThis.location = locationShim;
globalThis.history = { replaceState() {}, pushState() {} };
globalThis.sessionStorage = sessionStorageShim;
globalThis.localStorage = sessionStorageShim;
globalThis.HTMLElement = Element;
globalThis.HTMLIFrameElement = class HTMLIFrameElement extends Element {};
globalThis.HTMLInputElement = class HTMLInputElement extends Element {};
globalThis.HTMLButtonElement = class HTMLButtonElement extends Element {};
globalThis.HTMLFormElement = class HTMLFormElement extends Element {};
globalThis.HTMLDivElement = class HTMLDivElement extends Element {};
globalThis.SVGElement = class SVGElement extends Element {};
globalThis.Text = TextNode;
globalThis.Element = Element;
globalThis.Node = Node;
globalThis.Event = Event;
globalThis.CustomEvent = class CustomEvent extends Event {
  constructor(type, opts = {}) {
    super(type, opts);
    this.detail = opts.detail;
  }
};
globalThis.MouseEvent = Event;
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
});
globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.scrollTo = () => {};

// Route every relative API call to the simulated Netlify Function over real HTTP.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const absolute = url.startsWith('http') ? url : `${baseUrl}${url}`;
  return realFetch(absolute, init);
};

// ---------------------------------------------------------------------------
// 3. Serve the real AuthPage on top of the real serverless function
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const rawBody = Buffer.concat(chunks);
    const parsed = new URL(req.url, baseUrl);

    if (!parsed.pathname.startsWith('/api/')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    const event = {
      httpMethod: req.method,
      path: `/.netlify/functions/api${parsed.pathname.slice('/api'.length)}`,
      rawUrl: `${baseUrl}${parsed.pathname}${parsed.search}`,
      rawQuery: parsed.search.replace(/^\?/, ''),
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)])
      ),
      body: rawBody.length ? rawBody.toString('utf8') : null,
      isBase64Encoded: false,
    };

    try {
      const out = await handler(event, { awsRequestId: crypto.randomUUID() });
      const headers = { ...(out.headers || {}) };
      for (const [k, v] of Object.entries(out.multiValueHeaders || {})) {
        headers[k] = Array.isArray(v) && v.length === 1 ? v[0] : v;
      }
      res.writeHead(out.statusCode || 200, headers);
      res.end(out.body ?? '');
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err?.message || err) }));
    }
  });
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));

// Resolve @/ alias the same way vite.config.ts does
const aliasPlugin = {
  name: 'brs-alias',
  setup(build) {
    build.onResolve({ filter: /^@\// }, (args) => {
      const base = path.join(root, 'src', args.path.slice(2));
      for (const candidate of [
        base,
        `${base}.tsx`,
        `${base}.ts`,
        path.join(base, 'index.tsx'),
      ]) {
        if (fs.existsSync(candidate)) return { path: candidate };
      }
      return { path: `${base}.tsx` };
    });
  },
};

const bundlePath = path.join('/tmp', `brs-auth-ui-${process.pid}.cjs`);
const entryPath = path.join(root, `.brs-ui-entry-${process.pid}.tsx`);
fs.writeFileSync(
  entryPath,
  `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';
import { AuthPage } from '@/pages/AuthPage';

export async function mount() {
  const rootEl = globalThis.document.getElementById('root');
  const root = createRoot(rootEl);
  root.render(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(AuthProvider, null, React.createElement(AuthPage))
    )
  );
  return root;
}
`,
  'utf8'
);

try {
  await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    jsx: 'automatic',
    outfile: bundlePath,
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.MODE': '"production"' },
    plugins: [aliasPlugin],
    logLevel: 'error',
  });
} catch (err) {
  console.error('UI bundle failed:', err.message);
  process.exit(1);
}

const ui = originalLoad(bundlePath, null, false);

// ---------------------------------------------------------------------------
// 4. Drive the real UI like a user
// ---------------------------------------------------------------------------
let failures = 0;
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${label}\n      ${err.message}`);
  }
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate, description, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

const textOf = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

function collectText() {
  return textOf(rootEl);
}

const ADMIN_ONE = (process.env.BRS_ADMIN_ONE_PASSWORD || '').trim();
if (!ADMIN_ONE) {
  console.log('  - NOTE: set BRS_ADMIN_ONE_PASSWORD to run the live-credential sign-in check.');
}

console.log('\n=== Real login page → real serverless function (node:sqlite BLOCKED) ===\n');

await ui.mount();

await check('The "Who’s signing in?" portal renders exactly 4 role cards', async () => {
  await waitFor(() => collectText().includes('signing in?'), 'role selection screen');
  const text = collectText();
  for (const role of ['Student', 'Parent', 'Chef', 'Admin']) {
    assert(text.includes(role), `missing ${role} card`);
  }
  assert(!/teacher/i.test(text), 'a Teacher role is still present');
  const cards = rootEl.querySelectorAll('button');
  assert(cards.length >= 4, `expected role buttons, found ${cards.length}`);
});

let adminCardClicked = false;
await check('Clicking the Admin card opens the Admin sign-in form', async () => {
  const card = rootEl
    .querySelectorAll('button')
    .find((b) => textOf(b).includes('Admin') && /SIGN IN/i.test(textOf(b)));
  assert(card, 'Admin role card not found');
  card.click();
  adminCardClicked = true;
  await waitFor(() => collectText().includes('Admin Sign In'), 'admin sign-in form');
});

if (ADMIN_ONE) await check('Submitting valid Admin credentials signs in (no "Request failed" error)', async () => {
  assert(adminCardClicked, 'prerequisite: Admin card must be open');
  const inputs = rootEl.querySelectorAll('input');
  const userInput = inputs.find((i) => i.getAttribute('type') === 'text');
  const passInput = inputs.find((i) => i.getAttribute('type') === 'password');
  assert(userInput, 'username input not found');
  assert(passInput, 'password input not found');

  userInput.fill('ARHATSHAH8149');
  await wait(60); // let React flush the controlled-input state, just like a human pausing
  passInput.fill(ADMIN_ONE);
  await wait(60);

  const bodyTextBefore = collectText();
  const submitBtn = rootEl
    .querySelectorAll('button')
    .find((b) => /SIGN IN AS ADMIN/i.test(textOf(b)));
  assert(submitBtn, 'Admin submit button not found');
  submitBtn.submit();

  await waitFor(
    () => /Welcome|Signed in|Console|Dashboard|Overview/i.test(collectText()),
    'successful sign-in feedback'
  );

  const after = collectText();
  assert(!/Request failed with status/i.test(after), `user still sees: "${after.slice(0, 200)}"`);
  assert(!/Sign-in failed/i.test(after), `user still sees a sign-in failure toast: "${after.slice(0, 200)}"`);

  const base = bodyTextBefore.replace(/Request failed with status \d+/g, '');
  assert(after !== base, 'UI did not change after submitting the form');
});

await check('A bad password shows a clear message, never a bare 502', async () => {
  const inputs = rootEl.querySelectorAll('input');
  const userInput = inputs.find((i) => i.getAttribute('type') === 'text');
  const passInput = inputs.find((i) => i.getAttribute('type') === 'password');
  userInput.fill('ARHATSHAH8149');
  await wait(60);
  passInput.fill('wrong-password-123');
  await wait(60);
  const submitBtn = rootEl
    .querySelectorAll('button')
    .find((b) => /SIGN IN AS ADMIN/i.test(textOf(b)));
  submitBtn.submit();
  await waitFor(() => /incorrect|invalid/i.test(collectText()), 'invalid-credential message');
  assert(!/Request failed with status 5\d\d/.test(collectText()), 'a 5xx gateway error surfaced');
});

server.close();
for (const f of [bundlePath, entryPath, process.env.DATABASE_PATH]) {
  try {
    fs.unlinkSync(f);
  } catch {
    /* ignore */
  }
}

if (failures > 0) {
  console.error(`\n✗ ${failures} login UI check(s) failed.\n`);
  process.exit(1);
}
console.log('\n✓ The real login page signs in successfully through the serverless function.\n');
process.exit(0);
