// Pit Wall: replays any 2026 F1 race from OpenF1 data packed by build_data.py (build_replays.py does the whole season).
// Part 1: every car on the track map at 60 fps, interpolated between the 4 Hz position frames.
// Part 2: the leaderboard (positions and gaps) and on-track overtakes, found by build_data.py.
const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const RACE = Q.get('race') || 'interlagos';
const SPEEDS = [1, 4, 16, 64];
const REC = Q.has('rec');   // recording mode: frames are drawn only by window.__render(t, clockMs), never by the browser's clock

const [meta, buf, season] = await Promise.all([
  fetch(`data/${RACE}.json`).then((r) => r.json()),
  fetch(`data/${RACE}.bin`).then((r) => r.arrayBuffer()),
  fetch('data/season.json', { cache: 'no-cache' }).then((r) => r.json()),
]);
// pick any 2026 race that has a replay (latest first)
$('pick').innerHTML = [...season.races].reverse().filter((r) => r.replay)
  .map((r) => `<option value="${r.replay}">R${r.round} · ${r.name.replace(' Grand Prix', ' GP')} · ${r.venue}</option>`).join('');
$('pick').value = RACE;
$('pick').onchange = () => { location.search = `?race=${$('pick').value}`; };
const XY = new Int16Array(buf), D = meta.drivers.length, HZ = meta.hz, DUR = meta.frames / HZ;
const idx = Object.fromEntries(meta.drivers.map((d, i) => [d.n, i]));
const drv = Object.fromEntries(meta.drivers.map((d) => [d.n, d]));
const PASSES = meta.overtakes || [];
$('race').innerHTML = `<b>${meta.name}</b> · ${meta.location} · replay`;
$('loading').remove();

