import { GameMap, MAP_H, MAP_W, TILE } from './map';
import { Pt } from './math';

const N = MAP_W * MAP_H;
const gScore = new Float32Array(N);
const hScore = new Float32Array(N);
const parent = new Int32Array(N);
const stampOf = new Uint32Array(N);
const closedAt = new Uint32Array(N);
let stamp = 0;

// Binärer Heap über Knotenindizes, Schlüssel = g + h
const heap: number[] = [];
const heapKey = (i: number) => gScore[i] + hScore[i];
function heapPush(i: number) {
  heap.push(i);
  let c = heap.length - 1;
  while (c > 0) {
    const p = (c - 1) >> 1;
    if (heapKey(heap[p]) <= heapKey(heap[c])) break;
    [heap[p], heap[c]] = [heap[c], heap[p]];
    c = p;
  }
}
function heapPop(): number {
  const top = heap[0];
  const last = heap.pop()!;
  if (heap.length) {
    heap[0] = last;
    let p = 0;
    for (;;) {
      const l = p * 2 + 1, r = l + 1;
      let m = p;
      if (l < heap.length && heapKey(heap[l]) < heapKey(heap[m])) m = l;
      if (r < heap.length && heapKey(heap[r]) < heapKey(heap[m])) m = r;
      if (m === p) break;
      [heap[p], heap[m]] = [heap[m], heap[p]];
      p = m;
    }
  }
  return top;
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.4142], [-1, 1, 1.4142], [1, -1, 1.4142], [-1, -1, 1.4142],
];

/**
 * A* auf dem Kachelgitter. Liefert Weltpunkte (Kachelmitten) ohne den Startpunkt.
 * Ist das Ziel unerreichbar, wird zum nächstgelegenen erreichten Knoten gelaufen.
 */
export function findPath(map: GameMap, sx: number, sy: number, gx: number, gy: number, maxIter = 9000): Pt[] | null {
  if (!map.inBounds(sx, sy) || !map.inBounds(gx, gy)) return null;
  stamp++;
  heap.length = 0;
  const goal = gy * MAP_W + gx;
  const start = sy * MAP_W + sx;
  const h = (i: number) => {
    const dx = Math.abs((i % MAP_W) - gx), dy = Math.abs(((i / MAP_W) | 0) - gy);
    return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy);
  };
  gScore[start] = 0;
  hScore[start] = h(start);
  parent[start] = -1;
  stampOf[start] = stamp;
  heapPush(start);
  let best = start, bestH = hScore[start];
  let iter = 0;
  let found = false;
  while (heap.length && iter++ < maxIter) {
    const cur = heapPop();
    if (closedAt[cur] === stamp) continue;
    closedAt[cur] = stamp;
    if (cur === goal) { found = true; break; }
    if (hScore[cur] < bestH) { bestH = hScore[cur]; best = cur; }
    const cx = cur % MAP_W, cy = (cur / MAP_W) | 0;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (map.isBlocked(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (map.isBlocked(cx + dx, cy) || map.isBlocked(cx, cy + dy))) continue;
      const ni = ny * MAP_W + nx;
      if (closedAt[ni] === stamp) continue;
      const ng = gScore[cur] + cost;
      if (stampOf[ni] !== stamp || ng < gScore[ni]) {
        stampOf[ni] = stamp;
        gScore[ni] = ng;
        hScore[ni] = h(ni);
        parent[ni] = cur;
        heapPush(ni);
      }
    }
  }
  const end = found ? goal : best;
  if (end === start) return found ? [] : null;
  const tiles: number[] = [];
  for (let i = end; i !== -1 && i !== start; i = parent[i]) tiles.push(i);
  tiles.reverse();
  const pts = tiles.map((i) => ({ x: (i % MAP_W) * TILE + TILE / 2, y: ((i / MAP_W) | 0) * TILE + TILE / 2 }));
  return smooth(map, { x: sx * TILE + TILE / 2, y: sy * TILE + TILE / 2 }, pts);
}

/** Prüft, ob die Strecke frei von blockierten Kacheln ist (mit kleinem Sicherheitsabstand). */
export function lineFree(map: GameMap, x0: number, y0: number, x1: number, y1: number, margin = 9): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(d / 6));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    if (map.isBlockedWorld(x, y)) return false;
    if (map.isBlockedWorld(x + margin, y) || map.isBlockedWorld(x - margin, y) || map.isBlockedWorld(x, y + margin) || map.isBlockedWorld(x, y - margin)) return false;
  }
  return true;
}

function smooth(map: GameMap, start: Pt, pts: Pt[]): Pt[] {
  if (pts.length <= 1) return pts;
  const out: Pt[] = [];
  let from = start;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !lineFree(map, from.x, from.y, pts[j].x, pts[j].y)) j--;
    out.push(pts[j]);
    from = pts[j];
    i = j + 1;
  }
  return out;
}
