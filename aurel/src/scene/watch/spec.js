// Single source of truth for the watch's dimensions (millimetres).
// +Z points at the viewer (dial side), +Y is 12 o'clock, +X is the crown.

export const Z = {
  crystalBot: 2.6, crystalTop: 4.9,
  bezelBot: 1.75, bezelTop: 3.5,
  chapter: 0.2,           // ring body bottom
  markers: 0.0,
  dial: -0.3,             // dial centre (0.6 thick)
  dateWheel: -1.15,
  support: -1.65,
  plate: -2.3,
  wheelA: -2.95, wheelB: -3.4,
  bridge: -3.9,
  balance: -4.5,
  cock: -5.1,
  rotor: -5.9,
  cbCrystal: -7.15,       // caseback crystal centre (0.7 thick)
  caseTop: 1.8, caseBot: -7.0,
  lugMid: -2.4,
};

export const R = {
  case: 19.8, bezelOut: 19.5, bezelIn: 17.6, crystal: 17.4,
  chapterIn: 14.9, chapterOut: 17.3,
  dial: 15.3, movement: 14.9,
};

export const DATE = { x: 10.55, y: 0, w: 5.4, h: 3.6 };

// Movement layout (x, y in mm, relative to the dial centre)
export const MOVEMENT = {
  barrel: [-5.6, 5.3],
  center: [0, 0],
  third: [5.35, -2.49],
  fourth: [4.06, -7.32],
  escape: [-0.47, -8.12],
  fork: [-3.9, -12.0],
  balance: [-7.4, -4.9],
};
