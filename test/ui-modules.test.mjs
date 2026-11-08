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
