// High-score helpers: remembered player name + the /scores calls. The game
// must work with no backend, so nothing here ever throws — failures resolve
// to null / ''.

export const NAME_KEY = 'netwars.playerName';

// localStorage can throw on access (private mode, blocked site data), so even
// looking it up happens inside the try.
export function loadName(storage) {
  try {
    const s = storage ?? globalThis.localStorage;
    return (s && s.getItem(NAME_KEY)) || '';
  } catch {
    return '';
  }
}

export function saveName(name, storage) {
  try {
    const s = storage ?? globalThis.localStorage;
    if (s) s.setItem(NAME_KEY, name);
  } catch { /* not remembered; fine */ }
}

// Same origin by default; with a server id (host[:port]) use that host.
export function scoresUrl(serverId, loc = globalThis.location) {
  return serverId ? `${loc.protocol}//${serverId}/scores` : '/scores';
}

async function request(url, init, fetchFn, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { ...init, signal: ctl.signal });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// The response comes from whatever host server_id names, so treat it as
// untrusted: only well-formed rows ({name: string, level/score: integers})
// ever reach the renderer.
function validTable(t) {
  return Array.isArray(t) && t.every((e) => e && typeof e === 'object'
    && typeof e.name === 'string' && Number.isInteger(e.level) && Number.isInteger(e.score));
}

export async function fetchScores(url, fetchFn = globalThis.fetch, timeoutMs = 3000) {
  const data = await request(url, { method: 'GET' }, fetchFn, timeoutMs);
  return validTable(data) ? data : null;
}

export async function submitScore(url, { name, level, score }, fetchFn = globalThis.fetch, timeoutMs = 3000) {
  const data = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, level, score }),
  }, fetchFn, timeoutMs);
  if (!data || !validTable(data.table)) return null;
  if (data.rank !== null && !Number.isInteger(data.rank)) return null;
  return { rank: data.rank, table: data.table };
}
