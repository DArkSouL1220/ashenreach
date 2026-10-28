import { Camera } from './camera';
import { BUILDINGS, PLAYER_BUILD_ORDER, SHOCKWAVE, UNITS } from './defs';
import { Building, Entity, Game, Unit } from './game';
import { MAP_H, MAP_W, TILE } from './map';
import type { Renderer } from './render';

export interface Targeting {
  type: 'move' | 'attackmove' | 'build';
  defId?: string;
  label: string;
}

interface Cmd {
  id: string;
  icon: string;
  label: string;
  cost?: string;
  disabled?: boolean;
  active?: boolean;
  hot?: string;
  run: () => void;
}

interface App {
  game: Game;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export class Hud {
  targeting: Targeting | null = null;
  running = false;
  paused = false;
  private buildMenu = false;
  private cmdSig = '';
  private infoSig = '';
  private refreshTimer = 0;
  private minimapTimer = 0;
  private els: Record<string, HTMLElement> = {};
  private cmds: Cmd[] = [];
  private ended = false;

  constructor(private app: App, private cam: Camera, private renderer: Renderer, private onRestart: () => void) {
    const root = document.getElementById('hud')!;
    root.innerHTML = `
      <div id="top">
        <div class="res" id="gold">💰 0</div>
        <div class="res" id="wood">🪵 0</div>
        <div class="res" id="supply">👥 0/0</div>
        <div class="res" id="clock">0:00</div>
        <div class="spacer"></div>
        <button class="tb" id="btnArmy" title="Armee auswählen">🛡️</button>
        <button class="tb" id="btnHero" title="Zur Heldin">⭐</button>
        <button class="tb" id="btnPause" title="Pause">⏸</button>
      </div>
      <div id="toasts"></div>
      <div id="banner" hidden><span id="bannerText"></span><button class="tb" id="bannerCancel">Abbrechen</button></div>
      <div id="bottom">
        <canvas id="minimap" width="144" height="144"></canvas>
        <div id="info"></div>
        <div id="cmd"></div>
      </div>
      <div id="overlay"></div>`;
    for (const id of ['top', 'gold', 'wood', 'supply', 'clock', 'toasts', 'banner', 'bannerText', 'bannerCancel', 'minimap', 'info', 'cmd', 'overlay', 'btnArmy', 'btnHero', 'btnPause']) this.els[id] = document.getElementById(id)!;

    this.els.btnArmy.onclick = () => {
      const g = this.app.game;
      const army = g.units.filter((u) => u.faction === 'player' && !u.dead && u.def.kind !== 'worker');
      if (army.length) {
        g.select(army);
        this.buildMenu = false;
        this.onSelectionChanged();
      } else g.msg('Keine Kampfeinheiten.');
    };
    this.els.btnHero.onclick = () => {
      const g = this.app.game;
      const h = g.hero('player');
      if (h) {
        g.select([h]);
        this.cam.centerOn(h.x, h.y);
        this.onSelectionChanged();
      } else {
        const keep = g.buildings.find((b) => b.faction === 'player' && b.def.isHall && !b.dead);
        if (keep) {
          g.select([keep]);
          this.cam.centerOn(keep.x, keep.y);
          this.onSelectionChanged();
        }
        g.msg('Die Wächterin kann im Bergfried wiederbelebt werden.');
      }
    };
    this.els.btnPause.onclick = () => {
      this.paused = !this.paused;
      this.els.btnPause.textContent = this.paused ? '▶️' : '⏸';
    };
    this.els.bannerCancel.onclick = () => this.clearTargeting();

    const mm = this.els.minimap as HTMLCanvasElement;
    const mmMove = (e: PointerEvent) => {
      const r = mm.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      this.cam.centerOn(fx * MAP_W * TILE, fy * MAP_H * TILE);
    };
    mm.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      mm.setPointerCapture(e.pointerId);
      mmMove(e);
    });
    mm.addEventListener('pointermove', (e) => {
      if (e.buttons) mmMove(e);
    });

