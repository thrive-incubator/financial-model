// Tests for the preset state machine:
//   - PRESETS canonical defaults
//   - presetState (mutable per-preset live state)
//   - applyPreset(name)        — writes presetState[name] into DOM, sets activePreset, calls calc()
//   - snapshotPreset()         — reads DOM into presetState[activePreset]; called inside calc()
//   - resetPreset()            — restores presetState[activePreset] from PRESETS[activePreset], reapplies
//
// Adversarial focus: verify all 38+ keys round-trip, that PRESETS is never mutated,
// that per-preset isolation works (live tweaks survive a switch), and that
// monotonicity (bear < likely < bull) holds in all three model modes.
//
// Note on DOM-id ↔ preset-key mismatches we are testing through:
//   PRESETS.survR  → DOM id "surv"
//   PRESETS.invY   → DOM id "inv"
// applyPreset writes survR into surv; snapshotPreset reads surv back into survR.

import { loadSim } from './harness.mjs';

// All keys we expect every PRESET to define (both the simple ones and the
// hybrid block). 38 keys total — matches the full set of fields applyPreset
// handles + ssMode (which has a default in applyPreset but exists in PRESETS too).
const ALL_PRESET_KEYS = [
  'spY', 'yrs', 'survR', 'invY', 'medR', 'sig', 'matY',
  'royMode', 'thresh', 'flatR', 'g1r', 'g2r', 'g3r', 'capR', 'capMax',
  'eqT', 'eqO', 'antiD', 'dil', 'liq',
  'exitV', 'exitMinY', 'exitMaxY', 'revMult', 'rampMode', 'growthR',
  'ssMode', 'ssCost', 'ssPct', 'ssMarkup', 'ssSubtract',
  'divOwn', 'divMargin', 'divPayout',
  'hybUpfront', 'hybFC', 'hybRate', 'hybGrace',
  'hybCap1', 'hybCap2', 'hybCap3', 'hybExpY', 'hybTail',
];

// Mapping of preset key -> DOM input id when they differ. (applyPreset uses
// the DOM ids; snapshotPreset writes back to the preset keys.)
const KEY_TO_DOM_ID = {
  survR: 'surv',
  invY:  'inv',
};
const domIdFor = (k) => KEY_TO_DOM_ID[k] || k;

// Post-fix: `eqT` is no longer overridden in the DOM by dividend/hybrid mode,
// so it round-trips like any other numeric key. (The override is local to
// calc() and shown in the eqTo text label only.)
const SKIP_FOR_DOM_EQUALITY = new Set();

