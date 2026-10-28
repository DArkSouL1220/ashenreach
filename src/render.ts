import { Camera } from './camera';
import { BUILDINGS, FACTION_COLOR, UnitLook } from './defs';
import { Building, Effect, Entity, Game, Mine, Projectile, Unit } from './game';
import { MAP_H, MAP_W, T_GRASS, T_TREE, T_WATER, TILE } from './map';

const TAU = Math.PI * 2;
type Ctx = CanvasRenderingContext2D;

export interface Overlay {
  box: { x0: number; y0: number; x1: number; y1: number } | null; // Bildschirmkoordinaten
  ghost: { defId: string; tx: number; ty: number; ok: boolean } | null;
}

const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `rgb(${r},${g},${bl})`;
}

function shade(hex: string, f: number) {
  const p = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((p >> 16) & 255)},${c((p >> 8) & 255)},${c(p & 255)})`;
}

export class Renderer {
  ctx: Ctx;
  terrain: HTMLCanvasElement;
  thumb: HTMLCanvasElement; // Minikarten-Vorschau, 1 px pro Kachel
  fog: HTMLCanvasElement;
  fogData: ImageData;
  fogDrawn = -1;
  dpr = 1;
  game: Game;
  now = 0;

  constructor(public canvas: HTMLCanvasElement, game: Game, public cam: Camera) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.game = game;
    this.terrain = document.createElement('canvas');
    this.terrain.width = MAP_W * TILE;
    this.terrain.height = MAP_H * TILE;
    this.thumb = document.createElement('canvas');
    this.thumb.width = MAP_W;
    this.thumb.height = MAP_H;
    this.fog = document.createElement('canvas');
    this.fog.width = MAP_W;
    this.fog.height = MAP_H;
    this.fogData = this.fog.getContext('2d')!.createImageData(MAP_W, MAP_H);
    this.setGame(game);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
  }

  setGame(g: Game) {
    this.game = g;
    this.fogDrawn = -1;
    g.map.onTileChanged = (tx, ty) => this.paintRegion(tx - 1, ty - 1, tx + 1, ty + 1);
    this.paintRegion(0, 0, MAP_W - 1, MAP_H - 1);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.cam.w = w;
    this.cam.h = h;
    this.cam.clampToMap();
  }

  // ---------- Gelände ----------

  /** Malt einen Kachelbereich in Schichten (Gras, Erde, Details, Wasser, Bäume). */
  private paintRegion(x0: number, y0: number, x1: number, y1: number) {
    const c = this.terrain.getContext('2d')!;
    const tc = this.thumb.getContext('2d')!;
    const m = this.game.map;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(MAP_W - 1, x1); y1 = Math.min(MAP_H - 1, y1);
    const ex0 = Math.max(0, x0 - 1), ey0 = Math.max(0, y0 - 1), ex1 = Math.min(MAP_W - 1, x1 + 1), ey1 = Math.min(MAP_H - 1, y1 + 1);
    c.save();
    c.beginPath();
    c.rect(x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE);
    c.clip();

    // 1. Grasgrund
    for (let ty = ey0; ty <= ey1; ty++)
      for (let tx = ex0; tx <= ex1; tx++) {
        const sh = m.shade[m.idx(tx, ty)] / 255;
        c.fillStyle = `hsl(${88 + sh * 18}, ${34 + sh * 10}%, ${24 + sh * 12}%)`;
        c.fillRect(tx * TILE, ty * TILE, TILE, TILE);
        tc.fillStyle = `hsl(${88 + sh * 18}, 36%, ${26 + sh * 10}%)`;
        tc.fillRect(tx, ty, 1, 1);
      }
    // 2. Erdflecken (weiche Ränder, überlappen Nachbarn)
    for (let ty = ey0; ty <= ey1; ty++)
      for (let tx = ex0; tx <= ex1; tx++) {
        const i = m.idx(tx, ty);
        const sh = m.shade[i] / 255;
        if (sh > 0.3 || m.tiles[i] !== T_GRASS) continue;
        const k = (0.3 - sh) / 0.3;
        c.fillStyle = `rgba(104, 84, 54, ${0.5 + k * 0.45})`;
        c.beginPath();
        c.ellipse(tx * TILE + 16 + (hash(tx, ty) - 0.5) * 8, ty * TILE + 16 + (hash(ty, tx) - 0.5) * 8, 18 + k * 8, 15 + k * 6, hash(tx + 7, ty) * 3, 0, TAU);
        c.fill();
        tc.fillStyle = 'rgb(96,78,52)';
        tc.fillRect(tx, ty, 1, 1);
      }
    // 3. Details: Grasbüschel, Steine, Blumen
    for (let ty = ey0; ty <= ey1; ty++)
      for (let tx = ex0; tx <= ex1; tx++) {
        const i = m.idx(tx, ty);
        if (m.tiles[i] !== T_GRASS) continue;
        const sh = m.shade[i] / 255;
        const h = hash(tx * 3, ty * 5);
        const x = tx * TILE, y = ty * TILE;
        if (sh > 0.3) {
          c.strokeStyle = `hsla(${95 + sh * 20}, 45%, ${40 + sh * 14}%, 0.7)`;
          c.lineWidth = 1.5;
          c.beginPath();
          for (let k = 0; k < 3; k++) {
            const gx = x + 5 + ((h * 97 + k * 31) % 22), gy = y + 8 + ((h * 53 + k * 17) % 20);
            c.moveTo(gx, gy + 4);
            c.lineTo(gx + (k - 1) * 1.5, gy - 3);
          }
          c.stroke();
          if (h > 0.9) {
            c.fillStyle = h > 0.95 ? '#f0e6a0' : '#e8a0b0';
            c.beginPath();
            c.arc(x + 8 + h * 16, y + 10 + h * 12, 1.6, 0, TAU);
            c.arc(x + 20 - h * 10, y + 22 - h * 8, 1.3, 0, TAU);
            c.fill();
          }
        } else if (h > 0.75) {
          c.fillStyle = '#7d7466';
          c.beginPath();
          c.ellipse(x + 10 + h * 12, y + 14 + h * 8, 4, 2.8, h * 2, 0, TAU);
          c.fill();
          c.fillStyle = '#9a9184';
          c.beginPath();
          c.ellipse(x + 9 + h * 12, y + 13 + h * 8, 2.5, 1.5, h * 2, 0, TAU);
          c.fill();
        }
      }
    // 4. Wasser mit Ufer
    for (let ty = ey0; ty <= ey1; ty++)
      for (let tx = ex0; tx <= ex1; tx++) {
        if (m.tiles[m.idx(tx, ty)] !== T_WATER) continue;
        const x = tx * TILE, y = ty * TILE;
        const land = (ax: number, ay: number) => m.inBounds(ax, ay) && m.tiles[m.idx(ax, ay)] !== T_WATER;
        // Sandband auf den angrenzenden Landkacheln
        c.fillStyle = '#b7a66f';
        if (land(tx - 1, ty)) c.fillRect(x - 7, y - 2, 7, TILE + 4);
        if (land(tx + 1, ty)) c.fillRect(x + TILE, y - 2, 7, TILE + 4);
        if (land(tx, ty - 1)) c.fillRect(x - 2, y - 7, TILE + 4, 7);
        if (land(tx, ty + 1)) c.fillRect(x - 2, y + TILE, TILE + 4, 7);
        tc.fillStyle = '#2d5f8e';
        tc.fillRect(tx, ty, 1, 1);
      }
    for (let ty = ey0; ty <= ey1; ty++)
      for (let tx = ex0; tx <= ex1; tx++) {
        if (m.tiles[m.idx(tx, ty)] !== T_WATER) continue;
        const x = tx * TILE, y = ty * TILE;
        const deep = hash(tx, ty + 99);
        c.fillStyle = `rgb(${38 + deep * 10}, ${84 + deep * 14}, ${130 + deep * 18})`;
        c.fillRect(x, y, TILE, TILE);
        const land = (ax: number, ay: number) => m.inBounds(ax, ay) && m.tiles[m.idx(ax, ay)] !== T_WATER;
        c.strokeStyle = 'rgba(190,225,255,.55)';
        c.lineWidth = 2;
        c.beginPath();
        if (land(tx - 1, ty)) { c.moveTo(x + 1, y); c.lineTo(x + 1, y + TILE); }
        if (land(tx + 1, ty)) { c.moveTo(x + TILE - 1, y); c.lineTo(x + TILE - 1, y + TILE); }
        if (land(tx, ty - 1)) { c.moveTo(x, y + 1); c.lineTo(x + TILE, y + 1); }
        if (land(tx, ty + 1)) { c.moveTo(x, y + TILE - 1); c.lineTo(x + TILE, y + TILE - 1); }
        c.stroke();
        c.strokeStyle = 'rgba(170,210,250,.3)';
        c.lineWidth = 1.2;
        c.beginPath();
        const k = Math.floor(deep * 5);
        c.moveTo(x + 4, y + 10 + k * 2);
        c.quadraticCurveTo(x + 12, y + 6 + k * 2, x + 20, y + 10 + k * 2);
        c.moveTo(x + 10, y + 22 + k);
        c.quadraticCurveTo(x + 18, y + 18 + k, x + 28, y + 22 + k);
        c.stroke();
      }
    // 5. Bäume (Schatten, Stamm, Krone)
    for (let ty = ey0; ty <= ey1; ty++)
      for (let tx = ex0; tx <= ex1; tx++) {
        const i = m.idx(tx, ty);
        if (m.tiles[i] !== T_TREE) continue;
        const sh = m.shade[i] / 255;
        const h = hash(tx * 11, ty * 7);
        const x = tx * TILE + 16 + (h - 0.5) * 6, y = ty * TILE + 20 + (hash(ty, tx) - 0.5) * 6;
        const r = 11 + h * 4;
        c.fillStyle = 'rgba(0,0,0,.28)';
        c.beginPath();
        c.ellipse(x + 5, y + 4, r + 2, r * 0.55, 0, 0, TAU);
        c.fill();
        c.fillStyle = '#4a2f16';
        c.fillRect(x - 3, y - 6, 6, 12);
        const g1 = `hsl(${112 + sh * 20}, 40%, ${20 + sh * 8}%)`;
        const g2 = `hsl(${112 + sh * 20}, 44%, ${28 + sh * 10}%)`;
        const g3 = `hsl(${105 + sh * 20}, 48%, ${38 + sh * 10}%)`;
        c.fillStyle = g1;
        c.beginPath();
        c.arc(x - r * 0.45, y - r * 0.4, r * 0.75, 0, TAU);
        c.arc(x + r * 0.45, y - r * 0.3, r * 0.75, 0, TAU);
        c.arc(x, y - r * 0.95, r * 0.7, 0, TAU);
        c.fill();
        c.fillStyle = g2;
        c.beginPath();
        c.arc(x - r * 0.2, y - r * 0.8, r * 0.6, 0, TAU);
        c.arc(x + r * 0.35, y - r * 0.6, r * 0.5, 0, TAU);
        c.fill();
        c.fillStyle = g3;
        c.beginPath();
        c.arc(x - r * 0.3, y - r * 1.05, r * 0.3, 0, TAU);
        c.fill();
        tc.fillStyle = '#1e4522';
        tc.fillRect(tx, ty, 1, 1);
      }
    c.restore();
  }

  private updateFogCanvas() {
    const g = this.game;
    if (this.fogDrawn === g.fogVersion) return;
    this.fogDrawn = g.fogVersion;
    const d = this.fogData.data;
    for (let i = 0; i < g.vis.length; i++) {
      const v = g.vis[i];
      const o = i * 4;
      if (v === 2) {
        d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 0;
      } else if (v === 1) {
        d[o] = 4; d[o + 1] = 6; d[o + 2] = 14; d[o + 3] = 130;
      } else {
        d[o] = 4; d[o + 1] = 6; d[o + 2] = 14; d[o + 3] = 255;
      }
    }
    this.fog.getContext('2d')!.putImageData(this.fogData, 0, 0);
  }

  // ---------- Hauptzeichnung ----------

  draw(overlay: Overlay) {
    const c = this.ctx, cam = this.cam, g = this.game, dpr = this.dpr;
    this.now = performance.now() / 1000;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#05080f';
    c.fillRect(0, 0, cam.w, cam.h);

    c.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, -cam.x * cam.zoom * dpr, -cam.y * cam.zoom * dpr);
    const vx0 = Math.max(0, cam.x), vy0 = Math.max(0, cam.y);
    const vx1 = Math.min(MAP_W * TILE, cam.x + cam.w / cam.zoom), vy1 = Math.min(MAP_H * TILE, cam.y + cam.h / cam.zoom);
    c.imageSmoothingEnabled = cam.zoom < 1;
    c.drawImage(this.terrain, vx0, vy0, vx1 - vx0, vy1 - vy0, vx0, vy0, vx1 - vx0, vy1 - vy0);
    c.imageSmoothingEnabled = true;

    const inView = (e: Entity) => e.x + e.radius + 60 > vx0 && e.x - e.radius - 60 < vx1 && e.y + e.radius + 60 > vy0 && e.y - e.radius - 80 < vy1;
    const selected = new Set(g.selection.map((e) => e.id));

    // Bodeneffekte
    for (const e of g.effects) if (e.kind === 'blood' || e.kind === 'ping' || e.kind === 'pingAttack' || e.kind === 'rally') this.drawEffect(c, e);

    // Auswahlmarkierungen unter den Einheiten
    for (const e of g.selection) {
      if (e.dead || !inView(e)) continue;
      c.strokeStyle = e.faction === 'player' ? '#5bd46b' : e.faction === 'enemy' || e.faction === 'creep' ? '#ff6b5b' : '#f5c542';
      c.lineWidth = 2;
      if (e.type === 'unit') {
        c.beginPath();
        c.ellipse(e.x, e.y + 2, e.radius + 5, (e.radius + 5) * 0.5, 0, 0, TAU);
        c.stroke();
      } else {
        const r = g.rectOf(e)!;
        c.strokeRect(r.x0 + 1, r.y0 + 1, r.x1 - r.x0 - 2, r.y1 - r.y0 - 2);
      }
    }

    // Sammelpunkt des gewählten Gebäudes
    for (const e of g.selection) if (e.type === 'building' && e.rally && e.faction === 'player') this.drawRallyFlag(c, e.rally.x, e.rally.y);

    const drawables: Entity[] = [];
    for (const m of g.mines) if (inView(m) && g.isExplored(m.x, m.y)) drawables.push(m);
    for (const b of g.buildings) if (!b.dead && inView(b) && g.playerCanSee(b)) drawables.push(b);
    for (const u of g.units) if (!u.dead && inView(u) && g.playerCanSee(u)) drawables.push(u);
    drawables.sort((a, b) => (a.type === 'unit' ? a.y : a.y + a.radius) - (b.type === 'unit' ? b.y : b.y + b.radius));
    for (const e of drawables) {
      if (e.type === 'unit') this.drawUnit(c, e, selected.has(e.id));
      else if (e.type === 'building') this.drawBuilding(c, e, selected.has(e.id));
      else this.drawMine(c, e, selected.has(e.id));
    }

    for (const p of g.projectiles) this.drawProjectile(c, p);
    for (const e of g.effects) if (e.kind !== 'blood' && e.kind !== 'ping' && e.kind !== 'pingAttack' && e.kind !== 'rally') this.drawEffect(c, e);

    // Nacht: blaue Abdunklung und warme Lichter
    const night = g.nightAmount();
    if (night > 0.02) {
      c.fillStyle = `rgba(10, 16, 48, ${night * 0.5})`;
      c.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
      c.globalCompositeOperation = 'lighter';
      for (const b of g.buildings) {
        if (b.dead || !b.built || !inView(b) || !g.playerCanSee(b)) continue;
        const warm = b.faction === 'player';
        const grd = c.createRadialGradient(b.x, b.y, 4, b.x, b.y, b.radius * 2.2);
        grd.addColorStop(0, warm ? `rgba(255,170,70,${0.28 * night})` : `rgba(150,60,220,${0.22 * night})`);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = grd;
        c.fillRect(b.x - b.radius * 2.2, b.y - b.radius * 2.2, b.radius * 4.4, b.radius * 4.4);
      }
      const h = g.hero('player');
      if (h && inView(h)) {
        const grd = c.createRadialGradient(h.x, h.y, 2, h.x, h.y, 70);
        grd.addColorStop(0, `rgba(255,220,120,${0.25 * night})`);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = grd;
        c.fillRect(h.x - 70, h.y - 70, 140, 140);
      }
      c.globalCompositeOperation = 'source-over';
    }

    // Nebel des Krieges
    this.updateFogCanvas();
    c.imageSmoothingEnabled = true;
    c.drawImage(this.fog, 0, 0, MAP_W, MAP_H, 0, 0, MAP_W * TILE, MAP_H * TILE);

    if (overlay.ghost) {
      const gh = overlay.ghost;
      const def = BUILDINGS[gh.defId];
      c.fillStyle = gh.ok ? 'rgba(91,212,107,.35)' : 'rgba(255,80,80,.35)';
      c.strokeStyle = gh.ok ? '#5bd46b' : '#ff5050';
      c.lineWidth = 2;
      c.fillRect(gh.tx * TILE, gh.ty * TILE, def.size * TILE, def.size * TILE);
      c.strokeRect(gh.tx * TILE, gh.ty * TILE, def.size * TILE, def.size * TILE);
    }

    // Bildschirmraum
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (overlay.box) {
      const b = overlay.box;
      c.fillStyle = 'rgba(91,212,107,.15)';
      c.strokeStyle = '#5bd46b';
      c.lineWidth = 1.5;
      c.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      c.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    }
  }

  private bar(c: Ctx, x: number, y: number, w: number, h: number, frac: number, color: string) {
    c.fillStyle = 'rgba(0,0,0,.65)';
    c.fillRect(x - 1, y - 1, w + 2, h + 2);
    c.fillStyle = color;
    c.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  }

  // ---------- Einheiten ----------

  private drawUnit(c: Ctx, u: Unit, selected: boolean) {
    const r = u.radius;
    const team = FACTION_COLOR[u.faction];
    c.fillStyle = 'rgba(0,0,0,.3)';
    c.beginPath();
    c.ellipse(u.x, u.y + 2, r * 1.1, r * 0.5, 0, 0, TAU);
    c.fill();
    if (u.def.look.glow) {
      const grd = c.createRadialGradient(u.x, u.y - 8, 2, u.x, u.y - 8, r * 2.4);
      grd.addColorStop(0, u.def.look.glow);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grd;
      c.fillRect(u.x - r * 2.4, u.y - 8 - r * 2.4, r * 4.8, r * 4.8);
    }
    const swing = u.attackAnim > 0 ? Math.sin((1 - u.attackAnim / 0.25) * Math.PI) : 0;
    this.drawFigure(c, u.x, u.y, u.def.look, team, Math.cos(u.facing) < 0, u.moving ? u.walkPhase : 0, swing, u.carry?.res ?? null);

    if (u.def.kind === 'hero') {
      c.fillStyle = '#1a1200';
      c.strokeStyle = '#f2d16b';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(u.x + r + 2, u.y - r * 2.6, 6, 0, TAU);
      c.fill();
      c.stroke();
      c.fillStyle = '#f2d16b';
      c.font = 'bold 8px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(u.level), u.x + r + 2, u.y - r * 2.6 + 0.5);
    }
    if (u.hp < u.maxHp || selected) {
      const w = r * 2 + 8;
      const h = 26 * u.def.look.scale + 8;
      this.bar(c, u.x - w / 2, u.y - h - 6, w, 3, u.hp / u.maxHp, u.faction === 'player' ? '#5bd46b' : u.faction === 'creep' ? '#f5c542' : '#ff5050');
    }
  }

  /**
   * Zeichnet eine Figur mit Fußpunkt (x, y). Alle Maße in Weltpixeln.
   * flip: Blick nach links; walk: Laufphase (0 = stehen); swing: 0..1 Angriffsschwung.
   */
  drawFigure(c: Ctx, x: number, y: number, look: UnitLook, team: string, flip: boolean, walk: number, swing: number, carry: 'gold' | 'wood' | null) {
    const s = look.scale;
    c.save();
    c.translate(x, y);
    c.scale(flip ? -s : s, s);
    const bob = walk ? Math.sin(walk * 2) * 1.2 : 0;
    const leg = walk ? Math.sin(walk) * 5 : 0;
    const shape = look.shape ?? 'biped';
    c.lineCap = 'round';
    c.lineJoin = 'round';

    if (shape === 'beast') this.drawBeast(c, look, team, leg, bob, swing);
    else if (shape === 'blob') this.drawBlob(c, look, swing);
    else if (shape === 'machine') this.drawMachine(c, look, team, swing);
    else this.drawBiped(c, look, team, leg, bob, swing, carry);
    c.restore();
  }

  private drawBiped(c: Ctx, look: UnitLook, team: string, leg: number, bob: number, swing: number, carry: 'gold' | 'wood' | null) {
    const body = look.body, trim = look.trim, skin = look.skin;
    // Umhang
    if (look.cape) {
      c.fillStyle = look.cape;
      c.beginPath();
      c.moveTo(-5, -21 + bob);
      c.lineTo(5, -21 + bob);
      c.lineTo(8 + leg * 0.3, -4 + bob);
      c.lineTo(-7 - leg * 0.3, -3 + bob);
      c.closePath();
      c.fill();
    }
    // Beine
    c.strokeStyle = trim;
    c.lineWidth = 3.2;
    c.beginPath();
    c.moveTo(-3, -10 + bob);
    c.lineTo(-3 - leg, 0);
    c.moveTo(3, -10 + bob);
    c.lineTo(3 + leg, 0);
    c.stroke();
    // Rumpf
    c.fillStyle = body;
    c.beginPath();
    c.roundRect(-6, -22 + bob, 12, 13, 3);
    c.fill();
    // Teamfarbe: Wappenrock-Streifen
    c.fillStyle = team;
    c.fillRect(-2, -21 + bob, 4, 11);
    c.fillStyle = 'rgba(255,255,255,.18)';
    c.fillRect(-6, -22 + bob, 12, 3);
    // Hinterer Arm (Schild oder frei)
    c.strokeStyle = skin;
    c.lineWidth = 2.6;
    if (look.shield) {
      c.beginPath();
      c.moveTo(-5, -18 + bob);
      c.lineTo(-9, -12 + bob);
      c.stroke();
      c.fillStyle = trim;
      c.strokeStyle = team;
      c.lineWidth = 1.5;
      c.beginPath();
      c.ellipse(-10, -13 + bob, 4.5, 6, 0, 0, TAU);
      c.fill();
      c.stroke();
    } else {
      c.beginPath();
      c.moveTo(-5, -18 + bob);
      c.lineTo(-8, -11 + bob);
      c.stroke();
    }
    // Kopf
    c.fillStyle = skin;
    c.beginPath();
    c.arc(0, -27 + bob, 5, 0, TAU);
    c.fill();
    this.drawHead(c, look, team, bob);
    // Vorderer Arm mit Waffe (schwingt beim Angriff)
    c.save();
    c.translate(5, -18 + bob);
    c.rotate(-0.4 + swing * -1.4);
    c.strokeStyle = skin;
    c.lineWidth = 2.6;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(5, 5);
    c.stroke();
    c.translate(5, 5);
    this.drawWeapon(c, look.weapon, trim, carry);
    c.restore();
  }

  private drawHead(c: Ctx, look: UnitLook, team: string, bob: number) {
    const y = -27 + bob;
    switch (look.head) {
      case 'cap':
        c.fillStyle = look.body;
        c.beginPath();
        c.arc(0, y - 1, 5.5, Math.PI, TAU);
        c.fill();
        c.fillRect(-6, y - 1, 12, 1.5);
        break;
      case 'helm':
        c.fillStyle = '#b9c0cc';
        c.beginPath();
        c.arc(0, y - 0.5, 5.6, Math.PI, TAU);
        c.fill();
        c.fillRect(-5.6, y - 0.5, 11.2, 2.5);
        c.fillRect(-1, y, 2, 4);
        c.fillStyle = team;
        c.fillRect(-1, y - 8, 2, 3);
        break;
      case 'hood':
        c.fillStyle = look.trim;
        c.beginPath();
        c.moveTo(-6, y + 2);
        c.quadraticCurveTo(-6, y - 7, 0, y - 7);
        c.quadraticCurveTo(6, y - 7, 6, y + 2);
        c.lineTo(4, y + 3);
        c.quadraticCurveTo(0, y - 4, -4, y + 3);
        c.closePath();
        c.fill();
        break;
      case 'crown':
        c.fillStyle = '#f2d16b';
        c.beginPath();
        c.moveTo(-5, y - 3);
        c.lineTo(-5, y - 8);
        c.lineTo(-2.5, y - 5);
        c.lineTo(0, y - 9);
        c.lineTo(2.5, y - 5);
        c.lineTo(5, y - 8);
        c.lineTo(5, y - 3);
        c.closePath();
        c.fill();
        break;
      case 'skull':
        c.fillStyle = '#d8d8cc';
        c.beginPath();
        c.arc(0, y, 5, 0, TAU);
        c.fill();
        c.fillStyle = '#1a1a1a';
        c.beginPath();
        c.arc(-2, y - 0.5, 1.4, 0, TAU);
        c.arc(2, y - 0.5, 1.4, 0, TAU);
        c.fill();
        break;
      case 'horns':
        c.strokeStyle = '#e8e0c8';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(-4, y - 3);
        c.quadraticCurveTo(-8, y - 8, -5, y - 11);
        c.moveTo(4, y - 3);
        c.quadraticCurveTo(8, y - 8, 5, y - 11);
        c.stroke();
        c.fillStyle = '#ff3a3a';
        c.beginPath();
        c.arc(-2, y - 0.5, 1.2, 0, TAU);
        c.arc(2, y - 0.5, 1.2, 0, TAU);
        c.fill();
        break;
      case 'bare':
        c.fillStyle = look.trim;
        c.beginPath();
        c.arc(0, y - 1.5, 5, Math.PI * 1.1, Math.PI * 1.9);
        c.fill();
        break;
      case 'none':
        break;
    }
  }

  private drawWeapon(c: Ctx, w: UnitLook['weapon'], trim: string, carry: 'gold' | 'wood' | null) {
    if (carry) {
      c.fillStyle = carry === 'gold' ? '#f5c542' : '#8b5a2b';
      c.beginPath();
      if (carry === 'gold') c.arc(1, 1, 3.5, 0, TAU);
      else c.roundRect(-2, -2, 9, 4, 1);
      c.fill();
      return;
    }
    switch (w) {
      case 'pick':
        c.strokeStyle = '#6a4a22';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(0, 2);
        c.lineTo(8, -6);
        c.stroke();
        c.strokeStyle = '#c8c8d0';
        c.lineWidth = 2.5;
        c.beginPath();
        c.moveTo(5, -9);
        c.lineTo(11, -3);
        c.stroke();
        break;
      case 'sword':
        c.strokeStyle = '#e6e8f0';
        c.lineWidth = 2.2;
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(10, -9);
        c.stroke();
        c.strokeStyle = '#8a7030';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(0.5, -2.5);
        c.lineTo(3.5, 0.5);
        c.stroke();
        break;
      case 'greatsword':
        c.strokeStyle = '#fff6d0';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(15, -13);
        c.stroke();
        c.strokeStyle = '#c99a2e';
        c.lineWidth = 2.2;
        c.beginPath();
        c.moveTo(-1, -4);
        c.lineTo(4, 1);
        c.stroke();
        break;
      case 'bow':
        c.strokeStyle = '#6b4a2a';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(2, 0, 8, -1.3, 1.3);
        c.stroke();
        c.strokeStyle = '#ddd';
        c.lineWidth = 0.8;
        c.beginPath();
        c.moveTo(2 + Math.cos(-1.3) * 8, Math.sin(-1.3) * 8);
        c.lineTo(2 + Math.cos(1.3) * 8, Math.sin(1.3) * 8);
        c.stroke();
        break;
      case 'claw':
        c.strokeStyle = '#e8e0c8';
        c.lineWidth = 1.6;
        c.beginPath();
        for (let i = -1; i <= 1; i++) {
          c.moveTo(0, i * 2);
          c.lineTo(7, i * 3 - 2);
        }
        c.stroke();
        break;
      case 'club':
        c.strokeStyle = trim;
        c.lineWidth = 3.5;
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(9, -9);
        c.stroke();
        c.fillStyle = '#6a6056';
        c.beginPath();
        c.arc(10, -10, 4, 0, TAU);
        c.fill();
        break;
      case 'lance':
        c.strokeStyle = '#c8b48a';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(-4, 4);
        c.lineTo(18, -4);
        c.stroke();
        c.fillStyle = '#e6e8f0';
        c.beginPath();
        c.moveTo(18, -4);
        c.lineTo(22, -5.5);
        c.lineTo(18.5, -1.5);
        c.fill();
        break;
      default:
        break;
    }
  }

  private drawBeast(c: Ctx, look: UnitLook, team: string, leg: number, bob: number, swing: number) {
    const rider = look.weapon === 'lance';
    const bodyY = -11 + bob;
    // Beine
    c.strokeStyle = look.trim;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(-8, bodyY + 3); c.lineTo(-9 - leg, 0);
    c.moveTo(-4, bodyY + 3); c.lineTo(-3 + leg, 0);
    c.moveTo(5, bodyY + 3); c.lineTo(4 - leg, 0);
    c.moveTo(9, bodyY + 3); c.lineTo(10 + leg, 0);
    c.stroke();
    // Rumpf
    c.fillStyle = look.body;
    c.beginPath();
    c.ellipse(0, bodyY, 13, 6.5, 0, 0, TAU);
    c.fill();
    // Hals/Kopf
    c.beginPath();
    c.moveTo(9, bodyY - 2);
    c.lineTo(15, bodyY - 10);
    c.lineTo(19, bodyY - 9);
    c.lineTo(20, bodyY - 5);
    c.lineTo(13, bodyY + 1);
    c.closePath();
    c.fill();
    if (!rider) {
      // Wolf: Ohren, Schwanz, Augen
      c.beginPath();
      c.moveTo(14, bodyY - 10); c.lineTo(13, bodyY - 14); c.lineTo(16, bodyY - 11);
      c.fill();
      c.strokeStyle = look.body;
      c.lineWidth = 2.5;
      c.beginPath();
      c.moveTo(-12, bodyY - 2);
      c.quadraticCurveTo(-18, bodyY - 8, -16, bodyY - 12);
      c.stroke();
      c.fillStyle = '#ffd34a';
      c.beginPath();
      c.arc(17, bodyY - 8, 1, 0, TAU);
      c.fill();
      // Zähne beim Biss
      if (swing > 0.3) {
        c.fillStyle = '#fff';
        c.beginPath();
        c.moveTo(19, bodyY - 5); c.lineTo(21, bodyY - 2); c.lineTo(18, bodyY - 3);
        c.fill();
      }
    } else {
      // Pferd: Mähne in Trim, Sattel in Teamfarbe, Reiter
      c.fillStyle = look.trim;
      c.beginPath();
      c.moveTo(9, bodyY - 3); c.lineTo(15, bodyY - 11); c.lineTo(13, bodyY - 5);
      c.fill();
      c.fillStyle = team;
      c.beginPath();
      c.roundRect(-6, bodyY - 8, 10, 5, 2);
      c.fill();
      c.save();
      c.translate(-1, bodyY - 6);
      c.scale(0.8, 0.8);
      const riderLook: UnitLook = { ...look, shape: 'biped', scale: 1, cape: look.cape };
      this.drawBiped(c, riderLook, team, 0, 0, swing, null);
      c.restore();
    }
  }

  private drawBlob(c: Ctx, look: UnitLook, swing: number) {
    const t = this.now * 3;
    const w = 9 + Math.sin(t) * 0.8, h = 12 + Math.cos(t * 1.3) * 0.8 + swing * 3;
    c.fillStyle = look.body;
    c.beginPath();
    c.ellipse(0, -h + 1, w, h, 0, 0, TAU);
    c.fill();
    c.fillStyle = look.skin;
    c.beginPath();
    c.ellipse(-2, -h - 2, w * 0.5, h * 0.45, -0.4, 0, TAU);
    c.fill();
    // Tentakel
    c.strokeStyle = look.trim;
    c.lineWidth = 2;
    c.beginPath();
    for (let i = -1; i <= 1; i++) {
      c.moveTo(i * 5, -3);
      c.quadraticCurveTo(i * 8 + Math.sin(t + i) * 3, 2, i * 10, 1);
    }
    c.stroke();
    // Augen und Maul
    c.fillStyle = '#e0ff60';
    c.beginPath();
    c.arc(3, -h - 2, 2, 0, TAU);
    c.arc(7, -h, 1.5, 0, TAU);
    c.fill();
    c.fillStyle = '#2a0a30';
    c.beginPath();
    c.ellipse(6, -h + 6, 3 + swing * 2, 1.5 + swing * 2, 0, 0, TAU);
    c.fill();
  }

  private drawMachine(c: Ctx, look: UnitLook, team: string, swing: number) {
    // Räder
    c.fillStyle = look.trim;
    c.strokeStyle = '#2a2018';
    c.lineWidth = 1.5;
    for (const wx of [-9, 9]) {
      c.beginPath();
      c.arc(wx, -4, 5, 0, TAU);
      c.fill();
      c.stroke();
    }
    // Rahmen
    c.fillStyle = look.body;
    c.beginPath();
    c.roundRect(-14, -12, 28, 8, 2);
    c.fill();
    c.fillStyle = team;
    c.fillRect(-14, -12, 28, 2);
    // Wurfarm: ruht nach hinten, schnellt beim Schuss nach vorn
    const ang = -2.2 + swing * 2.6;
    c.save();
    c.translate(-4, -11);
    c.rotate(ang);
    c.strokeStyle = look.trim;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(20, 0);
    c.stroke();
    c.fillStyle = look.weapon === 'bonehurler' ? '#e8e0c8' : '#7a7066';
    c.beginPath();
    c.arc(21, 0, 3.5, 0, TAU);
    c.fill();
    c.restore();
    // Stützbalken
    c.strokeStyle = shade(look.body, 0.75);
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(-6, -12);
    c.lineTo(0, -22);
    c.lineTo(6, -12);
    c.stroke();
    if (look.weapon === 'bonehurler') {
      c.fillStyle = '#e8e0c8';
      for (let i = 0; i < 3; i++) {
        c.beginPath();
        c.arc(-12 + i * 5, -14, 1.6, 0, TAU);
        c.fill();
      }
    }
  }

  // ---------- Gebäude ----------

  private drawBuilding(c: Ctx, b: Building, selected: boolean) {
    const r = this.game.rectOf(b)!;
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    const x0 = r.x0 + 3, x1 = r.x1 - 3, y1 = r.y1 - 3, y0 = r.y0 + 3;
    const team = FACTION_COLOR[b.faction];
    const H = b.size * 11; // Wandhöhe
    const built = b.built;
    const prog = built ? 1 : 0.25 + b.progress * 0.75;

    // Bodenplatte / Schatten
    c.fillStyle = 'rgba(0,0,0,.28)';
    c.beginPath();
    c.ellipse(b.x + 6, b.y + 6, w * 0.6, h * 0.42, 0, 0, TAU);
    c.fill();

    if (!built) c.globalAlpha = 0.75;
    switch (b.def.style) {
      case 'keep': this.drawKeep(c, x0, y0, x1, y1, H * prog, team); break;
      case 'barracks': this.drawBarracks(c, x0, y0, x1, y1, H * prog, team); break;
      case 'homestead': this.drawHomestead(c, x0, y0, x1, y1, H * prog, team); break;
      case 'tower': this.drawTower(c, x0, y0, x1, y1, (H + 18) * prog, team); break;
      case 'forge': this.drawForge(c, x0, y0, x1, y1, H * prog, team); break;
      case 'crypt': this.drawCrypt(c, x0, y0, x1, y1, H * prog); break;
      case 'pit': this.drawPit(c, x0, y0, x1, y1); break;
      case 'mound': this.drawMound(c, x0, y0, x1, y1, H * prog); break;
      case 'spire': this.drawSpire(c, x0, y0, x1, y1, (H + 24) * prog); break;
    }
    c.globalAlpha = 1;

    if (!built) {
      // Gerüst
      c.strokeStyle = 'rgba(220,190,120,.8)';
      c.lineWidth = 1.5;
      c.beginPath();
      for (let i = 0; i < 4; i++) {
        const px = x0 + 4 + (i / 3) * (w - 14);
        c.moveTo(px, y1);
        c.lineTo(px, y1 - H - 6);
      }
      c.moveTo(x0 + 4, y1 - H - 6);
      c.lineTo(x1 - 4, y1 - H - 6);
      c.moveTo(x0 + 4, y1 - H / 2);
      c.lineTo(x1 - 4, y1 - H / 2);
      c.stroke();
      this.bar(c, r.x0 + 4, r.y1 - 9, w - 8, 4, b.progress, '#f2d16b');
    } else if (b.queue.length) this.bar(c, r.x0 + 4, r.y1 - 9, w - 8, 4, b.queue[0].t / b.queue[0].total, '#8fd3ff');
    if (b.hp < b.maxHp || selected) this.bar(c, r.x0 + 4, r.y0 - H - 14, w - 8, 4, b.hp / b.maxHp, b.faction === 'player' ? '#5bd46b' : '#ff5050');
  }

  /** Quader aus Vogelperspektive: Dachfläche oben, Frontwand unten. */
  private box(c: Ctx, x0: number, y0: number, x1: number, y1: number, H: number, top: string, front: string, edge = 'rgba(0,0,0,.35)') {
    c.fillStyle = front;
    c.fillRect(x0, y1 - H, x1 - x0, H);
    c.fillStyle = top;
    c.fillRect(x0, y0 - H, x1 - x0, y1 - y0);
    c.strokeStyle = edge;
    c.lineWidth = 1.5;
    c.strokeRect(x0 + 0.5, y0 - H + 0.5, x1 - x0 - 1, y1 - y0 - 1);
    c.strokeRect(x0 + 0.5, y1 - H + 0.5, x1 - x0 - 1, H - 1);
  }

  private battlements(c: Ctx, x0: number, x1: number, y: number, color: string, step = 10) {
    c.fillStyle = color;
    for (let x = x0; x < x1 - 4; x += step) c.fillRect(x, y - 5, 5, 5);
  }

  private flag(c: Ctx, x: number, y: number, team: string, len = 14) {
    c.strokeStyle = '#3a2a18';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x, y - len);
    c.stroke();
    const wave = Math.sin(this.now * 4 + x) * 1.5;
    c.fillStyle = team;
    c.beginPath();
    c.moveTo(x, y - len);
    c.lineTo(x + 9, y - len + 3 + wave);
    c.lineTo(x, y - len + 6);
    c.closePath();
    c.fill();
  }

  private drawKeep(c: Ctx, x0: number, y0: number, x1: number, y1: number, H: number, team: string) {
    this.box(c, x0, y0, x1, y1, H, '#9a927f', '#6f675a');
    // Mauerfugen
    c.strokeStyle = 'rgba(0,0,0,.18)';
    c.lineWidth = 1;
    c.beginPath();
    for (let y = y1 - H + 6; y < y1; y += 7) { c.moveTo(x0, y); c.lineTo(x1, y); }
    c.stroke();
    this.battlements(c, x0, x1, y1 - H, '#a8a090');
    // Ecktürme
    const ty = y0 - H;
    for (const [cx, cy] of [[x0 + 8, ty + 8], [x1 - 8, ty + 8], [x0 + 8, y1 - H - 8], [x1 - 8, y1 - H - 8]]) {
      c.fillStyle = '#b4ac9a';
      c.beginPath();
      c.arc(cx, cy, 7, 0, TAU);
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,.3)';
      c.stroke();
    }
    // Hauptturm in der Mitte, höher
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 - H;
    c.fillStyle = '#7d7566';
    c.fillRect(cx - 12, cy - 14, 24, 26);
    c.fillStyle = '#aba393';
    c.fillRect(cx - 12, cy - 26, 24, 14);
    c.strokeStyle = 'rgba(0,0,0,.35)';
    c.strokeRect(cx - 11.5, cy - 25.5, 23, 37);
    this.battlements(c, cx - 12, cx + 13, cy - 26, '#bdb5a3', 8);
    this.flag(c, cx, cy - 26, team, 16);
    // Tor
    c.fillStyle = '#2a1d10';
    c.beginPath();
    c.arc(cx, y1 - 1, 7, Math.PI, TAU);
    c.fill();
    c.fillRect(cx - 7, y1 - 1, 14, 1);
    // Fenster
    c.fillStyle = '#f7d27a';
    c.fillRect(cx - 2, cy - 8, 4, 5);
  }

  private drawBarracks(c: Ctx, x0: number, y0: number, x1: number, y1: number, H: number, team: string) {
    this.box(c, x0, y0, x1, y1, H, '#7a4d2e', '#5a3820');
    // Satteldach: zwei Hälften
    const my = (y0 + y1) / 2 - H;
    c.fillStyle = '#8f5a36';
    c.fillRect(x0, y0 - H, x1 - x0, my - (y0 - H));
    c.fillStyle = '#6b3f22';
    c.fillRect(x0, my, x1 - x0, y1 - H - my);
    c.strokeStyle = 'rgba(0,0,0,.25)';
    c.lineWidth = 1;
    c.beginPath();
    for (let x = x0 + 6; x < x1; x += 8) { c.moveTo(x, y0 - H); c.lineTo(x, y1 - H); }
    c.moveTo(x0, my); c.lineTo(x1, my);
    c.stroke();
    // Holzbalken an der Front
    c.strokeStyle = '#3a2412';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x0, y1 - H); c.lineTo(x1, y1);
    c.moveTo(x1, y1 - H); c.lineTo(x0, y1);
    c.stroke();
    c.fillStyle = '#2a1a0c';
    c.fillRect((x0 + x1) / 2 - 6, y1 - 12, 12, 12);
    this.flag(c, x0 + 6, y1 - H, team);
    this.flag(c, x1 - 6, y1 - H, team);
    // Schwerter über dem Tor
    c.strokeStyle = '#d8dce6';
    c.lineWidth = 2;
    c.beginPath();
    const cx = (x0 + x1) / 2;
    c.moveTo(cx - 7, y1 - H + 4); c.lineTo(cx + 7, y1 - 14);
    c.moveTo(cx + 7, y1 - H + 4); c.lineTo(cx - 7, y1 - 14);
    c.stroke();
  }

  private drawHomestead(c: Ctx, x0: number, y0: number, x1: number, y1: number, H: number, team: string) {
    // Felder im unteren Teil
    c.fillStyle = '#8a7a3a';
    c.fillRect(x0, y0 + 2, x1 - x0, y1 - y0 - 2);
    c.strokeStyle = '#c9b36b';
    c.lineWidth = 1.5;
    c.beginPath();
    for (let y = y0 + 5; y < y1; y += 5) { c.moveTo(x0 + 2, y); c.lineTo(x1 - 2, y); }
    c.stroke();
    // Haus oben links
    const hx0 = x0 + 2, hx1 = x0 + (x1 - x0) * 0.62, hy0 = y0 + 2, hy1 = y0 + (y1 - y0) * 0.6;
    this.box(c, hx0, hy0, hx1, hy1, H, '#b0442e', '#d9cfa8');
    c.fillStyle = '#8c3322';
    c.fillRect(hx0, hy0 - H, hx1 - hx0, (hy1 - hy0) / 2);
    c.fillStyle = '#4a2a14';
    c.fillRect((hx0 + hx1) / 2 - 3, hy1 - 8, 6, 8);
    c.fillStyle = '#f7d27a';
    c.fillRect(hx0 + 4, hy1 - H + 3, 4, 4);
    // Zaun
    c.strokeStyle = '#8a6a3a';
    c.lineWidth = 1.5;
    c.beginPath();
    for (let x = x0 + 2; x < x1; x += 6) { c.moveTo(x, y1 - 1); c.lineTo(x, y1 - 6); }
    c.moveTo(x0, y1 - 4); c.lineTo(x1, y1 - 4);
    c.stroke();
    this.flag(c, hx1 - 2, hy1 - H, team, 10);
  }

  private drawTower(c: Ctx, x0: number, y0: number, x1: number, y1: number, H: number, team: string) {
    const cx = (x0 + x1) / 2, rx = (x1 - x0) / 2 - 2, ry = rx * 0.45;
    const base = y1 - ry - 2;
    // Zylinder
    c.fillStyle = '#7f7f8c';
    c.fillRect(cx - rx, base - H, rx * 2, H);
    const grd = c.createLinearGradient(cx - rx, 0, cx + rx, 0);
    grd.addColorStop(0, '#5f5f6c');
    grd.addColorStop(0.5, '#9a9aa8');
    grd.addColorStop(1, '#5a5a66');
    c.fillStyle = grd;
    c.fillRect(cx - rx, base - H, rx * 2, H);
    c.beginPath();
    c.ellipse(cx, base, rx, ry, 0, 0, Math.PI);
    c.fill();
    c.fillStyle = '#b1b1bf';
    c.beginPath();
    c.ellipse(cx, base - H, rx, ry, 0, 0, TAU);
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,.35)';
    c.lineWidth = 1.5;
    c.stroke();
    this.battlements(c, cx - rx, cx + rx + 2, base - H - ry + 1, '#c3c3cf', 7);
    c.fillStyle = '#2a2a30';
    c.fillRect(cx - 2, base - H * 0.6, 4, 6);
    this.flag(c, cx, base - H - ry, team, 12);
  }

  private drawForge(c: Ctx, x0: number, y0: number, x1: number, y1: number, H: number, team: string) {
    this.box(c, x0, y0, x1, y1, H, '#6a625a', '#4f483f');
    c.strokeStyle = 'rgba(0,0,0,.2)';
    c.lineWidth = 1;
    c.beginPath();
    for (let y = y1 - H + 5; y < y1; y += 6) { c.moveTo(x0, y); c.lineTo(x1, y); }
    c.stroke();
    // Schornstein
    c.fillStyle = '#3a3430';
    c.fillRect(x1 - 16, y0 - H - 14, 9, 22);
    c.fillStyle = '#55504a';
    c.fillRect(x1 - 17, y0 - H - 16, 11, 4);
    // Glühendes Tor
    const cx = (x0 + x1) / 2;
    const g = c.createRadialGradient(cx, y1 - 4, 1, cx, y1 - 4, 14);
    g.addColorStop(0, '#ffb347');
    g.addColorStop(0.5, '#c2461c');
    g.addColorStop(1, '#2a1208');
    c.fillStyle = g;
    c.beginPath();
    c.arc(cx, y1 - 1, 9, Math.PI, TAU);
    c.fill();
    // Amboss auf dem Dach als Zeichen
    c.fillStyle = '#2a2a30';
    c.fillRect(x0 + 8, y0 - H + 10, 14, 4);
    c.fillRect(x0 + 12, y0 - H + 14, 6, 5);
    this.flag(c, x0 + 5, y1 - H, team, 12);
  }

  private drawCrypt(c: Ctx, x0: number, y0: number, x1: number, y1: number, H: number) {
    // Dreistufige Zikkurat
    const steps = 3;
    for (let i = 0; i < steps; i++) {
      const inset = i * 9;
      const h = (H / steps) * (i + 1);
      this.box(c, x0 + inset, y0 + inset * 0.6, x1 - inset, y1 - inset * 0.6, h, mix('#5a5468', '#3a3444', i / steps), mix('#3a3444', '#221e2a', i / steps), 'rgba(0,0,0,.5)');
    }
    const cx = (x0 + x1) / 2, top = (y0 + y1) / 2 - H;
    // Grünes Grabfeuer
    const g = c.createRadialGradient(cx, top, 1, cx, top, 16);
    g.addColorStop(0, 'rgba(180,255,160,.9)');
    g.addColorStop(0.4, 'rgba(90,220,120,.6)');
    g.addColorStop(1, 'rgba(60,200,100,0)');
    c.fillStyle = g;
    c.fillRect(cx - 16, top - 16, 32, 32);
    // Schädel an der Front
    c.fillStyle = '#d8d8cc';
    for (let x = x0 + 8; x < x1 - 4; x += 12) {
      c.beginPath();
      c.arc(x, y1 - H * 0.5, 3, 0, TAU);
      c.fill();
    }
    c.fillStyle = '#111';
    for (let x = x0 + 8; x < x1 - 4; x += 12) {
      c.fillRect(x - 2, y1 - H * 0.5 - 1, 1.2, 1.2);
      c.fillRect(x + 0.8, y1 - H * 0.5 - 1, 1.2, 1.2);
    }
    // Eingang
    c.fillStyle = '#0a0a10';
    c.beginPath();
    c.arc(cx, y1 - 1, 7, Math.PI, TAU);
    c.fill();
  }

  private drawPit(c: Ctx, x0: number, y0: number, x1: number, y1: number) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
    c.fillStyle = '#4a3a3a';
    c.beginPath();
    c.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    c.fill();
    const g = c.createRadialGradient(cx, cy, 2, cx, cy, rx * 0.8);
    g.addColorStop(0, '#0d0a12');
    g.addColorStop(0.6, '#2d1a3a');
    g.addColorStop(1, '#5a3f55');
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(cx, cy, rx * 0.8, ry * 0.75, 0, 0, TAU);
    c.fill();
    // Blubbernde Brühe
    const t = this.now;
    c.fillStyle = 'rgba(140,255,120,.55)';
    for (let i = 0; i < 4; i++) {
      const a = t * 0.8 + i * 1.6;
      c.beginPath();
      c.arc(cx + Math.cos(a) * rx * 0.4, cy + Math.sin(a * 1.3) * ry * 0.35, 2 + Math.sin(t * 3 + i) * 1, 0, TAU);
      c.fill();
    }
    // Knochen am Rand
    c.strokeStyle = '#d8d0c0';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x0 + 6, y0 + 8); c.lineTo(x0 + 14, y0 + 3);
    c.moveTo(x1 - 6, y1 - 8); c.lineTo(x1 - 14, y1 - 4);
    c.moveTo(x1 - 8, y0 + 10); c.lineTo(x1 - 3, y0 + 18);
    c.stroke();
  }

  private drawMound(c: Ctx, x0: number, y0: number, x1: number, y1: number, H: number) {
    const cx = (x0 + x1) / 2, rx = (x1 - x0) / 2;
    c.fillStyle = '#4e4a3a';
    c.beginPath();
    c.ellipse(cx, y1 - 6, rx, (y1 - y0) * 0.35, 0, 0, TAU);
    c.fill();
    c.fillStyle = '#5e5a48';
    c.beginPath();
    c.ellipse(cx, y1 - 6, rx, H + 6, 0, Math.PI, TAU);
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,.3)';
    c.stroke();
    // Grabstein
    c.fillStyle = '#8a8a90';
    c.beginPath();
    c.roundRect(cx - 5, y1 - H - 14, 10, 14, [5, 5, 0, 0]);
    c.fill();
    c.strokeStyle = '#2a2a30';
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(cx, y1 - H - 11); c.lineTo(cx, y1 - H - 5);
    c.moveTo(cx - 3, y1 - H - 9); c.lineTo(cx + 3, y1 - H - 9);
    c.stroke();
  }

  private drawSpire(c: Ctx, x0: number, y0: number, x1: number, y1: number, H: number) {
    const cx = (x0 + x1) / 2, base = y1 - 4;
    c.fillStyle = '#3a3440';
    c.beginPath();
    c.ellipse(cx, base, (x1 - x0) / 2 - 2, 7, 0, 0, TAU);
    c.fill();
    c.fillStyle = '#8f8a98';
    c.beginPath();
    c.moveTo(cx - 12, base);
    c.lineTo(cx - 3, base - H);
    c.lineTo(cx + 3, base - H);
    c.lineTo(cx + 12, base);
    c.closePath();
    c.fill();
    c.fillStyle = '#6b6675';
    c.beginPath();
    c.moveTo(cx, base);
    c.lineTo(cx + 3, base - H);
    c.lineTo(cx + 12, base);
    c.closePath();
    c.fill();
    // Rippen
    c.strokeStyle = '#d8d0e0';
    c.lineWidth = 1.5;
    c.beginPath();
    for (let i = 1; i <= 4; i++) {
      const y = base - (H * i) / 5;
      const wdt = 12 * (1 - i / 5);
      c.moveTo(cx - wdt - 3, y + 2); c.lineTo(cx + wdt + 3, y + 2);
    }
    c.stroke();
    const g = c.createRadialGradient(cx, base - H, 1, cx, base - H, 10);
    g.addColorStop(0, 'rgba(230,150,255,.95)');
    g.addColorStop(1, 'rgba(180,80,255,0)');
    c.fillStyle = g;
    c.fillRect(cx - 10, base - H - 10, 20, 20);
  }

  private drawMine(c: Ctx, m: Mine, selected: boolean) {
    const r = this.game.rectOf(m)!;
    c.fillStyle = 'rgba(0,0,0,.3)';
    c.beginPath();
    c.ellipse(m.x + 4, m.y + 10, 46, 34, 0, 0, TAU);
    c.fill();
    // Felsen in Schichten
    const layers: [number, number, number, number, string][] = [[0, 6, 46, 32, '#5c5a5a'], [-6, -4, 36, 26, '#6f6c6a'], [6, -10, 26, 20, '#807c78'], [-12, -14, 18, 14, '#8e8a84']];
    for (const [ox, oy, rx, ry, col] of layers) {
      c.fillStyle = col;
      c.beginPath();
      c.ellipse(m.x + ox, m.y + oy, rx, ry, 0, 0, TAU);
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,.25)';
      c.lineWidth = 1;
      c.stroke();
    }
    // Stolleneingang mit Holzrahmen
    c.fillStyle = '#1e1a18';
    c.beginPath();
    c.ellipse(m.x, m.y + 18, 14, 12, 0, Math.PI, TAU);
    c.fill();
    c.fillRect(m.x - 14, m.y + 18, 28, 4);
    c.strokeStyle = '#6a4a22';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(m.x - 15, m.y + 22); c.lineTo(m.x - 15, m.y + 8);
    c.moveTo(m.x + 15, m.y + 22); c.lineTo(m.x + 15, m.y + 8);
    c.moveTo(m.x - 17, m.y + 8); c.lineTo(m.x + 17, m.y + 8);
    c.stroke();
    if (m.gold > 0) {
      c.fillStyle = '#f5c542';
      for (const [ox, oy] of [[-26, -4], [-14, -16], [10, -18], [26, -8], [22, 10], [-30, 10], [2, -2]]) {
        c.beginPath();
        c.ellipse(m.x + ox, m.y + oy, 3.5, 2.5, ox * 0.1, 0, TAU);
        c.fill();
      }
      c.fillStyle = '#fff2a0';
      for (const [ox, oy] of [[-27, -5], [9, -19], [25, -9]]) c.fillRect(m.x + ox, m.y + oy, 1.5, 1.5);
    }
    if (selected) {
      c.fillStyle = '#fff';
      c.font = 'bold 12px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(`${m.gold} Gold`, m.x, r.y0 - 8);
    }
  }

  private drawRallyFlag(c: Ctx, x: number, y: number) {
    c.fillStyle = 'rgba(0,0,0,.3)';
    c.beginPath();
    c.ellipse(x, y + 1, 7, 3, 0, 0, TAU);
    c.fill();
    this.flag(c, x, y, '#f2d16b', 18);
  }

  // ---------- Projektile und Effekte ----------

  private drawProjectile(c: Ctx, p: Projectile) {
    const d = Math.hypot(p.tx - p.x, p.ty - p.y) || 1;
    const nx = (p.tx - p.x) / d, ny = (p.ty - p.y) / d;
    const f = Math.min(1, p.travelled / Math.max(1, p.total));
    const lift = Math.sin(f * Math.PI) * p.arc;
    const y = p.y - lift;
    c.fillStyle = 'rgba(0,0,0,.25)';
    c.beginPath();
    c.ellipse(p.x, p.y + 4, 4, 2, 0, 0, TAU);
    c.fill();
    switch (p.kind) {
      case 'arrow':
      case 'bolt':
        c.strokeStyle = p.kind === 'bolt' ? '#ffe28a' : '#e8e2c0';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(p.x - nx * 8, y - ny * 8);
        c.lineTo(p.x + nx * 4, y + ny * 4);
        c.stroke();
        c.fillStyle = '#ccc';
        c.beginPath();
        c.arc(p.x + nx * 4, y + ny * 4, 1.5, 0, TAU);
        c.fill();
        break;
      case 'rock':
        c.fillStyle = '#7a7066';
        c.beginPath();
        c.arc(p.x, y, 5, 0, TAU);
        c.fill();
        c.fillStyle = '#9a9086';
        c.beginPath();
        c.arc(p.x - 1.5, y - 1.5, 2, 0, TAU);
        c.fill();
        break;
      case 'spit':
        c.fillStyle = '#b06fd0';
        c.beginPath();
        c.ellipse(p.x, y, 5, 3, Math.atan2(ny, nx), 0, TAU);
        c.fill();
        c.fillStyle = '#e0ff60';
        c.beginPath();
        c.arc(p.x, y, 1.5, 0, TAU);
        c.fill();
        break;
    }
  }

  private drawEffect(c: Ctx, e: Effect) {
    const k = Math.max(0, e.t / e.dur);
    if (e.t < 0) return;
    c.lineWidth = 2;
    switch (e.kind) {
      case 'ring':
        c.strokeStyle = e.color;
        c.globalAlpha = 1 - k;
        c.beginPath();
        c.ellipse(e.x, e.y, e.r * (0.6 + k * 0.6), e.r * (0.6 + k * 0.6) * 0.6, 0, 0, TAU);
        c.stroke();
        break;
      case 'hit':
        c.fillStyle = e.color;
        c.globalAlpha = 1 - k;
        c.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU + k * 2;
          c.moveTo(e.x, e.y);
          c.lineTo(e.x + Math.cos(a) * e.r * (1 + k), e.y + Math.sin(a) * e.r * (1 + k));
        }
        c.strokeStyle = e.color;
        c.stroke();
        break;
      case 'death':
        c.fillStyle = e.color;
        c.globalAlpha = (1 - k) * 0.8;
        c.beginPath();
        c.ellipse(e.x, e.y - 6 + k * 6, e.r * (1 + k * 0.4), e.r * (1 - k) * 1.5 + 1, 0, 0, TAU);
        c.fill();
        break;
      case 'blood':
        c.fillStyle = e.color;
        c.globalAlpha = (1 - k) * 0.55;
        c.beginPath();
        c.ellipse(e.x, e.y + 2, e.r * 1.1, e.r * 0.5, 0, 0, TAU);
        c.ellipse(e.x + e.r * 0.8, e.y - 2, e.r * 0.4, e.r * 0.25, 0, 0, TAU);
        c.fill();
        break;
      case 'ping':
      case 'pingAttack':
        c.strokeStyle = e.color;
        c.globalAlpha = 1 - k;
        c.beginPath();
        c.ellipse(e.x, e.y, e.r * (1.4 - k), e.r * (1.4 - k) * 0.55, 0, 0, TAU);
        c.stroke();
        break;
      case 'rally':
        c.strokeStyle = e.color;
        c.globalAlpha = 1 - k;
        c.beginPath();
        c.ellipse(e.x, e.y, e.r * (1.6 - k), e.r * (1.6 - k) * 0.5, 0, 0, TAU);
        c.stroke();
        break;
      case 'boom':
        c.strokeStyle = e.color;
        c.lineWidth = 5 * (1 - k) + 1;
        c.globalAlpha = 1 - k;
        c.beginPath();
        c.ellipse(e.x, e.y, e.r * (0.2 + k * 0.8), e.r * (0.2 + k * 0.8) * 0.6, 0, 0, TAU);
        c.stroke();
        c.fillStyle = e.color;
        c.globalAlpha = (1 - k) * 0.25;
        c.fill();
        break;
      case 'heal':
        c.strokeStyle = e.color;
        c.globalAlpha = 1 - k;
        c.beginPath();
        c.ellipse(e.x, e.y, e.r * k, e.r * k * 0.6, 0, 0, TAU);
        c.stroke();
        c.fillStyle = e.color;
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TAU;
          const rr = e.r * k * 0.8;
          c.beginPath();
          c.arc(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr * 0.6 - k * 30, 2, 0, TAU);
          c.fill();
        }
        break;
      case 'smoke':
        c.fillStyle = e.color;
        c.globalAlpha = (1 - k) * 0.45;
        c.beginPath();
        c.arc(e.x + Math.sin(k * 6 + e.x) * 4, e.y - k * 40, e.r * (0.6 + k * 1.4), 0, TAU);
        c.fill();
        break;
      case 'levelup':
      case 'text':
        c.fillStyle = e.color;
        c.globalAlpha = 1 - k;
        c.font = `bold ${e.kind === 'levelup' ? 15 : 12}px sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.strokeStyle = 'rgba(0,0,0,.7)';
        c.lineWidth = 3;
        c.strokeText(e.text ?? '', e.x, e.y - 24 - k * 30);
        c.fillText(e.text ?? '', e.x, e.y - 24 - k * 30);
        break;
    }
    c.globalAlpha = 1;
  }

  /** Porträt einer Einheit oder eines Gebäudes für das HUD. */
  drawPortrait(canvas: HTMLCanvasElement, e: Entity) {
    const c = canvas.getContext('2d')!;
    const w = canvas.width, h = canvas.height;
    this.now = performance.now() / 1000;
    c.setTransform(1, 0, 0, 1, 0, 0);
    const grd = c.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#2a2418');
    grd.addColorStop(1, '#0f0c08');
    c.fillStyle = grd;
    c.fillRect(0, 0, w, h);
    if (e.type === 'unit') {
      const s = (h / 40) * 1.0;
      c.setTransform(s, 0, 0, s, w / 2, h - 6);
      this.drawFigure(c, 0, 0, { ...e.def.look, scale: e.def.look.scale }, FACTION_COLOR[e.faction], false, 0, 0, e.carry?.res ?? null);
    } else if (e.type === 'building') {
      const size = e.size * TILE;
      const s = (w * 0.8) / size;
      c.setTransform(s, 0, 0, s, w * 0.1, h * 0.78 - size * s * 0.7 + 8);
      const fake: Building = { ...e, x: size / 2, y: size / 2, tx: 0, ty: 0 };
      const saved = this.game.rectOf;
      this.game.rectOf = () => ({ x0: 0, y0: 0, x1: size, y1: size });
      this.drawBuilding(c, fake, false);
      this.game.rectOf = saved;
    } else {
      c.setTransform(0.5, 0, 0, 0.5, w / 2, h / 2);
      const saved = this.game.rectOf;
      this.game.rectOf = () => ({ x0: -48, y0: -48, x1: 48, y1: 48 });
      this.drawMine(c, { ...e, x: 0, y: 0 }, false);
      this.game.rectOf = saved;
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
  }
}
