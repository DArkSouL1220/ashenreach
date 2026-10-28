import './style.css';
import { Camera } from './camera';
import { Game } from './game';
import { Hud } from './hud';
import { Input } from './input';
import { Renderer } from './render';

document.getElementById('boot')?.remove();
const canvas = document.getElementById('game') as HTMLCanvasElement;
const newSeed = () => (Date.now() % 100000) + 1;
const app = { game: new Game(newSeed()) };
const cam = new Camera();
const renderer = new Renderer(canvas, app.game, cam);
const hud = new Hud(app, cam, renderer, (load) => {
  const loaded = load ? Game.load() : null;
  app.game = loaded ?? new Game(newSeed());
  renderer.setGame(app.game);
});
const input = new Input(canvas, app, cam, hud);

const keep = app.game.buildings.find((b) => b.faction === 'player' && b.def.isHall)!;
cam.zoom = Math.min(1.2, Math.max(0.6, window.innerWidth / 640));
cam.centerOn(keep.x, keep.y - 40);

let last = performance.now();
let frames = 0;
function tick(dt: number) {
  if (hud.running && !hud.paused) {
    input.update(dt);
    app.game.update(dt);
  } else if (hud.running) input.update(dt);
  renderer.draw(input.overlay);
  hud.update(dt);
  frames++;
}
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
    tick(dt);
  } catch (err) {
    showError(String(err instanceof Error ? err.stack ?? err.message : err));
    return;
  }
  requestAnimationFrame(frame);
}

// Fehler sichtbar machen (auf dem iPhone gibt es keine Konsole)
const showError = (msg: string) => {
  let el = document.getElementById('errbox');
  if (!el) {
    el = document.createElement('pre');
    el.id = 'errbox';
    el.style.cssText = 'position:fixed;left:8px;right:8px;top:60px;z-index:99;background:#5a1010;color:#fff;padding:8px;border-radius:8px;font-size:11px;white-space:pre-wrap;max-height:40vh;overflow:auto';
    document.body.appendChild(el);
  }
  el.textContent += msg + '\n';
};
window.addEventListener('error', (e) => showError(`${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => showError(String(e.reason)));

// Test-Haken: ?autostart überspringt den Startbildschirm, ?skip=N simuliert N Sekunden vor dem ersten Frame
const params = new URLSearchParams(location.search);
if (params.has('autostart')) hud.autostart();
const skip = Number(params.get('skip') ?? 0);
try {
  for (let i = 0; i < skip * 30; i++) app.game.update(1 / 30);
  const sel = params.get('sel');
  if (sel) {
    const g = app.game;
    const e = sel === 'hero' ? g.hero('player') : (g.buildings.find((b) => b.def.id === sel) ?? g.units.find((u) => u.def.id === sel && (u.faction === 'player' || params.has('reveal'))));
    if (e) {
      g.select([e]);
      hud.onSelectionChanged();
      cam.centerOn(e.x, e.y);
    }
  }
  const t = params.get('time');
  if (t) app.game.time = Number(t);
  tick(1 / 30);
  if (params.has('reveal')) {
    app.game.vis.fill(2);
    app.game.fogVersion++;
    app.game.fogTimer = 999;
    renderer.draw(input.overlay);
  }
} catch (err) {
  showError(String(err instanceof Error ? err.stack ?? err.message : err));
}
requestAnimationFrame(frame);
if (params.has('debug')) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:8px;bottom:50%;z-index:99;background:#000a;color:#0f0;font:11px monospace;padding:4px';
  document.body.appendChild(d);
  setInterval(() => (d.textContent = `frames ${frames} units ${app.game.units.length} t ${app.game.time.toFixed(1)}`), 250);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && hud.running) {
    app.game.save();
    hud.setPaused(true);
  }
});
window.addEventListener('pagehide', () => {
  if (hud.running) app.game.save();
});

// Offline-Betrieb (nur über http/https, nicht bei file:// und nicht im Artifact-Rahmen)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !params.has('nosw')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
