// NETWARS entry point.
//
// "/" always shows the start screen (#start in index.html) — single-player
// vs. multiplayer, a session name, a callsign, and (for multiplayer) the
// match type. A shared link (#<session>?mode=…&name=…) only pre-fills the
// form from those params; it never auto-joins, so the fragment is still
// never sent to the host and the recipient always gets a chance to look
// before joining.

import { hasWebGL, showFatalError } from './webgl.js';

// Fail fast, before the player ever sees LAUNCH: sp.js and net.js both
// build a THREE.WebGLRenderer as one of their first acts, which throws if
// the browser can't hand back a WebGL context. Better to say so plainly
// than to launch into a blank canvas.
if (!hasWebGL()) {
  showFatalError('Detected no WebGLRenderingContext on this device.');
}

// Suppress browser page-zoom over the game: macOS trackpad / Magic Mouse
// double-tap "smart zoom" and pinch arrive as Safari gesture events or as a
// ctrl-modified wheel in Chrome — the canvas wants the raw stream.
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) {
  window.addEventListener(t, (e) => e.preventDefault(), { passive: false });
}
window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
window.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

const hashRaw = location.hash.replace(/^#/, '');
const [hashSession, hashQs] = hashRaw.split('?');
const hp = new URLSearchParams(hashQs || '');

const elStart = document.getElementById('start');
const elMpFields = document.getElementById('mp-fields');
const elSession = document.getElementById('f-session');
const elName = document.getElementById('f-name');
const elMode = document.getElementById('f-mode');
const elDmFields = document.getElementById('dm-fields');
const elFragLimit = document.getElementById('f-fraglimit');
const elTimeLimit = document.getElementById('f-timelimit');
const elLaunch = document.getElementById('f-launch');
const gtypeRadios = document.getElementsByName('gtype');

const randomSession = () => 'arena-' + Math.random().toString(36).slice(2, 7);

let savedName = '';
try { savedName = localStorage.getItem('nw-name') || ''; } catch { /* private mode */ }

// pre-fill: a shared link's session/mode/name win, else whatever's remembered
// from last time, else a fresh suggestion so the field is never just blank.
elSession.value = hashSession || randomSession();
elName.value = hp.get('name') || savedName || '';
const wantMode = hp.get('mode');
if (wantMode && [...elMode.options].some((o) => o.value === wantMode && !o.disabled)) {
  elMode.value = wantMode;
}
const wantFrags = hp.get('frags');
if (wantFrags && [...elFragLimit.options].some((o) => o.value === wantFrags)) {
  elFragLimit.value = wantFrags;
}
const wantTime = hp.get('time');
if (wantTime && [...elTimeLimit.options].some((o) => o.value === wantTime)) {
  elTimeLimit.value = wantTime;
}

// a link that already names a session defaults the picker to Multiplayer;
// otherwise Single Player (the <input checked> in index.html) stays picked.
if (hashRaw) {
  for (const r of gtypeRadios) r.checked = r.value === 'mp';
  elMpFields.classList.remove('hidden');
}
for (const r of gtypeRadios) {
  r.addEventListener('change', () => {
    const mp = document.querySelector('input[name="gtype"]:checked').value === 'mp';
    elMpFields.classList.toggle('hidden', !mp);
  });
}

// match-limit fields only matter (and only show) for deathmatch and its
// 2-team variant — co-op ends on clearing the level table, not on frags or
// a clock.
const isDmLike = (mode) => mode === 'dm' || mode === 'tdm';
elDmFields.classList.toggle('hidden', !isDmLike(elMode.value));
elMode.addEventListener('change', () => {
  elDmFields.classList.toggle('hidden', !isDmLike(elMode.value));
});

async function launch() {
  const mp = document.querySelector('input[name="gtype"]:checked').value === 'mp';
  elStart.classList.add('hidden');
  if (!mp) {
    await import('./sp.js');
    return;
  }
  const session = (elSession.value.trim() || randomSession()).slice(0, 24);
  const name = elName.value.trim().slice(0, 16);
  const mode = elMode.value;
  const fragLimit = isDmLike(mode) ? parseInt(elFragLimit.value, 10) || 0 : 0;
  const timeLimit = isDmLike(mode) ? parseInt(elTimeLimit.value, 10) || 0 : 0;
  if (name) { try { localStorage.setItem('nw-name', name); } catch { /* ignore */ } }

  // reflect the choice in the URL — shareable, and survives a reload
  const qs = new URLSearchParams({ mode });
  if (name) qs.set('name', name);
  if (isDmLike(mode)) { qs.set('frags', fragLimit); qs.set('time', timeLimit); }
  history.replaceState(null, '', `#${encodeURIComponent(session)}?${qs}`);

  const { startNetwork } = await import('./net.js');
  startNetwork({ session, serverId: hp.get('server_id'), mode, name, fragLimit, timeLimit });
}

elLaunch.addEventListener('click', launch);
for (const el of [elSession, elName]) {
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') launch(); });
}
