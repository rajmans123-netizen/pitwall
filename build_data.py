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
fl = min((l for l in laps if l.get('lap_duration') and not l.get('is_pit_out_lap')), key=lambda l: l['lap_duration'])
a = ts(fl['date_start']); b = a + fl['lap_duration']
pts = [p for p in load(f"loc/{fl['driver_number']}.json") if a <= ts(p['date']) <= b]
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

os.makedirs('web/data', exist_ok=True)
xy.tofile(f'web/data/{SLUG}.bin')
meta = dict(slug=SLUG, name=f"{session['country_name']} GP {session['year']}", location=session['location'], hz=HZ, frames=N, t0=T0,
            total_laps=max(l['lap_number'] for l in laps),
            drivers=[dict(n=d['driver_number'], code=d['name_acronym'], name=d['full_name'], team=d['team_name'], color='#' + (d['team_colour'] or '888888')) for d in drivers],
            track=track, fastest=dict(n=fl['driver_number'], lap=fl['lap_number'], time=fl['lap_duration']),
            lap_starts={str(k): v for k, v in lap_starts.items()}, gaps={str(k): v for k, v in gaps.items()},
            positions=positions, flags=flags, stints=stints, pits=pits, weather=weather)
json.dump(meta, open(f'web/data/{SLUG}.json', 'w'), separators=(',', ':'))
print(SLUG, N, 'frames', os.path.getsize(f'web/data/{SLUG}.bin') // 1024, 'KB bin', os.path.getsize(f'web/data/{SLUG}.json') // 1024, 'KB json')
