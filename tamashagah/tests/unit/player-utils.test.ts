import { describe, expect, it } from 'vitest';
import {
  MAX_NETWORK_RETRIES,
  SPEEDS,
  buildShareUrl,
  chooseStartPosition,
  clampTime,
  formatTimeParam,
  fractionFromPointer,
  fractionFromTime,
  isActivationTarget,
  isEditableTarget,
  isPermanentHttpStatus,
  levelIndexForHeight,
  mapMediaError,
  mapShortcut,
  normalizeRanges,
  parseTimeParam,
  pickCaptionsToEnable,
  pickInitialSubtitle,
  qualityOptions,
  rangesOf,
  retryDelayMs,
  seekBarKeyTarget,
  seekDeltaForArrow,
  stepSpeed,
  stripCueMarkup,
  timeFromFraction,
  type KeyLike,
} from '@/components/player/player-utils';
import { parsePositions, parsePrefs, upsertPosition } from '@/components/player/player-prefs';

const key = (code: string, extra: Partial<KeyLike> = {}): KeyLike => ({ code, key: code, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...extra });

describe('seek bar geometry', () => {
  const rect = { left: 100, width: 400 };

  it('fills right → left in RTL: the right edge is the start of the video', () => {
    expect(fractionFromPointer(500, rect, 'rtl')).toBe(0);
    expect(fractionFromPointer(300, rect, 'rtl')).toBe(0.5);
    expect(fractionFromPointer(100, rect, 'rtl')).toBe(1);
  });

  it('fills left → right in LTR', () => {
    expect(fractionFromPointer(100, rect, 'ltr')).toBe(0);
    expect(fractionFromPointer(300, rect, 'ltr')).toBe(0.5);
    expect(fractionFromPointer(500, rect, 'ltr')).toBe(1);
  });

  it('clamps pointers outside the bar and survives a zero-width bar', () => {
    expect(fractionFromPointer(9999, rect, 'rtl')).toBe(0);
    expect(fractionFromPointer(-50, rect, 'rtl')).toBe(1);
    expect(fractionFromPointer(10, { left: 0, width: 0 }, 'rtl')).toBe(0);
  });

  it('converts between time and fraction safely', () => {
    expect(timeFromFraction(0.25, 200)).toBe(50);
    expect(timeFromFraction(2, 200)).toBe(200);
    expect(timeFromFraction(0.5, Number.NaN)).toBe(0);
    expect(fractionFromTime(50, 200)).toBe(0.25);
    expect(fractionFromTime(500, 200)).toBe(1);
    expect(fractionFromTime(5, 0)).toBe(0);
  });

  it('clamps times into the video', () => {
    expect(clampTime(-5, 100)).toBe(0);
    expect(clampTime(150, 100)).toBe(100);
    expect(clampTime(42, 100)).toBe(42);
    expect(clampTime(150, Number.NaN)).toBe(150);
    expect(clampTime(Number.NaN, 100)).toBe(0);
  });
});

describe('arrow keys follow the visual direction of the bar', () => {
  it('RTL: ← is forward, → is backward', () => {
    expect(seekDeltaForArrow('ArrowLeft', 'rtl')).toBe(5);
    expect(seekDeltaForArrow('ArrowRight', 'rtl')).toBe(-5);
  });
  it('LTR: → is forward, ← is backward', () => {
    expect(seekDeltaForArrow('ArrowRight', 'ltr')).toBe(5);
    expect(seekDeltaForArrow('ArrowLeft', 'ltr')).toBe(-5);
  });

  it('drives the slider (role=slider) keyboard: arrows, page keys, home/end and clamping', () => {
    expect(seekBarKeyTarget('ArrowLeft', 30, 100, 'rtl')).toBe(35);
    expect(seekBarKeyTarget('ArrowRight', 30, 100, 'rtl')).toBe(25);
    expect(seekBarKeyTarget('ArrowRight', 2, 100, 'rtl')).toBe(0);
    expect(seekBarKeyTarget('ArrowLeft', 98, 100, 'rtl')).toBe(100);
    expect(seekBarKeyTarget('PageUp', 30, 100, 'rtl')).toBe(40);
    expect(seekBarKeyTarget('PageDown', 30, 100, 'rtl')).toBe(20);
    expect(seekBarKeyTarget('Home', 30, 100, 'rtl')).toBe(0);
    expect(seekBarKeyTarget('End', 30, 100, 'rtl')).toBe(100);
    expect(seekBarKeyTarget('a', 30, 100, 'rtl')).toBeNull();
    expect(seekBarKeyTarget('ArrowUp', 30, 100, 'rtl')).toBeNull(); // up/down are volume, handled globally
  });
});

