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

// Toggle the browser's Fullscreen API on the whole page. Must be called from a
// user-gesture handler (a keydown counts). The canvas resize listeners already
// pick up the size change, so nothing else is needed.
export function toggleFullscreen(el = document.documentElement) {
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl) {
    (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document);
  } else {
    (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
  }
}
