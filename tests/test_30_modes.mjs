// Cross-mode integration tests — Royalty / Dividend / Hybrid coexisting in the
// same `calc()` and `runScenario()` code paths. Hunts for state-leak bugs,
// label inconsistencies, eqT override drift, and runScenario↔calc divergence.

import { loadSim } from './harness.mjs';

// Build divOpts/hybOpts from the live presetState `p` exactly the way
// buildScenarioChart does internally.
function divOptsFor(mode, p) {
  if (mode !== 'dividend') return null;
  return {
    ownership: p.divOwn / 100,
    margin:    p.divMargin / 100,
    payout:    p.divPayout / 100,
  };
}
function hybOptsFor(mode, p) {
  if (mode !== 'hybrid') return null;
  return {
    upfront: (p.hybUpfront ?? 30) / 100,
    tail:    (p.hybTail    ?? 10) / 100,
    fc:      (p.hybFC      ?? 7.5) / 100,
    rate:    (p.hybRate    ?? 22) / 100,
    graceMo:  p.hybGrace   ?? 21,
    cap1:     p.hybCap1    ?? 1.5,
    cap2:     p.hybCap2    ?? 2.0,
    cap3:     p.hybCap3    ?? 3.0,
    expY:     p.hybExpY    ?? 8,
    margin:  (p.divMargin  ?? 35) / 100,
  };
}

const ALL_MODES = ['royalty', 'dividend', 'hybrid'];

