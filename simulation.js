const SEED_RANDOMS = [];
for (let i = 0; i < 200; i++) {
  let s = i * 2654435761 >>> 0;
  s = ((s >>> 16) ^ s) * 0x45d9f3b;
  s = ((s >>> 16) ^ s) * 0x45d9f3b;
  s = (s >>> 16) ^ s;
  SEED_RANDOMS.push((s & 0x7fffffff) / 0x7fffffff);
}

function boxMuller(i) {
  const u1 = SEED_RANDOMS[i * 2 % 200], u2 = SEED_RANDOMS[(i * 2 + 1) % 200];
  return Math.sqrt(-2 * Math.log(u1 + 0.001)) * Math.cos(2 * Math.PI * u2);
}

const ids = ['spY', 'yrs', 'surv', 'inv', 'medR', 'sig', 'matY', 'thresh', 'flatR', 'g1r', 'g2r', 'g3r', 'capR', 'capMax', 'eqT', 'eqO', 'dil', 'liq', 'exitV', 'exitMinY', 'exitMaxY', 'revMult', 'growthR', 'ssCost', 'ssPct', 'ssMarkup', 'divOwn', 'divMargin', 'divPayout'];

// Returns 0→1 ramp value for a venture of given age, over matY years
function rampFn(age, matY, mode) {
  const t = Math.min(age / matY, 1);
  if (mode === 'linear')  return t;
  if (mode === 'convex')  return t * t;
  if (mode === 'concave') return Math.sqrt(t);
  // S-curve (logistic), k=6 gives a nice shape, normalized to pass through (0,0) and (1,1)
  const k = 6;
  const s0 = 1 / (1 + Math.exp(-k * (0 - 0.5)));
  const s1 = 1 / (1 + Math.exp(-k * (1 - 0.5)));
  return (1 / (1 + Math.exp(-k * (t - 0.5))) - s0) / (s1 - s0);
}
const el = k => document.getElementById(k);
let c1, c2, c3, c4, dc1, dc2, cDiv, cDivMargin;
let chart1View = 'cumulative';
let _chart1Data = null;
let _eqAllTime = 0, _eqRealized = 0, _showAllEq = false;
let _cumRoyalties = [], _equityByYear = [], _cumInvestment = [], _invM = 0, _horizonYrs = 10;
let _annualRoyalties = [], _ssAnnualNetArr = [], _ssAnnualBilledArr = [], _ssCumNetArr = [], _ssCumBilledArr = [], _activeCompaniesArr = [];
let modelMode = 'royalty';

function updateEqCards() {
  const eq10    = _showAllEq ? _eqAllTime  : _eqRealized;
  // For yr5 and yr10, scale allTime equity proportionally to how much has realized by then
  const eq5     = _showAllEq
    ? (_eqRealized > 0 ? _equityByYear[4] / _eqRealized * _eqAllTime : 0)
    : _equityByYear[4];
  const totalReturn = _cumRoyalties[_horizonYrs - 1] + eq10;
  const roi = _invM > 0 ? totalReturn / _invM : 0;

  el('m3').textContent = '$' + eq10.toFixed(1) + 'M';
  el('m4').textContent = '$' + totalReturn.toFixed(1) + 'M (' + roi.toFixed(1) + 'x)';
  el('m4').style.color = roi >= 1 ? 'var(--color-text-success)' : 'var(--color-text-danger)';
  netCard('m5', _cumRoyalties[4] + eq5, _cumInvestment[4]);
  netCard('m6', _cumRoyalties[_horizonYrs - 1] + eq10, _cumInvestment[_horizonYrs - 1]);
}

function toggleEqView() {
  _showAllEq = !_showAllEq;
  const toggle = el('m3toggle');
  const dot = toggle.firstElementChild;
  toggle.style.background = _showAllEq ? '#534AB7' : 'var(--color-border-secondary)';
  dot.style.transform = _showAllEq ? 'translateX(12px)' : 'translateX(0)';
  el('m3toggleLabel').textContent = _showAllEq ? 'All' : 'Yr 10';
  el('m3label').textContent = _showAllEq ? 'Total equity (all exits)' : 'Realized equity at yr 10';
  updateEqCards();
}

function openDistModal() {
  const modal = el('distModal');
  modal.style.display = 'flex';
  buildDistCharts();
}
function closeDistModal() {
  el('distModal').style.display = 'none';
}

function buildDistCharts() {
  const medR  = parseFloat(el('medR').value);
  const sigma = parseFloat(el('sig').value);
  const matY  = parseInt(el('matY').value);
  const mu    = Math.log(medR);

  // --- Chart 1: lognormal PDF curve ---
  // Sample 200 points across a reasonable revenue range
  const maxX = Math.exp(mu + 3 * sigma);
  const steps = 120;
  const xs = [], ys = [];
  for (let i = 1; i <= steps; i++) {
    const x = (maxX / steps) * i;
    const pdf = (1 / (x * sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-Math.pow(Math.log(x) - mu, 2) / (2 * sigma * sigma));
    xs.push('$' + (x < 10 ? x.toFixed(1) : Math.round(x)) + 'M');
    ys.push(Math.round(pdf * 10000) / 10000);
  }

  if (dc1) dc1.destroy();
  dc1 = new Chart(el('distChart1'), {
    type: 'line',
    data: { labels: xs, datasets: [{ data: ys, borderColor: '#534AB7', backgroundColor: 'rgba(83,74,183,0.12)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: v => v[0].label, label: v => 'Density: ' + v.raw } } },
      scales: {
        x: { ticks: { maxTicksLimit: 6, autoSkip: true }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { display: false }, grid: { display: false } }
      }
    }
  });

  // --- Chart 2: revenue ramp for median venture ---
  const rampMode  = el('rampMode').value;
  const growthR   = parseInt(el('growthR').value) / 100;
  const rampYears = Math.max(matY + 4, 10);
  const rampLabels = [], rampData = [];
  for (let y = 1; y <= rampYears; y++) {
    rampLabels.push('Yr ' + y);
    const r = rampFn(y, matY, rampMode);
    const postGrowth = y > matY ? Math.pow(1 + growthR, y - matY) : 1;
    rampData.push(Math.round(medR * r * postGrowth * 10) / 10);
  }

  if (dc2) dc2.destroy();
  dc2 = new Chart(el('distChart2'), {
    type: 'line',
    data: { labels: rampLabels, datasets: [
      { data: rampData, borderColor: '#1D9E75', backgroundColor: 'rgba(29,158,117,0.12)', fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2 },
      // Dotted reference at maturity level
      { data: Array(rampYears).fill(medR), borderColor: 'rgba(29,158,117,0.35)', borderDash: [4, 4], pointRadius: 0, borderWidth: 1.5, fill: false },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: v => '$' + v.raw + 'M ARR' } } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: v => '$' + v + 'M' } }
      }
    }
  });
}

