# Motion Reel

A 15-second, 1920×1080, 60 fps motion-graphics piece built entirely in code:
one HTML canvas for the picture, numpy synthesis for the sound. No templates,
no samples, no keyframe software.

| Time | Section | What happens |
|---|---|---|
| 0–2s | 01 Genesis | A dot is born (elastic), pulses with shockwaves, gathers satellites, squashes, and snaps into a line |
| 2–4.5s | 02 Form | The line morphs on every beat: circle → square → triangle → star → flower (overshoot, squash & stretch, echo trails, riso offset) |
| 4.5–7.5s | 03 Kinetic Type | MOTION · TIMING · SPACING · EASING · RHYTHM, each animated to show the principle it names |
| 7.5–10.9s | 04 Dimension | 1,500 3D particles: sphere → torus knot → explosion through a warp tunnel |
| 10.5–12.45s | 05 Field | Staggered colour-band wipe into a 576-cell grid driven by interfering ripples |
| 12.45–15s | 06 Resolve | The grid's dots fly into the "MADE IN CODE" lockup, then collapse back into the opening dot |

## Files
- `reel.html` – the animation. Every frame is a pure function of time, so frames render in parallel with true sub-frame motion blur (4 samples, 180° shutter). Open it in a browser and click to play it live with sound.
- `soundtrack.py` – synthesises `soundtrack.wav` (120 BPM, A minor), with every hit placed on the animation's timeline.
- `render.js` – renders all 900 frames in headless Chromium and muxes them with the audio into `reel.mp4`.

## Rebuild
```bash
python3 soundtrack.py
NODE_PATH=$(npm root -g) node render.js --workers 4 --out /tmp/reel-build
```
