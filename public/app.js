import { accountPageMarkup } from './ui/account-pages.js';
import { avatarSource } from './ui/avatars.js';
import { homeMarkup, homeTablesMarkup, homeAttentionMarkup } from './ui/home.js';
import { lastDealPanelMarkup } from './ui/panels/last-deal.js';
import { bestDeclarationPanelMarkup, declarationPanelMarkup, declarationStatus } from './ui/panels/declaration.js';
import { standingsPanelMarkup } from './ui/panels/standings.js';
import { handPanelMarkup } from './ui/panels/hand.js';
import { settingsPanelMarkup } from './ui/panels/settings.js';
import { informationPanelMarkup } from './ui/panels/information.js';
import { chatPanelMarkup } from './ui/panels/chat.js';
import { gameplayMarkup } from './ui/gameplay.js';
import { waitingRoomMarkup } from './ui/waiting-room.js';
import { profileMarkup } from './ui/profile.js';
import { setupSummary, inviteMarkup, confirmationIntent, confirmationProblem, confirmationDetails } from './ui/table-flows.js';
import { inviteCode } from './ui/invite.js';
import { accountFormMarkup, accountValidation } from './ui/account.js';
import { joinedTablesMarkup, tablePickerMarkup } from './ui/tables.js';
import { tutorialTopicsMarkup, tutorialPracticeMarkup } from './ui/tutorial.js';
import { tutorialSteps } from './tutorial.js';
import { remainingSeconds, reconcileGroups, tableStandings, presencePresentation, handIdentity, arrangementSnapshot, gameplayGuidance, recentChatState } from './board-state.js';
const app = document.querySelector('#app');
const suits = { S: '♠', H: '♥', D: '♦', C: '♣', J: '✦' };
const ranks = { 0: 'JK', 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
let session, state, busy = false, polling = false, failures = 0, mode = 'create', groups = [], selected = new Set(), chatDraft = '', clockOffset = 0;
let confirmIntent = null, inviteEpoch = 0;
let lastCode = '', confirmAction, arrangementUndo = null;
let connection = 'connected';
let tables = [], tableLimit = 3, tableEpoch = 0, homeTab = 'points', homeFilter = 'all', pendingHomeInvite = '';
const tableUi = new Map(), turnWarnings = new Map(), chatAttention = new Map();
const presenceClient = [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join('');
let presenceSequence = 0;
let openGamePanel = null, declarationError = '', chatComposerMode = 'replies';
const chatReplies = ['Hello everyone!', 'Good luck!', 'Nice hand!', 'Well played!', 'Thanks!', 'One moment, please.'];
const chatEmojis = [['😀', 'Grinning face'], ['😄', 'Smiling face'], ['😂', 'Laughing with tears'], ['🙂', 'Slight smile'], ['👍', 'Thumbs up'], ['👏', 'Applause'], ['🎉', 'Celebration'], ['❤️', 'Heart']];
let tutorialIndex = 0, lastDealRound = null;
const tutorialAnswers = new Map();
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
const authIdentity = { name: '', username: '' };
let authMode = 'register', account = null, profileOffset = 0, authBusy = false;
let profileFilter = 'all', profileBusy = false, profileEpoch = 0, profileData = null;
let accountPage = null, accountPageEpoch = 0, feedbackDraft = { category: 'idea', message: '', id: null };
const feedbackKey = () => `mr-feedback-${account?.id || ''}`;
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
  const sameHand = state && next.code === state.code && next.round === state.round && handIdentity(next.hand) === handIdentity(state.hand);
  if (!state || next.code !== state.code || next.round !== state.round) {
    try { groups = JSON.parse(sessionStorage.getItem(groupKey(next)) || '[]'); } catch { groups = []; }
    const saved = tableUi.get(next.code);
    selected = new Set(saved?.round === next.round ? saved.selected : []);
    chatDraft = saved?.chatDraft || ''; lastCode = next.code;
    arrangementUndo = saved?.round === next.round && saved.handKey === handIdentity(next.hand) ? saved.undo : null;
  }
  else if (!sameHand) arrangementUndo = null;
  chatAttention.set(next.code, recentChatState(chatAttention.get(next.code), next.messages, next.me, state?.code === next.code && chatIsRead()));
  state = next; rememberTable(next); clockOffset = next.serverTime - Date.now();
  setAccount(next.account || null);
  selected = new Set([...selected].filter(id => next.hand.some(c => c.id === id)));
  groups = reconcileGroups(groups, next.hand);
  if (changed) renderRoom();
  updateClock(); renderTableSwitcher(); syncControls(); if (changed) renderGamePanel();
}
function landing() {
  if (account) {
    const invite = new URLSearchParams(location.search).get('room') || '';
    if (/^[a-fA-F0-9]{12}$/.test(invite) && !tables.some(t => t.code === invite.toUpperCase())) pendingHomeInvite = invite;
    showHome('points');
    return;
  }
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
function showHome(tab = homeTab) {
  if (!account) return;
  stashTableUi(); tableEpoch++;
  state = null; selected.clear(); groups = []; chatDraft = ''; homeTab = tab;
  document.querySelector('#game-dialog').close();
  history.replaceState({}, '', '/'); app.className = 'home-page';
  app.innerHTML = homeMarkup(account, tables, tableLimit, homeTab, esc, number, homeFilter) + connectionNotice();
  refreshHomeTables(); syncControls();
}
function refreshHomeTables() {
  const root = document.querySelector('#home-table-list');
  if (!root) return;
  const markup = homeTablesMarkup(tables, esc, homeTab === 'joined' ? homeFilter : 'all');
  const attention = document.querySelector('#home-turn-attention');
  if (attention) {
    const html = homeAttentionMarkup(tables, esc);
    if (attention.innerHTML !== html) attention.innerHTML = html;
  }
  for (const button of document.querySelectorAll('.home-filters [data-home-filter]')) button.setAttribute('aria-current', button.dataset.homeFilter === homeFilter ? 'page' : 'false');
  if (root.dataset.markup !== markup) {
    const focusedCode = document.activeElement?.dataset.switchTable;
    root.innerHTML = markup; root.dataset.markup = markup;
    if (focusedCode) (root.querySelector(`[data-switch-table="${CSS.escape(focusedCode)}"]`) || document.querySelector('[data-home-tab="joined"]'))?.focus();
  }
  const count = document.querySelector('.home-section-heading>span');
  if (count) count.textContent = `${tables.length} / ${tableLimit} joined`;
  const badge = document.querySelector('[data-home-tab="joined"] span');
  if (badge) badge.textContent = tables.length;
  document.querySelector('#home-limit-note').hidden = tables.length < tableLimit;
  updateTableClocks();
}
function openTableEntry(entryMode = 'create', code = '') {
  if (busy || connection !== 'connected' || !account || tables.length >= tableLimit) return;
  document.querySelector('#table-entry-form').reset(); setTableEntryMode(entryMode);
  document.querySelector('#new-table-code').value = code.toUpperCase();
  document.querySelector('#table-entry-error').textContent = '';
  document.querySelector('#new-table-code').removeAttribute('aria-invalid');
  updateInvitePreview();
  document.querySelector('#new-table-password').type = 'password';
  document.querySelector('#table-password-toggle').textContent = 'Show password'; document.querySelector('#table-password-toggle').setAttribute('aria-pressed','false');
  document.querySelector('#tables-dialog').showModal();
  document.querySelector(entryMode === 'join' ? '#new-table-code' : '#new-table-password').focus();
}
function setAccount(next) {
  account = next;
  const button = document.querySelector('#profile-button');
  button.hidden = !account && !state;
  if (!account) button.textContent = 'Create your profile';
  if (account) button.innerHTML = `<span class="profile-initial">${avatarSource(account.avatar) ? `<img src="${avatarSource(account.avatar)}" alt="" width="32" height="32">` : esc(account.name.slice(0, 1).toUpperCase())}</span><span><small>Your profile</small><strong>${number(account.points)} pts</strong></span>`;
}
function renderAuth() {
  document.querySelector('.entry-card').innerHTML = accountFormMarkup(authMode === 'register');
  for (const key of ['name','username']) { const input = document.querySelector(`#account-${key}`); if (input) input.value = authIdentity[key]; }
  syncAuthControls();
}
function syncAuthControls() {
  const form = document.querySelector('#auth-form'); if (!form) return;
  form.setAttribute('aria-busy', String(authBusy));
  for (const control of document.querySelectorAll('#auth-form input, #auth-form button, [data-auth-mode]')) control.disabled = authBusy;
}
function authError(message, field) {
  const status = document.querySelector('#auth-error'); if (!status) return;
  status.textContent = message;
  const input = field && document.getElementById(field);
  if (input) { input.setAttribute('aria-invalid','true'); input.focus(); }
  else status.focus();
}
function changeAuthMode(next) {
  if (authBusy || !['register','login'].includes(next) || next === authMode) return;
  for (const key of ['name','username']) { const input = document.querySelector(`#account-${key}`); if (input) authIdentity[key] = input.value; }
  authMode = next; renderAuth(); document.querySelector(`[data-auth-mode="${next}"]`).focus();
}
function syncProfileControls() {
  const root = document.querySelector('#profile-content');
  root.setAttribute('aria-busy', String(profileBusy));
  for (const control of root.querySelectorAll('button,input')) {
    control.dataset.profileLegal ??= control.disabled ? 'no' : 'yes';
    control.disabled = profileBusy || busy || control.dataset.profileLegal === 'no' || (control.matches('#avatar-form button[type="submit"]') && connection !== 'connected');
  }
}
async function loadProfile(offset = 0, filter = profileFilter) {
  if (!account || profileBusy || busy) return;
  const epoch = ++profileEpoch;
  const dialog = document.querySelector('#profile-dialog'), root = document.querySelector('#profile-content');
  const focus = document.activeElement;
  const focusFilter = focus?.dataset.historyFilter, focusPage = focus?.dataset.profilePage;
  if (!dialog.open) {
    root.innerHTML = '<p role="status">Loading your account…</p>';
    dialog.showModal();
  }
  profileBusy = true; syncProfileControls();
  try {
    const profile = await request(`/api/profile?offset=${offset}&filter=${encodeURIComponent(filter)}`);
    if (epoch !== profileEpoch || !dialog.open || !account) return;
    profileData = profile; profileOffset = offset; profileFilter = filter; setAccount(profile);
    root.innerHTML = profileMarkup(profile, offset, esc, number, filter);
    if (focusFilter) root.querySelector(`[data-history-filter="${CSS.escape(focusFilter)}"]`)?.focus();
    else if (focusPage) root.querySelector(`[data-profile-page="${CSS.escape(focusPage)}"]`)?.focus();
  } catch (e) {
    if (epoch !== profileEpoch || !dialog.open) return;
    if (!profileData) root.innerHTML = `<p role="alert">${esc(e.message)}</p><button type="button" class="button secondary" data-profile-retry>Try again</button>`;
    toast(e.message, true);
  } finally {
    if (epoch === profileEpoch) { profileBusy = false; syncProfileControls(); }
  }
}
function confirm(title, text, action, kind, cardId) {
  document.querySelector('#confirm-title').textContent = title;
  document.querySelector('#confirm-text').textContent = text;
  confirmAction = action; confirmIntent = confirmationIntent(state,kind,cardId);
  document.querySelector('#confirm-details').innerHTML = confirmationDetails(state,kind,cardId,esc);
  document.querySelector('#confirm-yes').textContent = kind === 'drop' ? 'Drop this round' : kind === 'leave' ? 'Leave table' : 'Submit declaration';
  document.querySelector('#confirm-dialog').showModal(); syncFlowControls();
}
function syncFlowControls() {
  if (document.querySelector('#confirm-dialog').open) {
    const problem = confirmationProblem(confirmIntent,state);
    const status = problem || (connection !== 'connected' ? 'Refreshing your table. Wait for a fresh snapshot before confirming.' : busy ? 'Wait for the current action to finish.' : '');
    const output = document.querySelector('#confirm-status'); if (output.textContent !== status) output.textContent = status;
    document.querySelector('#confirm-yes').disabled = !!status;
  }
  if (document.querySelector('#invite-dialog').open && (!state || state.code !== document.querySelector('#invite-room-code').textContent)) {
    document.querySelector('#invite-status').textContent = 'This table is no longer selected. Close the invite and check your joined tables.';
    for (const copy of document.querySelectorAll('.invite-copy-actions button')) copy.disabled = true;
  } else if (document.querySelector('#invite-dialog').open && state) {
    document.querySelector('#invite-seat-summary').textContent = state.players.length >= 6 ? '6 / 6 seated · Table full' : `${6-state.players.length} open ${state.players.length===5?'seat':'seats'}`;
    document.querySelector('#invite-access-note').textContent = state.hasPassword ? 'Password protected. Send the room password separately; it is never included in this link.' : 'No room password. Share this private link only with people you want to invite.';
  }
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
  <div id="table-switcher"></div><nav class="board-toolbar" aria-label="Table tools"><button type="button" class="button secondary small" data-home>Home</button><button class="button secondary small" data-action="tutorial">Learn rummy</button><button class="button secondary small" data-panel="chat" aria-label="Chat" aria-describedby="chat-unread-description">Chat <span id="chat-unread-count" class="chat-unread-count" aria-hidden="true" hidden></span></button><span id="chat-unread-description" class="sr-only" role="status" aria-live="polite"></span><button class="button secondary small" data-panel="hand" ${!state.hand.length ? 'disabled' : ''}>View cards</button><button class="button secondary small" data-panel="standings">Standings</button><button class="button secondary small" data-panel="information">Table info</button><button class="button secondary small" data-panel="settings">Settings</button></nav>
  ${connectionNotice()}<div id="command-status" class="sr-only" role="status"></div>
`;
}
// Use each player's stable seat index across waiting and active boards.
function seatAvatar(player) {
  const i = state.players.findIndex(p => p.id === player.id);
  return player.bot ? '<span aria-hidden="true">✦</span>' : `<img data-avatar-player="${esc(player.id)}" src="${avatarSource(player.avatar) || `/assets/figma/avatar-${i + 1}.${[1, 2, 3].includes(i) ? 'svg' : 'png'}`}" alt="" width="96" height="96">`;
}
function sidebarChatPosition() {
  const messages = document.querySelector('#messages');
  return messages ? { code: messages.dataset.table, top: messages.scrollTop, follow: messages.scrollHeight - messages.clientHeight - messages.scrollTop <= 24 } : null;
}
function restoreSidebarChat(position) {
  const messages = document.querySelector('#messages'); if (!messages) return;
  messages.dataset.table = state.code;
  messages.scrollTop = position?.code === state.code && !position.follow ? position.top : messages.scrollHeight;
}
function chatIsRead() {
  if (document.hidden) return false;
  const dialog = document.querySelector('#game-dialog');
  const inChat = dialog.open && openGamePanel === 'chat';
  if (!inChat && document.querySelector('dialog[open]')) return false;
  const messages = document.querySelector(inChat ? '#dialog-messages' : '#messages');
  if (!messages || messages.scrollHeight - messages.clientHeight - messages.scrollTop > 24) return false;
  const box = messages.getBoundingClientRect();
  return inChat || (box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth);
}
function markChatRead() {
  const entry = state && chatAttention.get(state.code); if (entry) entry.unread = [];
}
function syncChatIndicators() {
  if (!state) return;
  if (chatIsRead()) markChatRead();
  const count = chatAttention.get(state.code)?.unread.length || 0;
  const badge = document.querySelector('#chat-unread-count');
  if (badge) { badge.hidden = count === 0; badge.textContent = String(count); }
  const description = document.querySelector('#chat-unread-description'), text = count ? `${count} new messages at this table.` : 'No new messages at this table.';
  if (description && description.textContent !== text) description.textContent = text;
  for (const [listId,buttonId] of [['messages','sidebar-chat-latest'],['dialog-messages','dialog-chat-latest']]) {
    const list = document.getElementById(listId), button = document.getElementById(buttonId);
    if (!list || !button) continue;
    button.hidden = list.scrollHeight - list.clientHeight - list.scrollTop <= 24;
    button.textContent = count ? `Latest messages (${count} new) ↓` : 'Latest messages ↓';
  }
}
document.addEventListener('scroll', event => {
  if (['messages','dialog-messages'].includes(event.target.id)) syncChatIndicators();
}, true);
function renderWaitingRoom() {
  const focused = document.activeElement;
  const focusKey = focused?.dataset.remove || focused?.dataset.action;
  const cursor = focused?.selectionStart, cursorEnd = focused?.selectionEnd, chatPosition = sidebarChatPosition(), pageY = scrollY;
  app.className = 'room-page waiting-page';
  app.innerHTML = waitingRoomMarkup(state, chatDraft, roomChrome(), esc, seatAvatar);
  restoreSidebarChat(chatPosition);
  if (focused?.id === 'chat-input') { const input = document.querySelector('#chat-input'); input.focus({preventScroll:true}); input.setSelectionRange(cursor, cursorEnd ?? cursor); }
  else if (focused?.id === 'messages') document.querySelector('#messages').focus({preventScroll:true});
  else if (focusKey) [...app.querySelectorAll('[data-remove], [data-action]')].find(el => (el.dataset.remove || el.dataset.action) === focusKey && !el.disabled)?.focus();
  if (chatPosition?.code === state.code && ['messages','chat-input'].includes(focused?.id)) window.scrollTo(0,pageY);
  renderTableSwitcher(); syncControls(true);
}
function renderRoom() {
  if (state.status === 'lobby') { renderWaitingRoom(); return; }
  const focused = document.activeElement;
  const focus = focused?.id, focusedCard = focused?.dataset.card, focusedAction = focused?.dataset.action;
  const selectionStart = focused?.selectionStart, selectionEnd = focused?.selectionEnd;
  const sameView = app.dataset.gameView === `${state.code}:${state.round}`;
  const handScroll = sameView ? document.querySelector('.hand-scroll')?.scrollLeft || 0 : 0;
  const pageY = window.scrollY, focusInApp = app.contains(focused);
  const handFocused = focused?.classList.contains('hand-scroll');
  const chatPosition = sidebarChatPosition();
  app.className = `room-page ${state.status === 'playing' ? 'gameplay-page' : ''}`;
  app.innerHTML = gameplayMarkup(state, groups, selected, chatDraft, roomChrome(), { esc, number, card, seatAvatar, turnText, ranks, canUndo: !!arrangementUndo });
  restoreSidebarChat(chatPosition);
  app.dataset.gameView = `${state.code}:${state.round}`;
  if (sameView && focusInApp) {
    const target = focusedCard ? app.querySelector(`[data-card="${CSS.escape(focusedCard)}"]`) : focusedAction ? app.querySelector(`[data-action="${CSS.escape(focusedAction)}"]`) : handFocused ? app.querySelector('.hand-scroll') : focus ? document.getElementById(focus) : null;
    (target && !target.disabled ? target : document.querySelector('#player-hand-title'))?.focus({ preventScroll: true });
    if (focus === 'chat-input') document.querySelector('#chat-input').setSelectionRange(selectionStart, selectionEnd ?? selectionStart);
    window.scrollTo(0, pageY);
  }
  const hand = document.querySelector('.hand-scroll'); if (hand) hand.scrollLeft = handScroll;
  renderTableSwitcher(); updateClock(); syncControls(true);
}
function updateClock() {
  updateTableClocks();
  if (!state) return;
  for (const clock of document.querySelectorAll('[data-declaration-clock]')) clock.textContent = `${remainingSeconds(state.deadline, clockOffset)}s left on your turn`;
  const el = document.querySelector('#turn-clock'); if (!el || !state) return;
  const seconds = remainingSeconds(state.deadline, clockOffset);
  el.textContent = `${seconds}s`; el.classList.toggle('urgent', seconds <= 15);
  const timing = document.querySelector('#hand-turn-timing');
  if (timing && !timing.hidden) {
    document.querySelector('#hand-turn-clock').textContent = seconds ? `${seconds}s left to play` : 'Waiting for the table update…';
    document.querySelector('#turn-progress').value = Math.min(60, seconds);
    timing.classList.toggle('urgent', seconds <= 15);
    const key = `${state.code}:${state.round}:${state.deadline}`;
    if (seconds <= 10 && turnWarnings.get(state.code) !== key) {
      turnWarnings.set(state.code, key); const live = document.querySelector('#turn-live');
      if (live) live.textContent = seconds ? `Your turn has ${seconds} seconds remaining.` : 'Your turn time has elapsed. Waiting for a fresh table update.';
    }
  }
}
function stashTableUi() {
  if (!state) return;
  saveGroups(); tableUi.set(state.code, { round: state.round, selected: [...selected], chatDraft, handKey: handIdentity(state.hand), undo: arrangementUndo });
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
  for (const progress of document.querySelectorAll('[data-table-progress]')) {
    const table = tables.find(t => t.code === progress.dataset.tableProgress);
    progress.hidden = !table || table.status !== 'playing' || !table.yourTurn;
    if (table) progress.value = Math.min(60, remainingSeconds(table.deadline, clockOffset));
  }
  for (const label of document.querySelectorAll('[data-table-clock]')) {
    const table = tables.find(t => t.code === label.dataset.tableClock);
    if (!table) continue;
    label.textContent = table.status === 'lobby' ? `Waiting · ${table.playerCount}/6 seated` : table.status === 'finished' ? 'Round ended' : `${table.dropped ? 'Watching' : table.yourTurn ? 'Your turn' : 'Playing'} · ${remainingSeconds(table.deadline, clockOffset)}s`;
  }
}
function acceptTableList(result) {
  tables = result.tables; tableLimit = result.tableLimit; clockOffset = result.serverTime - Date.now();
  for (const code of turnWarnings.keys()) if (!tables.some(table => table.code === code)) turnWarnings.delete(code);
  for (const code of chatAttention.keys()) if (!tables.some(table => table.code === code)) chatAttention.delete(code);
  renderTableSwitcher(); refreshHomeTables();
}
function tablePicker() {
  if (account) { showHome('joined'); return; }
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
  const invite = new URLSearchParams(location.search).get('room')?.toUpperCase();
  let preferred = invite;
  try { preferred ||= sessionStorage.getItem('mr-active-table'); } catch { /* Optional recovery hint. */ }
  const memberships = session.rooms || (session.room ? [session.room] : []);
  const code = memberships.includes(preferred) ? preferred : memberships[0];
  const result = await request(`/api/tables${code ? `?code=${encodeURIComponent(code)}` : ''}`); acceptTableList(result);
  if (account && /^[A-F0-9]{12}$/.test(invite || '') && !memberships.includes(invite)) { landing(); return; }
  if (result.active) { accept(result.active); history.replaceState({}, '', `/?room=${state.code}`); }
  else if (!tables.length) landing();
  else tablePicker();
}
function showTutorial() {
  tutorialIndex = 0; tutorialAnswers.clear(); renderTutorial();
  document.querySelector('#rules-dialog').close();
  document.querySelector('#tutorial-dialog').showModal();
}
function renderTutorial() {
  const step = tutorialSteps[tutorialIndex];
  document.querySelector('#tutorial-topics').innerHTML = tutorialTopicsMarkup(tutorialIndex, esc);
  document.querySelector('#tutorial-practice').innerHTML = tutorialPracticeMarkup(tutorialIndex, tutorialAnswers.get(tutorialIndex), esc);
  document.querySelector('#tutorial-live-note').textContent = tables.some(table => table.status === 'playing') ? 'Your game stays live. Turn timers keep running while you learn.' : 'Practice examples use teaching cards, separate from your hand.';
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
  if (panel === 'lastDeal') lastDealRound = state.history?.[0]?.round ?? null;
  document.querySelector('#game-panel-content').innerHTML = ''; renderGamePanel();
  const dialog = document.querySelector('#game-dialog');
  if (dialog.open && (fromSettings || panel === 'settings')) {
    const heading = document.querySelector('#game-panel-title'); heading.tabIndex = -1; heading.focus();
  }
  if (!dialog.open) dialog.showModal();
  if (panel === 'chat') { const messages = document.querySelector('#dialog-messages'); messages.scrollTop = messages.scrollHeight; markChatRead(); syncChatIndicators(); }
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
    content.innerHTML = chatPanelMarkup(state, chatDraft, chatComposerMode, busy, connection, { esc, chatEmojis, chatReplies, unreadCount: chatAttention.get(state.code)?.unread.length || 0 });
    const messages = content.querySelector('.messages');
    messages.scrollTop = nearBottom ? messages.scrollHeight : scroll;
  } else if (openGamePanel === 'hand') {
    content.innerHTML = handPanelMarkup(state, groups, { esc, number, card, ranks });
  } else if (openGamePanel === 'standings') {
    const revealedOpen = content.querySelector('.standings-revealed')?.open || false;
    content.innerHTML = standingsPanelMarkup(state, revealedOpen, { esc, number, card, seatAvatar, ranks });
  } else if (openGamePanel === 'information') {
    content.innerHTML = informationPanelMarkup(state, { esc, number });
  } else if (openGamePanel === 'settings') {
    content.innerHTML = settingsPanelMarkup(state, hasLastDeal, preferences, preferenceSaveMessage, { esc });
  } else if (openGamePanel === 'lastDeal') {
    const deals = state.history || [];
    const index = Math.max(0, deals.findIndex(deal => deal.round === lastDealRound));
    lastDealRound = deals[index]?.round ?? null;
    content.innerHTML = lastDealPanelMarkup(deals[index], { esc, number }, deals);
  } else if (openGamePanel === 'bestDeclaration') {
    content.innerHTML = bestDeclarationPanelMarkup(busy, connection, state, selected, esc);
  } else if (openGamePanel === 'declaration') {
    content.innerHTML = declarationPanelMarkup(declarationError, busy, connection, esc, state, selected);
  }
  if (panelFromSettings && ['information', 'lastDeal'].includes(openGamePanel)) content.insertAdjacentHTML('beforeend', '<button type="button" class="button secondary settings-back" data-settings-panel="settings">Back to settings</button>');
  if (focused === 'dialog-chat-input') {
    const input = content.querySelector('#dialog-chat-input');
    input?.focus({ preventScroll: true }); input?.setSelectionRange(cursor, cursorEnd ?? cursor);
  } else if (openGamePanel === 'chat' && focused && (focused.startsWith('chat-') || focused === 'dialog-chat-send' || focused === 'dialog-messages' || focused === 'dialog-chat-latest')) {
    document.getElementById(focused)?.focus({ preventScroll: true });
  } else if (openGamePanel === 'hand') {
    dialog.scrollTop = panelScroll;
    if (focused === 'hand-view-back') document.getElementById(focused)?.focus({ preventScroll: true });
  } else if (openGamePanel === 'standings' && ['standings-reveal-toggle', 'standings-back'].includes(focused)) {
    const control = document.getElementById(focused) || dialog.querySelector('[data-close]');
    control?.focus({ preventScroll: true });
  }
  if (['lastDeal','declaration','bestDeclaration'].includes(openGamePanel)) {
    dialog.scrollTop = panelScroll;
    if (focused) (document.getElementById(focused) || dialog.querySelector('[data-close]'))?.focus({preventScroll:true});
  }
  updateClock(); syncChatIndicators();
}
function updatePresence() {
  if (!state) return;
  for (const image of document.querySelectorAll('[data-avatar-player]')) {
    const i = state.players.findIndex(p => p.id === image.dataset.avatarPlayer);
    if (i < 0) continue;
    const source = avatarSource(state.players[i].avatar) || `/assets/figma/avatar-${i + 1}.${[1, 2, 3].includes(i) ? 'svg' : 'png'}`;
    if (image.getAttribute('src') !== source) image.src = source;
  }
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
  for (const control of document.querySelectorAll('#table-entry-form input, #table-password-toggle, [data-table-mode]')) control.disabled = busy;
  document.querySelector('#table-entry-submit').textContent = busy ? (tableEntryMode === 'create' ? 'Creating table…' : 'Joining table…') : tableEntryMode === 'create' ? 'Create table' : 'Join table';
  syncFlowControls(); syncAuthControls(); updateConnectionNotice(); syncProfileControls(); syncAccountPageControls(); syncChatIndicators();
  for (const button of document.querySelectorAll('[data-switch-table], [data-attention-table], [data-add-table], [data-home-entry], #table-entry-form button[type="submit"]')) button.disabled = busy || connection !== 'connected' || ((button.hasAttribute('data-add-table') || button.hasAttribute('data-home-entry')) && tables.length >= tableLimit);
  for (const button of document.querySelectorAll('[data-home], [data-results-home], [data-home-tab], [data-home-filter]')) button.disabled = busy;
  if (!state) {
    if (pendingHomeInvite && !busy && connection === 'connected') {
      const invite = pendingHomeInvite; pendingHomeInvite = '';
      if (tables.length < tableLimit) openTableEntry('join', invite);
      else toast('All your table seats are in use. Leave a table between rounds before joining this invite.', true);
    }
    app.setAttribute('aria-busy', String(busy));
    return;
  }
  const blocked = busy || connection !== 'connected';
  app.querySelectorAll(commandSelector).forEach(button => {
    if (fresh || !button.dataset.legal) button.dataset.legal = button.disabled ? 'no' : 'yes';
    button.disabled = blocked || button.dataset.legal === 'no';
  });
  app.querySelectorAll('[data-card], [data-ungroup], [data-action="sort"], [data-action="group"], [data-action="undo-arrangement"], [data-action="clear-selection"]').forEach(button => {
    if (fresh || !button.dataset.legal) button.dataset.legal = button.disabled ? 'no' : 'yes';
    button.disabled = busy || button.dataset.legal === 'no';
  });
  updatePresence();
  const guideTitle = document.querySelector('#turn-guide-title'), guideDetail = document.querySelector('#turn-guide-detail');
  if (guideTitle) {
    const guide = gameplayGuidance(state, selected);
    guideTitle.textContent = busy ? 'Sending your action…' : connection !== 'connected' ? 'Refreshing your table…' : guide.title;
    const detail = connection !== 'connected' ? 'Your hand is kept here. Server timers continue; actions resume after a fresh snapshot.' : busy ? 'Wait for confirmation before choosing another action.' : guide.detail;
    guideDetail.textContent = detail;
    const handHint = document.querySelector('#hand-action-hint'); if (handHint) handHint.textContent = detail;
  }
  app.setAttribute('aria-busy', String(busy));
  const indicator = document.querySelector('#connection');
  if (indicator) {
    indicator.textContent = connection === 'connected' ? '● Connected' : connection === 'syncing' ? '● Syncing' : '● Reconnecting';
    indicator.classList.toggle('offline', connection !== 'connected');
  }
  const arrange = document.querySelector('[data-panel-action="arrange"]');
  const declarationStatusEl = document.querySelector('#declaration-turn-status');
  if (declarationStatusEl) {
    const text = declarationStatus(state, selected, busy, connection);
    if (declarationStatusEl.textContent !== text) declarationStatusEl.textContent = text;
  }
  if (arrange) arrange.disabled = blocked || state.status !== 'playing' || !state.hand.length;
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
  const previousArrangement = actionName === 'arrange' ? arrangementSnapshot(groups, selected, state.hand) : null;
  tableEpoch++; busy = true; syncControls();
  try {
    const result = await request('/api/action', { code: state.code, version: state.version, action: actionName, ...extra });
    if (actionName === 'arrange') {
      arrangementUndo = previousArrangement;
      groups = result.groups.map(g => {
        const highAce = g.ids.some(id => state.hand.find(c => c.id === id)?.rank === 13);
        const rank = c => c.rank === 1 && highAce ? 14 : c.rank || 99;
        const ids = [...g.ids].sort((a, b) => rank(state.hand.find(c => c.id === a)) - rank(state.hand.find(c => c.id === b)));
        return { ...g, ids, title: g.type === 'pure' ? 'Pure sequence' : g.type === 'sequence' ? 'Sequence' : 'Set' };
      });
      saveGroups(); selected.clear(); renderRoom();
      toast(result.valid && state.hand.length === 13 ? 'Your 13 cards form a valid declaration.' : 'Grouped your hand. After drawing, select a final discard to declare.');
    } else if (result.left) {
      const departed = state.code; state = null; arrangementUndo = null;
      tableUi.delete(departed); chatAttention.delete(departed); tables = tables.filter(t => t.code !== departed); tablePicker();
    }
    else { if (['discard', 'declare'].includes(actionName)) selected.clear(); accept(result); if (actionName === 'chat') { markChatRead(); syncChatIndicators(); } saveGroups(); }
    return true;
  } catch (e) {
    if (!e.status || e.status >= 500) setConnection('reconnecting');
    if (actionName === 'declare' && e.status === 400) { declarationError = e.message; showGamePanel('declaration'); }
    toast(e.message, true); return false;
  }
  finally { busy = false; syncControls(); }
}
async function poll() {
  if ((!account && !state && !tables.length) || polling || busy) return;
  polling = true; const code = state?.code, epoch = tableEpoch;
  if (connection !== 'connected') setConnection('syncing');
  try {
    const result = await request(`/api/tables${code ? `?code=${encodeURIComponent(code)}` : ''}`);
    if (busy || epoch !== tableEpoch || code !== state?.code) return;
    failures = 0; acceptTableList(result);
    if (result.active) accept(result.active);
    else if (state) { stashTableUi(); tableUi.delete(code); tablePicker(); toast('Your selected table closed. Choose another table.', true); }
    else if (!tables.length && !document.querySelector('.home-page')) tablePicker();
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
  if (target.dataset.authMode) { changeAuthMode(target.dataset.authMode); return; }
  if (target.dataset.passwordToggle) {
    const input = document.getElementById(target.dataset.passwordToggle), visible = input.type === 'password';
    input.type = visible ? 'text' : 'password'; target.setAttribute('aria-pressed',String(visible));
    target.textContent = visible ? 'Hide' : 'Show'; target.setAttribute('aria-label',`${visible?'Hide':'Show'} ${input.id==='account-confirm'?'confirmation password':'password'}`); return;
  }
  if (target.dataset.mode) { mode = target.dataset.mode; landing(); return; }
  if (target.dataset.card) {
    const id = target.dataset.card; selected.has(id) ? selected.delete(id) : selected.add(id);
    renderRoom(); document.querySelector(`[data-card="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }); return;
  }
  if (target.dataset.ungroup !== undefined) { arrangementUndo = arrangementSnapshot(groups, selected, state.hand); groups.splice(Number(target.dataset.ungroup), 1); saveGroups(); renderRoom(); return; }
  if (target.dataset.remove) return action('removeBot', { playerId: target.dataset.remove });
  if (target.dataset.draw) return action('draw', { source: target.dataset.draw });
  switch (target.dataset.action) {
    case 'invite': {
      inviteEpoch++; document.querySelector('#invite-content').innerHTML = inviteMarkup(state,location.origin,esc);
      document.querySelector('#invite-dialog').showModal(); syncFlowControls(); break;
    }
    case 'rules': document.querySelector('#rules-dialog').showModal(); break;
    case 'tutorial': showTutorial(); break;
    case 'show-results': document.querySelector('.results')?.scrollIntoView({block:'start',behavior:'auto'}); document.querySelector('#round-results-title')?.focus({preventScroll:true}); break;
    case 'show-hand': document.querySelector('#player-hand-panel')?.scrollIntoView({ block: 'start', behavior: 'auto' }); document.querySelector('#player-hand-title')?.focus({ preventScroll: true }); break;
    case 'clear-selection': selected.clear(); renderRoom(); break;
    case 'undo-arrangement': {
      if (!arrangementUndo || arrangementUndo.handKey !== handIdentity(state.hand)) break;
      groups = reconcileGroups(arrangementUndo.groups, state.hand); selected = new Set(arrangementUndo.selected); arrangementUndo = null;
      saveGroups(); renderRoom(); toast('Previous card arrangement restored.'); break;
    }
    case 'sort': {
      arrangementUndo = arrangementSnapshot(groups, selected, state.hand);
      const sorted = [...state.hand].sort((a, b) => ['S', 'H', 'C', 'D', 'J'].indexOf(a.suit) - ['S', 'H', 'C', 'D', 'J'].indexOf(b.suit) || a.rank - b.rank);
      groups = [{ ids: sorted.map(c => c.id), title: 'Sorted by suit' }]; selected.clear(); saveGroups(); renderRoom(); break;
    }
    case 'group': {
      if (selected.size < 3) break;
      arrangementUndo = arrangementSnapshot(groups, selected, state.hand);
      groups = groups.map(g => ({ ...g, title: 'Group', ids: g.ids.filter(id => !selected.has(id)) })).filter(g => g.ids.length);
      groups.push({ title: 'Your group', ids: [...selected] }); selected.clear(); saveGroups(); renderRoom(); break;
    }
    case 'drop': confirm('Sit this round out?', `You’ll take ${state.players.find(p => p.id === state.me).turns === 0 ? 20 : 40} points and rejoin the next deal.`, () => action('drop'), 'drop'); break;
    case 'leave':
      if (state.status === 'playing') toast('Leave after the round ends. You can drop to sit this round out.', true);
      else confirm('Leave the table?', 'Your seat will be released. If you’re the host, another friend takes over.', () => action('leave'), 'leave');
      break;
    case 'declare': {
      const cardId = [...selected][0];
      confirm('Ready to show your hand?', 'Your selected card is the final discard. We’ll check the other 13 for two sequences, one pure, and valid groups throughout.', () => action('declare', { cardId }), 'declare', cardId); break;
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
  if (target.dataset.dealRound) {
    lastDealRound = Number(target.dataset.dealRound); renderGamePanel(); document.querySelector('#last-deal-round')?.focus(); return;
  }
  if (target.hasAttribute('data-declaration-review')) {
    document.querySelector('#game-dialog').close();
    document.querySelector('#player-hand-panel')?.scrollIntoView({block:'start'}); document.querySelector('#player-hand-title')?.focus({preventScroll:true}); return;
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
app.addEventListener('keydown', event => {
  if (!event.target.matches('[data-auth-mode]') || authBusy) return;
  if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  event.preventDefault(); changeAuthMode(event.key === 'Home' ? 'register' : event.key === 'End' ? 'login' : authMode === 'register' ? 'login' : 'register');
});
app.addEventListener('invalid', event => {
  if (event.target.closest('#auth-form') && event.target === event.target.form.querySelector(':invalid')) authError(event.target.validationMessage,event.target.id);
}, true);
app.addEventListener('input', event => {
  if (!event.target.closest('#auth-form')) return;
  event.target.removeAttribute('aria-invalid');
  document.querySelector('#auth-error').textContent = '';
  const match = document.querySelector('#account-password-match');
  if (match) { const confirm = document.querySelector('#account-confirm').value; match.textContent = confirm ? confirm === document.querySelector('#account-password').value ? 'Passwords match.' : 'Passwords do not match yet.' : ''; }
});
app.addEventListener('submit', async event => {
  event.preventDefault();
  if (event.target.id === 'auth-form') {
    if (authBusy) return;
    const data = Object.fromEntries(new FormData(event.target));
    const validation = accountValidation(data, authMode === 'register');
    if (validation) { authError(validation.message,validation.field); return; }
    document.querySelector('#auth-error').textContent = '';
    const submittedMode = authMode;
    delete data.confirmPassword;
    tableEpoch++; authBusy = true; busy = true; syncAuthControls();
    const button = event.target.querySelector('[type="submit"]'); button.disabled = true;
    const text = button.textContent; button.textContent = authMode === 'register' ? 'Creating your profile…' : 'Signing you in…';
    try {
      session = await request(authMode === 'register' ? '/api/register' : '/api/login', data);
      authIdentity.name = ''; authIdentity.username = '';
      for (const input of event.target.querySelectorAll('[name=password], [name=confirmPassword]')) { input.value = ''; input.type = 'password'; }
      setAccount(session.account); lastCode = ''; state = null; selected.clear(); groups = [];
      tables = []; tableUi.clear(); chatAttention.clear(); await restoreTables(); setConnection('connected');
      toast(submittedMode === 'register' ? 'Welcome! 10,000 play points are saved to your profile.' : 'Welcome back. Your profile and points are restored.');
    } catch (e) {
      if (document.querySelector('#auth-form') === event.target) {
        authError(e.message);
        for (const toggle of event.target.querySelectorAll('[data-password-toggle]')) {
          const input = document.getElementById(toggle.dataset.passwordToggle); input.type = 'password'; toggle.textContent = 'Show'; toggle.setAttribute('aria-pressed','false'); toggle.setAttribute('aria-label',`Show ${input.id==='account-confirm'?'confirmation password':'password'}`);
        }
        button.textContent = text;
      }
      toast(e.message, true);
    }
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
  document.querySelector('#table-setup-summary').hidden = mode !== 'create';
  document.querySelector('#table-setup-access').textContent = setupSummary(!!document.querySelector('#new-table-password').value);
  document.querySelector('#table-entry-error').textContent = '';
  document.querySelector('#new-table-code').removeAttribute('aria-invalid');
  document.querySelector('#new-table-code-row').hidden = mode !== 'join';
  document.querySelector('#new-table-code').required = mode === 'join';
  document.querySelector('#new-table-access-row').hidden = mode !== 'create';
  document.querySelector('#table-entry-submit').textContent = mode === 'create' ? 'Create table' : 'Join table';
  for (const button of document.querySelectorAll('[data-table-mode]')) button.setAttribute('aria-pressed', String(button.dataset.tableMode === mode));
}
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button || button.disabled) return;
  if (button.dataset.homeFilter && !busy) {
    if (!['all','your-turn','lobby','finished'].includes(button.dataset.homeFilter)) return;
    homeFilter = button.dataset.homeFilter; refreshHomeTables(); syncControls(); document.querySelector(`[data-home-filter="${homeFilter}"]`)?.focus(); return;
  }
  if (button.hasAttribute('data-review-round')) { showGamePanel('standings'); return; }
  if (button.dataset.attentionTable) { switchTable(button.dataset.attentionTable); return; }
  if (button.hasAttribute('data-chat-latest')) {
    const messages = document.querySelector(openGamePanel === 'chat' ? '#dialog-messages' : '#messages');
    if (messages) { messages.scrollTop = messages.scrollHeight; messages.focus({preventScroll:true}); markChatRead(); syncChatIndicators(); }
    return;
  }
  if (button.dataset.accountView) { showAccountPage(button.dataset.accountView); return; }
  if (button.hasAttribute('data-account-back')) {
    if (!busy) { document.querySelector('#account-pages-dialog').close(); loadProfile(); }
    return;
  }
  if (button.hasAttribute('data-feedback-new')) { if (!busy) { feedbackDraft = { category: 'idea', message: '', id: null }; showAccountPage('feedback'); } return; }
  if (button.hasAttribute('data-feedback-last')) { loadFeedbackReceipt(); return; }
  if (button.dataset.switchTable) { switchTable(button.dataset.switchTable); return; }
  if ((button.hasAttribute('data-home') || button.hasAttribute('data-results-home')) && !busy) { showHome('joined'); return; }
  if (button.dataset.homeTab && !busy) { showHome(button.dataset.homeTab); document.querySelector(`[data-home-tab="${homeTab}"]`).focus(); return; }
  if (button.hasAttribute('data-home-profile')) { loadProfile(); return; }
  if (button.dataset.homeEntry) { openTableEntry(button.dataset.homeEntry); return; }
  if (button.hasAttribute('data-add-table')) openTableEntry('create');
  if (button.dataset.tableMode) setTableEntryMode(button.dataset.tableMode);
});
function updateInvitePreview() {
  const code = inviteCode(document.querySelector('#new-table-code').value,location.origin);
  document.querySelector('#invite-preview').textContent = code ? `Invite ready: ${code}. Enter the room password if your friend set one.` : 'Ask the host for the invite code or link and the room password, if required.';
}
document.querySelector('#new-table-code').addEventListener('input', event => {
  event.target.removeAttribute('aria-invalid'); document.querySelector('#table-entry-error').textContent = ''; updateInvitePreview();
});
document.querySelector('#tables-dialog').addEventListener('close', () => {
  document.querySelector('#new-table-password').value = ''; document.querySelector('#new-table-password').type = 'password'; document.querySelector('#new-table-access').value = '';
  document.querySelector('#table-password-toggle').textContent = 'Show password'; document.querySelector('#table-password-toggle').setAttribute('aria-pressed','false');
});
document.querySelector('#table-entry-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || connection !== 'connected') return;
  const data = { ...Object.fromEntries(new FormData(event.target)), name: account?.name };
  if (tableEntryMode === 'join') {
    const code = inviteCode(data.code,location.origin);
    if (!code) {
      document.querySelector('#table-entry-error').textContent = 'Enter a 12-character invite code or a full invite link from this site.';
      document.querySelector('#new-table-code').setAttribute('aria-invalid','true'); document.querySelector('#new-table-code').focus(); return;
    }
    data.code = code; document.querySelector('#new-table-code').value = code;
  } else { delete data.code; }
  if (tableEntryMode === 'join') delete data.accessKey;
  stashTableUi(); tableEpoch++; busy = true; syncControls();
  document.querySelector('#table-entry-error').textContent = '';
  try {
    const room = await request(tableEntryMode === 'create' ? '/api/create' : '/api/join', data);
    document.querySelector('#tables-dialog').close();
    accept(room); history.replaceState({}, '', `/?room=${room.code}`);
  } catch (e) {
    if (!e.status || e.status >= 500) setConnection('reconnecting');
    document.querySelector('#table-entry-error').textContent = e.message;
    document.querySelector('#table-entry-error').focus();
    toast(e.message, true);
  } finally { busy = false; syncControls(); }
});
document.querySelector('#game-dialog').addEventListener('change', event => {
  if (event.target.id !== 'last-deal-round') return;
  lastDealRound = Number(event.target.value); renderGamePanel(); document.querySelector('#last-deal-round')?.focus();
});
document.querySelector('#tutorial-dialog').addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.tutorialTopic !== undefined) {
    const index = Number(button.dataset.tutorialTopic); if (!Number.isInteger(index) || !tutorialSteps[index]) return;
    tutorialIndex = index; renderTutorial(); document.querySelector('#tutorial-title').focus();
  }
  if (button.dataset.tutorialAnswer !== undefined) {
    const answer = Number(button.dataset.tutorialAnswer); if (![0,1].includes(answer)) return;
    tutorialAnswers.set(tutorialIndex,answer);
    document.querySelector('#tutorial-practice').innerHTML = tutorialPracticeMarkup(tutorialIndex, answer, esc);
    document.querySelector(`[data-tutorial-answer="${answer}"]`)?.focus({preventScroll:true});
  }
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
document.querySelector('.brand').addEventListener('click', event => {
  if (!account) return;
  event.preventDefault(); if (!busy) showHome('points');
});
document.querySelector('#rules-button').addEventListener('click', () => document.querySelector('#rules-dialog').showModal());
document.querySelector('#mobile-button').addEventListener('click', () => document.querySelector('#mobile-dialog').showModal());
document.querySelector('#profile-button').addEventListener('click', () => { if (account) loadProfile(); else landing(); });
document.querySelector('#profile-dialog').addEventListener('click', async event => {
  const target = event.target.closest('button'); if (!target || target.disabled) return;
  if (profileBusy) return;
  if (target.hasAttribute('data-profile-retry')) return loadProfile(profileOffset, profileFilter);
  if (target.dataset.historyFilter) return loadProfile(0, target.dataset.historyFilter);
  if (target.dataset.history !== undefined) return loadProfile(Number(target.dataset.history));
  if (target.id === 'sign-out') {
    if (busy || authBusy) return;
    tableEpoch++; busy = true; target.disabled = true;
    try {
      session = await request('/api/logout', { logout: true });
      document.querySelector('#profile-dialog').close(); state = null; lastCode = ''; selected.clear(); groups = []; chatDraft = ''; tables = []; tableUi.clear(); chatAttention.clear();
      authIdentity.name = ''; authIdentity.username = '';
      feedbackDraft = { category: 'idea', message: '', id: null }; accountPageEpoch++;
      history.replaceState({}, '', '/'); setAccount(null); authMode = 'login'; landing(); toast('Signed out. Your points are saved.');
    } catch (e) { toast(e.message, true); target.disabled = false; }
    finally { busy = false; }
  }
});
document.querySelector('#profile-dialog').addEventListener('close', () => {
  profileEpoch++; profileBusy = false; profileData = null;
});
document.querySelector('#profile-dialog').addEventListener('submit', async event => {
  if (event.target.id !== 'avatar-form') return;
  event.preventDefault(); if (profileBusy || busy || !account || connection !== 'connected') return;
  const avatar = Number(new FormData(event.target).get('avatar'));
  if (!avatarSource(avatar)) return;
  const epoch = profileEpoch, accountId = account.id;
  tableEpoch++; busy = true; profileBusy = true; syncControls(); syncProfileControls();
  const status = document.querySelector('#avatar-status'); status.textContent = 'Saving your avatar…';
  try {
    const result = await request('/api/profile', { avatar });
    if (!account || account.id !== accountId) return;
    setAccount(result);
    if (state) {
      const me = state.players.find(p => p.id === state.me); if (me) me.avatar = result.avatar;
      updatePresence();
    }
    if (epoch === profileEpoch && document.querySelector('#profile-dialog').open) {
      if (profileData) profileData.avatar = result.avatar;
      document.querySelector('.profile-portrait').src = avatarSource(result.avatar);
      status.textContent = 'Avatar saved to your account.';
    }
  } catch (e) {
    if (!e.status || e.status >= 500) setConnection('reconnecting');
    if (epoch === profileEpoch) status.textContent = `Could not confirm the save. ${e.message}`;
    toast(e.message, true);
  } finally {
    busy = false;
    if (epoch === profileEpoch) { profileBusy = false; syncProfileControls(); }
    syncControls();
  }
});
function lastFeedbackId() {
  try { return sessionStorage.getItem(feedbackKey()) || ''; } catch { return ''; }
}
function showAccountPage(view, receipt = null) {
  if (!account || busy || profileBusy || !['username', 'feedback', 'feedback-receipt'].includes(view)) return;
  accountPageEpoch++; accountPage = view;
  document.querySelector('#profile-dialog').close();
  const dialog = document.querySelector('#account-pages-dialog'); dialog.dataset.view = view;
  document.querySelector('#account-page-title').textContent = { username: 'Change Username', feedback: 'Suggestion Box', 'feedback-receipt': 'Submission Confirmation' }[view];
  document.querySelector('#account-page-content').innerHTML = accountPageMarkup(view, { username: account.username, draft: feedbackDraft, lastId: lastFeedbackId(), receipt }, esc);
  dialog.querySelector('.account-page-back').hidden = view === 'feedback-receipt';
  if (!dialog.open) dialog.showModal();
  syncAccountPageControls(); document.querySelector('#account-page-title').focus();
}
function syncAccountPageControls() {
  const dialog = document.querySelector('#account-pages-dialog');
  if (!dialog.open) return;
  dialog.setAttribute('aria-busy', String(busy));
  for (const control of dialog.querySelectorAll('button,input,textarea,select')) {
    if (control.hasAttribute('data-close')) continue;
    control.disabled = busy || (control.matches('button[type="submit"], [data-feedback-last]') && connection !== 'connected');
  }
}
async function loadFeedbackReceipt() {
  const id = lastFeedbackId(); if (!id || busy || !account || connection !== 'connected') return;
  const epoch = accountPageEpoch; busy = true; syncControls();
  try {
    const receipt = await request(`/api/feedback?id=${encodeURIComponent(id)}`);
    busy = false;
    if (epoch === accountPageEpoch && document.querySelector('#account-pages-dialog').open) showAccountPage('feedback-receipt', receipt);
  } catch (e) {
    if (epoch === accountPageEpoch) document.querySelector('#account-page-status').textContent = e.message;
  } finally { busy = false; syncControls(); }
}
document.querySelector('#account-pages-dialog').addEventListener('close', () => {
  accountPageEpoch++; accountPage = null;
  const password = document.querySelector('#rename-password'); if (password) password.value = '';
  document.querySelector('#profile-button')?.focus();
});
document.querySelector('#account-pages-dialog').addEventListener('input', event => {
  if (!['feedback-message', 'feedback-category'].includes(event.target.id)) return;
  feedbackDraft.message = document.querySelector('#feedback-message').value;
  feedbackDraft.category = document.querySelector('#feedback-category').value;
  feedbackDraft.id = null;
  document.querySelector('#feedback-count').textContent = `${feedbackDraft.message.length}/1000`;
});
document.querySelector('#account-pages-dialog').addEventListener('submit', async event => {
  if (!['username-form','feedback-form'].includes(event.target.id)) return;
  event.preventDefault(); if (busy || !account || connection !== 'connected') return;
  const rename = event.target.id === 'username-form', epoch = accountPageEpoch, accountId = account.id;
  const input = Object.fromEntries(new FormData(event.target));
  if (!rename) {
    feedbackDraft.id ||= [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join('');
    input.id = feedbackDraft.id;
  }
  const status = document.querySelector('#account-page-status');
  tableEpoch++; busy = true; syncControls(); status.textContent = rename ? 'Saving username…' : 'Saving suggestion…';
  try {
    const result = await request(rename ? '/api/username' : '/api/feedback', input);
    if (!account || account.id !== accountId) return;
    if (rename) {
      setAccount(result); if (profileData) profileData.username = result.username;
      if (epoch === accountPageEpoch) {
        document.querySelector('#new-username').value = result.username;
        status.textContent = `Username saved. Sign in as ${result.username} next time.`;
      }
    } else {
      try { sessionStorage.setItem(feedbackKey(), result.id); } catch { /* Receipt remains visible without storage. */ }
      feedbackDraft = { category: 'idea', message: '', id: null };
      busy = false;
      if (epoch === accountPageEpoch && document.querySelector('#account-pages-dialog').open) showAccountPage('feedback-receipt', result);
    }
  } catch (e) {
    if (!e.status || e.status >= 500) setConnection('reconnecting');
    if (epoch === accountPageEpoch) status.textContent = rename ? e.message : `Could not confirm the save. ${e.message} Retry the unchanged message to recover its receipt.`;
  } finally {
    const password = event.target.querySelector('[name="currentPassword"]'); if (password) password.value = '';
    busy = false; syncControls();
  }
});
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button, input, select, textarea, summary, a[href], [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
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
document.querySelector('#confirm-yes').addEventListener('click', () => {
  if (busy || connection !== 'connected' || confirmationProblem(confirmIntent,state)) { syncFlowControls(); return; }
  const next = confirmAction; confirmAction = null; confirmIntent = null;
  document.querySelector('#confirm-dialog').close(); next?.();
});
document.querySelector('#confirm-dialog').addEventListener('close', () => { confirmAction = null; confirmIntent = null; });
document.querySelector('#invite-dialog').addEventListener('close', () => { inviteEpoch++; });
document.querySelector('#invite-dialog').addEventListener('click', async event => {
  const button = event.target.closest('#copy-invite, #copy-invite-code'); if (!button || button.disabled) return;
  const epoch = inviteEpoch;
  const codeOnly = button.id === 'copy-invite-code', input = document.querySelector(codeOnly ? '#invite-code-value' : '#invite-url');
  const text = input.value;
  for (const copy of document.querySelectorAll('.invite-copy-actions button')) copy.disabled = true;
  try {
    await navigator.clipboard.writeText(text);
    if (epoch === inviteEpoch) document.querySelector('#invite-status').textContent = codeOnly ? 'Room code copied. Share it with the room password separately, if required.' : 'Invite link copied. You can now paste it into a private message.';
  } catch {
    if (epoch === inviteEpoch) {
      input.focus(); input.select();
      document.querySelector('#invite-status').textContent = 'Automatic copy is unavailable. The text is selected; use your device’s Copy command.';
    }
  } finally {
    if (epoch === inviteEpoch) for (const copy of document.querySelectorAll('.invite-copy-actions button')) copy.disabled = false;
  }
});
document.querySelector('#new-table-password').addEventListener('input', () => { document.querySelector('#table-setup-access').textContent = setupSummary(!!document.querySelector('#new-table-password').value); });
document.querySelector('#table-password-toggle').addEventListener('click', event => {
  const input = document.querySelector('#new-table-password'), show = input.type === 'password'; input.type = show ? 'text' : 'password';
  event.currentTarget.textContent = show ? 'Hide password' : 'Show password'; event.currentTarget.setAttribute('aria-pressed',String(show));
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