const PRESETS = {
  bear: {
    spY:1, yrs:10, survR:60, invY:1, medR:3, sig:1.0, matY:6,
    royMode:'flat', thresh:500, flatR:3, g1r:3, g2r:5, g3r:7, capR:5, capMax:3,
    eqT:5, eqO:3, antiD:'none', dil:70, liq:5, exitV:20, exitMinY:8, exitMaxY:13, revMult:2, rampMode:'scurve', growthR:0,
  },
  likely: {
    spY:2, yrs:10, survR:80, invY:1, medR:4, sig:0.5, matY:5,
    royMode:'flat', thresh:500, flatR:5, g1r:3, g2r:5, g3r:7, capR:5, capMax:3,
    eqT:10, eqO:5, antiD:'A', dil:60, liq:10, exitV:30, exitMinY:7, exitMaxY:12, revMult:3, rampMode:'scurve', growthR:3,
  },
  bull: {
    spY:2, yrs:10, survR:80, invY:1, medR:7, sig:0.7, matY:4,
    royMode:'flat', thresh:500, flatR:7, g1r:3, g2r:5, g3r:7, capR:5, capMax:3,
    eqT:15, eqO:5, antiD:'B', dil:50, liq:20, exitV:50, exitMinY:6, exitMaxY:10, revMult:5, rampMode:'scurve', growthR:7,
  },
};

function runScenario(p, divOpts) {
  const spY = p.spY, yrs = p.yrs, survR = p.survR / 100, invY = p.invY;
  const medR = p.medR, sigma = p.sig, matY = p.matY;
  const mode = p.royMode, tM = p.thresh / 1000;
  const eqT = p.eqT / 100, dilP = p.dil / 100, liqP = p.liq / 100;
  const exitV = p.exitV, antiD = p.antiD;
  const SAMPLE_SIZE = 200, horizonYrs = 10;
  const totalV = spY * yrs;
  const survivors = Math.round(totalV * survR);
  const mu = Math.log(medR);

  const sampleRevenues = [];
  let sampleTotalRev = 0;
  for (let i = 0; i < SAMPLE_SIZE; i++) {
    const r = Math.exp(mu + sigma * boxMuller(i));
    sampleRevenues.push(r);
    sampleTotalRev += r;
  }
  const avgRevPerVenture = sampleTotalRev / SAMPLE_SIZE;

  let avgRoy;
  if (divOpts) {
    avgRoy = avgRevPerVenture * divOpts.margin * divOpts.payout * divOpts.ownership;
  } else {
    let sampleTotalRoy = 0;
    sampleRevenues.forEach(r => {
      if (r <= tM) return;
      const eligible = r - tM;
      if (mode === 'flat') { sampleTotalRoy += eligible * p.flatR / 100; return; }
      if (mode === 'grad') {
        const r1 = p.g1r / 100, r2 = p.g2r / 100, r3 = p.g3r / 100;
        const b1 = 2 - tM, b2 = 10 - tM;
        if (eligible <= b1) { sampleTotalRoy += eligible * r1; return; }
        let roy = b1 * r1;
        if (eligible <= b2) { sampleTotalRoy += roy + (eligible - b1) * r2; return; }
        sampleTotalRoy += roy + (b2 - b1) * r2 + (eligible - b2) * r3; return;
      }
      sampleTotalRoy += Math.min(eligible * p.capR / 100, p.capMax);
    });
    avgRoy = sampleTotalRoy / SAMPLE_SIZE;
  }

  let effEq = eqT;
  if (antiD === 'none')   effEq = eqT * (1 - dilP);
  else if (antiD === 'A') effEq = eqT * (1 - dilP * 0.5);
  else                    effEq = eqT * (1 - dilP * 0.25);

  const cohortSurvivors = survivors / yrs;
  const rampMode  = p.rampMode || 'scurve';
  const growthR   = (p.growthR || 0) / 100;
  const exitMinY  = p.exitMinY || 7;
  const exitMaxY  = p.exitMaxY || 12;
  const windowLen = exitMaxY - exitMinY + 1;
  const cumRoyalties = [], cumInvestment = [], equityByYear = [];
  let cumR = 0, cumExits = 0;

  for (let y = 1; y <= horizonYrs; y++) {
    let yRoy = 0, exitsThisYear = 0;
    for (let c = 1; c <= Math.min(y, yrs); c++) {
      const age = y - c + 1;
      const ramp = rampFn(age, matY, rampMode);
      const postGrowth = age > matY ? Math.pow(1 + growthR, age - matY) : 1;
      if (divOpts) {
        // margin ramps from 0 in year 1, reaching target at maturity (shifted by 1)
        const marginRamp = rampFn(age - 1, matY, rampMode);
        yRoy += avgRoy * cohortSurvivors * ramp * marginRamp * postGrowth;
      } else {
        yRoy += avgRoy * cohortSurvivors * ramp * postGrowth;
      }
      if (age >= exitMinY && age <= exitMaxY) exitsThisYear += cohortSurvivors * liqP / windowLen;
    }
    cumR += yRoy;
    cumExits += exitsThisYear;
    cumRoyalties.push(Math.round(cumR * 10) / 10);
    cumInvestment.push(Math.round(Math.min(y, yrs) * invY * 10) / 10);
    equityByYear.push(Math.round(cumExits * exitV * effEq * 10) / 10);
  }
  return { cumRoyalties, cumInvestment, equityByYear };
}

function applyPreset(name) {
  const p = PRESETS[name];
  const setV = (id, v) => { const e = el(id); if (e) e.value = v; };
  setV('spY', p.spY); setV('yrs', p.yrs); setV('surv', p.survR); setV('inv', p.invY);
  setV('medR', p.medR); setV('sig', p.sig); setV('matY', p.matY);
  setV('thresh', p.thresh); setV('flatR', p.flatR);
  setV('g1r', p.g1r); setV('g2r', p.g2r); setV('g3r', p.g3r);
  setV('capR', p.capR); setV('capMax', p.capMax);
  setV('eqT', p.eqT); setV('eqO', p.eqO);
  el('antiD').value = p.antiD;
  setV('dil', p.dil); setV('liq', p.liq); setV('exitV', p.exitV);
  setV('exitMinY', p.exitMinY || 7); setV('exitMaxY', p.exitMaxY || 12);
  setV('revMult', p.revMult);
  el('royMode').value = p.royMode;
  el('rampMode').value = p.rampMode || 'scurve';
  setV('growthR', p.growthR || 0);
  document.querySelectorAll('.preset-btn[data-preset]').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector('.preset-btn[data-preset="' + name + '"]');
  if (btn) btn.classList.add('active');
  calc();
}

