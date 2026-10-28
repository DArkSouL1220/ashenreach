export interface Pt {
  x: number;
  y: number;
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Noise2D = (x: number, y: number) => number;

export function makeNoise(rng: () => number, size = 64): Noise2D {
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const at = (a: number, b: number) => g[(((b % size) + size) % size) * size + (((a % size) + size) % size)];
  const sm = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = sm(x - xi), w = sm(y - yi);
    return lerp(lerp(at(xi, yi), at(xi + 1, yi), u), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), u), w);
  };
}

export function fbm(n: Noise2D, x: number, y: number, oct = 3): number {
  let s = 0, a = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    s += a * n(x, y);
    norm += a;
    a *= 0.5;
    x *= 2;
    y *= 2;
  }
  return s / norm;
}
