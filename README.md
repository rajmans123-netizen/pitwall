# Pit Wall · F1 race replay in your browser

Replay a Formula 1 race on your phone or laptop: every car moving around the track map, lap by lap.
Free, no sign-up, nothing to install.

**Try it:** https://rajmans123-netizen.github.io/pitwall/

**Replay:** any 2026 race. All 22 cars on the circuit, replayed at 1×, 4×, 16× or 64×. Tap a car to follow it.

**Leaderboard and overtakes:** the running order and gaps (to the car ahead, or tap for gap to the leader) update as the race plays. Every on-track pass flashes on the board (▲ green, ▼ red) and on the map, with a running count.
Overtakes are counted by Pit Wall, not taken from an official source: a car must move ahead of another in the timing data, really draw past it on the track map, and stay ahead for 8 seconds, with neither car in the pit lane, out of the race or stopped (driving past a crashed or stalled car isn't an overtake). Places won through pit stops or retirements don't count.

**Season timing:** every lap of every driver in every 2026 race so far: lap and sector times, fastest lap, personal bests, tyres and pit stops (drive-through penalties and red-flag waits in the pit lane are marked separately, not counted as stops).

New features land one by one in the **Raj Tries F1 series** on Instagram ([@raj_triess](https://instagram.com/raj_triess)), built with Claude.

## How it works
- Data comes from [OpenF1](https://openf1.org), an unofficial open F1 data API (not associated with Formula 1).
- `build_data.py` downloads a race's car positions (about 4 per second per car) and packs them into a small binary file (`data/austin.bin`, 2 MB), plus the track outline and lap times (`data/austin.json`).
- `app.js` draws every car on a canvas at 60 fps, smoothly interpolating between position samples, and the leaderboard beside it.
- `build_data.py` also finds the overtakes: order changes in OpenF1's position feed, checked against where each car really is on the track.
- `fetch_season.py` + `build_timing.py` pack the season's lap timing into `data/timing/`.
- `fetch_replays.py` + `build_replays.py` do the same for every race's car positions.

Static site, no build step.

Inspired by Tom Shaw's [f1-race-replay](https://github.com/IAmTomShaw/f1-race-replay). Pit Wall is a separate project written from scratch for the web.

MIT licensed. F1, FORMULA 1 and related marks are trademarks of Formula One Licensing B.V.; this project is unofficial.