function buildScenarioChart() {
  const divOpts = modelMode === 'dividend' ? {
    ownership: parseFloat(el('divOwn').value) / 100,
    margin:    parseFloat(el('divMargin').value) / 100,
    payout:    parseFloat(el('divPayout').value) / 100,
  } : null;
  const term = modelMode === 'royalty' ? 'royalty' : 'dividend';
  el('scenarioChartTitle').textContent = 'Scenario comparison — investment vs. ' + term;
  const bear   = runScenario(PRESETS.bear, divOpts);
  const likely = runScenario(PRESETS.likely, divOpts);
  const bull   = runScenario(PRESETS.bull, divOpts);
  const labels = Array.from({ length: 10 }, (_, i) => 'Yr ' + (i + 1));
  if (c3) c3.destroy();
  c3 = new Chart(el('chart3'), {
    type: 'line',
    data: { labels, datasets: [
      // Investment — single line, identical across scenarios ($1M/yr × 10yr)
      { data: likely.cumInvestment, borderColor: '#E24B4A', backgroundColor: 'rgba(226,75,74,0.06)', fill: true, tension: 0.3, pointRadius: 2, borderWidth: 2 },
      // Royalty spread: bear lower bound, bull fills back to it, likely solid on top
      { data: bear.cumRoyalties,   fill: false, borderColor: 'rgba(29,158,117,0.4)', borderDash: [4,4], pointRadius: 0, borderWidth: 1.5, tension: 0.3 },
      { data: bull.cumRoyalties,   fill: '-1',  backgroundColor: 'rgba(29,158,117,0.12)', borderColor: 'rgba(29,158,117,0.4)', borderDash: [4,4], pointRadius: 0, borderWidth: 1.5, tension: 0.3 },
      { data: likely.cumRoyalties, fill: false, borderColor: '#1D9E75', backgroundColor: 'transparent', tension: 0.3, pointRadius: 2, borderWidth: 2 },
    ]},
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + v + 'M' } }, x: { grid: { display: false } } } }
  });
  const termCap = term[0].toUpperCase() + term.slice(1);
  el('leg3').innerHTML = [
    ['#E24B4A', 'Cumulative investment'],
    ['rgba(29,158,117,0.4)', termCap + ' range (bear – bull)'],
    ['#1D9E75', 'Cumulative ' + term + ' (likely)'],
  ].map(([c, l]) => `<span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:2px;background:${c};"></span><span style="font-size:12px;color:var(--color-text-secondary);">${l}</span></span>`).join('');
}

function netCard(id, total, inv) {
  const net = total - inv;
  const mult = inv > 0 ? (total / inv).toFixed(1) + 'x' : '—';
  const v = el(id);
  v.textContent = (net >= 0 ? '+' : '') + '$' + net.toFixed(1) + 'M (' + mult + ')';
  v.style.color = net >= 0 ? 'var(--color-text-success)' : 'var(--color-text-danger)';
}

// Persist toggle state across recalcs (chart is destroyed/recreated each time)
const DATASETS = [
  { label: 'Cumulative investment',             color: '#E24B4A' },
  { label: 'Cumulative royalty',                color: '#1D9E75' },  // label updated dynamically
  { label: 'Realized equity (exits)',           color: '#534AB7' },
  { label: 'Unrealized equity (paper)',         color: '#0891B2' },
  { label: 'Total value (royalty + equity + SS net)', color: '#D97706' },
  { label: 'Shared services (total billed)',    color: '#9333EA' },
  { label: 'Shared services net to Thrive',     color: '#C026D3' },
];
const chartHidden = [false, false, false, true, true, true, true];

function renderLegend() {
  // Keep label[1] in sync with model mode
  DATASETS[1].label = modelMode === 'dividend' ? 'Cumulative dividend' : 'Cumulative royalty';

  if (chart1View === 'annual') {
    const items = [
      { color: '#1D9E75', label: modelMode === 'dividend' ? 'Annual dividend' : 'Annual royalty' },
      { color: '#534AB7', label: 'Realized equity (exits)' },
      { color: '#C026D3', label: 'Shared services net to Thrive' },
      { color: '#E24B4A', label: 'Annual investment' },
    ];
    el('leg1').innerHTML = items.map(d =>
      `<span style="display:flex;align-items:center;gap:6px;">
        <span style="width:10px;height:10px;border-radius:2px;flex-shrink:0;background:${d.color};"></span>
        <span style="font-size:12px;color:var(--color-text-secondary);">${d.label}</span>
      </span>`).join('');
    return;
  }

  el('leg1').innerHTML = DATASETS.map((d, i) => `
    <span data-idx="${i}" style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;opacity:${chartHidden[i] ? 0.35 : 1}">
      <span style="width:10px;height:10px;border-radius:2px;flex-shrink:0;background:${d.color};"></span>
      <span style="font-size:12px;color:var(--color-text-secondary);">${d.label}</span>
    </span>`).join('');
  el('leg1').querySelectorAll('[data-idx]').forEach(item => {
    item.addEventListener('click', () => {
      const i = parseInt(item.dataset.idx);
      chartHidden[i] = !chartHidden[i];
      if (c1) { c1.data.datasets[i].hidden = chartHidden[i]; c1.update(); }
      renderLegend();
    });
  });
}

function setChart1View(view) {
  chart1View = view;
  el('c1ViewCum').classList.toggle('active', view === 'cumulative');
  el('c1ViewAnn').classList.toggle('active', view === 'annual');
  renderChart1();
}

