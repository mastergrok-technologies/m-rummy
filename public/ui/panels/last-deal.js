/** Last completed round summary, supplied from server history. */
export function lastDealPanelMarkup(lastDeal, helpers) {
  const { esc, number } = helpers;
  const hasLastDeal = Array.isArray(lastDeal?.scores) && lastDeal.scores.length > 0;
  return hasLastDeal ? `<p class="last-deal-summary" aria-label="Last completed round summary">Round ${number(lastDeal.round)}<strong>${esc(lastDeal.winner)} won</strong></p><div class="score-table-wrap"><table class="score-table"><caption class="sr-only">Last completed round penalties</caption><thead><tr><th scope="col">Player</th><th scope="col">Round penalty</th><th scope="col">Total penalty</th></tr></thead><tbody>${lastDeal.scores.map(p => `<tr><th scope="row">${esc(p.name)}</th><td>${number(p.penalty)}</td><td>${number(p.total)}</td></tr>`).join('')}</tbody></table></div><p class="last-deal-note">These are the server-recorded results of the last completed round at this table.</p>` : '<p class="last-deal-note">No completed round is available yet.</p>';
}
