# Packs the season timing (raw_season/, from fetch_season.py) into what timing.html loads:
#   web/data/season.json         : the races run so far (round, name, date, winner)
#   web/data/timing/<slug>.json  : every driver's lap and sector times, result, best lap, tyres and pit laps
# Races with no lap data (cancelled) are skipped.
# usage: python3 build_timing.py
import json, os, re, glob, unicodedata, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__)); RAW = f'{HERE}/raw_season'; OUT = f'{HERE}/web/data'
os.makedirs(f'{OUT}/timing', exist_ok=True)
mp = f'{RAW}/meetings.json'
if not os.path.exists(mp): json.dump(json.load(urllib.request.urlopen('https://api.openf1.org/v1/meetings?year=2026', timeout=60)), open(mp, 'w'))
meetings = {m['meeting_key']: m for m in json.load(open(mp))}
slugify = lambda s: re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()).strip('-')
r3 = lambda v: None if v is None else round(v, 3)

def fmt_total(s): return f'{int(s // 3600)}:{int(s // 60) % 60:02d}:{s % 60:06.3f}'
def result_text(r, leader_laps):
    if r is None: return ''
    if r.get('dsq'): return 'DSQ'
    if r.get('dns'): return 'DNS'
    if r.get('dnf'): return 'DNF'
    if r.get('position') == 1 and r.get('duration'): return fmt_total(r['duration'])
    g = r.get('gap_to_leader')
    if isinstance(g, (int, float)): return f'+{g:.3f}'
    if isinstance(g, str): return g
    down = leader_laps - (r.get('number_of_laps') or 0)
    return f'+{down} LAP{"S" if down > 1 else ""}' if down > 0 else ''

races = []
for d in sorted(glob.glob(f'{RAW}/*/'), key=lambda p: json.load(open(p + 'session.json'))['date_start']):
    s = json.load(open(d + 'session.json')); laps = json.load(open(d + 'laps.json'))
    results = json.load(open(d + 'result.json'))
    if not laps or not results: continue
    drivers = {x['driver_number']: x for x in json.load(open(d + 'drivers.json'))}
    res = {x['driver_number']: x for x in results}
    leader_laps = max((x.get('number_of_laps') or 0) for x in results)
    total = max([l['lap_number'] for l in laps] + [leader_laps])
    pits = {}
    for p in json.load(open(d + 'pit.json')):
        if p.get('lap_number'): pits.setdefault(p['driver_number'], set()).add(p['lap_number'])
    stints = {}
    for st in json.load(open(d + 'stints.json')):
        if st.get('lap_start'): stints.setdefault(st['driver_number'], []).append([st['lap_start'], st.get('lap_end'), st.get('compound')])
    rows = []
    for n, dv in drivers.items():
        mine = sorted((l for l in laps if l['driver_number'] == n), key=lambda l: l['lap_number'])
        nl = max([l['lap_number'] for l in mine] + [res.get(n, {}).get('number_of_laps') or 0])
        lt = [None] * nl; sec = [None] * nl
        for l in mine:
            i = l['lap_number'] - 1; lt[i] = r3(l.get('lap_duration'))
            sec[i] = [r3(l.get('duration_sector_1')), r3(l.get('duration_sector_2')), r3(l.get('duration_sector_3'))]
        timed = [(t, i + 1) for i, t in enumerate(lt) if t]
        best = min(timed) if timed else None
        r = res.get(n)
        rows.append(dict(n=n, code=dv['name_acronym'], name=dv['full_name'].title(), team=dv['team_name'], color='#' + (dv.get('team_colour') or '888888'),
                         pos=r.get('position') if r else None, result=result_text(r, leader_laps), points=r.get('points') if r else 0,
                         laps=lt, sectors=sec, best=dict(time=best[0], lap=best[1]) if best else None,
                         pit=sorted(pits.get(n, [])), stints=sorted(stints.get(n, []))))
    rows.sort(key=lambda x: (x['pos'] is None, x['pos'] or 0, -len([t for t in x['laps'] if t])))
    fl = min((x for x in rows if x['best']), key=lambda x: x['best']['time'])
    m = meetings.get(s['meeting_key'], {})
    name = m.get('meeting_name') or f"{s['country_name']} Grand Prix"
    slug = slugify(s['circuit_short_name'])
    out = dict(slug=slug, name=name, location=s['location'], date=s['date_start'], total_laps=total, replay=slug if os.path.exists(f'{OUT}/{slug}.bin') else None,
               partial=len(laps) < 0.5 * leader_laps * len(rows), fastest=dict(n=fl['n'], lap=fl['best']['lap'], time=fl['best']['time']), drivers=rows)
    json.dump(out, open(f'{OUT}/timing/{slug}.json', 'w'), separators=(',', ':'))
    races.append(dict(round=len(races) + 1, slug=slug, name=name, venue=s['location'],
                      date=s['date_start'][:10], winner=rows[0]['code'], partial=out['partial'], replay=out['replay']))
    print(f"R{len(races):<2} {slug:<20} {name:<32} laps {total:<3} winner {rows[0]['code']}{'  (partial lap data)' if out['partial'] else ''}")
json.dump(dict(year=2026, races=races), open(f'{OUT}/season.json', 'w'), separators=(',', ':'))
