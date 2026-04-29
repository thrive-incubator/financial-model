// Tests for the three pure utility functions that drive the simulation:
//   rampFn(age, matY, mode)        — revenue ramp curves
//   royaltyForVenture(rev, mode)   — royalty calculation (reads thresh/rate from DOM)
//   boxMuller(i)                   — deterministic standard-normal sampler
//
// These functions are mathematically simple — that's exactly why we want
// adversarial tests around their boundaries (age=0, age=matY, exact tier limits,
// rev=threshold, matY=1, age>matY, very large rev, full SEED_RANDOMS span).

import { loadSim } from './harness.mjs';

export default function (t) {
  // -------------------------------------------------------------------------
  // rampFn: anchors at age=0 and age=matY
  // -------------------------------------------------------------------------
  t.describe('rampFn anchors at age=0 (all modes return 0)', () => {
    const sim = loadSim();
    for (const mode of ['linear', 'convex', 'concave', 'scurve']) {
      t.near(sim.rampFn(0, 5, mode), 0, 1e-9, mode + ' age=0');
    }
  });

  t.describe('rampFn anchors at age=matY (all modes return 1)', () => {
    const sim = loadSim();
    for (const mode of ['linear', 'convex', 'concave', 'scurve']) {
      t.near(sim.rampFn(5, 5, mode), 1, 1e-9, mode + ' age=matY');
    }
  });

  // -------------------------------------------------------------------------
  // rampFn: in-range values are bounded [0, 1]
  // -------------------------------------------------------------------------
  t.describe('rampFn returns values in [0,1] for age in [0, matY]', () => {
    const sim = loadSim();
    const matY = 4;
    for (const mode of ['linear', 'convex', 'concave', 'scurve']) {
      for (let a = 0; a <= matY; a += 0.5) {
        const v = sim.rampFn(a, matY, mode);
        t.between(v, 0, 1, `${mode} age=${a}`);
      }
    }
  });

  // -------------------------------------------------------------------------
  // rampFn: monotonic non-decreasing along age
  // -------------------------------------------------------------------------
  t.describe('rampFn is monotonic non-decreasing in age for each mode', () => {
    const sim = loadSim();
    const matY = 5;
    for (const mode of ['linear', 'convex', 'concave', 'scurve']) {
      const samples = [];
      for (let a = 0; a <= matY; a += 0.25) samples.push(sim.rampFn(a, matY, mode));
      t.nondecreasing(samples, mode);
    }
  });

  // -------------------------------------------------------------------------
  // rampFn: clamp behavior for age > matY (should cap at 1, since uses Math.min)
  // -------------------------------------------------------------------------
  t.describe('rampFn caps at 1 for age > matY (Math.min in formula)', () => {
    const sim = loadSim();
    for (const mode of ['linear', 'convex', 'concave', 'scurve']) {
      t.near(sim.rampFn(10, 5, mode), 1, 1e-9, mode + ' age=2*matY');
      t.near(sim.rampFn(1000, 5, mode), 1, 1e-9, mode + ' age=200*matY');
    }
  });

  // -------------------------------------------------------------------------
  // rampFn: shape relations at the midpoint
  // -------------------------------------------------------------------------
  t.describe('rampFn shape: convex < linear < concave at the midpoint', () => {
    const sim = loadSim();
    const matY = 4;
    const mid  = matY / 2;
    const linMid     = sim.rampFn(mid, matY, 'linear');     // 0.5
    const convexMid  = sim.rampFn(mid, matY, 'convex');     // 0.25
    const concaveMid = sim.rampFn(mid, matY, 'concave');    // ~0.707
    const scurveMid  = sim.rampFn(mid, matY, 'scurve');     // ~0.5

    t.near(linMid, 0.5, 1e-9, 'linear midpoint = 0.5');
    t.near(convexMid, 0.25, 1e-9, 'convex midpoint = t^2 = 0.25');
    t.near(concaveMid, Math.sqrt(0.5), 1e-9, 'concave midpoint = sqrt(0.5)');
    t.ok(convexMid < linMid, 'convex below linear at midpoint');
    t.ok(concaveMid > linMid, 'concave above linear at midpoint');
    // Symmetric S-curve normalized to (0,0) and (1,1) crosses linear roughly at midpoint
    t.near(scurveMid, 0.5, 1e-6, 'scurve crosses 0.5 at midpoint');
  });

  // -------------------------------------------------------------------------
  // rampFn: matY=1 edge case
  // -------------------------------------------------------------------------
  t.describe('rampFn matY=1 edge: t = age/1 clamped, anchors hold', () => {
    const sim = loadSim();
    for (const mode of ['linear', 'convex', 'concave', 'scurve']) {
      t.near(sim.rampFn(0, 1, mode), 0, 1e-9, mode + ' (matY=1) age=0');
      t.near(sim.rampFn(1, 1, mode), 1, 1e-9, mode + ' (matY=1) age=1');
      // Anything >=1 clamps to 1
      t.near(sim.rampFn(2, 1, mode), 1, 1e-9, mode + ' (matY=1) age=2 clamps');
    }
  });

  // -------------------------------------------------------------------------
  // rampFn: bad/unknown mode falls through to scurve
  // -------------------------------------------------------------------------
  t.describe('rampFn unknown mode falls through to scurve', () => {
    const sim = loadSim();
    const matY = 4;
    for (const a of [0, 1, 2, 3, 4]) {
      const fallback = sim.rampFn(a, matY, 'totally-not-a-real-mode');
      const scurve   = sim.rampFn(a, matY, 'scurve');
      t.near(fallback, scurve, 1e-12, `bad mode == scurve at age=${a}`);
    }
    // Also: empty string and undefined should hit the same branch
    t.near(sim.rampFn(2, 4, ''),         sim.rampFn(2, 4, 'scurve'), 1e-12, "'' == scurve");
    t.near(sim.rampFn(2, 4, undefined),  sim.rampFn(2, 4, 'scurve'), 1e-12, 'undefined == scurve');
  });

  // -------------------------------------------------------------------------
  // royaltyForVenture: FLAT mode
  // -------------------------------------------------------------------------
  t.describe('royaltyForVenture flat: below/at/above threshold', () => {
    // thresh=500 → tM = 0.5; flatR=5 → 5%
    const sim = loadSim();
    sim.setValue('thresh', '500');
    sim.setValue('flatR',  '5');

    // rev (in $M) <= tM → 0
    t.eq(sim.royaltyForVenture(0,    'flat'), 0, 'rev=0 → 0');
    t.eq(sim.royaltyForVenture(0.25, 'flat'), 0, 'rev<tM → 0');
    // EXACTLY at threshold: code uses `<=`, so still 0
    t.eq(sim.royaltyForVenture(0.5,  'flat'), 0, 'rev=tM (boundary) → 0');
    // Above threshold: (rev - tM) * 5%
    t.near(sim.royaltyForVenture(1, 'flat'),    (1 - 0.5) * 0.05,    1e-12, 'rev=1M');
    t.near(sim.royaltyForVenture(2.5, 'flat'),  (2.5 - 0.5) * 0.05,  1e-12, 'rev=2.5M');
    t.near(sim.royaltyForVenture(20, 'flat'),   (20 - 0.5) * 0.05,   1e-12, 'rev=20M');
  });

  t.describe('royaltyForVenture flat: threshold sweep', () => {
    const sim = loadSim();
    sim.setValue('flatR', '5');
    for (const [threshK, rev, expected] of [
      ['0',    1,   1   * 0.05],          // tM=0
      ['500',  1,   0.5 * 0.05],          // tM=0.5
      ['1000', 1,   0],                   // tM=1, rev<=tM → 0
      ['1000', 2,   1   * 0.05],          // tM=1
    ]) {
      sim.setValue('thresh', threshK);
      t.near(sim.royaltyForVenture(rev, 'flat'), expected, 1e-12,
        `thresh=${threshK} rev=${rev}`);
    }
  });

  // -------------------------------------------------------------------------
  // royaltyForVenture: GRADUATED mode — boundaries at $2M, $10M (in eligible-rev space)
  // With thresh=0 → tM=0, b1=2, b2=10. Use defaults g1r=3, g2r=5, g3r=7.
  // -------------------------------------------------------------------------
  t.describe('royaltyForVenture grad: tier boundaries at thresh=0', () => {
    const sim = loadSim();
    sim.setValue('thresh', '0');
    sim.setValue('g1r', '3');
    sim.setValue('g2r', '5');
    sim.setValue('g3r', '7');

    // Inside tier 1: 0 < eligible <= 2 → eligible * 3%
    t.near(sim.royaltyForVenture(1, 'grad'),  1 * 0.03, 1e-12, '1M → tier1');
    t.near(sim.royaltyForVenture(2, 'grad'),  2 * 0.03, 1e-12, '2M → boundary, tier1');
    // Just into tier 2: 2 + small * 5%
    t.near(sim.royaltyForVenture(3, 'grad'),  2 * 0.03 + 1 * 0.05, 1e-12, '3M');
    t.near(sim.royaltyForVenture(10, 'grad'), 2 * 0.03 + 8 * 0.05, 1e-12, '10M boundary');
    // Into tier 3
    t.near(sim.royaltyForVenture(15, 'grad'), 2 * 0.03 + 8 * 0.05 + 5 * 0.07, 1e-12, '15M');
    t.near(sim.royaltyForVenture(50, 'grad'), 2 * 0.03 + 8 * 0.05 + 40 * 0.07, 1e-12, '50M');
  });

  t.describe('royaltyForVenture grad: at threshold returns 0', () => {
    const sim = loadSim();
    sim.setValue('thresh', '500'); // tM=0.5
    sim.setValue('g1r', '3'); sim.setValue('g2r', '5'); sim.setValue('g3r', '7');
    t.eq(sim.royaltyForVenture(0,   'grad'), 0, 'rev=0');
    t.eq(sim.royaltyForVenture(0.5, 'grad'), 0, 'rev=tM exact');
    // With tM=0.5, b1 = 1.5, b2 = 9.5; rev=2 → eligible=1.5 ≤ b1 → eligible * r1
    t.near(sim.royaltyForVenture(2, 'grad'), 1.5 * 0.03, 1e-12, 'rev=2 still tier1 (tM shifts boundaries)');
  });

  // -------------------------------------------------------------------------
  // royaltyForVenture: CAP mode — function itself does NOT clip to capMax.
  // The cap is applied in calc() via Math.min(roy, capMaxM). We document this.
  // -------------------------------------------------------------------------
  t.describe('royaltyForVenture cap: returns rate × eligible (NO clip in fn itself)', () => {
    // The lifetime cap is enforced in calc(), not in royaltyForVenture.
    // EXPECT: royaltyForVenture('cap', huge_rev) returns a number larger than capMax.
    const sim = loadSim();
    sim.setValue('thresh', '500');
    sim.setValue('capR',   '5');
    sim.setValue('capMax', '3');   // Lifetime cap = $3M (enforced in calc, not here)

    t.eq(sim.royaltyForVenture(0,   'cap'), 0, 'rev=0');
    t.eq(sim.royaltyForVenture(0.5, 'cap'), 0, 'rev=tM');
    t.near(sim.royaltyForVenture(1, 'cap'),  (1 - 0.5) * 0.05, 1e-12, '1M small');
    // Big rev: function returns un-clipped value > capMax (3)
    const bigRoy = sim.royaltyForVenture(1000, 'cap');
    t.near(bigRoy, (1000 - 0.5) * 0.05, 1e-9, 'cap fn does not clip large rev');
    t.ok(bigRoy > 3, 'unclipped roy exceeds capMax — confirms clipping is calc()-side');
  });

  // -------------------------------------------------------------------------
  // royaltyForVenture: edge cases — rev=0 in all modes; very large rev sane
  // -------------------------------------------------------------------------
  t.describe('royaltyForVenture rev=0 returns 0 across all modes', () => {
    const sim = loadSim();
    sim.setValue('thresh', '500');
    sim.setValue('flatR', '5'); sim.setValue('capR', '5');
    sim.setValue('g1r', '3'); sim.setValue('g2r', '5'); sim.setValue('g3r', '7');
    t.eq(sim.royaltyForVenture(0, 'flat'), 0, 'flat 0');
    t.eq(sim.royaltyForVenture(0, 'grad'), 0, 'grad 0');
    t.eq(sim.royaltyForVenture(0, 'cap'),  0, 'cap 0');
  });

  t.describe('royaltyForVenture very large rev: finite, no overflow', () => {
    const sim = loadSim();
    sim.setValue('thresh', '500');
    sim.setValue('flatR', '5'); sim.setValue('capR', '5');
    sim.setValue('g1r', '3'); sim.setValue('g2r', '5'); sim.setValue('g3r', '7');
    for (const mode of ['flat', 'grad', 'cap']) {
      const v = sim.royaltyForVenture(1e9, mode);
      t.ok(Number.isFinite(v), mode + ' finite at 1e9');
      t.ok(v > 0, mode + ' positive at 1e9');
    }
  });

  // Negative rev — defensive: rev <= tM short-circuits to 0
  t.describe('royaltyForVenture negative rev short-circuits to 0', () => {
    const sim = loadSim();
    sim.setValue('thresh', '500');
    t.eq(sim.royaltyForVenture(-1,   'flat'), 0, 'flat negative');
    t.eq(sim.royaltyForVenture(-100, 'grad'), 0, 'grad negative');
    t.eq(sim.royaltyForVenture(-50,  'cap'),  0, 'cap negative');
  });

  // -------------------------------------------------------------------------
  // boxMuller: determinism, finiteness, range plausibility, sign coverage.
  // SEED_RANDOMS is module-init, so calls within the same loadSim() instance
  // are deterministic, and so are calls across instances (same seed table).
  // -------------------------------------------------------------------------
  t.describe('boxMuller: deterministic across calls and instances', () => {
    const sim1 = loadSim();
    const sim2 = loadSim();
    for (const i of [0, 1, 17, 99, 199]) {
      const a = sim1.boxMuller(i);
      const b = sim1.boxMuller(i);
      const c = sim2.boxMuller(i);
      t.near(a, b, 1e-12, 'same instance i=' + i);
      t.near(a, c, 1e-12, 'cross instance i=' + i);
    }
  });

  t.describe('boxMuller: all values finite over i in [0,199]', () => {
    const sim = loadSim();
    const vals = [];
    for (let i = 0; i < 200; i++) vals.push(sim.boxMuller(i));
    t.allFinite(vals, 'no NaN / Infinity');
  });

  t.describe('boxMuller: mean ~0, std in [0.6, 1.5] over n=200', () => {
    const sim = loadSim();
    const vals = [];
    for (let i = 0; i < 200; i++) vals.push(sim.boxMuller(i));
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
    const std = Math.sqrt(variance);
    t.between(mean, -0.3, 0.3, 'mean within ±0.3 (got ' + mean.toFixed(3) + ')');
    t.between(std,   0.6, 1.5, 'std plausible (got '   + std.toFixed(3)  + ')');
  });

  t.describe('boxMuller: at least 25% of values negative and 25% positive', () => {
    const sim = loadSim();
    let neg = 0, pos = 0;
    for (let i = 0; i < 200; i++) {
      const v = sim.boxMuller(i);
      if (v < 0) neg++;
      else if (v > 0) pos++;
    }
    t.ge(neg, 50, '≥25% negative (got ' + neg + ')');
    t.ge(pos, 50, '≥25% positive (got ' + pos + ')');
  });

  // After fix: SEED_RANDOMS sized 2× SAMPLE_SIZE so boxMuller(i) for i in [0,199]
  // produces 200 unique normals (no period-100 collisions).
  t.describe('boxMuller: no period-100 collisions over i in [0,199] (post-fix)', () => {
    const sim = loadSim();
    // The previously-buggy collisions: i and i+100 must now differ.
    t.ok(Math.abs(sim.boxMuller(0)   - sim.boxMuller(100)) > 1e-9, 'boxMuller(0) ≠ boxMuller(100)');
    t.ok(Math.abs(sim.boxMuller(7)   - sim.boxMuller(107)) > 1e-9, 'boxMuller(7) ≠ boxMuller(107)');
    t.ok(Math.abs(sim.boxMuller(99)  - sim.boxMuller(199)) > 1e-9, 'boxMuller(99) ≠ boxMuller(199)');
    // Stronger check: among 200 calls, count unique values. Should be ≥ 195 (allow tiny chance of
    // accidental near-equality from finite seeds, but it must NOT be ≤ 100).
    const set = new Set();
    for (let i = 0; i < 200; i++) set.add(sim.boxMuller(i).toFixed(12));
    t.ge(set.size, 195, 'at least 195 of 200 boxMuller(i) values are unique');
  });
}
