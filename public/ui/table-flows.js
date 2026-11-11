import { handIdentity } from '../board-state.js';
/** Presentation and confirmation snapshots only; the server validates actions. */
export function setupSummary(hasPassword) {
  return hasPassword ? 'Password-protected table. Share the invite and room password separately.' : 'Invite-only table link. Anyone with the link can ask to join; add a password for extra privacy.';
}
export function inviteMarkup(state, origin, esc) {
  return `<div class="invite-room-facts"><span>ROOM <strong id="invite-room-code">${esc(state.code)}</strong></span><span id="invite-seat-summary"></span></div><p id="invite-access-note"></p><div class="invite-steps" aria-label="Invite instructions"><span><strong>1</strong> Copy the invite link</span><span><strong>2</strong> Share it privately</span><span><strong>3</strong> Send the password separately</span></div><label for="invite-url">Your invite link</label><input id="invite-url" readonly value="${esc(`${origin}/?room=${state.code}`)}"><label for="invite-code-value">Room code only</label><input id="invite-code-value" readonly value="${esc(state.code)}"><div class="button-row invite-copy-actions"><button type="button" class="button primary" id="copy-invite">Copy invite link</button><button type="button" class="button secondary" id="copy-invite-code">Copy code only</button></div><p id="invite-status" role="status">Choose a copy option, then send it privately to your friends.</p><p class="invite-timer-note">Turn timers keep running while you share. A link does not reserve a seat.</p>`;
}
export function confirmationIntent(state, kind, cardId) {
  const me=state.players.find(player=>player.id===state.me);
  return {kind,cardId,code:state.code,round:state.round,turns:me?.turns||0,hand:handIdentity(state.hand),deadline:state.deadline};
}
export function confirmationProblem(intent, state) {
  if(!intent||!state||intent.code!==state.code||intent.round!==state.round)return 'This table or round changed. Close this dialog and review the table again.';
  const me=state.players.find(player=>player.id===state.me);
  if(!me)return 'Your seat is no longer available. Close this dialog to check your tables.';
  if(intent.kind==='leave')return state.status==='playing'?'A round has started. You can leave after it ends.':'';
  if(state.status!=='playing'||me.dropped)return 'Your round status changed. Close this dialog and review the table again.';
  if(intent.kind==='drop')return (me.turns||0)!==intent.turns||(state.turn===state.me&&state.phase==='discard')?'Your drop conditions changed. Close this dialog and review your hand again.':'';
  if(intent.kind==='declare')return state.turn!==state.me||state.phase!=='discard'||state.deadline!==intent.deadline||handIdentity(state.hand)!==intent.hand||!state.hand.some(card=>card.id===intent.cardId)||intent.cardId===state.drawnOpen?'Your turn or cards changed. Close this dialog and choose your final discard again.':'';
  return 'Close this dialog and try the action again.';
}
export function confirmationDetails(state, kind, cardId, esc) {
  const me=state.players.find(player=>player.id===state.me);
  return `<dl class="confirmation-details"><div><dt>Table</dt><dd>${esc(state.code)}</dd></div><div><dt>Round</dt><dd>${state.round||'Not started'}</dd></div><div><dt>${kind==='drop'?'Drop penalty':kind==='leave'?'Seat':'Final discard'}</dt><dd>${kind==='drop'?`${(me?.turns||0)===0?20:40} penalty points`:kind==='leave'?'Released after confirmation':esc(cardId? 'One selected card; 13 cards will be checked':'Choose a card first')}</dd></div></dl><p class="confirm-consequence">${kind==='drop'?'You stay seated and watch until the next deal. Other players continue.':kind==='leave'?'Your other joined tables remain available. The server assigns a new host if needed.':'The server checks your hand. An invalid declaration leaves the hand open without a declaration penalty.'}</p>`;
}
