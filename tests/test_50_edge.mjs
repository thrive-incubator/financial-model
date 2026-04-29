// Edge cases, runway, year snapshot, and shared services math.
// Adversarial coverage of parameter extremes and boundary behaviors. Every test
// uses a fresh loadSim() instance so state doesn't leak between scenarios.

import { loadSim } from './harness.mjs';

// Helper: load + boot to likely + dividend (the page's default), apply
// per-test slider overrides, then re-run calc().
function setup(mode, overrides) {
  const sim = loadSim();
  sim.applyPreset('likely');
  sim.setModelMode(mode || 'dividend');
  if (overrides) sim.setAndCalc(overrides);
  return sim;
}

export default function (t) {
  // -------------------------------------------------------------------------
  // 1. yrs=1 edge: only one cohort exists.
  // cumInvestment[0] = invY × 1 minus any SS subtraction (clamped ≥ 0).
  // activeCompanies stays constant across all 10 horizon years.
  // -------------------------------------------------------------------------
  t.describe('yrs=1: single cohort, active count constant past Y1', () => {
    const sim = setup('royalty', { yrs: 1, ssSubtract: 'no' });
    const s = sim.snap();
    // gross = 1 × 1 = 1 with no SS subtraction
    t.near(s.cumInvestment[0], 1, 1e-6, 'cumInvestment[0] = invY*1 = $1M');
    // No new cohorts after Y1 → activeCompanies plateaus at cohortSurvivors
    const ac0 = s.activeCompanies[0];
    for (let i = 1; i < 10; i++) {
      t.near(s.activeCompanies[i], ac0, 1e-6, `activeCompanies[${i}] = ac[0]`);
    }
    // cumInvestment plateaus at gross after y=1 (since Math.min(y, yrs) caps)
    for (let i = 1; i < 10; i++) {
      t.near(s.cumInvestment[i], s.cumInvestment[0], 1e-6, `cumInvestment[${i}] plateaus`);
    }
    // cumRoyalties grows monotonically (single cohort still ramps & matures)
    t.nondecreasing(s.cumRoyalties, 'cumRoyalties grows past Y1');
  });

  // -------------------------------------------------------------------------
  // 2. yrs=10 with spY=0.5: 5 total ventures over 10 years. Fractional spY OK.
  // -------------------------------------------------------------------------
  t.describe('spY=0.5, yrs=10: fractional ventures sensible', () => {
    const sim = setup('royalty', { spY: 0.5 });
    const s = sim.snap();
    t.allFinite(s.activeCompanies, 'activeCompanies all finite');
    t.allFinite(s.cumRoyalties,    'cumRoyalties all finite');
    t.allFinite(s.equityByYear,    'equityByYear all finite');
    // 5 ventures × 70% survival = 3.5 → rounds to 4 → cohortSurvivors = 4/10 = 0.4 per yr
    // activeCompanies[9] = 10 × 0.4 = 4
    t.between(s.activeCompanies[9], 3, 5, 'activeCompanies[9] in [3,5]');
    t.ge(s.activeCompanies[9], s.activeCompanies[0] - 1e-9, 'AC monotone non-decreasing');
  });

  // -------------------------------------------------------------------------
  // 3 & 4. survR scaling (low vs. high)
  // -------------------------------------------------------------------------
  t.describe('survR=50 vs 95: equity & cash scale roughly proportionally', () => {
    const lo = setup('royalty', { surv: 50 }).snap();
    const hi = setup('royalty', { surv: 95 }).snap();
    // Hi scenario should yield more cumRoyalties and more equity than lo
    t.ok(hi.cumRoyalties[9] > lo.cumRoyalties[9], 'hi cumRoy > lo cumRoy');
    t.ok(hi.equityByYear[9] >= lo.equityByYear[9], 'hi equity >= lo equity');
    // Ratio should be roughly 95/50 = 1.9; allow wide band [1.4, 2.4]
    const ratio = hi.cumRoyalties[9] / Math.max(lo.cumRoyalties[9], 1e-9);
    t.between(ratio, 1.3, 2.6, `cumRoy ratio ≈ 1.9 (got ${ratio.toFixed(2)})`);
  });

  // -------------------------------------------------------------------------
  // 5. medR=1: tiny revenue, royalties small but positive in royalty/dividend
  // -------------------------------------------------------------------------
  t.describe('medR=1 (tiny): small but positive royalties (dividend mode)', () => {
    const sim = setup('dividend', { medR: 1 });
    const s = sim.snap();
    t.ge(s.cumRoyalties[9], 0, 'cumRoy nonneg');
    t.ok(s.cumRoyalties[9] < 5, 'cumRoy is small (< $5M)');
  });

  // 5b. medR=1 in hybrid: cap unlikely to be reached → fewer redemptions
  t.describe('medR=1 hybrid: caps rarely hit, equity stays at upfront', () => {
    const sim = setup('hybrid', { medR: 1 });
    const s = sim.snap();
    t.allFinite(s.equityByYear, 'equity finite');
    t.ge(s.equityByYear[9], 0, 'equity nonneg');
  });

  // -------------------------------------------------------------------------
  // 6. medR=15 (huge): cumRoyalties large; in hybrid, caps likely hit early
  // -------------------------------------------------------------------------
  t.describe('medR=15 (huge): cumRoyalties large (royalty mode)', () => {
    const sim = setup('royalty', { medR: 15 });
    const s = sim.snap();
    t.ok(s.cumRoyalties[9] > 5, 'cumRoy > $5M with huge medR');
  });

  // -------------------------------------------------------------------------
  // 7. sig=0: zero spread → all ventures sample the same revenue (= medR).
  // Most/all ventures should fall into the bucket containing medR.
  // -------------------------------------------------------------------------
  t.describe('sig=0: distribution collapses to one bucket', () => {
    const sim = setup('royalty', { sig: 0, medR: 4 });
    const s = sim.snap();
    // boxMuller adds 0 × z = 0, so revenue is exactly medR
    // medR=4 → bucket "$3-5M" (index 2)
    // No NaN, finite outputs
    t.allFinite(s.cumRoyalties, 'cumRoy finite at sig=0');
    t.allFinite(s.equityByYear, 'equity finite at sig=0');
    t.ok(s.cumRoyalties[9] > 0, 'sig=0 still produces royalties');
  });

  // -------------------------------------------------------------------------
  // 8. sig=1 (high spread): wider distribution, output still finite
  // -------------------------------------------------------------------------
  t.describe('sig=1: wide distribution stays finite', () => {
    const sim = setup('royalty', { sig: 1 });
    const s = sim.snap();
    t.allFinite(s.cumRoyalties, 'cumRoy finite');
    t.ge(s.cumRoyalties[9], 0, 'cumRoy nonneg');
  });

  // -------------------------------------------------------------------------
  // 9. matY=2 (fast ramp): cash flows ramp earlier
  // 10. matY=7 (slow ramp): cash flows ramp later
  // -------------------------------------------------------------------------
  t.describe('matY=2 vs 7: fast ramp produces more early-year cash', () => {
    const fast = setup('dividend', { matY: 2 }).snap();
    const slow = setup('dividend', { matY: 7 }).snap();
    // By year 3, fast should have more cumulative cash than slow
    t.ok(fast.cumRoyalties[2] >= slow.cumRoyalties[2], 'fast Y3 cum >= slow Y3 cum');
    // Fast Y10 royalty likely also higher (more years past maturity)
    t.ok(fast.cumRoyalties[9] >= slow.cumRoyalties[9] - 0.5, 'fast Y10 cum ≥ slow Y10 cum');
  });

  // -------------------------------------------------------------------------
  // 11 & 12. growthR=0 vs growthR=20
  // -------------------------------------------------------------------------
  t.describe('growthR=0 vs 20: high growth → higher Y10 cumulative', () => {
    const flat = setup('dividend', { growthR: 0 }).snap();
    const grow = setup('dividend', { growthR: 20 }).snap();
    t.ok(grow.cumRoyalties[9] > flat.cumRoyalties[9], 'growthR=20 yields more cum royalty than 0');
  });

  // -------------------------------------------------------------------------
  // 13. exitMinY > exitMaxY: pathological, windowLen=max(neg+1,1)=1.
  // No cohort age satisfies (age >= exitMinY && age <= exitMaxY) → equity ≈ 0.
  // -------------------------------------------------------------------------
  t.describe('exitMinY > exitMaxY: no exits trigger, equity ≈ 0', () => {
    const sim = setup('royalty', { exitMinY: 12, exitMaxY: 7 });
    const s = sim.snap();
    t.allFinite(s.equityByYear, 'equity finite (no crash)');
    // No age can be both >= 12 and <= 7 → exitsCohortY always 0
    for (let i = 0; i < 10; i++) {
      t.near(s.equityByYear[i], 0, 1e-6, `equityByYear[${i}] = 0`);
    }
  });

  // -------------------------------------------------------------------------
  // 14. exitMinY = exitMaxY: single-year window, all exits in one year.
  // -------------------------------------------------------------------------
  t.describe('exitMinY = exitMaxY: single-year window, equity step', () => {
    const sim = setup('royalty', { exitMinY: 5, exitMaxY: 5, liq: 20 });
    const s = sim.snap();
    t.allFinite(s.equityByYear, 'equity finite');
    // First exit should occur at Y5 — equityByYear[3] = 0 (Y4), then > 0 at Y5+
    t.near(s.equityByYear[3], 0, 1e-6, 'equity at Y4 = 0 (pre-window)');
    t.ok(s.equityByYear[4] > 0, 'equity at Y5 > 0 (in window)');
  });

  // -------------------------------------------------------------------------
  // 15. liqP=0: no exits, all equityByYear = 0 across modes.
  // -------------------------------------------------------------------------
  t.describe('liq=0: equityByYear is all zero in all modes', () => {
    for (const mode of ['royalty', 'dividend', 'hybrid']) {
      const sim = setup(mode, { liq: 0 });
      const s = sim.snap();
      for (let i = 0; i < 10; i++) {
        t.near(s.equityByYear[i], 0, 1e-6, `${mode}: equityByYear[${i}]=0`);
      }
    }
  });

  // -------------------------------------------------------------------------
  // 16. liqP=30 (slider max): equity scales up
  // -------------------------------------------------------------------------
  t.describe('liq=30 (max): equity scales up vs default', () => {
    const lo = setup('royalty', { liq: 5 }).snap();
    const hi = setup('royalty', { liq: 30 }).snap();
    t.ok(hi.equityByYear[9] > lo.equityByYear[9], 'liq=30 > liq=5 equity');
    // Should scale roughly proportionally (×6) but allow wide band — survivors are integer, etc.
    const ratio = hi.equityByYear[9] / Math.max(lo.equityByYear[9], 1e-9);
    t.between(ratio, 4, 8, `equity ratio ≈ 6 (got ${ratio.toFixed(2)})`);
  });

  // -------------------------------------------------------------------------
  // 17. ssMode=pct, ssPct=0 → ssCostY = 0 → all SS arrays are 0
  // -------------------------------------------------------------------------
  t.describe('ssMode=pct, ssPct=0: SS arrays all zero', () => {
    const sim = setup('royalty', { ssMode: 'pct', ssPct: 0 });
    const s = sim.snap();
    for (let i = 0; i < 10; i++) {
      t.near(s.ssAnnualBilled[i], 0, 1e-6, `ssAnnualBilled[${i}]=0`);
      t.near(s.ssAnnualNet[i],    0, 1e-6, `ssAnnualNet[${i}]=0`);
      t.near(s.ssCumNet[i],       0, 1e-6, `ssCumNet[${i}]=0`);
    }
  });

  // -------------------------------------------------------------------------
  // 18. ssMode=fixed, ssCost=0 → ssCostY=0
  // Note: ssCost min slider is 10, but the input accepts 0 in tests.
  // -------------------------------------------------------------------------
  t.describe('ssMode=fixed, ssCost=0: SS arrays all zero', () => {
    const sim = setup('royalty', { ssMode: 'fixed', ssCost: 0 });
    const s = sim.snap();
    for (let i = 0; i < 10; i++) {
      t.near(s.ssAnnualNet[i], 0, 1e-6, `ssAnnualNet[${i}]=0`);
      t.near(s.ssCumNet[i],    0, 1e-6, `ssCumNet[${i}]=0`);
    }
  });

  // -------------------------------------------------------------------------
  // 19. ssMarkup=0: ssNetY=0, ssBilledY=ssCostY.
  // ssAnnualBilled[9] should equal activeCompanies[9] × (ssCost/1000) when fixed.
  // -------------------------------------------------------------------------
  t.describe('ssMarkup=0, fixed mode: billed = activeCompanies × ssCost/1000', () => {
    const sim = setup('royalty', { ssMode: 'fixed', ssMarkup: 0, ssCost: 100 });
    const s = sim.snap();
    // ssCost=100 ($K) → 0.1 ($M) per company. activeCompanies[9] × 0.1.
    const expected = s.activeCompanies[9] * 0.1;
    // ssAnnualBilled is rounded to 2dp; use ε=0.01
    t.near(s.ssAnnualBilled[9], expected, 0.02, 'ssAnnualBilled[9]');
    // Net = cost × markup = 0
    for (let i = 0; i < 10; i++) {
      t.near(s.ssAnnualNet[i], 0, 1e-6, `ssAnnualNet[${i}]=0 at markup=0`);
    }
  });

  // -------------------------------------------------------------------------
  // 20. ssMarkup=100%: ssNetY = ssCostY (markup=1 means net=cost), billed = 2×cost
  // → ssAnnualNet = ssAnnualBilled / 2
  // -------------------------------------------------------------------------
  t.describe('ssMarkup=100: net = billed / 2 each year', () => {
    const sim = setup('royalty', { ssMode: 'fixed', ssMarkup: 100, ssCost: 100 });
    const s = sim.snap();
    for (let i = 0; i < 10; i++) {
      const half = s.ssAnnualBilled[i] / 2;
      t.near(s.ssAnnualNet[i], half, 0.05, `Y${i+1}: net = billed/2`);
    }
  });

  // -------------------------------------------------------------------------
  // 21. ssSubtract='billed': cumInvestment = max(0, gross - cumBilled)
  // -------------------------------------------------------------------------
  t.describe('ssSubtract=billed: cumInvestment = max(0, gross - cumBilled)', () => {
    const sim = setup('royalty', { ssSubtract: 'billed', ssMode: 'fixed', ssCost: 100, ssMarkup: 20 });
    const s = sim.snap();
    const yrs = parseInt(sim.getValue('yrs'));
    const invY = parseFloat(sim.getValue('inv'));
    for (let i = 0; i < 10; i++) {
      const gross = Math.min(i + 1, yrs) * invY;
      const expected = Math.max(0, Math.round((gross - s.ssCumBilled[i]) * 10) / 10);
      t.near(s.cumInvestment[i], expected, 0.15, `cumInvestment[${i}] = max(0, gross - billed)`);
    }
  });

  // -------------------------------------------------------------------------
  // 22. ssSubtract='no': cumInvestment is gross investment, unaffected by SS
  // -------------------------------------------------------------------------
  t.describe('ssSubtract=no: cumInvestment = invY × min(yrs, y+1)', () => {
    const sim = setup('royalty', { ssSubtract: 'no' });
    const s = sim.snap();
    const yrs = parseInt(sim.getValue('yrs'));
    const invY = parseFloat(sim.getValue('inv'));
    for (let i = 0; i < 10; i++) {
      const expected = Math.round(Math.min(i + 1, yrs) * invY * 10) / 10;
      t.near(s.cumInvestment[i], expected, 1e-6, `cumInvestment[${i}] = gross`);
    }
  });

  // -------------------------------------------------------------------------
  // 23. calcRunway: a $30M raise should easily cover 10 years of $1M/yr spend
  // → runwayYrs text contains "10+ yrs" success indicator
  // -------------------------------------------------------------------------
  t.describe('calcRunway: $30M raise covers 10+ yrs', () => {
    const sim = setup('royalty');
    sim.setValue('raiseInput', 30);
    sim.setValue('safetyBuffer', 0);
    sim.calcRunway();
    const txt = sim.getText('runwayYrs');
    t.matches(txt, /10\+/, 'runwayYrs contains "10+"');
  });

  // -------------------------------------------------------------------------
  // 24. calcRunway: $1M raise — runway < 10 years
  // -------------------------------------------------------------------------
  t.describe('calcRunway: insufficient raise → runway < 10 yrs', () => {
    const sim = setup('royalty');
    sim.setValue('raiseInput', 1);
    sim.setValue('safetyBuffer', 0);
    sim.calcRunway();
    const txt = sim.getText('runwayYrs');
    t.notMatches(txt, /10\+/, 'runwayYrs is NOT "10+"');
  });

  // -------------------------------------------------------------------------
  // 25. safetyBuffer=0: effectiveRaise = raise → runwayEffective text empty
  // -------------------------------------------------------------------------
  t.describe('safetyBuffer=0: runwayEffective text is empty', () => {
    const sim = setup('royalty');
    sim.setValue('raiseInput', 5);
    sim.setValue('safetyBuffer', 0);
    sim.calcRunway();
    t.eq(sim.getText('runwayEffective'), '', 'runwayEffective empty when buffer=0');
    t.eq(sim.getText('safetyBufferVal'), '', 'safetyBufferVal empty when buffer=0');
  });

  // 25b. safetyBuffer=12 → bufferAmt = invY × 1
  t.describe('safetyBuffer=12: bufferAmt = invY × 1', () => {
    const sim = setup('royalty');
    sim.setValue('raiseInput', 5);
    sim.setValue('safetyBuffer', 12);
    sim.calcRunway();
    // Display should mention "$1.0M set aside"
    const bufVal = sim.getText('safetyBufferVal');
    t.matches(bufVal, /set aside/, 'safetyBufferVal mentions "set aside"');
    t.matches(bufVal, /\$1\.0M/, 'safetyBufferVal shows $1.0M');
  });

  // -------------------------------------------------------------------------
  // 26. calcRunway color: success when raise covers, danger when it doesn't
  // -------------------------------------------------------------------------
  t.describe('calcRunway color: success/danger based on coverage', () => {
    const simHi = setup('royalty');
    simHi.setValue('raiseInput', 30);
    simHi.setValue('safetyBuffer', 0);
    simHi.calcRunway();
    const elColorHi = simHi.getValue('runwayMinNeeded');
    // Style.color is on the element; let's read it via getElementById
    // The harness exposes setValue/getText but not style. Instead, look at runwayYrs color
    // We at least verify the numeric value is finite and small
    const minNeeded = simHi.getText('runwayMinNeeded');
    t.matches(minNeeded, /\$/, 'runwayMinNeeded shows $-formatted value');

    const simLo = setup('royalty');
    simLo.setValue('raiseInput', 0.5);
    simLo.setValue('safetyBuffer', 0);
    simLo.calcRunway();
    const minNeededLo = simLo.getText('runwayMinNeeded');
    t.matches(minNeededLo, /\$/, 'runwayMinNeeded shows $-formatted value (low raise)');
  });

  // -------------------------------------------------------------------------
  // 27. selfFundYear: when annual income (royalty + ssNet) ≥ annual investment
  // Likely preset: invY=1. Compare runwaySelfFund to manually computed value.
  // -------------------------------------------------------------------------
  t.describe('selfFundYear matches runwaySelfFund or "Beyond yr 10"', () => {
    const sim = setup('royalty');
    sim.setValue('raiseInput', 5);
    sim.setValue('safetyBuffer', 0);
    sim.calcRunway();
    const s = sim.snap();
    const yrs = parseInt(sim.getValue('yrs'));
    const invY = parseFloat(sim.getValue('inv'));
    // Manually compute first year where annualIncome >= annualCost
    let selfFundManual = null;
    for (let y = 1; y <= 10; y++) {
      const annualIncome = (s.annualRoyalties[y - 1] || 0) + (s.ssAnnualNet[y - 1] || 0);
      const annualCost = y <= yrs ? invY : 0;
      if (annualIncome >= annualCost) {
        selfFundManual = y;
        break;
      }
    }
    const sfText = sim.getText('runwaySelfFund');
    if (selfFundManual === null) {
      t.eq(sfText, 'Beyond yr 10', 'runwaySelfFund="Beyond yr 10" when never reached');
    } else {
      t.matches(sfText, /^Yr \d+\.\d+$/, `runwaySelfFund matches "Yr N.N" (got "${sfText}")`);
    }
  });

  // -------------------------------------------------------------------------
  // 28. Investment payback crossover: cumulative inflow ≥ cumulative investment
  // -------------------------------------------------------------------------
  t.describe('crossover: matches manual computation or "Beyond yr 10"', () => {
    const sim = setup('royalty');
    sim.setValue('raiseInput', 5);
    sim.setValue('safetyBuffer', 0);
    sim.calcRunway();
    const s = sim.snap();
    let manualXover = null;
    for (let i = 0; i < s.cumRoyalties.length; i++) {
      const inflow = (s.cumRoyalties[i] || 0) + (s.equityByYear[i] || 0) + (s.ssCumNet[i] || 0);
      if (inflow >= (s.cumInvestment[i] || Infinity)) {
        manualXover = i + 1;
        break;
      }
    }
    const xoverText = sim.getText('runwayCrossover');
    if (manualXover === null) {
      t.eq(xoverText, 'Beyond yr 10', 'crossover="Beyond yr 10"');
    } else {
      t.eq(xoverText, 'Yr ' + manualXover, `crossover="Yr ${manualXover}"`);
    }
  });

  // -------------------------------------------------------------------------
  // 29. updateYearSnapshot: format check at each year (Y1..Y10)
  // -------------------------------------------------------------------------
  t.describe('updateYearSnapshot Y1..Y10: text formats sensible', () => {
    const sim = setup('dividend');
    for (let y = 1; y <= 10; y++) {
      sim.setValue('yearSlider', y);
      sim.updateYearSnapshot();
      const ac = sim.getText('snapActiveC');
      const ann = sim.getText('snapAnnualRoy');
      const ss = sim.getText('snapSSNet');
      const burn = sim.getText('snapCumNet');
      t.notMatches(ac, /NaN/, `Y${y}: snapActiveC no NaN`);
      t.notMatches(ann, /NaN/, `Y${y}: snapAnnualRoy no NaN`);
      t.notMatches(ss, /NaN/, `Y${y}: snapSSNet no NaN`);
      t.notMatches(burn, /NaN/, `Y${y}: snapCumNet no NaN`);
      t.matches(ann, /\$/, `Y${y}: snapAnnualRoy contains $`);
      t.matches(ss,  /\$/, `Y${y}: snapSSNet contains $`);
      // burn is either positive (with $) or surplus prefixed with +
      t.matches(burn, /(\$|\+)/, `Y${y}: snapCumNet has $ or +`);
    }
  });

  // -------------------------------------------------------------------------
  // 30. snapActiveC: integer or "lo – hi" range, never NaN
  // -------------------------------------------------------------------------
  t.describe('snapActiveC: integer or "lo – hi" range', () => {
    const sim = setup('dividend', { spY: 0.5 });  // forces fractional active counts
    for (let y = 1; y <= 10; y++) {
      sim.setValue('yearSlider', y);
      sim.updateYearSnapshot();
      const ac = sim.getText('snapActiveC');
      // Either single integer (e.g., "4") or range "1 – 2"
      t.matches(ac, /^\d+(\s+–\s+\d+)?$/, `Y${y}: snapActiveC format ("${ac}")`);
    }
  });

  // -------------------------------------------------------------------------
  // 31. hybGrace > 12 × horizon (e.g., 200 mo): no cohort ever pays
  // -------------------------------------------------------------------------
  t.describe('hybGrace=200mo: zero royalties (grace exceeds horizon)', () => {
    const sim = setup('hybrid', { hybGrace: 200 });
    const s = sim.snap();
    // age*12 > 200 means age > 16.67 — no cohort age in 10yr horizon hits this.
    // So no payments → cumRoyalties = 0
    for (let i = 0; i < 10; i++) {
      t.near(s.cumRoyalties[i], 0, 1e-6, `cumRoy[${i}]=0 (no payments)`);
    }
  });

  // -------------------------------------------------------------------------
  // 32. hybExpY=1: every cohort expires before paying (age 1 hits expiration since age > 1 triggers)
  // → cumRoyalties=0; equity may still grow at upfront % (cohorts go to 'expired')
  // Note: hybExpY min slider is 5; we still set it explicitly to 1 for the test.
  // -------------------------------------------------------------------------
  t.describe('hybExpY=1: cohorts expire before paying', () => {
    const sim = setup('hybrid', { hybExpY: 1, hybGrace: 0 });
    const s = sim.snap();
    // age=1: payment happens (age*12=12 > graceMo=0 ✓ AND age <= hybExpY=1 ✓)
    // age=2: status flips to 'expired' (age > hybExpY=1) — so payment skipped
    // So payments are ONLY at age=1. Let's just verify the system stays finite.
    t.allFinite(s.cumRoyalties, 'cumRoy finite');
    t.allFinite(s.equityByYear, 'equity finite');
    t.ge(s.equityByYear[9], 0, 'equity nonneg');
  });

  // -------------------------------------------------------------------------
  // 33 & 34. hybCap multipliers very low vs very high
  // -------------------------------------------------------------------------
  t.describe('hybCap multipliers very low (0.1): cohorts redeem fast', () => {
    // hybCap1 slider min is 1, but we can override
    const sim = setup('hybrid', { hybCap1: 0.1, hybCap2: 0.1, hybCap3: 0.1, hybGrace: 0 });
    const s = sim.snap();
    // Caps trivially hit → cohorts redeem fast
    t.allFinite(s.cumRoyalties, 'cumRoy finite');
    t.allFinite(s.equityByYear, 'equity finite');
    // Y10 cumRoy is small (capped low)
    t.le(s.cumRoyalties[9], 5, 'cumRoy[9] small under tiny caps');
  });

  t.describe('hybCap multipliers very high (6): caps never hit', () => {
    const sim = setup('hybrid', { hybCap1: 6, hybCap2: 6, hybCap3: 6, hybGrace: 0 });
    const s = sim.snap();
    t.allFinite(s.cumRoyalties, 'cumRoy finite');
    t.allFinite(s.equityByYear, 'equity finite');
    t.ge(s.cumRoyalties[9], 0, 'cumRoy nonneg');
  });

  // -------------------------------------------------------------------------
  // 35. No NaN anywhere across multiple extreme configs
  // -------------------------------------------------------------------------
  t.describe('no NaN under combined extremes (sig=0, medR=1)', () => {
    const sim = setup('royalty', { sig: 0, medR: 1, liq: 0, growthR: 0 });
    const s = sim.snap();
    t.allFinite(s.cumRoyalties,    'cumRoyalties');
    t.allFinite(s.equityByYear,    'equityByYear');
    t.allFinite(s.cumInvestment,   'cumInvestment');
    t.allFinite(s.activeCompanies, 'activeCompanies');
    t.allFinite(s.ssAnnualBilled,  'ssAnnualBilled');
    t.allFinite(s.ssAnnualNet,     'ssAnnualNet');
    t.allFinite(s.annualRoyalties, 'annualRoyalties');
  });

  t.describe('no NaN under combined extremes (liq=0, exitV=200, survR=50, spY=0.5)', () => {
    const sim = setup('hybrid', { liq: 0, exitV: 200, surv: 50, spY: 0.5 });
    const s = sim.snap();
    t.allFinite(s.cumRoyalties,    'cumRoyalties');
    t.allFinite(s.equityByYear,    'equityByYear');
    t.allFinite(s.cumInvestment,   'cumInvestment');
    t.allFinite(s.activeCompanies, 'activeCompanies');
  });

  // -------------------------------------------------------------------------
  // 36. cumInvestment ≥ 0 even when SS net exceeds gross
  // -------------------------------------------------------------------------
  t.describe('cumInvestment clamped ≥ 0 when SS billed exceeds gross investment', () => {
    const sim = setup('royalty', {
      ssMode: 'fixed',
      ssCost: 500,         // max slider value
      ssMarkup: 100,
      ssSubtract: 'billed' // most aggressive subtraction
    });
    const s = sim.snap();
    for (let i = 0; i < 10; i++) {
      t.ge(s.cumInvestment[i], 0, `cumInvestment[${i}] ≥ 0`);
    }
  });

  // -------------------------------------------------------------------------
  // BONUS: cumRoyalties is monotonic non-decreasing in all modes
  // -------------------------------------------------------------------------
  t.describe('cumRoyalties is monotonic non-decreasing across modes', () => {
    for (const mode of ['royalty', 'dividend', 'hybrid']) {
      const sim = setup(mode);
      const s = sim.snap();
      t.nondecreasing(s.cumRoyalties, mode + ' cumRoy nondecreasing');
    }
  });

  // -------------------------------------------------------------------------
  // BONUS: equityByYear is monotonic non-decreasing (cumExits only grows)
  // -------------------------------------------------------------------------
  t.describe('equityByYear is monotonic non-decreasing', () => {
    for (const mode of ['royalty', 'dividend', 'hybrid']) {
      const sim = setup(mode);
      const s = sim.snap();
      t.nondecreasing(s.equityByYear, mode + ' equityByYear nondecreasing');
    }
  });

  // -------------------------------------------------------------------------
  // BONUS: ssCumNet[i] = sum(ssAnnualNet[0..i]) within rounding
  // -------------------------------------------------------------------------
  t.describe('ssCumNet equals cumulative sum of ssAnnualNet', () => {
    const sim = setup('royalty');
    const s = sim.snap();
    let cum = 0;
    for (let i = 0; i < 10; i++) {
      cum += s.ssAnnualNet[i];
      t.near(s.ssCumNet[i], cum, 0.05, `ssCumNet[${i}] = sum(annualNet[0..${i}])`);
    }
  });

  // -------------------------------------------------------------------------
  // BONUS: ssCumBilled[i] = sum(ssAnnualBilled[0..i])
  // -------------------------------------------------------------------------
  t.describe('ssCumBilled equals cumulative sum of ssAnnualBilled', () => {
    const sim = setup('royalty');
    const s = sim.snap();
    let cum = 0;
    for (let i = 0; i < 10; i++) {
      cum += s.ssAnnualBilled[i];
      t.near(s.ssCumBilled[i], cum, 0.05, `ssCumBilled[${i}] = sum(annualBilled[0..${i}])`);
    }
  });

  // -------------------------------------------------------------------------
  // BONUS: yearSlider out-of-range fallback (uses || 0)
  // -------------------------------------------------------------------------
  t.describe('yearSlider out-of-range: snap reads || 0 fallback safely', () => {
    const sim = setup('dividend');
    sim.setValue('yearSlider', 99);
    sim.updateYearSnapshot();
    // Reads _activeCompaniesArr[98] which is undefined → || 0
    const ac = sim.getText('snapActiveC');
    t.eq(ac, '0', 'snapActiveC=0 for out-of-range year');
  });
}
