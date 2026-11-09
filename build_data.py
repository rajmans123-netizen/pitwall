# Packs one OpenF1 race into what the Pit Wall page loads:
#   web/data/<slug>.bin  : Int16 x,y for every car, HZ frames a second, frame-major ([frame][driver][x, y])
#   web/data/<slug>.json : drivers, track outline, positions, gaps, laps, flags, tyres, pit stops, weather
# usage: python3 build_data.py raw/ austin 2026-10-25T20:03:40 2026-10-25T21:41:00
import json, sys, os, bisect
from datetime import datetime
import numpy as np

RAW, SLUG, T0, T1 = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
HZ = 4
ts = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
t0, t1 = ts(T0 + '+00:00'), ts(T1 + '+00:00')
load = lambda n: json.load(open(os.path.join(RAW, n)))
drivers = sorted(load('drivers.json'), key=lambda d: d['driver_number'])
nums = [d['driver_number'] for d in drivers]
N = int((t1 - t0) * HZ)
grid = t0 + np.arange(N) / HZ

# car positions, resampled onto a fixed 4 Hz grid (linear between OpenF1's ~3.7 Hz samples)
xy = np.zeros((N, len(nums), 2), np.int16)
for j, n in enumerate(nums):
    pts = sorted(load(f'loc/{n}.json'), key=lambda p: p['date'])
    t = np.array([ts(p['date']) for p in pts]); x = np.array([p['x'] for p in pts], float); y = np.array([p['y'] for p in pts], float)
    xy[:, j, 0] = np.round(np.interp(grid, t, x)); xy[:, j, 1] = np.round(np.interp(grid, t, y))

laps = load('laps.json')
rel = lambda s: round(ts(s) - t0, 2)

# track outline: the race's fastest lap, sampled from that car's positions
# (the fastest lap with enough position samples: some laps have none)
for fl in sorted((l for l in laps if l.get('lap_duration') and l.get('date_start') and not l.get('is_pit_out_lap')), key=lambda l: l['lap_duration']):
    a = ts(fl['date_start']); b = a + fl['lap_duration']
    pts = [p for p in load(f"loc/{fl['driver_number']}.json") if a <= ts(p['date']) <= b]
    if len(pts) > 100: break
track = [[p['x'], p['y']] for p in pts]

# leader's lap starts (for the lap counter) and each car's lap starts (for tyre age)
lap_starts = {}
for l in laps:
    if l.get('date_start'): lap_starts.setdefault(l['driver_number'], []).append((l['lap_number'], rel(l['date_start'])))
for v in lap_starts.values(): v.sort()

def sval(v):
    if v is None: return None
    if isinstance(v, (int, float)): return round(float(v), 3)
    return str(v)                                     # "+1 LAP"
gaps = {}
for r in sorted(load('intervals.json'), key=lambda r: r['date']):
    t = rel(r['date'])
    if -60 <= t <= t1 - t0 + 60: gaps.setdefault(r['driver_number'], []).append([t, sval(r.get('gap_to_leader')), sval(r.get('interval'))])

positions = [[rel(p['date']), p['driver_number'], p['position']] for p in sorted(load('position.json'), key=lambda p: p['date'])]
flags = [[rel(m['date']), m.get('lap_number'), m.get('category'), m.get('flag'), m.get('message')] for m in sorted(load('race_control.json'), key=lambda m: m['date'])]
stints = [[s['driver_number'], s['stint_number'], s['lap_start'], s['lap_end'], s.get('compound'), s.get('tyre_age_at_start')] for s in load('stints.json')]
pits = [[rel(p['date']), p['driver_number'], p.get('lap_number'), p.get('pit_duration')] for p in load('pit.json')]
weather = [[rel(w['date']), w.get('air_temperature'), w.get('track_temperature'), w.get('rainfall')] for w in load('weather.json')][::4]
session = load('sessions.json')[0]

# on-track overtakes: a car moves ahead of another and stays there for 8 s, with neither car in the pit lane or out of the race.
# Places won or lost through pit stops and retirements are not overtakes. Each row: [t, passer, passed, passer's new position, lap]
last_lap_t = {n: max(t for _, t in v) for n, v in lap_starts.items()}
max_lap = {n: max(l for l, _ in v) for n, v in lap_starts.items()}
total = max(l['lap_number'] for l in laps)
def in_pit(n, t):   # OpenF1's pit time is late in the stop (at a red flag, the restart), so the lane runs from about pt - duration to pt; plus margins for slowing in and the out-lap
    return any(pt - (dur or 30) - 12 <= t <= pt + 35 for pt, pn, _, dur in pits if pn == n)
def is_out(n, t): return n not in lap_starts or (max_lap.get(n, 0) < total - 3 and t > last_lap_t.get(n, 0) + 150)   # no laps at all = didn't start
def order_at(t, rows=positions):
    cur = {}
    for tt, n, pos in rows:
        if tt > t: break
        cur[n] = pos
    return sorted(cur, key=lambda n: cur[n]), cur
