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

const ids = ['spY', 'yrs', 'surv', 'inv', 'medR', 'sig', 'matY', 'thresh', 'flatR', 'g1r', 'g2r', 'g3r', 'capR', 'capMax', 'eqT', 'eqO', 'dil', 'liq', 'exitV', 'revMult'];
const el = k => document.getElementById(k);
let c1, c2, c3;

const PRESETS = {
  bear: {
    spY:1, yrs:10, survR:60, invY:1, medR:3, sig:1.0, matY:6,
    royMode:'flat', thresh:500, flatR:3, g1r:3, g2r:5, g3r:7, capR:5, capMax:3,
    eqT:5, eqO:3, antiD:'none', dil:70, liq:5, exitV:20, revMult:2,
  },
  likely: {
    spY:1.5, yrs:10, survR:70, invY:1, medR:5, sig:0.8, matY:4,
    royMode:'flat', thresh:500, flatR:5, g1r:3, g2r:5, g3r:7, capR:5, capMax:3,
    eqT:10, eqO:5, antiD:'A', dil:60, liq:10, exitV:30, revMult:3,
  },
  bull: {
    spY:2, yrs:10, survR:80, invY:1, medR:7, sig:0.7, matY:4,
    royMode:'flat', thresh:500, flatR:7, g1r:3, g2r:5, g3r:7, capR:5, capMax:3,
    eqT:15, eqO:5, antiD:'B', dil:50, liq:20, exitV:50, revMult:5,
  },
};

