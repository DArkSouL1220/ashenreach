import { Camera } from './camera';
import { BUILDINGS } from './defs';
import { Entity, Game, Unit } from './game';
import { Hud, Targeting } from './hud';
import { T_TREE, TILE } from './map';
import { Overlay } from './render';

export interface App {
  game: Game;
}

type Mode = 'none' | 'pending' | 'pan' | 'box' | 'pinch' | 'dead' | 'mousePending' | 'mouseRight' | 'mouseBox' | 'mousePan';

export class Input {
  overlay: Overlay = { box: null, ghost: null };
  private pointers = new Map<number, { x: number; y: number }>();
  private mode: Mode = 'none';
  private start = { x: 0, y: 0 };
  private last = { x: 0, y: 0 };
  private boxStart = { x: 0, y: 0 };
  private longPress: ReturnType<typeof setTimeout> | null = null;
  private pinch = { d0: 1, z0: 1, mx: 0, my: 0 };
  private lastTap = { t: 0, id: -1 };
  private keys = new Set<string>();
  private hover: { x: number; y: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, private app: App, private cam: Camera, private hud: Hud) {
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e, true));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 0.89);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
      if (e.key === 'Escape') {
        this.hud.clearTargeting();
        this.hud.setBuildMenu(false);
      } else this.hud.hotkey(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  update(dt: number) {
    const v = 600 * dt;
    let dx = 0, dy = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) dx -= v;
    if (this.keys.has('arrowright') || this.keys.has('d')) dx += v;
    if (this.keys.has('arrowup') || this.keys.has('w')) dy -= v;
    if (this.keys.has('arrowdown') || this.keys.has('s')) dy += v;
    if (dx || dy) this.cam.pan(dx, dy);
    this.updateGhost();
  }

  private updateGhost() {
    const t = this.hud.targeting;
    if (t && t.type === 'build' && this.hover && t.defId) {
      const def = BUILDINGS[t.defId];
      const w = this.cam.toWorld(this.hover.x, this.hover.y);
      const tx = Math.floor(w.x / TILE) - Math.floor(def.size / 2), ty = Math.floor(w.y / TILE) - Math.floor(def.size / 2);
      this.overlay.ghost = { defId: t.defId, tx, ty, ok: this.app.game.canPlaceBuilding(t.defId, tx, ty) };
    } else this.overlay.ghost = null;
  }

  private onDown(e: PointerEvent) {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.hover = { x: e.clientX, y: e.clientY };
    if (e.pointerType === 'mouse') {
      this.start = this.last = { x: e.clientX, y: e.clientY };
      if (e.button === 0) this.mode = 'mousePending';
      else if (e.button === 2) this.mode = 'mouseRight';
      else this.mode = 'mousePan';
      return;
    }
    if (this.pointers.size === 1) {
      this.start = this.last = { x: e.clientX, y: e.clientY };
      this.mode = 'pending';
      this.clearLongPress();
      this.longPress = setTimeout(() => {
        if (this.mode === 'pending') {
          this.mode = 'box';
          this.boxStart = { ...this.start };
          this.overlay.box = { x0: this.start.x, y0: this.start.y, x1: this.start.x, y1: this.start.y };
        }
      }, 380);
    } else if (this.pointers.size === 2) {
      this.clearLongPress();
      this.overlay.box = null;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), z0: this.cam.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      this.mode = 'pinch';
    } else this.mode = 'dead';
  }

  private onMove(e: PointerEvent) {
    const p = this.pointers.get(e.pointerId);
    if (e.pointerType === 'mouse' || !p) this.hover = { x: e.clientX, y: e.clientY };
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    const moved = Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y);
    switch (this.mode) {
      case 'pending':
        if (moved > 10) {
          this.clearLongPress();
          this.mode = 'pan';
        }
        break;
      case 'mousePending':
        if (moved > 4) {
          this.mode = 'mouseBox';
          this.boxStart = { ...this.start };
        }
        break;
      case 'pan':
      case 'mousePan':
        this.cam.pan(this.last.x - e.clientX, this.last.y - e.clientY);
        break;
      case 'box':
      case 'mouseBox':
        this.overlay.box = { x0: this.boxStart.x, y0: this.boxStart.y, x1: e.clientX, y1: e.clientY };
        break;
      case 'pinch': {
        if (this.pointers.size < 2) break;
        const [a, b] = [...this.pointers.values()];
        const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        this.cam.pan(this.pinch.mx - mx, this.pinch.my - my);
        this.cam.setZoomAt(mx, my, (this.pinch.z0 * d) / this.pinch.d0);
        this.pinch.mx = mx;
        this.pinch.my = my;
        break;
      }
    }
    this.last = { x: e.clientX, y: e.clientY };
  }

  private onUp(e: PointerEvent, cancel = false) {
    this.pointers.delete(e.pointerId);
    this.clearLongPress();
    const mode = this.mode;
    if (this.pointers.size === 0) this.mode = 'none';
    else if (mode === 'pinch' || mode === 'dead') this.mode = 'dead';
    if (cancel) {
      this.overlay.box = null;
      return;
    }
    switch (mode) {
      case 'pending':
        this.tap(e.clientX, e.clientY, 'touch');
        break;
      case 'mousePending':
        this.tap(e.clientX, e.clientY, 'left');
        break;
      case 'mouseRight':
        this.tap(e.clientX, e.clientY, 'right');
        break;
      case 'box':
      case 'mouseBox':
        this.finishBox(e.clientX, e.clientY, mode === 'box');
        break;
    }
    if (e.pointerType === 'mouse') this.hover = { x: e.clientX, y: e.clientY };
    else this.hover = null;
  }

  private clearLongPress() {
    if (this.longPress) clearTimeout(this.longPress);
    this.longPress = null;
  }

  private finishBox(x: number, y: number, touch: boolean) {
    this.overlay.box = null;
    const g = this.app.game;
    const a = this.cam.toWorld(this.boxStart.x, this.boxStart.y), b = this.cam.toWorld(x, y);
    if (Math.abs(x - this.boxStart.x) < 6 && Math.abs(y - this.boxStart.y) < 6) {
      this.tap(x, y, touch ? 'touch' : 'left');
      return;
    }
    let units = g.unitsInRect(a.x, a.y, b.x, b.y);
    const combat = units.filter((u) => u.def.kind !== 'worker');
    if (combat.length) units = combat;
    if (units.length) g.select(units);
    else if (!touch) g.select([]);
    this.hud.onSelectionChanged();
  }

  private tap(sx: number, sy: number, kind: 'touch' | 'left' | 'right') {
    const g = this.app.game;
    const w = this.cam.toWorld(sx, sy);
    const t = this.hud.targeting;
    if (t) {
      if (kind !== 'right') this.executeTargeting(t, w.x, w.y);
      else this.hud.clearTargeting();
      return;
    }
    const ent = g.pickEntity(w.x, w.y);
    if (kind === 'left') {
      if (ent) this.selectEntity(ent);
      else {
        g.select([]);
        this.hud.onSelectionChanged();
      }
      return;
    }
    if (kind === 'right') {
      this.contextCommand(ent, w.x, w.y);
      return;
    }
    // Touch
    if (ent && ent.faction === 'player') {
      this.selectEntity(ent);
      return;
    }
    const units = g.selectedPlayerUnits();
    if (units.length) {
      this.contextCommand(ent, w.x, w.y);
      return;
    }
    if (ent) this.selectEntity(ent);
    else {
      g.select([]);
      this.hud.onSelectionChanged();
    }
  }

  private selectEntity(ent: Entity) {
    const g = this.app.game;
    const now = performance.now();
    const dbl = this.lastTap.id === ent.id && now - this.lastTap.t < 400;
    this.lastTap = { t: now, id: ent.id };
    if (dbl && ent.type === 'unit' && ent.faction === 'player') {
      const x0 = this.cam.x, y0 = this.cam.y, x1 = x0 + this.cam.w / this.cam.zoom, y1 = y0 + this.cam.h / this.cam.zoom;
      const same = g.units.filter((u) => u.faction === 'player' && !u.dead && u.def === ent.def && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1);
      g.select(same);
    } else g.select([ent]);
    this.hud.setBuildMenu(false);
    this.hud.onSelectionChanged();
  }

  private contextCommand(ent: Entity | null, wx: number, wy: number) {
    const g = this.app.game;
    const units = g.selectedPlayerUnits();
    if (!units.length) {
      if (!ent) {
        g.select([]);
        this.hud.onSelectionChanged();
      }
      return;
    }
    const workers = units.filter((u) => u.def.kind === 'worker');
    if (ent) {
      if (ent.faction === 'enemy') {
        g.cmdAttack(units, ent);
        return;
      }
      if (ent.type === 'mine') {
        if (workers.length) g.cmdGatherGold(units, ent);
        else g.cmdMove(units, wx, wy);
        return;
      }
      if (ent.type === 'building' && ent.faction === 'player') {
        if (!ent.built && workers.length) g.cmdHelpBuild(units, ent);
        else if (ent.def.isHall && workers.some((u) => u.carry)) {
          g.cmdReturn(workers.filter((u) => u.carry));
          const rest = units.filter((u) => !(u.def.kind === 'worker' && u.carry));
          if (rest.length) g.cmdMove(rest, ent.x, ent.y + ent.radius + 24);
        } else g.cmdMove(units, wx, wy);
        return;
      }
      if (ent.type === 'unit' && ent.faction === 'player') {
        g.cmdMove(units, ent.x, ent.y);
        return;
      }
    }
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    if (workers.length && g.map.tileAt(tx, ty) === T_TREE && g.map.wood[g.map.idx(tx, ty)] > 0) {
      g.cmdGatherWood(units, { tx, ty });
      return;
    }
    g.cmdMove(units, wx, wy);
  }

  private executeTargeting(t: Targeting, wx: number, wy: number) {
    const g = this.app.game;
    const units = g.selectedPlayerUnits();
    if (t.type === 'move') {
      if (units.length) g.cmdMove(units, wx, wy);
      this.hud.clearTargeting();
    } else if (t.type === 'attackmove') {
      if (units.length) g.cmdAttackMove(units, wx, wy);
      this.hud.clearTargeting();
    } else if (t.type === 'build' && t.defId) {
      const def = BUILDINGS[t.defId];
      const tx = Math.floor(wx / TILE) - Math.floor(def.size / 2), ty = Math.floor(wy / TILE) - Math.floor(def.size / 2);
      const workers: Unit[] = units.filter((u) => u.def.kind === 'worker');
      if (g.cmdBuild(workers, t.defId, tx, ty)) {
        this.hud.clearTargeting();
        this.hud.setBuildMenu(false);
      }
    }
  }
}
