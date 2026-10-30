# Builds a replay (web/data/<slug>.bin + .json) for every race downloaded by fetch_replays.py, using build_data.py,
# then trims each .json to what the replay page reads. The replay window runs from the start of lap 1 to the chequered flag.
# usage: python3 build_replays.py
import json, os, glob, subprocess
from datetime import datetime, timedelta
HERE = os.path.dirname(os.path.abspath(__file__))
KEEP = ('slug', 'name', 'location', 'hz', 'frames', 't0', 'total_laps', 'drivers', 'track', 'fastest', 'lap_starts', 'positions')
for d in sorted(glob.glob(f'{HERE}/raw_replay/*/')):
    slug = os.path.basename(d.rstrip('/'))
    if len(glob.glob(d + 'loc/*.json')) < len(json.load(open(d + 'drivers.json'))): print(slug, 'not fully downloaded yet'); continue
    laps = json.load(open(d + 'laps.json'))
    ts = lambda s: datetime.fromisoformat(s)
    starts = [ts(l['date_start']) for l in laps if l['lap_number'] == 1 and l.get('date_start')]
    if not starts:   # lap 1 often has no start time: back it out from lap 2
        starts = [ts(l['date_start']) - timedelta(seconds=120) for l in laps if l['lap_number'] == 2 and l.get('date_start')]
    # the end: 60 s after the leader's last lap (a few laps carry stray timestamps that would stretch the replay)
    top = max(l['lap_number'] for l in laps)
    last = [ts(l['date_start']) + timedelta(seconds=l['lap_duration']) for l in laps if l['lap_number'] == top and l.get('date_start') and l.get('lap_duration')]
    if not last: last = [ts(l['date_start']) + timedelta(seconds=120) for l in laps if l['lap_number'] == top and l.get('date_start')]
    t0 = (min(starts) - timedelta(seconds=5)).strftime('%Y-%m-%dT%H:%M:%S'); t1 = (min(last) + timedelta(seconds=60)).strftime('%Y-%m-%dT%H:%M:%S')
    subprocess.run(['python3', f'{HERE}/build_data.py', d, slug, t0, t1], check=True, cwd=HERE)
    p = f'{HERE}/web/data/{slug}.json'; m = json.load(open(p))
    m['name'] = json.load(open(f'{HERE}/web/data/timing/{slug}.json'))['name']
    json.dump({k: m[k] for k in KEEP if k in m}, open(p, 'w'), separators=(',', ':'))