describe('keyboard shortcuts', () => {
  it('maps the documented keys', () => {
    expect(mapShortcut(key('Space'), 'rtl')).toEqual({ type: 'toggle-play' });
    expect(mapShortcut(key('KeyK'), 'rtl')).toEqual({ type: 'toggle-play' });
    expect(mapShortcut(key('KeyF'), 'rtl')).toEqual({ type: 'fullscreen' });
    expect(mapShortcut(key('KeyM'), 'rtl')).toEqual({ type: 'mute' });
    expect(mapShortcut(key('KeyC'), 'rtl')).toEqual({ type: 'captions' });
    expect(mapShortcut(key('ArrowUp'), 'rtl')).toEqual({ type: 'volume', delta: 0.05 });
    expect(mapShortcut(key('ArrowDown'), 'rtl')).toEqual({ type: 'volume', delta: -0.05 });
    expect(mapShortcut(key('Escape'), 'rtl')).toEqual({ type: 'escape' });
    expect(mapShortcut(key('Home'), 'rtl')).toEqual({ type: 'seek-start' });
    expect(mapShortcut(key('End'), 'rtl')).toEqual({ type: 'seek-end' });
  });

  it('←/→ follow the RTL direction while J/L stay fixed', () => {
    expect(mapShortcut(key('ArrowLeft'), 'rtl')).toEqual({ type: 'seek-by', seconds: 5 });
    expect(mapShortcut(key('ArrowRight'), 'rtl')).toEqual({ type: 'seek-by', seconds: -5 });
    expect(mapShortcut(key('ArrowLeft'), 'ltr')).toEqual({ type: 'seek-by', seconds: -5 });
    expect(mapShortcut(key('KeyJ'), 'rtl')).toEqual({ type: 'seek-by', seconds: -10 });
    expect(mapShortcut(key('KeyL'), 'rtl')).toEqual({ type: 'seek-by', seconds: 10 });
    expect(mapShortcut(key('KeyJ'), 'ltr')).toEqual({ type: 'seek-by', seconds: -10 });
    expect(mapShortcut(key('KeyL'), 'ltr')).toEqual({ type: 'seek-by', seconds: 10 });
  });

  it('jumps to 0–90 % with the digit row and the numpad', () => {
    expect(mapShortcut(key('Digit0'), 'rtl')).toEqual({ type: 'seek-percent', percent: 0 });
    expect(mapShortcut(key('Digit5'), 'rtl')).toEqual({ type: 'seek-percent', percent: 50 });
    expect(mapShortcut(key('Numpad9'), 'rtl')).toEqual({ type: 'seek-percent', percent: 90 });
  });

  it('changes speed with < and > and opens help with ?', () => {
    expect(mapShortcut(key('Comma', { shiftKey: true, key: '<' }), 'rtl')).toEqual({ type: 'speed', direction: -1 });
    expect(mapShortcut(key('Period', { shiftKey: true, key: '>' }), 'rtl')).toEqual({ type: 'speed', direction: 1 });
    expect(mapShortcut(key('Slash', { shiftKey: true, key: '?' }), 'rtl')).toEqual({ type: 'help' });
    expect(mapShortcut(key('Slash', { shiftKey: true, key: '؟' }), 'rtl')).toEqual({ type: 'help' }); // Persian layout
    expect(mapShortcut(key('Unidentified', { key: '>' }), 'rtl')).toEqual({ type: 'speed', direction: 1 });
  });

  it('works on the Persian keyboard layout because letters are matched by physical key', () => {
    // On the Persian layout the K key produces "ن" — the code is what matters.
    expect(mapShortcut(key('KeyK', { key: 'ن' }), 'rtl')).toEqual({ type: 'toggle-play' });
    expect(mapShortcut(key('KeyF', { key: 'ب' }), 'rtl')).toEqual({ type: 'fullscreen' });
    expect(mapShortcut(key('KeyM', { key: 'ئ' }), 'rtl')).toEqual({ type: 'mute' });
  });

  it('leaves browser shortcuts alone and ignores other keys and shifted letters', () => {
    expect(mapShortcut(key('KeyK', { ctrlKey: true }), 'rtl')).toBeNull();
    expect(mapShortcut(key('KeyF', { metaKey: true }), 'rtl')).toBeNull();
    expect(mapShortcut(key('ArrowLeft', { altKey: true }), 'rtl')).toBeNull(); // browser "back"
    expect(mapShortcut(key('KeyK', { shiftKey: true }), 'rtl')).toBeNull();
    expect(mapShortcut(key('ArrowLeft', { shiftKey: true }), 'rtl')).toBeNull();
    expect(mapShortcut(key('KeyQ'), 'rtl')).toBeNull();
    expect(mapShortcut(key('Tab'), 'rtl')).toBeNull();
    expect(mapShortcut(key('Enter'), 'rtl')).toBeNull();
  });
});

