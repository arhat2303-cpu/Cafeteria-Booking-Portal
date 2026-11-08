import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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

// 2. Compile Netlify Serverless Function into self-contained CommonJS bundle (dist/functions/api.cjs)
// Using .cjs avoids ESM dynamic-require errors in Express/Busboy under "type": "module" on AWS Lambda Node 22
const outFnDir = path.join(root, 'dist', 'functions');
fs.mkdirSync(outFnDir, { recursive: true });

const esbuildBin = path.join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild'
);

execFileSync(
  esbuildBin,
  [
    path.join(root, 'netlify/functions/api.ts'),
    '--bundle',
    '--platform=node',
    '--target=node22',
    '--format=cjs',
    '--external:node:*',
    `--outfile=${path.join(outFnDir, 'api.cjs')}`,
  ],
  { stdio: 'inherit' }
);

console.log('[build] Compiled Netlify Serverless Function -> dist/functions/api.cjs');
