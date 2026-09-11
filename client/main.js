// NETWARS entry point.
//
//   https://…/netwars/                                   -> single-player
//   https://…/netwars/#<session>?server_id=<host>&mode=… -> online (M2)
//
// The fragment is never sent to the host; parsing it here keeps the static
// deploy dumb.

// Suppress browser page-zoom over the game: macOS trackpad / Magic Mouse
// double-tap "smart zoom" and pinch arrive as Safari gesture events or as a
// ctrl-modified wheel in Chrome — the canvas wants the raw stream.
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) {
  window.addEventListener(t, (e) => e.preventDefault(), { passive: false });
}
window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
window.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

const hash = location.hash.replace(/^#/, '');

if (hash) {
  const [session, qs] = hash.split('?');
  const params = new URLSearchParams(qs || '');

  // a callsign for the roster / scoreboard: ?name= wins, else whatever was
  // remembered from last time, else ask once (and remember the answer) —
  // without this everyone shows up as the bare "p1"/"p2" connection id.
  let name = params.get('name') || '';
  if (!name) {
    try { name = localStorage.getItem('nw-name') || ''; } catch { /* private mode */ }
  }
  if (!name) {
    try { name = (window.prompt('Callsign?', '') || '').trim().slice(0, 16); } catch { /* blocked */ }
    if (name) { try { localStorage.setItem('nw-name', name); } catch { /* ignore */ } }
  }

  const { startNetwork } = await import('./net.js');
  startNetwork({
    session,
    serverId: params.get('server_id'),
    mode: params.get('mode') || 'coop',
    name,
  });
} else {
  await import('./sp.js');
}
