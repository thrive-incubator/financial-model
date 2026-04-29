// Tests for Hybrid (term sheet) mode invariants.
//
// Hybrid mode tracks per-cohort cumulative cash (cohortCumPaid) and status
// (active/redeemed/expired). The cap rises tier-by-tier with age:
//   age ≤ 3 → hybCap1 × perVentureInv
//   age 4–5 → hybCap2 × perVentureInv
//   age ≥ 6 → hybCap3 × perVentureInv
// where perVentureInv = invY / spY.
//
// Each year payment = revenue × (margin × marginRamp + hybFCpct) × hybRatePct,
// clipped to remaining cap room (capTarget − cumPaid). Permanent redemption only
// triggers at the FINAL cap = max(hybCap1, hybCap2, hybCap3) × perVentureInv —
// this was a recently-fixed bug (previously it triggered at the per-tier cap).
//
// Equity at exit splits: redeemed cohorts pay the residual tail % of equity,
// active or expired cohorts retain the upfront %.

import { loadSim } from './harness.mjs';

// Common config that we reuse across tests. Each test starts a fresh sim and
// overrides only what it cares about, so we set every important Hybrid input
// up front to remove dependence on HTML defaults / preset state.
function applyHybridDefaults(sim, overrides = {}) {
  sim.setModelMode('hybrid');
  sim.setAndCalc({
    // portfolio
    spY: 2, yrs: 10, surv: 100, inv: 1,
    medR: 4, sig: 0, matY: 5,
    growthR: 0,
    // exits
    liq: 0, exitV: 30, exitMinY: 3, exitMaxY: 9,
    revMult: 3,
    // hybrid
    hybUpfront: 30, hybTail: 10,
    hybFC: 7.5, hybRate: 22, hybGrace: 21,
    hybCap1: 1.5, hybCap2: 1.5, hybCap3: 1.5,
    hybExpY: 8,
    // shared services off-influence
    ssMode: 'fixed', ssCost: 100, ssMarkup: 20, ssSubtract: 'no',
    // shape / equity defaults
    rampMode: 'linear',
    antiD: 'none', dil: 60, eqO: 5,
    // also tame divMargin (drives Founder Earnings) for predictability
    divMargin: 40, divPayout: 60, divOwn: 25,
    ...overrides,
  });
}