function renderChart1() {
  if (!_chart1Data) return;
  const { cumRoyalties, cumInvestment, equityByYear, unrealizedEqByYear, totalByYear,
          ssCumBilled, ssCumNet, annualRoyalties, ssAnnualNet, invY, yrs, horizonYrs } = _chart1Data;
  const labels = Array.from({ length: horizonYrs }, (_, i) => 'Yr ' + (i + 1));

  if (c1) c1.destroy();

  if (chart1View === 'cumulative') {
    c1 = new Chart(el('chart1'), {
      type: 'line',
      data: { labels, datasets: [
        { label: 'Cumulative investment',              data: cumInvestment,      borderColor: '#E24B4A', backgroundColor: 'rgba(226,75,74,0.08)',   fill: true, tension: 0.3, pointRadius: 3, hidden: chartHidden[0] },
        { label: DATASETS[1].label,                    data: cumRoyalties,       borderColor: '#1D9E75', backgroundColor: 'rgba(29,158,117,0.08)',  fill: true, tension: 0.3, pointRadius: 3, hidden: chartHidden[1] },
        { label: 'Realized equity (exits)',            data: equityByYear,       borderColor: '#534AB7', backgroundColor: 'rgba(83,74,183,0.08)',   fill: true, tension: 0.3, pointRadius: 3, borderDash: [5,4], hidden: chartHidden[2] },
        { label: 'Unrealized equity (paper)',          data: unrealizedEqByYear, borderColor: '#0891B2', backgroundColor: 'rgba(8,145,178,0.08)',   fill: true, tension: 0.3, pointRadius: 3, borderDash: [3,3], hidden: chartHidden[3] },
        { label: 'Total value (royalty + equity + SS net)', data: totalByYear,   borderColor: '#D97706', backgroundColor: 'rgba(217,119,6,0.08)',   fill: true, tension: 0.3, pointRadius: 3, hidden: chartHidden[4] },
        { label: 'Shared services (total billed)',     data: ssCumBilled,        borderColor: '#9333EA', backgroundColor: 'rgba(147,51,234,0.08)', fill: true, tension: 0.3, pointRadius: 3, borderDash: [4,3], hidden: chartHidden[5] },
        { label: 'Shared services net to Thrive',      data: ssCumNet,           borderColor: '#C026D3', backgroundColor: 'rgba(192,38,211,0.08)', fill: true, tension: 0.3, pointRadius: 3, borderDash: [2,3], hidden: chartHidden[6] },
      ]},
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + v + 'M' } }, x: { grid: { display: false } } } }
    });
  } else {
    // Per-year stacked bar view
    const annualEquity = equityByYear.map((v, i) => Math.round((i === 0 ? v : v - equityByYear[i - 1]) * 10) / 10);
    const annualInv    = Array.from({ length: horizonYrs }, (_, i) => i < yrs ? Math.round(invY * 10) / 10 : 0);

    // Custom plugin: draw active company count above each stacked bar
    const activeCoLabels = _activeCompaniesArr.slice(0, horizonYrs);
    const activeCompaniesPlugin = {
      id: 'activeCoLabels',
      afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        const barMeta = chart.getDatasetMeta(0);  // first stacked dataset drives bar positions
        ctx.save();
        ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = '#6b6b63';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        barMeta.data.forEach((bar, i) => {
          const raw = activeCoLabels[i] || 0;
          const lo = Math.floor(raw), hi = Math.ceil(raw);
          const label = lo === hi ? lo + ' co.' : lo + '–' + hi + ' co.';
          // find top of stack: min y across all bar datasets at this index
          let topY = bar.y;
          chart.data.datasets.forEach((ds, di) => {
            if (ds.stack === 'income') {
              const m = chart.getDatasetMeta(di);
              if (m.data[i]) topY = Math.min(topY, m.data[i].y);
            }
          });
          ctx.fillText(label, bar.x, topY - 4);
        });
        ctx.restore();
      }
    };

    c1 = new Chart(el('chart1'), {
      type: 'bar',
      data: { labels, datasets: [
        { label: DATASETS[1].label,                data: annualRoyalties, backgroundColor: '#1D9E75', borderRadius: 2, stack: 'income' },
        { label: 'Realized equity (exits)',         data: annualEquity,    backgroundColor: '#534AB7', borderRadius: 2, stack: 'income' },
        { label: 'Shared services net to Thrive',  data: ssAnnualNet,     backgroundColor: '#C026D3', borderRadius: 2, stack: 'income' },
        { label: 'Annual investment', type: 'line', data: annualInv,      borderColor: '#E24B4A', backgroundColor: 'transparent', pointRadius: 3, tension: 0.2, borderWidth: 2 },
      ]},
      plugins: [activeCompaniesPlugin],
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, stacked: true },
          y: { beginAtZero: true, stacked: true, ticks: { callback: v => '$' + v + 'M' } }
        }
      }
    });
  }
  renderLegend();
}

function royaltyForVenture(rev, mode) {
  const tM = parseFloat(el('thresh').value) / 1000;
  if (rev <= tM) return 0;
  const eligible = rev - tM;
  if (mode === 'flat') {
    return eligible * parseFloat(el('flatR').value) / 100;
  } else if (mode === 'grad') {
    const r1 = parseFloat(el('g1r').value) / 100;
    const r2 = parseFloat(el('g2r').value) / 100;
    const r3 = parseFloat(el('g3r').value) / 100;
    const b1 = 2 - tM, b2 = 10 - tM;
    if (eligible <= 0) return 0;
    let roy = 0;
    if (eligible <= b1) return eligible * r1;
    roy += b1 * r1;
    if (eligible <= b2) return roy + (eligible - b1) * r2;
    roy += (b2 - b1) * r2;
    roy += (eligible - b2) * r3;
    return roy;
  } else {
    return eligible * parseFloat(el('capR').value) / 100;
  }
}

