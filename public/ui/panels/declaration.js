import { gameplayGuidance } from '../../board-state.js';

export function declarationStatus(state, selected = new Set(), busy = false, connection = 'connected') {
  if (connection !== 'connected') return 'Refreshing your table. Wait for a fresh snapshot before trying again; server timers continue.';
  if (busy) return 'Waiting for the server to confirm your action.';
  if (!state) return 'Return to the table to check your turn before declaring.';
  if (state.status !== 'playing') return 'This round is not active. Return to the table for the current result or next deal.';
  if (state.players.find(p=>p.id===state.me)?.dropped) return 'You are watching this round after dropping. You cannot declare.';
  if (state.turn !== state.me) return 'It is another player’s turn. You can review your cards while you wait.';
  const guide=gameplayGuidance(state,selected);
  return `${guide.title}. ${guide.detail}`;
}
function contextMarkup(state, selected, busy, connection, esc) {
  const ownTurn=state?.status==='playing'&&state.turn===state.me&&!state.players.find(p=>p.id===state.me)?.dropped;
  const count=state?.hand.length;
  return `<section class="declaration-context" aria-label="Current declaration steps"><p id="declaration-turn-status" role="status">${esc(declarationStatus(state,selected,busy,connection))}</p>${ownTurn?'<p class="declaration-time" data-declaration-clock>Turn timer continues.</p>':''}${state?`<ol><li><strong>${Number(count)||0} cards in your hand</strong><span>${count===14?'Choose one eligible final discard; 13 cards must remain.':count===13?'Draw on your turn before choosing your final discard.':'Return to the table to check your current hand.'}</span></li><li><strong>Check your groups</strong><span>At least two sequences, including one pure sequence. Every remaining card must belong to a valid group.</span></li><li><strong>Server validation decides</strong><span>Auto-group helps arrange cards; it does not submit a declaration or guarantee a win.</span></li></ol>`:''}</section>`;
}
/** Declaration retry and auto-group guidance panels. */
export function bestDeclarationPanelMarkup(busy, connection, state, selected = new Set(), esc = value=>String(value).replace(/[&<>"']/g, char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))) {
  const disabled=busy||connection!=='connected'||(state&&(state.status!=='playing'||!state.hand.length));
  return `<section class="best-declaration-panel" aria-labelledby="best-declaration-heading"><span class="best-declaration-emblem" aria-hidden="true">♣</span><h3 id="best-declaration-heading">Build your strongest valid hand</h3><p>This is a grouping guide, not a guaranteed winning declaration. Your cards are checked by the server only when you choose Declare.</p><ol><li>Make at least two sequences.</li><li>Include at least one pure sequence.</li><li>Use valid sets or sequences for every remaining card.</li><li>When holding 14 cards, choose an eligible final discard.</li></ol><p class="best-declaration-note">Auto-group suggests an arrangement but does not submit a declaration or stop your turn timer.</p>${contextMarkup(state,selected,busy,connection,esc)}<div class="button-row"><button type="button" id="declaration-guide-arrange" class="button primary" data-panel-action="arrange" ${disabled?'disabled':''}>Auto-group my cards</button><button type="button" id="declaration-guide-back" class="button secondary" data-panel="declaration">Back to retry</button></div></section>`;
}
export function declarationPanelMarkup(declarationError, busy, connection, esc, state, selected = new Set()) {
  const disabled=busy||connection!=='connected'||(state&&(state.status!=='playing'||!state.hand.length));
  return `<section class="invalid-declaration-state" role="alert" aria-labelledby="declaration-error-heading"><span class="invalid-declaration-icon" aria-hidden="true">!</span><div><span class="eyebrow">DECLARATION NOT ACCEPTED</span><h3 id="declaration-error-heading">Your cards need another look</h3><p class="declaration-feedback">${esc(declarationError)}</p></div></section><div class="declaration-retry-guidance"><h4>Prepare your best possible declaration</h4><p>Check for two sequences, including at least one pure sequence, and valid groups covering your remaining 13 cards.</p><p>No declaration penalty was applied. Your table may have moved on while you reviewed the feedback.</p></div>${contextMarkup(state,selected,busy,connection,esc)}<div class="button-row declaration-retry-actions"><button type="button" id="declaration-review" class="button primary" data-declaration-review>Review cards &amp; retry</button><button type="button" id="declaration-arrange" class="button secondary" data-panel-action="arrange" ${disabled?'disabled':''}>Auto-group</button><button type="button" id="declaration-guide" class="button secondary" data-panel="bestDeclaration">Best possible declaration guide</button></div>`;
}
