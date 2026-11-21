import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreRowsHtml } from './scoretable.js';

const E = (name, level, score) => ({ name, level, score, at: '2026-11-21T00:00:00Z' });

test('rows are numbered, show level and a 6-digit zero-padded score', () => {
  const html = scoreRowsHtml([E('Ace', 3, 4200), E('Bo', 1, 7)]);
  assert.match(html, /<td class="num">1\.<\/td><td>Ace<\/td><td class="num">L3<\/td><td class="num">004200<\/td>/);
  assert.match(html, /<td class="num">2\.<\/td><td>Bo<\/td><td class="num">L1<\/td><td class="num">000007<\/td>/);
  assert.equal((html.match(/<tr/g) || []).length, 2);
});

test('an empty table gives no rows', () => {
  assert.equal(scoreRowsHtml([]), '');
});

test('the highlighted rank gets class "me"; others do not', () => {
  const html = scoreRowsHtml([E('a', 2, 1), E('b', 1, 1)], 2);
  assert.equal((html.match(/class="me"/g) || []).length, 1);
  assert.match(html, /<tr class="me"><td class="num">2\./);
  assert.doesNotMatch(scoreRowsHtml([E('a', 2, 1)], null), /class="me"/);
});

test('names are HTML-escaped (a name is user-supplied)', () => {
  const html = scoreRowsHtml([E('<img src=x onerror=alert(1)>&"\'', 1, 1)]);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;&amp;&quot;&#39;/);
});

test('level and score are coerced to integers, never inserted as markup', () => {
  const html = scoreRowsHtml([{ name: 'a', level: '<b>x</b>', score: '<i>' }]);
  assert.doesNotMatch(html, /<b>|<i>/);
  assert.match(html, /L0<\/td><td class="num">000000/);
});