# where each car is along the lap (0..1), from the nearest point of the track outline, so a pass can be checked on the map:
# around the moment the order changed, the passer must have come from behind to ahead within 3% of a lap (~150 m) of the other car
T = np.array(track, float); seg = np.r_[0, np.cumsum(np.hypot(*np.diff(T, axis=0).T))]; LAPLEN = seg[-1]
prog = np.zeros((N, len(nums)), np.float32)
for c0 in range(0, N, 2000):
    P_ = xy[c0:c0 + 2000].astype(float)[:, :, None, :] - T[None, None, :, :]
    prog[c0:c0 + 2000] = seg[np.argmin((P_ ** 2).sum(-1), axis=2)] / LAPLEN
col = {n: j for j, n in enumerate(nums)}
def close(a_, b_, t, before=20, after=3):
    f0, f1 = max(0, int((t - before) * HZ)), min(N - 1, int((t + after) * HZ))
    d = prog[f0:f1 + 1, col[a_]] - prog[f0:f1 + 1, col[b_]]; d = (d + 0.5) % 1 - 0.5     # a ahead of b on the road when > 0
    cross = (d[:-1] < 0) & (d[1:] >= 0) & (np.abs(d[:-1]) < 0.03) & (np.abs(d[1:]) < 0.03)
    return bool(cross.any())   # the passer really drew alongside and got ahead on the track
def speed(n, t, span=5):   # metres per second over the last `span` seconds, from the car's positions (decimetres)
    f1 = min(N - 1, max(1, int(t * HZ))); f0 = max(0, f1 - int(span * HZ)); j = col[n]
    p = xy[f0:f1 + 1, j].astype(float); return float(np.hypot(*np.diff(p, axis=0).T).sum()) / 10 / max(0.25, (f1 - f0) / HZ)
overtakes = []
end = t1 - t0
prev, _ = order_at(0)
for t in np.arange(1, end, 1.0):
    cur, cp = order_at(t)
    if len(cur) == len(prev):
        rank_prev = {n: i for i, n in enumerate(prev)}; later, _ = order_at(t + 8); rank_later = {n: i for i, n in enumerate(later)}
        rank_cur = {n: i for i, n in enumerate(cur)}
        moved = [n for n in cur if rank_cur[n] < rank_prev.get(n, 99)]   # only cars that gained a place can have passed someone
        for a_ in moved:
            for b_ in cur:
                if rank_prev.get(a_, 99) > rank_prev.get(b_, 99) and rank_cur[a_] < rank_cur[b_] and rank_later.get(a_, 99) < rank_later.get(b_, 99):
                    if not (in_pit(a_, t) or in_pit(b_, t) or is_out(a_, t) or is_out(b_, t)) and close(a_, b_, t) \
                            and speed(b_, t) >= 0.4 * speed(a_, t):   # driving past a stopped or crawling car isn't an overtake
                        lap = max([l for l, lt in lap_starts.get(cur[0], []) if lt <= t] or [1])
                        if any(o[1] == a_ and o[2] == b_ and t - o[0] < 30 for o in overtakes[-60:]): continue   # the timing feed flickered: same pass
                        overtakes.append([round(float(t), 1), a_, b_, cp[a_], lap])
    prev = cur

os.makedirs('web/data', exist_ok=True)
xy.tofile(f'web/data/{SLUG}.bin')
meta = dict(slug=SLUG, name=f"{session['country_name']} GP {session['year']}", location=session['location'], hz=HZ, frames=N, t0=T0,
            total_laps=max(l['lap_number'] for l in laps),
            drivers=[dict(n=d['driver_number'], code=d['name_acronym'], name=d['full_name'], team=d['team_name'], color='#' + (d['team_colour'] or '888888')) for d in drivers],
            track=track, fastest=dict(n=fl['driver_number'], lap=fl['lap_number'], time=fl['lap_duration']),
            lap_starts={str(k): v for k, v in lap_starts.items()}, gaps={str(k): v for k, v in gaps.items()},
            positions=positions, overtakes=overtakes, flags=flags, stints=stints, pits=pits, weather=weather)
json.dump(meta, open(f'web/data/{SLUG}.json', 'w'), separators=(',', ':'))
from collections import Counter; c = Counter(o[1] for o in overtakes); code = {d['driver_number']: d['name_acronym'] for d in drivers}
print('overtakes', len(overtakes), 'most:', [(code[n], k) for n, k in c.most_common(5)])
print(SLUG, N, 'frames', os.path.getsize(f'web/data/{SLUG}.bin') // 1024, 'KB bin', os.path.getsize(f'web/data/{SLUG}.json') // 1024, 'KB json')
