/** Kleine synthetische Soundeffekte über WebAudio, ohne Dateien. */
export type Sfx = 'click' | 'select' | 'move' | 'attack' | 'hit' | 'arrow' | 'build' | 'done' | 'levelup' | 'wave' | 'death' | 'gold' | 'error' | 'shock' | 'bless' | 'alert' | 'victory' | 'defeat';

class SoundSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private last = new Map<string, number>();
  enabled = true;

  /** Muss aus einer Nutzeraktion heraus aufgerufen werden (iOS). */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  play(kind: Sfx) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const t0 = this.last.get(kind) ?? -1;
    const minGap = kind === 'hit' || kind === 'attack' || kind === 'arrow' ? 0.08 : 0.03;
    if (now - t0 < minGap) return;
    this.last.set(kind, now);
    switch (kind) {
      case 'click': this.tone(880, 0.05, 'square', 0.15); break;
      case 'select': this.tone(660, 0.07, 'triangle', 0.25); this.tone(990, 0.06, 'triangle', 0.2, 0.05); break;
      case 'move': this.tone(520, 0.06, 'triangle', 0.2); break;
      case 'attack': this.noise(0.08, 0.25, 1800); this.tone(220, 0.08, 'sawtooth', 0.12); break;
      case 'hit': this.noise(0.05, 0.18, 900); break;
      case 'arrow': this.sweep(1400, 500, 0.12, 'sine', 0.15); break;
      case 'build': this.noise(0.06, 0.2, 400); this.tone(180, 0.1, 'square', 0.08); break;
      case 'done': this.tone(523, 0.12, 'triangle', 0.3); this.tone(659, 0.12, 'triangle', 0.3, 0.12); this.tone(784, 0.2, 'triangle', 0.3, 0.24); break;
      case 'levelup': this.tone(523, 0.1, 'sine', 0.3); this.tone(659, 0.1, 'sine', 0.3, 0.1); this.tone(784, 0.1, 'sine', 0.3, 0.2); this.tone(1047, 0.35, 'sine', 0.35, 0.3); break;
      case 'wave': this.sweep(160, 90, 0.6, 'sawtooth', 0.3); this.tone(120, 0.6, 'square', 0.1, 0.1); break;
      case 'alert': this.tone(740, 0.12, 'square', 0.2); this.tone(740, 0.12, 'square', 0.2, 0.2); break;
      case 'death': this.sweep(300, 60, 0.3, 'sawtooth', 0.2); break;
      case 'gold': this.tone(1320, 0.05, 'sine', 0.15); this.tone(1760, 0.08, 'sine', 0.12, 0.05); break;
      case 'error': this.tone(200, 0.15, 'square', 0.2); this.tone(150, 0.2, 'square', 0.2, 0.12); break;
      case 'shock': this.noise(0.4, 0.5, 300); this.sweep(120, 40, 0.5, 'sine', 0.5); break;
      case 'bless': this.sweep(600, 1200, 0.5, 'sine', 0.25); this.tone(1500, 0.4, 'sine', 0.15, 0.2); break;
      case 'victory': [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.3, i * 0.15)); break;
      case 'defeat': [400, 350, 300, 200].forEach((f, i) => this.tone(f, 0.4, 'sawtooth', 0.2, i * 0.3)); break;
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0) {
    const c = this.ctx!, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private sweep(f0: number, f1: number, dur: number, type: OscillatorType, vol: number) {
    const c = this.ctx!, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, cutoff: number) {
    const c = this.ctx!, t = c.currentTime;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = c.createBufferSource();
    s.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.value = vol;
    s.connect(f).connect(g).connect(this.master!);
    s.start(t);
  }
}

export const sound = new SoundSystem();
