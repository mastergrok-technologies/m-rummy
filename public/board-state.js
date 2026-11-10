// Presentation helpers only. The PHP engine remains authoritative.
export function remainingSeconds(deadline, serverOffset, now = Date.now()) {
  return Math.max(0, Math.ceil((deadline - now - serverOffset) / 1000));
}

export function reconcileGroups(value, hand) {
  const available = new Set(hand.map(card => card.id));
  const used = new Set();
  if (!Array.isArray(value)) return [];
  return value.flatMap(group => {
    if (!group || !Array.isArray(group.ids)) return [];
    const ids = group.ids.filter(id => {
      if (!available.has(id) || used.has(id)) return false;
      used.add(id); return true;
    });
    return ids.length ? [{ ids, title: ids.length === group.ids.length && typeof group.title === 'string' ? group.title : 'Group' }] : [];
  });
}

export function tableStandings(players) {
  // A tie stays a tie; sorting must not manufacture a winner.
  const sorted = [...players].sort((a, b) => a.total - b.total || a.name.localeCompare(b.name));
  return sorted.map((player, index) => ({ ...player, place: sorted.findIndex(p => p.total === player.total) + 1 }));
}

export function presencePresentation(value) {
  const labels = { online: 'Connected', away: 'Away', offline: 'Not responding', unknown: 'Status unknown', bot: 'Practice bot', reconnecting: 'Reconnecting' };
  const status = Object.hasOwn(labels, value) ? value : 'unknown';
  return { status, label: labels[status] };
}

export const handIdentity = hand => JSON.stringify(hand.map(card => card.id).sort());
export function arrangementSnapshot(groups, selected, hand) {
  const available = new Set(hand.map(card => card.id));
  return { handKey: handIdentity(hand), groups: reconcileGroups(groups, hand), selected: [...selected].filter(id => available.has(id)) };
}
export function cardDescription(card) {
  if (!card) return '';
  if (card.rank === 0) return 'Printed joker';
  const rank = ({ 1: 'Ace', 11: 'Jack', 12: 'Queen', 13: 'King' })[card.rank] || String(card.rank);
  return `${rank} of ${({ H: 'hearts', D: 'diamonds', C: 'clubs', S: 'spades' })[card.suit] || 'cards'}`;
}
/** Describe only the selected player's current, server-supplied phase. */
export function gameplayGuidance(room, selected) {
  const me = room.players.find(player => player.id === room.me);
  const picked = room.hand.filter(card => selected.has(card.id));
  const card = picked.length === 1 ? picked[0] : null;
  const base = { selectedCard: card, selectedCount: picked.length, canDiscard: false };
  if (room.status !== 'playing') return { ...base, step: 'finished', title: 'Round complete', detail: 'Review the results or wait for the next deal.' };
  if (me?.dropped) return { ...base, step: 'watching', title: 'You are watching this round', detail: 'You will rejoin when the next round starts.' };
  if (room.turn !== room.me) return { ...base, step: 'waiting', title: `${room.players.find(player => player.id === room.turn)?.name || 'Another player'} is playing`, detail: 'You can select and arrange your cards while you wait.' };
  if (room.phase === 'draw') return { ...base, step: 'draw', title: 'Your turn · Draw one card', detail: 'Choose the closed deck or an eligible card from the open deck.' };
  if (room.phase !== 'discard') return { ...base, step: 'waiting', title: 'Waiting for your table', detail: 'Actions resume after the next table update.' };
  if (!card) return { ...base, step: 'select', title: picked.length ? 'Choose just one discard' : 'Select your discard', detail: picked.length ? `${picked.length} cards selected. Clear the selection, then pick one card to discard.` : 'Tap one card in your hand. Discard it, or declare when the rest of your hand is valid.' };
  if (card.id === room.drawnOpen) return { ...base, step: 'blocked', title: 'Choose a different discard', detail: 'You just picked this card from the open deck. It cannot be your discard on this turn.' };
  return { ...base, canDiscard: true, step: 'ready', title: `Selected: ${cardDescription(card)}`, detail: 'Discard this card to end your turn, or declare if the remaining 13 cards form a valid hand.' };
}

export function recentChatState(previous, messages, me, read = false) {
  const keys=messages.map((m,i)=>m.id || `${m.time}:${m.playerId || m.name}:${i}`);
  const known=new Set(previous?.known || []), available=new Set(keys);
  const unread=new Set((previous?.unread || []).filter(key=>available.has(key)));
  if(previous) messages.forEach((message,i)=>{if(!known.has(keys[i])&&message.playerId!==me)unread.add(keys[i]);});
  return {known:keys,unread:read?[]:[...unread]};
}
export function roundOutcome(state) {
  if(state.status!=='finished'||!state.result)return null;
  const own=state.result.scores.find(score=>score.id===state.me);
  const award=state.result.pointsAward;
  return {won:state.result.winner===state.me,dropped:!!own?.dropped,penalty:own?.penalty??null,total:own?.total??null,reward:award?.eligible&&award.winner===state.me?award.amount:0};
}
