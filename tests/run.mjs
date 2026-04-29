// Auto-discovers all `test_*.mjs` siblings, imports them, and reports.
// Each test file should `export default async function(t)` where t is a TestContext.

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { TestContext, runSuites } from './assert.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const filterArg = process.argv[2] || '';   // optional: only files matching substring

async function main() {
  const files = fs.readdirSync(__dirname)
    .filter(f => f.startsWith('test_') && f.endsWith('.mjs'))
    .filter(f => !filterArg || f.includes(filterArg))
    .sort();

  if (files.length === 0) {
    console.error('No test files found' + (filterArg ? ` matching "${filterArg}"` : '') + '.');
    process.exit(1);
  }

  console.log(`Running ${files.length} test file(s)…\n`);

  const suites = [];
  for (const f of files) {
    const url = pathToFileURL(path.join(__dirname, f)).href;
    const mod = await import(url);
    const t = new TestContext(f.replace(/\.mjs$/, ''));
    if (typeof mod.default !== 'function') {
      console.error(`! ${f} has no default export — skipping`);
      continue;
    }
    const start = Date.now();
    await mod.default(t);
    const dur = Date.now() - start;
    const passed = t.results.filter(r => r.passed).length;
    const failed = t.results.filter(r => !r.passed).length;
    const flag   = failed === 0 ? '✓' : '✗';
    console.log(` ${flag} ${f}: ${passed} passed, ${failed} failed (${dur}ms, ${t.results.length} assertions)`);
    suites.push(t);
  }

  runSuites(suites);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(2);
});
