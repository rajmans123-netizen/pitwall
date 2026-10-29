// Pit Wall season timing: every lap of every driver in every 2026 race so far (data/season.json + data/timing/<slug>.json,
// packed by build_timing.py from OpenF1). Purple = the race's fastest lap, green = a driver's personal best,
// a dot = the tyre a stint started on, PIT = in/out laps. Tap a lap for its sectors.
const $ = (id) => document.getElementById(id);
const TYRE = { SOFT: '#E10600', MEDIUM: '#FACC15', HARD: '#F2F3F5', INTERMEDIATE: '#22C55E', WET: '#3B82F6' };
const fmt = (s) => s == null ? '' : s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}` : s.toFixed(3);
const fmtTotal = (s) => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${(s % 60).toFixed(3).padStart(6, '0')}`;

const season = await fetch('data/season.json').then((r) => r.json());
const races = [...season.races].reverse();                                  // latest first
const want = new URLSearchParams(location.search).get('race') || races[0].slug;
$('race').innerHTML = races.map((r) => `<option value="${r.slug}">R${r.round} · ${r.name.replace(" Grand Prix", " GP")}${r.venue ? " · " + r.venue : ""}</option>`).join('');
$('race').value = races.some((r) => r.slug === want) ? want : races[0].slug;
$('race').onchange = () => { history.replaceState(null, '', `?race=${$('race').value}`); load($('race').value); };
$('loading').remove();

let sel = null;
async function load(slug) {
  const r = await fetch(`data/timing/${slug}.json`).then((x) => x.json());
  $('replayTab').href = r.replay ? `index.html?race=${r.replay}` : 'index.html';
  const win = r.drivers[0], fl = r.drivers.find((d) => d.n === r.fastest.n);
  $('summary').innerHTML = `<h1>${r.name}</h1>
    <div><div class="k">Date</div><div class="v">${new Date(r.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</div></div>
    <div><div class="k">Winner</div><div class="v">${win.name}</div></div>
    <div><div class="k">Fastest lap</div><div class="v p">${fl.code} · ${fmt(r.fastest.time)} (L${r.fastest.lap})</div></div>
    ${r.partial ? '<div class="legend" style="color:var(--yellow)">OpenF1 only has some of this race\'s laps</div>' : ''}
    <div class="legend"><span><i class="sw" style="background:var(--purple)"></i>fastest lap</span><span><i class="sw" style="background:var(--green)"></i>personal best</span>
      ${Object.entries(TYRE).map(([k, c]) => `<span><i class="sw" style="background:${c};border-radius:50%"></i>${k[0]}</span>`).join('')}<span>PIT = in/out lap</span></div>`;
  const L = r.total_laps;
  let h = `<thead><tr><th class="st c0">POS</th><th class="st c1">DRIVER</th><th class="st c2">TIME / GAP</th><th>BEST</th>`;
  for (let i = 1; i <= L; i++) h += `<th>L${i}</th>`;
  h += '</tr></thead><tbody>';
  for (const d of r.drivers) {
    const best = d.best ? fmt(d.best.time) : '';
    h += `<tr data-n="${d.n}"><td class="st c0 pos">${d.pos ?? '–'}</td><td class="st c1 drv"><b style="background:${d.color}"></b>${d.code}</td>
      <td class="st c2 res">${d.result}</td><td class="${d.n === r.fastest.n ? 'lap fl' : 'lap pb'}">${best}</td>`;
    const stintAt = Object.fromEntries((d.stints || []).map(([a, , c]) => [a, c]));
    for (let i = 1; i <= L; i++) {
      const t = d.laps[i - 1];
      if (t == null && !(d.pit || []).includes(i)) { h += `<td class="lap empty">${i <= d.laps.length ? '—' : ''}</td>`; continue; }
      const cls = ['lap'];
      if (d.n === r.fastest.n && i === r.fastest.lap) cls.push('fl'); else if (d.best && i === d.best.lap) cls.push('pb');
      const pit = (d.pit || []).includes(i) || (d.pit || []).includes(i - 1);
      if (pit) cls.push('pit');
      const dot = stintAt[i] ? `<i style="background:${TYRE[stintAt[i]] || '#888'}"></i>` : '';
      h += `<td class="${cls.join(' ')}" data-l="${i}">${dot}${t == null ? '' : fmt(t)}${(d.pit || []).includes(i) ? '<small>PIT</small>' : ''}</td>`;
    }
    h += '</tr>';
  }
  $('tbl').innerHTML = h + '</tbody>';
  const byN = Object.fromEntries(r.drivers.map((d) => [d.n, d]));
  $('tbl').onclick = (e) => {
    const tr = e.target.closest('tr[data-n]'); if (!tr) return;
    sel = sel === tr.dataset.n ? null : tr.dataset.n;
    [...$('tbl').querySelectorAll('tr')].forEach((x) => x.classList.toggle('sel', x.dataset.n === sel));
    const td = e.target.closest('td[data-l]'), pop = $('pop');
    if (!td) { pop.style.display = 'none'; return; }
    const d = byN[tr.dataset.n], i = +td.dataset.l, s = d.sectors?.[i - 1] || [];
    pop.innerHTML = `<b>${d.code} · lap ${i}</b>${fmt(d.laps[i - 1]) || 'no time'}<br>S1 ${fmt(s[0]) || '–'} · S2 ${fmt(s[1]) || '–'} · S3 ${fmt(s[2]) || '–'}`;
    const b = td.getBoundingClientRect(); pop.style.display = 'block';
    pop.style.left = Math.min(innerWidth - pop.offsetWidth - 8, b.left) + 'px'; pop.style.top = (b.bottom + 6) + 'px';
  };
  addEventListener('scroll', () => ($('pop').style.display = 'none'), true);
}
load($('race').value);