function calc() {
  const spY    = parseFloat(el('spY').value);
  const yrs    = parseInt(el('yrs').value);
  const survR  = parseInt(el('surv').value) / 100;
  const invY   = parseFloat(el('inv').value);   // yearly investment
  const invM   = invY * yrs;                     // total investment
  const medR   = parseFloat(el('medR').value);
  const sigma  = parseFloat(el('sig').value);
  const matY   = parseInt(el('matY').value);
  const mode   = el('royMode').value;
  // In dividend mode, equity stake is the same as dividend ownership
  let eqT = parseInt(el('eqT').value) / 100;
  if (modelMode === 'dividend') {
    eqT = parseFloat(el('divOwn').value) / 100;
    el('eqT').value = Math.round(eqT * 100);
  }
  const eqO    = parseInt(el('eqO').value) / 100;
  const dilP   = parseInt(el('dil').value) / 100;
  const liqP   = parseInt(el('liq').value) / 100;
  const exitV  = parseFloat(el('exitV').value);
  const antiD    = el('antiD').value;
  const capMaxM  = parseFloat(el('capMax').value);
  const revMult  = parseFloat(el('revMult').value);
  const rampMode  = el('rampMode').value;
  const growthR   = parseInt(el('growthR').value) / 100;
  const exitMinY   = parseInt(el('exitMinY').value);
  const exitMaxY   = parseInt(el('exitMaxY').value);
  const windowLen  = Math.max(exitMaxY - exitMinY + 1, 1);
  const ssMode     = el('ssMode').value;
  const ssCost     = parseFloat(el('ssCost').value) / 1000;  // $K → $M
  const ssPct      = parseFloat(el('ssPct').value) / 100;
  const ssMarkup   = parseFloat(el('ssMarkup').value) / 100;
  const ssSubtract = el('ssSubtract').value;  // 'no' | 'net' | 'billed'

  // Update displayed values
  el('spYo').textContent   = spY % 1 === 0 ? spY : spY.toFixed(1);
  el('yrso').textContent   = yrs;
  el('survo').textContent  = Math.round(survR * 100) + '%';
  el('invo').textContent   = '$' + invY.toFixed(1) + 'M/yr';
  el('medRo').textContent  = '$' + medR.toFixed(1) + 'M';
  el('sigo').textContent   = sigma.toFixed(1);
  el('matYo').textContent  = matY;
  el('thresho').textContent = '$' + Math.round(parseFloat(el('thresh').value)) + 'K';
  el('flatRo').textContent = parseFloat(el('flatR').value) + '%';
  el('g1ro').textContent   = parseFloat(el('g1r').value) + '%';
  el('g2ro').textContent   = parseFloat(el('g2r').value) + '%';
  el('g3ro').textContent   = parseFloat(el('g3r').value) + '%';
  el('capRo').textContent  = parseFloat(el('capR').value) + '%';
  el('capMaxo').textContent = '$' + capMaxM.toFixed(1) + 'M';
  el('eqTo').textContent   = Math.round(eqT * 100) + '%';
  el('eqOo').textContent   = Math.round(eqO * 100) + '%';
  el('dilo').textContent   = Math.round(dilP * 100) + '%';
  el('liqo').textContent   = Math.round(liqP * 100) + '%';
  el('exitVo').textContent   = '$' + Math.round(exitV) + 'M (' + (exitV / medR).toFixed(1) + 'x rev)';
  el('revMulto').textContent = revMult.toFixed(1) + 'x';
  el('growthRo').textContent   = parseInt(el('growthR').value) + '%';
  el('exitMinYo').textContent  = exitMinY;
  el('exitMaxYo').textContent  = exitMaxY;
  el('ssCosto').textContent    = '$' + parseInt(el('ssCost').value) + 'K';
  el('ssPcto').textContent     = parseFloat(el('ssPct').value) + '%';
  el('ssMarkupo').textContent  = parseInt(el('ssMarkup').value) + '%';
  el('ssPctParams').style.opacity  = ssMode === 'pct'   ? 1 : 0.3;
  el('ssFixedParams').style.opacity = ssMode === 'fixed' ? 1 : 0.3;

  document.getElementById('flatParams').style.opacity = mode === 'flat' ? 1 : 0.3;
  document.getElementById('gradParams').style.opacity = mode === 'grad' ? 1 : 0.3;
  document.getElementById('capParams').style.opacity  = mode === 'cap'  ? 1 : 0.3;

  // Dividend slider display values
  el('divOwno').textContent    = parseFloat(el('divOwn').value) + '%';
  el('divMargino').textContent = parseFloat(el('divMargin').value) + '%';
  el('divPayouto').textContent = parseFloat(el('divPayout').value) + '%';

  // Update metric label names based on mode
  const term = modelMode === 'royalty' ? 'royalty' : 'dividend';
  el('m1label').textContent = 'Annual ' + term + ' income (steady state)';
  el('m2label').textContent = 'Cumulative ' + term + ' (10 yr)';
  el('m4label').textContent = 'Total return (' + term + ' + equity)';
  el('returnStructureTitle').textContent = modelMode === 'royalty' ? 'Royalty structure' : 'Dividend structure';

  // Simulation
  const totalV = spY * yrs;
  const survivors = Math.round(totalV * survR);
  const mu = Math.log(medR);

  // Use the full 200-sample pool to get a stable revenue distribution,
  // independent of the number of survivors. This ensures financial outputs
  // scale monotonically with yrs/survivors.
  const SAMPLE_SIZE = 200;
  const sampleRevenues = [];
  for (let i = 0; i < SAMPLE_SIZE; i++) {
    sampleRevenues.push(Math.round(Math.exp(mu + sigma * boxMuller(i)) * 100) / 100);
  }
  sampleRevenues.sort((a, b) => a - b);

  let sampleTotalRoy = 0, sampleTotalRev = 0;
  sampleRevenues.forEach(r => {
    let roy = modelMode === 'royalty' ? royaltyForVenture(r, mode) : 0;
    if (modelMode === 'royalty' && mode === 'cap') roy = Math.min(roy, capMaxM);
    sampleTotalRoy += roy;
    sampleTotalRev += r;
  });
  const avgRevPerVenture = sampleTotalRev / SAMPLE_SIZE;
  let avgRoyPerVenture;
  if (modelMode === 'royalty') {
    avgRoyPerVenture = sampleTotalRoy / SAMPLE_SIZE;
  } else {
    const divOwn    = parseFloat(el('divOwn').value) / 100;
    const divMargin = parseFloat(el('divMargin').value) / 100;
    const divPayout = parseFloat(el('divPayout').value) / 100;
    avgRoyPerVenture = avgRevPerVenture * divMargin * divPayout * divOwn;
  }
  const annualRoy = avgRoyPerVenture * survivors;

  // Revenue distribution — scale sample fractions to actual survivor count
  const bucketThresholds = [1, 3, 5, 10, 20, 50];
  const bucketLabels = ['<$1M', '$1-3M', '$3-5M', '$5-10M', '$10-20M', '$20-50M', '$50M+'];
  const bCounts = new Array(7).fill(0);
  sampleRevenues.forEach(r => {
    let b = bucketThresholds.findIndex(t => r < t);
    if (b === -1) b = 6;
    bCounts[b]++;
  });
  const scaledBCounts = bCounts.map(n => Math.round(n / SAMPLE_SIZE * survivors));
  const distParts = bCounts.map((n, i) => {
    const pct = Math.round(n / SAMPLE_SIZE * 100);
    return pct > 0 ? pct + '% ' + bucketLabels[i] : null;
  }).filter(Boolean);
  el('distDesc').textContent = 'Simulated: ' + distParts.join(', ');

  // Equity
  let effEq = eqT;
  if (antiD === 'none')     effEq = eqT * (1 - dilP);
  else if (antiD === 'A')   effEq = eqT * (1 - dilP * 0.5);
  else                      effEq = eqT * (1 - dilP * 0.25);

  const liqVentures = Math.round(totalV * liqP);
  const eqValue = liqVentures * exitV * effEq;

  // 10-year cumulative curves
  const horizonYrs = 10;
  const cumRoyalties = [], cumInvestment = [], equityByYear = [], unrealizedEqByYear = [], totalByYear = [];
  const cohortSurvivors = survivors / yrs;
  let cumR = 0, cumExits = 0, cumSS = 0, cumBilledTotal = 0;
  const ssAnnualBilled = [], ssAnnualNet = [], ssCumNet = [], ssCumBilled = [];
  const annualRoyalties = [], activeCompaniesArr = [];
  for (let y = 1; y <= horizonYrs; y++) {
    let yRoy = 0, portfolioVal = 0, exitsThisYear = 0;
    // Count active survivors this year (all cohorts created so far that survived)
    const activeCompanies = Math.min(y, yrs) * cohortSurvivors;
    activeCompaniesArr.push(Math.round(activeCompanies * 10) / 10);

    for (let c = 1; c <= Math.min(y, yrs); c++) {
      const age        = y - c + 1;
      const ramp       = rampFn(age, matY, rampMode);
      const postGrowth = age > matY ? Math.pow(1 + growthR, age - matY) : 1;
      if (modelMode === 'dividend') {
        // margin ramps from 0 in year 1, reaching target at maturity (shifted by 1)
        const marginRamp = rampFn(age - 1, matY, rampMode);
        yRoy += avgRoyPerVenture * cohortSurvivors * ramp * marginRamp * postGrowth;
      } else {
        yRoy += avgRoyPerVenture * cohortSurvivors * ramp * postGrowth;
      }
      portfolioVal += avgRevPerVenture * cohortSurvivors * ramp * postGrowth * revMult;
      if (age >= exitMinY && age <= exitMaxY) exitsThisYear += cohortSurvivors * liqP / windowLen;
    }
    cumR     += yRoy;
    cumExits += exitsThisYear;
    annualRoyalties.push(yRoy);

    // Shared services
    let ssCostY;
    if (ssMode === 'fixed') {
      ssCostY = activeCompanies * ssCost;
    } else {
      // % of each company's current revenue
      let totalRev = 0;
      for (let c = 1; c <= Math.min(y, yrs); c++) {
        const age = y - c + 1;
        const ramp = rampFn(age, matY, rampMode);
        const postGrowth = age > matY ? Math.pow(1 + growthR, age - matY) : 1;
        totalRev += avgRevPerVenture * cohortSurvivors * ramp * postGrowth;
      }
      ssCostY = totalRev * ssPct;
    }
    const ssBilledY = ssCostY * (1 + ssMarkup);
    const ssNetY    = ssCostY * ssMarkup;          // markup is Thrive's revenue
    cumSS += ssNetY;

    cumBilledTotal += ssBilledY;
    ssAnnualBilled.push(Math.round(ssBilledY * 100) / 100);
    ssAnnualNet.push(Math.round(ssNetY * 100) / 100);
    ssCumNet.push(Math.round(cumSS * 100) / 100);
    ssCumBilled.push(Math.round(cumBilledTotal * 100) / 100);

    const eqAtY           = Math.round(cumExits * exitV * effEq * 10) / 10;
    const unrealizedEqAtY = Math.round(portfolioVal * effEq * 10) / 10;
    const grossInv  = Math.min(y, yrs) * invY;
    const cumBilledY = ssAnnualBilled.reduce((a, b) => a + b, 0);  // sum so far (built incrementally)
    const deduct    = ssSubtract === 'net' ? cumSS : ssSubtract === 'billed' ? cumBilledY : 0;
    const cumI      = Math.max(0, Math.round((grossInv - deduct) * 10) / 10);

    cumRoyalties.push(Math.round(cumR * 10) / 10);
    cumInvestment.push(cumI);
    equityByYear.push(eqAtY);
    unrealizedEqByYear.push(unrealizedEqAtY);
    totalByYear.push(Math.round((cumR + eqAtY + cumSS) * 10) / 10);
  }

  _eqRealized        = equityByYear[horizonYrs - 1];
  _eqAllTime         = liqVentures * exitV * effEq;
  _cumRoyalties      = cumRoyalties;
  _equityByYear      = equityByYear;
  _cumInvestment     = cumInvestment;
  _invM              = invM;
  _horizonYrs        = horizonYrs;
  _annualRoyalties   = annualRoyalties;
  _ssAnnualNetArr    = ssAnnualNet;
  _ssAnnualBilledArr = ssAnnualBilled;
  _ssCumNetArr       = ssCumNet;
  _ssCumBilledArr    = ssCumBilled;
  _activeCompaniesArr = activeCompaniesArr;

  // Metrics
  el('m1').textContent = '$' + annualRoy.toFixed(1) + 'M/yr';
  el('m2').textContent = '$' + cumRoyalties[horizonYrs - 1].toFixed(1) + 'M';
  updateEqCards();

  // Shared services metrics
  const fmtM = v => v >= 1 ? '$' + v.toFixed(1) + 'M' : '$' + (v * 1000).toFixed(0) + 'K';
  el('ss1').textContent = fmtM(ssAnnualBilled[horizonYrs - 1]) + '/yr';
  el('ss2').textContent = fmtM(ssAnnualNet[horizonYrs - 1]) + '/yr';
  el('ss3').textContent = fmtM(ssCumNet[horizonYrs - 1]);

  // Hypotheses
  let returnDesc;
  if (modelMode === 'royalty') {
    const royDesc = mode === 'flat'
      ? parseFloat(el('flatR').value) + '% flat'
      : mode === 'grad'
      ? 'graduated (' + parseFloat(el('g1r').value) + '/' + parseFloat(el('g2r').value) + '/' + parseFloat(el('g3r').value) + '%)'
      : 'capped at $' + capMaxM.toFixed(1) + 'M';
    returnDesc = '<div class="hyp-item"><b>Royalty:</b> ' + royDesc + ', kicks in at $' + Math.round(parseFloat(el('thresh').value)) + 'K</div>';
  } else {
    returnDesc = '<div class="hyp-item"><b>Dividend:</b> ' + parseFloat(el('divOwn').value) + '% ownership · ' + parseFloat(el('divMargin').value) + '% margin at maturity (ramps with revenue) · ' + parseFloat(el('divPayout').value) + '% payout</div>';
  }

  let hyp = '';
  hyp += '<div class="hyp-item"><b>' + totalV + '</b> total ventures (' + spY + '/yr × ' + yrs + ' yrs)</div>';
  hyp += '<div class="hyp-item"><b>' + survivors + '</b> survive (' + Math.round(survR * 100) + '% survival rate)</div>';
  hyp += '<div class="hyp-item"><b>$' + invY.toFixed(1) + 'M/yr</b> → $' + invM.toFixed(1) + 'M total investment</div>';
  hyp += '<div class="hyp-item"><b>$' + medR.toFixed(1) + 'M</b> median mature revenue, spread ' + sigma.toFixed(1) + '</div>';
  hyp += '<div class="hyp-item"><b>' + matY + ' yrs</b> from spin-out to revenue maturity</div>';
  hyp += returnDesc;
  hyp += '<div class="hyp-item"><b>Equity:</b> ' + Math.round(eqT * 100) + '% Thrive + ' + Math.round(eqO * 100) + '% OTC, anti-dilution through ' + antiD + '</div>';
  hyp += '<div class="hyp-item"><b>' + Math.round(liqP * 100) + '%</b> of ventures exit between yr ' + exitMinY + '–' + exitMaxY + ' at ~$' + Math.round(exitV) + 'M avg</div>';
  el('hypBox').innerHTML = '<div style="font-size:14px;font-weight:500;margin:0 0 8px;color:var(--color-text-primary);">Current hypotheses</div>' + hyp;

  // Chart 1 — store data and render
  _chart1Data = { cumRoyalties, cumInvestment, equityByYear, unrealizedEqByYear, totalByYear,
                  ssCumBilled, ssCumNet, annualRoyalties, ssAnnualNet, invY, yrs, horizonYrs };
  renderChart1();

  // Chart 2 — revenue distribution
  if (c2) c2.destroy();
  c2 = new Chart(el('chart2'), {
    type: 'bar',
    data: { labels: bucketLabels, datasets: [{ data: scaledBCounts, backgroundColor: '#534AB7', borderRadius: 4, barPercentage: 0.6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1, callback: v => v + ' ventures' } }, x: { grid: { display: false }, ticks: { autoSkip: false } } } }
  });

  // Chart 4 — shared services P&L
  if (c4) c4.destroy();
  const labels4 = Array.from({ length: horizonYrs }, (_, i) => 'Yr ' + (i + 1));
  c4 = new Chart(el('chart4'), {
    type: 'bar',
    data: { labels: labels4, datasets: [
      { label: 'Billed to companies', data: ssAnnualBilled, backgroundColor: 'rgba(83,74,183,0.25)', borderColor: '#534AB7', borderWidth: 1.5, borderRadius: 3 },
      { label: 'Thrive net (markup)', data: ssAnnualNet,    backgroundColor: '#534AB7', borderRadius: 3 },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: v => v >= 1 ? '$' + v + 'M' : '$' + (v * 1000).toFixed(0) + 'K' } }
      }
    }
  });
  el('leg4').innerHTML = [
    ['rgba(83,74,183,0.5)', 'Billed to companies (cost + markup)'],
    ['#534AB7',             'Thrive net revenue (markup only)'],
  ].map(([c, l]) => `<span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:2px;background:${c};"></span><span style="font-size:12px;color:var(--color-text-secondary);">${l}</span></span>`).join('');

  buildScenarioChart();
  updateYearSnapshot();
  calcRunway();
}

