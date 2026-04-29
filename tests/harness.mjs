// Test harness for simulation.js.
// Loads simulation.js inside a stubbed DOM. Exposes a `loadSim()` factory that
// returns a fresh, isolated instance of the simulation API on each call so
// tests can be ordered freely without leaking state.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projDir   = path.resolve(__dirname, '..');

const simSrc  = fs.readFileSync(path.join(projDir, 'simulation.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(projDir, 'index.html'),    'utf8');

function readDefaultsFromHTML(html) {
  const defaults = {};
  for (const m of html.matchAll(/<input[^>]*\bid="([^"]+)"[^>]*\bvalue="([^"]*)"/g)) {
    defaults[m[1]] = m[2];
  }
  for (const m of html.matchAll(/<select[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const id = m[1], body = m[2];
    let val = '';
    const sel = body.match(/<option[^>]*\bvalue="([^"]*)"[^>]*\bselected\b/);
    if (sel) val = sel[1];
    else {
      const first = body.match(/<option[^>]*\bvalue="([^"]*)"/);
      if (first) val = first[1];
    }
    defaults[id] = val;
  }
  return defaults;
}

const HTML_DEFAULTS = readDefaultsFromHTML(htmlSrc);

export function defaultElementValues() { return { ...HTML_DEFAULTS }; }

export function loadSim() {
  const elemValues  = { ...HTML_DEFAULTS };
  const elemContent = {};
  const elemCache   = {};

  function makeEl(id) {
    const e = {
      id,
      get value() { return elemValues[id] ?? ''; },
      set value(v) { elemValues[id] = String(v); },
      style: { opacity: '', pointerEvents: '', display: '', background: '', transform: '' },
      classList: { toggle: () => {}, add: () => {}, remove: () => {}, contains: () => false },
      addEventListener: () => {},
      querySelectorAll: () => [],
      firstElementChild: { style: { transform: '', background: '' } },
      dataset: {},
    };
    Object.defineProperty(e, 'textContent', {
      get() { return elemContent[id] ?? ''; },
      set(v) { elemContent[id] = String(v); },
    });
    Object.defineProperty(e, 'innerHTML', {
      get() { return elemContent[id] ?? ''; },
      set(v) { elemContent[id] = String(v); },
    });
    return e;
  }

  const document = {
    getElementById(id) {
      if (!elemCache[id]) elemCache[id] = makeEl(id);
      return elemCache[id];
    },
    querySelectorAll: () => [],
    querySelector: () => null,
  };

  // Chart.js stub — track instantiations. Wrap in an object so the eval'd code
  // can append into it via the closure-friendly factory below.
  const chartCalls = [];
  function makeChartClass(sink) {
    return class {
      constructor(canvas, cfg) { sink.push({ canvas: canvas?.id || '?', type: cfg?.type, cfg }); }
      destroy() {}
      update() {}
    };
  }
  const Chart = makeChartClass(chartCalls);

  const fn = new Function('document', 'Chart', '__chartCalls', simSrc + `
    return {
      setModelMode, calc, applyPreset, snapshotPreset, resetPreset,
      runScenario, calcRunway, updateYearSnapshot, royaltyForVenture, rampFn, boxMuller,
      get modelMode() { return modelMode; },
      get presetState() { return presetState; },
      get PRESETS() { return PRESETS; },
      get activePreset() { return activePreset; },
      // Snapshot of all sim outputs
      snap: () => ({
        m1: document.getElementById('m1').textContent,
        m2: document.getElementById('m2').textContent,
        m3: document.getElementById('m3').textContent,
        m4: document.getElementById('m4').textContent,
        m5: document.getElementById('m5').textContent,
        m6: document.getElementById('m6').textContent,
        m1label: document.getElementById('m1label').textContent,
        m2label: document.getElementById('m2label').textContent,
        m4label: document.getElementById('m4label').textContent,
        returnStructureTitle: document.getElementById('returnStructureTitle').textContent,
        hyp: document.getElementById('hypBox').innerHTML,
        annualRoyalties:    _annualRoyalties.slice(),
        cumRoyalties:       _cumRoyalties.slice(),
        equityByYear:       _equityByYear.slice(),
        cumInvestment:      _cumInvestment.slice(),
        ssAnnualNet:        _ssAnnualNetArr.slice(),
        ssAnnualBilled:     _ssAnnualBilledArr.slice(),
        ssCumNet:           _ssCumNetArr.slice(),
        ssCumBilled:        _ssCumBilledArr.slice(),
        activeCompanies:    _activeCompaniesArr.slice(),
        invM:               _invM,
        eqAllTime:          _eqAllTime,
        eqRealized:         _eqRealized,
        horizonYrs:         _horizonYrs,
      }),
      // DOM accessors
      getValue: (id) => document.getElementById(id).value,
      setValue: (id, v) => { document.getElementById(id).value = v; },
      getText:  (id) => document.getElementById(id).textContent,
      // Set + recalc (saves a calc() call)
      setAndCalc: (overrides) => {
        for (const [id, v] of Object.entries(overrides)) {
          document.getElementById(id).value = v;
        }
        calc();
      },
      chartCalls: __chartCalls,
    };
  `);

  return fn(document, Chart, chartCalls);
}

// Convenience: load + boot to the same default state the page boots to (Likely + Dividend)
export function loadSimBooted() {
  const sim = loadSim();
  sim.applyPreset('likely');
  sim.setModelMode('dividend');
  return sim;
}

// Convenience: load + force into hybrid mode on Likely preset
export function loadSimHybrid() {
  const sim = loadSim();
  sim.applyPreset('likely');
  sim.setModelMode('hybrid');
  return sim;
}