export default function (t) {
  // -------------------------------------------------------------------------
  // 1) Cap-not-exceeded invariant (aggregate)
  //    survivors = round(spY*yrs*survR) = round(2*10*1.00) = 20.
  //    perVentureInv = invY/spY = 1/2 = 0.5.
  //    Caps all 1.5x → final cap = 0.75M/venture → max possible 20*0.75 = $15.0M.
  // -------------------------------------------------------------------------
  t.describe('cap-not-exceeded: cumRoyalties[9] ≤ survivors × max_cap × perVentureInv', () => {
    const sim = loadSim();
    applyHybridDefaults(sim, {
      hybCap1: 1.5, hybCap2: 1.5, hybCap3: 1.5,
      // Force lots of payment so we approach the cap if we can.
      hybRate: 40, hybFC: 20, hybGrace: 0, hybExpY: 12,
      medR: 10, matY: 2,
    });
    const s = sim.snap();
    t.le(s.cumRoyalties[9], 15.0 + 1e-6, 'cumRoy[9] never exceeds aggregate cap of $15.0M');
    t.ge(s.cumRoyalties[9], 0, 'cumRoy[9] non-negative');
    t.allFinite(s.cumRoyalties, 'cumRoyalties all finite');
    t.allFinite(s.annualRoyalties, 'annualRoyalties all finite');
    t.nondecreasing(s.cumRoyalties, 'cumRoyalties is monotonic non-decreasing');
    // Every annual payment in isolation should also be ≤ aggregate cap (looser bound)
    for (let i = 0; i < s.annualRoyalties.length; i++) {
      t.le(s.annualRoyalties[i], 15.0 + 1e-6, `annual[${i}] within aggregate cap`);
    }
  });

  // -------------------------------------------------------------------------
  // 2) Grace period (huge) blocks early payments
  //    With hybGrace=120 (= 10 years), no cohort can satisfy age*12 > 120 within
  //    the 10-yr horizon, so cumRoyalties should be all zero.
  // -------------------------------------------------------------------------
  t.describe('grace=120mo blocks all payments inside 10yr horizon', () => {
    const sim = loadSim();
    applyHybridDefaults(sim, { hybGrace: 120, hybExpY: 12, matY: 5 });
    const s = sim.snap();
    t.eq(s.cumRoyalties[9], 0, 'cumRoy[9] = 0');
    for (let i = 0; i < 10; i++) {
      t.eq(s.annualRoyalties[i], 0, `annual[${i}] = 0`);
      t.eq(s.cumRoyalties[i], 0, `cum[${i}] = 0`);
    }
  });

  // -------------------------------------------------------------------------
  // 3) Grace boundary: condition is `age * 12 > hybGraceMo` (strictly greater)
  //    With hybGrace=24: cohort 1 at Y2 has age=2 (24 > 24 is FALSE) → no pay.
  //                      cohort 1 at Y3 has age=3 (36 > 24 is TRUE)  → pay.
  //    Use a non-trivial config so the Y3 payment is clearly > 0.
  // -------------------------------------------------------------------------
  t.describe('grace boundary: age*12 == hybGraceMo does NOT pay; > does', () => {
    const sim = loadSim();
    applyHybridDefaults(sim, {
      hybGrace: 24, matY: 3, medR: 5, hybRate: 30, hybFC: 10,
      // Caps high enough that nothing redeems early; payments are unconstrained.
      hybCap1: 5, hybCap2: 5, hybCap3: 5, hybExpY: 12,
    });
    const s = sim.snap();
    // Y1: cohort 1, age=1 (12 > 24 false) → 0
    t.eq(s.annualRoyalties[0], 0, 'Y1 (age=1) blocked by grace');
    // Y2: cohort 1 age=2 (24 > 24 false) and cohort 2 age=1 → 0
    t.eq(s.annualRoyalties[1], 0, 'Y2 (max age=2) blocked at grace boundary');
    // Y3: cohort 1 age=3 (36 > 24 TRUE) → > 0
    t.ge(s.annualRoyalties[2], 1e-6, 'Y3 (age=3) crosses grace, pays');
    // Strict monotonicity: more cohorts cross grace each year, so payments should grow
    t.ge(s.annualRoyalties[3], s.annualRoyalties[2] - 1e-9, 'Y4 ≥ Y3');
  });

  // -------------------------------------------------------------------------
  // 4) Cap tier progression — the recently-fixed bug. With hybCap1=1, hybCap2=2,
  //    hybCap3=3, a cohort hitting 1× at age ≤ 3 should resume payments at age 4
  //    (cap rises to 2×), then again at age ≥ 6 (cap rises to 3×).
  //    survivors=20, perVentureInv=0.5 → buggy ceiling 20*1*0.5 = $10M; final cap
  //    is 20*3*0.5 = $30M. We expect cumRoy[9] >> $10M.
  // -------------------------------------------------------------------------
  t.describe('cap tier progression: cohort resumes paying when tier rises', () => {
    const sim = loadSim();
    applyHybridDefaults(sim, {
      hybCap1: 1, hybCap2: 2, hybCap3: 3,
      hybRate: 40, hybFC: 20, hybGrace: 0, hybExpY: 10,
      medR: 10, matY: 2,
    });
    const s = sim.snap();
    // Buggy upper bound (if tier did not progress) was 20 × 1 × 0.5 = 10. We must
    // be substantially above that — say > 15 — to demonstrate the fix.
    t.ge(s.cumRoyalties[9], 15, 'cumRoy[9] far exceeds the buggy cap1-only bound');
    t.le(s.cumRoyalties[9], 30 + 1e-6, 'cumRoy[9] still ≤ final cap of 30');
    // The annual stream should *not* be flat-then-zero: we expect multiple
    // step-ups as cohorts age into higher tiers.
    const distinctAnnuals = new Set(s.annualRoyalties.map(v => Math.round(v * 10)));
    t.ge(distinctAnnuals.size, 3, 'multi-tier progression visible in annual stream');
  });

  // -------------------------------------------------------------------------
  // 5) Final-cap-only redemption: with hybCap3 huge, almost nothing redeems within
  //    10 years, so equity stays mostly upfront. With hybCap3 tiny, everyone
  //    redeems and equity drops to tail %. Compare the two — the ratio should
  //    approach upfront/tail = 30/10 = 3.
  // -------------------------------------------------------------------------
  t.describe('final-cap-only redemption: hybCap3 governs equity step-down', () => {
    const simHigh = loadSim();
    applyHybridDefaults(simHigh, {
      hybCap1: 1, hybCap2: 2, hybCap3: 10,    // final cap effectively unreachable
      hybRate: 22, hybFC: 10, hybGrace: 12,
      medR: 5, matY: 3, growthR: 5,
      liq: 30, exitV: 50, exitMinY: 3, exitMaxY: 9,
      hybExpY: 10,
    });
    const sHigh = simHigh.snap();

    const simLow = loadSim();
    applyHybridDefaults(simLow, {
      hybCap1: 1, hybCap2: 1, hybCap3: 1,     // final cap easy to reach
      hybRate: 22, hybFC: 10, hybGrace: 12,
      medR: 5, matY: 3, growthR: 5,
      liq: 30, exitV: 50, exitMinY: 3, exitMaxY: 9,
      hybExpY: 10,
    });
    const sLow = simLow.snap();

    t.ge(sHigh.eqRealized, sLow.eqRealized, 'high cap3 → more upfront equity than low cap3');
    // In the high case redemption is essentially impossible within 10y, so the
    // ratio should be very close to upfront/tail = 30/10 = 3.
    t.between(sHigh.eqRealized / Math.max(sLow.eqRealized, 1e-9), 2.5, 3.5,
              'eq ratio ~= upfront/tail (3:1) when one extreme redeems and the other does not');

    // Sanity: hyp text should report few redemptions for high cap3, many for low.
    const redHigh = /(\d+) \/ \d+ cohorts redeemed/.exec(sHigh.hyp);
    const redLow  = /(\d+) \/ \d+ cohorts redeemed/.exec(sLow.hyp);
    t.ok(redHigh && redLow, 'hyp box reports redemption counts');
    t.ge(parseInt(redLow[1]),  parseInt(redHigh[1]), 'low-cap3 redeems more cohorts');
  });

  // -------------------------------------------------------------------------
  // 6) Option expires after hybExpY: with hybExpY=2 and hybGrace=12 the only
  //    age that can pay is age=2. So after Y2 each year sees exactly one cohort
  //    paying (the one that turns 2 that year), all earlier cohorts expired.
  // -------------------------------------------------------------------------
  t.describe('option expiration: hybExpY=2 (+ grace) confines payments to age=2', () => {
    const sim = loadSim();
    applyHybridDefaults(sim, {
      hybExpY: 2, hybGrace: 12, matY: 3, hybRate: 22, hybFC: 10,
      hybCap1: 5, hybCap2: 5, hybCap3: 5,    // big caps, payment-side limited by age window
    });
    const s = sim.snap();
    t.eq(s.annualRoyalties[0], 0, 'Y1: cohort 1 age=1 blocked by grace');
    t.ge(s.annualRoyalties[1], 1e-6, 'Y2: cohort 1 age=2 pays');
    // From Y2 onward each year exactly one cohort (current age=2) pays the same
    // amount. With sigma=0 and growthR=0 the per-cohort amount is constant.
    for (let y = 2; y <= 9; y++) {
      t.near(s.annualRoyalties[y], s.annualRoyalties[1], 1e-6,
             `annual[${y}] equals annual[1] (steady age-2 payment)`);
    }
  });

  // -------------------------------------------------------------------------
  // 7) Equity stepdown: realized Hybrid equity (lots of redemptions) is
  //    materially lower than the equivalent Royalty-mode equity at the same
  //    upfront ownership %.
  // -------------------------------------------------------------------------
  t.describe('equity stepdown: redeemed cohorts shrink realized equity', () => {
    const simH = loadSim();
    applyHybridDefaults(simH, {
      hybCap1: 0.3, hybCap2: 0.3, hybCap3: 0.3, // tiny caps → near-instant redemption
      hybRate: 22, hybFC: 10, hybGrace: 12,
      medR: 5, matY: 3, growthR: 5,
      liq: 30, exitV: 50, exitMinY: 3, exitMaxY: 9,
      hybExpY: 10,
      hybUpfront: 30, hybTail: 10,
    });
    const sH = simH.snap();

    const simR = loadSim();
    simR.setModelMode('royalty');
    simR.setAndCalc({
      spY: 2, yrs: 10, surv: 100, inv: 1,
      medR: 5, sig: 0, matY: 3,
      growthR: 5,
      liq: 30, exitV: 50, exitMinY: 3, exitMaxY: 9,
      revMult: 3,
      eqT: 30, eqO: 5,                          // matches hybUpfront=30
      ssMode: 'fixed', ssCost: 100, ssMarkup: 20, ssSubtract: 'no',
      rampMode: 'linear',
      antiD: 'none', dil: 60,
      thresh: 500, royMode: 'flat', flatR: 5,
    });
    const sR = simR.snap();

    t.ge(sR.eqRealized, sH.eqRealized,
         'royalty equity ≥ hybrid equity (hybrid steps down redeemed cohorts)');
    // We expect a *meaningful* gap (not just rounding): the hybrid number should
    // be at most half of the royalty number when nearly everyone redeems.
    t.le(sH.eqRealized, sR.eqRealized * 0.6,
         'hybrid equity is at most 60% of royalty equity in this redemption-heavy config');
  });

  // -------------------------------------------------------------------------
  // 8) perVentureInv depends on spY:
  //    Doubling spY (with same invY) halves perVentureInv but doubles the
  //    survivor count, so the aggregate maximum cash (= survivors × max_cap ×
  //    perVentureInv) is invariant. Empirically the realized cumRoyalties[9]
  //    should be of similar magnitude.
  // -------------------------------------------------------------------------
  t.describe('perVentureInv ∝ invY/spY: doubling spY (fixed invY) preserves aggregate cap', () => {
    const simA = loadSim();
    applyHybridDefaults(simA, {
      spY: 2, yrs: 10, surv: 100, inv: 1,
      hybGrace: 0, hybExpY: 10, hybRate: 22, hybFC: 7.5,
      hybCap1: 1.5, hybCap2: 1.5, hybCap3: 1.5,
      medR: 4, matY: 5,
    });
    const sA = simA.snap();
    // spY=2, invY=1 → perVentureInv=0.5, survivors=20, max=20*1.5*0.5 = 15

    const simB = loadSim();
    applyHybridDefaults(simB, {
      spY: 4, yrs: 10, surv: 100, inv: 1,
      hybGrace: 0, hybExpY: 10, hybRate: 22, hybFC: 7.5,
      hybCap1: 1.5, hybCap2: 1.5, hybCap3: 1.5,
      medR: 4, matY: 5,
    });
    const sB = simB.snap();
    // spY=4, invY=1 → perVentureInv=0.25, survivors=40, max=40*1.5*0.25 = 15

    // Theoretical aggregate cap is 15 in both — both must respect that bound.
    t.le(sA.cumRoyalties[9], 15 + 1e-6, 'A respects $15 aggregate cap');
    t.le(sB.cumRoyalties[9], 15 + 1e-6, 'B respects $15 aggregate cap');
    // Since the same revenue/rate config drives payments, A and B should be
    // within 30% of each other (small differences from cohort-size rounding).
    const ratio = sA.cumRoyalties[9] / Math.max(sB.cumRoyalties[9], 1e-9);
    t.between(ratio, 0.7, 1.4, `A/B ratio in similar range (got ${ratio.toFixed(3)})`);
  });

  // -------------------------------------------------------------------------
  // 9) m1 metric in Hybrid mode is the peak annual cash, formatted as $X.XM/yr.
  // -------------------------------------------------------------------------
  t.describe('m1 metric reflects max(annualRoyalties) in Hybrid mode', () => {
    const sim = loadSim();
    applyHybridDefaults(sim, {
      hybRate: 40, hybFC: 20, hybGrace: 0, hybExpY: 12,
      medR: 10, matY: 2,
      hybCap1: 1.5, hybCap2: 1.5, hybCap3: 1.5,
    });
    const s = sim.snap();
    const peak = Math.max(0, ...s.annualRoyalties);
    const expected = '$' + peak.toFixed(1) + 'M/yr';
    t.eq(s.m1, expected, 'm1 == "$peak.toFixed(1)M/yr"');
    t.eq(s.m1label, 'Peak annual cash to Thrive', 'Hybrid m1 label');
    t.matches(s.m1, /^\$\d+(\.\d+)?M\/yr$/, 'm1 has dollar/yr format');
  });

  // -------------------------------------------------------------------------
  // 10) Hypothesis box reflects current Hybrid params.
  // -------------------------------------------------------------------------
  t.describe('hypothesis box echoes Hybrid params back to the user', () => {
    const sim = loadSim();
    applyHybridDefaults(sim, {
      hybRate: 30, hybGrace: 12, hybCap1: 1.0, hybCap2: 1.5, hybCap3: 2.5,
      hybExpY: 7, hybTail: 8,
    });
    const s = sim.snap();
    t.matches(s.hyp, /30% of Founder Earnings/, 'hyp shows hybRate=30%');
    t.matches(s.hyp, /12 mo grace/, 'hyp shows grace=12');
    t.matches(s.hyp, /1\.0x \(Y1.{0,3}3\)/, 'hyp shows cap1=1.0x');
    t.matches(s.hyp, /1\.5x \(Y4.{0,3}5\)/, 'hyp shows cap2=1.5x');
    t.matches(s.hyp, /2\.5x \(Y6.{0,3}8\)/, 'hyp shows cap3=2.5x');
    t.matches(s.hyp, /expires after Y7/, 'hyp shows hybExpY=7');
    t.matches(s.hyp, /steps to 8%/, 'hyp shows hybTail=8%');
  });

  // -------------------------------------------------------------------------
  // 11) Survivors=0: every annual payment must be 0 and equity 0.
  // -------------------------------------------------------------------------
  t.describe('survivors=0 (surv=0) yields all-zero payments', () => {
    const sim = loadSim();
    applyHybridDefaults(sim, { surv: 0 });
    const s = sim.snap();
    for (let i = 0; i < 10; i++) {
      t.eq(s.annualRoyalties[i], 0, `annual[${i}] = 0`);
      t.eq(s.cumRoyalties[i], 0, `cum[${i}] = 0`);
    }
    t.eq(s.eqRealized, 0, 'eqRealized = 0 with no survivors');
  });

  // -------------------------------------------------------------------------
  // 12) Final cap = 0 (all caps zero): degenerate. Should not produce negative
  //    or NaN. cumRoyalties should be all zero.
  // -------------------------------------------------------------------------
  t.describe('all caps = 0: no payments, no NaN/negative leakage', () => {
    const sim = loadSim();
    applyHybridDefaults(sim, {
      hybCap1: 0, hybCap2: 0, hybCap3: 0,
      hybRate: 40, hybFC: 20, hybGrace: 0, hybExpY: 10,
      medR: 5, matY: 2,
    });
    const s = sim.snap();
    t.allFinite(s.cumRoyalties, 'cumRoyalties finite');
    t.allFinite(s.annualRoyalties, 'annualRoyalties finite');
    t.allFinite(s.equityByYear, 'equityByYear finite');
    for (let i = 0; i < 10; i++) {
      t.eq(s.annualRoyalties[i], 0, `annual[${i}] = 0`);
      t.eq(s.cumRoyalties[i], 0, `cum[${i}] = 0`);
      t.ge(s.equityByYear[i], 0, `equity[${i}] non-negative`);
    }
    t.ge(s.eqRealized, 0, 'eqRealized non-negative');
  });

  // -------------------------------------------------------------------------
  // 13) All cohorts redeem: tiny caps + high payments → hyp text should report
  //     "10 / 10 cohorts redeemed".
  // -------------------------------------------------------------------------
  t.describe('all cohorts redeem before horizon when caps are tiny', () => {
    const sim = loadSim();
    applyHybridDefaults(sim, {
      hybCap1: 0.2, hybCap2: 0.2, hybCap3: 0.2,
      hybRate: 40, hybFC: 20, hybGrace: 0, hybExpY: 10,
      medR: 8, matY: 2,
    });
    const s = sim.snap();
    t.matches(s.hyp, /10 \/ 10 cohorts redeemed/, 'hyp reports "10 / 10 cohorts redeemed"');
    // Each cohort caps at perVentureInv*0.2 = 0.5*0.2 = 0.1; survivors=20 → max
    // possible cumRoy = 20*0.1 = $2.0M. We must not exceed that.
    t.le(s.cumRoyalties[9], 2.0 + 1e-6, 'cumRoy[9] within tiny aggregate cap');
  });

  // -------------------------------------------------------------------------
  // 14) Pathological caps (decreasing): hybCap1=2, hybCap2=2, hybCap3=1.
  //     Final cap = max(2,2,1) = 2.0 (per code: hybFinalCap = Math.max...).
  //     At age ≥ 6, capForAge returns 1.0×perVentureInv, but cohorts may already
  //     have cumPaid up to 2.0×perVentureInv, so payments at that age clip to 0
  //     (remaining = max(0, 1*pVI − cumPaid)). Redemption still triggers at the
  //     cumPaid >= 2*perVentureInv bound. Documenting current behaviour.
  // -------------------------------------------------------------------------
  t.describe('pathological caps (2,2,1): final cap = max, age≥6 cap < cumPaid clips to 0', () => {
    const sim = loadSim();
    applyHybridDefaults(sim, {
      hybCap1: 2.0, hybCap2: 2.0, hybCap3: 1.0,
      hybRate: 40, hybFC: 20, hybGrace: 0, hybExpY: 10,
      medR: 5, matY: 2,
    });
    const s = sim.snap();
    // Aggregate ceiling = survivors × max(2,2,1) × perVentureInv = 20 × 2.0 × 0.5 = 20.
    t.le(s.cumRoyalties[9], 20 + 1e-6, 'cumRoy[9] ≤ aggregate final-cap bound');
    t.allFinite(s.annualRoyalties, 'annuals finite even with decreasing caps');
    t.allFinite(s.cumRoyalties, 'cumRoy finite even with decreasing caps');
    for (const v of s.annualRoyalties) t.ge(v, -1e-9, 'no negative annual cash');
    // Most cohorts that had time to reach 2.0×pVI should be redeemed.
    const m = /(\d+) \/ \d+ cohorts redeemed/.exec(s.hyp);
    t.ok(m, 'hyp box has redemption count');
    if (m) t.ge(parseInt(m[1]), 5, 'at least half the cohorts redeem under pathological caps');
  });

  // -------------------------------------------------------------------------
  // Bonus: equity tracks effective-equity blend at the horizon.
  //   Hybrid eqRealized = cumExitsActive * exitV * effEqUpfront
  //                     + cumExitsRedeemed * exitV * effEqTail
  //   With antiD='none' and dil=60, effFactor = 1 - 0.6 = 0.4. So effEqUpfront
  //   = hybUpfrontPct * 0.4 = 0.30 * 0.4 = 0.12; effEqTail = 0.10 * 0.4 = 0.04.
  //   When NO cohort is redeemed (hybCap3=10 + tight horizon), eqRealized is
  //   purely upfront-driven. Also: invariant — equity at all-redeemed ≤ equity
  //   at none-redeemed (tail < upfront).
  // -------------------------------------------------------------------------
  t.describe('hybrid equity blend bounds: tail < upfront → all-redeemed ≤ none-redeemed', () => {
    const simNone = loadSim();
    applyHybridDefaults(simNone, {
      hybCap1: 10, hybCap2: 10, hybCap3: 10,    // unreachable
      hybRate: 22, hybFC: 7.5, hybGrace: 12,
      liq: 30, exitV: 50, exitMinY: 3, exitMaxY: 9,
      hybExpY: 10,
    });
    const sNone = simNone.snap();

    const simAll = loadSim();
    applyHybridDefaults(simAll, {
      hybCap1: 0.05, hybCap2: 0.05, hybCap3: 0.05,
      hybRate: 40, hybFC: 20, hybGrace: 0, hybExpY: 12,
      liq: 30, exitV: 50, exitMinY: 3, exitMaxY: 9,
      medR: 8, matY: 2,
    });
    const sAll = simAll.snap();

    t.ge(sNone.eqRealized, sAll.eqRealized,
         'redemption-heavy run has lower realized equity');
    t.ge(sNone.eqAllTime, sAll.eqAllTime, 'eqAllTime same ordering as eqRealized');
  });

  // -------------------------------------------------------------------------
  // Bonus: cumRoyalties is monotonic non-decreasing — payments accumulate, so
  // the curve must never drop. Standalone smoke for a generic Hybrid run.
  // -------------------------------------------------------------------------
  t.describe('cumRoyalties is monotonic in a generic Hybrid run', () => {
    const sim = loadSim();
    applyHybridDefaults(sim, {
      hybGrace: 12, hybExpY: 8, hybRate: 22, hybFC: 7.5,
      hybCap1: 1.5, hybCap2: 2.0, hybCap3: 3.0,
    });
    const s = sim.snap();
    t.nondecreasing(s.cumRoyalties, 'cumRoyalties non-decreasing');
    for (const v of s.annualRoyalties) t.ge(v, 0, 'no negative annual payments');
    t.matches(s.m4, /^\$.*M \(\d+(\.\d+)?x\)$/, 'm4 has $X (Yx) total return format');
  });
}
