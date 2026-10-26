# Pit Wall · F1 race replay in your browser

Replay a Formula 1 race on your phone or laptop: every car moving around the track map, lap by lap.
Free, no sign-up, nothing to install.

**Try it:** https://rajmans123-netizen.github.io/pitwall/

**Part 1 (now):** the 2026 United States GP in Austin. All 22 cars on the circuit, replayed at 1×, 4×, 16× or 64×. Tap a car to follow it.

New features land one by one in the **Raj Tries F1 series** on Instagram ([@raj_triess](https://instagram.com/raj_triess)), built with Claude.

## How it works
- Data comes from [OpenF1](https://openf1.org), an unofficial open F1 data API (not associated with Formula 1).
- `build_data.py` downloads a race's car positions (about 4 per second per car) and packs them into a small binary file (`data/austin.bin`, 2 MB), plus the track outline and lap times (`data/austin.json`).
- `app.js` draws every car on a canvas at 60 fps, smoothly interpolating between position samples.

Static site, no build step.

Inspired by Tom Shaw's [f1-race-replay](https://github.com/IAmTomShaw/f1-race-replay). Pit Wall is a separate project written from scratch for the web.

MIT licensed. F1, FORMULA 1 and related marks are trademarks of Formula One Licensing B.V.; this project is unofficial.