function runScenario(p) {
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
  for (let i = 0; i < SAMPLE_SIZE; i++) sampleRevenues.push(Math.exp(mu + sigma * boxMuller(i)));

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
  const avgRoy = sampleTotalRoy / SAMPLE_SIZE;

  let effEq = eqT;
  if (antiD === 'none')   effEq = eqT * (1 - dilP);
  else if (antiD === 'A') effEq = eqT * (1 - dilP * 0.5);
  else                    effEq = eqT * (1 - dilP * 0.25);

  const eqValue = Math.round(totalV * liqP) * exitV * effEq;
  const cohortSurvivors = survivors / yrs;
  const cumRoyalties = [], cumInvestment = [], equityByYear = [];
  let cumR = 0;

  for (let y = 1; y <= horizonYrs; y++) {
    let yRoy = 0;
    for (let c = 1; c <= Math.min(y, yrs); c++) yRoy += avgRoy * cohortSurvivors * Math.min((y - c + 1) / matY, 1);
    cumR += yRoy;
    const fullyMatureV = Math.min(Math.max(0, y - matY + 1), yrs) * spY;
    const eqAtY = totalV > 0 ? eqValue * (fullyMatureV / totalV) : 0;
    cumRoyalties.push(Math.round(cumR * 10) / 10);
    cumInvestment.push(Math.round(Math.min(y, yrs) * invY * 10) / 10);
    equityByYear.push(Math.round(eqAtY * 10) / 10);
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
  setV('dil', p.dil); setV('liq', p.liq); setV('exitV', p.exitV); setV('revMult', p.revMult);
  el('royMode').value = p.royMode;
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector('.preset-btn[data-preset="' + name + '"]');
  if (btn) btn.classList.add('active');
  calc();
}

function buildScenarioChart() {
  const bear   = runScenario(PRESETS.bear);
  const likely = runScenario(PRESETS.likely);
  const bull   = runScenario(PRESETS.bull);
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
  el('leg3').innerHTML = [
    ['#E24B4A', 'Cumulative investment'],
    ['rgba(29,158,117,0.4)', 'Royalty range (bear – bull)'],
    ['#1D9E75', 'Cumulative royalty (likely)'],
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
  { label: 'Cumulative investment',    color: '#E24B4A' },
  { label: 'Cumulative royalty',       color: '#1D9E75' },
  { label: 'Realized equity (exits)',  color: '#534AB7' },
  { label: 'Unrealized equity (paper)',color: '#0891B2' },
  { label: 'Total value',              color: '#D97706' },
];
const chartHidden = [false, false, false, true, true];

function renderLegend() {
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
  const eqT    = parseInt(el('eqT').value) / 100;
  const eqO    = parseInt(el('eqO').value) / 100;
  const dilP   = parseInt(el('dil').value) / 100;
  const liqP   = parseInt(el('liq').value) / 100;
  const exitV  = parseFloat(el('exitV').value);
  const antiD   = el('antiD').value;
  const capMaxM = parseFloat(el('capMax').value);
  const revMult = parseFloat(el('revMult').value);

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
  el('exitVo').textContent   = '$' + Math.round(exitV) + 'M';
  el('revMulto').textContent = revMult.toFixed(1) + 'x';

  document.getElementById('flatParams').style.opacity = mode === 'flat' ? 1 : 0.3;
  document.getElementById('gradParams').style.opacity = mode === 'grad' ? 1 : 0.3;
  document.getElementById('capParams').style.opacity  = mode === 'cap'  ? 1 : 0.3;

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
    let roy = royaltyForVenture(r, mode);
    if (mode === 'cap') roy = Math.min(roy, capMaxM);
    sampleTotalRoy += roy;
    sampleTotalRev += r;
  });
  const avgRoyPerVenture = sampleTotalRoy / SAMPLE_SIZE;
  const avgRevPerVenture = sampleTotalRev / SAMPLE_SIZE;
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
  let cumR = 0;
  for (let y = 1; y <= horizonYrs; y++) {
    const cumI = Math.min(y, yrs) * invY;

    // Royalty + unrealized equity: each cohort ramps linearly over matY years.
    // Use survivors/yrs per cohort so this stays in sync with annualRoy.
    const cohortSurvivors = survivors / yrs;
    let yRoy = 0, portfolioVal = 0;
    for (let c = 1; c <= Math.min(y, yrs); c++) {
      const age  = y - c + 1;
      const ramp = Math.min(age / matY, 1);
      yRoy        += avgRoyPerVenture * cohortSurvivors * ramp;
      portfolioVal += avgRevPerVenture * cohortSurvivors * ramp * revMult;
    }
    cumR += yRoy;
    const unrealizedEqAtY = Math.round(portfolioVal * effEq * 10) / 10;

    // Realized equity: grows as ventures cross the full maturity threshold
    const fullyMatureV = Math.min(Math.max(0, y - matY + 1), yrs) * spY;
    const eqAtY = totalV > 0 ? Math.round(eqValue * (fullyMatureV / totalV) * 10) / 10 : 0;

    cumRoyalties.push(Math.round(cumR * 10) / 10);
    cumInvestment.push(Math.round(cumI * 10) / 10);
    equityByYear.push(eqAtY);
    unrealizedEqByYear.push(unrealizedEqAtY);
    totalByYear.push(Math.round((cumR + unrealizedEqAtY) * 10) / 10);
  }

  const totalReturn = cumRoyalties[horizonYrs - 1] + eqValue;
  const roi = invM > 0 ? totalReturn / invM : 0;

  // Metrics
  el('m1').textContent = '$' + annualRoy.toFixed(1) + 'M/yr';
  el('m2').textContent = '$' + cumRoyalties[horizonYrs - 1].toFixed(1) + 'M';
  el('m3').textContent = '$' + eqValue.toFixed(1) + 'M';
  el('m4').textContent = '$' + totalReturn.toFixed(1) + 'M (' + roi.toFixed(1) + 'x)';
  el('m4').style.color = roi >= 1 ? 'var(--color-text-success)' : 'var(--color-text-danger)';
  netCard('m5', cumRoyalties[4] + equityByYear[4], cumInvestment[4]);
  netCard('m6', cumRoyalties[horizonYrs - 1] + equityByYear[horizonYrs - 1], cumInvestment[horizonYrs - 1]);

  // Hypotheses
  const royDesc = mode === 'flat'
    ? parseFloat(el('flatR').value) + '% flat'
    : mode === 'grad'
    ? 'graduated (' + parseFloat(el('g1r').value) + '/' + parseFloat(el('g2r').value) + '/' + parseFloat(el('g3r').value) + '%)'
    : 'capped at $' + capMaxM.toFixed(1) + 'M';

  let hyp = '';
  hyp += '<div class="hyp-item"><b>' + totalV + '</b> total ventures (' + spY + '/yr × ' + yrs + ' yrs)</div>';
  hyp += '<div class="hyp-item"><b>' + survivors + '</b> survive (' + Math.round(survR * 100) + '% survival rate)</div>';
  hyp += '<div class="hyp-item"><b>$' + invY.toFixed(1) + 'M/yr</b> → $' + invM.toFixed(1) + 'M total investment</div>';
  hyp += '<div class="hyp-item"><b>$' + medR.toFixed(1) + 'M</b> median mature revenue, spread ' + sigma.toFixed(1) + '</div>';
  hyp += '<div class="hyp-item"><b>' + matY + ' yrs</b> from spin-out to revenue maturity</div>';
  hyp += '<div class="hyp-item"><b>Royalty:</b> ' + royDesc + ', kicks in at $' + Math.round(parseFloat(el('thresh').value)) + 'K</div>';
  hyp += '<div class="hyp-item"><b>Equity:</b> ' + Math.round(eqT * 100) + '% Thrive + ' + Math.round(eqO * 100) + '% OTC, anti-dilution through ' + antiD + '</div>';
  hyp += '<div class="hyp-item"><b>' + Math.round(liqP * 100) + '%</b> of ventures reach a liquidity event at ~$' + Math.round(exitV) + 'M avg</div>';
  el('hypBox').innerHTML = '<div style="font-size:14px;font-weight:500;margin:0 0 8px;color:var(--color-text-primary);">Current hypotheses</div>' + hyp;

  // Chart 1 — cumulative flows
  if (c1) c1.destroy();
  const labels1 = Array.from({ length: horizonYrs }, (_, i) => 'Yr ' + (i + 1));
  c1 = new Chart(el('chart1'), {
    type: 'line',
    data: { labels: labels1, datasets: [
      { label: 'Cumulative investment',    data: cumInvestment,    borderColor: '#E24B4A', backgroundColor: 'rgba(226,75,74,0.08)',   fill: true, tension: 0.3, pointRadius: 3, hidden: chartHidden[0] },
      { label: 'Cumulative royalty',       data: cumRoyalties,     borderColor: '#1D9E75', backgroundColor: 'rgba(29,158,117,0.08)',  fill: true, tension: 0.3, pointRadius: 3, hidden: chartHidden[1] },
      { label: 'Realized equity (exits)',  data: equityByYear,     borderColor: '#534AB7', backgroundColor: 'rgba(83,74,183,0.08)',   fill: true, tension: 0.3, pointRadius: 3, borderDash: [5,4], hidden: chartHidden[2] },
      { label: 'Unrealized equity (paper)',data: unrealizedEqByYear,borderColor: '#0891B2', backgroundColor: 'rgba(8,145,178,0.08)',  fill: true, tension: 0.3, pointRadius: 3, borderDash: [3,3], hidden: chartHidden[3] },
      { label: 'Total incubator value',    data: totalByYear,      borderColor: '#D97706', backgroundColor: 'rgba(217,119,6,0.08)',   fill: true, tension: 0.3, pointRadius: 3, hidden: chartHidden[4] },
    ]},
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + v + 'M' } }, x: { grid: { display: false } } } }
  });
  renderLegend();

  // Chart 2 — revenue distribution
  if (c2) c2.destroy();
  c2 = new Chart(el('chart2'), {
    type: 'bar',
    data: { labels: bucketLabels, datasets: [{ data: scaledBCounts, backgroundColor: '#534AB7', borderRadius: 4, barPercentage: 0.6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1, callback: v => v + ' ventures' } }, x: { grid: { display: false }, ticks: { autoSkip: false } } } }
  });

  buildScenarioChart();
}

ids.forEach(id => el(id).addEventListener('input', calc));
el('royMode').addEventListener('change', calc);
el('antiD').addEventListener('change', calc);
calc();
