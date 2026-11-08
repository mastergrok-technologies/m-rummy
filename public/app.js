import { tutorialSteps } from './tutorial.js';
import { remainingSeconds, reconcileGroups, tableStandings, presencePresentation } from './board-state.js';
const app = document.querySelector('#app');
const suits = { S: '♠', H: '♥', D: '♦', C: '♣', J: '✦' };
const ranks = { 0: 'JK', 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
let session, state, busy = false, polling = false, failures = 0, mode = 'create', groups = [], selected = new Set(), chatDraft = '', clockOffset = 0;
let lastCode = '', confirmAction;
let connection = 'connected';
let tables = [], tableLimit = 3, tableEpoch = 0;
const tableUi = new Map();
const presenceClient = [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join('');
let presenceSequence = 0;
let openGamePanel = null, declarationError = '', chatComposerMode = 'replies';
const chatReplies = ['Hello everyone!', 'Good luck!', 'Nice hand!', 'Well played!', 'Thanks!', 'One moment, please.'];
const chatEmojis = [['😀', 'Grinning face'], ['😄', 'Smiling face'], ['😂', 'Laughing with tears'], ['🙂', 'Slight smile'], ['👍', 'Thumbs up'], ['👏', 'Applause'], ['🎉', 'Celebration'], ['❤️', 'Heart']];
let tutorialIndex = 0;
let preferences = {};
let preferenceSaveMessage = 'Changes are saved automatically on this browser.', panelFromSettings = false;
try { preferences = JSON.parse(localStorage.getItem('mr-preferences') || '{}') || {}; if (typeof preferences !== 'object' || Array.isArray(preferences)) preferences = {}; } catch { /* Optional preferences. */ }
function applyPreferences() {
  document.documentElement.classList.toggle('roomy-cards', preferences.roomyCards === true);
  document.documentElement.classList.toggle('quiet-motion', preferences.quietMotion === true);
}
applyPreferences();
const groupKey = room => `mr-groups-${room.code}-${room.round}`;
const commandSelector = '[data-draw], [data-remove], [data-action="start"], [data-action="addBot"], [data-action="drop"], [data-action="discard"], [data-action="declare"], [data-action="arrange"], [data-action="leave"], #chat-form button';
let authMode = 'register', account = null, profileOffset = 0, authBusy = false;
const number = value => Number(value || 0).toLocaleString('en-IN');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const label = c => `${ranks[c.rank] || c.rank} ${c.suit === 'J' ? 'printed joker' : ({ S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' })[c.suit]}`;
const card = (c, interactive = false, large = false, wildRank = state?.wildRank) => `<${interactive ? 'button' : 'div'} class="card ${['H', 'D'].includes(c.suit) ? 'red' : ''} ${c.rank === 0 ? 'joker' : ''} ${large ? 'large-card' : ''} ${selected.has(c.id) && interactive ? 'selected' : ''}" ${interactive ? `type="button" data-card="${esc(c.id)}" aria-pressed="${selected.has(c.id)}" aria-label="${label(c)}${c.rank === wildRank ? ', wild joker' : ''}"` : `aria-label="${label(c)}"`}><span class="card-corner">${ranks[c.rank] || c.rank}<small>${suits[c.suit]}</small></span><span class="card-suit" aria-hidden="true">${suits[c.suit]}</span><span class="card-corner bottom" aria-hidden="true">${ranks[c.rank] || c.rank}<small>${suits[c.suit]}</small></span>${c.rank === wildRank && c.rank > 0 ? '<span class="wild-badge">WILD</span>' : ''}</${interactive ? 'button' : 'div'}>`;

function toast(text, error = false) {
  const el = document.querySelector('#toast'); el.textContent = text; el.className = `show ${error ? 'error' : ''}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.className = ''; }, 5500);
}
async function request(path, data) {
  if (path === '/api/tables' || path.startsWith('/api/tables?')) {
    const url = new URL(path, location.origin);
    url.searchParams.set('client', presenceClient);
    url.searchParams.set('visible', document.hidden ? '0' : '1');
    url.searchParams.set('sequence', String(++presenceSequence));
    path = url.pathname + url.search;
  }
  const response = await fetch(path, {
    method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: data === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': session?.csrf || '' },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(12000),
  });
  const result = await response.json();
  if (!response.ok) {
    if (result.state) accept(result.state);
    const e = new Error(result.error || 'Could not reach the table.'); e.status = response.status; throw e;
  }
  return result;
}
function saveGroups() { try { sessionStorage.setItem(groupKey(state), JSON.stringify(groups)); } catch { /* Private browsing may disable storage. */ } }
function accept(next) {
  if (state && next.code === state.code && next.version < state.version) return;
  if (state && (next.code !== state.code || next.round !== state.round)) stashTableUi();
  const changed = !state || next.version !== state.version || next.code !== state.code;
  if (!state || next.code !== state.code || next.round !== state.round) {
    try { groups = JSON.parse(sessionStorage.getItem(groupKey(next)) || '[]'); } catch { groups = []; }
    const saved = tableUi.get(next.code);
    selected = new Set(saved?.round === next.round ? saved.selected : []);
    chatDraft = saved?.chatDraft || ''; lastCode = next.code;
  }
  state = next; rememberTable(next); clockOffset = next.serverTime - Date.now();
  setAccount(next.account || null);
  selected = new Set([...selected].filter(id => next.hand.some(c => c.id === id)));
  groups = reconcileGroups(groups, next.hand);
  if (changed) renderRoom();
  updateClock(); renderTableSwitcher(); syncControls(); if (changed) renderGamePanel();
}
function landing() {
  state = null; selected.clear(); groups = [];
  document.querySelector('#game-dialog')?.close();
  app.className = 'landing';
  const invite = new URLSearchParams(location.search).get('room') || '';
  if (invite) mode = 'join';
  app.innerHTML = `<section class="hero-copy"><div class="eyebrow"><span class="tiny-club">♣</span> THE BEST SEAT IS WITH FRIENDS</div><h1>Good cards.<br><em>Better company.</em></h1><p class="hero-sub">Your people. Your table. Bring everyone together for a little rummy, wherever the evening finds you.</p><div class="hero-details"><span><b>13</b> cards</span><i></i><span><b>2–6</b> players</span><i></i><span><b>∞</b> good times</span></div><div class="hero-note"><span>✦</span> Private rooms. Friendly points. Always free.</div></section>
    <section class="entry-section"><div class="card-art" aria-hidden="true"><div class="art-ring"></div><div class="art-card art-one">${card({ id: 'hero1', rank: 11, suit: 'S' })}</div><div class="art-card art-two">${card({ id: 'hero2', rank: 12, suit: 'H' })}</div><div class="art-card art-three">${card({ id: 'hero3', rank: 13, suit: 'C' })}</div><span class="art-star">✧</span><span class="art-caption">A little luck. A little skill.</span></div>
    <div class="entry-card"><div class="tabs" role="tablist" aria-label="Table options"><button role="tab" aria-selected="${mode === 'create'}" data-mode="create">Create a table</button><button role="tab" aria-selected="${mode === 'join'}" data-mode="join">Join friends</button></div><form id="entry-form"><label for="player-name">What should we call you?</label><input id="player-name" name="name" placeholder="Your name" minlength="2" maxlength="24" autocomplete="nickname" required value="${esc(localStorage.getItem('mr-name') || '')}">${mode === 'join' ? `<label for="room-code">Your invite code</label><input id="room-code" name="code" class="code-input" placeholder="e.g. A1B2C3D4E5F6" maxlength="12" pattern="[a-fA-F0-9]{12}" required value="${esc(invite)}">` : ''}<label for="room-password">Room password <span>${mode === 'create' ? '(optional)' : '(if your host set one)'}</span></label><input id="room-password" name="password" type="password" maxlength="100" placeholder="${mode === 'create' ? 'A little extra privacy' : 'Ask your host'}" autocomplete="off">${mode === 'create' ? '<details class="access-details"><summary>Have a host access code?</summary><label for="access-key">Server access code</label><input id="access-key" name="accessKey" type="password" autocomplete="off" maxlength="200" placeholder="Only if configured on your server"></details>' : ''}<button class="button primary full" type="submit">${mode === 'create' ? 'Create your table' : 'Take your seat'} <span aria-hidden="true">↗</span></button><p class="entry-note">${mode === 'create' ? 'Invite friends with a link, or warm up with a bot.' : 'One invite link. A whole evening of possibilities.'}</p></form></div></section>
    <section class="bottom-strip"><span class="mini-suits">♠ <span>♥</span> ♣ <span>♦</span></span><p>Same favourite game.<br><strong>A table that’s all yours.</strong></p><div><span>01 / MAKE A TABLE</span><span>02 / INVITE YOUR PEOPLE</span><span>03 / LET THE CARDS TALK</span></div></section>`;
  if (!account) renderAuth();
  else {
    const input = document.querySelector('#player-name'); input.value = account.name; input.readOnly = true;
    const badge = document.createElement('div'); badge.className = 'account-welcome';
    badge.innerHTML = `<span>Welcome back, ${esc(account.name)}</span><strong>♣ ${number(account.points)} play points</strong>`;
    document.querySelector('.entry-card').prepend(badge);
  }
}
function setAccount(next) {
  account = next;
  const button = document.querySelector('#profile-button');
  button.hidden = !account && !state;
  if (!account) button.textContent = 'Create your profile';
  if (account) button.innerHTML = `<span class="profile-initial">${esc(account.name.slice(0, 1).toUpperCase())}</span><span><small>Your profile</small><strong>${number(account.points)} pts</strong></span>`;
}
function renderAuth() {
  const create = authMode === 'register';
  document.querySelector('.entry-card').innerHTML = `<div class="tabs" role="tablist" aria-label="Player account"><button role="tab" aria-selected="${create}" data-auth-mode="register">Create account</button><button role="tab" aria-selected="${!create}" data-auth-mode="login">Sign in</button></div><div class="signup-offer"><span>♣</span><div><strong>${create ? 'Your first 10,000 points are on us.' : 'Your people. Your points. Your seat.'}</strong><p>${create ? 'Build your profile, one friendly win at a time.' : 'Sign in to keep playing with your saved balance.'}</p></div></div><form id="auth-form">${create ? '<label for="account-name">Your display name</label><input id="account-name" name="name" autocomplete="nickname" minlength="2" maxlength="24" placeholder="What should we call you?" required>' : ''}<label for="account-username">Username</label><input id="account-username" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" pattern="[a-zA-Z0-9_]{3,24}" minlength="3" maxlength="24" placeholder="Letters, numbers, underscores" required><label for="account-password">Password ${create ? '<span>(at least 10 characters)</span>' : ''}</label><input id="account-password" name="password" type="password" autocomplete="${create ? 'new-password' : 'current-password'}" minlength="10" maxlength="128" placeholder="${create ? 'Choose a password you’ll remember' : 'Your account password'}" required>${create ? '<label for="account-confirm">Confirm password</label><input id="account-confirm" name="confirmPassword" type="password" autocomplete="new-password" minlength="10" maxlength="128" required placeholder="Enter it once more">' : ''}<button type="submit" class="button primary full">${create ? 'Create account · Get 10,000 points' : 'Sign in to your table'} →</button><p class="entry-note">Play points have no cash value. ${create ? 'Keep your username and password safe.' : 'Use the same account on your phone or computer.'}</p></form>`;
}
async function loadProfile(offset = 0) {
  try {
    const profile = await request(`/api/profile?offset=${offset}`); profileOffset = offset; setAccount(profile);
    const dialog = document.querySelector('#profile-dialog');
    document.querySelector('#profile-content').innerHTML = `<h2>${esc(profile.name)}<small class="profile-handle">@${esc(profile.username)}</small></h2><div class="points-total"><span>YOUR PLAY POINTS</span><strong>${number(profile.points)}</strong><small>Saved to your account · available on every device</small></div><div class="profile-stats"><div><strong>${number(profile.wins)}</strong><span>Wins</span></div><div><strong>${number(profile.roundsPlayed)}</strong><span>Human rounds</span></div><div><strong>${number(profile.points - 10000)}</strong><span>Points earned</span></div></div><p class="profile-explainer">10,000 welcome points, once per account. Win against other registered players to earn more points. Losses leave your balance unchanged. Bot-only practice earns no profile points.</p><h3>Points history</h3><div class="points-history">${profile.history.map(event => `<div><span><strong>${event.type === 'signup' ? 'Welcome bonus' : event.type === 'win' ? `Round ${event.round} win` : `Round ${event.round} played`}</strong><small>${new Date(event.time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${event.room ? ` · ${esc(event.room)}` : ''}</small></span><span class="event-amount">${event.amount ? '+' : ''}${number(event.amount)}<small>${number(event.balance)} balance</small></span></div>`).join('')}</div><div class="history-pages"><button class="text-button" data-history="${Math.max(0, offset - 20)}" ${offset === 0 ? 'disabled' : ''}>← Newer</button><span>${Math.min(offset + 1, profile.historyTotal)}–${Math.min(offset + 20, profile.historyTotal)} of ${profile.historyTotal}</span><button class="text-button" data-history="${offset + 20}" ${offset + 20 >= profile.historyTotal ? 'disabled' : ''}>Older →</button></div><button id="sign-out" class="button secondary full">Sign out</button><p class="entry-note">Your balance and history stay saved when you sign out.</p>`;
    if (!dialog.open) dialog.showModal();
  } catch (e) { toast(e.message, true); }
}
function confirm(title, text, action) {
  document.querySelector('#confirm-title').textContent = title;
  document.querySelector('#confirm-text').textContent = text;
  confirmAction = action; document.querySelector('#confirm-dialog').showModal();
}
function turnText() {
  if (state.status === 'lobby') return 'The table is yours. Invite your people.';
  if (state.status === 'finished') return `${state.result.winnerName} takes the round.`;
  const p = state.players.find(p => p.id === state.turn);
  return state.turn === state.me ? state.phase === 'draw' ? 'Your turn. Pick a card.' : 'Select a discard. Make your move.' : `${p.name} is ${state.phase === 'draw' ? 'drawing' : 'choosing a discard'}…`;
}
function connectionNotice() {
  return `<section id="connection-banner" class="connection-banner connection-notice" role="status" aria-live="polite" aria-atomic="true" hidden><div class="connection-notice-heading"><img src="/assets/figma/connection-lost.svg" alt="" width="86" height="86"><div><h2 id="connection-title">Connection interrupted</h2><p id="connection-detail"></p></div></div><div class="connection-notice-footer"><span class="connection-progress"><img src="/assets/figma/connection-loading.svg" alt="" width="56" height="56"><span id="connection-progress">Connecting…</span></span><button type="button" class="button" id="connection-retry">Reconnect now</button></div></section>`;
}
function updateConnectionNotice() {
  const notice = document.querySelector('#connection-banner');
  if (!notice) return;
  const returningFocus = document.activeElement?.id === 'connection-retry';
  notice.hidden = connection === 'connected';
  if (notice.hidden) {
    if (returningFocus) (document.querySelector('#connection') || document.querySelector('[data-switch-table]'))?.focus();
    return;
  }
  notice.dataset.connection = connection;
  const texts = {
    'connection-title': connection === 'syncing' ? 'Refreshing your table' : 'Connection interrupted',
    'connection-detail': state ? 'Reconnecting automatically. Your hand and groups stay here. Server timers keep running; game actions resume after the table is refreshed.' : 'Reconnecting to your tables automatically. Server timers keep running; no game actions will be replayed.',
    'connection-progress': connection === 'syncing' ? 'Checking the latest state…' : 'Connecting…',
  };
  for (const [id, text] of Object.entries(texts)) {
    const element = document.getElementById(id);
    if (element.textContent !== text) element.textContent = text;
  }
  const retry = document.querySelector('#connection-retry');
  retry.disabled = busy || polling;
  retry.textContent = polling ? 'Checking…' : 'Reconnect now';
}
function roomChrome() {
  return `<div class="room-heading"><div><div class="eyebrow">YOUR PRIVATE CLUB <span class="connection" id="connection" tabindex="-1">● Connected</span></div><h1>The friends’ table<span class="round-badge">${state.round ? `Round ${state.round}` : 'Waiting room'}</span></h1></div><div class="button-row"><button class="button secondary small" data-action="invite">Invite friends <span>↗</span></button><button class="icon-button leave-button" data-action="leave" aria-label="Leave table" title="Leave table">${state.status === 'lobby' ? '<img src="/assets/figma/arrow-left.svg" alt="" width="24" height="24">' : '⇥'}</button></div></div>
  <div id="table-switcher"></div><nav class="board-toolbar" aria-label="Table tools"><button class="button secondary small" data-action="tutorial">Learn rummy</button><button class="button secondary small" data-panel="chat">Chat</button><button class="button secondary small" data-panel="hand" ${!state.hand.length ? 'disabled' : ''}>View cards</button><button class="button secondary small" data-panel="standings">Standings</button><button class="button secondary small" data-panel="information">Table info</button><button class="button secondary small" data-panel="settings">Settings</button></nav>
  ${connectionNotice()}<div id="command-status" class="sr-only" role="status"></div>
`;
}
// Use each player's stable seat index across waiting and active boards.
function seatAvatar(player) {
  const i = state.players.findIndex(p => p.id === player.id);
  return player.bot ? '<span aria-hidden="true">✦</span>' : `<img src="/assets/figma/avatar-${i + 1}.${[1, 2, 3].includes(i) ? 'svg' : 'png'}" alt="" width="96" height="96">`;
}
function renderWaitingRoom() {
  const host = state.host === state.me;
  const ready = state.players.length >= 2;
  const focused = document.activeElement;
  const focusKey = focused?.dataset.remove || focused?.dataset.action;
  const cursor = focused?.selectionStart;
  app.className = 'room-page waiting-page';
  app.innerHTML = `${roomChrome()}
    <div class="waiting-layout"><section class="waiting-table" aria-labelledby="waiting-title">
      <div class="waiting-summary"><span class="eyebrow">YOUR PRIVATE TABLE</span><span class="waiting-count">${state.players.length} / 6 seated</span></div>
      <div class="waiting-intro"><img class="waiting-emblem" src="/assets/figma/waiting-loader.svg" alt="" width="56" height="56"><h2 id="waiting-title">Players are getting ready</h2><p>${host ? 'Invite your friends, or add a practice bot. You choose when to deal.' : 'Your seat is saved. Invite friends while you wait for the host to deal.'}</p><div class="waiting-progress" role="progressbar" aria-label="Seats filled" aria-valuemin="0" aria-valuemax="6" aria-valuenow="${state.players.length}" aria-valuetext="${state.players.length} of 6 seats filled; the host can deal with 2 or more players"><span style="width:${state.players.length / 6 * 100}%"></span></div></div>
      <div class="waiting-seats" aria-label="Table seats">${Array.from({ length: 6 }, (_, i) => {
        const player = state.players[i];
        if (!player) return `<button class="waiting-seat waiting-seat-open" data-action="invite" aria-label="Invite a friend to seat ${i + 1}"><span class="waiting-avatar" aria-hidden="true">+</span><strong>Open seat</strong><span>Invite a friend</span></button>`;
        return `<div class="waiting-seat ${player.id === state.me ? 'waiting-seat-self' : ''}" data-player-seat="${esc(player.id)}"><span class="waiting-avatar" aria-hidden="true">${seatAvatar(player)}</span><strong title="${esc(player.name)}">${esc(player.name)}${player.id === state.me ? ' (you)' : ''}</strong><span>${player.bot ? 'Practice bot' : player.id === state.host ? 'Table host' : 'Friend'}</span><span class="player-presence" data-presence-player="${esc(player.id)}"></span>${host && player.bot ? `<button class="waiting-remove" data-remove="${esc(player.id)}" aria-label="Remove ${esc(player.name)}">Remove bot</button>` : ''}</div>`;
      }).join('')}</div>
      <div class="waiting-deal"><div><span class="eyebrow">${ready ? 'READY TO DEAL' : 'ONE MORE PLAYER TO BEGIN'}</span><p id="waiting-help">${host ? ready ? 'At least two players are seated. Deal whenever you’re ready.' : 'Invite a friend or add a bot to unlock the first round.' : 'Only the host can start the round. No need to mark yourself ready.'}</p></div><div class="button-row">${host ? `<button class="button felt-outline" data-action="addBot" ${state.players.length >= 6 ? 'disabled' : ''}>+ Practice bot</button><button class="button cream" data-action="start" aria-describedby="waiting-help" ${!ready ? 'disabled' : ''}>Deal the first round <span aria-hidden="true">→</span></button>` : '<span class="waiting-host-status"><span class="status-dot" aria-hidden="true"></span> Waiting for the host</span>'}</div></div>
    </section><aside class="waiting-sidebar"><section class="side-card waiting-invite"><span class="eyebrow">SAVE A SEAT</span><h2>Bring your people.</h2><p>Send your private invite link. ${state.hasPassword ? 'This room is password protected. Share its password separately.' : 'Anyone with the link can ask to join your table.'}</p><span class="waiting-code-label">ROOM CODE${state.hasPassword ? ' · PASSWORD PROTECTED' : ''}</span><code>${esc(state.code)}</code><button class="button primary full" data-action="invite">Share invite link <span aria-hidden="true">↗</span></button></section>
      <section class="side-card"><div class="side-heading"><h2>Table talk</h2><span>${state.players.length}/6 seated</span></div><div class="messages" id="messages">${state.messages.length ? state.messages.map(m => `<div class="message"><span>${esc(m.name)} <time>${new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></span><p>${esc(m.text)}</p></div>`).join('') : '<div class="empty-chat"><p>Say hello before the first deal.</p><small>Only players at this table can read your messages.</small></div>'}</div><form class="chat-form" id="chat-form"><label class="sr-only" for="chat-input">Message your table</label><input id="chat-input" maxlength="240" placeholder="Say hello…" required autocomplete="off" value="${esc(chatDraft)}"><button type="submit" aria-label="Send message">↑</button></form></section>
    </aside></div><p class="waiting-footnote">13 cards · 2–6 players · Free play, no money involved <button class="text-button" data-action="tutorial">Learn the rules ↗</button></p>`;
  const messageBox = document.querySelector('#messages'); messageBox.scrollTop = messageBox.scrollHeight;
  if (focused?.id === 'chat-input') { const input = document.querySelector('#chat-input'); input.focus(); input.setSelectionRange(cursor, cursor); }
  else if (focusKey) [...app.querySelectorAll('[data-remove], [data-action]')].find(el => (el.dataset.remove || el.dataset.action) === focusKey && !el.disabled)?.focus();
  renderTableSwitcher(); syncControls(true);
}
function renderRoom() {
  if (state.status === 'lobby') { renderWaitingRoom(); return; }
  const focus = document.activeElement?.id;
  const selectionStart = document.activeElement?.selectionStart;
  app.className = `room-page ${state.status === 'playing' ? 'gameplay-page' : ''}`;
  const me = state.players.find(p => p.id === state.me), host = state.host === state.me;
  const playing = state.status === 'playing', myTurn = playing && state.turn === state.me && !me.dropped;
  const canDiscard = myTurn && state.phase === 'discard';
  const isLobby = !playing;
  const inGroups = new Set(groups.flatMap(g => g.ids));
  const loose = state.hand.filter(c => !inGroups.has(c.id));
  const groupView = (ids, title, i) => `<div class="hand-group"><div class="group-heading"><span>${esc(title)}</span>${i !== undefined ? `<button class="ungroup" data-ungroup="${i}" aria-label="Ungroup ${esc(title)}">×</button>` : ''}</div><div class="cards">${ids.map(id => card(state.hand.find(c => c.id === id), true)).join('')}</div></div>`;
  app.innerHTML = `${roomChrome()}
  <div class="game-layout"><section class="table-column"><div class="felt-table"><div class="felt-top"><span>13-CARD INDIAN RUMMY</span><span class="room-code">ROOM ${state.code} ${state.hasPassword ? '· LOCKED' : ''}</span></div><div class="seats">${state.players.filter(p => p.id !== state.me).map(p => `<div data-player-seat="${esc(p.id)}" class="seat ${playing && state.turn === p.id ? 'active' : ''} ${p.dropped ? 'dropped' : ''}"><div class="avatar" aria-hidden="true">${seatAvatar(p)}</div><strong>${esc(p.name)}</strong><span class="seat-score" aria-label="${esc(p.name)}: ${number(p.total)} total penalty points">${number(p.total)} pts <small>penalty</small></span>${playing && state.turn === p.id ? '<span class="seat-turn">Playing now</span>' : ''}<span>${p.bot ? 'Practice bot' : p.id === state.host ? 'Table host' : 'Friend'}${p.dropped ? ' · Dropped' : playing ? ` · ${p.count} cards` : ''}</span><span class="player-presence" data-presence-player="${esc(p.id)}"></span>${playing && !p.dropped ? '<div class="mini-hand">▥ ▥ ▥ ▥ ▥</div>' : ''}${host && isLobby && p.bot ? `<button class="remove-bot" data-remove="${p.id}">Remove</button>` : ''}</div>`).join('')}${state.players.length < 6 && isLobby ? `<button class="seat empty-seat" data-action="invite"><span class="avatar">+</span><strong>A seat for a friend</strong><span>Share your invite link</span></button>` : ''}</div>
  ${state.status === 'lobby' ? `<div class="lobby-center"><span class="table-club">♣</span><h2>Great company.<br>One good game.</h2><p>${host ? 'Invite a friend or add a practice bot to get started.' : 'Make yourself comfortable. Your host will deal shortly.'}</p><div class="button-row">${host ? `<button class="button cream" data-action="start" ${state.players.length < 2 ? 'disabled' : ''}>Deal the first round <span>→</span></button><button class="button felt-outline" data-action="addBot" ${state.players.length >= 6 ? 'disabled' : ''}>+ Practice bot</button>` : '<span class="waiting-label">Waiting for the host to deal…</span>'}</div></div>` : `<div class="deck-area"><div class="pile"><span class="pile-label">CLOSED DECK</span><button class="card card-back" data-draw="stock" ${!myTurn || state.phase !== 'draw' ? 'disabled' : ''} aria-label="Draw from closed deck"><span>♣</span><small>M RUMMY</small></button><span class="pile-caption">${state.stockCount} cards</span></div><div class="pile"><span class="pile-label">OPEN DECK</span><button class="open-pile" data-draw="discard" ${!myTurn || state.phase !== 'draw' || !state.topDiscard || [0, state.wildRank].includes(state.topDiscard.rank) ? 'disabled' : ''} aria-label="Draw from open deck">${state.topDiscard ? card(state.topDiscard) : '<span class="empty-card">Empty</span>'}</button><span class="pile-caption">${state.topDiscard && [0, state.wildRank].includes(state.topDiscard.rank) ? 'Joker · cannot pick' : 'Take the top card'}</span></div><div class="wild-indicator"><span class="pile-label">WILD JOKER</span>${card(state.indicator)}<span class="pile-caption">All ${ranks[state.wildRank] || state.wildRank}s are wild</span></div></div>`}
  <div class="table-status"><span class="status-dot"></span><span>${esc(turnText())}</span>${playing ? '<span id="turn-clock" class="turn-clock"></span>' : ''}</div></div>
  ${state.status === 'finished' ? `<section class="results"><div class="results-title"><span class="eyebrow">ROUND ${state.round} · ${state.result.reason === 'last-player' ? 'LAST PLAYER STANDING' : 'VALID DECLARATION'}</span><h2>${esc(state.result.winnerName)} wins <span>✦</span></h2>${state.result.pointsAward ? `<p class="win-points">${state.result.pointsAward.amount ? `+${number(state.result.pointsAward.amount)} play points credited to ${esc(state.result.winnerName)}’s profile` : 'No profile points awarded for this round'}</p>` : ''}</div><div class="score-table-wrap"><table class="score-table"><thead><tr><th>Player</th><th>Round penalty</th><th>Penalty total ↓</th></tr></thead><tbody>${state.result.scores.map(p => `<tr class="${p.id === state.result.winner ? 'winner-row' : ''}"><td>${esc(p.name)} ${p.id === state.result.winner ? '♣' : p.dropped ? '<small>Dropped</small>' : ''}</td><td>${p.penalty}</td><td>${p.total}</td></tr>`).join('')}</tbody></table></div>${state.result.groups.length ? `<details class="winner-hand"><summary>See the winning groups</summary>${state.result.groups.map(g => `<div><span>${g.type === 'pure' ? 'Pure sequence' : g.type === 'set' ? 'Set' : 'Sequence'}</span><div class="cards">${g.ids.map(id => card(state.result.scores.find(p => p.id === state.result.winner).hand.find(c => c.id === id))).join('')}</div></div>`).join('')}</details>` : ''}<div class="button-row">${host ? '<button class="button primary" data-action="start">Deal another round →</button>' : '<p>Waiting for the host to deal again.</p>'}${host && state.players.length < 6 ? '<button class="button secondary" data-action="addBot">+ Practice bot</button>' : ''}</div></section>` : ''}
  <section class="hand-panel"><div class="hand-header"><div class="hand-identity"><span class="self-avatar avatar" aria-hidden="true">${seatAvatar(me)}</span><div><span class="eyebrow">${esc(me.name)} ${host ? '· HOST' : ''}</span><h2>Your hand <span>${state.hand.length} cards${me.dropped ? ' · Dropped' : ''}</span></h2><span class="player-presence" data-presence-player="${esc(me.id)}"></span><span class="self-score">${number(me.total)} total penalty pts</span></div></div><div class="hand-tools"><button class="text-button" data-action="sort" ${!state.hand.length ? 'disabled' : ''}>Sort ↕</button><button class="text-button" data-action="arrange" ${!state.hand.length ? 'disabled' : ''}>Auto-group ✦</button><button class="text-button" data-action="group" ${selected.size < 3 ? 'disabled' : ''}>Group (${selected.size})</button></div></div><div class="hand-scroll">${state.hand.length ? `${groups.map((g, i) => groupView(g.ids, g.title || `Group ${i + 1}`, i)).join('')}${loose.length ? groupView(loose.map(c => c.id), groups.length ? 'Ungrouped' : 'Tap cards to select · group 3 or more') : ''}` : '<div class="hand-placeholder"><span>♠ ♥ ♣ ♦</span><p>Your 13 cards will be right here when the round starts.</p></div>'}</div><div class="hand-footer"><span class="hand-hint">${me.dropped ? 'You’re watching this round. You’ll be back in the next one.' : canDiscard ? selected.size === 1 ? 'One card selected. Discard it, or declare if the rest of your hand is ready.' : 'Select one card for your discard.' : myTurn ? 'Pick a card from either deck to begin your turn.' : 'Select cards to make groups while you wait.'}</span><div class="button-row"><button class="button secondary small" data-action="drop" ${!playing || me.dropped || (myTurn && state.phase === 'discard') ? 'disabled' : ''}>Drop · ${me.turns === 0 ? '20' : '40'}</button><button class="button secondary small" data-action="discard" ${!canDiscard || selected.size !== 1 ? 'disabled' : ''}><img src="/assets/figma/discard.svg" alt="">Discard</button><button class="button primary small" data-action="declare" ${!canDiscard || selected.size !== 1 ? 'disabled' : ''}><img src="/assets/figma/declare.svg" alt="">Declare ↗</button></div></div></section></section>
  <aside class="sidebar"><section class="side-card"><div class="side-heading"><h2>Table talk</h2><span>${state.players.length}/6 seated</span></div><div class="messages" id="messages">${state.messages.length ? state.messages.map(m => `<div class="message"><span>${esc(m.name)} <time>${new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></span><p>${esc(m.text)}</p></div>`).join('') : '<div class="empty-chat"><span>“</span><p>The best part of cards?<br>The conversation.</p><small>Say hello to your table.</small></div>'}</div><form class="chat-form" id="chat-form"><label class="sr-only" for="chat-input">Message your table</label><input id="chat-input" maxlength="240" placeholder="Say something…" required autocomplete="off" value="${esc(chatDraft)}"><button type="submit" aria-label="Send message">↑</button></form></section><section class="side-card activity"><div class="side-heading"><h2>At the table</h2><span class="live-dot">LIVE</span></div><div>${state.activity.slice(0, 7).map(a => `<p><span></span>${esc(a.text)}</p>`).join('')}</div></section><section class="table-tip"><span>✧ THE WINNING HAND</span><p>Two sequences.<br>One of them pure.<br><em>The rest is up to you.</em></p><button class="text-button" data-action="rules">A quick rules refresher ↗</button></section>${state.history.length > 1 ? `<details class="side-card history"><summary>Previous rounds</summary>${state.history.slice(1).map(h => `<p>Round ${h.round} <strong>${esc(h.winner)}</strong></p>`).join('')}</details>` : ''}</aside></div>`;
  const messageBox = document.querySelector('#messages'); if (messageBox) messageBox.scrollTop = messageBox.scrollHeight;
  if (focus === 'chat-input') { const input = document.querySelector('#chat-input'); input.focus(); input.setSelectionRange(selectionStart, selectionStart); }
  renderTableSwitcher(); updateClock(); syncControls(true);
}
function updateClock() {
  updateTableClocks();
  const el = document.querySelector('#turn-clock'); if (!el || !state) return;
  const seconds = remainingSeconds(state.deadline, clockOffset);
  el.textContent = `${seconds}s`; el.classList.toggle('urgent', seconds <= 15);
}
function stashTableUi() {
  if (!state) return;
  saveGroups(); tableUi.set(state.code, { round: state.round, selected: [...selected], chatDraft });
}
function rememberTable(room) {
  const me = room.players.find(p => p.id === room.me);
  const summary = { code: room.code, version: room.version, round: room.round, status: room.status, phase: room.phase, deadline: room.deadline,
    yourTurn: room.status === 'playing' && room.turn === room.me && !me.dropped, dropped: !!me.dropped, playerCount: room.players.length };
  const index = tables.findIndex(t => t.code === room.code);
  if (index < 0) tables.push(summary); else tables[index] = summary;
  try { sessionStorage.setItem('mr-active-table', room.code); } catch { /* Optional recovery hint. */ }
}
function renderTableSwitcher() {
  const root = document.querySelector('#table-switcher');
  if (!root) return;
  const focused = document.activeElement?.dataset.switchTable;
  const markup = `<nav class="table-switcher" aria-label="Joined tables">${tables.map((table, i) => `<button class="table-tab ${table.code === state?.code ? 'current' : ''} ${table.yourTurn ? 'your-turn' : ''}" data-switch-table="${esc(table.code)}" ${table.code === state?.code ? 'aria-current="page"' : ''}><strong>Table ${i + 1} · ${esc(table.code)}</strong><span data-table-clock="${esc(table.code)}"></span></button>`).join('')}<button class="button secondary small add-table" data-add-table ${tables.length >= tableLimit ? 'disabled' : ''}>+ Add table (${tables.length}/${tableLimit})</button></nav>`;
  // Preserve focus and horizontal scroll when a poll changes only deadlines.
  if (root.dataset.markup !== markup) {
    const scroll = root.querySelector('nav')?.scrollLeft || 0;
    root.innerHTML = markup; root.dataset.markup = markup;
    root.querySelector('nav').scrollLeft = scroll;
    if (focused) root.querySelector(`[data-switch-table="${CSS.escape(focused)}"]`)?.focus();
  }
  updateTableClocks();
}
function updateTableClocks() {
  for (const label of document.querySelectorAll('[data-table-clock]')) {
    const table = tables.find(t => t.code === label.dataset.tableClock);
    if (!table) continue;
    label.textContent = table.status === 'lobby' ? `Waiting · ${table.playerCount}/6 seated` : table.status === 'finished' ? 'Round ended' : `${table.dropped ? 'Watching' : table.yourTurn ? 'Your turn' : 'Playing'} · ${remainingSeconds(table.deadline, clockOffset)}s`;
  }
}
function acceptTableList(result) {
  tables = result.tables; tableLimit = result.tableLimit; clockOffset = result.serverTime - Date.now();
  renderTableSwitcher();
}
function tablePicker() {
  state = null; selected.clear(); groups = []; chatDraft = '';
  document.querySelector('#game-dialog').close();
  if (!tables.length) { history.replaceState({}, '', '/'); landing(); return; }
  history.replaceState({}, '', '/'); app.className = 'room-page';
  app.innerHTML = `<h1>Choose your table</h1><p>Your other rounds keep running. Select a table to return to play.</p><div id="table-switcher"></div>${connectionNotice()}`;
  renderTableSwitcher(); syncControls();
}
async function switchTable(code) {
  if (busy || connection !== 'connected' || code === state?.code) return;
  stashTableUi(); tableEpoch++; busy = true; setConnection('syncing');
  document.querySelector('#game-dialog').close();
  try {
    const result = await request(`/api/tables?code=${encodeURIComponent(code)}`); acceptTableList(result);
    if (!result.active) { tablePicker(); toast('That table is no longer available. Choose another table.', true); }
    else { accept(result.active); history.replaceState({}, '', `/?room=${state.code}`); }
    setConnection('connected');
  } catch (e) { setConnection('reconnecting'); toast(e.message, true); }
  finally { busy = false; syncControls(); }
}
async function restoreTables() {
  let preferred = new URLSearchParams(location.search).get('room');
  try { preferred ||= sessionStorage.getItem('mr-active-table'); } catch { /* Optional recovery hint. */ }
  const memberships = session.rooms || (session.room ? [session.room] : []);
  const code = memberships.includes(preferred) ? preferred : memberships[0];
  const result = await request(`/api/tables${code ? `?code=${encodeURIComponent(code)}` : ''}`); acceptTableList(result);
  if (result.active) { accept(result.active); history.replaceState({}, '', `/?room=${state.code}`); }
  else if (!tables.length) landing();
  else tablePicker();
}
function showTutorial() {
  tutorialIndex = 0; renderTutorial();
  document.querySelector('#rules-dialog').close();
  document.querySelector('#tutorial-dialog').showModal();
}
function renderTutorial() {
  const step = tutorialSteps[tutorialIndex];
  document.querySelector('#tutorial-title').textContent = step.title;
  document.querySelector('#tutorial-progress').textContent = `Step ${tutorialIndex + 1} of ${tutorialSteps.length}`;
  document.querySelector('#tutorial-content').innerHTML = `<p>${esc(step.text)}</p>${step.cards.length ? `<div class="tutorial-cards cards" aria-label="Example cards">${step.cards.map((c, i) => card({ ...c, id: `tutorial-${tutorialIndex}-${i}` }, false, false, null)).join('')}</div>` : ''}<p class="tutorial-note">${esc(step.note)}</p>`;
  document.querySelector('#tutorial-back').disabled = tutorialIndex === 0;
  document.querySelector('#tutorial-next').textContent = tutorialIndex === tutorialSteps.length - 1 ? 'Finish tutorial' : 'Next →';
}
function showGamePanel(panel, fromSettings = false) {
  if (!state) return;
  openGamePanel = panel; panelFromSettings = fromSettings;
  if (panel === 'chat') chatComposerMode = 'replies';
  document.querySelector('#game-panel-content').innerHTML = ''; renderGamePanel();
  const dialog = document.querySelector('#game-dialog');
  if (dialog.open && (fromSettings || panel === 'settings')) {
    const heading = document.querySelector('#game-panel-title'); heading.tabIndex = -1; heading.focus();
  }
  if (!dialog.open) dialog.showModal();
  if (panel === 'chat') { const messages = document.querySelector('#dialog-messages'); messages.scrollTop = messages.scrollHeight; }
}
function renderGamePanel() {
  if (!openGamePanel || !state) return;
  const titles = { chat: 'Table talk', hand: 'Your cards', standings: 'Table standings', information: 'Game information', settings: 'Your display settings', lastDeal: 'Last completed deal', declaration: 'Review your declaration' };
  const content = document.querySelector('#game-panel-content');
  const lastDeal = state.history?.[0];
  const hasLastDeal = Array.isArray(lastDeal?.scores) && lastDeal.scores.length > 0;
  if (openGamePanel === 'settings' && content.querySelector('[data-preference]')) {
    content.querySelector('[data-settings-panel=lastDeal]').disabled = !hasLastDeal;
    content.querySelector('#settings-last-deal-help').textContent = hasLastDeal ? 'View the last completed round.' : 'Available after the first completed round.';
    return;
  }
  const focused = document.activeElement?.id;
  const cursor = document.activeElement?.selectionStart;
  const cursorEnd = document.activeElement?.selectionEnd;
  const oldMessages = content.querySelector('.messages');
  const scroll = oldMessages?.scrollTop || 0;
  const nearBottom = !oldMessages || oldMessages.scrollHeight - oldMessages.clientHeight - scroll < 32;
  const dialog = document.querySelector('#game-dialog');
  const panelScroll = dialog.scrollTop;
  dialog.dataset.panel = openGamePanel;
  dialog.classList.toggle('declaration-notice', openGamePanel === 'declaration');
  dialog.querySelector('.dialog-head [data-close]').innerHTML = ['information', 'standings'].includes(openGamePanel) ? '<img src="/assets/figma/info-close.svg" alt="">' : ['chat', 'settings', 'lastDeal'].includes(openGamePanel) ? '<img src="/assets/figma/chat-back.svg" alt="">' : '×';
  document.querySelector('#game-panel-title').textContent = titles[openGamePanel];
  if (openGamePanel === 'chat') {
    content.innerHTML = `<p class="chat-scope">ROOM ${esc(state.code)} · ${state.players.length}/6 seated</p><div class="messages" id="dialog-messages" role="region" tabindex="0" aria-label="Table message history">${state.messages.length ? state.messages.map(m => `<article class="message"><span>${esc(m.name)} <time>${new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></span><p>${esc(m.text)}</p></article>`).join('') : '<div class="chat-empty"><strong>Your table, your conversation.</strong><p>Say hello or choose a quick reply below.</p></div>'}</div><div class="chat-suggestions"><div class="chat-suggestion-heading"><h3>${chatComposerMode === 'emojis' ? 'Emoji' : 'Quick replies'}</h3>${chatComposerMode === 'emojis' ? '<button type="button" class="text-button" id="chat-show-replies" data-chat-mode="replies">Quick replies</button>' : '<span>Tap to add to your draft</span>'}</div><div class="${chatComposerMode === 'emojis' ? 'chat-emoji-grid' : 'chat-quick-replies'}">${chatComposerMode === 'emojis' ? chatEmojis.map(([emoji, name], i) => `<button type="button" id="chat-emoji-${i}" data-chat-emoji="${i}" aria-label="Insert ${esc(name.toLowerCase())}">${emoji}</button>`).join('') : chatReplies.map((text, i) => `<button type="button" id="chat-reply-${i}" data-chat-reply="${i}">${esc(text)}</button>`).join('')}</div></div><form class="chat-form" id="dialog-chat-form"><button type="button" class="chat-emoji-toggle" id="chat-emoji-toggle" data-chat-mode="${chatComposerMode === 'emojis' ? 'replies' : 'emojis'}" aria-label="Choose emoji" aria-pressed="${chatComposerMode === 'emojis'}"><img src="/assets/figma/chat-emoji.svg" alt=""></button><label class="sr-only" for="dialog-chat-input">Message your table</label><input id="dialog-chat-input" aria-describedby="dialog-chat-status" maxlength="240" required autocomplete="off" placeholder="Your message" value="${esc(chatDraft)}"><button type="submit" id="dialog-chat-send" aria-label="Send message" ${busy || connection !== 'connected' || !chatDraft.trim() ? 'disabled' : ''}><img src="/assets/figma/chat-send.svg" alt=""></button></form><div class="chat-compose-status"><p id="dialog-chat-status" role="status">${connection !== 'connected' ? 'Reconnecting. Your draft is kept until you can send.' : busy ? 'Sending your action…' : 'Only players at this table can read these messages.'}</p><span id="dialog-chat-count" aria-label="Message length">${chatDraft.length}/240</span></div>`;
    const messages = content.querySelector('.messages');
    messages.scrollTop = nearBottom ? messages.scrollHeight : scroll;
  } else if (openGamePanel === 'hand') {
    const inGroups = new Set(groups.flatMap(g => g.ids));
    const visibleGroups = [...groups, { title: 'Ungrouped', ids: state.hand.filter(c => !inGroups.has(c.id)).map(c => c.id) }].filter(g => g.ids.length);
    const me = state.players.find(p => p.id === state.me);
    content.innerHTML = `<div class="hand-view-summary"><span>ROOM <strong>${esc(state.code)}</strong> · ROUND ${number(state.round)}</span><span>${state.hand.length} cards${me?.dropped ? ' · Dropped' : ''}</span></div><p class="hand-view-note" id="hand-view-note">Only your own hand is shown. Return to the table to arrange or play. ${state.status === 'playing' ? 'The turn timer keeps running.' : ''}</p><div class="hand-view-groups">${visibleGroups.length ? visibleGroups.map((g, i) => `<section aria-labelledby="hand-view-group-${i}"><div class="hand-view-group-heading"><h3 id="hand-view-group-${i}">${esc(g.title || 'Group')}</h3><span>${g.ids.length} cards</span></div><div class="cards" role="list" aria-label="${esc(g.title || 'Group')} cards">${g.ids.map(id => `<div role="listitem">${card(state.hand.find(c => c.id === id))}</div>`).join('')}</div></section>`).join('') : '<p class="hand-view-empty" role="status">No cards in your hand. They will appear here when the next round is dealt.</p>'}</div><div class="hand-view-footer"><span>${state.wildRank ? `Wild rank: ${esc(ranks[state.wildRank] || state.wildRank)} · Marked WILD` : 'Wild rank is set when the round starts.'}</span><button type="button" class="button" id="hand-view-back" data-close="game-dialog">Return to table</button></div>`;
  } else if (openGamePanel === 'standings') {
    const standings = tableStandings(state.players);
    const result = state.status === 'finished' ? state.result : null;
    const roundScores = new Map((result?.scores || []).map(p => [p.id, p]));
    const revealedOpen = content.querySelector('.standings-revealed')?.open || false;
    content.innerHTML = `<div class="standings-summary"><span>ROOM <strong>${esc(state.code)}</strong></span><span>${state.players.length} players · Free play</span></div><p class="standings-explainer">Current table only. Lower cumulative penalty points rank higher. Tied scores share a place. Profile play points are separate.</p><div class="score-table-wrap standings-table-wrap"><table class="score-table standings-table"><caption class="sr-only">Cumulative table penalties</caption><thead><tr><th scope="col">Place</th><th scope="col">Player</th><th scope="col">This round</th><th scope="col">Total penalty ↓</th></tr></thead><tbody>${standings.map(p => {
      const shared = standings.filter(other => other.place === p.place).length > 1;
      const roundScore = roundScores.get(p.id);
      return `<tr data-standing-player="${esc(p.id)}" class="${p.id === state.me ? 'standing-self' : ''}"><td class="standing-place"><span aria-label="${shared ? 'Joint rank' : 'Rank'} ${p.place}">${p.place}</span>${shared ? '<small>Tied</small>' : ''}</td><th scope="row"><div class="standing-player"><span class="standing-avatar" aria-hidden="true">${seatAvatar(p)}</span><span class="standing-player-text"><strong>${esc(p.name)}</strong><span class="standing-labels">${p.id === state.me ? '<span>You</span>' : ''}${p.bot ? '<span>Practice bot</span>' : ''}${result?.winner === p.id ? '<span class="standing-winner">Round winner</span>' : p.dropped ? '<span>Dropped</span>' : ''}</span></span></div></th><td class="standing-round">${roundScore ? number(roundScore.penalty) : '<span aria-label="Not settled">—</span>'}</td><td class="standing-total">${number(p.total)}</td></tr>`;
    }).join('')}</tbody></table></div>${result ? `<details class="standings-revealed" ${revealedOpen ? 'open' : ''}><summary id="standings-reveal-toggle">View revealed round hands</summary><p>These hands were revealed by the server after the round ended.</p><div class="inspect-hand">${result.scores.map(p => `<section><h3>${esc(p.name)}</h3><div class="cards">${p.hand.map(c => card(c)).join('')}</div></section>`).join('')}</div></details>` : '<p class="standings-privacy">Round penalties and opponents’ cards are shown only after the round ends.</p>'}<div class="standings-footer"><div><strong>${state.status === 'finished' ? `Round ${number(state.round)} complete` : state.status === 'lobby' ? 'Waiting for the first deal' : `Round ${number(state.round)} in progress`}</strong><span>${state.round && state.wildRank ? `Wild rank: ${esc(ranks[state.wildRank] || state.wildRank)}` : 'Wild rank is set when the round starts.'}</span></div><button type="button" class="button" id="standings-back" data-close="game-dialog">Back to table</button></div>`;
  } else if (openGamePanel === 'information') {
    const facts = [
      ['Variant', '13-card Indian rummy'], ['No. of decks', '2 packs'], ['Printed jokers', '1 per deck · 2 total'],
      ['Human turns', '60 seconds · Server timed'], ['First drop', '20 penalty points'], ['Middle drop', '40 penalty points'],
      ['Maximum round penalty', '80 points'], ['Extra time', 'No extra time'], ['Stakes', 'Free play · No money involved'],
      ['Players', `${state.players.length} / 6`], ['Privacy', `Invite only${state.hasPassword ? ' · Password protected' : ''}`], ['Round', state.round ? `Round ${number(state.round)}` : 'Not started'],
    ];
    const status = { lobby: 'Waiting for players', playing: 'Playing', finished: 'Round ended' }[state.status] || 'Refreshing';
    content.innerHTML = `<div class="info-room-summary"><span>ROOM <strong>${esc(state.code)}</strong></span><span class="info-status" id="info-status">${status}</span></div><dl class="table-facts info-facts">${facts.map(([label, value]) => `<div class="info-fact"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><section class="info-rules" aria-labelledby="info-rules-title"><h3 id="info-rules-title">A valid declaration</h3><p>After drawing, select one final discard. The other 13 cards must form valid groups throughout, with at least two sequences including one pure sequence. An invalid declaration leaves your hand and turn open without a penalty.</p></section><p class="info-note">Turn timers keep running while a player is away or reconnecting. Presence badges are advisory. Profile play points are separate from table penalties.</p>`;
  } else if (openGamePanel === 'settings') {
    content.innerHTML = `<p class="settings-intro">Make the table comfortable for you.</p><div class="settings-options"><button type="button" class="settings-option" data-settings-panel="information"><span class="settings-option-icon" aria-hidden="true"><img src="/assets/figma/settings-info.svg" alt=""></span><span><strong>Info</strong><small>Rules, room details and turn timing</small></span><span class="settings-option-action" aria-hidden="true">↗</span></button><div class="settings-option settings-option-unavailable"><span class="settings-option-icon" aria-hidden="true"><img src="/assets/figma/settings-music.svg" alt=""></span><span><strong>Game Music</strong><small>Music playback is not available yet.</small></span><span class="settings-unavailable-label">Unavailable</span></div><button type="button" class="settings-option" data-settings-panel="lastDeal" aria-describedby="settings-last-deal-help" ${!hasLastDeal ? 'disabled' : ''}><span class="settings-option-icon" aria-hidden="true"><img src="/assets/figma/settings-cards.svg" alt=""></span><span><strong>Last Deal</strong><small id="settings-last-deal-help">${hasLastDeal ? 'View the last completed round.' : 'Available after the first completed round.'}</small></span><span class="settings-option-action" aria-hidden="true">↗</span></button></div><fieldset class="settings-preferences"><legend>Display preferences</legend><label class="preference settings-preference"><span><strong>Spread out hand cards</strong><small>Less overlap; scroll sideways to see the full hand.</small></span><input type="checkbox" data-preference="roomyCards" aria-label="Spread out hand cards" ${preferences.roomyCards ? 'checked' : ''}></label><label class="preference settings-preference"><span><strong>Reduce motion</strong><small>Your device’s reduced-motion preference is also respected.</small></span><input type="checkbox" data-preference="quietMotion" aria-label="Reduce motion" ${preferences.quietMotion ? 'checked' : ''}></label></fieldset><p id="settings-save-status" role="status">${esc(preferenceSaveMessage)}</p>`;
  } else if (openGamePanel === 'lastDeal') {
    content.innerHTML = hasLastDeal ? `<p class="last-deal-summary">Round ${number(lastDeal.round)}<strong>${esc(lastDeal.winner)} won</strong></p><div class="score-table-wrap"><table class="score-table"><caption class="sr-only">Last completed round penalties</caption><thead><tr><th scope="col">Player</th><th scope="col">Round penalty</th><th scope="col">Total penalty</th></tr></thead><tbody>${lastDeal.scores.map(p => `<tr><th scope="row">${esc(p.name)}</th><td>${number(p.penalty)}</td><td>${number(p.total)}</td></tr>`).join('')}</tbody></table></div><p class="last-deal-note">These are the server-recorded results of the last completed round at this table.</p>` : '<p class="last-deal-note">No completed round is available yet.</p>';
  } else if (openGamePanel === 'declaration') {
    content.innerHTML = `<p class="declaration-feedback">${esc(declarationError)}</p><p>Check for two sequences, at least one pure, and valid groups covering your other 13 cards. No penalty was applied to the rejected declaration. The server timer continues.</p><div class="button-row"><button class="button primary" data-close="game-dialog">Review my hand</button><button class="button secondary" data-panel-action="arrange" ${busy || connection !== 'connected' ? 'disabled' : ''}>Auto-group</button></div>`;
  }
  if (panelFromSettings && ['information', 'lastDeal'].includes(openGamePanel)) content.insertAdjacentHTML('beforeend', '<button type="button" class="button secondary settings-back" data-settings-panel="settings">Back to settings</button>');
  if (focused === 'dialog-chat-input') {
    const input = content.querySelector('#dialog-chat-input');
    input?.focus({ preventScroll: true }); input?.setSelectionRange(cursor, cursorEnd ?? cursor);
  } else if (openGamePanel === 'chat' && focused && (focused.startsWith('chat-') || focused === 'dialog-chat-send' || focused === 'dialog-messages')) {
    document.getElementById(focused)?.focus({ preventScroll: true });
  } else if (openGamePanel === 'hand') {
    dialog.scrollTop = panelScroll;
    if (focused === 'hand-view-back') document.getElementById(focused)?.focus({ preventScroll: true });
  } else if (openGamePanel === 'standings' && ['standings-reveal-toggle', 'standings-back'].includes(focused)) {
    const control = document.getElementById(focused) || dialog.querySelector('[data-close]');
    control?.focus({ preventScroll: true });
  }
}
function updatePresence() {
  if (!state) return;
  for (const badge of document.querySelectorAll('[data-presence-player]')) {
    const player = state.players.find(p => p.id === badge.dataset.presencePlayer);
    if (!player) continue;
    const value = player.bot ? 'bot' : connection !== 'connected' ? player.id === state.me ? 'reconnecting' : 'unknown' : player.presence;
    const { status, label } = presencePresentation(value);
    // A heartbeat changes these nodes only, preserving hand and chat focus.
    if (badge.textContent !== label) badge.textContent = label;
    badge.dataset.presence = status;
    badge.setAttribute('aria-label', `${player.name}: ${label}`);
    const seat = badge.closest('[data-player-seat]');
    if (seat) seat.dataset.playerPresence = status;
  }
}
function syncControls(fresh = false) {
  updateConnectionNotice();
  for (const button of document.querySelectorAll('[data-switch-table], [data-add-table], #table-entry-form button[type="submit"]')) button.disabled = busy || connection !== 'connected' || (button.hasAttribute('data-add-table') && tables.length >= tableLimit);
  if (!state) {
    return;
  }
  const blocked = busy || connection !== 'connected';
  app.querySelectorAll(commandSelector).forEach(button => {
    if (fresh || !button.dataset.legal) button.dataset.legal = button.disabled ? 'no' : 'yes';
    button.disabled = blocked || button.dataset.legal === 'no';
  });
  app.querySelectorAll('[data-card], [data-ungroup], [data-action="sort"], [data-action="group"]').forEach(button => {
    if (fresh || !button.dataset.legal) button.dataset.legal = button.disabled ? 'no' : 'yes';
    button.disabled = busy || button.dataset.legal === 'no';
  });
  updatePresence();
  app.setAttribute('aria-busy', String(busy));
  const indicator = document.querySelector('#connection');
  if (indicator) {
    indicator.textContent = connection === 'connected' ? '● Connected' : connection === 'syncing' ? '● Syncing' : '● Reconnecting';
    indicator.classList.toggle('offline', connection !== 'connected');
  }
  const arrange = document.querySelector('[data-panel-action="arrange"]');
  if (arrange) arrange.disabled = blocked;
  const dialogSend = document.querySelector('#dialog-chat-send');
  if (dialogSend) dialogSend.disabled = blocked || !chatDraft.trim();
  const counter = document.querySelector('#dialog-chat-count');
  if (counter) counter.textContent = `${chatDraft.length}/240`;
  const dialogStatus = document.querySelector('#dialog-chat-status');
  if (dialogStatus) dialogStatus.textContent = connection !== 'connected' ? 'Reconnecting. Your draft is kept until you can send.' : busy ? 'Sending your action…' : 'Only players at this table can read these messages.';
  const status = document.querySelector('#command-status');
  if (status) status.textContent = busy ? 'Sending your action…' : '';
}
function setConnection(next) { connection = next; syncControls(); }
async function action(actionName, extra = {}) {
  if (busy || !state || connection !== 'connected') return false;
  tableEpoch++; busy = true; syncControls();
  try {
    const result = await request('/api/action', { code: state.code, version: state.version, action: actionName, ...extra });
    if (actionName === 'arrange') {
      groups = result.groups.map(g => {
        const highAce = g.ids.some(id => state.hand.find(c => c.id === id)?.rank === 13);
        const rank = c => c.rank === 1 && highAce ? 14 : c.rank || 99;
        const ids = [...g.ids].sort((a, b) => rank(state.hand.find(c => c.id === a)) - rank(state.hand.find(c => c.id === b)));
        return { ...g, ids, title: g.type === 'pure' ? 'Pure sequence' : g.type === 'sequence' ? 'Sequence' : 'Set' };
      });
      saveGroups(); selected.clear(); renderRoom();
      toast(result.valid && state.hand.length === 13 ? 'Your 13 cards form a valid declaration.' : 'Grouped your hand. After drawing, select a final discard to declare.');
    } else if (result.left) {
      tableUi.delete(state.code); tables = tables.filter(t => t.code !== state.code); tablePicker();
    }
    else { if (['discard', 'declare'].includes(actionName)) selected.clear(); accept(result); saveGroups(); }
    return true;
  } catch (e) {
    if (!e.status || e.status >= 500) setConnection('reconnecting');
    if (actionName === 'declare' && e.status === 400) { declarationError = e.message; showGamePanel('declaration'); }
    toast(e.message, true); return false;
  }
  finally { busy = false; syncControls(); }
}
async function poll() {
  if ((!state && !tables.length) || polling || busy) return;
  polling = true; const code = state?.code, epoch = tableEpoch;
  if (connection !== 'connected') setConnection('syncing');
  try {
    const result = await request(`/api/tables${code ? `?code=${encodeURIComponent(code)}` : ''}`);
    if (busy || epoch !== tableEpoch || code !== state?.code) return;
    failures = 0; acceptTableList(result);
    if (result.active) accept(result.active);
    else if (state) { stashTableUi(); tableUi.delete(code); tablePicker(); toast('Your selected table closed. Choose another table.', true); }
    else if (!tables.length) tablePicker();
    setConnection('connected');
  } catch (e) {
    if (busy || epoch !== tableEpoch || code !== state?.code) return;
    if (++failures === 2) toast('Connection interrupted. Reconnecting automatically…', true);
    setConnection('reconnecting');
  } finally { polling = false; syncControls(); }
}
app.addEventListener('click', async event => {
  const target = event.target.closest('button'); if (!target || target.disabled) return;
  if (target.id === 'connection-retry') { if (!busy && !polling && connection !== 'connected') poll(); return; }
  if (target.dataset.panel) { showGamePanel(target.dataset.panel); return; }
  if (target.dataset.authMode) { if (authBusy) return; authMode = target.dataset.authMode; renderAuth(); return; }
  if (target.dataset.mode) { mode = target.dataset.mode; landing(); return; }
  if (target.dataset.card) {
    const id = target.dataset.card; selected.has(id) ? selected.delete(id) : selected.add(id);
    renderRoom(); document.querySelector(`[data-card="${CSS.escape(id)}"]`)?.focus(); return;
  }
  if (target.dataset.ungroup !== undefined) { groups.splice(Number(target.dataset.ungroup), 1); saveGroups(); renderRoom(); return; }
  if (target.dataset.remove) return action('removeBot', { playerId: target.dataset.remove });
  if (target.dataset.draw) return action('draw', { source: target.dataset.draw });
  switch (target.dataset.action) {
    case 'invite': {
      document.querySelector('#invite-url').value = `${location.origin}/?room=${state.code}`;
      document.querySelector('#invite-dialog').showModal(); break;
    }
    case 'rules': document.querySelector('#rules-dialog').showModal(); break;
    case 'tutorial': showTutorial(); break;
    case 'sort': {
      const sorted = [...state.hand].sort((a, b) => ['S', 'H', 'C', 'D', 'J'].indexOf(a.suit) - ['S', 'H', 'C', 'D', 'J'].indexOf(b.suit) || a.rank - b.rank);
      groups = [{ ids: sorted.map(c => c.id), title: 'Sorted by suit' }]; selected.clear(); saveGroups(); renderRoom(); break;
    }
    case 'group': {
      if (selected.size < 3) break;
      groups = groups.map(g => ({ ...g, title: 'Group', ids: g.ids.filter(id => !selected.has(id)) })).filter(g => g.ids.length);
      groups.push({ title: 'Your group', ids: [...selected] }); selected.clear(); saveGroups(); renderRoom(); break;
    }
    case 'drop': confirm('Sit this round out?', `You’ll take ${state.players.find(p => p.id === state.me).turns === 0 ? 20 : 40} points and rejoin the next deal.`, () => action('drop')); break;
    case 'leave':
      if (state.status === 'playing') toast('Leave after the round ends. You can drop to sit this round out.', true);
      else confirm('Leave the table?', 'Your seat will be released. If you’re the host, another friend takes over.', () => action('leave'));
      break;
    case 'declare': {
      const cardId = [...selected][0];
      confirm('Ready to show your hand?', 'Your selected card is the final discard. We’ll check the other 13 for two sequences, one pure, and valid groups throughout.', () => action('declare', { cardId })); break;
    }
    case 'discard': await action('discard', { cardId: [...selected][0] }); break;
    case 'start': case 'addBot': case 'arrange': await action(target.dataset.action); break;
  }
});
document.addEventListener('input', event => {
  if (['chat-input', 'dialog-chat-input'].includes(event.target.id)) {
    chatDraft = event.target.value;
    for (const input of document.querySelectorAll('#chat-input, #dialog-chat-input')) if (input !== event.target) input.value = chatDraft;
    syncControls();
  }
});
document.querySelector('#game-dialog').addEventListener('close', () => { openGamePanel = null; });
document.querySelector('#game-dialog').addEventListener('change', event => {
  const key = event.target.dataset.preference;
  if (!['roomyCards', 'quietMotion'].includes(key)) return;
  preferences[key] = event.target.checked; applyPreferences();
  try {
    localStorage.setItem('mr-preferences', JSON.stringify(preferences));
    preferenceSaveMessage = 'Saved on this browser.';
  } catch {
    preferenceSaveMessage = 'Applied for this visit. Browser storage is unavailable.';
    toast(preferenceSaveMessage);
  }
  const status = document.querySelector('#settings-save-status');
  if (status) status.textContent = preferenceSaveMessage;
});
document.querySelector('#game-dialog').addEventListener('click', event => {
  const target = event.target.closest('button');
  if (!target || target.disabled) return;
  if (['information', 'lastDeal', 'settings'].includes(target.dataset.settingsPanel)) {
    showGamePanel(target.dataset.settingsPanel, target.dataset.settingsPanel !== 'settings'); return;
  }
  if (target.dataset.chatMode) {
    const input = document.querySelector('#dialog-chat-input');
    const start = input.selectionStart, end = input.selectionEnd;
    chatComposerMode = target.dataset.chatMode; renderGamePanel();
    document.querySelector('#dialog-chat-input').setSelectionRange(start, end);
    document.querySelector('#chat-emoji-toggle').focus(); return;
  }
  if (target.dataset.chatReply !== undefined || target.dataset.chatEmoji !== undefined) {
    const text = target.dataset.chatReply !== undefined ? chatReplies[Number(target.dataset.chatReply)] : chatEmojis[Number(target.dataset.chatEmoji)]?.[0];
    if (text) insertChatText(text, target.dataset.chatReply !== undefined);
    return;
  }
  if (event.target.closest('[data-panel-action="arrange"]') && !busy && connection === 'connected') { document.querySelector('#game-dialog').close(); action('arrange'); }
});
document.querySelector('#game-dialog').addEventListener('submit', async event => {
  if (event.target.id !== 'dialog-chat-form') return;
  event.preventDefault(); await sendChat('dialog-chat-input');
});
function insertChatText(text, separate = false) {
  const input = document.querySelector('#dialog-chat-input');
  if (!input) return;
  const start = input.selectionStart, end = input.selectionEnd;
  const before = input.value.slice(0, start), after = input.value.slice(end);
  const insertion = `${separate && before && !/\s$/.test(before) ? ' ' : ''}${text}${separate && after && !/^\s/.test(after) ? ' ' : ''}`;
  if (input.value.length - (end - start) + insertion.length > input.maxLength) {
    toast('Messages can contain up to 240 characters.', true); input.focus(); return;
  }
  input.setRangeText(insertion, start, end, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true })); input.focus();
}
async function sendChat(inputId) {
  if (!chatDraft.trim() || busy || connection !== 'connected') return;
  const text = chatDraft; chatDraft = '';
  const sent = await action('chat', { text });
  if (!sent && !chatDraft) chatDraft = text;
  for (const input of document.querySelectorAll('#chat-input, #dialog-chat-input')) input.value = chatDraft;
  syncControls(); document.getElementById(inputId)?.focus();
}
app.addEventListener('submit', async event => {
  event.preventDefault();
  if (event.target.id === 'auth-form') {
    if (authBusy) return;
    const data = Object.fromEntries(new FormData(event.target));
    if (authMode === 'register' && data.password !== data.confirmPassword) { toast('Your passwords do not match.', true); return; }
    delete data.confirmPassword;
    tableEpoch++; authBusy = true; busy = true;
    const button = event.target.querySelector('[type="submit"]'); button.disabled = true;
    const text = button.textContent; button.textContent = authMode === 'register' ? 'Creating your profile…' : 'Signing you in…';
    try {
      session = await request(authMode === 'register' ? '/api/register' : '/api/login', data);
      setAccount(session.account); lastCode = ''; state = null; selected.clear(); groups = [];
      tables = []; tableUi.clear(); await restoreTables(); setConnection('connected');
      toast(authMode === 'register' ? 'Welcome! 10,000 play points are saved to your profile.' : 'Welcome back. Your profile and points are restored.');
    } catch (e) { toast(e.message, true); button.disabled = false; button.textContent = text; }
    finally { authBusy = false; busy = false; syncControls(); }
    return;
  }
  if (event.target.id === 'chat-form') {
    await sendChat('chat-input');
    return;
  }
  if (event.target.id !== 'entry-form' || busy) return;
  tableEpoch++; busy = true;
  const button = event.target.querySelector('[type="submit"]'); button.disabled = true; button.textContent = 'Setting your seat…';
  const data = Object.fromEntries(new FormData(event.target));
  try {
    const result = await request(mode === 'create' ? '/api/create' : '/api/join', data);
    localStorage.setItem('mr-name', data.name); history.replaceState({}, '', `/?room=${result.code}`); accept(result); setConnection('connected');
  } catch (e) { toast(e.message, true); button.disabled = false; button.textContent = mode === 'create' ? 'Create your table ↗' : 'Take your seat ↗'; }
  finally { busy = false; syncControls(); }
});
let tableEntryMode = 'create';
function setTableEntryMode(mode) {
  tableEntryMode = mode;
  document.querySelector('#new-table-code-row').hidden = mode !== 'join';
  document.querySelector('#new-table-code').required = mode === 'join';
  document.querySelector('#new-table-access-row').hidden = mode !== 'create';
  document.querySelector('#table-entry-submit').textContent = mode === 'create' ? 'Create table' : 'Join table';
  for (const button of document.querySelectorAll('[data-table-mode]')) button.setAttribute('aria-pressed', String(button.dataset.tableMode === mode));
}
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button || button.disabled) return;
  if (button.dataset.switchTable) { switchTable(button.dataset.switchTable); return; }
  if (button.hasAttribute('data-add-table') && !busy && connection === 'connected' && tables.length < tableLimit) {
    document.querySelector('#table-entry-form').reset(); setTableEntryMode('create');
    document.querySelector('#table-entry-error').textContent = '';
    document.querySelector('#tables-dialog').showModal();
  }
  if (button.dataset.tableMode) setTableEntryMode(button.dataset.tableMode);
});
document.querySelector('#table-entry-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || connection !== 'connected') return;
  const data = Object.fromEntries(new FormData(event.target));
  stashTableUi(); tableEpoch++; busy = true; syncControls();
  document.querySelector('#table-entry-error').textContent = '';
  try {
    const room = await request(tableEntryMode === 'create' ? '/api/create' : '/api/join', data);
    document.querySelector('#tables-dialog').close();
    accept(room); history.replaceState({}, '', `/?room=${room.code}`);
  } catch (e) {
    if (!e.status || e.status >= 500) setConnection('reconnecting');
    document.querySelector('#table-entry-error').textContent = e.message;
    toast(e.message, true);
  } finally { busy = false; syncControls(); }
});
document.querySelector('#tutorial-button').addEventListener('click', showTutorial);
document.querySelector('#tutorial-back').addEventListener('click', () => { tutorialIndex = Math.max(0, tutorialIndex - 1); renderTutorial(); document.querySelector('#tutorial-title').focus(); });
document.querySelector('#tutorial-next').addEventListener('click', () => {
  if (tutorialIndex < tutorialSteps.length - 1) { tutorialIndex++; renderTutorial(); document.querySelector('#tutorial-title').focus(); }
  else {
    try { localStorage.setItem('mr-tutorial-complete', 'true'); } catch { /* Completion is optional. */ }
    document.querySelector('#tutorial-dialog').close(); toast('Tutorial complete. You can revisit it from How to play.');
  }
});
document.querySelector('#rules-button').addEventListener('click', () => document.querySelector('#rules-dialog').showModal());
document.querySelector('#mobile-button').addEventListener('click', () => document.querySelector('#mobile-dialog').showModal());
document.querySelector('#profile-button').addEventListener('click', () => { if (account) loadProfile(); else landing(); });
document.querySelector('#profile-dialog').addEventListener('click', async event => {
  const target = event.target.closest('button'); if (!target || target.disabled) return;
  if (target.dataset.history !== undefined) return loadProfile(Number(target.dataset.history));
  if (target.id === 'sign-out') {
    if (busy || authBusy) return;
    tableEpoch++; busy = true; target.disabled = true;
    try {
      session = await request('/api/logout', { logout: true });
      document.querySelector('#profile-dialog').close(); state = null; lastCode = ''; selected.clear(); groups = []; chatDraft = ''; tables = []; tableUi.clear();
      history.replaceState({}, '', '/'); setAccount(null); authMode = 'login'; landing(); toast('Signed out. Your points are saved.');
    } catch (e) { toast(e.message, true); target.disabled = false; }
    finally { busy = false; }
  }
});
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
    if (!controls.length) { event.preventDefault(); return; }
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
  });
  const title = dialog.querySelector('h2');
  if (title) { title.id ||= `${dialog.id}-title`; dialog.setAttribute('aria-labelledby', title.id); }
  let opener;
  dialog.addEventListener('close', () => {
    if (document.querySelector('dialog[open]')) return;
    if (opener?.isConnected) opener.focus();
    else if (state) document.querySelector('[data-panel="' + (opener?.dataset.panel || 'hand') + '"]')?.focus();
  });
  dialog.addEventListener('beforetoggle', event => { if (event.newState === 'open') opener = document.activeElement; });
});
document.addEventListener('click', event => { const button = event.target.closest('[data-close]'); if (button) document.getElementById(button.dataset.close).close(); });
document.querySelector('#confirm-yes').addEventListener('click', () => { document.querySelector('#confirm-dialog').close(); confirmAction?.(); });
document.querySelector('#copy-invite').addEventListener('click', async () => {
  const input = document.querySelector('#invite-url');
  try { await navigator.clipboard.writeText(input.value); toast('Invite copied. Send it to your people.'); }
  catch { input.focus(); input.select(); toast('Select and copy this link to share it.'); }
});
async function boot() {
  app.setAttribute('aria-busy', 'true');
  try {
    session = await request('/api/session');
    setAccount(session.account || null);
    await restoreTables();
    setConnection('connected');
  } catch (e) { app.innerHTML = '<div class="boot-error"><h1>The table is taking a moment.</h1><p>Check your connection and reload to try again.</p><button class="button primary" id="retry">Try again</button></div>'; document.querySelector('#retry').onclick = boot; toast(e.message, true); }
  finally {
    document.body.classList.remove('is-booting');
    app.removeAttribute('aria-busy');
  }
}
setInterval(poll, 1200); setInterval(updateClock, 500);
document.addEventListener('visibilitychange', () => {
  if (!state && !tables.length) return;
  if (!document.hidden) setConnection('syncing');
  poll();
});
window.addEventListener('offline', () => setConnection('reconnecting'));
window.addEventListener('online', () => { if (state || tables.length) { setConnection('syncing'); poll(); } });
boot();
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* Live browser play remains available without installation support. */ });
}
