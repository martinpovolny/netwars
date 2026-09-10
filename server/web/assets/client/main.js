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
  const { startNetwork } = await import('./net.js');
  startNetwork({
    session,
    serverId: params.get('server_id'),
    mode: params.get('mode') || 'coop',
  });
} else {
  await import('./sp.js');
}
