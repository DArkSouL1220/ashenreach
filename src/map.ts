import { fbm, makeNoise, mulberry32 } from './math';

export const TILE = 32;
export const MAP_W = 72;
export const MAP_H = 72;
export const T_GRASS = 0;
export const T_WATER = 1;
export const T_TREE = 2;

// blocked-Bits: 1 = Gelände (Wasser/Baum), 2 = Gebäude/Mine
export const B_TERRAIN = 1;
export const B_BUILDING = 2;

export interface TilePos {
  tx: number;
  ty: number;
}

export interface MinePlacement extends TilePos {
  gold: number;
}

export interface MapLayout {
  playerKeep: TilePos;
  enemyCrypt: TilePos;
  mines: MinePlacement[];
}

export class GameMap {
  tiles = new Uint8Array(MAP_W * MAP_H);
  wood = new Uint16Array(MAP_W * MAP_H);
  blocked = new Uint8Array(MAP_W * MAP_H);
  shade = new Uint8Array(MAP_W * MAP_H);
  layout: MapLayout;
  onTileChanged: ((tx: number, ty: number) => void) | null = null;

  constructor(seed: number) {
    const rng = mulberry32(seed);
    const nShade = makeNoise(rng), nTree = makeNoise(rng), nWater = makeNoise(rng);

    this.layout = {
      playerKeep: { tx: 11, ty: 59 },
      enemyCrypt: { tx: 59, ty: 10 },
      mines: [
        { tx: 4, ty: 54, gold: 6000 },
        { tx: 66, ty: 4, gold: 8000 },
        { tx: 34, ty: 35, gold: 5000 },
        { tx: 9, ty: 15, gold: 4000 },
        { tx: 61, ty: 56, gold: 4000 },
      ],
    };

    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const i = this.idx(tx, ty);
        this.shade[i] = Math.floor(fbm(nShade, tx / 9, ty / 9, 3) * 255);
        const t = fbm(nTree, tx / 7.5, ty / 7.5, 3);
        const w = fbm(nWater, tx / 14 + 3, ty / 14 + 3, 2);
        let tile = T_GRASS;
        if (w > 0.66) tile = T_WATER;
        else if (t > 0.58 || tx === 0 || ty === 0 || tx === MAP_W - 1 || ty === MAP_H - 1) tile = T_TREE;
        this.tiles[i] = tile;
        if (tile === T_TREE) this.wood[i] = 40 + Math.floor(rng() * 50);
      }
    }

    // Basen und Minen freiräumen
    const clear = (cx: number, cy: number, r: number) => {
      for (let ty = cy - r; ty <= cy + r; ty++)
        for (let tx = cx - r; tx <= cx + r; tx++)
          if (this.inBounds(tx, ty) && tx > 0 && ty > 0 && tx < MAP_W - 1 && ty < MAP_H - 1 && (tx - cx) ** 2 + (ty - cy) ** 2 <= r * r) {
            this.tiles[this.idx(tx, ty)] = T_GRASS;
            this.wood[this.idx(tx, ty)] = 0;
          }
    };
    const L = this.layout;
    clear(L.playerKeep.tx + 1, L.playerKeep.ty + 1, 9);
    clear(L.enemyCrypt.tx + 1, L.enemyCrypt.ty + 1, 10);
    for (const m of L.mines) clear(m.tx + 1, m.ty + 1, 4);

    for (let i = 0; i < this.tiles.length; i++) this.blocked[i] = this.tiles[i] === T_GRASS ? 0 : B_TERRAIN;

    // Erreichbarkeit sicherstellen
    const pk = { tx: L.playerKeep.tx + 1, ty: L.playerKeep.ty - 2 };
    const ec = { tx: L.enemyCrypt.tx + 1, ty: L.enemyCrypt.ty + 4 };
    const mid = { tx: L.mines[2].tx + 1, ty: L.mines[2].ty + 4 };
    this.ensureConnected(pk, mid);
    this.ensureConnected(mid, ec);
    for (const m of L.mines) this.ensureConnected(pk, { tx: m.tx + 1, ty: m.ty + 4 });
  }

  idx(tx: number, ty: number) {
    return ty * MAP_W + tx;
  }

  inBounds(tx: number, ty: number) {
    return tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H;
  }

  isBlocked(tx: number, ty: number) {
    return !this.inBounds(tx, ty) || this.blocked[this.idx(tx, ty)] !== 0;
  }

  isBlockedWorld(wx: number, wy: number) {
    return this.isBlocked(Math.floor(wx / TILE), Math.floor(wy / TILE));
  }

  tileAt(tx: number, ty: number) {
    return this.inBounds(tx, ty) ? this.tiles[this.idx(tx, ty)] : T_TREE;
  }

  setTile(tx: number, ty: number, t: number) {
    const i = this.idx(tx, ty);
    this.tiles[i] = t;
    if (t === T_GRASS) this.blocked[i] &= ~B_TERRAIN;
    else this.blocked[i] |= B_TERRAIN;
    if (t !== T_TREE) this.wood[i] = 0;
    this.onTileChanged?.(tx, ty);
  }

  setBuildingBlock(tx: number, ty: number, size: number, on: boolean) {
    for (let y = ty; y < ty + size; y++)
      for (let x = tx; x < tx + size; x++) {
        if (!this.inBounds(x, y)) continue;
        const i = this.idx(x, y);
        if (on) this.blocked[i] |= B_BUILDING;
        else this.blocked[i] &= ~B_BUILDING;
      }
  }

  canPlace(tx: number, ty: number, size: number) {
    for (let y = ty; y < ty + size; y++)
      for (let x = tx; x < tx + size; x++) if (this.isBlocked(x, y)) return false;
    return true;
  }

  findNearestFree(tx: number, ty: number, maxR = 14): TilePos | null {
    if (!this.isBlocked(tx, ty)) return { tx, ty };
    for (let r = 1; r <= maxR; r++) {
      let best: TilePos | null = null, bestD = Infinity;
      for (let y = ty - r; y <= ty + r; y++)
        for (let x = tx - r; x <= tx + r; x++) {
          if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== r) continue;
          if (this.isBlocked(x, y)) continue;
          const d = (x - tx) ** 2 + (y - ty) ** 2;
          if (d < bestD) {
            bestD = d;
            best = { tx: x, ty: y };
          }
        }
      if (best) return best;
    }
    return null;
  }

  /** Nächster Baum mit Holz und mindestens einem freien Nachbarfeld. */
  findNearestTree(wx: number, wy: number, maxR = 24): TilePos | null {
    const cx = Math.floor(wx / TILE), cy = Math.floor(wy / TILE);
    for (let r = 0; r <= maxR; r++) {
      for (let y = cy - r; y <= cy + r; y++)
        for (let x = cx - r; x <= cx + r; x++) {
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
          if (!this.inBounds(x, y) || this.tiles[this.idx(x, y)] !== T_TREE || this.wood[this.idx(x, y)] <= 0) continue;
          if (!this.isBlocked(x + 1, y) || !this.isBlocked(x - 1, y) || !this.isBlocked(x, y + 1) || !this.isBlocked(x, y - 1)) return { tx: x, ty: y };
        }
    }
    return null;
  }

  /** Freie Kacheln im Ring um ein Rechteck (Abstand `ring`). */
  ringTiles(tx: number, ty: number, size: number, ring = 1): TilePos[] {
    const out: TilePos[] = [];
    for (let y = ty - ring; y < ty + size + ring; y++)
      for (let x = tx - ring; x < tx + size + ring; x++) {
        const inside = x >= tx - ring + 1 && x < tx + size + ring - 1 && y >= ty - ring + 1 && y < ty + size + ring - 1;
        if (inside) continue;
        if (!this.isBlocked(x, y)) out.push({ tx: x, ty: y });
      }
    return out;
  }

  private ensureConnected(a: TilePos, b: TilePos) {
    if (this.reachable(a, b)) return;
    // geraden Korridor freischlagen
    let x0 = a.tx, y0 = a.ty;
    const x1 = b.tx, y1 = b.ty;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const x = x0 + ox, y = y0 + oy;
          if (x > 0 && y > 0 && x < MAP_W - 1 && y < MAP_H - 1) {
            const i = this.idx(x, y);
            this.tiles[i] = T_GRASS;
            this.wood[i] = 0;
            this.blocked[i] &= ~B_TERRAIN;
          }
        }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  private reachable(a: TilePos, b: TilePos) {
    const start = this.findNearestFree(a.tx, a.ty), goal = this.findNearestFree(b.tx, b.ty);
    if (!start || !goal) return false;
    const seen = new Uint8Array(MAP_W * MAP_H);
    const q: number[] = [this.idx(start.tx, start.ty)];
    seen[q[0]] = 1;
    const goalI = this.idx(goal.tx, goal.ty);
    while (q.length) {
      const i = q.pop()!;
      if (i === goalI) return true;
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (const [nx, ny] of nb) {
        if (this.isBlocked(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (!seen[j]) {
          seen[j] = 1;
          q.push(j);
        }
      }
    }
    return false;
  }
}
