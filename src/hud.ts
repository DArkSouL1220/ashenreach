import { Camera } from './camera';
import { ABILITIES, BUILDINGS, PLAYER_BUILD_ORDER, UNITS, UPGRADES } from './defs';
import { Building, Entity, Game, Unit } from './game';
import { MAP_H, MAP_W, TILE } from './map';
import type { Renderer } from './render';
import { sound } from './sound';

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
  title?: string;
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
  private portraitTimer = 0;
  private els: Record<string, HTMLElement> = {};
  private cmds: Cmd[] = [];
  private ended = false;
  private portrait: HTMLCanvasElement | null = null;

  constructor(private app: App, private cam: Camera, private renderer: Renderer, private onRestart: (load: boolean) => void) {
    const root = document.getElementById('hud')!;
    root.innerHTML = `
      <div id="top">
        <div class="res" id="gold" title="Gold">💰 0</div>
        <div class="res" id="wood" title="Holz">🪵 0</div>
        <div class="res" id="supply" title="Versorgung">👥 0/0</div>
        <div class="res" id="clock">0:00</div>
        <div class="spacer"></div>
        <button class="tb" id="btnAlert" title="Zum Angriff springen" hidden>🚨</button>
        <button class="tb" id="btnIdle" title="Untätiger Arbeiter" hidden>⛏️<span class="badge" id="idleCount"></span></button>
        <button class="tb" id="btnArmy" title="Armee auswählen">🛡️</button>
        <button class="tb" id="btnHero" title="Zur Heldin">⭐</button>
        <button class="tb" id="btnSound" title="Ton">🔊</button>
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
    for (const id of ['top', 'gold', 'wood', 'supply', 'clock', 'toasts', 'banner', 'bannerText', 'bannerCancel', 'minimap', 'info', 'cmd', 'overlay', 'btnArmy', 'btnHero', 'btnPause', 'btnAlert', 'btnIdle', 'idleCount', 'btnSound']) this.els[id] = document.getElementById(id)!;

    this.els.btnArmy.onclick = () => {
      sound.play('click');
      const g = this.app.game;
      const army = g.units.filter((u) => u.faction === 'player' && !u.dead && u.def.kind !== 'worker');
      if (army.length) {
        g.select(army);
        this.buildMenu = false;
        this.onSelectionChanged();
      } else g.msg('Keine Kampfeinheiten.');
    };
    this.els.btnHero.onclick = () => {
      sound.play('click');
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
    this.els.btnIdle.onclick = () => {
      sound.play('click');
      const g = this.app.game;
      const idle = g.idleWorkers();
      if (!idle.length) return;
      const cur = g.selection.length === 1 ? idle.indexOf(g.selection[0] as Unit) : -1;
      const next = idle[(cur + 1) % idle.length];
      g.select([next]);
      this.cam.centerOn(next.x, next.y);
      this.onSelectionChanged();
    };
    this.els.btnAlert.onclick = () => {
      const a = this.app.game.alert;
      if (a) this.cam.centerOn(a.x, a.y);
    };
    this.els.btnSound.onclick = () => {
      sound.enabled = !sound.enabled;
      this.els.btnSound.textContent = sound.enabled ? '🔊' : '🔇';
      if (sound.enabled) {
        sound.unlock();
        sound.play('click');
      }
    };
    this.els.btnPause.onclick = () => this.setPaused(!this.paused);
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

  setPaused(p: boolean) {
    this.paused = p;
    this.els.btnPause.textContent = p ? '▶️' : '⏸';
  }

  // ---------- Overlays ----------

  private showStart() {
    const canResume = Game.hasSave();
    this.els.overlay.innerHTML = `
      <div class="panel">
        <h1>Ashenreach</h1>
        <p class="sub">Die Aschenmark gegen die Hohle Legion</p>
        <ul class="howto">
          <li><b>Tippen</b> wählt Einheiten; mit Auswahl auf Boden oder Ziel tippen gibt Befehle.</li>
          <li><b>Ziehen</b> bewegt die Kamera, <b>Pinch</b> zoomt, <b>lange drücken + ziehen</b> wählt mehrere.</li>
          <li>Arbeiter sammeln Gold an Minen und Holz an Bäumen. Gehöfte geben Versorgung, die Kaserne Truppen, die Schmiede Upgrades, Ritter und Katapulte.</li>
          <li>Kreaturenlager bewachen die freien Minen: Beute und Erfahrung für die Wächterin.</li>
          <li>Nachts sieht man weniger weit. Zerstöre die <b>Gruft</b> im Nordosten!</li>
        </ul>
        <div class="btnrow">
          ${canResume ? '<button class="big" id="btnResume">Fortsetzen</button>' : ''}
          <button class="big ${canResume ? 'secondary' : ''}" id="btnStart">${canResume ? 'Neues Spiel' : 'Spielen'}</button>
        </div>
      </div>`;
    this.els.overlay.hidden = false;
    document.getElementById('btnStart')!.onclick = () => {
      sound.unlock();
      if (canResume) {
        Game.clearSave();
        this.onRestart(false);
      }
      this.autostart();
    };
    const r = document.getElementById('btnResume');
    if (r) r.onclick = () => {
      sound.unlock();
      this.onRestart(true);
      this.autostart();
    };
  }

  autostart() {
    this.els.overlay.hidden = true;
    this.running = true;
    this.ended = false;
    this.setPaused(false);
    const g = this.app.game;
    const keep = g.buildings.find((b) => b.faction === 'player' && b.def.isHall) ?? g.units.find((u) => u.faction === 'player');
    if (keep) this.cam.centerOn(keep.x, keep.y - 40);
    this.onSelectionChanged();
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
      this.onRestart(false);
      this.clearTargeting();
      this.buildMenu = false;
      this.autostart();
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
    this.portraitTimer -= dt;
    if (this.portraitTimer <= 0) {
      this.portraitTimer = 0.5;
      const sel = g.selection.filter((e) => !e.dead);
      if (this.portrait && sel.length === 1) this.renderer.drawPortrait(this.portrait, sel[0]);
    }
  }

  private refresh(force: boolean) {
    const g = this.app.game;
    this.els.gold.textContent = `💰 ${Math.floor(g.res.player.gold)}`;
    this.els.wood.textContent = `🪵 ${Math.floor(g.res.player.wood)}`;
    const used = g.supplyUsed('player'), cap = g.supplyCap('player');
    this.els.supply.textContent = `👥 ${used}/${cap}`;
    this.els.supply.classList.toggle('warn', used >= cap);
    this.els.clock.textContent = `${g.isNight() ? '🌙' : '☀️'} ${this.fmtTime(g.time)}${g.stats.waves ? ` · W${g.stats.waves}` : ''}`;
    const idle = g.idleWorkers().length;
    this.els.btnIdle.hidden = idle === 0;
    this.els.idleCount.textContent = idle ? String(idle) : '';
    this.els.btnAlert.hidden = !g.alert;
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
            id: 'b_' + id, icon: def.icon, label: def.name, cost: `${def.gold}💰 ${def.wood}🪵`, disabled: !can, active: t?.type === 'build' && t.defId === id, title: def.desc,
            run: () => this.setTargeting({ type: 'build', defId: id, label: `${def.name} platzieren` }),
          });
        }
        cmds.push({ id: 'back', icon: '↩️', label: 'Zurück', hot: 'escape', run: () => { this.clearTargeting(); this.setBuildMenu(false); } });
      } else {
        cmds.push({ id: 'move', icon: '🚶', label: 'Bewegen', hot: 'm', active: t?.type === 'move', run: () => this.setTargeting({ type: 'move', label: 'Bewegen' }) });
        cmds.push({ id: 'stop', icon: '✋', label: 'Halt', hot: 'h', run: () => g.cmdStop(units) });
        if (combat.length) cmds.push({ id: 'amove', icon: '⚔️', label: 'Angriff', hot: 'a', active: t?.type === 'attackmove', run: () => this.setTargeting({ type: 'attackmove', label: 'Angriffsbewegung' }) });
        if (hero) {
          const A = ABILITIES.shockwave, B = ABILITIES.blessing;
          cmds.push({ id: 'shock', icon: A.icon, label: hero.abilityCd > 0 ? `${A.name} ${Math.ceil(hero.abilityCd)}s` : A.name, hot: 'q', disabled: hero.abilityCd > 0, title: A.desc, run: () => g.cmdShockwave(hero) });
          cmds.push({ id: 'bless', icon: B.icon, label: hero.blessCd > 0 ? `${B.name} ${Math.ceil(hero.blessCd)}s` : B.name, hot: 'w', disabled: hero.blessCd > 0, title: B.desc, run: () => g.cmdBlessing(hero) });
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
          let label = def.name;
          if (id === 'warden') {
            if (g.hero('player') || g.heroQueued()) continue;
            label = g.heroSummoned ? 'Wiederbeleben' : def.name;
          }
          const c = g.canTrain(b, id);
          const locked = !!def.requires && !g.hasBuilding('player', def.requires);
          cmds.push({ id: 't_' + id, icon: locked ? '🔒' : def.icon, label, cost: `${c.gold}💰${c.wood ? ` ${c.wood}🪵` : ''}`, disabled: !c.ok, title: locked ? c.why : def.desc, run: () => g.cmdTrain(b, id) });
        }
        for (const id of b.def.upgrades ?? []) {
          const up = UPGRADES[id];
          const lvl = g.research.player[id] ?? 0;
          if (lvl >= up.levels.length) {
            cmds.push({ id: 'u_' + id, icon: up.icon, label: `${up.name} max`, disabled: true, title: up.desc, run: () => {} });
            continue;
          }
          const cost = up.levels[lvl];
          const queued = g.researchQueued('player', id);
          const can = !queued && g.res.player.gold >= cost.gold && g.res.player.wood >= cost.wood;
          cmds.push({ id: 'u_' + id, icon: up.icon, label: `${up.name} ${lvl + 1}`, cost: `${cost.gold}💰 ${cost.wood}🪵`, disabled: !can, title: up.desc, run: () => g.cmdResearch(b, id) });
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
      if (c.title) b.title = c.title;
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
      html = `<div class="hint">Tippe auf eine Einheit oder ein Gebäude.<br>🛡️ wählt deine Armee, ⭐ springt zur Heldin, ⛏️ zum nächsten untätigen Arbeiter.</div>`;
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
      if (sel.length === 1) {
        const dyn = this.els.info.querySelector('.dyn');
        if (dyn) dyn.innerHTML = this.entityDynamic(sel[0]);
      }
      return;
    }
    this.infoSig = sig;
    this.els.info.innerHTML = html;
    this.portrait = this.els.info.querySelector<HTMLCanvasElement>('canvas.portrait');
    if (this.portrait && sel.length === 1) this.renderer.drawPortrait(this.portrait, sel[0]);
    this.els.info.querySelectorAll<HTMLButtonElement>('.chip').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.type!;
        g.select(g.selection.filter((e) => e.type === 'unit' && e.def.id === id));
        this.onSelectionChanged();
      };
    });
  }

  private entityInfo(e: Entity): string {
    const portrait = `<canvas class="portrait" width="64" height="64"></canvas>`;
    if (e.type === 'mine') return `<div class="row">${portrait}<div class="col"><div class="title">Goldmine</div><div class="dyn">${this.entityDynamic(e)}</div></div></div>`;
    const def = e.def;
    const own = e.faction === 'player';
    const tag = own ? '' : e.faction === 'creep' ? ' <span class="enemy">(Kreatur)</span>' : ' <span class="enemy">(Feind)</span>';
    return `<div class="row">${portrait}<div class="col"><div class="title">${esc(def.name)}${tag}</div><div class="dyn">${this.entityDynamic(e)}</div><div class="desc">${esc(def.desc)}</div></div></div>`;
  }

  private entityDynamic(e: Entity): string {
    const g = this.app.game;
    if (e.type === 'mine') return `Gold: ${e.gold}`;
    const hp = `<div class="barrow"><div class="bar"><div class="fill" style="width:${((100 * e.hp) / e.maxHp).toFixed(0)}%"></div></div><span>${Math.ceil(e.hp)}/${e.maxHp}</span></div>`;
    let extra = '';
    if (e.type === 'unit') {
      if (e.def.kind !== 'worker') extra += `<div class="stats">⚔️ ${g.unitDamage(e)} · 🛡️ ${g.unitArmor(e)}${e.def.range > 40 ? ` · 🎯 ${e.def.range}` : ''}</div>`;
      if (e.def.kind === 'hero') {
        const need = 120 * e.level;
        extra += `<div>Stufe ${e.level}</div><div class="barrow"><div class="bar xp"><div class="fill" style="width:${((100 * e.xp) / need).toFixed(0)}%"></div></div><span>XP ${e.xp}/${need}</span></div>`;
      }
      if (e.carry) extra += `<div>Trägt ${e.carry.amount} ${e.carry.res === 'gold' ? 'Gold' : 'Holz'}</div>`;
      if (e.faction === 'player') extra += `<div class="order">${this.orderText(e)}</div>`;
    } else {
      const b = e as Building;
      if (!b.built) extra += `<div>Im Bau: ${(b.progress * 100).toFixed(0)}%</div>`;
      else if (b.queue.length) {
        const q = b.queue[0];
        const icon = q.id.startsWith('up:') ? UPGRADES[q.id.slice(3)].icon : UNITS[q.id].icon;
        const rest = b.queue.slice(1).map((x) => (x.id.startsWith('up:') ? UPGRADES[x.id.slice(3)].icon : UNITS[x.id].icon)).join(' ');
        extra += `<div>In Arbeit: ${icon} ${((100 * q.t) / q.total).toFixed(0)}% ${rest}</div>`;
      }
      if (b.def.supply) extra += `<div>Versorgung +${b.def.supply}</div>`;
      if (b.def.attack) extra += `<div class="stats">⚔️ ${b.def.attack.damage} · 🎯 ${b.def.attack.range}</div>`;
      if (b.faction === 'player' && b.built && b.def.trains.length) extra += `<div class="order">${b.rally ? 'Sammelpunkt gesetzt' : 'Tippe auf die Karte für einen Sammelpunkt'}</div>`;
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
    for (let ty = 0; ty < MAP_H; ty++)
      for (let tx = 0; tx < MAP_W; tx++) {
        const v = g.vis[ty * MAP_W + tx];
        if (v === 2) continue;
        c.fillStyle = v === 1 ? 'rgba(0,0,0,.5)' : 'rgba(4,6,14,1)';
        c.fillRect(tx * s, ty * s, s, s);
      }
    for (const m of g.mines) if (g.isExplored(m.x, m.y)) { c.fillStyle = '#f5c542'; c.fillRect(m.tx * s, m.ty * s, m.size * s, m.size * s); }
    for (const b of g.buildings) if (!b.dead && g.playerCanSee(b)) { c.fillStyle = b.faction === 'player' ? '#5bd46b' : '#ff5050'; c.fillRect(b.tx * s, b.ty * s, b.size * s, b.size * s); }
    for (const u of g.units) if (!u.dead && g.playerCanSee(u)) { c.fillStyle = u.faction === 'player' ? (u.def.kind === 'hero' ? '#fff0a0' : '#8fff9b') : u.faction === 'creep' ? '#e0b060' : '#ff7070'; c.fillRect((u.x / TILE) * s - 1, (u.y / TILE) * s - 1, 2.5, 2.5); }
    if (g.alert) {
      const k = ((performance.now() / 500) % 1);
      c.strokeStyle = `rgba(255,80,60,${1 - k})`;
      c.lineWidth = 2;
      c.beginPath();
      c.arc((g.alert.x / TILE) * s, (g.alert.y / TILE) * s, 4 + k * 8, 0, Math.PI * 2);
      c.stroke();
    }
    c.strokeStyle = '#fff';
    c.lineWidth = 1;
    c.strokeRect((this.cam.x / TILE) * s, (this.cam.y / TILE) * s, (this.cam.w / this.cam.zoom / TILE) * s, (this.cam.h / this.cam.zoom / TILE) * s);
  }
}
