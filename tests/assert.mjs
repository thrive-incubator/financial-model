// Tiny assertion library: each `t.<assertion>` records pass/fail; the runner
// aggregates and prints. Tests should not throw — failed assertions are
// recorded and the test continues so we surface as many issues as possible.

export class TestContext {
  constructor(suiteName) {
    this.suite = suiteName;
    this.results = [];   // { name, passed, msg }
    this.currentName = null;
  }
  describe(name, fn) {
    this.currentName = `${this.suite} › ${name}`;
    try {
      fn(this);
    } catch (e) {
      this.results.push({ name: this.currentName, passed: false, msg: 'threw: ' + (e.stack || e) });
    }
    this.currentName = null;
  }
  _record(passed, msg) {
    if (!this.currentName) {
      this.results.push({ name: `${this.suite} › (anonymous)`, passed, msg });
    } else {
      this.results.push({ name: this.currentName, passed, msg });
    }
  }
  ok(cond, msg = '') {
    this._record(!!cond, cond ? '' : (msg || 'expected truthy'));
  }
  eq(actual, expected, msg = '') {
    const ok = Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected);
    this._record(ok, ok ? '' : `${msg ? msg + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  near(actual, expected, eps = 1e-6, msg = '') {
    const ok = Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= eps;
    this._record(ok, ok ? '' : `${msg ? msg + ': ' : ''}expected ≈ ${expected} (±${eps}), got ${actual}`);
  }
  ge(actual, lower, msg = '') {
    const ok = Number.isFinite(actual) && actual >= lower;
    this._record(ok, ok ? '' : `${msg ? msg + ': ' : ''}expected ≥ ${lower}, got ${actual}`);
  }
  le(actual, upper, msg = '') {
    const ok = Number.isFinite(actual) && actual <= upper;
    this._record(ok, ok ? '' : `${msg ? msg + ': ' : ''}expected ≤ ${upper}, got ${actual}`);
  }
  between(actual, lo, hi, msg = '') {
    const ok = Number.isFinite(actual) && actual >= lo && actual <= hi;
    this._record(ok, ok ? '' : `${msg ? msg + ': ' : ''}expected in [${lo},${hi}], got ${actual}`);
  }
  // Strictly nondecreasing array
  nondecreasing(arr, msg = '') {
    let ok = true, where = -1;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] < arr[i - 1] - 1e-9) { ok = false; where = i; break; }
    }
    this._record(ok, ok ? '' : `${msg ? msg + ': ' : ''}drop at index ${where}: ${arr[where - 1]} → ${arr[where]} (full: ${JSON.stringify(arr)})`);
  }
  allFinite(arr, msg = '') {
    const idx = arr.findIndex(v => !Number.isFinite(v));
    const ok = idx < 0;
    this._record(ok, ok ? '' : `${msg ? msg + ': ' : ''}non-finite at index ${idx}: ${arr[idx]}`);
  }
  matches(str, re, msg = '') {
    const ok = re.test(str);
    this._record(ok, ok ? '' : `${msg ? msg + ': ' : ''}/${re}/ did not match in ${JSON.stringify(str).slice(0,200)}`);
  }
  notMatches(str, re, msg = '') {
    const ok = !re.test(str);
    this._record(ok, ok ? '' : `${msg ? msg + ': ' : ''}/${re}/ unexpectedly matched in ${JSON.stringify(str).slice(0,200)}`);
  }
}

export function runSuites(suites) {
  let total = 0, failed = 0;
  const failures = [];
  for (const suite of suites) {
    for (const r of suite.results) {
      total++;
      if (!r.passed) {
        failed++;
        failures.push(r);
      }
    }
  }
  console.log('');
  console.log('===================================================');
  console.log(` Results: ${total - failed}/${total} passed, ${failed} failed`);
  console.log('===================================================');
  if (failed > 0) {
    console.log('');
    console.log('--- Failures ---');
    for (const f of failures) {
      console.log(`\n FAIL: ${f.name}\n   ${f.msg}`);
    }
    process.exitCode = 1;
  } else {
    console.log(' ALL GREEN ✓');
  }
}
