import {
  BUILDINGS, BuildingDef, CARRY_AMOUNT, Faction, GOLD_MINE_TIME, HERO_MAX_LEVEL, HERO_XP_PER_LEVEL, MAX_SUPPLY,
  SHOCKWAVE, UNITS, UnitDef, WOOD_CHOP_TIME,
} from './defs';
import { EnemyAI } from './ai';
import { GameMap, MAP_H, MAP_W, T_GRASS, T_TREE, TILE, TilePos } from './map';
import { dist, Pt } from './math';
import { findPath } from './path';

/** Reichweite für Sammeln/Bauen/Abliefern: deckt auch diagonale Nachbarfelder ab. */
const INTERACT_RANGE = 17;

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
}

export interface QueueItem {
  id: string;
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
  kind: 'ring' | 'hit' | 'death' | 'ping' | 'pingAttack' | 'text' | 'boom' | 'levelup';
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
  color: string;
}

export interface Resources {
  gold: number;
  wood: number;
}

export type MoveResult = 'inrange' | 'moving' | 'fail';

export class Game {
  map: GameMap;
  units: Unit[] = [];
  buildings: Building[] = [];
  mines: Mine[] = [];
  nextId = 1;
  time = 0;
  res: Record<'player' | 'enemy', Resources> = { player: { gold: 300, wood: 150 }, enemy: { gold: 1e9, wood: 1e9 } };
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
  private grid = new Map<number, Unit[]>();
  private spawnedHallTick = false;

  constructor(seed: number) {
    this.map = new GameMap(seed);
    this.setup();
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
    this.spawnedHallTick = true;
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
      order: IDLE, path: [], pathIdx: 0, goal: null, cooldown: 0, abilityCd: 0, acquireTimer: Math.random() * 0.3, repathTimer: 0, waitTimer: 0,
      facing: faction === 'player' ? -Math.PI / 2 : Math.PI / 2, carry: null, gatherTimer: 0, level: 1, xp: 0, stuck: 0, stuckCount: 0, lastX: x, lastY: y, attackAnim: 0,
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
      progress: built ? 1 : 0, built, queue: [], cooldown: 0, supplyWarn: 0,
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

  // ---------- Abfragen ----------

  supplyUsed(f: 'player' | 'enemy') {
    let s = 0;
    for (const u of this.units) if (u.faction === f && !u.dead) s += u.def.supply;
    for (const b of this.buildings) if (b.faction === f && !b.dead) for (const q of b.queue) s += UNITS[q.id].supply;
    return s;
  }

  supplyCap(f: 'player' | 'enemy') {
    let s = 0;
    for (const b of this.buildings) if (b.faction === f && !b.dead && b.built) s += b.def.supply;
    return Math.min(MAX_SUPPLY, s);
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

  unitDamage(u: Unit) {
    return u.def.damage + (u.def.kind === 'hero' ? 4 * (u.level - 1) : 0);
  }

  isVisible(x: number, y: number) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return this.map.inBounds(tx, ty) && this.vis[ty * MAP_W + tx] === 2;
  }

  isExplored(x: number, y: number) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return this.map.inBounds(tx, ty) && this.vis[ty * MAP_W + tx] >= 1;
  }

