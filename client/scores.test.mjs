import test from 'node:test';
import assert from 'node:assert/strict';
import { NAME_KEY, loadName, saveName, scoresUrl, fetchScores, submitScore } from './scores.js';

const mapStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const throwingStorage = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('denied'); },
};
const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });
const TABLE = [{ name: 'Ace', level: 3, score: 100, at: '2026-11-21T00:00:00Z' }];

test('name round-trips through storage', () => {
  const s = mapStorage();
  assert.equal(loadName(s), '');
  saveName('Ace', s);
  assert.equal(loadName(s), 'Ace');
  assert.equal(NAME_KEY, 'netwars.playerName');
});

test('throwing storage: loadName -> "", saveName does not throw', () => {
  assert.equal(loadName(throwingStorage), '');
  assert.doesNotThrow(() => saveName('Ace', throwingStorage));
});

test('missing storage (undefined) is tolerated', () => {
  assert.equal(loadName(undefined), '');
  assert.doesNotThrow(() => saveName('x', undefined));
});

test('scoresUrl: same origin by default, server host when given', () => {
  assert.equal(scoresUrl('', { protocol: 'https:' }), '/scores');
  assert.equal(scoresUrl(undefined, { protocol: 'https:' }), '/scores');
  assert.equal(scoresUrl('netwars.hmpf.cz', { protocol: 'https:' }), 'https://netwars.hmpf.cz/scores');
});

test('fetchScores returns the array', async () => {
  const got = await fetchScores('/scores', async () => okResponse(TABLE));
  assert.deepEqual(got, TABLE);
});

test('fetchScores -> null on rejected fetch, non-2xx, bad json, wrong shape', async () => {
  assert.equal(await fetchScores('/s', async () => { throw new TypeError('network'); }), null);
  assert.equal(await fetchScores('/s', async () => ({ ok: false, status: 502, json: async () => TABLE })), null);
  assert.equal(await fetchScores('/s', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('<html>'); } })), null);
  assert.equal(await fetchScores('/s', async () => okResponse({})), null);
});

test('fetchScores -> null when the server hangs (timeout honours abort)', async () => {
  const hang = (url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const t0 = Date.now();
  assert.equal(await fetchScores('/s', hang, 20), null);
  assert.ok(Date.now() - t0 < 1000);
});

test('submitScore posts the exact JSON and returns {rank, table}', async () => {
  let seen;
  const f = async (url, opts) => { seen = { url, opts }; return okResponse({ rank: 2, table: TABLE }); };
  const res = await submitScore('/scores', { name: 'Ace', level: 3, score: 100 }, f);
  assert.deepEqual(res, { rank: 2, table: TABLE });
  assert.equal(seen.url, '/scores');
  assert.equal(seen.opts.method, 'POST');
  assert.equal(seen.opts.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(seen.opts.body), { name: 'Ace', level: 3, score: 100 });
});

test('submitScore accepts rank:null (not in top 10)', async () => {
  const res = await submitScore('/s', { name: 'a', level: 1, score: 1 }, async () => okResponse({ rank: null, table: TABLE }));
  assert.deepEqual(res, { rank: null, table: TABLE });
});

test('submitScore -> null on 429, network error, wrong shape', async () => {
  const body = { name: 'a', level: 1, score: 1 };
  assert.equal(await submitScore('/s', body, async () => ({ ok: false, status: 429, json: async () => ({}) })), null);
  assert.equal(await submitScore('/s', body, async () => { throw new Error('x'); }), null);
  assert.equal(await submitScore('/s', body, async () => okResponse({ rank: 1 })), null);
});

// --- review fixes: a malformed/hostile /scores response must be rejected, not rendered ---
const BAD_TABLES = {
  'null entry': [null],
  'html in level': [{ name: 'a', level: '<img src=x onerror=alert(1)>', score: 1 }],
  'html in score': [{ name: 'a', level: 1, score: '<b>' }],
  'non-string name': [{ name: 5, level: 1, score: 1 }],
  'float level': [{ name: 'a', level: 1.5, score: 1 }],
  'missing fields': [{ name: 'a' }],
};

for (const [label, table] of Object.entries(BAD_TABLES)) {
  test(`fetchScores rejects a table with ${label}`, async () => {
    assert.equal(await fetchScores('/s', async () => okResponse(table)), null);
  });
  test(`submitScore rejects a table with ${label}`, async () => {
    const res = await submitScore('/s', { name: 'a', level: 1, score: 1 }, async () => okResponse({ rank: 1, table }));
    assert.equal(res, null);
  });
}

test('submitScore rejects a non-integer, non-null rank', async () => {
  const f = async () => okResponse({ rank: '1', table: TABLE });
  assert.equal(await submitScore('/s', { name: 'a', level: 1, score: 1 }, f), null);
});
