// Pit Wall: replays any 2026 F1 race from OpenF1 data packed by build_data.py (build_replays.py does the whole season).
// Every car is drawn on the track map at 60 fps, interpolated between the 4 Hz position frames.
const $ = (id) => document.getElementById(id);
const RACE = new URLSearchParams(location.search).get('race') || 'austin';
const SPEEDS = [1, 4, 16, 64];

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
$('race').innerHTML = `<b>${meta.name}</b> · ${meta.location} · replay`;
$('loading').remove();

// ---------- race order and lap at time t (seconds from the start of the replay) ----------
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

// ---------- map ----------
const cv = $('cv'), g = cv.getContext('2d');
let view = null, sel = null;
function fit() {
  const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  cv.width = r.width * dpr; cv.height = r.height * dpr;
  const xs = meta.track.map((p) => p[0]), ys = meta.track.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // turn the circuit 90° when it fits the screen better that way
  const rot = (x1 - x0 > y1 - y0) !== (r.width > r.height);
  const w = rot ? y1 - y0 : x1 - x0, h = rot ? x1 - x0 : y1 - y0, pad = 70;
  const s = Math.min((r.width - 2 * pad) / w, (r.height - 2 * pad) / h);
  view = { rot, s, dpr, cx: r.width / 2, cy: r.height / 2, mx: (x0 + x1) / 2, my: (y0 + y1) / 2 };
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
// tap a car to follow it
cv.addEventListener('click', (e) => {
  const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  let best = null, bd = 24;
  meta.drivers.forEach((d, i) => { const [px, py] = P(...carXY(i, t)); const dd = Math.hypot(px - mx, py - my); if (dd < bd) { bd = dd; best = d.n; } });
  sel = best === sel ? null : best;
});

function draw(t, order) {
  const { dpr } = view; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
  g.lineJoin = g.lineCap = 'round';
  g.beginPath(); meta.track.forEach(([x, y], k) => { const [px, py] = P(x, y); k ? g.lineTo(px, py) : g.moveTo(px, py); }); g.closePath();
  g.strokeStyle = '#2A2E3B'; g.lineWidth = 18; g.stroke(); g.strokeStyle = '#3A3F50'; g.lineWidth = 2; g.stroke();
  const [sx, sy] = P(...meta.track[0]); g.fillStyle = '#fff'; g.fillRect(sx - 3, sy - 11, 6, 22);
  const lead = order[0];
  const cars = order.map((n) => { const i = idx[n]; const [px, py] = P(...carXY(i, t)); return { n, d: meta.drivers[i], px, py }; });
  for (let k = cars.length - 1; k >= 0; k--) {             // back markers first, so the leader is drawn on top
    const { n, d, px, py } = cars[k];
    const big = n === sel || (sel == null && n === lead), dim = sel != null && n !== sel;
    g.globalAlpha = dim ? 0.35 : 1;
    g.beginPath(); g.arc(px, py, big ? 12 : 8.5, 0, Math.PI * 2); g.fillStyle = d.color; g.fill();
    g.lineWidth = 2.5; g.strokeStyle = big ? '#fff' : '#0B0C10'; g.stroke();
  }
  // names: the followed car and the leader always, then everyone else in race order where the label has room
  const placed = [];
  const fits = (x, y, w) => placed.every((b) => x + w < b.x || x > b.x + b.w || y + 8 < b.y - 8 || y - 8 > b.y + 8);
  const labelled = [...cars].sort((a, b) => (b.n === sel) - (a.n === sel) || order.indexOf(a.n) - order.indexOf(b.n));
  g.textBaseline = 'middle';
  for (const { n, d, px, py } of labelled) {
    const big = n === sel || (sel == null && n === lead);
    g.font = `700 ${big ? 16 : 12}px "Titillium Web"`;
    const x = px + (big ? 16 : 11), y = py - (big ? 14 : 10), w = g.measureText(d.code).width;
    if (!big && !fits(x, y, w)) continue;
    g.globalAlpha = sel != null && n !== sel ? 0.35 : 1; g.fillStyle = '#fff'; g.fillText(d.code, x, y);
    placed.push({ x, y, w });
  }
  g.globalAlpha = 1;
}

function hud(t, order) {
  const lap = Math.min(meta.total_laps, Math.max(1, lapOf(order[0], t)));
  $('lap').innerHTML = `LAP ${lap} <small>/ ${meta.total_laps}</small>`;
  const s = Math.max(0, t);
  $('time').textContent = `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s) % 60).padStart(2, '0')}`;
}

// ---------- playback ----------
let t = 0, speed = 16, playing = false, lastNow = performance.now(), lastHud = -1;
const sp = $('speeds');
for (const s of SPEEDS) {
  const b = document.createElement('button'); b.textContent = s + '×'; b.className = s === speed ? 'on' : '';
  b.onclick = () => { speed = s; [...sp.children].forEach((c) => c.classList.toggle('on', c === b)); }; sp.appendChild(b);
}
const setPlay = (p) => { playing = p; $('play').textContent = p ? '❚❚' : '▶'; };
$('play').onclick = () => setPlay(!playing);
addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); setPlay(!playing); } });
$('scrub').oninput = (e) => { t = (e.target.value / 1000) * DUR; };
// ?t=seconds&speed=16&play=1 starts somewhere specific (handy for recording)
const Q = new URLSearchParams(location.search);
if (Q.get('t')) t = +Q.get('t');
if (Q.get('speed')) { speed = +Q.get('speed'); [...sp.children].forEach((c) => c.classList.toggle('on', c.textContent === speed + '×')); }
if (Q.get('play')) setPlay(true);

let order = orderAt(t);
function frame(now) {
  const dt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now;
  if (playing) { t = Math.min(DUR, t + dt * speed); if (t >= DUR) setPlay(false); }
  if (Math.abs(t - lastHud) > 0.5 || !playing) { order = orderAt(t); hud(t, order); lastHud = t; $('scrub').value = (t / DUR) * 1000; }
  draw(t, order);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