    this.showStart();
  }

  // ---------- Overlays ----------

  private showStart() {
    this.els.overlay.innerHTML = `
      <div class="panel">
        <h1>Ashenreach</h1>
        <p class="sub">Die Aschenmark gegen die Hohle Legion</p>
        <ul class="howto">
          <li><b>Tippen</b> wählt Einheiten, Tippen auf Boden/Ziel gibt Befehle.</li>
          <li><b>Ziehen</b> bewegt die Kamera, <b>Pinch</b> zoomt.</li>
          <li><b>Lange drücken + ziehen</b> wählt mehrere Einheiten.</li>
          <li>Arbeiter sammeln Gold an Minen und Holz an Bäumen. Baue Gehöfte für Versorgung, eine Kaserne für Truppen.</li>
          <li>Die Wächterin steigt durch Kämpfe auf. Zerstöre die <b>Gruft</b> der Legion im Nordosten!</li>
        </ul>
        <button class="big" id="btnStart">Spielen</button>
      </div>`;
    this.els.overlay.hidden = false;
    document.getElementById('btnStart')!.onclick = () => this.autostart();
  }

  autostart() {
    this.els.overlay.hidden = true;
    this.running = true;
    const g = this.app.game;
    const keep = g.buildings.find((b) => b.faction === 'player' && b.def.isHall)!;
    this.cam.centerOn(keep.x, keep.y - 40);
  }

  private showEnd() {
    const g = this.app.game;
    const win = g.result === 'victory';
    this.els.overlay.innerHTML = `
      <div class="panel">
        <h1>${win ? 'Sieg!' : 'Niederlage'}</h1>
        <p class="sub">${win ? 'Die Gruft der Hohlen Legion liegt in Trümmern.' : 'Die Aschenmark ist gefallen.'}</p>
        <p>Zeit: ${this.fmtTime(g.time)} · Besiegt: ${g.stats.killed} · Verloren: ${g.stats.lost} · Wellen: ${g.stats.waves}</p>
        <button class="big" id="btnRestart">Neues Spiel</button>
      </div>`;
    this.els.overlay.hidden = false;
    document.getElementById('btnRestart')!.onclick = () => {
      this.ended = false;
      this.els.overlay.hidden = true;
      this.onRestart();
      this.clearTargeting();
      this.buildMenu = false;
      const keep = this.app.game.buildings.find((b) => b.faction === 'player' && b.def.isHall)!;
      this.cam.centerOn(keep.x, keep.y - 40);
      this.onSelectionChanged();
    };
  }

  private fmtTime(t: number) {
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ---------- Zielmodus / Baumenü ----------

  setTargeting(t: Targeting | null) {
    this.targeting = t;
    this.els.banner.hidden = !t;
    if (t) this.els.bannerText.textContent = `Tippe auf die Karte: ${t.label}`;
    this.refresh(true);
  }

  clearTargeting() {
    if (this.targeting) this.setTargeting(null);
  }

  setBuildMenu(on: boolean) {
    if (this.buildMenu !== on) {
      this.buildMenu = on;
      this.refresh(true);
    }
  }

  onSelectionChanged() {
    this.clearTargeting();
    this.refresh(true);
  }

  hotkey(key: string) {
    const c = this.cmds.find((c) => c.hot === key && !c.disabled);
    if (c) c.run();
  }

  // ---------- Laufende Aktualisierung ----------

  update(dt: number) {
    const g = this.app.game;
    if (g.result !== 'none' && !this.ended) {
      this.ended = true;
      this.running = false;
      this.showEnd();
    }
    this.refreshTimer -= dt;
    if (this.refreshTimer <= 0) {
      this.refreshTimer = 0.15;
      this.refresh(false);
    }
    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 0.25;
      this.drawMinimap();
    }
  }

  private refresh(force: boolean) {
    const g = this.app.game;
    this.els.gold.textContent = `💰 ${Math.floor(g.res.player.gold)}`;
    this.els.wood.textContent = `🪵 ${Math.floor(g.res.player.wood)}`;
    const used = g.supplyUsed('player'), cap = g.supplyCap('player');
    this.els.supply.textContent = `👥 ${used}/${cap}`;
    this.els.supply.classList.toggle('warn', used >= cap);
    this.els.clock.textContent = this.fmtTime(g.time) + (g.stats.waves ? ` · W${g.stats.waves}` : '');
    this.els.toasts.innerHTML = g.messages.map((m) => `<div class="toast" style="opacity:${m.t > 2.5 ? ((3.5 - m.t) / 1).toFixed(2) : 1}">${esc(m.text)}</div>`).join('');
    this.refreshCommands(force);
    this.refreshInfo(force);
  }

  private buildCommands(): Cmd[] {
    const g = this.app.game;
    const units = g.selectedPlayerUnits();
    const blds = g.selectedPlayerBuildings();
    const cmds: Cmd[] = [];
    const t = this.targeting;
    if (units.length) {
      const workers = units.filter((u) => u.def.kind === 'worker');
      const combat = units.filter((u) => u.def.kind !== 'worker');
      const hero = units.find((u) => u.def.kind === 'hero');
      if (this.buildMenu && workers.length) {
        for (const id of PLAYER_BUILD_ORDER) {
          const def = BUILDINGS[id];
          const can = g.res.player.gold >= def.gold && g.res.player.wood >= def.wood;
          cmds.push({
            id: 'b_' + id, icon: def.icon, label: def.name, cost: `${def.gold}💰 ${def.wood}🪵`, disabled: !can, active: t?.type === 'build' && t.defId === id,
            run: () => this.setTargeting({ type: 'build', defId: id, label: `${def.name} platzieren` }),
          });
        }
        cmds.push({ id: 'back', icon: '↩️', label: 'Zurück', hot: 'escape', run: () => { this.clearTargeting(); this.setBuildMenu(false); } });
      } else {
        cmds.push({ id: 'move', icon: '🚶', label: 'Bewegen', hot: 'm', active: t?.type === 'move', run: () => this.setTargeting({ type: 'move', label: 'Bewegen' }) });
        cmds.push({ id: 'stop', icon: '✋', label: 'Halt', hot: 'h', run: () => g.cmdStop(units) });
        if (combat.length) cmds.push({ id: 'amove', icon: '⚔️', label: 'Angriff', hot: 'a', active: t?.type === 'attackmove', run: () => this.setTargeting({ type: 'attackmove', label: 'Angriffsbewegung' }) });
        if (hero) {
          const cd = hero.abilityCd;
          cmds.push({ id: 'shock', icon: '💥', label: cd > 0 ? `Erdstoß ${Math.ceil(cd)}s` : 'Erdstoß', hot: 'q', disabled: cd > 0, run: () => g.cmdShockwave(hero) });
        }
        if (workers.length) {
          cmds.push({ id: 'build', icon: '🏗️', label: 'Bauen', hot: 'b', run: () => this.setBuildMenu(true) });
          if (workers.some((u) => u.carry)) cmds.push({ id: 'return', icon: '📦', label: 'Abliefern', hot: 'r', run: () => g.cmdReturn(workers) });
        }
      }
    } else if (blds.length === 1) {
      const b = blds[0];
      if (!b.built) {
        cmds.push({ id: 'cancelb', icon: '❌', label: 'Abbrechen', run: () => { g.cmdCancelBuilding(b); g.select([]); this.onSelectionChanged(); } });
      } else {
        for (const id of b.def.trains) {
          const def = UNITS[id];
          let gold = def.gold, label = def.name;
          if (id === 'warden') {
            if (g.hero('player') || g.heroQueued()) continue;
            gold = g.heroCost();
            label = g.heroSummoned ? 'Wiederbeleben' : def.name;
          }
          const can = g.res.player.gold >= gold && g.res.player.wood >= def.wood;
          cmds.push({ id: 't_' + id, icon: def.icon, label, cost: `${gold}💰${def.wood ? ` ${def.wood}🪵` : ''}`, disabled: !can, run: () => g.cmdTrain(b, id) });
        }
        if (b.queue.length) cmds.push({ id: 'cancelq', icon: '❌', label: 'Letztes abbr.', run: () => g.cmdCancelTrain(b) });
      }
    }
    if (g.selection.length) cmds.push({ id: 'desel', icon: '✕', label: 'Abwählen', run: () => { g.select([]); this.setBuildMenu(false); this.onSelectionChanged(); } });
    return cmds;
  }

  private refreshCommands(force: boolean) {
    this.cmds = this.buildCommands();
    const sig = this.cmds.map((c) => `${c.id}|${c.label}|${c.disabled ? 1 : 0}|${c.active ? 1 : 0}`).join(';');
    if (!force && sig === this.cmdSig) return;
    this.cmdSig = sig;
    const el = this.els.cmd;
    el.innerHTML = '';
    for (const c of this.cmds) {
      const b = document.createElement('button');
      b.className = 'cb' + (c.active ? ' active' : '');
      b.disabled = !!c.disabled;
      b.innerHTML = `<span class="ic">${c.icon}</span><span class="lb">${esc(c.label)}</span>${c.cost ? `<span class="cost">${c.cost}</span>` : ''}`;
      b.onclick = () => {
        c.run();
        this.refresh(true);
      };
      el.appendChild(b);
    }
  }

  private refreshInfo(force: boolean) {
    const g = this.app.game;
    const sel = g.selection.filter((e) => !e.dead);
    let html = '';
    let sig = '';
    if (!sel.length) {
      sig = 'none';
      html = `<div class="hint">Tippe auf eine Einheit oder ein Gebäude.<br>🛡️ wählt deine Armee, ⭐ springt zur Heldin.</div>`;
    } else if (sel.length === 1) {
      const e = sel[0];
      sig = 'one' + e.id;
      html = this.entityInfo(e);
    } else {
      const groups = new Map<string, Unit[]>();
      for (const e of sel) if (e.type === 'unit') groups.set(e.def.id, [...(groups.get(e.def.id) ?? []), e]);
      sig = 'multi' + [...groups.keys()].join(',') + sel.length;
      html = `<div class="title">${sel.length} ausgewählt</div><div class="chips">` +
        [...groups.entries()].map(([id, us]) => `<button class="chip" data-type="${id}">${UNITS[id].icon} ${us.length}</button>`).join('') + '</div>';
    }
    if (!force && sig === this.infoSig) {
      // nur dynamische Werte aktualisieren
      if (sel.length === 1) {
        const dyn = this.els.info.querySelector('.dyn');
        if (dyn) dyn.innerHTML = this.entityDynamic(sel[0]);
      }
      return;
    }
    this.infoSig = sig;
    this.els.info.innerHTML = html;
    this.els.info.querySelectorAll<HTMLButtonElement>('.chip').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.type!;
        g.select(g.selection.filter((e) => e.type === 'unit' && e.def.id === id));
        this.onSelectionChanged();
      };
    });
  }

  private entityInfo(e: Entity): string {
    if (e.type === 'mine') return `<div class="title">⛰️ Goldmine</div><div class="dyn">${this.entityDynamic(e)}</div>`;
    const def = e.type === 'unit' ? e.def : e.def;
    const own = e.faction === 'player';
    return `<div class="title">${def.icon} ${esc(def.name)}${own ? '' : ' <span class="enemy">(Feind)</span>'}</div><div class="dyn">${this.entityDynamic(e)}</div><div class="desc">${esc(def.desc)}</div>`;
  }

  private entityDynamic(e: Entity): string {
    if (e.type === 'mine') return `Gold: ${e.gold}`;
    const hp = `<div class="barrow"><div class="bar"><div class="fill" style="width:${((100 * e.hp) / e.maxHp).toFixed(0)}%"></div></div><span>${Math.ceil(e.hp)}/${e.maxHp}</span></div>`;
    let extra = '';
    if (e.type === 'unit') {
      if (e.def.kind === 'hero') {
        const need = 120 * e.level;
        extra += `<div>Stufe ${e.level} · Schaden ${this.app.game.unitDamage(e)}</div><div class="barrow"><div class="bar xp"><div class="fill" style="width:${((100 * e.xp) / need).toFixed(0)}%"></div></div><span>XP ${e.xp}/${need}</span></div>`;
        if (e.faction === 'player') extra += `<div>Erdstoß: ${e.abilityCd > 0 ? `${Math.ceil(e.abilityCd)}s` : 'bereit'} · ${SHOCKWAVE.baseDamage + SHOCKWAVE.perLevel * (e.level - 1)} Schaden im Umkreis</div>`;
      }
      if (e.carry) extra += `<div>Trägt ${e.carry.amount} ${e.carry.res === 'gold' ? 'Gold' : 'Holz'}</div>`;
      extra += `<div class="order">${this.orderText(e)}</div>`;
    } else {
      const b = e as Building;
      if (!b.built) extra += `<div>Im Bau: ${(b.progress * 100).toFixed(0)}%</div>`;
      else if (b.queue.length) extra += `<div>Ausbildung: ${UNITS[b.queue[0].id].icon} ${((100 * b.queue[0].t) / b.queue[0].total).toFixed(0)}% ${b.queue.slice(1).map((q) => UNITS[q.id].icon).join(' ')}</div>`;
      if (b.def.supply) extra += `<div>Versorgung +${b.def.supply}</div>`;
    }
    return hp + extra;
  }

  private orderText(u: Unit): string {
    switch (u.order.kind) {
      case 'idle': return 'Wartet';
      case 'move': return 'Bewegt sich';
      case 'attackmove': return 'Angriffsbewegung';
      case 'attack': return 'Greift an';
      case 'gather': return u.order.res === 'gold' ? 'Sammelt Gold' : 'Fällt Holz';
      case 'return': return 'Liefert ab';
      case 'build': return `Baut ${u.order.building.def.name}`;
    }
  }

  private drawMinimap() {
    const g = this.app.game;
    const mm = this.els.minimap as HTMLCanvasElement;
    const c = mm.getContext('2d')!;
    const s = mm.width / MAP_W;
    c.imageSmoothingEnabled = false;
    c.drawImage(this.renderer.thumb, 0, 0, mm.width, mm.height);
    // Nebel
    c.fillStyle = 'rgba(0,0,0,.5)';
    for (let ty = 0; ty < MAP_H; ty++)
      for (let tx = 0; tx < MAP_W; tx++) {
        const v = g.vis[ty * MAP_W + tx];
        if (v === 2) continue;
        c.fillStyle = v === 1 ? 'rgba(0,0,0,.5)' : 'rgba(4,6,14,1)';
        c.fillRect(tx * s, ty * s, s, s);
      }
    for (const m of g.mines) if (g.isExplored(m.x, m.y)) { c.fillStyle = '#f5c542'; c.fillRect(m.tx * s, m.ty * s, m.size * s, m.size * s); }
    for (const b of g.buildings) if (!b.dead && g.playerCanSee(b)) { c.fillStyle = b.faction === 'player' ? '#5bd46b' : '#ff5050'; c.fillRect(b.tx * s, b.ty * s, b.size * s, b.size * s); }
    for (const u of g.units) if (!u.dead && g.playerCanSee(u)) { c.fillStyle = u.faction === 'player' ? (u.def.kind === 'hero' ? '#fff0a0' : '#8fff9b') : '#ff7070'; c.fillRect((u.x / TILE) * s - 1, (u.y / TILE) * s - 1, 2.5, 2.5); }
    c.strokeStyle = '#fff';
    c.lineWidth = 1;
    c.strokeRect((this.cam.x / TILE) * s, (this.cam.y / TILE) * s, (this.cam.w / this.cam.zoom / TILE) * s, (this.cam.h / this.cam.zoom / TILE) * s);
  }
}
