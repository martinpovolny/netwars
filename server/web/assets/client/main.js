// NETWARS entry point.
//
//   https://…/netwars/                                   -> single-player
//   https://…/netwars/#<session>?server_id=<host>&mode=… -> online (M2)
//
// The fragment is never sent to the host; parsing it here keeps the static
// deploy dumb.
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
