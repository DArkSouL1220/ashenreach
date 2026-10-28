import type { Game, Unit } from './game';
import { dist } from './math';

/** Einfache Wellen-KI der Hohlen Legion. */
export class EnemyAI {
  waveTimer = 150;
  trainTimer = 6;
  regroupTimer = 12;
  wave = 0;
  counter = 0;

  update(g: Game, dt: number) {
    this.trainTimer -= dt;
    this.waveTimer -= dt;
    this.regroupTimer -= dt;

    const army = g.units.filter((u) => u.faction === 'enemy' && !u.dead && u.def.kind !== 'hero');
    const armyCap = Math.min(40, 8 + this.wave * 4);

    if (this.trainTimer <= 0) {
      this.trainTimer = Math.max(6, 15 - this.wave);
      if (army.length < armyCap) {
        for (const p of g.buildings) {
          if (p.faction !== 'enemy' || p.dead || !p.built || p.def.id !== 'pit' || p.queue.length) continue;
          g.cmdTrain(p, this.counter++ % 3 === 2 ? 'spitter' : 'husk', true);
        }
      }
    }

    if (this.waveTimer <= 0) {
      this.wave++;
      g.stats.waves = this.wave;
      this.waveTimer = Math.max(55, 100 - this.wave * 4);
      const target = this.pickTarget(g);
      if (target) {
        const idle = g.units.filter((u) => u.faction === 'enemy' && !u.dead && (u.order.kind === 'idle' || u.order.kind === 'move'));
        const send = this.wave <= 4 ? idle.slice(0, this.wave * 2) : idle;
        if (send.length) {
          g.cmdAttackMove(send, target.x, target.y);
          g.msg('Eine feindliche Welle naht!');
        }
      }
      if (this.wave % 3 === 0 && !g.hero('enemy')) {
        const crypt = g.buildings.find((b) => b.faction === 'enemy' && b.def.id === 'crypt' && !b.dead);
        if (crypt) {
          const h = g.spawnUnit('revenant', 'enemy', crypt.x, crypt.y + 80);
          if (h) {
            h.level = Math.min(10, 1 + Math.floor(this.wave / 2));
            h.maxHp += 50 * (h.level - 1);
            h.hp = h.maxHp;
          }
        }
      }
    }

    // Versprengte Einheiten in der Nähe der Spielerbasis verhalten sich aggressiv; andere kehren heim
    if (this.regroupTimer <= 0) {
      this.regroupTimer = 10;
      const crypt = g.buildings.find((b) => b.faction === 'enemy' && b.def.isHall && !b.dead);
      if (crypt) {
        const stray: Unit[] = [];
        for (const u of g.units) {
          if (u.faction !== 'enemy' || u.dead || u.order.kind !== 'idle') continue;
          if (dist(u.x, u.y, crypt.x, crypt.y) > 900) {
            const t = g.nearestEnemy(u, 700);
            if (t) g.cmdAttackMove([u], t.x, t.y);
            else stray.push(u);
          }
        }
        if (stray.length) g.cmdMove(stray, crypt.x, crypt.y + 150);
      }
    }
  }

  private pickTarget(g: Game) {
    const halls = g.buildings.filter((b) => b.faction === 'player' && !b.dead && b.def.isHall);
    if (halls.length) return halls[0];
    const any = g.buildings.filter((b) => b.faction === 'player' && !b.dead);
    if (any.length) return any[0];
    const unit = g.units.find((u) => u.faction === 'player' && !u.dead);
    return unit ?? null;
  }
}
