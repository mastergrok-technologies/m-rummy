import { handPanelMarkup } from './ui/panels/hand.js';
import { settingsPanelMarkup } from './ui/panels/settings.js';
import { informationPanelMarkup } from './ui/panels/information.js';
import { chatPanelMarkup } from './ui/panels/chat.js';
import { gameplayMarkup } from './ui/gameplay.js';
import { waitingRoomMarkup } from './ui/waiting-room.js';
import { profileMarkup } from './ui/profile.js';
import { accountFormMarkup } from './ui/account.js';
import { joinedTablesMarkup, tablePickerMarkup } from './ui/tables.js';
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
  document.querySelector('.entry-card').innerHTML = accountFormMarkup(authMode === 'register');
}
async function loadProfile(offset = 0) {
  try {
    const profile = await request(`/api/profile?offset=${offset}`); profileOffset = offset; setAccount(profile);
    const dialog = document.querySelector('#profile-dialog');
    document.querySelector('#profile-content').innerHTML = profileMarkup(profile, offset, esc, number);
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
  return `<section id="connection-banner" class="connection-banner connection-notice" role="status" aria-live="polite" aria-atomic="true" hidden><div class="connection-notice-heading"><img src="/assets/figma/connection-lost.svg" alt="" width="86" height="86"><div><span class="connection-kicker">NETWORK STATUS · TABLE PROTECTED</span><h2 id="connection-title">Connection interrupted</h2><p id="connection-detail"></p></div></div><div class="connection-notice-footer"><span class="connection-progress"><img src="/assets/figma/connection-loading.svg" alt="" width="56" height="56"><span id="connection-progress">Connecting…</span></span><button type="button" class="button" id="connection-retry">Reconnect now</button></div></section>`;
}
function updateConnectionNotice() {
  const notice = document.querySelector('#connection-banner');
  if (!notice) return;
  const returningFocus = document.activeElement?.id === 'connection-retry';
  notice.setAttribute('aria-busy', connection === 'syncing' ? 'true' : 'false');
  notice.hidden = connection === 'connected';
  if (notice.hidden) {
    if (returningFocus) (document.querySelector('#connection') || document.querySelector('[data-switch-table]'))?.focus();
    return;
  }
  notice.dataset.connection = connection;
  const texts = {
    'connection-title': connection === 'syncing' ? 'Refreshing your table' : 'Internet connection lost',
    'connection-detail': state ? 'Reconnecting automatically. Your hand and groups stay here. Server timers keep running; game actions resume after the table is refreshed.' : 'Reconnecting to your tables automatically. Server timers keep running; no game actions will be replayed.',
    'connection-progress': connection === 'syncing' ? 'Verifying the latest table snapshot…' : 'Waiting for network · retrying automatically…',
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
  const focused = document.activeElement;
  const focusKey = focused?.dataset.remove || focused?.dataset.action;
  const cursor = focused?.selectionStart;
  app.className = 'room-page waiting-page';
  app.innerHTML = waitingRoomMarkup(state, chatDraft, roomChrome(), esc, seatAvatar);
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
  app.innerHTML = gameplayMarkup(state, groups, selected, chatDraft, roomChrome(), { esc, number, card, seatAvatar, turnText, ranks });
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
  const markup = joinedTablesMarkup(tables, state?.code, tableLimit, esc);
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
  app.innerHTML = tablePickerMarkup(tables.length, tableLimit, connectionNotice());
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
  document.querySelector('#tutorial-dialog').dataset.step = String(tutorialIndex + 1);
  document.querySelector('#tutorial-content').innerHTML = `${tutorialIndex === 5 ? '<section class="tutorial-declare-intro" aria-label="Declaration checklist"><span class="tutorial-declare-kicker">FINAL STEP · DECLARE WITH CONFIDENCE</span><strong>Your declaration checklist</strong><ol><li>Draw one card and choose your final discard.</li><li>Arrange the remaining 13 cards into valid groups.</li><li>Include at least two sequences, with one pure sequence.</li><li>Submit your declaration for server validation.</li></ol><p>An invalid declaration leaves your hand and turn open without a penalty.</p></section>' : ''}${tutorialIndex === 4 ? '<section class="tutorial-scoring-intro" aria-label="Penalty scoring example"><span class="tutorial-scoring-kicker">RULE 04 · COUNT UNMATCHED CARDS</span><strong>King + Queen + Five = 25 points</strong><div class="tutorial-scoring-breakdown"><span><b>10</b><small>King</small></span><span aria-hidden="true">+</span><span><b>10</b><small>Queen</small></span><span aria-hidden="true">+</span><span><b>5</b><small>Five</small></span><span aria-hidden="true">=</span><span class="tutorial-scoring-total"><b>25</b><small>Penalty points</small></span></div><p>Aces and face cards count 10, number cards count their rank, and jokers count 0. Round penalties are capped at 80.</p></section>' : ''}${tutorialIndex === 3 ? '<section class="tutorial-set-intro" aria-label="Valid set rule"><span class="tutorial-set-kicker">RULE 03 · COMPLETE A SET</span><strong>Same rank. Different suits.</strong><span>9♥ + 9♠ + 9♣ = valid set</span><p>A set has three or four cards. Repeating the same suit does not make a valid set, even with two decks.</p></section>' : ''}${tutorialIndex === 2 ? '<section class="tutorial-joker-intro" aria-label="Impure sequence rule"><span class="tutorial-joker-kicker">RULE 02 · JOKER AS A SUBSTITUTE</span><strong>Use a joker to complete a sequence.</strong><span>7♠ → 8♠ → Joker (as 9♠)</span><p>Unlike a pure sequence, this example uses a printed joker to fill the missing rank.</p></section>' : ''}${tutorialIndex === 1 ? '<section class="tutorial-pure-intro" aria-label="Pure sequence rule"><span class="tutorial-pure-kicker">RULE 01 · REQUIRED FOR A VALID DECLARATION</span><strong>Same suit. Consecutive ranks. No substitute joker.</strong><span>Example: 3♥ → 4♥ → 5♥</span></section>' : ''}${tutorialIndex === 0 ? '<div class="tutorial-welcome" aria-label="How a turn works"><span class="tutorial-welcome-label">YOUR FIRST HAND</span><div class="tutorial-welcome-flow"><span><strong>13</strong><small>Start with cards</small></span><span class="tutorial-flow-arrow" aria-hidden="true">→</span><span><strong>+1</strong><small>Draw a card</small></span><span class="tutorial-flow-arrow" aria-hidden="true">→</span><span><strong>−1</strong><small>Discard a card</small></span></div></div>' : ''}<p>${esc(step.text)}</p>${step.cards.length ? `<div class="tutorial-cards cards${tutorialIndex === 1 ? ' tutorial-pure-cards' : tutorialIndex === 2 ? ' tutorial-joker-cards' : tutorialIndex === 3 ? ' tutorial-set-cards' : tutorialIndex === 4 ? ' tutorial-scoring-cards' : ''}" aria-label="Example cards">${step.cards.map((c, i) => card({ ...c, id: `tutorial-${tutorialIndex}-${i}` }, false, false, null)).join('')}</div>` : ''}<p class="tutorial-note">${esc(step.note)}</p>`;
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
  const titles = { chat: 'Table talk', hand: 'Your cards', standings: 'Table standings', information: 'Game information', settings: 'Your display settings', lastDeal: 'Last completed deal', declaration: 'Declaration · Try again', bestDeclaration: 'Best Possible Declaration' };
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
    content.innerHTML = chatPanelMarkup(state, chatDraft, chatComposerMode, busy, connection, { esc, chatEmojis, chatReplies });
    const messages = content.querySelector('.messages');
    messages.scrollTop = nearBottom ? messages.scrollHeight : scroll;
  } else if (openGamePanel === 'hand') {
    content.innerHTML = handPanelMarkup(state, groups, { esc, number, card, ranks });
  } else if (openGamePanel === 'standings') {
    const standings = tableStandings(state.players);
    const result = state.status === 'finished' ? state.result : null;
    const roundScores = new Map((result?.scores || []).map(p => [p.id, p]));
    const revealedOpen = content.querySelector('.standings-revealed')?.open || false;
    content.innerHTML = `<div class="standings-summary"><span>ROOM <strong>${esc(state.code)}</strong></span><span>${state.players.length} players · Free play</span></div><p class="standings-explainer">Current table only. Lower cumulative penalty points rank higher. Tied scores share a place. Profile play points are separate.</p><div class="score-table-wrap standings-table-wrap" role="region" aria-label="Table standings and penalties" tabindex="0"><table class="score-table standings-table"><caption class="sr-only">Cumulative table penalties</caption><thead><tr><th scope="col">Place</th><th scope="col">Player</th><th scope="col">This round</th><th scope="col">Total penalty ↓</th></tr></thead><tbody>${standings.map(p => {
      const shared = standings.filter(other => other.place === p.place).length > 1;
      const roundScore = roundScores.get(p.id);
      return `<tr data-standing-player="${esc(p.id)}" class="${p.id === state.me ? 'standing-self' : ''} ${p.place <= 3 ? `standing-top standing-top-${p.place}` : ''}" ${p.id === state.me ? 'aria-current="true"' : ''}><td class="standing-place"><span class="standing-rank-badge" aria-label="${shared ? 'Joint rank' : 'Rank'} ${p.place}">${p.place}</span>${shared ? '<small>Tied</small>' : ''}</td><th scope="row"><div class="standing-player"><span class="standing-avatar" aria-hidden="true">${seatAvatar(p)}</span><span class="standing-player-text"><strong>${esc(p.name)}</strong><span class="standing-labels">${p.id === state.me ? '<span>You</span>' : ''}${p.bot ? '<span>Practice bot</span>' : ''}${result?.winner === p.id ? '<span class="standing-winner">Round winner</span>' : p.dropped ? '<span>Dropped</span>' : ''}</span></span></div></th><td class="standing-round">${roundScore ? number(roundScore.penalty) : '<span aria-label="Not settled">—</span>'}</td><td class="standing-total">${number(p.total)}</td></tr>`;
    }).join('')}</tbody></table></div>${result ? `<details class="standings-revealed" ${revealedOpen ? 'open' : ''}><summary id="standings-reveal-toggle">View revealed round hands</summary><p>These hands were revealed by the server after the round ended.</p><div class="inspect-hand">${result.scores.map(p => `<section><h3>${esc(p.name)}</h3><div class="cards">${p.hand.map(c => card(c)).join('')}</div></section>`).join('')}</div></details>` : '<p class="standings-privacy">Round penalties and opponents’ cards are shown only after the round ends.</p>'}<div class="standings-footer"><div><strong>${state.status === 'finished' ? `Round ${number(state.round)} complete` : state.status === 'lobby' ? 'Waiting for the first deal' : `Round ${number(state.round)} in progress`}</strong><span>${state.round && state.wildRank ? `Wild rank: ${esc(ranks[state.wildRank] || state.wildRank)}` : 'Wild rank is set when the round starts.'}</span></div><button type="button" class="button" id="standings-back" data-close="game-dialog">Back to table</button></div>`;
  } else if (openGamePanel === 'information') {
    content.innerHTML = informationPanelMarkup(state, { esc, number });
  } else if (openGamePanel === 'settings') {
    content.innerHTML = settingsPanelMarkup(state, hasLastDeal, preferences, preferenceSaveMessage, { esc });
  } else if (openGamePanel === 'lastDeal') {
    content.innerHTML = hasLastDeal ? `<p class="last-deal-summary" aria-label="Last completed round summary">Round ${number(lastDeal.round)}<strong>${esc(lastDeal.winner)} won</strong></p><div class="score-table-wrap"><table class="score-table"><caption class="sr-only">Last completed round penalties</caption><thead><tr><th scope="col">Player</th><th scope="col">Round penalty</th><th scope="col">Total penalty</th></tr></thead><tbody>${lastDeal.scores.map(p => `<tr><th scope="row">${esc(p.name)}</th><td>${number(p.penalty)}</td><td>${number(p.total)}</td></tr>`).join('')}</tbody></table></div><p class="last-deal-note">These are the server-recorded results of the last completed round at this table.</p>` : '<p class="last-deal-note">No completed round is available yet.</p>';
  } else if (openGamePanel === 'bestDeclaration') {
    content.innerHTML = `<section class="best-declaration-panel" aria-labelledby="best-declaration-heading"><span class="best-declaration-emblem" aria-hidden="true">♣</span><h3 id="best-declaration-heading">Build your strongest valid hand</h3><p>This is a grouping guide, not a guaranteed winning declaration. Your cards are checked by the server only when you choose Declare.</p><ol><li>Make at least two sequences.</li><li>Include at least one pure sequence.</li><li>Use valid sets or sequences for every remaining card.</li><li>When holding 14 cards, choose an eligible final discard.</li></ol><p class="best-declaration-note">Auto-group suggests an arrangement but does not submit a declaration or stop your turn timer.</p><div class="button-row"><button type="button" class="button primary" data-panel-action="arrange" ${busy || connection !== 'connected' ? 'disabled' : ''}>Auto-group my cards</button><button type="button" class="button secondary" data-panel="declaration">Back to retry</button></div></section>`;
  } else if (openGamePanel === 'declaration') {
    content.innerHTML = `<section class="invalid-declaration-state" role="alert" aria-labelledby="declaration-error-heading"><span class="invalid-declaration-icon" aria-hidden="true">!</span><div><span class="eyebrow">DECLARATION NOT ACCEPTED</span><h3 id="declaration-error-heading">Your cards need another look</h3><p class="declaration-feedback">${esc(declarationError)}</p></div></section><div class="declaration-retry-guidance"><h4>Prepare your best possible declaration</h4><p>Check for two sequences, including at least one pure sequence, and valid groups covering your remaining 13 cards.</p><p><strong>Your turn is still active.</strong> No declaration penalty was applied; the server timer continues.</p></div><div class="button-row declaration-retry-actions"><button class="button primary" data-close="game-dialog">Review cards &amp; retry</button><button class="button secondary" data-panel-action="arrange" ${busy || connection !== 'connected' ? 'disabled' : ''}>Auto-group</button><button type="button" class="button secondary" data-panel="bestDeclaration">Best possible declaration guide</button></div>`;
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
  if (counter) { counter.textContent = `${chatDraft.length}/240`; counter.classList.toggle('chat-count-warning', chatDraft.length >= 220); }
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
