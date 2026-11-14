// Transpiles TypeScript modules under web/src/*.ts to clean 1:1 ESM files in internal/app/admin_ui/*.js.
// Usage: bun run web/build.ts

import { readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';

const rootDir = join(import.meta.dir, '..');
const srcDir = join(rootDir, 'web', 'src');
const outDir = join(rootDir, 'internal', 'app', 'admin_ui');

// types.ts only contains compile-time interfaces and emits no runtime JS file.
const SKIP_EMIT = new Set(['types.ts']);

const transpiler = new Bun.Transpiler({
  loader: 'ts',
  target: 'browser',
  minifyWhitespace: false,
});

const tsFiles = readdirSync(srcDir)
  .filter((name) => name.endsWith('.ts'))
  .sort();

// Remove stale non-vendor JS files that are no longer backed by web/src/*.ts
const VENDOR_JS = new Set(['chart.umd.min.js']);
const expectedJS = new Set(
  tsFiles.filter((f) => !SKIP_EMIT.has(f)).map((f) => f.replace(/\.ts$/, '.js')),
);
for (const existing of readdirSync(outDir)) {
  if (!existing.endsWith('.js') || VENDOR_JS.has(existing)) continue;
  if (!expectedJS.has(existing)) {
    rmSync(join(outDir, existing));
    console.log(`removed stale ${existing}`);
  }
}

let emitted = 0;
for (const file of tsFiles) {
  if (SKIP_EMIT.has(file)) continue;
  const srcPath = join(srcDir, file);
  const outName = basename(file, '.ts') + '.js';
  const outPath = join(outDir, outName);

  const raw = readFileSync(srcPath, 'utf8');
  let js = transpiler.transformSync(raw);
  js = js.replace(/(from\s+['"]\.\/[^'"]+?)\.ts(['"])/g, '$1.js$2');
  js = js.replace(/(import\s*\(\s*['"]\.\/[^'"]+?)\.ts(['"]\s*\))/g, '$1.js$2');

  const banner = `// Auto-generated from web/src/${file} via \`bun run web/build.ts\`. Do not edit directly.\n`;
  writeFileSync(outPath, banner + js.trimStart(), 'utf8');
  emitted += 1;
}

console.log(`Transpiled ${emitted} TypeScript modules -> internal/app/admin_ui/*.js`);