function setModelMode(mode) {
  modelMode = mode;
  el('royaltyContent').style.display  = mode === 'royalty'  ? '' : 'none';
  el('dividendContent').style.display = mode === 'dividend' ? '' : 'none';
  el('modeRoyaltyBtn').classList.toggle('active', mode === 'royalty');
  el('modeDividendBtn').classList.toggle('active', mode === 'dividend');
  // Grey out Thrive equity row in dividend mode (linked to ownership slider)
  const eqTRow = el('eqTRow');
  if (eqTRow) {
    eqTRow.style.opacity = mode === 'dividend' ? 0.4 : 1;
    eqTRow.style.pointerEvents = mode === 'dividend' ? 'none' : '';
  }
  // Show ⓘ info button only in dividend mode
  const divInfoBtn = el('divInfoBtn');
  if (divInfoBtn) divInfoBtn.style.display = mode === 'dividend' ? '' : 'none';
  calc();
}

function openDividendModal() {
  el('divModal').style.display = 'flex';
  buildDividendChart();
}
function closeDividendModal() {
  el('divModal').style.display = 'none';
}

function buildDividendChart() {
  const medR     = parseFloat(el('medR').value);
  const matY     = parseInt(el('matY').value);
  const rampMode = el('rampMode').value;
  const growthR  = parseInt(el('growthR').value) / 100;
  const divOwn   = parseFloat(el('divOwn').value) / 100;
  const divMargin = parseFloat(el('divMargin').value) / 100;
  const divPayout = parseFloat(el('divPayout').value) / 100;

  const labels = [], data = [], marginData = [];
  for (let age = 1; age <= 10; age++) {
    labels.push('Yr ' + age);
    const ramp = rampFn(age, matY, rampMode);
    const marginRamp = rampFn(age - 1, matY, rampMode);  // starts at 0 in year 1
    const postGrowth = age > matY ? Math.pow(1 + growthR, age - matY) : 1;
    const dividend = medR * ramp * postGrowth * (divMargin * marginRamp) * divPayout * divOwn;
    data.push(Math.round(dividend * 1000) / 1000);
    marginData.push(Math.round(divMargin * marginRamp * postGrowth * 1000) / 10);  // in %
  }

  const ctx = el('divChart');
  if (cDiv) cDiv.destroy();
  cDiv = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: '#534AB7', borderRadius: 4, barPercentage: 0.6 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: v => v >= 1 ? '$' + v.toFixed(2) + 'M' : '$' + (v * 1000).toFixed(0) + 'K' } }
      }
    }
  });

  const ctxM = el('divMarginChart');
  if (cDivMargin) cDivMargin.destroy();
  cDivMargin = new Chart(ctxM, {
    type: 'line',
    data: { labels, datasets: [{
      data: marginData,
      borderColor: '#1D9E75',
      backgroundColor: 'rgba(29,158,117,0.08)',
      fill: true,
      tension: 0.3,
      pointRadius: 3,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: v => v + '%' } }
      }
    }
  });

  const fullDiv = (medR * divMargin * divPayout * divOwn * 1000).toFixed(0);
  el('divModalDesc').textContent =
    'At full maturity: $' + medR.toFixed(1) + 'M revenue × ' + Math.round(divMargin * 100) + '% margin × ' +
    Math.round(divPayout * 100) + '% payout × ' + Math.round(divOwn * 100) + '% ownership = $' + fullDiv + 'K/yr per company.';
}

