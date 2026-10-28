import {
  ABILITIES, BUILDINGS, BuildingDef, CARRY_AMOUNT, DAY_LENGTH, Faction, GOLD_MINE_TIME, HERO_MAX_LEVEL, HERO_XP_PER_LEVEL, MAX_SUPPLY,
  SIEGE_BUILDING_MULT, SIEGE_UNIT_MULT, UNITS, UPGRADES, UnitDef, WOOD_CHOP_TIME, hostile,
} from './defs';
import { EnemyAI, AiState } from './ai';
import { GameMap, MAP_H, MAP_W, T_GRASS, T_TREE, TILE, TilePos } from './map';
import { dist, Pt } from './math';
import { findPath } from './path';
import { sound } from './sound';

/** Reichweite für Sammeln/Bauen/Abliefern: deckt auch diagonale Nachbarfelder ab. */
const INTERACT_RANGE = 17;
const SAVE_KEY = 'ashenreach-save-v2';

export type Order =
  | { kind: 'idle' }
  | { kind: 'move'; x: number; y: number }
  | { kind: 'attackmove'; x: number; y: number }
  | { kind: 'attack'; target: Entity; resume: Order | null }
  | { kind: 'gather'; res: 'gold' | 'wood'; mine: Mine | null; tree: TilePos | null }
  | { kind: 'return'; then: Order }
  | { kind: 'build'; building: Building };

const IDLE: Order = { kind: 'idle' };

interface EntityBase {
  id: number;
  faction: Faction;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  sight: number;
  radius: number;
}

export interface Unit extends EntityBase {
  type: 'unit';
  def: UnitDef;
  order: Order;
  path: Pt[];
  pathIdx: number;
  goal: Pt | null;
  cooldown: number;
  abilityCd: number;
  blessCd: number;
  acquireTimer: number;
  repathTimer: number;
  waitTimer: number;
  facing: number;
  carry: { res: 'gold' | 'wood'; amount: number } | null;
  gatherTimer: number;
  level: number;
  xp: number;
  stuck: number;
  stuckCount: number;
  lastX: number;
  lastY: number;
  attackAnim: number;
  walkPhase: number;
  moving: boolean;
  home: Pt | null; // Kreaturen kehren hierher zurück
}

export interface QueueItem {
  id: string; // Einheit oder "up:<upgrade>"
  t: number;
  total: number;
}

export interface Building extends EntityBase {
  type: 'building';
  def: BuildingDef;
  tx: number;
  ty: number;
  size: number;
  progress: number;
  built: boolean;
  queue: QueueItem[];
  cooldown: number;
  supplyWarn: number;
  rally: Pt | null;
  smoke: number;
}

export interface Mine extends EntityBase {
  type: 'mine';
  tx: number;
  ty: number;
  size: number;
  gold: number;
}

export type Entity = Unit | Building | Mine;

export interface Effect {
  kind: 'ring' | 'hit' | 'death' | 'ping' | 'pingAttack' | 'text' | 'boom' | 'levelup' | 'heal' | 'blood' | 'rally' | 'smoke';
  x: number;
  y: number;
  t: number;
  dur: number;
  r: number;
  color: string;
  text?: string;
}

export interface Projectile {
  x: number;
  y: number;
  target: Entity;
  tx: number;
  ty: number;
  speed: number;
  damage: number;
  attacker: Entity;
  kind: 'arrow' | 'bolt' | 'rock' | 'spit';
  arc: number; // Flughöhe für Bögen
  total: number;
  travelled: number;
}

export interface Resources {
  gold: number;
  wood: number;
}

export type MoveResult = 'inrange' | 'moving' | 'fail';
export type Side = 'player' | 'enemy';

export interface Alert {
  x: number;
  y: number;
  t: number;
}

interface SaveData {
  v: number;
  seed: number;
  time: number;
  res: Record<Side, Resources>;
  research: Record<Side, Record<string, number>>;
  hero: { level: number; xp: number; summoned: boolean };
  stats: { killed: number; lost: number; waves: number };
  ai: AiState;
  tiles: number[];
  wood: number[];
  vis: number[];
  mines: { tx: number; ty: number; gold: number }[];
  units: { def: string; faction: Faction; x: number; y: number; hp: number; level: number; xp: number; carry: Unit['carry']; gather: 'gold' | 'wood' | null; home: Pt | null }[];
  buildings: { def: string; faction: Faction; tx: number; ty: number; hp: number; progress: number; built: boolean; queue: QueueItem[]; rally: Pt | null }[];
}

export class Game {
  map: GameMap;
  seed: number;
  units: Unit[] = [];
  buildings: Building[] = [];
  mines: Mine[] = [];
  nextId = 1;
  time = 0;
  res: Record<Side, Resources> = { player: { gold: 300, wood: 150 }, enemy: { gold: 1e9, wood: 1e9 } };
  research: Record<Side, Record<string, number>> = { player: { attack: 0, armor: 0 }, enemy: { attack: 0, armor: 0 } };
  selection: Entity[] = [];
  selectionVersion = 0;
  effects: Effect[] = [];
  projectiles: Projectile[] = [];
  messages: { text: string; t: number }[] = [];
  vis = new Uint8Array(MAP_W * MAP_H); // 0 unerforscht, 1 erforscht, 2 sichtbar
  fogTimer = 0;
  fogVersion = 0;
  result: 'none' | 'victory' | 'defeat' = 'none';
  heroLevel = 1;
  heroXp = 0;
  heroSummoned = false;
  ai = new EnemyAI();
  stats = { killed: 0, lost: 0, waves: 0 };
  alert: Alert | null = null;
  private alertTimer = 0;
  private grid = new Map<number, Unit[]>();
  private autosave = 30;

  constructor(seed: number, save?: SaveData) {
    this.seed = seed;
    this.map = new GameMap(seed);
    if (save) this.restore(save);
    else this.setup();
    this.updateFog();
  }

  // ---------- Aufbau ----------

  private setup() {
    const L = this.map.layout;
    for (const m of L.mines) this.addMine(m.tx, m.ty, m.gold);

    const keep = this.placeBuilding('keep', 'player', L.playerKeep.tx, L.playerKeep.ty, true)!;
    const hero = this.spawnUnit('warden', 'player', keep.x + 70, keep.y - 40);
    if (hero) this.heroSummoned = true;
    for (let i = 0; i < 4; i++) this.spawnUnit('worker', 'player', keep.x - 20 + i * 22, keep.y + 70);
    const mine = this.mines[0];
    for (const u of this.units) if (u.def.kind === 'worker') u.order = { kind: 'gather', res: 'gold', mine, tree: null };

    const E = L.enemyCrypt;
    this.placeBuilding('crypt', 'enemy', E.tx, E.ty, true);
    this.placeBuilding('pit', 'enemy', E.tx - 5, E.ty + 3, true);
    this.placeBuilding('pit', 'enemy', E.tx + 4, E.ty + 5, true);
    this.placeBuilding('mound', 'enemy', E.tx - 2, E.ty + 6, true);
    this.placeBuilding('mound', 'enemy', E.tx + 1, E.ty + 7, true);
    this.placeBuilding('mound', 'enemy', E.tx + 5, E.ty + 1, true);
    this.placeBuilding('spire', 'enemy', E.tx - 4, E.ty + 8, true);
    this.placeBuilding('spire', 'enemy', E.tx + 2, E.ty + 10, true);
    const crypt = this.buildings.find((b) => b.def.id === 'crypt')!;
    for (let i = 0; i < 4; i++) this.spawnUnit('husk', 'enemy', crypt.x - 60 + i * 40, crypt.y + 130);
    for (let i = 0; i < 2; i++) this.spawnUnit('spitter', 'enemy', crypt.x - 30 + i * 50, crypt.y + 165);

    // Kreaturenlager an den freien Minen
    const camp = (m: Mine, list: string[]) => {
      list.forEach((id, i) => {
        const a = (i / list.length) * Math.PI * 2;
        const u = this.spawnUnit(id, 'creep', m.x + Math.cos(a) * 85, m.y + 60 + Math.sin(a) * 50);
        if (u) u.home = { x: u.x, y: u.y };
      });
    };
    camp(this.mines[2], ['brute', 'wolf', 'wolf']);
    camp(this.mines[3], ['wolf', 'wolf', 'wolf']);
    camp(this.mines[4], ['wolf', 'wolf', 'wolf']);
    camp(this.mines[1], ['wolf', 'wolf']);
  }

