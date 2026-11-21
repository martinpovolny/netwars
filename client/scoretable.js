// The high-score table rows, shared by the title screen and the game-over
// screen so the two can't drift apart. Pure (returns an HTML string) so it is
// unit-testable. Names are user-supplied, so they are escaped; level and score
// are forced to integers so nothing from the network is ever inserted as markup.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

// entries: [{name, level, score}], best first. highlightRank: 1-based rank to
// highlight (the player's own fresh row), or null.
export function scoreRowsHtml(entries, highlightRank = null) {
  return entries.map((en, i) =>
    `<tr${highlightRank === i + 1 ? ' class="me"' : ''}><td class="num">${i + 1}.</td><td>${esc(en.name)}</td>` +
    `<td class="num">L${Number(en.level) | 0}</td><td class="num">${String(Number(en.score) | 0).padStart(6, '0')}</td></tr>`,
  ).join('');
}