function updateYearSnapshot() {
  if (!_cumRoyalties.length) return;
  const y = parseInt(el('yearSlider').value);
  el('yearSliderLabel').textContent = 'Year ' + y;
  const idx = y - 1;
  const fmtM = v => Math.abs(v) >= 1 ? '$' + v.toFixed(1) + 'M' : '$' + (v * 1000).toFixed(0) + 'K';

  const activeC  = _activeCompaniesArr[idx] || 0;
  const annualRoy = _annualRoyalties[idx] || 0;
  // Compute cumulative from raw annual arrays to avoid rounding divergence
  const cumRoy    = _annualRoyalties.slice(0, y).reduce((a, b) => a + b, 0);
  // SS net profit = markup revenue only (what Thrive keeps, not total billed to companies)
  const ssAnnNet    = _ssAnnualNetArr[idx] || 0;
  const ssAnnBilled = _ssAnnualBilledArr[idx] || 0;
  const ssCumNet    = _ssAnnualNetArr.slice(0, y).reduce((a, b) => a + b, 0);
  // Net annual burn = what comes out of the raise this year (positive = spending down reserves)
  const annualCost = idx < parseInt(el('yrs').value) ? parseFloat(el('inv').value) : 0;
  const netBurn    = annualCost - annualRoy - ssAnnNet;

  // Active companies: show as integer range (e.g. 1.6 → "1 – 2")
  const acLow = Math.floor(activeC), acHigh = Math.ceil(activeC);
  el('snapActiveC').textContent = acLow === acHigh ? acLow : acLow + ' – ' + acHigh;
  el('snapRoyLabel').textContent = modelMode === 'royalty' ? 'Annual royalty' : 'Annual dividend';
  el('snapAnnualRoy').innerHTML = fmtM(annualRoy) + '<div style="font-size:12px;font-weight:400;color:var(--color-text-secondary);margin-top:2px;">Cum: ' + fmtM(cumRoy) + '</div>';
  el('snapSSNet').innerHTML     = fmtM(ssAnnNet) + ' <span style="font-size:13px;font-weight:400;color:var(--color-text-secondary);">of ' + fmtM(ssAnnBilled) + ' billed</span>' + '<div style="font-size:12px;font-weight:400;color:var(--color-text-secondary);margin-top:2px;">Cum: ' + fmtM(ssCumNet) + '</div>';
  // Net burn: red when spending down reserves, green when self-sustaining this year
  const burnLabel = netBurn > 0 ? 'Net annual burn' : 'Annual surplus';
  el('snapBurnLabel').textContent = burnLabel;
  el('snapCumNet').textContent = netBurn > 0 ? fmtM(netBurn) : '+' + fmtM(-netBurn);
  el('snapCumNet').style.color = netBurn > 0 ? 'var(--color-text-danger)' : 'var(--color-text-success)';
}

