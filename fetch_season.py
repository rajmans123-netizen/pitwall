# Downloads the timing data for every 2026 race run so far from OpenF1 (gently: OpenF1's free tier allows ~30 requests a minute).
#   raw_season/<session_key>/{session,drivers,laps,stints,pit,result}.json
# usage: python3 fetch_season.py [up_to_date]
import json, os, sys, time, urllib.request, urllib.error
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = f'{HERE}/raw_season'
UNTIL = sys.argv[1] if len(sys.argv) > 1 else time.strftime('%Y-%m-%d')
def get(path):
    for attempt in range(8):
        try:
            with urllib.request.urlopen(f'https://api.openf1.org/v1/{path}', timeout=60) as r: data = json.load(r)
            time.sleep(2.2); return data
        except urllib.error.HTTPError as e:
            if e.code == 404: time.sleep(2.2); return []
            if e.code == 429: time.sleep(20 + 10 * attempt); continue
            raise
    raise RuntimeError('gave up on ' + path)
sessions = [s for s in get('sessions?year=2026&session_name=Race') if s['date_start'][:10] < UNTIL]
for s in sessions:
    k = s['session_key']; d = f'{OUT}/{k}'; os.makedirs(d, exist_ok=True)
    json.dump(s, open(f'{d}/session.json', 'w'))
    for name, path in [('drivers', 'drivers'), ('laps', 'laps'), ('stints', 'stints'), ('pit', 'pit'), ('result', 'session_result')]:
        p = f'{d}/{name}.json'
        if os.path.exists(p) and os.path.getsize(p) > 2: continue
        json.dump(get(f'{path}?session_key={k}'), open(p, 'w'))
    laps = json.load(open(f'{d}/laps.json'))
    print(k, s['location'], 'laps rows', len(laps), 'drivers', len(json.load(open(f'{d}/drivers.json'))), flush=True)
