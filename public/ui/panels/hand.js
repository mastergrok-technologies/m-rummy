import { reconcileGroups } from '../../board-state.js';
export function handMatchesFilter(card, filter, wildRank) {
  return filter === 'all' || (filter === 'jokers' ? card.rank === 0 || card.suit === 'J' || card.rank === wildRank : card.suit === filter);
}
/** Pure arranged-hand inspection dialog renderer. */
export function handPanelMarkup(state, groups, helpers, filter = 'all') {
  const { esc, number, card, ranks } = helpers;
    groups = reconcileGroups(groups,state.hand);
    const filters = [['all','All'],['H','Hearts'],['D','Diamonds'],['C','Clubs'],['S','Spades'],['jokers','Jokers']];
    if (!filters.some(([key])=>key===filter)) filter='all';
    const shown = state.hand.filter(card=>handMatchesFilter(card,filter,state.wildRank));
    const inGroups = new Set(groups.flatMap(g => g.ids));
    const visibleGroups = [...groups, { title: 'Ungrouped', ids: state.hand.filter(c => !inGroups.has(c.id)).map(c => c.id) }].map(g=>({...g,ids:g.ids.filter(id=>shown.some(card=>card.id===id))})).filter(g => g.ids.length);
    const me = state.players.find(p => p.id === state.me);
      return `<div class="hand-view-summary"><span>ROOM <strong>${esc(state.code)}</strong> · ROUND ${number(state.round)}</span><span>${state.hand.length} cards${me?.dropped ? ' · Dropped' : ''}</span></div><p class="hand-view-note" id="hand-view-note">Only your own hand is shown. Return to the table to arrange or play. ${state.status === 'playing' ? 'The turn timer keeps running.' : ''}</p><nav class="hand-filters" aria-label="Filter your cards">${filters.map(([key,label])=>`<button type="button" id="hand-filter-${key}" data-hand-filter="${key}" aria-pressed="${key===filter}">${label}<span>${state.hand.filter(card=>handMatchesFilter(card,key,state.wildRank)).length}</span></button>`).join('')}</nav><p id="hand-filter-summary" role="status">Showing ${shown.length} of ${state.hand.length} cards. Filters do not change your groups or selection.</p><div class="hand-view-groups" aria-label="Your arranged hand">${visibleGroups.length ? visibleGroups.map((g, i) => `<section aria-labelledby="hand-view-group-${i}"><div class="hand-view-group-heading"><h3 id="hand-view-group-${i}">${esc(g.title || 'Group')}</h3><span>${g.ids.length} cards</span></div><div class="cards" role="list" aria-label="${esc(g.title || 'Group')} cards">${g.ids.map(id => `<div role="listitem">${card(state.hand.find(c => c.id === id))}</div>`).join('')}</div></section>`).join('') : state.hand.length ? '<p class="hand-view-empty" role="status">No cards match this filter. Choose All to see your hand.</p>' : '<p class="hand-view-empty" role="status">No cards in your hand. They will appear here when the next round is dealt.</p>'}</div><div class="hand-view-footer"><span>${state.wildRank ? `Wild rank: ${esc(ranks[state.wildRank] || state.wildRank)} · Marked WILD` : 'Wild rank is set when the round starts.'}</span><button type="button" class="button" id="hand-view-back" data-close="game-dialog">Return to table</button></div>`;
}
