// Tiny WebAudio blip synth. Must be resumed after a user gesture.
export class Audio {
  constructor() { this.ctx = null; }

  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _tone(freq, dur, type = 'square', gain = 0.05, slideTo = null) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur);
  }

  _noise(dur, gain = 0.14) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(g).connect(c.destination);
    src.start(t);
  }

  laser()      { this._tone(900, 0.12, 'square', 0.035, 240); }
  enemyLaser() { this._tone(320, 0.14, 'sawtooth', 0.03, 120); }
  hit()        { this._tone(150, 0.18, 'square', 0.06, 60); }
  boom()       { this._noise(0.45, 0.16); }
}
