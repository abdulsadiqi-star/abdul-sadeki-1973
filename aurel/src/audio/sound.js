/**
 * Procedural sound (Web Audio — no files, no services). Starts OFF.
 *  · a very low, warm drone (two detuned sines through a lowpass)
 *  · fine mechanical ticks (filtered noise bursts) at the balance's beat
 *  · a soft "whirr" of gears whose level follows scroll velocity
 *  · a small click as each chapter locks in
 */
export function createSound() {
  let ctx = null, master, whirrGain, tickTimer = 0, on = false;
  let nextTick = 0;

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);

    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180; lp.connect(master);
    [55, 55.4, 82.4].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = i === 2 ? 0.012 : 0.03;
      o.connect(g); g.connect(lp); o.start();
    });

    // gear whirr: looped noise → bandpass → gain (driven by scroll velocity)
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 1.4;
    whirrGain = ctx.createGain(); whirrGain.gain.value = 0;
    src.connect(bp); bp.connect(whirrGain); whirrGain.connect(master); src.start();
    ctx.noiseBuf = buf;
  }

  function tick(time, strength = 1, freq = 3800) {
    const src = ctx.createBufferSource(); src.buffer = ctx.noiseBuf;
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = freq; hp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0.05 * strength, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    src.connect(hp); hp.connect(g); g.connect(master);
    src.start(time, Math.random(), 0.06);
  }

  return {
    get on() { return on; },
    toggle() {
      if (!ctx) build();
      on = !on;
      ctx.resume();
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.linearRampToValueAtTime(on ? 0.9 : 0, ctx.currentTime + 0.8);
      return on;
    },
    /** call every frame with scroll velocity (0..1) */
    update(velocity) {
      if (!ctx || !on) return;
      const t = ctx.currentTime;
      whirrGain.gain.setTargetAtTime(Math.min(0.05, velocity * 0.09), t, 0.12);
      // balance-wheel beat: 4 Hz when idle, quickens slightly while scrolling
      const rate = 4 + velocity * 6;
      while (nextTick < t + 0.1) {
        if (nextTick < t) nextTick = t;
        tick(nextTick, 0.6 + velocity);
        nextTick += 1 / rate;
      }
    },
    click() { if (ctx && on) tick(ctx.currentTime, 2.2, 1800); },
  };
}