// ---------- lookups at race time t (seconds from the start of the replay) ----------
const lastBefore = (arr, t, key = (r) => r[0]) => {           // binary search: last row with key <= t
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (key(arr[m]) <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
};
function orderAt(t) {
  const p = {};
  for (const [tt, n, pos] of meta.positions) { if (tt > t) break; p[n] = pos; }
  return meta.drivers.map((d) => d.n).sort((a, b) => (p[a] ?? 99) - (p[b] ?? 99));
}
const lapOf = (n, t) => { const ls = meta.lap_starts[n] || []; const i = lastBefore(ls, t, (r) => r[1]); return i < 0 ? 0 : ls[i][0]; };
const gapOf = (n, t) => { const g = (meta.gaps || {})[n] || []; const i = lastBefore(g, t); return i < 0 ? null : g[i]; };
const maxLap = Object.fromEntries(meta.drivers.map((d) => [d.n, Math.max(0, ...(meta.lap_starts[d.n] || []).map((r) => r[0]))]));
const lastLapT = Object.fromEntries(meta.drivers.map((d) => [d.n, Math.max(0, ...(meta.lap_starts[d.n] || []).map((r) => r[1]))]));
const isOut = (n, t) => maxLap[n] < meta.total_laps - 3 && t > lastLapT[n] + 150;
const inPit = (n, t) => (meta.pits || []).some(([pt, pn, , dur]) => pn === n && t >= pt - (dur || 20) && t <= pt + 6);

// ---------- map ----------
const cv = $('cv'), g = cv.getContext('2d');
let view = null, sel = null;
function fit() {
  const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  cv.width = r.width * dpr; cv.height = r.height * dpr;
  const xs = meta.track.map((p) => p[0]), ys = meta.track.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // turn the circuit 90° when it fits the panel better that way
  const rot = (x1 - x0 > y1 - y0) !== (r.width > r.height);
  const w = rot ? y1 - y0 : x1 - x0, h = rot ? x1 - x0 : y1 - y0, pad = Math.min(60, r.width / 9);
  const s = Math.min((r.width - 2 * pad) / w, (r.height - 2 * pad - 30) / h);
  view = { rot, s, dpr, cx: r.width / 2, cy: r.height / 2 - 12, mx: (x0 + x1) / 2, my: (y0 + y1) / 2 };
}
const P = (x, y) => {   // track coordinates -> css pixels (y up in the data, down on screen)
  let dx = x - view.mx, dy = y - view.my;
  if (view.rot) [dx, dy] = [-dy, dx];
  return [view.cx + dx * view.s, view.cy - dy * view.s];
};
addEventListener('resize', fit); fit();

function carXY(i, t) {
  const f = Math.max(0, Math.min(meta.frames - 1.001, t * HZ)), f0 = Math.floor(f), k = f - f0;
  const a = (f0 * D + i) * 2, b = ((f0 + 1) * D + i) * 2;
  return [XY[a] + (XY[b] - XY[a]) * k, XY[a + 1] + (XY[b + 1] - XY[a + 1]) * k];
}
const pick = (n) => { sel = sel === n ? null : n; Object.values(rows).forEach((r) => r.el.classList.toggle('sel', r.n === sel)); };
cv.addEventListener('click', (e) => {   // tap a car to follow it
  const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  let best = null, bd = 24;
  meta.drivers.forEach((d, i) => { const [px, py] = P(...carXY(i, t)); const dd = Math.hypot(px - mx, py - my); if (dd < bd) { bd = dd; best = d.n; } });
  if (best != null || sel != null) pick(best ?? sel);
});

// overtakes being shown: { n, other, pos, at (clock ms) }
const FLASH = 2600;
let shown = [];
function draw(t, order, clock) {
  const { dpr } = view; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
  g.lineJoin = g.lineCap = 'round';
  g.beginPath(); meta.track.forEach(([x, y], k) => { const [px, py] = P(x, y); k ? g.lineTo(px, py) : g.moveTo(px, py); }); g.closePath();
  g.strokeStyle = '#2A2E3B'; g.lineWidth = 18; g.stroke(); g.strokeStyle = '#3A3F50'; g.lineWidth = 2; g.stroke();
  const [sx, sy] = P(...meta.track[0]); g.fillStyle = '#fff'; g.fillRect(sx - 3, sy - 11, 6, 22);
  const lead = order[0];
  const cars = order.map((n) => { const i = idx[n]; const [px, py] = P(...carXY(i, t)); return { n, d: meta.drivers[i], px, py }; });
  const live = shown.filter((s) => clock - s.at < FLASH);
  // a ring grows out of each car in a fresh overtake: green for the passer, red for the car passed
  for (const s of live) {
    const k = (clock - s.at) / FLASH;
    for (const [n, col] of [[s.n, '34,197,94'], [s.other, '248,113,113']]) {
      const c = cars.find((x) => x.n === n); if (!c) continue;
      g.beginPath(); g.arc(c.px, c.py, 12 + 26 * Math.min(1, k * 2.2), 0, Math.PI * 2);
      g.strokeStyle = `rgba(${col},${(1 - k) * 0.95})`; g.lineWidth = 4; g.stroke();
    }
  }
  for (let k = cars.length - 1; k >= 0; k--) {             // back markers first, so the leader is drawn on top
    const { n, d, px, py } = cars[k];
    const big = n === sel || (sel == null && n === lead), dim = sel != null && n !== sel;
    g.globalAlpha = dim ? 0.35 : isOut(n, t) ? 0.25 : 1;
    g.beginPath(); g.arc(px, py, big ? 12 : 8.5, 0, Math.PI * 2); g.fillStyle = d.color; g.fill();
    g.lineWidth = 2.5; g.strokeStyle = big ? '#fff' : '#0B0C10'; g.stroke();
  }
  // names: the followed car, cars in a fresh overtake and the leader always, then everyone else in race order where the label has room
  const placed = [];
  const fits = (x, y, w) => placed.every((b) => x + w < b.x || x > b.x + b.w || y + 8 < b.y - 8 || y - 8 > b.y + 8);
  const hot = new Set(live.map((s) => s.n));
  const labelled = [...cars].sort((a, b) => (b.n === sel) - (a.n === sel) || hot.has(b.n) - hot.has(a.n) || order.indexOf(a.n) - order.indexOf(b.n));
  g.textBaseline = 'middle';
  for (const { n, d, px, py } of labelled) {
    const big = n === sel || (sel == null && n === lead), h = hot.has(n);
    g.font = `700 ${big || h ? 16 : 12}px "Titillium Web"`;
    const txt = h ? `${d.code} ▲P${live.find((s) => s.n === n).pos}` : d.code;
    const x = px + (big || h ? 16 : 11), y = py - (big || h ? 14 : 10), w = g.measureText(txt).width;
    if (!big && !h && !fits(x, y, w)) continue;
    g.globalAlpha = sel != null && n !== sel ? 0.35 : 1;
    if (h) { g.fillStyle = 'rgba(11,12,16,.85)'; g.fillRect(x - 4, y - 11, w + 8, 22); g.fillStyle = '#4ADE80'; } else g.fillStyle = '#fff';
    g.fillText(txt, x, y); placed.push({ x, y, w });
  }
  g.globalAlpha = 1;
}

// ---------- leaderboard ----------
const ROW = matchMedia('(max-width: 760px)').matches ? 28 : 32;
const rowsEl = $('rows'), rows = {};
for (const d of meta.drivers) {
  const el = document.createElement('div'); el.className = 'row';
  el.innerHTML = `<span class="p"></span><span class="bar" style="background:${d.color}"></span><span class="c">${d.code}</span><span class="m"></span><span class="g"></span>`;
  el.onclick = () => pick(d.n);
  rowsEl.appendChild(el); rows[d.n] = { el, n: d.n, y: null, from: 0, to: 0, at: -1e9, mark: null, markAt: -1e9 };
}
rowsEl.style.height = ROW * meta.drivers.length + 'px';
let gapMode = 'int';   // 'int' = gap to the car ahead, 'lead' = gap to the leader
$('gaphead').onclick = () => { gapMode = gapMode === 'int' ? 'lead' : 'int'; $('gaphead').textContent = gapMode === 'int' ? 'INTERVAL ⇄' : 'TO LEADER ⇄'; };
const fmtGap = (v) => v == null ? '' : typeof v === 'number' ? '+' + v.toFixed(3) : String(v).toUpperCase().replace(/^\+?/, '+');
const ease = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

function board(t, order, clock) {
  order.forEach((n, k) => {
    const r = rows[n], y = k * ROW;
    if (r.y == null) { r.from = r.to = r.y = y; }
    else if (y !== r.to) { r.from = r.y; r.to = y; r.at = clock; }
    r.y = r.from + (r.to - r.from) * ease((clock - r.at) / 600);
    r.el.style.transform = `translateY(${r.y}px)`;
    r.el.children[0].textContent = k + 1;
    const gp = gapOf(n, t), out = isOut(n, t);
    r.el.children[4].textContent = out ? 'OUT' : k === 0 ? 'LEADER' : inPit(n, t) ? 'PIT' : fmtGap(gp && gp[gapMode === 'int' ? 2 : 1]);
    const on = clock - r.markAt < FLASH ? r.mark : null;
    r.el.children[3].textContent = on === 'up' ? '▲' : on === 'down' ? '▼' : '';
    r.el.classList.toggle('up', on === 'up'); r.el.classList.toggle('down', on === 'down'); r.el.classList.toggle('out', out);
  });
  // keep the followed car's row in view when the board scrolls (laptop layout)
  const b = rowsEl.parentElement;
  if (sel != null && b.scrollHeight > b.clientHeight + 4) {
    const y = rows[sel].y + rowsEl.offsetTop, want = Math.max(0, Math.min(b.scrollHeight - b.clientHeight, y - b.clientHeight / 2));
    b.scrollTop += (want - b.scrollTop) * 0.2;
  }
}

// ---------- overtakes as the replay plays ----------
const passedBy = (t) => lastBefore(PASSES, t) + 1;   // how many overtakes have happened by time t
function overtakesBetween(a, b, clock) {             // fire the ones in (a, b]
  for (let i = passedBy(a); i < PASSES.length && PASSES[i][0] <= b; i++) {
    const [, n, other, pos, lap] = PASSES[i];
    shown.push({ n, other, pos, at: clock });
    Object.assign(rows[n], { mark: 'up', markAt: clock }); Object.assign(rows[other], { mark: 'down', markAt: clock });
    $('ticker').innerHTML = `<b>OVERTAKE</b> · ${drv[n].code} passes ${drv[other].code} for P${pos} · LAP ${lap}`;
    $('ticker').classList.add('on'); tickerAt = clock;
  }
  shown = shown.filter((s) => clock - s.at < FLASH);
}
let tickerAt = -1e9;

function hud(t, order, clock) {
  const lap = Math.min(meta.total_laps, Math.max(1, lapOf(order[0], t)));
  $('lap').innerHTML = `LAP ${lap} <small>/ ${meta.total_laps}</small>`;
  $('passes').innerHTML = `<b>${passedBy(t)}</b> overtakes`;
  if (clock - tickerAt > FLASH + 400) $('ticker').classList.remove('on');
  const s = Math.max(0, t);
  $('time').textContent = `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s) % 60).padStart(2, '0')}`;
}

// ---------- playback ----------
let t = 0, speed = 16, playing = false, lastNow = performance.now(), lastT = 0;
const sp = $('speeds');
for (const s of SPEEDS) {
  const b = document.createElement('button'); b.textContent = s + '×'; b.className = s === speed ? 'on' : '';
  b.onclick = () => { speed = s; [...sp.children].forEach((c) => c.classList.toggle('on', c === b)); }; sp.appendChild(b);
}
const setPlay = (p) => { playing = p; $('play').textContent = p ? '❚❚' : '▶'; };
$('play').onclick = () => setPlay(!playing);
addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); setPlay(!playing); } });
const jump = (to) => { t = to; lastT = to; shown = []; Object.values(rows).forEach((r) => { r.y = null; r.mark = null; }); $('ticker').classList.remove('on'); };
$('scrub').oninput = (e) => jump((e.target.value / 1000) * DUR);
// ?t=seconds&speed=16&play=1 starts somewhere specific (handy for recording); ?driver=44 follows a car
if (Q.get('t')) jump(+Q.get('t'));
if (Q.get('speed')) { speed = +Q.get('speed'); [...sp.children].forEach((c) => c.classList.toggle('on', c.textContent === speed + '×')); }
if (Q.get('driver')) pick(+Q.get('driver'));
if (Q.get('play')) setPlay(true);

let order = orderAt(t), lastBoard = -1;
function step(clock) {
  if (t < lastT) jump(t);
  overtakesBetween(lastT, t, clock); lastT = t;
  if (Math.abs(t - lastBoard) > 0.25 || !playing) { order = orderAt(t); lastBoard = t; $('scrub').value = (t / DUR) * 1000; }
  board(t, order, clock); hud(t, order, clock); draw(t, order, clock);
}
window.__render = (tt, clock) => { t = Math.max(0, Math.min(DUR, tt)); step(clock ?? performance.now()); };
window.__meta = meta;
function frame(now) {
  const dt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now;
  if (playing) { t = Math.min(DUR, t + dt * speed); if (t >= DUR) setPlay(false); }
  step(now);
  requestAnimationFrame(frame);
}
if (REC) step(0); else requestAnimationFrame(frame);