  /** Sichtbarkeit aus Spielersicht (Gegner nur, wenn ihre Kachel sichtbar bzw. Gebäude erforscht). */
  playerCanSee(e: Entity) {
    if (e.faction !== 'enemy') return true;
    if (e.type === 'building') return this.isExplored(e.x, e.y) || this.isVisible(e.x, e.y);
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

  rectDist(a: Unit, x0: number, y0: number, x1: number, y1: number) {
    const dx = Math.max(x0 - a.x, 0, a.x - x1), dy = Math.max(y0 - a.y, 0, a.y - y1);
    return Math.hypot(dx, dy) - a.radius;
  }

  pickEntity(wx: number, wy: number): Entity | null {
    let best: Unit | null = null, bestD = Infinity;
    for (const u of this.units) {
      if (u.dead || !this.playerCanSee(u)) continue;
      const d = dist(u.x, u.y, wx, wy);
      if (d <= u.radius + 10 && d < bestD) {
        bestD = d;
        best = u;
      }
    }
    if (best) return best;
    for (const b of this.buildings) {
      if (b.dead || !this.playerCanSee(b)) continue;
      const r = this.rectOf(b)!;
      if (wx >= r.x0 && wx < r.x1 && wy >= r.y0 && wy < r.y1) return b;
    }
    for (const m of this.mines) {
      const r = this.rectOf(m)!;
      if (wx >= r.x0 && wx < r.x1 && wy >= r.y0 && wy < r.y1) return m;
    }
    return null;
  }

  unitsInRect(x0: number, y0: number, x1: number, y1: number): Unit[] {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    return this.units.filter((u) => u.faction === 'player' && !u.dead && u.x >= ax && u.x <= bx && u.y >= ay && u.y <= by);
  }

  nearestEnemy(e: Entity, range: number, unitsOnly = false): Entity | null {
    const foe: Faction = e.faction === 'player' ? 'enemy' : 'player';
    let best: Entity | null = null, bestD = Infinity;
    const measure = (t: Entity) => (e.type === 'unit' ? this.edgeDist(e, t) : dist(e.x, e.y, t.x, t.y) - e.radius - t.radius);
    for (const u of this.units) {
      if (u.faction !== foe || u.dead) continue;
      if (e.faction === 'player' && !this.isVisible(u.x, u.y)) continue;
      const d = measure(u);
      if (d <= range && d < bestD) {
        bestD = d;
        best = u;
      }
    }
    if (best || unitsOnly) return best;
    for (const b of this.buildings) {
      if (b.faction !== foe || b.dead) continue;
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
    this.effects.push({ kind: 'ping', x, y, t: 0, dur: 0.7, r: 14, color: '#5bd46b' });
  }

  cmdAttackMove(units: Unit[], x: number, y: number) {
    this.spreadOrders(units, x, y, (px, py) => ({ kind: 'attackmove', x: px, y: py }));
    if (units.some((u) => u.faction === 'player')) this.effects.push({ kind: 'pingAttack', x, y, t: 0, dur: 0.7, r: 14, color: '#ff6b5b' });
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
      if (u.def.kind !== 'worker') u.order = { kind: 'move', x: mine.x, y: mine.y };
      else u.order = { kind: 'gather', res: 'gold', mine, tree: null };
    }
    this.effects.push({ kind: 'ping', x: mine.x, y: mine.y, t: 0, dur: 0.7, r: 20, color: '#f5c542' });
  }

  cmdGatherWood(units: Unit[], tree: TilePos) {
    for (const u of units) {
      this.resetMotion(u);
      if (u.def.kind !== 'worker') u.order = { kind: 'move', x: tree.tx * TILE + TILE / 2, y: tree.ty * TILE + TILE / 2 };
      else u.order = { kind: 'gather', res: 'wood', mine: null, tree };
    }
    this.effects.push({ kind: 'ping', x: tree.tx * TILE + TILE / 2, y: tree.ty * TILE + TILE / 2, t: 0, dur: 0.7, r: 14, color: '#8b5a2b' });
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
  }

  cmdBuild(workers: Unit[], defId: string, tx: number, ty: number): boolean {
    const def = BUILDINGS[defId];
    const r = this.res.player;
    if (!this.canPlaceBuilding(defId, tx, ty)) {
      this.msg('Hier kann nicht gebaut werden.');
      return false;
    }
    if (r.gold < def.gold || r.wood < def.wood) {
      this.msg('Nicht genug Rohstoffe.');
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
    return true;
  }

  cmdCancelBuilding(b: Building) {
    if (b.built || b.dead) return;
    this.res.player.gold += Math.floor(b.def.gold * 0.75);
    this.res.player.wood += Math.floor(b.def.wood * 0.75);
    this.killBuilding(b, false);
  }

  cmdTrain(b: Building, defId: string, force = false): boolean {
    const def = UNITS[defId];
    if (!b.built || b.dead) return false;
    if (b.queue.length >= 5) {
      this.msg('Warteschlange voll.');
      return false;
    }
    const f = b.faction as 'player' | 'enemy';
    let gold = def.gold, wood = def.wood;
    if (defId === 'warden') {
      if (this.hero('player') || this.heroQueued()) return false;
      gold = this.heroCost();
    }
    if (!force) {
      if (this.res[f].gold < gold || this.res[f].wood < wood) {
        this.msg('Nicht genug Rohstoffe.');
        return false;
      }
      if (def.supply > 0 && this.supplyUsed(f) + def.supply > this.supplyCap(f)) {
        this.msg('Nicht genug Versorgung. Baue Gehöfte.');
        return false;
      }
      this.res[f].gold -= gold;
      this.res[f].wood -= wood;
    }
    b.queue.push({ id: defId, t: 0, total: def.trainTime });
    return true;
  }

  cmdCancelTrain(b: Building) {
    const q = b.queue.pop();
    if (!q || b.faction !== 'player') return;
    const def = UNITS[q.id];
    this.res.player.gold += q.id === 'warden' ? this.heroCost() : def.gold;
    this.res.player.wood += def.wood;
  }

  cmdShockwave(hero: Unit): boolean {
    if (hero.abilityCd > 0) {
      this.msg(`Erdstoß bereit in ${Math.ceil(hero.abilityCd)}s`);
      return false;
    }
    hero.abilityCd = SHOCKWAVE.cooldown;
    const dmg = SHOCKWAVE.baseDamage + SHOCKWAVE.perLevel * (hero.level - 1);
    this.effects.push({ kind: 'boom', x: hero.x, y: hero.y, t: 0, dur: 0.6, r: SHOCKWAVE.radius, color: '#f2d16b' });
    const foe: Faction = hero.faction === 'player' ? 'enemy' : 'player';
    for (const u of [...this.units]) {
      if (u.faction !== foe || u.dead) continue;
      if (dist(u.x, u.y, hero.x, hero.y) - u.radius <= SHOCKWAVE.radius) this.applyDamage(u, dmg, hero);
    }
    for (const b of [...this.buildings]) {
      if (b.faction !== foe || b.dead) continue;
      if (this.rectDist({ ...hero } as Unit, b.tx * TILE, b.ty * TILE, (b.tx + b.size) * TILE, (b.ty + b.size) * TILE) <= SHOCKWAVE.radius) this.applyDamage(b, dmg * 0.5, hero);
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
    this.ai.update(this, dt);
    this.fogTimer -= dt;
    if (this.fogTimer <= 0) {
      this.fogTimer = 0.2;
      this.updateFog();
    }
    this.cleanup();
    this.checkResult();
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
          if (oy === 0 && ox < 0) continue;
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
    u.acquireTimer -= dt;
    u.repathTimer -= dt;
    u.attackAnim -= dt;
    const o = u.order;
    switch (o.kind) {
      case 'idle':
        if (u.def.kind !== 'worker') this.tryAcquire(u, null);
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
  }

  private tryAcquire(u: Unit, resume: Order | null): boolean {
    if (u.acquireTimer > 0) return false;
    u.acquireTimer = 0.25;
    const aggro = Math.max(u.sight * 0.75, u.def.range + 60);
    const t = this.nearestEnemy(u, aggro);
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
    // Bei automatisch aufgenommenen Zielen: nicht endlos verfolgen
    if (o.resume && dist(u.x, u.y, t.x, t.y) > u.sight * 1.6) {
      u.order = o.resume;
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
    u.attackAnim = 0.2;
    const dmg = this.unitDamage(u);
    if (u.def.kind === 'ranged') {
      this.projectiles.push({ x: u.x, y: u.y, target: t, tx: t.x, ty: t.y, speed: 430, damage: dmg, attacker: u, color: u.faction === 'player' ? '#e8e2c0' : '#b06fd0' });
    } else {
      this.applyDamage(t, dmg, u);
      this.effects.push({ kind: 'hit', x: t.x + (Math.random() - 0.5) * 10, y: t.y + (Math.random() - 0.5) * 10, t: 0, dur: 0.2, r: 6, color: '#fff' });
    }
  }

  applyDamage(t: Entity, dmg: number, attacker: Entity | null) {
    if (t.dead || t.type === 'mine') return;
    t.hp -= dmg;
    if (t.type === 'unit' && attacker && attacker.type === 'unit' && t.order.kind === 'idle' && t.def.kind !== 'worker') {
      t.order = { kind: 'attack', target: attacker, resume: null };
    }
    if (t.hp <= 0) {
      if (t.type === 'unit') this.killUnit(t, attacker);
      else this.killBuilding(t, true, attacker);
    }
  }

  private killUnit(u: Unit, killer: Entity | null) {
    u.dead = true;
    u.hp = 0;
    this.effects.push({ kind: 'death', x: u.x, y: u.y, t: 0, dur: 0.8, r: u.radius, color: u.def.color });
    if (u.faction === 'enemy') this.stats.killed++;
    else this.stats.lost++;
    if (u.def.kind === 'hero' && u.faction === 'player') {
      this.heroLevel = u.level;
      this.heroXp = u.xp;
      this.msg('Die Wächterin ist gefallen. Im Bergfried wiederbeleben.');
    }
    if (killer) {
      const hero = this.hero(killer.faction);
      if (hero && dist(hero.x, hero.y, u.x, u.y) < 380) this.gainXp(hero, u.def.xpValue);
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
      if (killer) {
        const hero = this.hero(killer.faction);
        if (hero && dist(hero.x, hero.y, b.x, b.y) < 420) this.gainXp(hero, 60);
      }
      if (b.faction === 'player') this.msg(`${b.def.name} wurde zerstört!`);
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
      if (u.faction !== 'neutral') this.res[u.faction][u.carry.res] += u.carry.amount;
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
      u.attackAnim = 0.1;
      b.progress += dt / b.def.buildTime;
      b.hp = Math.max(b.hp, Math.min(b.maxHp, b.progress * b.maxHp));
      if (b.progress >= 1) {
        b.progress = 1;
        b.built = true;
        b.hp = b.maxHp;
        this.effects.push({ kind: 'ring', x: b.x, y: b.y, t: 0, dur: 0.6, r: b.radius + 10, color: '#5bd46b' });
        this.msg(`${b.def.name} fertiggestellt.`);
        u.order = IDLE;
      }
    } else if (r === 'fail') u.order = IDLE;
  }

  private updateBuilding(b: Building, dt: number) {
    b.cooldown -= dt;
    b.supplyWarn -= dt;
    if (!b.built) return;
    if (b.queue.length) {
      const q = b.queue[0];
      const def = UNITS[q.id];
      const f = b.faction as 'player' | 'enemy';
      q.t += dt;
      if (q.t >= q.total) {
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
          if (u && u.def.kind === 'worker') {
            const mine = this.nearestMine(u.x, u.y);
            if (mine && dist(mine.x, mine.y, u.x, u.y) < 400) u.order = { kind: 'gather', res: 'gold', mine, tree: null };
          }
        }
      }
    }
    if (b.def.attack && b.cooldown <= 0) {
      const a = b.def.attack;
      const t = this.nearestEnemy(b, a.range);
      if (t) {
        b.cooldown = a.cooldown;
        this.projectiles.push({ x: b.x, y: b.y - b.radius * 0.6, target: t, tx: t.x, ty: t.y, speed: 460, damage: a.damage, attacker: b, color: b.faction === 'player' ? '#ffe28a' : '#c05fe0' });
      }
    }
  }

  private updateProjectiles(dt: number) {
    for (const p of this.projectiles) {
      if (!p.target.dead) {
        p.tx = p.target.x;
        p.ty = p.target.y;
      }
      const d = dist(p.x, p.y, p.tx, p.ty);
      const step = p.speed * dt;
      if (d <= step + 3) {
        p.x = p.tx;
        p.y = p.ty;
        p.speed = 0;
        if (!p.target.dead) this.applyDamage(p.target, p.damage, p.attacker);
        this.effects.push({ kind: 'hit', x: p.tx, y: p.ty, t: 0, dur: 0.18, r: 5, color: p.color });
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
    for (const u of this.units) if (u.faction === 'player' && !u.dead) reveal(u.x, u.y, u.sight);
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
    if (!this.spawnedHallTick) return;
    const enemyHall = this.buildings.some((b) => b.faction === 'enemy' && b.def.isHall && !b.dead);
    if (!enemyHall) {
      this.result = 'victory';
      return;
    }
    const playerBuildings = this.buildings.some((b) => b.faction === 'player' && !b.dead);
    const playerWorkers = this.units.some((u) => u.faction === 'player' && u.def.kind === 'worker' && !u.dead);
    if (!playerBuildings && !playerWorkers) this.result = 'defeat';
  }
}