export default function (t) {
  // ─────────────────────────────────────────────────────────────────────
  // 1. Each mode produces 10-element finite arrays for all output series.
  // ─────────────────────────────────────────────────────────────────────
  t.describe('all modes: 10-elt finite arrays for every output series', () => {
    for (const mode of ALL_MODES) {
      const sim = loadSim();
      sim.applyPreset('likely');
      sim.setModelMode(mode);
      const s = sim.snap();
      t.eq(s.cumRoyalties.length,    10, `${mode}: cumRoyalties len`);
      t.eq(s.equityByYear.length,    10, `${mode}: equityByYear len`);
      t.eq(s.cumInvestment.length,   10, `${mode}: cumInvestment len`);
      t.eq(s.annualRoyalties.length, 10, `${mode}: annualRoyalties len`);
      t.eq(s.ssAnnualNet.length,     10, `${mode}: ssAnnualNet len`);
      t.eq(s.activeCompanies.length, 10, `${mode}: activeCompanies len`);
      t.allFinite(s.cumRoyalties,    `${mode}: cumRoyalties finite`);
      t.allFinite(s.equityByYear,    `${mode}: equityByYear finite`);
      t.allFinite(s.cumInvestment,   `${mode}: cumInvestment finite`);
      t.allFinite(s.annualRoyalties, `${mode}: annualRoyalties finite`);
      t.allFinite(s.ssAnnualNet,     `${mode}: ssAnnualNet finite`);
      t.allFinite(s.activeCompanies, `${mode}: activeCompanies finite`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // 2. Cumulatives are nondecreasing.
  // ─────────────────────────────────────────────────────────────────────
  t.describe('cumulative series are nondecreasing in every mode', () => {
    for (const mode of ALL_MODES) {
      const sim = loadSim();
      sim.applyPreset('likely');
      sim.setModelMode(mode);
      const s = sim.snap();
      t.nondecreasing(s.cumRoyalties,  `${mode}: cumRoyalties nondecreasing`);
      t.nondecreasing(s.ssCumNet,      `${mode}: ssCumNet nondecreasing`);
      t.nondecreasing(s.ssCumBilled,   `${mode}: ssCumBilled nondecreasing`);
      // cumInvestment is nondecreasing only when ssSubtract='no' AND grossInv is nondecreasing
      // (it always is). With ssSubtract='net' it might dip if SS net swings, but in practice
      // ssCumNet is nondecreasing too, so the deduction grows monotonically — we test default.
      // The "Likely" preset uses ssSubtract='net'; cumInvestment may plateau but should not drop.
      t.nondecreasing(s.cumInvestment, `${mode}: cumInvestment nondecreasing`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // 3. annualRoyalties never negative; Hybrid Y1 must be exactly 0 (grace).
  // ─────────────────────────────────────────────────────────────────────
  t.describe('annualRoyalties ≥ 0 always; Hybrid Y1 == 0 with default grace=21mo', () => {
    for (const mode of ALL_MODES) {
      const sim = loadSim();
      sim.applyPreset('likely');
      sim.setModelMode(mode);
      const s = sim.snap();
      for (let i = 0; i < 10; i++) {
        t.ge(s.annualRoyalties[i], 0, `${mode}: annualRoyalties[${i}] ≥ 0`);
      }
    }
    // Hybrid with default grace (21 mo): age=1 means age*12 = 12 ≤ 21, so cohort 1 pays 0 in Y1.
    const hyb = loadSim();
    hyb.applyPreset('likely');
    hyb.setModelMode('hybrid');
    const hs = hyb.snap();
    t.eq(hs.annualRoyalties[0], 0, 'hybrid: Y1 grace → annualRoyalties[0] == 0');
  });

  // ─────────────────────────────────────────────────────────────────────
  // 4-7. Label correctness per mode.
  // ─────────────────────────────────────────────────────────────────────
  t.describe('m1label/m2label/m4label/returnStructureTitle change per mode', () => {
    const expected = {
      royalty: {
        m1: 'Annual royalty income (steady state)',
        m2: 'Cumulative royalty (10 yr)',
        m4: 'Total return (royalty + equity)',
        title: 'Royalty structure',
      },
      dividend: {
        m1: 'Annual dividend income (steady state)',
        m2: 'Cumulative dividend (10 yr)',
        m4: 'Total return (dividend + equity)',
        title: 'Dividend structure',
      },
      hybrid: {
        m1: 'Peak annual cash to Thrive',
        m2: 'Cumulative cash (10 yr)',
        m4: 'Total return (cash + equity)',
        title: 'Hybrid (term sheet) structure',
      },
    };
    for (const mode of ALL_MODES) {
      const sim = loadSim();
      sim.applyPreset('likely');
      sim.setModelMode(mode);
      const s = sim.snap();
      t.eq(s.m1label, expected[mode].m1,           `${mode}: m1label`);
      t.eq(s.m2label, expected[mode].m2,           `${mode}: m2label`);
      t.eq(s.m4label, expected[mode].m4,           `${mode}: m4label`);
      t.eq(s.returnStructureTitle, expected[mode].title, `${mode}: returnStructureTitle`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // 8. Hypothesis box contains mode-specific markers.
  // ─────────────────────────────────────────────────────────────────────
  t.describe('hypothesis box has mode-specific labels', () => {
    const royalty = loadSim();  royalty.applyPreset('likely');  royalty.setModelMode('royalty');
    t.matches(royalty.snap().hyp, /<b>Royalty:<\/b>/, 'royalty: <b>Royalty:</b>');
    t.notMatches(royalty.snap().hyp, /<b>Dividend:<\/b>/, 'royalty: no <b>Dividend:</b>');
    t.notMatches(royalty.snap().hyp, /<b>Hybrid cash:<\/b>/, 'royalty: no <b>Hybrid cash:</b>');

    const dividend = loadSim(); dividend.applyPreset('likely'); dividend.setModelMode('dividend');
    t.matches(dividend.snap().hyp, /<b>Dividend:<\/b>/, 'dividend: <b>Dividend:</b>');
    t.notMatches(dividend.snap().hyp, /<b>Royalty:<\/b>/, 'dividend: no <b>Royalty:</b>');
    t.notMatches(dividend.snap().hyp, /<b>Hybrid cash:<\/b>/, 'dividend: no <b>Hybrid cash:</b>');

    const hybrid = loadSim();   hybrid.applyPreset('likely');   hybrid.setModelMode('hybrid');
    const h = hybrid.snap().hyp;
    t.matches(h, /<b>Hybrid cash:<\/b>/, 'hybrid: <b>Hybrid cash:</b>');
    t.matches(h, /<b>Cap:<\/b>/,         'hybrid: <b>Cap:</b>');
    t.matches(h, /<b>By Y10:<\/b>/,      'hybrid: <b>By Y10:</b>');
    t.notMatches(h, /<b>Royalty:<\/b>/,  'hybrid: no <b>Royalty:</b>');
    t.notMatches(h, /<b>Dividend:<\/b>/, 'hybrid: no <b>Dividend:</b>');
  });

  // ─────────────────────────────────────────────────────────────────────
  // 9. eqT slider override per mode.
  // ─────────────────────────────────────────────────────────────────────
  t.describe('eqT effective value is overridden in dividend & hybrid, free in royalty', () => {
    // After bug-fix: the eqT *slider* is not written by calc() in dividend/hybrid mode
    // (preventing the cross-mode pollution leak). The override is local-only; the
    // displayed `eqTo` text reflects the effective value.
    const sim = loadSim();
    sim.applyPreset('likely');
    sim.setModelMode('royalty');
    sim.setValue('eqT', '12');
    sim.calc();
    t.eq(parseFloat(sim.getValue('eqT')), 12, 'royalty: eqT respects manual change');
    sim.setValue('eqT', '17');
    sim.calc();
    t.eq(parseFloat(sim.getValue('eqT')), 17, 'royalty: eqT respects 2nd manual change');
    t.eq(sim.getText('eqTo'), '17%', 'royalty: eqTo text matches slider');

    // Dividend: slider value preserved (=17), but eqTo text shows divOwn override.
    sim.setModelMode('dividend');
    const divOwn = parseFloat(sim.getValue('divOwn'));
    t.eq(parseFloat(sim.getValue('eqT')), 17, 'dividend: eqT slider preserved (no DOM write)');
    t.eq(sim.getText('eqTo'), divOwn + '%', 'dividend: eqTo text shows divOwn override');
    t.eq(divOwn, 25, 'likely preset divOwn=25');

    // Hybrid: slider still preserved, eqTo text shows hybUpfront override.
    sim.setModelMode('hybrid');
    const hybUpfront = parseFloat(sim.getValue('hybUpfront'));
    t.eq(parseFloat(sim.getValue('eqT')), 17, 'hybrid: eqT slider preserved (no DOM write)');
    t.eq(sim.getText('eqTo'), hybUpfront + '%', 'hybrid: eqTo text shows hybUpfront override');
    t.eq(hybUpfront, 30, 'likely preset hybUpfront=30');

    // Switch back to royalty: original 17 must still be there.
    sim.setModelMode('royalty');
    t.eq(parseFloat(sim.getValue('eqT')), 17, 'royalty: eqT slider unchanged after dividend/hybrid round trip');
  });

  // ─────────────────────────────────────────────────────────────────────
  // 10. m4 value parses to total = cumRoyalties[9] + eqRealized.
  // ─────────────────────────────────────────────────────────────────────
  t.describe('m4 value matches cumRoyalties[9] + eqRealized in every mode', () => {
    for (const mode of ALL_MODES) {
      const sim = loadSim();
      sim.applyPreset('likely');
      sim.setModelMode(mode);
      const s = sim.snap();
      // m4 format: "$<num>M (<roi>x)"
      const m = s.m4.match(/^\$(-?[\d.]+)M /);
      t.ok(!!m, `${mode}: m4 parses ($X.XM (Y.Yx)): ${s.m4}`);
      if (m) {
        const display = parseFloat(m[1]);
        const expected = s.cumRoyalties[9] + s.eqRealized;
        // m4 is rounded to 1 decimal; allow ±0.05 for that, plus small float slack.
        t.near(display, expected, 0.06, `${mode}: m4 display vs cumR[9]+eqRealized`);
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // 11. runScenario() must agree with calc() for the active preset+mode.
  //     This is the consistency check between the live sim and the
  //     scenario-comparison chart math.
  // ─────────────────────────────────────────────────────────────────────
  t.describe('runScenario(presetState.likely, ...) == calc() cumRoyalties[9]', () => {
    for (const mode of ALL_MODES) {
      const sim = loadSim();
      sim.applyPreset('likely');
      sim.setModelMode(mode);
      const s = sim.snap();
      const p = sim.presetState.likely;
      const r = sim.runScenario(p, divOptsFor(mode, p), hybOptsFor(mode, p));
      t.eq(r.cumRoyalties.length, 10, `${mode}: runScenario returns 10 yrs`);
      t.near(r.cumRoyalties[9], s.cumRoyalties[9], 0.2,
             `${mode}: runScenario cumR[9] == calc() cumR[9]`);
      // Also check Y5 — catches mode-specific timing bugs that average-correct at Y10.
      t.near(r.cumRoyalties[4], s.cumRoyalties[4], 0.2,
             `${mode}: runScenario cumR[4] == calc() cumR[4]`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // 12. Mode-switch round trip: Royalty → Dividend → Hybrid → Royalty.
  // ─────────────────────────────────────────────────────────────────────
  t.describe('round-trip mode switching restores Royalty output', () => {
    const sim = loadSim();
    sim.applyPreset('likely');
    sim.setModelMode('royalty');
    const before = sim.snap();

    sim.setModelMode('dividend');
    sim.setModelMode('hybrid');
    sim.setModelMode('royalty');
    const after = sim.snap();

    // Royalties are revenue-driven and don't depend on eqT, so they should match.
    t.eq(before.cumRoyalties, after.cumRoyalties,
         'royalty cumRoyalties matches before/after round trip');
    t.eq(before.annualRoyalties, after.annualRoyalties,
         'royalty annualRoyalties matches before/after round trip');
    t.eq(before.m1, after.m1, 'royalty m1 stable after round trip');
    t.eq(before.returnStructureTitle, after.returnStructureTitle,
         'royalty returnStructureTitle stable after round trip');

    // After fix: eqT is no longer written back to DOM during dividend/hybrid calc(),
    // so the slider's stored value (and therefore royalty's equity math) is preserved
    // across mode switches.
    t.eq(before.equityByYear, after.equityByYear,
         'royalty equityByYear stable across mode round trip (no eqT pollution)');
  });

  // ─────────────────────────────────────────────────────────────────────
  // 13. Hybrid does NOT reuse Dividend's avgRoyPerVenture closed-form.
  //     Switching from Dividend → Hybrid must recompute annual cash.
  // ─────────────────────────────────────────────────────────────────────
  t.describe('Hybrid annual cash differs from Dividend annual cash', () => {
    const sim = loadSim();
    sim.applyPreset('likely');
    sim.setModelMode('dividend');
    const div = sim.snap().annualRoyalties.slice();

    sim.setModelMode('hybrid');
    const hyb = sim.snap().annualRoyalties.slice();

    let anyDiff = false;
    for (let i = 0; i < 10; i++) {
      if (Math.abs(div[i] - hyb[i]) > 1e-6) { anyDiff = true; break; }
    }
    t.ok(anyDiff, 'dividend vs hybrid annualRoyalties must differ in ≥1 year');
    // Y1: hybrid is 0 (grace). Dividend Y1 is also 0 because marginRamp at
    // age=1 evaluates to 0^(1/3) = 0 (margin ramp), so divCash[0] = 0 too.
    // Test a later year (Y3) where dividend has ramped up.
    t.eq(hyb[0], 0, 'hybrid Y1 is 0 (grace)');
    t.ok(div[2] > 0, 'dividend Y3 > 0 (margin has ramped)');
    // And the values should differ at Y3 since they're modeled differently.
    t.ok(Math.abs(div[2] - hyb[2]) > 1e-6,
         'dividend Y3 differs from hybrid Y3 (different cash models)');
  });

  // ─────────────────────────────────────────────────────────────────────
  // 14. Sanity scaling: doubling invY does NOT double cumRoyalties
  //     (revenue is decoupled from spend) but DOES double cumInvestment
  //     when ssSubtract='no'.
  // ─────────────────────────────────────────────────────────────────────
  t.describe('doubling invY: cumRoyalties unchanged, cumInvestment doubles (ssSubtract=no)', () => {
    for (const mode of ['royalty', 'dividend']) {
      // Hybrid: cap is per-venture-investment-scaled, so cumRoyalties WILL change with invY.
      // We exclude it from this scaling check.
      const sim = loadSim();
      sim.applyPreset('likely');
      sim.setValue('ssSubtract', 'no');
      sim.setModelMode(mode);
      const before = sim.snap();

      const inv0 = parseFloat(sim.getValue('inv'));
      sim.setAndCalc({ inv: String(inv0 * 2) });
      const after = sim.snap();

      // Royalties driven by revenue, not investment — so they should not change.
      t.near(after.cumRoyalties[9], before.cumRoyalties[9], 0.2,
             `${mode}: cumRoyalties[9] unchanged when invY doubles`);
      // Investment scales linearly when ssSubtract='no'.
      t.near(after.cumInvestment[9], before.cumInvestment[9] * 2, 0.2,
             `${mode}: cumInvestment[9] doubles when invY doubles (ssSubtract=no)`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // 15. Survivors=0 zeros all cash and equity.
  // ─────────────────────────────────────────────────────────────────────
  t.describe('survR=0 → zero cash and zero equity in every mode', () => {
    for (const mode of ALL_MODES) {
      const sim = loadSim();
      sim.applyPreset('likely');
      sim.setModelMode(mode);
      sim.setAndCalc({ surv: '0' });
      const s = sim.snap();
      for (let i = 0; i < 10; i++) {
        t.eq(s.annualRoyalties[i], 0, `${mode}: annualRoyalties[${i}]=0 when survivors=0`);
        t.eq(s.equityByYear[i],    0, `${mode}: equityByYear[${i}]=0 when survivors=0`);
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // 16. yrs=1 → 1-cohort horizon, simulation still runs to Y10.
  // ─────────────────────────────────────────────────────────────────────
  t.describe('yrs=1: only 1 cohort created; cumRoyalties grows', () => {
    for (const mode of ALL_MODES) {
      const sim = loadSim();
      sim.applyPreset('likely');
      sim.setModelMode(mode);
      sim.setAndCalc({ yrs: '1' });
      const s = sim.snap();
      t.eq(s.cumRoyalties.length, 10, `${mode}: cumRoyalties still 10 long with yrs=1`);
      // active companies array should plateau after Y1: same 1*cohortSurv every year
      const ac1 = s.activeCompanies[0];
      const ac9 = s.activeCompanies[9];
      t.near(ac1, ac9, 1e-6, `${mode}: active companies plateau when yrs=1`);
      // cumRoyalties is nondecreasing, must end at least as large as Y1
      t.ge(s.cumRoyalties[9], s.cumRoyalties[0],
           `${mode}: cumRoyalties[9] ≥ cumRoyalties[0] with yrs=1`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // 17. Anti-dilution ordering: 'B' (least dilution) > 'A' > 'none'.
  // ─────────────────────────────────────────────────────────────────────
  t.describe('antiD ordering: B > A > none on equityByYear[9] in every mode', () => {
    for (const mode of ALL_MODES) {
      const eqByAntiD = {};
      for (const ad of ['none', 'A', 'B']) {
        const sim = loadSim();
        sim.applyPreset('likely');
        sim.setModelMode(mode);
        // antiD is a select; harness exposes setValue() then calc().
        sim.setAndCalc({ antiD: ad });
        eqByAntiD[ad] = sim.snap().equityByYear[9];
      }
      t.ok(eqByAntiD.B > eqByAntiD.A,
           `${mode}: equity(B)=${eqByAntiD.B} > equity(A)=${eqByAntiD.A}`);
      t.ok(eqByAntiD.A > eqByAntiD.none,
           `${mode}: equity(A)=${eqByAntiD.A} > equity(none)=${eqByAntiD.none}`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // 18. ssSubtract='net': cumInvestment[9] == invY*yrs - ssCumNet[9].
  // ─────────────────────────────────────────────────────────────────────
  t.describe('ssSubtract=net: cumInvestment[9] = invY*yrs - ssCumNet[9]', () => {
    for (const mode of ALL_MODES) {
      const sim = loadSim();
      sim.applyPreset('likely');
      sim.setValue('ssSubtract', 'net');
      sim.setModelMode(mode);
      const s = sim.snap();
      const invY = parseFloat(sim.getValue('inv'));
      const yrs  = parseInt(sim.getValue('yrs'), 10);
      const expected = Math.max(0, invY * yrs - s.ssCumNet[9]);
      t.near(s.cumInvestment[9], expected, 0.15,
             `${mode}: cumInvestment[9] = invY*yrs - ssCumNet[9]`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // 19. Hybrid m1 (peak) vs Dividend m1 (steady) — must produce sensible
  //     numbers when you tune them to roughly comparable cash.
  // ─────────────────────────────────────────────────────────────────────
  t.describe('Dividend vs Hybrid with comparable cash params: no crash, sensible numbers', () => {
    const sim = loadSim();
    sim.applyPreset('likely');
    // 25% × 60% × 25% = 3.75% effective payout to Thrive on revenue
    // Hybrid 22% × (40% + 7.5%) ≈ 10.45% — different by design (capped + delayed).
    sim.setModelMode('dividend');
    const divSnap = sim.snap();
    sim.setModelMode('hybrid');
    const hybSnap = sim.snap();

    t.allFinite(divSnap.annualRoyalties, 'dividend: annualRoyalties finite');
    t.allFinite(hybSnap.annualRoyalties, 'hybrid: annualRoyalties finite');
    // Hybrid m1 is the PEAK; dividend m1 is the steady state value (avgRoyPerVenture × survivors).
    t.matches(divSnap.m1, /^\$.*M\/yr$/, 'dividend m1 has $/yr format');
    t.matches(hybSnap.m1, /^\$.*M\/yr$/, 'hybrid m1 has $/yr format');
  });

  // ─────────────────────────────────────────────────────────────────────
  // 20. Two consecutive calc() calls with no DOM change → identical output.
  //     Determinism guard.
  // ─────────────────────────────────────────────────────────────────────
  t.describe('two consecutive calc() with no input change → identical state', () => {
    for (const mode of ALL_MODES) {
      const sim = loadSim();
      sim.applyPreset('likely');
      sim.setModelMode(mode);
      const a = sim.snap();
      sim.calc();
      const b = sim.snap();
      t.eq(a.cumRoyalties,    b.cumRoyalties,    `${mode}: cumRoyalties stable on recalc`);
      t.eq(a.equityByYear,    b.equityByYear,    `${mode}: equityByYear stable on recalc`);
      t.eq(a.annualRoyalties, b.annualRoyalties, `${mode}: annualRoyalties stable on recalc`);
      t.eq(a.m1, b.m1, `${mode}: m1 stable on recalc`);
      t.eq(a.m4, b.m4, `${mode}: m4 stable on recalc`);
    }
  });
}
