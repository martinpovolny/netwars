// Network (online multiplayer) mode — M2.
// Stub for now: log the requested session and fall back to single-player so
// the URL scheme can be wired up before the Go server exists.
export async function startNetwork({ session, serverId, mode }) {
  console.warn(
    `[netwars] network mode requested (session="${session}", server="${serverId}", mode="${mode}") — ` +
    'the Go server is not built yet (see PLAN.md M2). Starting single-player.'
  );
  await import('./sp.js');
}
