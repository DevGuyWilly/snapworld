// Night palette tuned against Snap Map's 3D view. Hex values are sRGB.

export const palette = {
  background: 0x1b1e3c,
  fog: 0x1e2144,

  ground: 0x292c50,
  road: 0x1d1f3b,
  roadMajor: 0x1a1c36,
  path: 0x25284b,
  pedestrian: 0x2b2e54,
  grass: 0x2c585e,
  wood: 0x284f56,
  pitch: 0x30605f,
  water: 0x182a58,

  walls: [0x3a3d74, 0x35386c, 0x3f427a, 0x323566, 0x3c3e70],
  roofs: [0x2e3060, 0x2b2d5a, 0x323466, 0x2c2e58],

  treeRound: [0xa0614c, 0x8f7c4e, 0x76854f, 0xab7353, 0x7d5c43, 0x93694a, 0x5f7f63, 0xb4855a],
  treePine: [0x3f6d60, 0x36615a, 0x4a7768, 0x2f5a52],
  trunk: 0x5a4038,
};

/** sRGB hex → linear RGB triple (what three expects in vertex colour attributes). */
export function linearRGB(hex: number): [number, number, number] {
  const f = (c: number) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
}