describe('typing and activation guards', () => {
  const el = (tagName: string, attrs: Record<string, string> = {}, extra: Record<string, unknown> = {}) => ({
    tagName,
    isContentEditable: false,
    getAttribute: (n: string) => attrs[n] ?? null,
    closest: () => null,
    ...extra,
  });

  it('never fires shortcuts while typing', () => {
    expect(isEditableTarget(el('INPUT') as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget(el('TEXTAREA') as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget(el('SELECT') as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget(el('DIV', {}, { isContentEditable: true }) as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget(el('DIV', { role: 'textbox' }) as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget(el('DIV') as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget(el('BUTTON') as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({} as EventTarget)).toBe(false);
  });

  it('detects controls that own the Space key', () => {
    const inside = { closest: (s: string) => (s.includes('button') ? ({} as Element) : null) } as unknown as EventTarget;
    expect(isActivationTarget(inside)).toBe(true);
    expect(isActivationTarget({ closest: () => null } as unknown as EventTarget)).toBe(false);
    expect(isActivationTarget(null)).toBe(false);
  });
});

describe('speed ladder', () => {
  it('lists 0.5× to 2×', () => {
    expect(SPEEDS[0]).toBe(0.5);
    expect(SPEEDS.at(-1)).toBe(2);
    expect(SPEEDS).toContain(1);
  });
  it('steps up and down and stops at the ends', () => {
    expect(stepSpeed(1, 1)).toBe(1.25);
    expect(stepSpeed(1, -1)).toBe(0.75);
    expect(stepSpeed(2, 1)).toBe(2);
    expect(stepSpeed(0.5, -1)).toBe(0.5);
  });
  it('snaps off-ladder values to the neighbour in the requested direction', () => {
    expect(stepSpeed(1.1, 1)).toBe(1.25);
    expect(stepSpeed(1.1, -1)).toBe(1);
    expect(stepSpeed(9, 1)).toBe(2);
    expect(stepSpeed(0.1, -1)).toBe(0.5);
  });
});

describe('retry back-off and error messages', () => {
  it('doubles the delay up to 8 seconds', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([1000, 2000, 4000, 8000, 8000, 8000, 8000]);
    expect(retryDelayMs(-3)).toBe(1000);
    expect(retryDelayMs(Number.NaN)).toBe(1000);
    expect(MAX_NETWORK_RETRIES).toBeGreaterThanOrEqual(3);
  });

  it('does not retry responses that will not change', () => {
    for (const status of [401, 403, 404, 410]) expect(isPermanentHttpStatus(status)).toBe(true);
    for (const status of [0, 200, 429, 500, 502, 503, undefined, null]) expect(isPermanentHttpStatus(status)).toBe(false);
  });

  it('maps native MediaError codes to Persian messages', () => {
    for (const code of [1, 2, 3, 4, 0, undefined, null, 99]) {
      const info = mapMediaError(code);
      expect(info.message).toMatch(/[؀-ۿ]/);
    }
    expect(mapMediaError(2).retryable).toBe(true);
    expect(mapMediaError(4).retryable).toBe(false);
    expect(mapMediaError(2).message).toContain('اینترنت');
    expect(mapMediaError(4).message).toContain('فرمت');
  });
});

describe('quality options', () => {
  const levels = [
    { height: 240, bitrate: 400_000 },
    { height: 360, bitrate: 700_000 },
    { height: 360, bitrate: 900_000 },
    { height: 720, bitrate: 2_000_000 },
    { height: 0, bitrate: 128_000 }, // audio-only rendition: not a quality choice
    {},
  ];

  it('lists each height once (best bitrate), tallest first', () => {
    expect(qualityOptions(levels)).toEqual([
      { height: 720, levelIndex: 3 },
      { height: 360, levelIndex: 2 },
      { height: 240, levelIndex: 0 },
    ]);
    expect(qualityOptions([])).toEqual([]);
  });

  it('finds the level for a remembered height, falling back to the closest', () => {
    const options = qualityOptions(levels);
    expect(levelIndexForHeight(options, 360)).toBe(2);
    expect(levelIndexForHeight(options, 1080)).toBe(3);
    expect(levelIndexForHeight(options, 300)).toBe(2);
    expect(levelIndexForHeight(options, 144)).toBe(0);
    expect(levelIndexForHeight([], 360)).toBe(-1);
  });
});

describe('time parameter and share links', () => {
  it('parses seconds, units and clock notation (Persian digits too)', () => {
    expect(parseTimeParam('90')).toBe(90);
    expect(parseTimeParam('90.9')).toBe(90);
    expect(parseTimeParam('۹۰')).toBe(90);
    expect(parseTimeParam('1m30s')).toBe(90);
    expect(parseTimeParam('2h')).toBe(7200);
    expect(parseTimeParam('1h2m3s')).toBe(3723);
    expect(parseTimeParam('45s')).toBe(45);
    expect(parseTimeParam('1:30')).toBe(90);
    expect(parseTimeParam('1:02:03')).toBe(3723);
    expect(parseTimeParam('۰۱:۳۰')).toBe(90);
  });

  it('rejects garbage', () => {
    for (const bad of [null, undefined, '', 'abc', '-5', '1:75', '1:99:00', '1m30', 'ms', '9'.repeat(20), '1:2:3:4', '1e3']) {
      expect(parseTimeParam(bad), String(bad)).toBeNull();
    }
  });

  it('formats whole non-negative seconds', () => {
    expect(formatTimeParam(90.9)).toBe('90');
    expect(formatTimeParam(-4)).toBe('0');
    expect(formatTimeParam(Number.NaN)).toBe('0');
  });

  it('builds absolute share links, with the start time only when it is meaningful', () => {
    expect(buildShareUrl('https://tamashagah.example', 'aB3dE5gH7jK')).toBe('https://tamashagah.example/watch/aB3dE5gH7jK');
    expect(buildShareUrl('https://tamashagah.example', 'aB3dE5gH7jK', 0.4)).toBe('https://tamashagah.example/watch/aB3dE5gH7jK');
    expect(buildShareUrl('https://tamashagah.example', 'aB3dE5gH7jK', 83.7)).toBe('https://tamashagah.example/watch/aB3dE5gH7jK?t=83');
    expect(buildShareUrl('http://localhost:3102', 'aB3dE5gH7jK', 5)).toBe('http://localhost:3102/watch/aB3dE5gH7jK?t=5');
  });
});

describe('subtitle cue text', () => {
  it('strips WebVTT markup and decodes entities (the result is rendered as plain text)', () => {
    expect(stripCueMarkup('<b>سلام</b> <i>دنیا</i>')).toBe('سلام دنیا');
    expect(stripCueMarkup('<v Ali>Hello</v> &amp; bye')).toBe('Hello & bye');
    expect(stripCueMarkup('<c.yellow>x</c> &lt;script&gt;')).toBe('x <script>');
    expect(stripCueMarkup('<00:01.000>word')).toBe('word');
    expect(stripCueMarkup('  \n  ')).toBe('');
  });
});

describe('buffered ranges', () => {
  it('sorts, merges touching ranges and drops empty ones', () => {
    expect(normalizeRanges([[10, 20], [0, 5], [5.02, 8], [30, 30], [Number.NaN, 4]])).toEqual([[0, 8], [10, 20]]);
    expect(normalizeRanges([])).toEqual([]);
  });
  it('reads a TimeRanges-like object', () => {
    const ranges = { length: 2, start: (i: number) => [0, 12][i]!, end: (i: number) => [6, 18][i]! };
    expect(rangesOf(ranges)).toEqual([[0, 6], [12, 18]]);
  });
});

describe('where playback starts', () => {
  const minute = 60_000;
  it('prefers an explicit ?t=', () => {
    expect(chooseStartPosition({ explicit: 83, server: { position: 200, at: 5 }, durationSeconds: 600 })).toBe(83);
    expect(chooseStartPosition({ explicit: 0, server: { position: 200, at: 5 }, durationSeconds: 600 })).toBe(0);
    expect(chooseStartPosition({ explicit: 5000, durationSeconds: 600 })).toBe(600);
  });
  it('uses the newer of the server and local position', () => {
    expect(chooseStartPosition({ server: { position: 100, at: 10 * minute }, local: { position: 150, at: 20 * minute }, durationSeconds: 600 })).toBe(150);
    expect(chooseStartPosition({ server: { position: 100, at: 30 * minute }, local: { position: 150, at: 20 * minute }, durationSeconds: 600 })).toBe(100);
    expect(chooseStartPosition({ local: { position: 77, at: 1 }, durationSeconds: 600 })).toBe(77);
    expect(chooseStartPosition({ durationSeconds: 600 })).toBe(0);
  });
  it('starts over when the video was finished or the position is trivial', () => {
    expect(chooseStartPosition({ server: { position: 590, at: 1 }, durationSeconds: 600 })).toBe(0);
    expect(chooseStartPosition({ server: { position: 2, at: 1 }, durationSeconds: 600 })).toBe(0);
  });
});

describe('subtitle selection', () => {
  const tracks = [
    { id: 'en', lang: 'en', isDefault: false },
    { id: 'fa', lang: 'fa', isDefault: true },
    { id: 'pt', lang: 'pt-BR' },
  ];
  it('starts with the remembered language, "off", or the creator’s default', () => {
    expect(pickInitialSubtitle(tracks, 'en')).toBe('en');
    expect(pickInitialSubtitle(tracks, 'off')).toBeNull();
    expect(pickInitialSubtitle(tracks, undefined)).toBe('fa');
    expect(pickInitialSubtitle(tracks, 'de')).toBe('fa'); // remembered language not available here → default
    expect(pickInitialSubtitle(tracks, 'pt')).toBe('pt'); // primary subtag match
    expect(pickInitialSubtitle([{ id: 'en', lang: 'en' }], undefined)).toBeNull(); // captions are opt-in without a default
    expect(pickInitialSubtitle([], 'fa')).toBeNull();
  });
  it('enables the remembered, default or first track when asked', () => {
    expect(pickCaptionsToEnable(tracks, 'en')).toBe('en');
    expect(pickCaptionsToEnable(tracks, 'off')).toBe('fa');
    expect(pickCaptionsToEnable([{ id: 'en', lang: 'en' }, { id: 'de', lang: 'de' }], undefined)).toBe('en');
    expect(pickCaptionsToEnable([], undefined)).toBeNull();
  });
});

describe('stored player preferences', () => {
  it('accepts valid values and clamps the volume', () => {
    expect(parsePrefs(JSON.stringify({ volume: 0.4, muted: true, quality: 720, captions: 'fa' }))).toEqual({ volume: 0.4, muted: true, quality: 720, captions: 'fa' });
    expect(parsePrefs(JSON.stringify({ volume: 7 })).volume).toBe(1);
    expect(parsePrefs(JSON.stringify({ volume: -1 })).volume).toBe(0);
    expect(parsePrefs(JSON.stringify({ quality: 'auto', captions: 'off' }))).toEqual({ quality: 'auto', captions: 'off' });
    expect(parsePrefs(JSON.stringify({ captions: 'pt-BR' }))).toEqual({ captions: 'pt-BR' });
  });
  it('drops anything invalid instead of failing', () => {
    expect(parsePrefs('not json')).toEqual({});
    expect(parsePrefs('[1,2]')).toEqual({});
    expect(parsePrefs('null')).toEqual({});
    expect(parsePrefs(null)).toEqual({});
    expect(parsePrefs(JSON.stringify({ volume: 'loud', muted: 'yes', quality: 12, captions: '<script>' }))).toEqual({});
  });

  it('keeps only valid resume positions and prunes to the newest entries', () => {
    const raw = JSON.stringify({ aB3dE5gH7jK: [42, 1000], 'bad id': [1, 1], zzzzzzzzzzz: ['x', 1], yyyyyyyyyyy: [-3, 1], xxxxxxxxxxx: [5] });
    expect(parsePositions(raw)).toEqual({ aB3dE5gH7jK: [42, 1000] });
    expect(parsePositions('garbage')).toEqual({});

    let map = parsePositions(null);
    for (let i = 0; i < 5; i++) map = upsertPosition(map, `video${String(i).padStart(6, '0')}`, i + 0.126, 1000 + i, 3);
    expect(Object.keys(map).sort()).toEqual(['video000002', 'video000003', 'video000004']);
    expect(map.video000004).toEqual([4.13, 1004]);
  });
});
