import { Camera } from './camera';
import { BUILDINGS, FACTION_COLOR } from './defs';
import { Building, Effect, Entity, Game, Mine, Projectile, Unit } from './game';
import { MAP_H, MAP_W, T_TREE, T_WATER, TILE } from './map';

const TAU = Math.PI * 2;

export interface Overlay {
  box: { x0: number; y0: number; x1: number; y1: number } | null; // Bildschirmkoordinaten
  ghost: { defId: string; tx: number; ty: number; ok: boolean } | null;
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  terrain: HTMLCanvasElement;
  thumb: HTMLCanvasElement; // Minikarten-Vorschau, 1 px pro Kachel
  fog: HTMLCanvasElement;
  fogData: ImageData;
  fogDrawn = -1;
  dpr = 1;
  game: Game;

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
    g.map.onTileChanged = (tx, ty) => this.drawTile(tx, ty);
    this.buildTerrain();
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

  private buildTerrain() {
    for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) this.drawTile(tx, ty);
  }

  private drawTile(tx: number, ty: number) {
    const c = this.terrain.getContext('2d')!;
    const m = this.game.map;
    const i = m.idx(tx, ty);
    const t = m.tiles[i];
    const sh = m.shade[i] / 255;
    const x = tx * TILE, y = ty * TILE;
    c.fillStyle = `hsl(${92 + sh * 14}, ${30 + sh * 12}%, ${27 + sh * 11}%)`;
    c.fillRect(x, y, TILE, TILE);
    // leichtes Gras-Detail
    c.fillStyle = `hsla(${100 + sh * 20}, 40%, ${40 + sh * 10}%, 0.35)`;
    const k = (tx * 7 + ty * 13) % 5;
    c.fillRect(x + 4 + k * 3, y + 8 + k * 2, 3, 6);
    c.fillRect(x + 18 + k * 2, y + 20 - k, 3, 5);

    const tc = this.thumb.getContext('2d')!;
    tc.fillStyle = `hsl(${92 + sh * 14}, 35%, ${30 + sh * 10}%)`;

    if (t === T_WATER) {
      c.fillStyle = '#2a5a86';
      c.fillRect(x, y, TILE, TILE);
      c.strokeStyle = 'rgba(160,210,255,.35)';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(x + 4, y + 10 + k * 2);
      c.quadraticCurveTo(x + 12, y + 6 + k * 2, x + 20, y + 10 + k * 2);
      c.moveTo(x + 10, y + 22 + k);
      c.quadraticCurveTo(x + 18, y + 18 + k, x + 28, y + 22 + k);
      c.stroke();
      tc.fillStyle = '#2a5a86';
    } else if (t === T_TREE) {
      c.fillStyle = '#4a2f16';
      c.fillRect(x + 13, y + 16, 6, 12);
      const g1 = `hsl(${118 + sh * 20}, 38%, ${22 + sh * 10}%)`;
      const g2 = `hsl(${118 + sh * 20}, 42%, ${30 + sh * 10}%)`;
      c.fillStyle = g1;
      c.beginPath();
      c.arc(x + 11, y + 15, 9, 0, TAU);
      c.arc(x + 21, y + 17, 9, 0, TAU);
      c.arc(x + 16, y + 9, 8, 0, TAU);
      c.fill();
      c.fillStyle = g2;
      c.beginPath();
      c.arc(x + 14, y + 11, 6, 0, TAU);
      c.fill();
      tc.fillStyle = '#1f4a22';
    }
    tc.fillRect(tx, ty, 1, 1);
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
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#05080f';
    c.fillRect(0, 0, cam.w, cam.h);

    c.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, -cam.x * cam.zoom * dpr, -cam.y * cam.zoom * dpr);
    const vx0 = Math.max(0, cam.x), vy0 = Math.max(0, cam.y);
    const vx1 = Math.min(MAP_W * TILE, cam.x + cam.w / cam.zoom), vy1 = Math.min(MAP_H * TILE, cam.y + cam.h / cam.zoom);
    c.imageSmoothingEnabled = cam.zoom < 1;
    c.drawImage(this.terrain, vx0, vy0, vx1 - vx0, vy1 - vy0, vx0, vy0, vx1 - vx0, vy1 - vy0);
    c.imageSmoothingEnabled = true;

    const inView = (e: Entity) => e.x + e.radius + 40 > vx0 && e.x - e.radius - 40 < vx1 && e.y + e.radius + 40 > vy0 && e.y - e.radius - 40 < vy1;
    const selected = new Set(g.selection.map((e) => e.id));

    // Auswahlmarkierungen unter den Einheiten
    for (const e of g.selection) {
      if (e.dead || !inView(e)) continue;
      c.strokeStyle = e.faction === 'player' ? '#5bd46b' : e.faction === 'enemy' ? '#ff6b5b' : '#f5c542';
      c.lineWidth = 2;
      if (e.type === 'unit') {
        c.beginPath();
        c.ellipse(e.x, e.y + e.radius * 0.5, e.radius + 4, (e.radius + 4) * 0.55, 0, 0, TAU);
        c.stroke();
      } else {
        const r = g.rectOf(e)!;
        c.strokeRect(r.x0 + 1, r.y0 + 1, r.x1 - r.x0 - 2, r.y1 - r.y0 - 2);
      }
    }

    for (const m of g.mines) if (inView(m) && g.isExplored(m.x, m.y)) this.drawMine(m, selected.has(m.id));

    const drawables: Entity[] = [];
    for (const b of g.buildings) if (!b.dead && inView(b) && g.playerCanSee(b)) drawables.push(b);
    for (const u of g.units) if (!u.dead && inView(u) && g.playerCanSee(u)) drawables.push(u);
    drawables.sort((a, b) => a.y + a.radius - (b.y + b.radius));
    for (const e of drawables) {
      if (e.type === 'unit') this.drawUnit(e, selected.has(e.id));
      else if (e.type === 'building') this.drawBuilding(e, selected.has(e.id));
    }

    for (const p of g.projectiles) this.drawProjectile(p);
    for (const e of g.effects) this.drawEffect(e);

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

  private bar(x: number, y: number, w: number, h: number, frac: number, color: string) {
    const c = this.ctx;
    c.fillStyle = 'rgba(0,0,0,.6)';
    c.fillRect(x - 1, y - 1, w + 2, h + 2);
    c.fillStyle = color;
    c.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  }

  private drawUnit(u: Unit, selected: boolean) {
    const c = this.ctx;
    const r = u.radius;
    c.fillStyle = 'rgba(0,0,0,.28)';
    c.beginPath();
    c.ellipse(u.x, u.y + r * 0.55, r * 0.95, r * 0.45, 0, 0, TAU);
    c.fill();

    if (u.def.kind === 'hero') {
      c.strokeStyle = 'rgba(255,230,140,.7)';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(u.x, u.y, r + 4, 0, TAU);
      c.stroke();
    }

    c.fillStyle = u.def.color;
    c.strokeStyle = FACTION_COLOR[u.faction];
    c.lineWidth = 2.5;
    c.beginPath();
    c.arc(u.x, u.y, r, 0, TAU);
    c.fill();
    c.stroke();

    // Waffe / Werkzeug in Blickrichtung
    c.save();
    c.translate(u.x, u.y);
    c.rotate(u.facing);
    const lunge = u.attackAnim > 0 ? 5 : 0;
    c.lineCap = 'round';
    switch (u.def.kind) {
      case 'worker':
        c.strokeStyle = '#5a3a1a';
        c.lineWidth = 2.5;
        c.beginPath();
        c.moveTo(2, 0);
        c.lineTo(r + 5 + lunge, 0);
        c.stroke();
        c.strokeStyle = '#cfcfd6';
        c.beginPath();
        c.moveTo(r + 5 + lunge, -4);
        c.lineTo(r + 5 + lunge, 4);
        c.stroke();
        break;
      case 'melee':
        c.strokeStyle = '#eef0f6';
        c.lineWidth = 2.5;
        c.beginPath();
        c.moveTo(1, 0);
        c.lineTo(r + 8 + lunge, 0);
        c.stroke();
        c.strokeStyle = '#8a7030';
        c.beginPath();
        c.moveTo(r - 1 + lunge, -4);
        c.lineTo(r - 1 + lunge, 4);
        c.stroke();
        break;
      case 'ranged':
        c.strokeStyle = '#6b4a2a';
        c.lineWidth = 2.5;
        c.beginPath();
        c.arc(r * 0.2, 0, r * 0.9, -1.2, 1.2);
        c.stroke();
        c.strokeStyle = '#ddd';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(r * 0.2 + Math.cos(-1.2) * r * 0.9, Math.sin(-1.2) * r * 0.9);
        c.lineTo(r * 0.2 + Math.cos(1.2) * r * 0.9, Math.sin(1.2) * r * 0.9);
        c.stroke();
        break;
      case 'hero':
        c.strokeStyle = '#fff6d0';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(1, 0);
        c.lineTo(r + 10 + lunge, 0);
        c.stroke();
        c.strokeStyle = '#c99a2e';
        c.beginPath();
        c.moveTo(r - 1 + lunge, -5);
        c.lineTo(r - 1 + lunge, 5);
        c.stroke();
        break;
    }
    c.restore();

    if (u.def.kind === 'hero') {
      c.fillStyle = '#1a1200';
      c.font = 'bold 10px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(u.level), u.x, u.y + 0.5);
    }

    if (u.carry) {
      c.fillStyle = u.carry.res === 'gold' ? '#f5c542' : '#8b5a2b';
      c.beginPath();
      c.arc(u.x + r * 0.75, u.y - r * 0.75, 4, 0, TAU);
      c.fill();
    }

    if (u.hp < u.maxHp || selected) {
      const w = r * 2 + 6;
      this.bar(u.x - w / 2, u.y - r - 9, w, 3, u.hp / u.maxHp, u.faction === 'player' ? '#5bd46b' : '#ff5050');
    }
  }

  private drawBuilding(b: Building, selected: boolean) {
    const c = this.ctx;
    const r = this.game.rectOf(b)!;
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    const pad = 3;
    const enemy = b.faction === 'enemy';
    c.globalAlpha = b.built ? 1 : 0.6;
    c.fillStyle = 'rgba(0,0,0,.3)';
    c.fillRect(r.x0 + pad + 3, r.y0 + pad + 4, w - pad * 2, h - pad * 2);
    c.fillStyle = b.def.color;
    c.strokeStyle = FACTION_COLOR[b.faction];
    c.lineWidth = 3;
    c.beginPath();
    c.roundRect(r.x0 + pad, r.y0 + pad, w - pad * 2, h - pad * 2, 6);
    c.fill();
    c.stroke();

    // Dach / Deko
    c.fillStyle = enemy ? 'rgba(20,10,30,.45)' : 'rgba(80,40,20,.35)';
    c.beginPath();
    c.roundRect(r.x0 + pad + 6, r.y0 + pad + 6, w - pad * 2 - 12, h - pad * 2 - 12, 4);
    c.fill();
    if (enemy) {
      c.fillStyle = '#d8d0e0';
      for (let i = 0; i < b.size; i++) {
        c.beginPath();
        c.moveTo(r.x0 + 8 + i * TILE, r.y0 + pad + 2);
        c.lineTo(r.x0 + 14 + i * TILE, r.y0 - 8);
        c.lineTo(r.x0 + 20 + i * TILE, r.y0 + pad + 2);
        c.fill();
      }
    } else if (b.def.isHall) {
      c.fillStyle = 'rgba(255,255,255,.25)';
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) c.fillRect(r.x0 + pad + 2 + ox * (w - pad * 2 - 12), r.y0 + pad + 2 + oy * (h - pad * 2 - 12), 10, 10);
    }

    if (b.built) {
      c.fillStyle = '#fff';
      c.font = `${Math.round(w * 0.42)}px sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(b.def.icon, b.x, b.y + 2);
    } else {
      // Gerüst
      c.strokeStyle = 'rgba(255,255,255,.45)';
      c.lineWidth = 1.5;
      c.beginPath();
      for (let i = -h; i < w; i += 12) {
        c.moveTo(r.x0 + pad + Math.max(0, i), r.y0 + pad + Math.max(0, -i));
        c.lineTo(r.x0 + pad + Math.min(w - pad * 2, i + h - pad * 2), r.y0 + pad + Math.min(h - pad * 2, h - pad * 2 - i));
      }
      c.stroke();
    }
    c.globalAlpha = 1;

    if (!b.built) this.bar(r.x0 + 4, r.y1 - 10, w - 8, 4, b.progress, '#f2d16b');
    else if (b.queue.length) this.bar(r.x0 + 4, r.y1 - 10, w - 8, 4, b.queue[0].t / b.queue[0].total, '#8fd3ff');
    if (b.hp < b.maxHp || selected) this.bar(r.x0 + 4, r.y0 - 8, w - 8, 4, b.hp / b.maxHp, b.faction === 'player' ? '#5bd46b' : '#ff5050');
  }

  private drawMine(m: Mine, selected: boolean) {
    const c = this.ctx;
    const r = this.game.rectOf(m)!;
    c.fillStyle = 'rgba(0,0,0,.3)';
    c.beginPath();
    c.ellipse(m.x + 3, m.y + 8, 44, 36, 0, 0, TAU);
    c.fill();
    c.fillStyle = '#6a6a72';
    c.strokeStyle = selected ? '#f5c542' : '#3a3a40';
    c.lineWidth = 3;
    c.beginPath();
    c.ellipse(m.x, m.y + 4, 44, 36, 0, 0, TAU);
    c.fill();
    c.stroke();
    c.fillStyle = '#2a2a30';
    c.beginPath();
    c.ellipse(m.x, m.y + 14, 16, 11, 0, 0, TAU);
    c.fill();
    if (m.gold > 0) {
      c.fillStyle = '#f5c542';
      for (const [ox, oy] of [[-24, -8], [-10, -18], [12, -14], [26, -4], [20, 12], [-26, 10]]) {
        c.beginPath();
        c.arc(m.x + ox, m.y + oy, 4, 0, TAU);
        c.fill();
      }
    }
    if (selected) {
      c.fillStyle = '#fff';
      c.font = 'bold 12px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(`${m.gold} Gold`, m.x, r.y0 - 8);
    }
  }

  private drawProjectile(p: Projectile) {
    const c = this.ctx;
    const d = Math.hypot(p.tx - p.x, p.ty - p.y) || 1;
    const nx = (p.tx - p.x) / d, ny = (p.ty - p.y) / d;
    c.strokeStyle = p.color;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(p.x - nx * 8, p.y - ny * 8);
    c.lineTo(p.x + nx * 4, p.y + ny * 4);
    c.stroke();
  }

  private drawEffect(e: Effect) {
    const c = this.ctx;
    const k = e.t / e.dur;
    c.lineWidth = 2;
    switch (e.kind) {
      case 'ring':
        c.strokeStyle = e.color;
        c.globalAlpha = 1 - k;
        c.beginPath();
        c.arc(e.x, e.y, e.r * (0.6 + k * 0.6), 0, TAU);
        c.stroke();
        break;
      case 'hit':
        c.fillStyle = e.color;
        c.globalAlpha = 1 - k;
        c.beginPath();
        c.arc(e.x, e.y, e.r * (1 - k * 0.5), 0, TAU);
        c.fill();
        break;
      case 'death':
        c.fillStyle = e.color;
        c.globalAlpha = (1 - k) * 0.8;
        c.beginPath();
        c.arc(e.x, e.y, e.r * (1 + k * 0.4), 0, TAU);
        c.fill();
        break;
      case 'ping':
      case 'pingAttack':
        c.strokeStyle = e.color;
        c.globalAlpha = 1 - k;
        c.beginPath();
        c.arc(e.x, e.y, e.r * (1.4 - k), 0, TAU);
        c.stroke();
        break;
      case 'boom':
        c.strokeStyle = e.color;
        c.lineWidth = 5 * (1 - k) + 1;
        c.globalAlpha = 1 - k;
        c.beginPath();
        c.arc(e.x, e.y, e.r * (0.2 + k * 0.8), 0, TAU);
        c.stroke();
        c.fillStyle = e.color;
        c.globalAlpha = (1 - k) * 0.25;
        c.fill();
        break;
      case 'levelup':
      case 'text':
        c.fillStyle = e.color;
        c.globalAlpha = 1 - k;
        c.font = 'bold 14px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(e.text ?? '', e.x, e.y - 20 - k * 30);
        break;
    }
    c.globalAlpha = 1;
  }
}
