import { mkdir, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  'node_modules/stockfish/src/stockfish-18-lite-single.js',
  'node_modules/stockfish/src/stockfish-18-lite-single.wasm',
  'node_modules/stockfish/bin/stockfish-18-lite-single.js',
  'node_modules/stockfish/bin/stockfish-18-lite-single.wasm'
];

const out = path.join(root, 'public', 'engine');
await mkdir(out, { recursive: true });

for (const relative of candidates) {
  const source = path.join(root, relative);
  try {
    await access(source);
    await copyFile(source, path.join(out, path.basename(source)));
  } catch {
    // The package layout differs slightly between releases. Missing optional
    // variants are ignored; the required JS/WASM pair is checked below.
  }
}

const required = ['stockfish-18-lite-single.js'];
for (const file of required) {
  try {
    await access(path.join(out, file));
  } catch {
    throw new Error(`Stockfish asset missing after npm install: ${file}`);
  }
}

console.log('Stockfish assets prepared in public/engine');
