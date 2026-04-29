// Sanity test: harness boots, all three modes calc, snap shape is what tests expect.
import { loadSim, loadSimBooted } from './harness.mjs';

export default function (t) {
  t.describe('harness loads without throwing', () => {
    const sim = loadSim();
    t.ok(typeof sim.calc === 'function', 'calc exposed');
    t.ok(typeof sim.setModelMode === 'function', 'setModelMode exposed');
    t.ok(typeof sim.applyPreset === 'function', 'applyPreset exposed');
    t.ok(typeof sim.runScenario === 'function', 'runScenario exposed');
  });

  t.describe('default boot is Likely + Dividend with 10 years of data', () => {
    const sim = loadSimBooted();
    const s = sim.snap();
    t.eq(sim.modelMode, 'dividend', 'modelMode=dividend');
    t.eq(sim.activePreset, 'likely', 'activePreset=likely');
    t.eq(s.cumRoyalties.length, 10, 'cumRoyalties length');
    t.eq(s.equityByYear.length, 10, 'equityByYear length');
    t.eq(s.cumInvestment.length, 10, 'cumInvestment length');
    t.eq(s.activeCompanies.length, 10, 'activeCompanies length');
    t.allFinite(s.cumRoyalties, 'cumRoyalties all finite');
    t.allFinite(s.equityByYear, 'equityByYear all finite');
  });

  t.describe('all three modes run end-to-end', () => {
    for (const mode of ['royalty', 'dividend', 'hybrid']) {
      const sim = loadSim();
      sim.applyPreset('likely');
      sim.setModelMode(mode);
      const s = sim.snap();
      t.ok(s.cumRoyalties[9] >= 0, mode + ' cumRoyalties[9] nonneg');
      t.matches(s.m1, /^\$.*M\/yr$/, mode + ' m1 has $/yr format');
      t.matches(s.m4, /^\$.*M \(\d+(\.\d+)?x\)$/, mode + ' m4 has $X (Yx) format');
    }
  });
}
