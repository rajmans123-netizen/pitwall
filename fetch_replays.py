# Downloads what build_data.py needs to replay every 2026 race (car positions for every driver, plus intervals, positions,
# race control and weather), gently: OpenF1's free tier allows ~30 requests a minute.
#   raw_replay/<slug>/{sessions,drivers,laps,intervals,position,race_control,stints,pit,weather}.json + loc/<driver>.json
# usage: python3 fetch_replays.py     (Austin is skipped: it's already in raw/)
import json, os, glob, time, urllib.request, urllib.error
HERE = os.path.dirname(os.path.abspath(__file__))
def get(path):
    for attempt in range(10):
        try:
            with urllib.request.urlopen(f'https://api.openf1.org/v1/{path}', timeout=180) as r: data = json.load(r)
            time.sleep(2.2); return data
        except urllib.error.HTTPError as e:
            if e.code == 404: time.sleep(2.2); return []
            if e.code == 429: time.sleep(20 + 10 * attempt); continue
            raise
        except Exception: time.sleep(10)
    raise RuntimeError(path)
for t in sorted(glob.glob(f'{HERE}/web/data/timing/*.json')):
    slug = os.path.basename(t)[:-5]
    if slug == 'austin': continue
    k = next(json.load(open(d + 'session.json'))['session_key'] for d in glob.glob(f'{HERE}/raw_season/*/')
             if json.load(open(d + 'session.json'))['circuit_short_name'] and
             __import__('re').sub(r'[^a-z0-9]+', '-', __import__('unicodedata').normalize('NFKD', json.load(open(d + 'session.json'))['circuit_short_name']).encode('ascii', 'ignore').decode().lower()).strip('-') == slug)
    src = f'{HERE}/raw_season/{k}'; out = f'{HERE}/raw_replay/{slug}'; os.makedirs(f'{out}/loc', exist_ok=True)
    for name in ('drivers', 'laps', 'stints', 'pit'):
        if not os.path.exists(f'{out}/{name}.json'): json.dump(json.load(open(f'{src}/{name}.json')), open(f'{out}/{name}.json', 'w'))
    if not os.path.exists(f'{out}/sessions.json'): json.dump([json.load(open(f'{src}/session.json'))], open(f'{out}/sessions.json', 'w'))
    for name in ('intervals', 'position', 'race_control', 'weather'):
        p = f'{out}/{name}.json'
        if not os.path.exists(p): json.dump(get(f'{name}?session_key={k}'), open(p, 'w'))
    for d in json.load(open(f'{out}/drivers.json')):
        p = f"{out}/loc/{d['driver_number']}.json"
        if os.path.exists(p) and os.path.getsize(p) > 100: continue
        json.dump(get(f"location?session_key={k}&driver_number={d['driver_number']}"), open(p, 'w'))
    print(slug, 'done', flush=True)
