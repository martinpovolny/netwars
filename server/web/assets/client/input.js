// Keyboard state + pointer-lock mouse deltas + touch controls.
//
// Touch scheme (no pointer lock on mobile — it's either unsupported (iOS
// Safari on a touchscreen) or a bad idea anyway):
//   - 1 finger anywhere on the canvas: steer. Unlike the mouse (which
//     accumulates relative deltas), touch tracks the ABSOLUTE offset from
//     where that finger first touched down — Player#update reads it as a
//     held joystick position (see hasSteerTouch/steerOffset), not a delta,
//     so it doesn't decay back toward centre while the finger is just held
//     still (the mouse's recenter-on-no-input behavior would otherwise fight
//     a held touch every frame).
//   - 2 fingers down on the canvas: cannon fire, for as long as both are
//     held — reuses `mouseFire`, same flag the desktop "hold LMB" sets.
//   - the bottom touch-bar (client/index.html #touch-bar, only shown when
//     Input detects a touch-capable device) is separate DOM, outside the
//     canvas: its thrust zone synthesizes the KeyW hold, its missile button
//     synthesizes a held mouseRight — both by feeding the exact state this
//     class already tracks, so nothing downstream needs to know the input
//     came from a touch bar and not a keyboard/mouse.
export class Input {
  constructor(dom) {
    this.dom = dom;
    this.keys = new Set();
    this._mx = 0;
    this._my = 0;
    this.locked = false;
    this.mouseFire = false;
    this.mouseRight = false;
    this.isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

    // the one touch driving steering — { id, startX, startY, x, y } or null
    this._steer = null;
    this._touchCount = 0; // fingers currently down on the canvas

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

    if (this.isTouch) this._initTouch(dom);
  }

  has(code) { return this.keys.has(code); }

  // returns accumulated mouse motion since last call, then resets
  takeMouse() {
    const m = { x: this._mx, y: this._my };
    this._mx = 0;
    this._my = 0;
    return m;
  }

  hasSteerTouch() { return this._steer !== null; }
  // absolute CSS-pixel offset of the steer finger from where it touched down
  steerOffset() { return this._steer ? { x: this._steer.x - this._steer.startX, y: this._steer.y - this._steer.startY } : { x: 0, y: 0 }; }

  _initTouch(dom) {
    // Use targetTouches, not touches: `touches` lists every finger touching
    // the SCREEN, page-wide, including ones on the separate #touch-bar
    // (thrust/missile) elements — `targetTouches` is scoped to fingers that
    // actually started on this element. Using `touches` here was a real bug:
    // steering with one finger while another rests on the missile/thrust bar,
    // then lifting the steering finger, handed steering "off" to that other,
    // unrelated finger (picked from the page-wide list) — which never fires
    // canvas events again, permanently freezing steering while fire/missile
    // (driven by separate state) kept working fine.
    const start = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (!this._steer) this._steer = { id: t.identifier, startX: t.clientX, startY: t.clientY, x: t.clientX, y: t.clientY };
      }
      this._touchCount = e.targetTouches.length;
      this.mouseFire = this._touchCount >= 2;
    };
    const move = (e) => {
      e.preventDefault();
      if (!this._steer) return;
      for (const t of e.changedTouches) {
        if (t.identifier === this._steer.id) { this._steer.x = t.clientX; this._steer.y = t.clientY; break; }
      }
    };
    const end = (e) => {
      e.preventDefault();
      if (this._steer && [...e.changedTouches].some((t) => t.identifier === this._steer.id)) {
        // hand steering to another finger still down ON THE CANVAS, if any,
        // rather than snapping to 0 — its own start point resets here so it
        // doesn't jump to wherever the old finger's offset was
        const next = [...e.targetTouches][0];
        this._steer = next ? { id: next.identifier, startX: next.clientX, startY: next.clientY, x: next.clientX, y: next.clientY } : null;
      }
      this._touchCount = e.targetTouches.length;
      this.mouseFire = this._touchCount >= 2;
    };
    dom.addEventListener('touchstart', start, { passive: false });
    dom.addEventListener('touchmove', move, { passive: false });
    dom.addEventListener('touchend', end, { passive: false });
    dom.addEventListener('touchcancel', end, { passive: false });
  }

  // Wires up #touch-bar (thrust zone + missile button) if this device is
  // touch-capable; a harmless no-op on desktop. Separate from the
  // constructor's canvas listeners since the bar is its own DOM, outside
  // `dom`, and may not exist on every page (e.g. tools/golden.html).
  attachTouchBar() {
    if (!this.isTouch) return;
    const bar = document.getElementById('touch-bar');
    if (!bar) return;
    bar.classList.add('show');

    const thrust = document.getElementById('touch-thrust');
    const held = (el, onDown, onUp) => {
      const down = (e) => { e.preventDefault(); el.classList.add('active'); onDown(); };
      const up = (e) => { e.preventDefault(); if (e.targetTouches.length > 0) return; el.classList.remove('active'); onUp(); };
      el.addEventListener('touchstart', down, { passive: false });
      el.addEventListener('touchend', up, { passive: false });
      el.addEventListener('touchcancel', up, { passive: false });
    };
    held(thrust, () => this.keys.add('KeyW'), () => this.keys.delete('KeyW'));

    const missile = document.getElementById('touch-missile');
    held(missile, () => { this.mouseRight = true; }, () => { this.mouseRight = false; });
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
