/** Private-table lobby. The caller owns sessions, polling and navigation. */
export function homeMarkup(account, tables, limit, tab, esc, number) {
  const joined = tab === 'joined';
  const full = tables.length >= limit;
  const icon = name => `<img src="/assets/figma/home/${name}.svg" alt="">`;
  return `<div class="home-shell"><header class="home-heading"><div><span class="home-kicker">YOUR PRIVATE CLUB</span><h1>Welcome, ${esc(account.name)}</h1></div><button type="button" class="home-balance" data-home-profile aria-label="Your profile and play points">${number(account.points)}<small>play points</small></button></header>
    <nav class="home-tabs" aria-label="Lobby sections"><button type="button" data-home-tab="points" aria-current="${joined ? 'false' : 'page'}">${icon(joined ? 'points-outline' : 'points')}Points</button><button type="button" data-home-tab="joined" aria-current="${joined ? 'page' : 'false'}">${icon(joined ? 'joined' : 'joined-outline')}Joined <span>${tables.length}</span></button></nav>
    ${!joined ? `<section class="home-intro"><span class="home-kicker">13 CARDS · 2–6 PLAYERS</span><h2>A table for your people.</h2><p>Create a private game, share your invite and let the cards do the talking.</p><span class="home-free">Free to play · Points have no cash value</span></section>` : ''}
    <section class="home-games" aria-labelledby="home-games-title"><div class="home-section-heading"><h2 id="home-games-title">${joined ? 'Choose your table' : 'Your tables'}</h2><span>${tables.length} / ${limit} joined</span></div><p class="home-live-note">Your other rounds keep running while you browse.</p><div id="home-table-list">${homeTablesMarkup(tables, esc)}</div></section>
    ${!joined ? `<section class="home-guide"><h2>Make it a game night</h2><ol><li>Create a table or use a friend’s invite.</li><li>Invite your people, or add a practice bot.</li><li>Build two sequences, including one pure.</li></ol><button type="button" class="text-button" data-action="tutorial">Learn rummy →</button><button type="button" class="text-button" data-account-view="feedback">Suggestion box →</button></section>` : ''}
    <div class="home-actions"><button type="button" class="home-create" data-add-table data-home-entry="create" ${full ? 'disabled' : ''}>Create table</button><button type="button" class="home-join" data-home-entry="join" ${full ? 'disabled' : ''}>Join friends</button></div><p id="home-limit-note" class="home-limit-note" ${full ? '' : 'hidden'}>All ${limit} seats are in use. Open a table and leave between rounds to make room.</p></div>`;
}

export function homeTablesMarkup(tables, esc) {
  if (!tables.length) return '<div class="home-empty"><strong>No tables joined yet</strong><p>Your next game starts with an invite. Create a table or join your friends.</p></div>';
  return tables.map((table, index) => {
    const status = table.status === 'lobby' ? 'Waiting for players' : table.status === 'finished' ? 'Round complete' : table.dropped ? 'Watching' : table.yourTurn ? 'Your turn' : 'Round in progress';
    return `<article class="home-table ${table.yourTurn ? 'home-table-urgent' : ''}"><div class="home-table-details"><span class="home-players"><img src="/assets/figma/home/player.svg" alt="" width="12" height="12">${Number(table.playerCount) || 0}/6</span><h3>Table ${index + 1}</h3><span class="home-table-code">${esc(table.code)}</span><span class="home-table-state">${status}</span><span class="home-seats" aria-hidden="true">${Array.from({ length: 6 }, (_, i) => `<i class="${i < table.playerCount ? 'occupied' : ''}"></i>`).join('')}</span></div><div class="home-table-return"><span data-table-clock="${esc(table.code)}"></span><button type="button" data-switch-table="${esc(table.code)}" aria-label="Open table ${index + 1}, ${esc(table.code)}">${table.status === 'lobby' ? 'Open table' : 'Rejoin'}</button></div></article>`;
  }).join('');
}