  addMine(tx: number, ty: number, gold: number) {
    const size = 3;
    const m: Mine = {
      id: this.nextId++, type: 'mine', faction: 'neutral', tx, ty, size, gold,
      x: tx * TILE + (size * TILE) / 2, y: ty * TILE + (size * TILE) / 2, hp: 1, maxHp: 1, dead: false, sight: 0, radius: 48,
    };
    this.map.setBuildingBlock(tx, ty, size, true);
    this.mines.push(m);
    return m;
  }

  spawnUnit(defId: string, faction: Faction, x: number, y: number): Unit | null {
    const def = UNITS[defId];
    const free = this.map.findNearestFree(Math.floor(x / TILE), Math.floor(y / TILE));
    if (!free) return null;
    if (this.map.isBlockedWorld(x, y)) {
      x = free.tx * TILE + TILE / 2;
      y = free.ty * TILE + TILE / 2;
    }
    const u: Unit = {
      id: this.nextId++, type: 'unit', faction, def, x, y, hp: def.hp, maxHp: def.hp, dead: false, sight: def.sight, radius: def.radius,
      order: IDLE, path: [], pathIdx: 0, goal: null, cooldown: 0, abilityCd: 0, blessCd: 0, acquireTimer: Math.random() * 0.3, repathTimer: 0, waitTimer: 0,
      facing: faction === 'player' ? -Math.PI / 2 : Math.PI / 2, carry: null, gatherTimer: 0, level: 1, xp: 0, stuck: 0, stuckCount: 0, lastX: x, lastY: y,
      attackAnim: 0, walkPhase: Math.random() * 6, moving: false, home: null,
    };
    if (def.kind === 'hero' && faction === 'player') {
      u.level = this.heroLevel;
      u.xp = this.heroXp;
      u.maxHp = def.hp + 50 * (u.level - 1);
      u.hp = u.maxHp;
    }
    this.units.push(u);
    return u;
  }

  canPlaceBuilding(defId: string, tx: number, ty: number) {
    const def = BUILDINGS[defId];
    if (!this.map.canPlace(tx, ty, def.size)) return false;
    // Abstand zu Minen lassen, damit Sammler durchkommen
    for (const m of this.mines) {
      if (tx < m.tx + m.size + 1 && tx + def.size > m.tx - 1 && ty < m.ty + m.size + 1 && ty + def.size > m.ty - 1) return false;
    }
    return true;
  }

  placeBuilding(defId: string, faction: Faction, tx: number, ty: number, built: boolean): Building | null {
    const def = BUILDINGS[defId];
    if (!this.map.canPlace(tx, ty, def.size)) return null;
    const b: Building = {
      id: this.nextId++, type: 'building', faction, def, tx, ty, size: def.size,
      x: tx * TILE + (def.size * TILE) / 2, y: ty * TILE + (def.size * TILE) / 2,
      hp: built ? def.hp : Math.max(1, def.hp * 0.1), maxHp: def.hp, dead: false, sight: def.sight, radius: (def.size * TILE) / 2,
      progress: built ? 1 : 0, built, queue: [], cooldown: 0, supplyWarn: 0, rally: null, smoke: 0,
    };
    this.map.setBuildingBlock(tx, ty, def.size, true);
    this.buildings.push(b);
    this.pushUnitsOut(b);
    return b;
  }

  private pushUnitsOut(b: Building) {
    for (const u of this.units) {
      const tx = Math.floor(u.x / TILE), ty = Math.floor(u.y / TILE);
      if (tx >= b.tx && tx < b.tx + b.size && ty >= b.ty && ty < b.ty + b.size) {
        const f = this.map.findNearestFree(tx, ty);
        if (f) {
          u.x = f.tx * TILE + TILE / 2;
          u.y = f.ty * TILE + TILE / 2;
        }
      }
    }
  }

  // ---------- Speichern ----------

  toSave(): SaveData {
    const gatherOf = (u: Unit): 'gold' | 'wood' | null => {
      if (u.order.kind === 'gather') return u.order.res;
      if (u.order.kind === 'return' && u.order.then.kind === 'gather') return u.order.then.res;
      return u.carry ? u.carry.res : null;
    };
    return {
      v: 2, seed: this.seed, time: this.time, res: this.res, research: this.research,
      hero: { level: this.heroLevel, xp: this.heroXp, summoned: this.heroSummoned }, stats: this.stats, ai: this.ai.state(),
      tiles: Array.from(this.map.tiles), wood: Array.from(this.map.wood), vis: Array.from(this.vis),
      mines: this.mines.map((m) => ({ tx: m.tx, ty: m.ty, gold: m.gold })),
      units: this.units.filter((u) => !u.dead).map((u) => ({ def: u.def.id, faction: u.faction, x: u.x, y: u.y, hp: u.hp, level: u.level, xp: u.xp, carry: u.carry, gather: gatherOf(u), home: u.home })),
      buildings: this.buildings.filter((b) => !b.dead).map((b) => ({ def: b.def.id, faction: b.faction, tx: b.tx, ty: b.ty, hp: b.hp, progress: b.progress, built: b.built, queue: b.queue, rally: b.rally })),
    };
  }

  private restore(s: SaveData) {
    this.time = s.time;
    this.res = s.res;
    this.research = s.research;
    this.heroLevel = s.hero.level;
    this.heroXp = s.hero.xp;
    this.heroSummoned = s.hero.summoned;
    this.stats = s.stats;
    this.ai.load(s.ai);
    this.map.tiles.set(s.tiles);
    this.map.wood.set(s.wood);
    for (let i = 0; i < this.map.tiles.length; i++) this.map.blocked[i] = this.map.tiles[i] === T_GRASS ? 0 : 1;
    this.vis.set(s.vis);
    for (const m of s.mines) this.addMine(m.tx, m.ty, m.gold);
    for (const b of s.buildings) {
      const nb = this.placeBuilding(b.def, b.faction, b.tx, b.ty, b.built);
      if (!nb) continue;
      nb.hp = b.hp;
      nb.progress = b.progress;
      nb.queue = b.queue;
      nb.rally = b.rally;
    }
    for (const u of s.units) {
      const nu = this.spawnUnit(u.def, u.faction, u.x, u.y);
      if (!nu) continue;
      nu.hp = Math.min(u.hp, nu.maxHp);
      nu.level = u.level;
      nu.xp = u.xp;
      nu.carry = u.carry;
      nu.home = u.home;
      if (nu.def.kind === 'hero') {
        nu.maxHp = nu.def.hp + 50 * (nu.level - 1);
        nu.hp = Math.min(u.hp, nu.maxHp);
      }
      if (u.gather === 'gold') nu.order = { kind: 'gather', res: 'gold', mine: this.nearestMine(nu.x, nu.y), tree: null };
      else if (u.gather === 'wood') nu.order = { kind: 'gather', res: 'wood', mine: null, tree: null };
    }
    // Baustellen weiterbauen lassen
    for (const b of this.buildings) {
      if (b.built || b.faction !== 'player') continue;
      const w = this.units.find((u) => u.faction === 'player' && u.def.kind === 'worker' && u.order.kind === 'idle');
      if (w) w.order = { kind: 'build', building: b };
    }
  }

