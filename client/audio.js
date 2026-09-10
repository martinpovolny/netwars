// Tiny WebAudio blip synth (SFX) + a looping background-music track.
// Both need a user gesture to start; the music preference is remembered.
export class Audio {
  constructor() {
    this.ctx = null;
    this.music = null;          // HTMLAudioElement, created on first use
    this.musicOn = true;        // default on; starts at the first user gesture
    try {
      const v = localStorage.getItem('nw-music');
      if (v !== null) this.musicOn = v === '1';   // respect an explicit earlier choice
    } catch { /* private mode */ }
  }

  _ensureMusic() {
    if (this.music) return;
    const a = new window.Audio('tracks/track_01.mp3');
    a.loop = true;
    a.volume = 0.35;
    a.preload = 'auto';
    this.music = a;
  }

  // call from the first user gesture — resumes music if it was left on
  startMusicIfWanted() {
    if (!this.musicOn) return;
    this._ensureMusic();
    this.music.play().catch(() => { /* still needs a gesture; the M key will do it */ });
  }

  // toggle on/off (bound to a key). Returns the new state.
  toggleMusic() {
    this._ensureMusic();
    this.musicOn = !this.musicOn;
    try { localStorage.setItem('nw-music', this.musicOn ? '1' : '0'); } catch { /* ignore */ }
    if (this.musicOn) this.music.play().catch(() => {});
    else this.music.pause();
    return this.musicOn;
  }

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
  pickup()     { this._tone(520, 0.09, 'sine', 0.05, 780); setTimeout(() => this._tone(880, 0.12, 'sine', 0.05, 1180), 80); }
}
