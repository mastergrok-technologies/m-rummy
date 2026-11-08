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
