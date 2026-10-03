# AUREL A01 — Time made visible

A scroll-scrubbed, fully **procedural** 3D luxury-watch experience.
No GLB, no video, no image assets, no paid APIs, no keys — everything (geometry, materials,
textures, lighting, sound) is generated in code.

```bash
cd aurel
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
```

## Stack (all free / open source)
Vite · Three.js · GSAP (ScrollTrigger + ticker) · Web Audio API · `@fontsource` (Inter, Cormorant Garamond, self-hosted).

## How it works
- **Scroll = timeline.** `src/animations/timeline.js` defines the whole film as pure functions of
  scroll progress `p` (camera orbit, watch rig, background, light, explosion, focus, labels).
  Progress is damped for a heavy feel; scrolling backwards reverses every move exactly.
- **27 independent parts** (`src/scene/watch/parts/*`): crystal, bezel, chapter ring, markers, 3 hands,
  pin, dial, date window, inner dial structure, case, crown, stem, movement holder, mainplate, bridges,
  gear train (barrel→escape + pallet fork), balance wheel + hairspring, rotor, jewels, screws,
  caseback crystal + ring, two straps, buckle. Each is a `Part` with its own rest/target pose.
- **Exploded view.** `src/scene/layout.js` gives every part its own slot on a museum "knolling in depth"
  board (landscape) or a tall two-column board (portrait). `WINDOWS` in the timeline choreographs the
  14-step sequence; reassembly replays it in reverse (crystal lands last). `__aurel.overlaps()`
  projects every part and reports screen-space overlaps (0 at full explosion on desktop).
- **Lighting.** Procedural studio HDR (big key softbox, strip lights, black flags) → PMREM, plus key/rim/fill
  lights, ACES tone-mapping, reflection-only sapphire material, soft contact shadow.
- **Chapters:** Hero · Form · Depth · Exploded · Inside the calibre · Precision · Reassembly · Final.
- **Responsive:** typography and camera are recomposed (not shrunk) on tablet/phone; the mobile board is
  a vertical tour. Pointer tilt only on fine-pointer desktops (≤ ~3°). DPR cap, fewer segments and no AA on mobile.
- **Accessibility:** `prefers-reduced-motion` removes smoothing, idle motion and tilt; sound starts **off**.

## Layout
```
src/
  main.js                 bootstrap, render loop, scroll → state → scene
  animations/             easing (cubic-bezier), tracks, timeline (the film)
  scene/                  stage (renderer, lights), studio (HDR env), layout (exploded board)
    watch/                helpers, textures, materials, part, parts/{face,body,movement,straps}
  components/ui.js        scrubbed type, technical tags, chapter nav
  audio/sound.js          procedural ticks / drone / gear whirr
  styles/                 base, stage, hud, responsive
```