export default function (t) {
  // -------------------------------------------------------------------------
  // 1) Each preset has every expected key (no undefined)
  // -------------------------------------------------------------------------
  t.describe('PRESETS contains bear, likely, bull with all expected keys', () => {
    const sim = loadSim();
    const P = sim.PRESETS;
    t.ok(P && typeof P === 'object',                'PRESETS exists');
    t.ok(P.bear   && typeof P.bear   === 'object', 'PRESETS.bear exists');
    t.ok(P.likely && typeof P.likely === 'object', 'PRESETS.likely exists');
    t.ok(P.bull   && typeof P.bull   === 'object', 'PRESETS.bull exists');

    for (const presetName of ['bear', 'likely', 'bull']) {
      const preset = P[presetName];
      for (const key of ALL_PRESET_KEYS) {
        t.ok(preset[key] !== undefined,
          `PRESETS.${presetName}.${key} is defined (got ${JSON.stringify(preset[key])})`);
      }
    }
  });

  // -------------------------------------------------------------------------
  // 2) applyPreset writes every value back to the DOM (per preset)
  // -------------------------------------------------------------------------
  t.describe('applyPreset writes every preset value back to the DOM', () => {
    for (const presetName of ['bear', 'likely', 'bull']) {
      const sim = loadSim();
      const expected = sim.PRESETS[presetName];
      sim.applyPreset(presetName);

      for (const key of ALL_PRESET_KEYS) {
        if (SKIP_FOR_DOM_EQUALITY.has(key)) continue;
        const domVal = sim.getValue(domIdFor(key));
        const expVal = expected[key];

        // Strings (selects: royMode/antiD/rampMode/ssMode/ssSubtract): exact match.
        // Numbers: parse DOM string then compare.
        if (typeof expVal === 'string') {
          t.eq(domVal, expVal, `${presetName}.${key} → DOM "${domIdFor(key)}"`);
        } else {
          t.near(parseFloat(domVal), expVal, 1e-9,
            `${presetName}.${key} → DOM "${domIdFor(key)}" parsed`);
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // 2b) eqT effective override (post-fix). The `eqT` *slider* is no longer
  //     mutated by dividend/hybrid calc() — only the local computation and
  //     the `eqTo` text label reflect the override. So the slider keeps its
  //     royalty-mode value, and the override is visible in the eqTo text.
  // -------------------------------------------------------------------------
  t.describe('eqT slider is preserved across modes; eqTo text reflects override', () => {
    for (const presetName of ['bear', 'likely', 'bull']) {
      const sim = loadSim();
      sim.applyPreset(presetName);
      const presetEqT = sim.PRESETS[presetName].eqT;

      // Royalty: slider == PRESETS eqT, text == eqT
      sim.setModelMode('royalty');
      t.eq(parseFloat(sim.getValue('eqT')), presetEqT, `${presetName} royalty: slider == PRESETS.eqT (${presetEqT})`);
      t.eq(sim.getText('eqTo'), presetEqT + '%', `${presetName} royalty: eqTo text matches`);

      // Dividend: slider unchanged, eqTo shows divOwn override
      sim.setModelMode('dividend');
      const divOwn = sim.PRESETS[presetName].divOwn;
      t.eq(parseFloat(sim.getValue('eqT')), presetEqT, `${presetName} dividend: slider unchanged (${presetEqT})`);
      t.eq(sim.getText('eqTo'), divOwn + '%', `${presetName} dividend: eqTo text == divOwn (${divOwn})`);

      // Hybrid: slider unchanged, eqTo shows hybUpfront override
      sim.setModelMode('hybrid');
      const hybUpfront = sim.PRESETS[presetName].hybUpfront;
      t.eq(parseFloat(sim.getValue('eqT')), presetEqT, `${presetName} hybrid: slider unchanged (${presetEqT})`);
      t.eq(sim.getText('eqTo'), hybUpfront + '%', `${presetName} hybrid: eqTo text == hybUpfront (${hybUpfront})`);
    }
  });

  t.describe('presetState.eqT is preserved (no leak from dividend/hybrid modes)', () => {
    // Post-fix: presetState.eqT must equal PRESETS.eqT after boot, because
    // calc() no longer pollutes the eqT slider in dividend/hybrid mode.
    const sim = loadSim();   // boots into Likely+Dividend
    t.eq(sim.presetState.likely.eqT, sim.PRESETS.likely.eqT,
      'presetState.likely.eqT preserved after boot');
    // Round trip: applyPreset → switch modes → presetState should still match PRESETS
    for (const presetName of ['bear', 'likely', 'bull']) {
      const s = loadSim();
      s.applyPreset(presetName);
      s.setModelMode('hybrid');
      s.setModelMode('dividend');
      s.setModelMode('royalty');
      t.eq(s.presetState[presetName].eqT, s.PRESETS[presetName].eqT,
        `presetState.${presetName}.eqT preserved after mode round trip`);
    }
  });

  // -------------------------------------------------------------------------
  // 3) applyPreset → snapshotPreset round-trip preserves every numeric value
  // -------------------------------------------------------------------------
  t.describe('applyPreset → snapshotPreset (via calc) round-trips all numeric keys', () => {
    // Note: `eqT` is excluded because in dividend / hybrid mode calc() rewrites
    // the DOM eqT before snapshotPreset on the NEXT calc cycle picks it up.
    // The boot sequence is `applyPreset('likely')` → `setModelMode('dividend')`
    // which runs calc() twice — by the time loadSim() returns, presetState.likely.eqT
    // == PRESETS.likely.divOwn (25), not PRESETS.likely.eqT (10).
    for (const presetName of ['bear', 'likely', 'bull']) {
      const sim = loadSim();
      sim.applyPreset(presetName);              // applyPreset itself ends with calc() → snapshotPreset
      const snapped = sim.presetState[presetName];
      const original = sim.PRESETS[presetName];
      for (const key of ALL_PRESET_KEYS) {
        if (SKIP_FOR_DOM_EQUALITY.has(key)) continue;
        const orig    = original[key];
        const after   = snapped[key];
        if (typeof orig === 'string') {
          t.eq(after, orig, `${presetName}.${key} (string) round-trip`);
        } else {
          // After type-coercion through parseFloat/parseInt, values should be
          // numerically equal but might be slightly transformed (e.g. parseInt
          // truncates). For values that are integers in PRESETS we expect exact;
          // for floats we expect near-equal.
          t.near(after, orig, 1e-9,
            `${presetName}.${key} (numeric) round-trip: ${orig} → ${after}`);
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // 4) Per-preset isolation: edits to one preset persist after switching
  // -------------------------------------------------------------------------
  t.describe('per-preset live state: edits to bear survive a likely switch', () => {
    const sim = loadSim();
    sim.applyPreset('bear');
    sim.setAndCalc({ spY: 5 });                 // edit while on 'bear'
    t.eq(parseFloat(sim.getValue('spY')), 5, 'sanity: spY=5 in DOM after edit');
    sim.applyPreset('likely');                  // switch — likely should NOT be 5
    t.ok(parseFloat(sim.getValue('spY')) !== 5, 'likely.spY != 5 (different preset)');

    sim.applyPreset('bear');                    // switch back to bear
    t.eq(parseFloat(sim.getValue('spY')), 5,
      'bear.spY still 5 after round-trip through likely (live state retained)');
  });

  t.describe('per-preset live state: each preset is independent', () => {
    const sim = loadSim();
    // Tag each preset's live state with a different unique value
    sim.applyPreset('bear');   sim.setAndCalc({ medR: 7 });
    sim.applyPreset('likely'); sim.setAndCalc({ medR: 8 });
    sim.applyPreset('bull');   sim.setAndCalc({ medR: 9 });

    sim.applyPreset('bear');   t.eq(parseFloat(sim.getValue('medR')), 7, 'bear.medR=7');
    sim.applyPreset('likely'); t.eq(parseFloat(sim.getValue('medR')), 8, 'likely.medR=8');
    sim.applyPreset('bull');   t.eq(parseFloat(sim.getValue('medR')), 9, 'bull.medR=9');
  });

  // -------------------------------------------------------------------------
  // 5) resetPreset restores from PRESETS, undoing user edits
  // -------------------------------------------------------------------------
  t.describe('resetPreset undoes user edits on the active preset', () => {
    const sim = loadSim();
    sim.applyPreset('bear');
    const originalBear = sim.PRESETS.bear;
    sim.setAndCalc({ spY: 5, medR: 12 });
    t.eq(parseFloat(sim.getValue('spY')),  5,  'edit took: spY=5');
    t.eq(parseFloat(sim.getValue('medR')), 12, 'edit took: medR=12');

    sim.resetPreset();

    t.eq(parseFloat(sim.getValue('spY')),  originalBear.spY,
      `reset spY back to PRESETS.bear.spY (${originalBear.spY})`);
    t.eq(parseFloat(sim.getValue('medR')), originalBear.medR,
      `reset medR back to PRESETS.bear.medR (${originalBear.medR})`);
    // Untouched fields shouldn't have moved either
    t.eq(parseFloat(sim.getValue('matY')), originalBear.matY,
      'untouched matY unchanged after reset');
    t.eq(sim.getValue('royMode'), originalBear.royMode,
      'untouched royMode unchanged after reset');
  });

  t.describe('resetPreset only resets the active preset, not the others', () => {
    const sim = loadSim();
    sim.applyPreset('likely'); sim.setAndCalc({ spY: 4 });
    sim.applyPreset('bear');   sim.setAndCalc({ spY: 5 });

    // Reset bear — likely's edit must survive
    sim.resetPreset();   // bear is active
    t.eq(parseFloat(sim.getValue('spY')), sim.PRESETS.bear.spY,
      'bear.spY reset to PRESETS.bear.spY');

    sim.applyPreset('likely');
    t.eq(parseFloat(sim.getValue('spY')), 4,
      'likely.spY=4 retained — resetPreset did not bleed across presets');
  });

  // -------------------------------------------------------------------------
  // 6) PRESETS itself must never be mutated by any operation
  // -------------------------------------------------------------------------
  t.describe('PRESETS is never mutated across applyPreset/edit/reset cycles', () => {
    const sim = loadSim();
    // Deep-snapshot PRESETS as JSON (since values are primitives and
    // PRESETS uses string + number values only).
    const snapshotBefore = JSON.stringify(sim.PRESETS);

    sim.applyPreset('bear');
    sim.setAndCalc({ spY: 5, medR: 12, hybRate: 33 });
    sim.applyPreset('likely');
    sim.setAndCalc({ medR: 8 });
    sim.resetPreset();
    sim.applyPreset('bull');
    sim.setAndCalc({ spY: 4 });
    sim.resetPreset();

    const snapshotAfter = JSON.stringify(sim.PRESETS);
    t.eq(snapshotAfter, snapshotBefore, 'PRESETS unchanged across operations');
  });

  t.describe('PRESETS and presetState are distinct objects', () => {
    const sim = loadSim();
    const before = sim.PRESETS.bear.spY;
    // Mutate the live state directly
    sim.presetState.bear.spY = 99;
    t.eq(sim.PRESETS.bear.spY, before,
      'mutating presetState.bear does NOT affect PRESETS.bear');
    t.eq(sim.presetState.bear.spY, 99, 'sanity: presetState mutation took');
  });

  // -------------------------------------------------------------------------
  // 7-9) Monotonicity bear < likely < bull on cum royalties at year 10
  // -------------------------------------------------------------------------
  function cumRoy9(mode, presetName) {
    const sim = loadSim();
    sim.applyPreset(presetName);
    sim.setModelMode(mode);
    return sim.snap().cumRoyalties[9];
  }

  t.describe('dividend mode: bear < likely < bull at Y10 cum royalties', () => {
    const bear   = cumRoy9('dividend', 'bear');
    const likely = cumRoy9('dividend', 'likely');
    const bull   = cumRoy9('dividend', 'bull');
    t.ok(bear < likely,   `bear (${bear.toFixed(2)}) < likely (${likely.toFixed(2)})`);
    t.ok(likely < bull,   `likely (${likely.toFixed(2)}) < bull (${bull.toFixed(2)})`);
    t.ok(bear < bull,     `bear < bull (transitivity sanity)`);
  });

  t.describe('royalty mode: bear < likely < bull at Y10 cum royalties', () => {
    const bear   = cumRoy9('royalty', 'bear');
    const likely = cumRoy9('royalty', 'likely');
    const bull   = cumRoy9('royalty', 'bull');
    t.ok(bear < likely,   `bear (${bear.toFixed(2)}) < likely (${likely.toFixed(2)})`);
    t.ok(likely < bull,   `likely (${likely.toFixed(2)}) < bull (${bull.toFixed(2)})`);
  });

  t.describe('hybrid mode: bear < likely < bull at Y10 cum royalties', () => {
    const bear   = cumRoy9('hybrid', 'bear');
    const likely = cumRoy9('hybrid', 'likely');
    const bull   = cumRoy9('hybrid', 'bull');
    // Hybrid has caps that might compress upside — test for the same monotonicity
    // we expect from the other modes, but flag if it fails (might be intentional).
    t.ok(bear < likely,
      `hybrid bear (${bear.toFixed(2)}) < likely (${likely.toFixed(2)}) — if FAIL: cap mechanic may compress`);
    t.ok(likely < bull,
      `hybrid likely (${likely.toFixed(2)}) < bull (${bull.toFixed(2)}) — if FAIL: cap mechanic may compress`);
  });

  // -------------------------------------------------------------------------
  // 10) Default boot: Likely + Dividend
  // -------------------------------------------------------------------------
  t.describe('default boot is applyPreset("likely") + setModelMode("dividend")', () => {
    const sim = loadSim();
    t.eq(sim.activePreset, 'likely', 'activePreset === "likely" after boot');
    t.eq(sim.modelMode,    'dividend', 'modelMode === "dividend" after boot');
    // Snap is populated (calc() ran during boot) — proves the boot did include calc.
    const snap = sim.snap();
    t.eq(snap.cumRoyalties.length, 10, 'cumRoyalties has 10 entries after boot');
  });

  // -------------------------------------------------------------------------
  // 11) snapshotPreset captures hybrid params after a setAndCalc
  // -------------------------------------------------------------------------
  t.describe('snapshotPreset captures hybrid params after setAndCalc', () => {
    const sim = loadSim();
    sim.applyPreset('likely');
    sim.setAndCalc({ hybRate: '33', hybGrace: '6', hybUpfront: '40', hybTail: '15' });

    t.eq(sim.presetState.likely.hybRate,    33, 'presetState.likely.hybRate = 33');
    t.eq(sim.presetState.likely.hybGrace,   6,  'presetState.likely.hybGrace = 6');
    t.eq(sim.presetState.likely.hybUpfront, 40, 'presetState.likely.hybUpfront = 40');
    t.eq(sim.presetState.likely.hybTail,    15, 'presetState.likely.hybTail = 15');
  });

  // -------------------------------------------------------------------------
  // 12) applyPreset switches activePreset
  // -------------------------------------------------------------------------
  t.describe('applyPreset switches the activePreset state correctly', () => {
    const sim = loadSim();
    sim.applyPreset('bear');   t.eq(sim.activePreset, 'bear',   'activePreset=bear');
    sim.applyPreset('likely'); t.eq(sim.activePreset, 'likely', 'activePreset=likely');
    sim.applyPreset('bull');   t.eq(sim.activePreset, 'bull',   'activePreset=bull');
    sim.applyPreset('bear');   t.eq(sim.activePreset, 'bear',   'activePreset=bear (cycle)');
  });

  // -------------------------------------------------------------------------
  // 13) applyPreset triggers calc() automatically (no explicit calc needed)
  // -------------------------------------------------------------------------
  t.describe('applyPreset auto-calls calc() — snap populated without explicit calc', () => {
    const sim = loadSim();                 // boots into Likely/Dividend
    sim.applyPreset('bull');               // no explicit calc()
    const snap = sim.snap();
    t.eq(snap.cumRoyalties.length,  10, 'cumRoyalties length is 10');
    t.eq(snap.equityByYear.length,  10, 'equityByYear length is 10');
    t.eq(snap.cumInvestment.length, 10, 'cumInvestment length is 10');
    t.allFinite(snap.cumRoyalties,  'cumRoyalties all finite');
    t.allFinite(snap.equityByYear,  'equityByYear all finite');
  });

  // -------------------------------------------------------------------------
  // 14) Hybrid defaults sit inside the slider min/max from index.html
  //     hybUpfront [10,50], hybFC [0,20], hybRate [5,40], hybGrace [0,36]
  //     hybCap1 [1,3],  hybCap2 [1,4],  hybCap3 [1,6]
  //     hybExpY [5,12], hybTail [0,20]
  // -------------------------------------------------------------------------
  t.describe('hybrid defaults sit inside the slider min/max bounds', () => {
    const sim = loadSim();
    for (const presetName of ['bear', 'likely', 'bull']) {
      const p = sim.PRESETS[presetName];
      t.between(p.hybUpfront, 10, 50, `${presetName}.hybUpfront ∈ [10,50]`);
      t.between(p.hybFC,       0, 20, `${presetName}.hybFC      ∈ [0,20]`);
      t.between(p.hybRate,     5, 40, `${presetName}.hybRate    ∈ [5,40]`);
      t.between(p.hybGrace,    0, 36, `${presetName}.hybGrace   ∈ [0,36]`);
      t.between(p.hybCap1,     1,  3, `${presetName}.hybCap1    ∈ [1,3]`);
      t.between(p.hybCap2,     1,  4, `${presetName}.hybCap2    ∈ [1,4]`);
      t.between(p.hybCap3,     1,  6, `${presetName}.hybCap3    ∈ [1,6]`);
      t.between(p.hybExpY,     5, 12, `${presetName}.hybExpY    ∈ [5,12]`);
      t.between(p.hybTail,     0, 20, `${presetName}.hybTail    ∈ [0,20]`);
    }
  });

  // -------------------------------------------------------------------------
  // 15) Realistic equity ordering: bear < likely < bull at Y10 (dividend mode)
  // -------------------------------------------------------------------------
  t.describe('dividend mode: bear < likely < bull on equity at Y10', () => {
    function eq9(p) {
      const sim = loadSim();
      sim.applyPreset(p);
      sim.setModelMode('dividend');
      return sim.snap().equityByYear[9];
    }
    const bear = eq9('bear'), likely = eq9('likely'), bull = eq9('bull');
    t.ok(bear < likely,
      `bear equity (${bear.toFixed(2)}) < likely equity (${likely.toFixed(2)})`);
    t.ok(likely < bull,
      `likely equity (${likely.toFixed(2)}) < bull equity (${bull.toFixed(2)})`);
  });

  // -------------------------------------------------------------------------
  // 16) snapshotPreset is called inside calc() — verified by an indirect test:
  //     a setAndCalc against a non-default field changes presetState.
  // -------------------------------------------------------------------------
  t.describe('snapshotPreset() is invoked on every calc()', () => {
    const sim = loadSim();
    sim.applyPreset('bear');
    // Confirm baseline matches PRESETS.bear
    t.eq(sim.presetState.bear.spY, sim.PRESETS.bear.spY, 'baseline matches');

    // Set + recalc — calc()'s first line is snapshotPreset()
    sim.setAndCalc({ spY: 4.5 });
    t.eq(sim.presetState.bear.spY, 4.5, 'spY snapshotted to 4.5');

    // Original PRESETS.bear is untouched
    t.ok(sim.PRESETS.bear.spY !== 4.5,
      `PRESETS.bear.spY (${sim.PRESETS.bear.spY}) NOT mutated by setAndCalc`);
  });

  // -------------------------------------------------------------------------
  // 17) Reset after multiple presets edited — only the active preset's
  //     state goes back to PRESETS.
  // -------------------------------------------------------------------------
  t.describe('full lifecycle: apply, edit, switch, reset, switch back', () => {
    const sim = loadSim();
    const origBear   = { ...sim.PRESETS.bear };
    const origLikely = { ...sim.PRESETS.likely };

    // Edit bear
    sim.applyPreset('bear');
    sim.setAndCalc({ spY: 5, medR: 13 });
    // Edit likely
    sim.applyPreset('likely');
    sim.setAndCalc({ spY: 4, medR: 11 });

    // Reset likely (active)
    sim.resetPreset();
    t.eq(parseFloat(sim.getValue('spY')),  origLikely.spY,  'likely.spY reset');
    t.eq(parseFloat(sim.getValue('medR')), origLikely.medR, 'likely.medR reset');

    // Bear's edits should still be intact
    sim.applyPreset('bear');
    t.eq(parseFloat(sim.getValue('spY')),  5,  'bear.spY edit retained');
    t.eq(parseFloat(sim.getValue('medR')), 13, 'bear.medR edit retained');

    // Sanity: PRESETS still pristine
    t.eq(sim.PRESETS.bear.spY,   origBear.spY,   'PRESETS.bear.spY pristine');
    t.eq(sim.PRESETS.likely.spY, origLikely.spY, 'PRESETS.likely.spY pristine');
  });

  // -------------------------------------------------------------------------
  // 18) The 'royMode' preset string survives the round trip
  //     ("flat", "grad", or "cap")
  // -------------------------------------------------------------------------
  t.describe('royMode round-trips as a string', () => {
    for (const presetName of ['bear', 'likely', 'bull']) {
      const sim = loadSim();
      sim.applyPreset(presetName);
      const snap = sim.presetState[presetName];
      t.eq(snap.royMode, sim.PRESETS[presetName].royMode,
        `${presetName}.royMode round-trip`);
      t.ok(['flat', 'grad', 'cap'].includes(snap.royMode),
        `${presetName}.royMode is one of flat/grad/cap`);
    }
  });

  // -------------------------------------------------------------------------
  // 19) antiD round-trips — values are 'none' / 'A' / 'B'
  // -------------------------------------------------------------------------
  t.describe('antiD round-trips as a string with valid value', () => {
    for (const presetName of ['bear', 'likely', 'bull']) {
      const sim = loadSim();
      sim.applyPreset(presetName);
      const snap = sim.presetState[presetName];
      t.eq(snap.antiD, sim.PRESETS[presetName].antiD,
        `${presetName}.antiD round-trip`);
      t.ok(['none', 'A', 'B'].includes(snap.antiD),
        `${presetName}.antiD is one of none/A/B`);
    }
  });
}
