// Left-edge settings panel: Music on/off, Music volume, SFX volume,
// Constellations on/off, then an Exit row. Keyboard-only — Up/Down selects a
// row, Left/Right cycles/adjusts it (on the Exit row, either direction just
// closes the panel). Opening it is meant to freeze play the same way an
// existing pause does: the caller (sp.js / net.js) gates its own sim/input
// stepping on `settings.isOpen` alongside whatever it already checks for a
// manual pause.
const VOLUME_STEP = 0.1;
const ROW_COUNT = 5;

export class Settings {
  constructor(audio, environment) {
    this.audio = audio;
    this.environment = environment;
    this.isOpen = false;
    this.selected = 0;
    this.el = document.getElementById('settings');

    this._rows = [
      {
        value: () => (this.audio.musicOn ? 'ON' : 'OFF'),
        cycle: () => this.audio.toggleMusic(),
      },
      {
        value: () => `${Math.round(this.audio.musicVolume * 100)}%`,
        cycle: (dir) => this.audio.setMusicVolume(this.audio.musicVolume + dir * VOLUME_STEP),
      },
      {
        value: () => `${Math.round(this.audio.sfxVolume * 100)}%`,
        cycle: (dir) => this.audio.setSfxVolume(this.audio.sfxVolume + dir * VOLUME_STEP),
      },
      {
        value: () => (this.environment.showConstellations ? 'ON' : 'OFF'),
        cycle: () => this.environment.toggleConstellations(),
      },
      {
        value: () => '',
        cycle: () => this.close(),
      },
    ];
    this._render();
  }

  open() {
    this.isOpen = true;
    this.selected = 0;
    this.el.classList.add('show');
    this._render();
  }

  close() {
    this.isOpen = false;
    this.el.classList.remove('show');
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  // Called from the app's keydown handler for every key; returns true if it
  // consumed this one (so the caller should stop processing it further —
  // in particular, never let Up/Down/Left/Right also reach flight input).
  handleKey(code) {
    if (!this.isOpen) return false;
    if (code === 'Escape') { this.close(); return true; }
    if (code === 'ArrowUp') { this.selected = (this.selected - 1 + ROW_COUNT) % ROW_COUNT; this._render(); return true; }
    if (code === 'ArrowDown') { this.selected = (this.selected + 1) % ROW_COUNT; this._render(); return true; }
    if (code === 'ArrowLeft') { this._rows[this.selected].cycle(-1); this._render(); return true; }
    if (code === 'ArrowRight') { this._rows[this.selected].cycle(1); this._render(); return true; }
    return false;
  }

  _render() {
    for (let i = 0; i < ROW_COUNT; i++) {
      const rowEl = document.getElementById(`set-row-${i}`);
      if (rowEl) rowEl.classList.toggle('sel', i === this.selected);
      const valEl = document.getElementById(`set-val-${i}`);
      if (valEl) valEl.textContent = this._rows[i].value();
    }
  }
}
