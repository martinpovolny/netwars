// Keyboard state + pointer-lock mouse deltas.
export class Input {
  constructor(dom) {
    this.dom = dom;
    this.keys = new Set();
    this._mx = 0;
    this._my = 0;
    this.locked = false;
    this.mouseFire = false;
    this.mouseRight = false;

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this._mx += e.movementX;
      this._my += e.movementY;
    });
    dom.addEventListener('mousedown', (e) => {
      if (!this.locked) { this.dom.requestPointerLock(); return; }
      if (e.button === 0) this.mouseFire = true;
      if (e.button === 2) this.mouseRight = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseFire = false;
      if (e.button === 2) this.mouseRight = false;
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  has(code) { return this.keys.has(code); }

  // returns accumulated mouse motion since last call, then resets
  takeMouse() {
    const m = { x: this._mx, y: this._my };
    this._mx = 0;
    this._my = 0;
    return m;
  }
}

// Ask the browser to make the page real fullscreen (no toolbar / tab strip).
// Must run inside a user gesture. No-op if already fullscreen or refused. The
// canvas resize listeners handle the size change.
export function goFullscreen(el = document.documentElement) {
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return;
  try {
    const p = req.call(el);
    if (p && p.catch) p.catch(() => {});
  } catch { /* browser refused — stay windowed */ }
}

// Enter if windowed, leave if fullscreen — bound to a key so it works during
// play (the click-to-play handler only ever enters).
export function toggleFullscreen(el = document.documentElement) {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) { try { exit.call(document); } catch { /* ignore */ } }
  } else {
    goFullscreen(el);
  }
}
