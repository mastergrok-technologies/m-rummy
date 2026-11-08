import { gameplayMarkup } from '../public/ui/gameplay.js';
import { waitingRoomMarkup } from '../public/ui/waiting-room.js';
import { profileMarkup } from '../public/ui/profile.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountFormMarkup } from '../public/ui/account.js';
import { joinedTablesMarkup, tablePickerMarkup } from '../public/ui/tables.js';

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

test('account forms preserve separate registration and login requirements', () => {
  const register = accountFormMarkup(true);
  const login = accountFormMarkup(false);
  assert.match(register, /id="account-confirm"/);
  assert.match(register, /autocomplete="new-password"/);
  assert.match(login, /autocomplete="current-password"/);
  assert.doesNotMatch(login, /id="account-confirm"/);
  assert.match(login, /id="auth-form"/);
});

test('table switcher marks active and urgent tables and escapes room codes', () => {
  const html = joinedTablesMarkup([{ code: 'ABC123', yourTurn: true }, { code: '<script>', yourTurn: false }], 'ABC123', 3, esc);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /Your turn/);
  assert.match(html, /&lt;script>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Add table \(2\/3\)/);
});

test('table picker includes live connection notice and table count', () => {
  const html = tablePickerMarkup(2, 3, '<div role="status">Connected</div>');
  assert.match(html, /2 of 3 available tables/);
  assert.match(html, /role="status"/);
});


test('profile view shows player stats and safely escapes identity', () => {
  const profile = { name: '<Alice>', username: 'alice', points: 10100, wins: 2, roundsPlayed: 4, historyTotal: 1, history: [{ type: 'signup', time: '2026-11-01T10:00:00Z', amount: 10000, balance: 10000 }] };
  const html = profileMarkup(profile, 0, esc, n => Number(n).toLocaleString('en-US'));
  assert.match(html, /&lt;Alice>/);
  assert.doesNotMatch(html, /<Alice>/);
  assert.match(html, /Points history/);
  assert.match(html, /Welcome bonus/);
  assert.match(html, /data-history="0" disabled/);
  assert.match(html, /id="sign-out"/);
});

test('profile history renders page offsets and escapes room names', () => {
  const profile = { name: 'Alice', username: 'alice', points: 10000, wins: 0, roundsPlayed: 0, historyTotal: 42, history: [{ type: 'win', round: 3, time: '2026-11-01T10:00:00Z', room: '<room>', amount: 50, balance: 10050 }] };
  const html = profileMarkup(profile, 20, esc, String);
  assert.match(html, /data-history="0"/);
  assert.match(html, /data-history="40"/);
  assert.match(html, /&lt;room>/);
  assert.doesNotMatch(html, /<room>/);
});


test('waiting room keeps host deal guarded until two players are seated', () => {
  const base = { me: 'me', host: 'me', code: 'ABC123', hasPassword: false, players: [{ id: 'me', name: 'Me' }], messages: [] };
  const avatar = () => 'M';
  const one = waitingRoomMarkup(base, '', '<header>Room</header>', esc, avatar);
  assert.match(one, /Deal the first round[^<]*<span aria-hidden="true">/);
  assert.match(one, /data-action="start" aria-describedby="waiting-help" disabled/);
  assert.match(one, /Invite a friend to seat 2/);
  assert.match(one, /<header>Room<\/header>/);
  const two = waitingRoomMarkup({ ...base, players: [...base.players, { id: 'friend', name: 'Friend' }] }, '', '', esc, avatar);
  assert.match(two, /data-action="start" aria-describedby="waiting-help" >/);
});

test('waiting room hides host controls from guests and escapes player messages', () => {
  const state = { me: 'guest', host: 'host', code: 'ROOM42', hasPassword: true, players: [{ id: 'host', name: '<Host>' }, { id: 'guest', name: 'Guest' }], messages: [{ name: '<Eve>', text: '<script>alert(1)</script>', time: '2026-11-01T10:00:00Z' }] };
  const html = waitingRoomMarkup(state, '<draft>', '', esc, () => 'A');
  assert.doesNotMatch(html, /data-action="start"/);
  assert.doesNotMatch(html, /data-action="addBot"/);
  assert.match(html, /&lt;Host>/);
  assert.match(html, /&lt;script>alert\(1\)&lt;\/script>/);
  assert.match(html, /value="&lt;draft>"/);
  assert.match(html, /Share its password separately/);
});


const gameplayHelpers = {
  esc,
  number: String,
  card: c => `<span class="card">${c?.id || ''}</span>`,
  seatAvatar: () => 'A',
  turnText: () => 'Your turn',
  ranks: { 5: '5' }
};
const gameplayState = () => ({
  status: 'playing', phase: 'draw', me: 'me', host: 'me', turn: 'me', code: 'ABC123', round: 1,
  hand: Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, rank: i + 1, suit: 'H' })),
  players: [{ id: 'me', name: 'Me', total: 0, turns: 0, count: 13 }, { id: 'friend', name: '<Friend>', total: 5, count: 13 }],
  indicator: { id: 'joker', rank: 5, suit: 'C' }, wildRank: 5, stockCount: 70,
  topDiscard: { id: 'discard', rank: 7, suit: 'S' }, messages: [], activity: [], history: []
});

test('gameplay renderer keeps turn controls, cards and safe player names', () => {
  const html = gameplayMarkup(gameplayState(), [], new Set(), '', '', gameplayHelpers);
  assert.match(html, /Draw from closed deck/);
  assert.match(html, /Your hand/);
  assert.match(html, /data-action="discard" disabled/);
  assert.match(html, /&lt;Friend>/);
  assert.doesNotMatch(html, /<Friend>/);
});

test('gameplay renderer shows completed round scores and rematch controls', () => {
  const state = gameplayState();
  state.status = 'finished';
  state.result = { reason: 'last-player', winner: 'me', winnerName: 'Me', scores: [{ id: 'me', name: 'Me', penalty: 0, total: 0 }], groups: [] };
  const html = gameplayMarkup(state, [], new Set(), '', '', gameplayHelpers);
  assert.match(html, /Round results and player penalties/);
  assert.match(html, /Deal another round/);
  assert.match(html, /Me wins/);
});