  save(): boolean {
    if (this.result !== 'none') return false;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.toSave()));
      return true;
    } catch {
      return false;
    }
  }

  static hasSave(): boolean {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch {
      return false;
    }
  }

  static load(): Game | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as SaveData;
      if (s.v !== 2) return null;
      return new Game(s.seed, s);
    } catch {
      return null;
    }
  }

  static clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* egal */
    }
  }

  // ---------- Abfragen ----------

  dayFrac() {
    return (this.time % DAY_LENGTH) / DAY_LENGTH;
  }

  /** 0 = heller Tag, 1 = tiefste Nacht */
  nightAmount() {
    const f = this.dayFrac();
    if (f < 0.5) return 0;
    const n = (f - 0.5) / 0.5; // 0..1 über die Nachthälfte
    return Math.sin(n * Math.PI);
  }

  isNight() {
    return this.nightAmount() > 0.35;
  }

  unitSight(u: Unit) {
    return u.sight * (this.isNight() ? 0.7 : 1);
  }

  supplyUsed(f: Side) {
    let s = 0;
    for (const u of this.units) if (u.faction === f && !u.dead) s += u.def.supply;
    for (const b of this.buildings) if (b.faction === f && !b.dead) for (const q of b.queue) if (!q.id.startsWith('up:')) s += UNITS[q.id].supply;
    return s;
  }

  supplyCap(f: Side) {
    let s = 0;
    for (const b of this.buildings) if (b.faction === f && !b.dead && b.built) s += b.def.supply;
    return Math.min(MAX_SUPPLY, s);
  }

  hasBuilding(f: Faction, defId: string) {
    return this.buildings.some((b) => b.faction === f && b.def.id === defId && b.built && !b.dead);
  }

  hero(f: Faction): Unit | null {
    return this.units.find((u) => u.faction === f && u.def.kind === 'hero' && !u.dead) ?? null;
  }

  heroCost() {
    return this.heroSummoned ? 100 * this.heroLevel : UNITS.warden.gold;
  }

  heroQueued() {
    return this.buildings.some((b) => b.faction === 'player' && b.queue.some((q) => q.id === 'warden'));
  }

  researchQueued(f: Faction, upId: string) {
    return this.buildings.some((b) => b.faction === f && b.queue.some((q) => q.id === 'up:' + upId));
  }

  unitDamage(u: Unit) {
    const up = u.faction === 'player' || u.faction === 'enemy' ? this.research[u.faction].attack * 2 : 0;
    return u.def.damage + (u.def.kind === 'hero' ? 4 * (u.level - 1) : 0) + (u.def.kind === 'worker' ? 0 : up);
  }

  unitArmor(u: Unit) {
    const up = u.faction === 'player' || u.faction === 'enemy' ? this.research[u.faction].armor : 0;
    return u.def.armor + (u.def.kind === 'hero' ? Math.floor((u.level - 1) / 2) : 0) + up;
  }

  idleWorkers(): Unit[] {
    return this.units.filter((u) => u.faction === 'player' && !u.dead && u.def.kind === 'worker' && u.order.kind === 'idle');
  }

  isVisible(x: number, y: number) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return this.map.inBounds(tx, ty) && this.vis[ty * MAP_W + tx] === 2;
  }

  isExplored(x: number, y: number) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return this.map.inBounds(tx, ty) && this.vis[ty * MAP_W + tx] >= 1;
  }

  /** Sichtbarkeit aus Spielersicht (Fremde nur, wenn ihre Kachel sichtbar bzw. Gebäude erforscht). */
  playerCanSee(e: Entity) {
    if (e.faction === 'player' || e.faction === 'neutral') return true;
    if (e.type === 'building') return this.isExplored(e.x, e.y);
    return this.isVisible(e.x, e.y);
  }

  rectOf(e: Entity): { x0: number; y0: number; x1: number; y1: number } | null {
    if (e.type === 'unit') return null;
    return { x0: e.tx * TILE, y0: e.ty * TILE, x1: (e.tx + e.size) * TILE, y1: (e.ty + e.size) * TILE };
  }

  edgeDist(a: Unit, b: Entity) {
    if (b.type === 'unit') return dist(a.x, a.y, b.x, b.y) - a.radius - b.radius;
    const r = this.rectOf(b)!;
    return this.rectDist(a, r.x0, r.y0, r.x1, r.y1);
  }

  rectDist(a: { x: number; y: number; radius: number }, x0: number, y0: number, x1: number, y1: number) {
    const dx = Math.max(x0 - a.x, 0, a.x - x1), dy = Math.max(y0 - a.y, 0, a.y - y1);
    return Math.hypot(dx, dy) - a.radius;
  }

  pickEntity(wx: number, wy: number): Entity | null {
    let best: Unit | null = null, bestD = Infinity;
    for (const u of this.units) {
      if (u.dead || !this.playerCanSee(u)) continue;
      // Figuren stehen aufrecht: Trefferfläche reicht nach oben
      const dx = wx - u.x, dy = wy - (u.y - u.radius * 0.8);
      const d = Math.hypot(dx, dy * 0.8);
      if (d <= u.radius + 10 && d < bestD) {
        bestD = d;
        best = u;
      }
    }
    if (best) return best;
    for (const b of this.buildings) {
      if (b.dead || !this.playerCanSee(b)) continue;
      const r = this.rectOf(b)!;
      if (wx >= r.x0 && wx < r.x1 && wy >= r.y0 - 24 && wy < r.y1) return b;
    }
    for (const m of this.mines) {
      const r = this.rectOf(m)!;
      if (wx >= r.x0 && wx < r.x1 && wy >= r.y0 && wy < r.y1) return m;
    }
    return null;
  }

  mineAt(wx: number, wy: number): Mine | null {
    for (const m of this.mines) {
      const r = this.rectOf(m)!;
      if (wx >= r.x0 && wx < r.x1 && wy >= r.y0 && wy < r.y1) return m;
    }
    return null;
  }

  unitsInRect(x0: number, y0: number, x1: number, y1: number): Unit[] {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    return this.units.filter((u) => u.faction === 'player' && !u.dead && u.x >= ax && u.x <= bx && u.y - u.radius >= ay - 20 && u.y <= by);
  }

  nearestEnemy(e: Entity, range: number, unitsOnly = false): Entity | null {
    let best: Entity | null = null, bestD = Infinity;
    const measure = (t: Entity) => (e.type === 'unit' ? this.edgeDist(e, t) : dist(e.x, e.y, t.x, t.y) - e.radius - t.radius);
    for (const u of this.units) {
      if (u.dead || !hostile(e.faction, u.faction)) continue;
      if (e.faction === 'player' && !this.isVisible(u.x, u.y)) continue;
      const d = measure(u);
      if (d <= range && d < bestD) {
        bestD = d;
        best = u;
      }
    }
    if (best || unitsOnly || e.faction === 'creep') return best;
    for (const b of this.buildings) {
      if (b.dead || !hostile(e.faction, b.faction)) continue;
      const d = measure(b);
      if (d <= range && d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  nearestHall(f: Faction, x: number, y: number): Building | null {
    let best: Building | null = null, bestD = Infinity;
    for (const b of this.buildings) {
      if (b.faction !== f || b.dead || !b.built || !b.def.isHall) continue;
      const d = dist(b.x, b.y, x, y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  nearestMine(x: number, y: number): Mine | null {
    let best: Mine | null = null, bestD = Infinity;
    for (const m of this.mines) {
      if (m.gold <= 0) continue;
      const d = dist(m.x, m.y, x, y);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  // ---------- Auswahl ----------

  select(list: Entity[]) {
    this.selection = list.filter((e) => !e.dead);
    this.selectionVersion++;
  }

  selectedPlayerUnits(): Unit[] {
    return this.selection.filter((e): e is Unit => e.type === 'unit' && e.faction === 'player' && !e.dead);
  }

  selectedPlayerBuildings(): Building[] {
    return this.selection.filter((e): e is Building => e.type === 'building' && e.faction === 'player' && !e.dead);
  }

  // ---------- Befehle ----------

  msg(text: string) {
    if (this.messages.length && this.messages[this.messages.length - 1].text === text && this.messages[this.messages.length - 1].t < 1.5) return;
    this.messages.push({ text, t: 0 });
    if (this.messages.length > 4) this.messages.shift();
  }

  private resetMotion(u: Unit) {
    u.path = [];
    u.pathIdx = 0;
    u.goal = null;
    u.repathTimer = 0;
    u.waitTimer = 0;
    u.stuck = 0;
    u.stuckCount = 0;
    u.lastX = u.x;
    u.lastY = u.y;
    u.gatherTimer = 0;
  }

  cmdMove(units: Unit[], x: number, y: number) {
    this.spreadOrders(units, x, y, (px, py) => ({ kind: 'move', x: px, y: py }));
    if (units.some((u) => u.faction === 'player')) {
      this.effects.push({ kind: 'ping', x, y, t: 0, dur: 0.7, r: 14, color: '#5bd46b' });
      sound.play('move');
    }
  }

  cmdAttackMove(units: Unit[], x: number, y: number) {
    this.spreadOrders(units, x, y, (px, py) => ({ kind: 'attackmove', x: px, y: py }));
    if (units.some((u) => u.faction === 'player')) {
      this.effects.push({ kind: 'pingAttack', x, y, t: 0, dur: 0.7, r: 14, color: '#ff6b5b' });
      sound.play('move');
    }
  }

  private spreadOrders(units: Unit[], x: number, y: number, make: (px: number, py: number) => Order) {
    // Zielpunkte in einer kleinen Spirale verteilen, damit Gruppen nicht alle auf denselben Punkt laufen
    const n = units.length;
    units.forEach((u, i) => {
      let px = x, py = y;
      if (n > 1) {
        const ring = Math.floor(Math.sqrt(i));
        const a = i * 2.4;
        px += Math.cos(a) * ring * 24;
        py += Math.sin(a) * ring * 24;
      }
      if (this.map.isBlockedWorld(px, py)) {
        const f = this.map.findNearestFree(Math.floor(px / TILE), Math.floor(py / TILE));
        if (f) {
          px = f.tx * TILE + TILE / 2;
          py = f.ty * TILE + TILE / 2;
        }
      }
      this.resetMotion(u);
      u.order = make(px, py);
    });
  }

  cmdAttack(units: Unit[], target: Entity) {
    for (const u of units) {
      this.resetMotion(u);
      u.order = { kind: 'attack', target, resume: null };
    }
    this.effects.push({ kind: 'pingAttack', x: target.x, y: target.y, t: 0, dur: 0.7, r: target.radius + 6, color: '#ff6b5b' });
    sound.play('move');
  }

  cmdStop(units: Unit[]) {
    for (const u of units) {
      this.resetMotion(u);
      u.order = IDLE;
    }
  }

  cmdGatherGold(units: Unit[], mine: Mine) {
    for (const u of units) {
      this.resetMotion(u);
      if (u.def.kind !== 'worker') u.order = { kind: 'move', x: mine.x, y: mine.y + mine.radius + 20 };
      else u.order = { kind: 'gather', res: 'gold', mine, tree: null };
    }
    this.effects.push({ kind: 'ping', x: mine.x, y: mine.y, t: 0, dur: 0.7, r: 20, color: '#f5c542' });
    sound.play('move');
  }

  cmdGatherWood(units: Unit[], tree: TilePos) {
    for (const u of units) {
      this.resetMotion(u);
      if (u.def.kind !== 'worker') u.order = { kind: 'move', x: tree.tx * TILE + TILE / 2, y: tree.ty * TILE + TILE / 2 };
      else u.order = { kind: 'gather', res: 'wood', mine: null, tree };
    }
    this.effects.push({ kind: 'ping', x: tree.tx * TILE + TILE / 2, y: tree.ty * TILE + TILE / 2, t: 0, dur: 0.7, r: 14, color: '#8b5a2b' });
    sound.play('move');
  }

  cmdReturn(units: Unit[]) {
    for (const u of units) {
      if (u.def.kind !== 'worker' || !u.carry) continue;
      this.resetMotion(u);
      const then: Order = u.carry.res === 'gold' ? { kind: 'gather', res: 'gold', mine: null, tree: null } : { kind: 'gather', res: 'wood', mine: null, tree: null };
      u.order = { kind: 'return', then };
    }
  }

  cmdHelpBuild(units: Unit[], b: Building) {
    for (const u of units) {
      this.resetMotion(u);
      if (u.def.kind !== 'worker') u.order = { kind: 'move', x: b.x, y: b.y + b.radius + 20 };
      else u.order = { kind: 'build', building: b };
    }
    sound.play('move');
  }

  cmdBuild(workers: Unit[], defId: string, tx: number, ty: number): boolean {
    const def = BUILDINGS[defId];
    const r = this.res.player;
    if (!this.canPlaceBuilding(defId, tx, ty)) {
      this.msg('Hier kann nicht gebaut werden.');
      sound.play('error');
      return false;
    }
    if (r.gold < def.gold || r.wood < def.wood) {
      this.msg('Nicht genug Rohstoffe.');
      sound.play('error');
      return false;
    }
    const ws = workers.filter((u) => u.def.kind === 'worker');
    if (!ws.length) return false;
    r.gold -= def.gold;
    r.wood -= def.wood;
    const b = this.placeBuilding(defId, 'player', tx, ty, false)!;
    for (const w of ws) {
      this.resetMotion(w);
      w.order = { kind: 'build', building: b };
    }
    this.effects.push({ kind: 'ping', x: b.x, y: b.y, t: 0, dur: 0.7, r: b.radius, color: '#5bd46b' });
    sound.play('build');
    return true;
  }

  cmdCancelBuilding(b: Building) {
    if (b.built || b.dead) return;
    this.res.player.gold += Math.floor(b.def.gold * 0.75);
    this.res.player.wood += Math.floor(b.def.wood * 0.75);
    this.killBuilding(b, false);
  }

  cmdRally(b: Building, x: number, y: number) {
    b.rally = { x, y };
    this.effects.push({ kind: 'rally', x, y, t: 0, dur: 0.8, r: 12, color: '#f2d16b' });
    sound.play('click');
  }

  canTrain(b: Building, defId: string): { ok: boolean; why?: string; gold: number; wood: number } {
    const def = UNITS[defId];
    const f = b.faction as Side;
    let gold = def.gold;
    if (defId === 'warden') gold = this.heroCost();
    if (def.requires && !this.hasBuilding(f, def.requires)) return { ok: false, why: `Benötigt ${BUILDINGS[def.requires].name}`, gold, wood: def.wood };
    if (this.res[f].gold < gold || this.res[f].wood < def.wood) return { ok: false, why: 'Nicht genug Rohstoffe.', gold, wood: def.wood };
    if (def.supply > 0 && this.supplyUsed(f) + def.supply > this.supplyCap(f)) return { ok: false, why: 'Nicht genug Versorgung. Baue Gehöfte.', gold, wood: def.wood };
    return { ok: true, gold, wood: def.wood };
  }

  cmdTrain(b: Building, defId: string, force = false): boolean {
    if (!b.built || b.dead) return false;
    if (b.queue.length >= 5) {
      this.msg('Warteschlange voll.');
      return false;
    }
    const f = b.faction as Side;
    if (defId === 'warden' && (this.hero('player') || this.heroQueued())) return false;
    const def = UNITS[defId];
    if (!force) {
      const c = this.canTrain(b, defId);
      if (!c.ok) {
        this.msg(c.why ?? 'Nicht möglich.');
        sound.play('error');
        return false;
      }
      this.res[f].gold -= c.gold;
      this.res[f].wood -= c.wood;
      sound.play('click');
    }
    b.queue.push({ id: defId, t: 0, total: def.trainTime });
    return true;
  }

  cmdResearch(b: Building, upId: string): boolean {
    const up = UPGRADES[upId];
    const f = b.faction as Side;
    const lvl = this.research[f][upId] ?? 0;
    if (!b.built || b.dead || lvl >= up.levels.length || this.researchQueued(f, upId)) return false;
    const cost = up.levels[lvl];
    if (this.res[f].gold < cost.gold || this.res[f].wood < cost.wood) {
      this.msg('Nicht genug Rohstoffe.');
      sound.play('error');
      return false;
    }
    this.res[f].gold -= cost.gold;
    this.res[f].wood -= cost.wood;
    b.queue.push({ id: 'up:' + upId, t: 0, total: cost.time });
    sound.play('click');
    return true;
  }

  cmdCancelTrain(b: Building) {
    const q = b.queue.pop();
    if (!q || b.faction !== 'player') return;
    if (q.id.startsWith('up:')) {
      const up = UPGRADES[q.id.slice(3)];
      const cost = up.levels[this.research.player[up.id] ?? 0];
      this.res.player.gold += cost.gold;
      this.res.player.wood += cost.wood;
      return;
    }
    const def = UNITS[q.id];
    this.res.player.gold += q.id === 'warden' ? this.heroCost() : def.gold;
    this.res.player.wood += def.wood;
  }

  cmdShockwave(hero: Unit): boolean {
    const A = ABILITIES.shockwave;
    if (hero.abilityCd > 0) {
      if (hero.faction === 'player') this.msg(`${A.name} bereit in ${Math.ceil(hero.abilityCd)}s`);
      return false;
    }
    hero.abilityCd = A.cooldown;
    hero.attackAnim = 0.3;
    const dmg = A.baseDamage + A.perLevel * (hero.level - 1);
    this.effects.push({ kind: 'boom', x: hero.x, y: hero.y, t: 0, dur: 0.6, r: A.radius, color: '#f2d16b' });
    sound.play('shock');
    for (const u of [...this.units]) {
      if (u.dead || !hostile(hero.faction, u.faction)) continue;
      if (dist(u.x, u.y, hero.x, hero.y) - u.radius <= A.radius) this.applyDamage(u, dmg, hero, true);
    }
    for (const b of [...this.buildings]) {
      if (b.dead || !hostile(hero.faction, b.faction)) continue;
      if (this.rectDist(hero, b.tx * TILE, b.ty * TILE, (b.tx + b.size) * TILE, (b.ty + b.size) * TILE) <= A.radius) this.applyDamage(b, dmg * 0.5, hero, true);
    }
    return true;
  }

  cmdBlessing(hero: Unit): boolean {
    const A = ABILITIES.blessing;
    if (hero.blessCd > 0) {
      if (hero.faction === 'player') this.msg(`${A.name} bereit in ${Math.ceil(hero.blessCd)}s`);
      return false;
    }
    hero.blessCd = A.cooldown;
    const heal = A.baseHeal + A.perLevel * (hero.level - 1);
    this.effects.push({ kind: 'heal', x: hero.x, y: hero.y, t: 0, dur: 0.9, r: A.radius, color: '#9ff0c0' });
    sound.play('bless');
    for (const u of this.units) {
      if (u.dead || u.faction !== hero.faction) continue;
      if (dist(u.x, u.y, hero.x, hero.y) <= A.radius && u.hp < u.maxHp) {
        u.hp = Math.min(u.maxHp, u.hp + heal);
        this.effects.push({ kind: 'text', x: u.x, y: u.y - u.radius, t: 0, dur: 0.9, r: 0, color: '#9ff0c0', text: `+${heal}` });
      }
    }
    return true;
  }

  // ---------- Simulation ----------

  update(dt: number) {
    if (this.result !== 'none') return;
    this.time += dt;
    this.buildGrid();
    for (const u of this.units) if (!u.dead) this.updateUnit(u, dt);
    this.separate(dt);
    for (const b of this.buildings) if (!b.dead) this.updateBuilding(b, dt);
    this.updateProjectiles(dt);
    for (const e of this.effects) e.t += dt;
    this.effects = this.effects.filter((e) => e.t < e.dur);
    for (const m of this.messages) m.t += dt;
    this.messages = this.messages.filter((m) => m.t < 3.5);
    this.alertTimer -= dt;
    if (this.alert && this.time - this.alert.t > 20) this.alert = null;
    this.ai.update(this, dt);
    this.fogTimer -= dt;
    if (this.fogTimer <= 0) {
      this.fogTimer = 0.2;
      this.updateFog();
    }
    this.cleanup();
    this.checkResult();
    this.autosave -= dt;
    if (this.autosave <= 0) {
      this.autosave = 30;
      this.save();
    }
  }

  private buildGrid() {
    this.grid.clear();
    for (const u of this.units) {
      if (u.dead) continue;
      const k = Math.floor(u.x / 48) + Math.floor(u.y / 48) * 4096;
      let cell = this.grid.get(k);
      if (!cell) this.grid.set(k, (cell = []));
      cell.push(u);
    }
  }

  private separate(dt: number) {
    for (const [k, cell] of this.grid) {
      const cx = k % 4096, cy = Math.floor(k / 4096);
      for (let oy = 0; oy <= 1; oy++)
        for (let ox = oy === 0 ? 0 : -1; ox <= 1; ox++) {
          const other = ox === 0 && oy === 0 ? cell : this.grid.get(cx + ox + (cy + oy) * 4096);
          if (!other) continue;
          for (let i = 0; i < cell.length; i++) {
            const a = cell[i];
            for (let j = other === cell ? i + 1 : 0; j < other.length; j++) {
              const b = other[j];
              let dx = b.x - a.x, dy = b.y - a.y;
              let d = Math.hypot(dx, dy);
              const min = a.radius + b.radius - 1;
              if (d >= min) continue;
              if (d < 0.01) {
                dx = Math.random() - 0.5;
                dy = Math.random() - 0.5;
                d = Math.hypot(dx, dy);
              }
              const push = Math.min((min - d) * 0.5, 60 * dt + (min - d) * 0.25);
              const nx = dx / d, ny = dy / d;
              // Bewegte Einheiten weichen stehenden (arbeitenden/kämpfenden) aus
              const aMoving = a.goal !== null, bMoving = b.goal !== null;
              const wa = aMoving && !bMoving ? 0.85 : !aMoving && bMoving ? 0.15 : 0.5;
              a.x -= nx * push * wa * 2;
              a.y -= ny * push * wa * 2;
              b.x += nx * push * (1 - wa) * 2;
              b.y += ny * push * (1 - wa) * 2;
            }
          }
        }
    }
    const maxX = MAP_W * TILE - 8, maxY = MAP_H * TILE - 8;
    for (const u of this.units) {
      if (u.dead) continue;
      u.x = Math.max(8, Math.min(maxX, u.x));
      u.y = Math.max(8, Math.min(maxY, u.y));
      const tx = Math.floor(u.x / TILE), ty = Math.floor(u.y / TILE);
      if (this.map.isBlocked(tx, ty)) {
        const f = this.map.findNearestFree(tx, ty, 6);
        if (f) {
          const fx = f.tx * TILE + TILE / 2, fy = f.ty * TILE + TILE / 2;
          const d = dist(u.x, u.y, fx, fy);
          const step = Math.min(d, 220 * dt);
          if (d > 0.01) {
            u.x += ((fx - u.x) / d) * step;
            u.y += ((fy - u.y) / d) * step;
          }
        }
      }
    }
  }

  private updateUnit(u: Unit, dt: number) {
    u.cooldown -= dt;
    u.abilityCd -= dt;
    u.blessCd -= dt;
    u.acquireTimer -= dt;
    u.repathTimer -= dt;
    u.attackAnim -= dt;
    const px = u.x, py = u.y;
    const o = u.order;
    switch (o.kind) {
      case 'idle':
        if (u.faction === 'creep') this.creepIdle(u, dt);
        else if (u.def.kind !== 'worker') this.tryAcquire(u, null);
        break;
      case 'move':
        if (this.moveTo(u, o.x, o.y, dt)) u.order = IDLE;
        break;
      case 'attackmove':
        if (this.tryAcquire(u, o)) break;
        if (this.moveTo(u, o.x, o.y, dt)) u.order = IDLE;
        break;
      case 'attack':
        this.doAttack(u, o, dt);
        break;
      case 'gather':
        this.doGather(u, o, dt);
        break;
      case 'return':
        this.doReturn(u, o, dt);
        break;
      case 'build':
        this.doBuild(u, o, dt);
        break;
    }
    const moved = Math.hypot(u.x - px, u.y - py);
    u.moving = moved > 0.2;
    if (u.moving) u.walkPhase += dt * 9;
  }

  private creepIdle(u: Unit, dt: number) {
    if (u.home && dist(u.x, u.y, u.home.x, u.home.y) > 40) {
      if (this.moveTo(u, u.home.x, u.home.y, dt)) u.order = IDLE;
      return;
    }
    if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.03 * dt);
    if (this.tryAcquire(u, null)) return;
  }

  private tryAcquire(u: Unit, resume: Order | null): boolean {
    if (u.acquireTimer > 0) return false;
    u.acquireTimer = 0.25;
    const aggro = u.faction === 'creep' ? 170 : Math.max(this.unitSight(u) * 0.75, u.def.range + 60);
    const t = this.nearestEnemy(u, aggro, u.def.kind === 'siege' ? false : false);
    if (!t) return false;
    this.resetMotion(u);
    u.order = { kind: 'attack', target: t, resume };
    return true;
  }

  private setPath(u: Unit, gx: number, gy: number) {
    let sx = Math.floor(u.x / TILE), sy = Math.floor(u.y / TILE);
    if (this.map.isBlocked(sx, sy)) {
      const f = this.map.findNearestFree(sx, sy, 6);
      if (f) {
        sx = f.tx;
        sy = f.ty;
      }
    }
    let tx = Math.floor(gx / TILE), ty = Math.floor(gy / TILE);
    let exact = true;
    if (this.map.isBlocked(tx, ty)) {
      const f = this.map.findNearestFree(tx, ty);
      if (!f) {
        u.path = [];
        u.pathIdx = 0;
        u.goal = { x: gx, y: gy };
        return;
      }
      tx = f.tx;
      ty = f.ty;
      exact = false;
    }
    const p = findPath(this.map, sx, sy, tx, ty);
    u.path = p ?? [];
    if (p && exact && p.length) p[p.length - 1] = { x: gx, y: gy };
    else if (p && exact && !p.length) u.path = [{ x: gx, y: gy }];
    u.pathIdx = 0;
    u.goal = { x: gx, y: gy };
    u.stuck = 0;
  }

  /** Folgt dem Pfad; true, wenn er zu Ende ist (oder aufgegeben wurde). */
  private followPath(u: Unit, dt: number): boolean {
    if (u.pathIdx >= u.path.length) return true;
    // Fortschritt seit dem letzten Aufruf (inkl. Verdrängung durch andere Einheiten)
    const moved = dist(u.x, u.y, u.lastX, u.lastY);
    u.lastX = u.x;
    u.lastY = u.y;
    const expected = u.def.speed * dt;
    if (moved < expected * 0.25) u.stuck += dt;
    else u.stuck = 0;
    if (u.stuck > 0.8 && u.goal) {
      u.stuck = 0;
      u.stuckCount++;
      this.setPath(u, u.goal.x, u.goal.y);
      if (u.stuckCount > 4) {
        u.stuckCount = 0;
        u.path = [];
        return true;
      }
      if (u.pathIdx >= u.path.length) return true;
    }
    const wp = u.path[u.pathIdx];
    const d = dist(u.x, u.y, wp.x, wp.y);
    const step = u.def.speed * dt;
    if (d <= step) {
      u.x = wp.x;
      u.y = wp.y;
      u.pathIdx++;
    } else {
      u.x += ((wp.x - u.x) / d) * step;
      u.y += ((wp.y - u.y) / d) * step;
      u.facing = Math.atan2(wp.y - u.y, wp.x - u.x);
    }
    return u.pathIdx >= u.path.length;
  }

  private moveTo(u: Unit, x: number, y: number, dt: number): boolean {
    if (!u.goal || u.goal.x !== x || u.goal.y !== y) this.setPath(u, x, y);
    return this.followPath(u, dt);
  }

  private approachTile(u: Unit, e: Entity): TilePos | null {
    if (e.type === 'unit') return null;
    for (let ring = 1; ring <= 3; ring++) {
      const tiles = this.map.ringTiles(e.tx, e.ty, e.size, ring);
      let best: TilePos | null = null, bestD = Infinity;
      for (const t of tiles) {
        const d = dist(u.x, u.y, t.tx * TILE + TILE / 2, t.ty * TILE + TILE / 2);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      if (best) return best;
    }
    return null;
  }

  private moveToEntity(u: Unit, target: Entity, range: number, dt: number): MoveResult {
    const ed = this.edgeDist(u, target);
    // Hysterese: wer schon in Reichweite war (kein aktiver Pfad), toleriert kleine Verdrängungen
    if (ed <= range || (!u.goal && ed <= range + 12)) {
      u.path = [];
      u.pathIdx = 0;
      u.goal = null;
      u.lastX = u.x;
      u.lastY = u.y;
      return 'inrange';
    }
    if (u.repathTimer <= 0 || !u.goal) {
      if (target.type === 'unit') {
        u.repathTimer = 0.4;
        this.setPath(u, target.x, target.y);
      } else {
        u.repathTimer = 1.2;
        const t = this.approachTile(u, target);
        if (!t) return 'fail';
        this.setPath(u, t.tx * TILE + TILE / 2, t.ty * TILE + TILE / 2);
      }
    }
    if (this.followPath(u, dt)) {
      // Pfad zu Ende, aber noch nicht in Reichweite: letztes Stück direkt, solange das Ziel-Feld frei ist
      let stepped = false;
      if (ed < TILE * 2.5) {
        const d = dist(u.x, u.y, target.x, target.y);
        const step = Math.min(u.def.speed * dt, Math.max(0, ed - range + 1));
        if (d > 0.01) {
          const nx = u.x + ((target.x - u.x) / d) * step, ny = u.y + ((target.y - u.y) / d) * step;
          if (!this.map.isBlockedWorld(nx, ny)) {
            u.x = nx;
            u.y = ny;
            stepped = true;
          }
        }
      }
      if (!stepped && u.repathTimer > 0.2) u.repathTimer = 0.2;
      u.waitTimer += dt;
      if (u.waitTimer > 5) {
        u.waitTimer = 0;
        return 'fail';
      }
    }
    return 'moving';
  }

  private moveToRect(u: Unit, tx: number, ty: number, size: number, range: number, dt: number): MoveResult {
    const fake: Mine = { id: -1, type: 'mine', faction: 'neutral', tx, ty, size, gold: 0, x: tx * TILE + (size * TILE) / 2, y: ty * TILE + (size * TILE) / 2, hp: 1, maxHp: 1, dead: false, sight: 0, radius: 0 };
    return this.moveToEntity(u, fake, range, dt);
  }

  private doAttack(u: Unit, o: Extract<Order, { kind: 'attack' }>, dt: number) {
    const t = o.target;
    if (t.dead || (u.faction === 'player' && t.type === 'unit' && !this.isVisible(t.x, t.y))) {
      u.order = o.resume ?? IDLE;
      this.resetMotion(u);
      return;
    }
    // Bei automatisch aufgenommenen Zielen: nicht endlos verfolgen; Kreaturen bleiben nahe ihrem Lager
    const leash = u.faction === 'creep' && u.home ? dist(u.x, u.y, u.home.x, u.home.y) > 300 : o.resume !== null && dist(u.x, u.y, t.x, t.y) > u.sight * 1.6;
    if (leash) {
      u.order = o.resume ?? IDLE;
      this.resetMotion(u);
      return;
    }
    const r = this.moveToEntity(u, t, u.def.range, dt);
    if (r === 'inrange') {
      u.facing = Math.atan2(t.y - u.y, t.x - u.x);
      if (u.cooldown <= 0) this.fire(u, t);
    } else if (r === 'fail') {
      u.order = o.resume ?? IDLE;
      this.resetMotion(u);
    }
  }

  private fire(u: Unit, t: Entity) {
    u.cooldown = u.def.cooldown;
    u.attackAnim = 0.25;
    const dmg = this.unitDamage(u);
    if (u.def.kind === 'ranged' || u.def.kind === 'siege') {
      const siege = u.def.kind === 'siege';
      const kind = siege ? 'rock' : u.def.look.weapon === 'spit' ? 'spit' : 'arrow';
      const total = dist(u.x, u.y, t.x, t.y);
      this.projectiles.push({ x: u.x, y: u.y - 14, target: t, tx: t.x, ty: t.y, speed: siege ? 260 : 430, damage: dmg, attacker: u, kind, arc: siege ? 70 : 18, total, travelled: 0 });
      if (u.faction === 'player' && this.isVisible(u.x, u.y)) sound.play('arrow');
    } else {
      this.applyDamage(t, dmg, u);
      this.effects.push({ kind: 'hit', x: t.x + (Math.random() - 0.5) * 10, y: t.y - 10 + (Math.random() - 0.5) * 10, t: 0, dur: 0.2, r: 6, color: '#fff' });
      if (this.isVisible(t.x, t.y)) sound.play('attack');
    }
  }

  applyDamage(t: Entity, raw: number, attacker: Entity | null, isAbility = false) {
    if (t.dead || t.type === 'mine') return;
    let dmg = raw;
    if (attacker && attacker.type === 'unit' && attacker.def.kind === 'siege' && !isAbility) dmg *= t.type === 'building' ? SIEGE_BUILDING_MULT : SIEGE_UNIT_MULT;
    const armor = t.type === 'unit' ? this.unitArmor(t) : t.def.armor;
    dmg *= Math.max(0.35, 1 - armor * 0.06);
    t.hp -= dmg;
    if (t.type === 'unit' && attacker && attacker.type === 'unit' && t.order.kind === 'idle' && t.def.kind !== 'worker') {
      t.order = { kind: 'attack', target: attacker, resume: null };
    }
    if (t.faction === 'player' && this.alertTimer <= 0) {
      this.alertTimer = 12;
      this.alert = { x: t.x, y: t.y, t: this.time };
      this.msg(t.type === 'building' ? 'Unsere Basis wird angegriffen!' : 'Unsere Einheiten werden angegriffen!');
      sound.play('alert');
    }
    if (t.hp <= 0) {
      if (t.type === 'unit') this.killUnit(t, attacker);
      else this.killBuilding(t, true, attacker);
    }
  }

  private killUnit(u: Unit, killer: Entity | null) {
    u.dead = true;
    u.hp = 0;
    this.effects.push({ kind: 'death', x: u.x, y: u.y, t: 0, dur: 0.8, r: u.radius, color: u.def.look.body });
    this.effects.push({ kind: 'blood', x: u.x, y: u.y, t: 0, dur: 6, r: u.radius, color: u.faction === 'enemy' ? '#4a6a3a' : '#7a1f1f' });
    if (this.isVisible(u.x, u.y)) sound.play('death');
    if (u.faction === 'enemy') this.stats.killed++;
    else if (u.faction === 'player') this.stats.lost++;
    if (u.def.kind === 'hero' && u.faction === 'player') {
      this.heroLevel = u.level;
      this.heroXp = u.xp;
      this.msg('Die Wächterin ist gefallen. Im Bergfried wiederbeleben.');
    }
    if (killer) {
      const hero = this.hero(killer.faction);
      if (hero && dist(hero.x, hero.y, u.x, u.y) < 380) this.gainXp(hero, u.def.xpValue);
      if (u.def.bounty && (killer.faction === 'player' || killer.faction === 'enemy')) {
        this.res[killer.faction].gold += u.def.bounty;
        if (killer.faction === 'player') {
          this.effects.push({ kind: 'text', x: u.x, y: u.y - 16, t: 0, dur: 1.2, r: 0, color: '#f5c542', text: `+${u.def.bounty} Gold` });
          sound.play('gold');
        }
      }
    }
  }

  private gainXp(hero: Unit, xp: number) {
    if (hero.level >= HERO_MAX_LEVEL) return;
    hero.xp += xp;
    while (hero.level < HERO_MAX_LEVEL && hero.xp >= HERO_XP_PER_LEVEL * hero.level) {
      hero.xp -= HERO_XP_PER_LEVEL * hero.level;
      hero.level++;
      hero.maxHp += 50;
      hero.hp = Math.min(hero.maxHp, hero.hp + 120);
      this.effects.push({ kind: 'levelup', x: hero.x, y: hero.y, t: 0, dur: 1.2, r: 30, color: '#f2d16b', text: `Stufe ${hero.level}` });
      if (hero.faction === 'player') {
        this.msg(`Wächterin erreicht Stufe ${hero.level}!`);
        this.heroLevel = hero.level;
        sound.play('levelup');
      }
    }
    if (hero.faction === 'player') this.heroXp = hero.xp;
  }

  private killBuilding(b: Building, explode: boolean, killer: Entity | null = null) {
    b.dead = true;
    b.hp = 0;
    this.map.setBuildingBlock(b.tx, b.ty, b.size, false);
    if (explode) {
      this.effects.push({ kind: 'death', x: b.x, y: b.y, t: 0, dur: 1.2, r: b.radius, color: '#777' });
      for (let i = 0; i < 6; i++) this.effects.push({ kind: 'smoke', x: b.x + (Math.random() - 0.5) * b.radius * 1.5, y: b.y + (Math.random() - 0.5) * b.radius, t: -i * 0.15, dur: 2.5, r: 10 + Math.random() * 10, color: '#555' });
      if (killer) {
        const hero = this.hero(killer.faction);
        if (hero && dist(hero.x, hero.y, b.x, b.y) < 420) this.gainXp(hero, 60);
      }
      if (b.faction === 'player') this.msg(`${b.def.name} wurde zerstört!`);
      if (this.isVisible(b.x, b.y)) sound.play('shock');
    }
  }

  private doGather(u: Unit, o: Extract<Order, { kind: 'gather' }>, dt: number) {
    if (u.carry && u.carry.amount >= CARRY_AMOUNT) {
      u.order = { kind: 'return', then: o };
      this.resetMotion(u);
      return;
    }
    if (u.carry && u.carry.res !== o.res) u.carry = null;
    if (o.res === 'gold') {
      if (!o.mine || o.mine.gold <= 0) {
        o.mine = this.nearestMine(u.x, u.y);
        if (!o.mine) {
          u.order = IDLE;
          this.msg('Keine Goldmine mehr in der Nähe.');
          return;
        }
        this.resetMotion(u);
      }
      const r = this.moveToEntity(u, o.mine, INTERACT_RANGE, dt);
      if (r === 'inrange') {
        u.facing = Math.atan2(o.mine.y - u.y, o.mine.x - u.x);
        u.gatherTimer += dt;
        if (u.gatherTimer >= GOLD_MINE_TIME) {
          u.gatherTimer = 0;
          const take = Math.min(CARRY_AMOUNT, o.mine.gold);
          o.mine.gold -= take;
          u.carry = { res: 'gold', amount: take };
          if (o.mine.gold <= 0) this.msg('Eine Goldmine ist erschöpft.');
        }
      } else if (r === 'fail') u.order = IDLE;
    } else {
      const i = o.tree ? this.map.idx(o.tree.tx, o.tree.ty) : -1;
      if (!o.tree || this.map.tiles[i] !== T_TREE || this.map.wood[i] <= 0) {
        const from = o.tree ? { x: o.tree.tx * TILE + 16, y: o.tree.ty * TILE + 16 } : { x: u.x, y: u.y };
        o.tree = this.map.findNearestTree(from.x, from.y);
        if (!o.tree) {
          u.order = IDLE;
          return;
        }
        this.resetMotion(u);
      }
      const r = this.moveToRect(u, o.tree.tx, o.tree.ty, 1, INTERACT_RANGE, dt);
      if (r === 'inrange') {
        u.facing = Math.atan2(o.tree.ty * TILE + 16 - u.y, o.tree.tx * TILE + 16 - u.x);
        u.gatherTimer += dt;
        if (u.attackAnim <= -0.6) u.attackAnim = 0.25;
        if (u.gatherTimer >= WOOD_CHOP_TIME) {
          u.gatherTimer = 0;
          const j = this.map.idx(o.tree.tx, o.tree.ty);
          const take = Math.min(CARRY_AMOUNT, this.map.wood[j]);
          this.map.wood[j] -= take;
          u.carry = { res: 'wood', amount: take };
          if (this.map.wood[j] <= 0) this.map.setTile(o.tree.tx, o.tree.ty, T_GRASS);
        }
      } else if (r === 'fail') u.order = IDLE;
    }
  }

  private doReturn(u: Unit, o: Extract<Order, { kind: 'return' }>, dt: number) {
    if (!u.carry) {
      u.order = o.then;
      return;
    }
    const hall = this.nearestHall(u.faction, u.x, u.y);
    if (!hall) {
      u.order = IDLE;
      return;
    }
    const r = this.moveToEntity(u, hall, INTERACT_RANGE, dt);
    if (r === 'inrange') {
      if (u.faction === 'player' || u.faction === 'enemy') this.res[u.faction][u.carry.res] += u.carry.amount;
      u.carry = null;
      u.order = o.then;
      this.resetMotion(u);
    } else if (r === 'fail') u.order = IDLE;
  }

  private doBuild(u: Unit, o: Extract<Order, { kind: 'build' }>, dt: number) {
    const b = o.building;
    if (b.dead || b.built) {
      u.order = IDLE;
      return;
    }
    const r = this.moveToEntity(u, b, INTERACT_RANGE, dt);
    if (r === 'inrange') {
      u.facing = Math.atan2(b.y - u.y, b.x - u.x);
      if (u.attackAnim <= -0.5) u.attackAnim = 0.2;
      b.progress += dt / b.def.buildTime;
      b.hp = Math.max(b.hp, Math.min(b.maxHp, b.progress * b.maxHp));
      if (b.progress >= 1) {
        b.progress = 1;
        b.built = true;
        b.hp = b.maxHp;
        this.effects.push({ kind: 'ring', x: b.x, y: b.y, t: 0, dur: 0.6, r: b.radius + 10, color: '#5bd46b' });
        this.msg(`${b.def.name} fertiggestellt.`);
        sound.play('done');
        u.order = IDLE;
      }
    } else if (r === 'fail') u.order = IDLE;
  }

  private updateBuilding(b: Building, dt: number) {
    b.cooldown -= dt;
    b.supplyWarn -= dt;
    b.smoke -= dt;
    if (!b.built) return;
    if (b.def.style === 'forge' && b.smoke <= 0) {
      b.smoke = 0.5;
      this.effects.push({ kind: 'smoke', x: b.x + 28, y: b.y - 50, t: 0, dur: 2, r: 5, color: '#777' });
    }
    if (b.queue.length) {
      const q = b.queue[0];
      const f = b.faction as Side;
      q.t += dt;
      if (q.id.startsWith('up:')) {
        if (q.t >= q.total) {
          b.queue.shift();
          const id = q.id.slice(3);
          this.research[f][id] = (this.research[f][id] ?? 0) + 1;
          if (f === 'player') {
            this.msg(`${UPGRADES[id].name} Stufe ${this.research[f][id]} erforscht.`);
            sound.play('done');
          }
        }
      } else if (q.t >= q.total) {
        const def = UNITS[q.id];
        const used = this.supplyUsed(f) - def.supply; // eigenes Reservat abziehen
        if (f === 'player' && def.supply > 0 && used + def.supply > this.supplyCap(f)) {
          q.t = q.total;
          if (b.supplyWarn <= 0) {
            b.supplyWarn = 8;
            this.msg('Nicht genug Versorgung. Baue Gehöfte.');
          }
        } else {
          b.queue.shift();
          const spot = this.map.ringTiles(b.tx, b.ty, b.size, 1);
          const pick = spot.length ? spot[Math.floor(Math.random() * spot.length)] : null;
          const sx = pick ? pick.tx * TILE + TILE / 2 : b.x, sy = pick ? pick.ty * TILE + TILE / 2 : b.y + b.radius + 20;
          const u = this.spawnUnit(q.id, b.faction, sx, sy);
          if (u && q.id === 'warden') {
            this.heroSummoned = true;
            this.msg('Die Wächterin ist zurück.');
          }
          if (u && f === 'player') sound.play('done');
          if (u) this.applyRally(u, b);
        }
      }
    }
    if (b.def.attack && b.cooldown <= 0) {
      const a = b.def.attack;
      const t = this.nearestEnemy(b, a.range);
      if (t) {
        b.cooldown = a.cooldown;
        const total = dist(b.x, b.y, t.x, t.y);
        this.projectiles.push({ x: b.x, y: b.y - b.radius * 1.2, target: t, tx: t.x, ty: t.y, speed: 460, damage: a.damage, attacker: b, kind: 'bolt', arc: 10, total, travelled: 0 });
      }
    }
  }

  private applyRally(u: Unit, b: Building) {
    if (u.def.kind === 'worker') {
      const r = b.rally;
      const mine = r ? this.mineAt(r.x, r.y) : this.nearestMine(u.x, u.y);
      if (r) {
        const tx = Math.floor(r.x / TILE), ty = Math.floor(r.y / TILE);
        if (mine) {
          u.order = { kind: 'gather', res: 'gold', mine, tree: null };
          return;
        }
        if (this.map.tileAt(tx, ty) === T_TREE) {
          u.order = { kind: 'gather', res: 'wood', mine: null, tree: { tx, ty } };
          return;
        }
        u.order = { kind: 'move', x: r.x, y: r.y };
        return;
      }
      if (mine && dist(mine.x, mine.y, u.x, u.y) < 400) u.order = { kind: 'gather', res: 'gold', mine, tree: null };
      return;
    }
    if (b.rally) u.order = { kind: 'attackmove', x: b.rally.x, y: b.rally.y };
  }

  private updateProjectiles(dt: number) {
    for (const p of this.projectiles) {
      if (!p.target.dead) {
        p.tx = p.target.x;
        p.ty = p.target.y - (p.target.type === 'unit' ? 10 : 20);
      }
      const d = dist(p.x, p.y, p.tx, p.ty);
      const step = p.speed * dt;
      p.travelled += step;
      if (d <= step + 3) {
        p.x = p.tx;
        p.y = p.ty;
        p.speed = 0;
        if (!p.target.dead) this.applyDamage(p.target, p.damage, p.attacker);
        if (p.kind === 'rock') {
          this.effects.push({ kind: 'boom', x: p.tx, y: p.ty + 10, t: 0, dur: 0.4, r: 28, color: '#c9b08a' });
          // Flächenschaden um den Einschlag
          for (const u of [...this.units]) {
            if (u.dead || u === p.target || !hostile(p.attacker.faction, u.faction)) continue;
            if (dist(u.x, u.y, p.tx, p.ty) < 40) this.applyDamage(u, p.damage * 0.5, p.attacker);
          }
          if (this.isVisible(p.tx, p.ty)) sound.play('hit');
        } else {
          this.effects.push({ kind: 'hit', x: p.tx, y: p.ty, t: 0, dur: 0.18, r: 5, color: p.kind === 'spit' ? '#b06fd0' : '#fff' });
          if (this.isVisible(p.tx, p.ty)) sound.play('hit');
        }
      } else {
        p.x += ((p.tx - p.x) / d) * step;
        p.y += ((p.ty - p.y) / d) * step;
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.speed > 0);
  }

  updateFog() {
    const v = this.vis;
    for (let i = 0; i < v.length; i++) if (v[i] === 2) v[i] = 1;
    const reveal = (x: number, y: number, r: number) => {
      const tr = r / TILE;
      const cx = x / TILE, cy = y / TILE;
      const x0 = Math.max(0, Math.floor(cx - tr)), x1 = Math.min(MAP_W - 1, Math.ceil(cx + tr));
      const y0 = Math.max(0, Math.floor(cy - tr)), y1 = Math.min(MAP_H - 1, Math.ceil(cy + tr));
      const r2 = tr * tr;
      for (let ty = y0; ty <= y1; ty++)
        for (let tx = x0; tx <= x1; tx++) {
          const dx = tx + 0.5 - cx, dy = ty + 0.5 - cy;
          if (dx * dx + dy * dy <= r2) v[ty * MAP_W + tx] = 2;
        }
    };
    for (const u of this.units) if (u.faction === 'player' && !u.dead) reveal(u.x, u.y, this.unitSight(u));
    for (const b of this.buildings) if (b.faction === 'player' && !b.dead) reveal(b.x, b.y, b.built ? b.sight : b.sight * 0.6);
    this.fogVersion++;
  }

  private cleanup() {
    let changed = false;
    if (this.units.some((u) => u.dead)) {
      this.units = this.units.filter((u) => !u.dead);
      changed = true;
    }
    if (this.buildings.some((b) => b.dead)) {
      this.buildings = this.buildings.filter((b) => !b.dead);
      changed = true;
    }
    if (changed && this.selection.some((e) => e.dead)) this.select(this.selection);
  }

  private checkResult() {
    const enemyHall = this.buildings.some((b) => b.faction === 'enemy' && b.def.isHall && !b.dead);
    if (!enemyHall) {
      this.result = 'victory';
      Game.clearSave();
      sound.play('victory');
      return;
    }
    const playerBuildings = this.buildings.some((b) => b.faction === 'player' && !b.dead);
    const playerWorkers = this.units.some((u) => u.faction === 'player' && u.def.kind === 'worker' && !u.dead);
    if (!playerBuildings && !playerWorkers) {
      this.result = 'defeat';
      Game.clearSave();
      sound.play('defeat');
    }
  }
}
