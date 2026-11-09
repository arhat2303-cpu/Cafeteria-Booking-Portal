import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const root = process.cwd();

// 1. Copy Demo_Video into dist/client/Demo_Video so Netlify CDN serves the exhibition video cleanly
const srcVideoDir = path.join(root, 'Demo_Video');
const destVideoDir = path.join(root, 'dist', 'client', 'Demo_Video');

if (fs.existsSync(srcVideoDir)) {
  fs.mkdirSync(destVideoDir, { recursive: true });
  for (const entry of fs.readdirSync(srcVideoDir)) {
    const srcFile = path.join(srcVideoDir, entry);
    const destFile = path.join(destVideoDir, entry);
    if (fs.statSync(srcFile).isFile()) {
      fs.copyFileSync(srcFile, destFile);
    }
  }
  console.log('[build] Copied Demo_Video into dist/client/Demo_Video');
}

// 2. Compile Netlify Serverless Function into a self-contained Node 18/20/22 CommonJS bundle
// with a dedicated CommonJS package.json so neither ESM dynamic-require errors nor
// `node:sqlite` runtime crashes can ever occur on AWS Lambda / Netlify Functions.
const outFnDir = path.join(root, 'dist', 'functions');
fs.rmSync(outFnDir, { recursive: true, force: true });
fs.mkdirSync(outFnDir, { recursive: true });

const stripNodePrefixPlugin = {
  name: 'strip-node-prefix',
  setup(build) {
    build.onResolve({ filter: /^node:/ }, (args) => ({
      path: args.path.slice(5),
      external: true,
    }));
  },
};

await esbuild.build({
  entryPoints: [path.join(root, 'netlify/functions/api.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  plugins: [stripNodePrefixPlugin],
  outfile: path.join(outFnDir, 'api.cjs'),
  logLevel: 'warning',
});

fs.writeFileSync(
  path.join(outFnDir, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
  'utf8'
);

console.log('[build] Compiled zero-native Netlify Function -> dist/functions/api.cjs');
