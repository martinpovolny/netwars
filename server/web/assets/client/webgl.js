// WebGL capability check + a shared fatal-error overlay.
//
// sp.js and net.js both create a THREE.WebGLRenderer as one of their very
// first acts, tied to a real <canvas>. If the browser can't hand back a
// WebGL context — disabled, unsupported, a blocklisted GPU, "too many
// active contexts" — that constructor throws synchronously, and without
// this the player just gets a black screen with no explanation.
//
// hasWebGL() lets main.js fail fast, before the player ever sees the start
// screen's LAUNCH button. showFatalError() is also called from inside
// sp.js/net.js around the actual WebGLRenderer construction, in case a
// browser that reports WebGL support still fails to hand out a context.

export function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

export function showFatalError(detail) {
  const el = document.getElementById('fatal-error');
  if (!el) { alert(detail || 'NETWARS failed to start.'); return; }
  const detailEl = el.querySelector('.detail');
  if (detailEl && detail) detailEl.textContent = detail;
  document.getElementById('start')?.classList.add('hidden');
  el.classList.remove('hidden');
}
