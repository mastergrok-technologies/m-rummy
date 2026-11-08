/** Pure game information panel view. */
export function informationPanelMarkup(state, helpers) {
  const { esc, number } = helpers;
    const facts = [
      ['Variant', '13-card Indian rummy'], ['No. of decks', '2 packs'], ['Printed jokers', '1 per deck · 2 total'],
      ['Human turns', '60 seconds · Server timed'], ['First drop', '20 penalty points'], ['Middle drop', '40 penalty points'],
      ['Maximum round penalty', '80 points'], ['Extra time', 'No extra time'], ['Stakes', 'Free play · No money involved'],
      ['Players', `${state.players.length} / 6`], ['Privacy', `Invite only${state.hasPassword ? ' · Password protected' : ''}`], ['Round', state.round ? `Round ${number(state.round)}` : 'Not started'],
    ];
    const status = { lobby: 'Waiting for players', playing: 'Playing', finished: 'Round ended' }[state.status] || 'Refreshing';
      return `<div class="info-room-summary" aria-label="Current room status"><span>ROOM <strong>${esc(state.code)}</strong></span><span class="info-status" id="info-status">${status}</span></div><div class="info-overview" role="group" aria-label="Table overview"><span><strong>${state.players.length} / 6</strong> players</span><span><strong>${state.round ? `Round ${number(state.round)}` : 'Not started'}</strong> round</span><span><strong>60 seconds</strong> per human turn</span></div><h3 class="info-section-heading" id="info-facts-heading">Table details</h3><dl class="table-facts info-facts" aria-labelledby="info-facts-heading">${facts.map(([label, value]) => `<div class="info-fact"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><section class="info-rules" aria-labelledby="info-rules-title"><h3 id="info-rules-title">A valid declaration</h3><p>After drawing, select one final discard. The other 13 cards must form valid groups throughout, with at least two sequences including one pure sequence. An invalid declaration leaves your hand and turn open without a penalty.</p></section><p class="info-note">Turn timers keep running while a player is away or reconnecting. Presence badges are advisory. Profile play points are separate from table penalties.</p>`;
}