function calcRunway() {
  if (!_cumRoyalties.length) return;
  const raise = parseFloat(el('raiseInput').value) || 5;
  const invY  = parseFloat(el('inv').value);
  const yrs   = parseInt(el('yrs').value);
  const fmtM  = v => Math.abs(v) >= 1 ? '$' + v.toFixed(1) + 'M' : '$' + (v * 1000).toFixed(0) + 'K';

  // Compute minimum raise needed: the maximum cumulative deficit across all years
  // (i.e. the worst-case cash shortfall if you started with $0)
  let runningBal = 0, minRaiseNeeded = 0;
  for (let y = 1; y <= 10; y++) {
    const annualOut = y <= yrs ? invY : 0;
    const annualIn  = (_annualRoyalties[y - 1] || 0) + (_ssAnnualNetArr[y - 1] || 0);
    runningBal = runningBal - annualOut + annualIn;
    minRaiseNeeded = Math.max(minRaiseNeeded, -runningBal);
  }
  const bufferMonths = parseInt(el('safetyBuffer').value) || 0;
  const bufferAmt = bufferMonths > 0 ? invY * (bufferMonths / 12) : 0;
  el('safetyBufferVal').textContent = bufferMonths > 0 ? '= ' + fmtM(bufferAmt) + ' set aside' : '';
  const minRaiseWithBuffer = minRaiseNeeded + bufferAmt;
  const effectiveRaise = raise - bufferAmt;
  const raiseCoversAll = raise >= minRaiseWithBuffer;
  el('runwayMinNeeded').textContent = fmtM(minRaiseWithBuffer);
  el('runwayMinNeeded').style.color = raiseCoversAll ? 'var(--color-text-success)' : 'var(--color-text-danger)';
  el('runwayEffective').textContent = bufferMonths > 0 ? '(' + fmtM(effectiveRaise) + ' effective)' : '';

  // Year-by-year cash balance: spend invY each year (while in investment period),
  // earn annual royalty/dividend + SS net profit back
  let balance = effectiveRaise;
  let actualRunway = 10;
  let survived = true;
  for (let y = 1; y <= 10; y++) {
    const annualOut = y <= yrs ? invY : 0;
    const annualIn  = (_annualRoyalties[y - 1] || 0) + (_ssAnnualNetArr[y - 1] || 0);
    balance = balance - annualOut + annualIn;
    if (balance < 0) {
      actualRunway = y - 1;
      survived = false;
      break;
    }
  }

  el('runwayYrs').textContent = survived ? '10+ yrs ✓' : (actualRunway + ' yr' + (actualRunway !== 1 ? 's' : ''));
  el('runwayYrs').style.color = survived ? 'var(--color-text-success)' : '#534AB7';

  const idx = Math.max(Math.min(actualRunway, 10) - 1, 0);
  // Active companies: show as integer range
  const acR = _activeCompaniesArr[idx] || 0;
  const acLow = Math.floor(acR), acHigh = Math.ceil(acR);
  el('runwayActiveC').textContent  = acLow === acHigh ? acLow : acLow + ' – ' + acHigh;
  el('runwayCumRoy').textContent   = fmtM(_cumRoyalties[idx] || 0);
  el('runwayAnnualRoy').textContent = fmtM(_annualRoyalties[idx] || 0) + '/yr';

  // Self-sustaining year: when annual income (royalty + SS net) ≥ annual investment spend
  // Interpolated to show fractional year (e.g. "Yr 3.4")
  let selfFundYear = null;
  for (let y = 1; y <= 10; y++) {
    const annualIncome = (_annualRoyalties[y - 1] || 0) + (_ssAnnualNetArr[y - 1] || 0);
    const annualCost = y <= yrs ? invY : 0;
    if (annualIncome >= annualCost) {
      if (y === 1) {
        selfFundYear = 1;
      } else {
        const prevIncome = (_annualRoyalties[y - 2] || 0) + (_ssAnnualNetArr[y - 2] || 0);
        const fraction = (annualCost - prevIncome) / (annualIncome - prevIncome);
        selfFundYear = (y - 1) + fraction;
      }
      break;
    }
  }
  const sfWithinRunway = selfFundYear !== null && selfFundYear <= actualRunway;
  el('runwaySelfFund').textContent = selfFundYear !== null ? 'Yr ' + selfFundYear.toFixed(1) : 'Beyond yr 10';
  el('runwaySelfFund').style.color = sfWithinRunway ? 'var(--color-text-success)' : 'var(--color-text-danger)';

  // Investment payback: year when cumulative return (royalty + equity + SS net) ≥ cumulative investment
  let crossover = null;
  for (let i = 0; i < _cumRoyalties.length; i++) {
    const inflow = (_cumRoyalties[i] || 0) + (_equityByYear[i] || 0) + (_ssCumNetArr[i] || 0);
    if (inflow >= (_cumInvestment[i] || Infinity)) { crossover = i + 1; break; }
  }
  const withinRunway = crossover !== null && crossover <= actualRunway;
  el('runwayCrossover').textContent = crossover !== null ? 'Yr ' + crossover : 'Beyond yr 10';
  el('runwayCrossover').style.color = withinRunway ? 'var(--color-text-success)' : 'var(--color-text-danger)';

  const term = modelMode === 'royalty' ? 'royalty' : 'dividend';
  el('runwayRoyLabel').textContent      = 'Cumulative ' + term + ' at end';
  el('runwayAnnualRoyLabel').textContent = 'Annual ' + term + ' run rate at end';
}

ids.forEach(id => { const e = el(id); if (e) e.addEventListener('input', calc); });
el('royMode').addEventListener('change', calc);
el('antiD').addEventListener('change', calc);
el('rampMode').addEventListener('change', calc);
el('ssMode').addEventListener('change', calc);
el('ssSubtract').addEventListener('change', calc);
el('raiseInput').addEventListener('input', calcRunway);
el('safetyBuffer').addEventListener('change', calcRunway);
el('distModal').addEventListener('click', e => { if (e.target === el('distModal')) closeDistModal(); });
applyPreset('likely');
