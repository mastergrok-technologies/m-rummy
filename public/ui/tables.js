/** Pure joined-table navigation renderer; caller owns focus, clocks and events. */
export function joinedTablesMarkup(tables, activeCode, tableLimit, escapeHtml) {
  const esc = escapeHtml;
  return `<nav class="table-switcher" aria-label="Joined tables" tabindex="0">${tables.map((table, i) => `<button type="button" class="table-tab ${table.code === activeCode ? 'current' : ''} ${table.yourTurn ? 'your-turn' : ''}" data-switch-table="${esc(table.code)}" aria-label="Table ${i + 1}, ${esc(table.code)}${table.yourTurn ? ', your turn' : ''}" ${table.code === activeCode ? 'aria-current="page"' : ''}><span class="table-tab-heading"><strong>Table ${i + 1}</strong><span class="table-tab-code">${esc(table.code)}</span>${table.yourTurn ? '<span class="table-tab-alert">Your turn</span>' : ''}</span><span class="table-tab-meta" data-table-clock="${esc(table.code)}" aria-live="off"></span></button>`).join('')}<button class="button secondary small add-table" data-add-table ${tables.length >= tableLimit ? 'disabled' : ''}>+ Add table (${tables.length}/${tableLimit})</button></nav>`;
}

/** Pure multi-table picker content; connection banner is supplied by the caller. */
export function tablePickerMarkup(count, limit, connectionBanner) {
  const tables = { length: count }, tableLimit = limit;
  const connectionNotice = () => connectionBanner;
  return `<section class="multi-table-picker" aria-labelledby="multi-table-title"><span class="eyebrow">MULTIPLE GAME FEATURE</span><h1 id="multi-table-title">Choose your table</h1><p>You are seated at ${tables.length} of ${tableLimit} available tables. Your other rounds keep running while you switch. Server timers do not pause.</p><div id="table-switcher"></div><p class="multi-table-hint">Tables marked “Your turn” need your attention. Select a table to return to play.</p></section>${connectionNotice()}`;
}
