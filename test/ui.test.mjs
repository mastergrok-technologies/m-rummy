// Deterministic browser fixtures exercise presentation only. PHP/HTTP tests cover rules.
// Run: npm install --no-save playwright && npx playwright install chromium
//      npm run test:ui
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function fixture(t, viewport = { width: 1920, height: 1080 }, multi = false, initial = {}, entry = {}) {
  const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const hand = Array.from({ length: 13 }, (_, i) => ({ id: `card-${i}`, rank: i + 1, suit: 'H' }));
  const room = { code: 'ABCDEF123456', version: 1, round: 1, status: 'playing', phase: 'draw', me: 'me', host: 'me', turn: 'me', deadline: Date.now() + 60000, hand,
    players: [{ id: 'me', name: 'Me', total: 0, turns: 0, count: 13 }, { id: 'other', name: 'Friend', total: 10, count: 13 }],
    indicator: { id: 'wild', rank: 5, suit: 'C' }, wildRank: 5, stockCount: 70, topDiscard: { id: 'discard', rank: 6, suit: 'S' }, messages: [], activity: [], history: [], account: { name: 'Me', points: 10000 } };
  Object.assign(room, initial);
  const rooms = new Map(entry.empty ? [] : [[room.code, room]]);
  if (multi) rooms.set('BBBBBB123456', { ...structuredClone(room), code: 'BBBBBB123456', deadline: Date.now() + 45000, hand: hand.map(c => ({ ...c, suit: 'S' })), messages: [] });
  const requests = [];
  let offline = false, hold = false, held, holdPoll = false, pollStarted, releasePoll, rejectChat = false;
  await page.route('http://rummy.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/')) {
      if (offline) return route.abort();
      if (path === '/api/session') return route.fulfill({ json: { csrf: 'test', room: room.code, rooms: [...rooms.keys()], tableLimit: 3, account: room.account } });
      if (path === '/api/tables') {
        const active = rooms.get(new URL(route.request().url()).searchParams.get('code'));
        const tables = [...rooms.values()].map(r => ({ code: r.code, version: r.version, round: r.round, status: r.status, phase: r.phase, deadline: r.deadline, yourTurn: r.turn === r.me, dropped: false, playerCount: r.players.length }));
        const payload = structuredClone({ tables, active: active ? { ...active, serverTime: Date.now() } : null, tableLimit: 3, serverTime: Date.now() });
        if (holdPoll) { holdPoll = false; pollStarted?.(); await new Promise(r => { releasePoll = r; }); }
        return route.fulfill({ json: payload });
      }
      if (path === '/api/create' || path === '/api/join') {
        const input = route.request().postDataJSON();
        if (path === '/api/join' && input.password !== 'friends') return route.fulfill({ status: 400, json: { error: 'Incorrect room password.' } });
        const code = path === '/api/join' ? input.code : 'CCCCCC123456';
        if (rooms.size >= 3) return route.fulfill({ status: 400, json: { error: 'You can join up to 3 tables.' } });
        const next = { ...structuredClone(room), code, status: 'lobby', phase: 'draw', round: 0, version: 1, hand: [], messages: [], players: [room.players[0]] };
        rooms.set(code, next); return route.fulfill({ json: { ...next, serverTime: Date.now() } });
      }
      if (path === '/api/action') {
        const input = route.request().postDataJSON(); requests.push(input);
        if (hold) await new Promise(r => { held = r; });
        const target = rooms.get(input.code);
        if (input.action === 'leave') { rooms.delete(input.code); return route.fulfill({ json: { left: true } }); }
        if (input.action === 'chat' && rejectChat) { rejectChat = false; return route.fulfill({ status: 400, json: { error: 'Chat is temporarily unavailable.' } }); }
        if (input.action === 'declare') return route.fulfill({ status: 400, json: { error: 'Your hand needs a pure sequence.' } });
        if (input.action === 'addBot') target.players.push({ id: `bot-${target.players.length}`, name: 'Practice bot', bot: true, total: 0, count: 0, turns: 0 });
        if (input.action === 'removeBot') target.players = target.players.filter(p => p.id !== input.playerId);
        if (input.action === 'start') { target.status = 'playing'; target.round = (target.round || 0) + 1; target.result = null; target.phase = 'draw'; target.drawnOpen = null; target.deadline = Date.now() + 60000; target.hand = hand; }
        if (input.action === 'draw') { const drawn = input.source === 'discard' ? target.topDiscard : { id: 'drawn', rank: 2, suit: 'S' }; target.phase = 'discard'; target.drawnOpen = input.source === 'discard' ? drawn.id : null; target.hand = [...target.hand, drawn]; }
        if (input.action === 'discard') { target.hand = target.hand.filter(c => c.id !== input.cardId); target.turn = 'other'; target.phase = 'draw'; target.deadline = Date.now() + 60000; }
        if (input.action === 'chat') target.messages.push({ id: `m${requests.length}`, name: 'Me', playerId: target.me, text: input.text, time: Date.now() });
        target.version++;
        return route.fulfill({ json: { ...target, serverTime: Date.now() } });
      }
      return route.fulfill({ json: { ...room, serverTime: Date.now() } });
    }
    try {
      const file = path === '/' ? 'index.html' : path.slice(1);
      const contentType = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'text/html';
      return route.fulfill({ body: await readFile(resolve('public', file)), contentType });
    } catch { return route.fulfill({ status: 404 }); }
  });
  await page.goto(`http://rummy.test/${entry.invite ? `?room=${entry.invite}` : ''}`);
  await page.locator(entry.empty ? '.home-page' : '#connection').waitFor();
  return { page, room, rooms, requests, errors, rejectNextChat: () => { rejectChat = true; }, holdNextPoll: () => { holdPoll = true; return new Promise(r => { pollStarted = r; }); }, releasePoll: () => releasePoll?.(), setOffline: value => { offline = value; }, hold: () => { hold = true; }, release: () => { hold = false; held?.(); } };
}
const open = (page, name) => page.getByRole('button', { name, exact: true }).click();
const close = page => page.getByRole('button', { name: 'Close table panel' }).click();

test('table panels show private hand, real standings, settings and safe chat', async t => {
  const { page, room, errors } = await fixture(t);
  assert.equal(await page.locator('.hand-panel').getAttribute('aria-labelledby'), 'player-hand-title');
  assert.equal(await page.locator('.hand-tools').getAttribute('aria-label'), 'Arrange your cards');
  assert.equal(await page.locator('.hand-scroll').getAttribute('tabindex'), '0');
  assert.equal(await page.locator('.sidebar').getAttribute('aria-label'), 'Table conversation and activity');
  assert.equal(await page.locator('.sidebar #messages').getAttribute('role'), 'log');
  await open(page, 'View cards'); assert.equal(await page.locator('#game-dialog .card').count(), 13); await close(page);
  await open(page, 'Standings'); assert.equal(await page.locator('.standings-table-wrap').getAttribute('aria-label'), 'Table standings and penalties'); assert.match(await page.locator('#game-dialog').innerText(), /Friend/); assert.equal(await page.locator('#game-dialog .card').count(), 0); await close(page);
  await open(page, 'Table info'); assert.equal(await page.locator('.info-overview').getAttribute('role'), 'group'); assert.match(await page.locator('#game-dialog').innerText(), /Free play/); await close(page);
  await open(page, 'Settings'); assert.match(await page.locator('.settings-accessibility-note').innerText(), /saved locally/i); await page.getByLabel('Spread out hand cards').check();
  assert.match(await page.locator('html').getAttribute('class'), /roomy-cards/); await close(page);
  await open(page, 'Chat'); assert.equal(await page.locator('.chat-suggestions').getAttribute('aria-label'), 'Message suggestions'); await page.locator('#dialog-chat-input').fill('<img src=x onerror=alert(1)>');
  await page.locator('#dialog-chat-send').click();
  await page.locator('#game-dialog .message').waitFor();
  assert.equal(room.messages[0].text, '<img src=x onerror=alert(1)>');
  assert.equal(await page.locator('#game-dialog .message img').count(), 0);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#game-dialog').evaluate(d => d.open), false);
  assert.deepEqual(errors, []);
});

test('pending moves cannot be repeated and rejected declaration preserves hand', async t => {
  const f = await fixture(t); const { page, requests } = f;
  f.hold(); await page.getByRole('button', { name: 'Draw from closed deck' }).click();
  await page.waitForFunction(() => document.querySelector('[data-draw="stock"]').disabled);
  assert.equal(await page.locator('[data-draw="discard"]').isDisabled(), true);
  assert.equal(requests.length, 1); f.release();
  await page.locator('[data-card="drawn"]').waitFor(); await page.locator('[data-card="drawn"]').click();
  await page.locator('[data-action="declare"]').click(); await page.locator('#confirm-yes').click();
  await page.locator('#game-dialog[data-panel="declaration"] .invalid-declaration-state').waitFor();
  assert.match(await page.locator('#game-dialog .declaration-feedback').innerText(), /pure sequence/i);
  assert.equal(await page.locator('.hand-scroll [data-card]').count(), 14);
  assert.match(await page.locator('#game-dialog').innerText(), /pure sequence/);
  await page.waitForFunction(() => !document.querySelector('[data-panel-action="arrange"]').disabled);
  await close(page); assert.equal(await page.locator('[data-action="declare"]').isDisabled(), false);
  assert.deepEqual(f.errors, []);
});

test('network uncertainty gates commands until an authoritative snapshot returns', async t => {
  const f = await fixture(t); const { page } = f;
  f.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  assert.equal(await page.locator('[data-draw="stock"]').isDisabled(), true);
  assert.equal(await page.locator('#connection-banner').isVisible(), true);
  await open(page, 'Chat'); await page.locator('#dialog-chat-input').fill('Keep my draft');
  assert.equal(await page.locator('#dialog-chat-send').isDisabled(), true);
  f.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => !document.querySelector('[data-draw="stock"]').disabled);
  assert.equal(await page.locator('#dialog-chat-input').inputValue(), 'Keep my draft');
  assert.equal(f.requests.length, 0); assert.deepEqual(f.errors, []);
});

for (const [width, height] of [[390, 844], [768, 1024], [1024, 768], [1920, 1080]]) {
  test(`table tools fit ${width}x${height} and keyboard focus stays inside dialog`, async t => {
    const { page, errors } = await fixture(t, { width, height });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await open(page, 'Settings');
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => !!document.activeElement.closest('#game-dialog')), true);
    }
    assert.equal(await page.locator('#game-dialog').evaluate(d => d.scrollWidth <= d.clientWidth), true);
    assert.deepEqual(errors, []);
  });
}

test('six-step tutorial supports back, finish, revisit and keyboard close', async t => {
  const { page, errors } = await fixture(t, { width: 390, height: 844 });
  await open(page, 'Learn rummy');
  assert.equal(await page.locator('#tutorial-back').isDisabled(), true);
  assert.equal(await page.locator('#tutorial-dialog').getAttribute('data-step'), '1');
  assert.equal(await page.locator('.tutorial-welcome-flow strong').allTextContents().then(values => values.join(',')), '13,+1,−1');
  assert.equal(await page.locator('#tutorial-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  for (let step = 1; step <= 6; step++) {
    assert.equal(await page.locator('#tutorial-progress').textContent(), `Step ${step} of 6`);
    if (step === 2) {
      assert.equal(await page.locator('#tutorial-dialog').getAttribute('data-step'), '2');
      assert.match(await page.locator('.tutorial-pure-intro').innerText(), /No substitute joker/i);
      assert.equal(await page.locator('.tutorial-pure-cards .card').count(), 3);
      assert.equal(await page.locator('#tutorial-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    }
    if (step === 6) {
      assert.equal(await page.locator('#tutorial-dialog').getAttribute('data-step'), '6');
      assert.equal(await page.locator('.tutorial-declare-intro li').count(), 4);
      assert.match(await page.locator('.tutorial-declare-intro').innerText(), /server validation/i);
      assert.equal(await page.locator('#tutorial-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    }
    if (step === 5) {
      assert.equal(await page.locator('#tutorial-dialog').getAttribute('data-step'), '5');
      assert.match(await page.locator('.tutorial-scoring-intro').innerText(), /King \+ Queen \+ Five = 25 points/);
      assert.deepEqual(await page.locator('.tutorial-scoring-breakdown b').allTextContents(), ['10', '10', '5', '25']);
      assert.equal(await page.locator('.tutorial-scoring-cards .card').count(), 3);
      assert.equal(await page.locator('#tutorial-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    }
    if (step === 4) {
      assert.equal(await page.locator('#tutorial-dialog').getAttribute('data-step'), '4');
      assert.match(await page.locator('.tutorial-set-intro').innerText(), /Same rank\. Different suits\./);
      assert.equal(await page.locator('.tutorial-set-cards .card').count(), 3);
      assert.equal(await page.locator('#tutorial-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    }
    if (step === 3) {
      assert.equal(await page.locator('#tutorial-dialog').getAttribute('data-step'), '3');
      assert.match(await page.locator('.tutorial-joker-intro').innerText(), /Joker \(as 9♠\)/);
      assert.equal(await page.locator('.tutorial-joker-cards .card').count(), 3);
      assert.equal(await page.locator('#tutorial-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await page.locator('#tutorial-back').click();
      assert.equal(await page.locator('#tutorial-progress').textContent(), 'Step 2 of 6');
      await page.locator('#tutorial-next').click();
    }
    await page.locator('#tutorial-next').click();
  }
  assert.equal(await page.locator('#tutorial-dialog').evaluate(d => d.open), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('mr-tutorial-complete')), 'true');
  await page.locator('#rules-button').click(); await page.locator('#tutorial-button').click();
  assert.equal(await page.locator('#tutorial-progress').textContent(), 'Step 1 of 6');
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#tutorial-dialog').evaluate(d => d.open), false);
  assert.deepEqual(errors, []);
});

test('round changes reset local groups and older snapshots cannot roll back the hand', async t => {
  const { page, room } = await fixture(t);
  await page.locator('[data-card="card-0"]').click(); await page.locator('[data-card="card-1"]').click(); await page.locator('[data-card="card-2"]').click();
  await page.locator('[data-action="group"]').click(); assert.equal(await page.locator('.ungroup').count(), 1);
  room.version++; room.round++;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => document.querySelectorAll('.ungroup').length === 0);
  room.version = 0; room.hand = [];
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => document.querySelector('#connection-banner').hidden);
  assert.equal(await page.locator('.hand-scroll [data-card]').count(), 13);
});

test('switching tables preserves per-table selection, groups and chat drafts with colliding card IDs', async t => {
  const { page, room, errors } = await fixture(t, { width: 390, height: 844 }, true);
  for (let i = 0; i < 3; i++) await page.locator(`[data-card="card-${i}"]`).click();
  await page.locator('[data-action="group"]').click();
  await page.locator('[data-card="card-4"]').click();
  await page.locator('#chat-input').fill('Draft at first table');
  await page.locator('[data-switch-table="BBBBBB123456"]').click();
  await page.waitForURL('**/?room=BBBBBB123456');
  assert.equal(await page.locator('.hand-scroll .selected').count(), 0);
  assert.equal(await page.locator('.ungroup').count(), 0);
  assert.equal(await page.locator('#chat-input').inputValue(), '');
  await page.locator('[data-card="card-5"]').click();
  await page.locator('#chat-input').fill('Draft at second table');
  await page.locator(`[data-switch-table="${room.code}"]`).click();
  await page.waitForURL(`**/?room=${room.code}`);
  assert.equal(await page.locator('[data-card="card-4"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-card="card-5"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.ungroup').count(), 1);
  assert.equal(await page.locator('#chat-input').inputValue(), 'Draft at first table');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('[data-switch-table="BBBBBB123456"]').click();
  await page.waitForURL('**/?room=BBBBBB123456');
  await page.reload();
  await page.locator('[data-switch-table="BBBBBB123456"][aria-current="page"]').waitFor();
  assert.deepEqual(errors, []);
});

test('pending actions prevent table switching and commands use the selected table', async t => {
  const f = await fixture(t, undefined, true); const { page } = f;
  await page.locator('[data-switch-table="BBBBBB123456"]').click(); await page.waitForURL('**/?room=BBBBBB123456');
  f.hold(); await page.locator('[data-draw="stock"]').click();
  assert.equal(await page.locator(`[data-switch-table="${f.room.code}"]`).isDisabled(), true);
  assert.equal(await page.locator('[data-add-table]').isDisabled(), true);
  f.release(); await page.locator('[data-card="drawn"]').waitFor();
  assert.equal(f.requests[0].code, 'BBBBBB123456'); assert.equal(f.room.hand.length, 13);
  await page.locator(`[data-switch-table="${f.room.code}"]`).click(); await page.waitForURL(`**/?room=${f.room.code}`);
  assert.equal(await page.locator('.hand-scroll [data-card]').count(), 13);
  assert.match(await page.locator('[data-table-clock="BBBBBB123456"]').innerText(), /Your turn/);
  assert.deepEqual(f.errors, []);
});

test('create and leave affect only one table, and the cap disables Add table', async t => {
  const { page, room, rooms, errors } = await fixture(t, undefined, true);
  await page.locator('[data-add-table]').click(); await page.locator('#table-entry-submit').click();
  await page.waitForURL('**/?room=CCCCCC123456');
  assert.equal(rooms.size, 3); assert.equal(await page.locator('[data-add-table]').isDisabled(), true);
  await page.locator('[data-action="leave"]').click(); await page.locator('#confirm-yes').click();
  await page.getByRole('heading', { name: 'Choose your table' }).waitFor();
  assert.equal(rooms.size, 2); assert.equal(await page.locator('[data-add-table]').isDisabled(), false);
  await page.locator(`[data-switch-table="${room.code}"]`).click(); await page.waitForURL(`**/?room=${room.code}`);
  assert.equal(await page.locator('.hand-scroll [data-card]').count(), 13);
  assert.deepEqual(errors, []);
});

test('joining reports password failures in place and retains existing tables', async t => {
  const { page, rooms, errors } = await fixture(t);
  await page.locator('[data-add-table]').click(); await page.locator('[data-table-mode="join"]').click();
  await page.locator('#new-table-code').fill('DDDDDD123456'); await page.locator('#new-table-password').fill('wrong');
  await page.locator('#table-entry-submit').click();
  await page.waitForFunction(() => document.querySelector('#table-entry-error').textContent.includes('Incorrect'));
  assert.equal(rooms.size, 1); assert.equal(await page.locator('#new-table-code').inputValue(), 'DDDDDD123456');
  await page.locator('#new-table-password').fill('friends'); await page.locator('#table-entry-submit').click();
  await page.waitForURL('**/?room=DDDDDD123456'); assert.equal(rooms.size, 2); assert.deepEqual(errors, []);
});

test('expiration removes selected table without silently switching or replaying actions', async t => {
  const { page, room, rooms, requests, errors } = await fixture(t, undefined, true);
  rooms.delete(room.code); await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('heading', { name: 'Choose your table' }).waitFor();
  assert.equal(await page.locator('.hand-scroll [data-card]').count(), 0);
  await page.locator('[data-switch-table="BBBBBB123456"]').click(); await page.waitForURL('**/?room=BBBBBB123456');
  assert.equal(requests.length, 0); assert.deepEqual(errors, []);
});

test('an older in-flight aggregate poll cannot roll back turn indicators after a command', async t => {
  const f = await fixture(t, undefined, true); const { page, room } = f;
  await page.locator('[data-draw="stock"]').click(); await page.locator('[data-card="drawn"]').waitFor();
  await f.holdNextPoll();
  await page.locator('[data-card="drawn"]').click(); await page.locator('[data-action="discard"]').click();
  await page.waitForFunction(code => document.querySelector(`[data-table-clock="${code}"]`).textContent.startsWith('Playing'), room.code);
  const response = page.waitForResponse(r => r.url().includes('/api/tables'));
  f.releasePoll(); await (await response).finished(); await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.locator('.hand-scroll [data-card]').count(), 13);
  assert.match(await page.locator(`[data-table-clock="${room.code}"]`).innerText(), /^Playing/);
  assert.deepEqual(f.errors, []);
});

test('presence-only snapshots update seat badges without replacing cards or chat input', async t => {
  const { page, room, requests, errors } = await fixture(t);
  await page.locator('[data-card="card-4"]').click();
  await page.locator('#chat-input').fill('Draft remains'); await page.locator('#chat-input').focus();
  await page.evaluate(() => { window.cardBeforePresence = document.querySelector('[data-card="card-4"]'); window.chatBeforePresence = document.querySelector('#chat-input'); });
  const version = room.version, deadline = room.deadline;
  room.players[0].presence = 'online'; room.players[1].presence = 'away';
  await page.locator('[data-presence-player="other"][data-presence="away"]').waitFor();
  assert.equal(await page.locator('[data-presence-player="other"]').innerText(), 'Away');
  assert.equal(await page.evaluate(() => window.cardBeforePresence === document.querySelector('[data-card="card-4"]') && window.chatBeforePresence === document.querySelector('#chat-input')), true);
  assert.equal(await page.locator('[data-card="card-4"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#chat-input').inputValue(), 'Draft remains');
  assert.equal(await page.locator('#chat-input').evaluate(e => e === document.activeElement), true);
  room.players[1].presence = 'offline';
  await page.locator('[data-presence-player="other"][data-presence="offline"]').waitFor();
  room.players[1].presence = 'online';
  await page.locator('[data-presence-player="other"][data-presence="online"]').waitFor();
  assert.equal(room.version, version); assert.equal(room.deadline, deadline); assert.equal(requests.length, 0); assert.deepEqual(errors, []);
});

test('each page sends visibility and ordered heartbeats, with a fresh client after reload', async t => {
  const { page, errors } = await fixture(t);
  const visibleRequest = page.waitForRequest(r => r.url().includes('/api/tables') && new URL(r.url()).searchParams.get('visible') === '1');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const first = new URL((await visibleRequest).url());
  assert.match(first.searchParams.get('client'), /^[a-f0-9]{32}$/);
  await page.waitForFunction(() => document.querySelector('#connection-banner').hidden);
  const hiddenRequest = page.waitForRequest(r => r.url().includes('/api/tables') && new URL(r.url()).searchParams.get('visible') === '0');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hidden = new URL((await hiddenRequest).url());
  assert.equal(hidden.searchParams.get('client'), first.searchParams.get('client'));
  assert.ok(Number(hidden.searchParams.get('sequence')) > Number(first.searchParams.get('sequence')));
  const foregroundRequest = page.waitForRequest(r => r.url().includes('/api/tables') && new URL(r.url()).searchParams.get('visible') === '1');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  const foreground = new URL((await foregroundRequest).url());
  assert.ok(Number(foreground.searchParams.get('sequence')) > Number(hidden.searchParams.get('sequence')));
  // The outgoing document can send a final hidden heartbeat during navigation.
  const reloadRequest = page.waitForRequest(r => r.url().includes('/api/tables') && new URL(r.url()).searchParams.get('client') !== first.searchParams.get('client'));
  await page.reload(); const reloaded = new URL((await reloadRequest).url());
  assert.notEqual(reloaded.searchParams.get('client'), first.searchParams.get('client')); assert.deepEqual(errors, []);
});

test('local network loss marks self reconnecting and treats remote presence as unknown until resync', async t => {
  const f = await fixture(t); const { page, room } = f;
  room.players.forEach(p => { p.presence = 'online'; });
  await page.locator('[data-presence-player="other"][data-presence="online"]').waitFor();
  f.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  assert.equal(await page.locator('[data-presence-player="me"]').innerText(), 'Reconnecting');
  assert.equal(await page.locator('[data-presence-player="other"]').innerText(), 'Status unknown');
  f.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.locator('[data-presence-player="other"][data-presence="online"]').waitFor();
  assert.equal(await page.locator('[data-presence-player="me"]').innerText(), 'Connected'); assert.deepEqual(f.errors, []);
});

 test('Figma splash stays visible during startup and clears after session recovery', async t => {
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
t.after(() => browser.close());
const page = await browser.newPage({viewport:{width:1920,height:1080}});
let release;const gate=new Promise(r=>release=r);
await page.route('http://rummy.test/**',async route=>{
const path=new URL(route.request().url()).pathname;
if(path==='/api/session'){await gate;return route.fulfill({json:{csrf:'test',rooms:[],account:null}});}
if(path.startsWith('/api/'))return route.fulfill({json:{tables:[],tableLimit:3}});
const file=path==='/'?'index.html':path.slice(1);
try{return route.fulfill({body:await readFile('public/'+file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html'});}catch{return route.fulfill({status:404});}
});
await page.goto('http://rummy.test/',{waitUntil:'domcontentloaded'});
await page.locator('.splash-art').evaluate(img=>img.decode());
assert.equal(await page.locator('.site-header').isVisible(),false);
assert.equal(await page.locator('.splash-art').evaluate(el=>el.getBoundingClientRect().width),640);

await page.setViewportSize({width:390,height:844});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);

release();await page.locator('.landing').waitFor();
assert.equal(await page.locator('body').getAttribute('class'),'');
assert.equal(await page.locator('#app').getAttribute('aria-busy'),null);


});

const waitingPlayer = (id, name, extra = {}) => ({ id, name, total: 0, count: 0, turns: 0, presence: 'online', ...extra });
async function waitingScreenshot(page, name) {
  await page.locator('.waiting-page img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  if (!process.env.UI_SCREENSHOT_DIR) return;
  await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: resolve(process.env.UI_SCREENSHOT_DIR, `${name}.png`), fullPage: true });
}
test('waiting host sees six seats, invite flow and guarded bot/deal actions', async t => {
  const f = await fixture(t, { width: 1920, height: 1080 }, false, { status: 'lobby', round: 0, hand: [], players: [waitingPlayer('me', 'Me')] });
  const { page, requests } = f;
  assert.equal(await page.locator('.waiting-seat').count(), 6);
  assert.equal(await page.locator('.waiting-seats').getAttribute('role'), 'group');
  assert.equal(await page.locator('.waiting-invite').getAttribute('aria-labelledby'), 'waiting-invite-title');
  assert.equal(await page.locator('#messages').getAttribute('role'), 'log');
  assert.equal(await page.getByRole('progressbar', { name: 'Seats filled' }).getAttribute('aria-valuenow'), '1');
  assert.equal(await page.locator('.waiting-seat-open').count(), 5);
  assert.equal(await page.locator('.waiting-seat-self').innerText().then(s => s.includes('Me (you)')), true);
  assert.equal(await page.locator('[data-action="start"]').isDisabled(), true);
  assert.equal(await page.locator('.hand-panel').count(), 0);
  await waitingScreenshot(page, 'waiting-host-desktop');
  await page.getByRole('button', { name: 'Invite a friend to seat 2', exact: true }).click();
  assert.equal(await page.locator('#invite-url').inputValue(), 'http://rummy.test/?room=ABCDEF123456');
  await page.keyboard.press('Escape');
  f.hold(); await page.locator('[data-action="addBot"]').click();
  assert.equal(await page.locator('[data-action="addBot"]').isDisabled(), true);
  f.release(); await page.getByRole('button', { name: 'Remove Practice bot', exact: true }).waitFor();
  assert.equal(await page.locator('[data-action="start"]').isDisabled(), false);
  await page.getByRole('button', { name: 'Remove Practice bot', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.waiting-seat-open').length === 5);
  assert.equal(await page.locator('[data-action="start"]').isDisabled(), true);
  await page.locator('[data-action="addBot"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-action="start"]').disabled);
  await page.locator('[data-action="start"]').click();
  await page.locator('.hand-panel').waitFor();
  assert.equal(await page.locator('.waiting-table').count(), 0);
  assert.equal(requests.filter(r => r.action === 'start').length, 1);
  assert.deepEqual(f.errors, []);
});
test('waiting guest retains chat, handles host changes and cannot use host controls', async t => {
  const f = await fixture(t, { width: 390, height: 844 }, false, { status: 'lobby', round: 0, hand: [], host: 'other', hasPassword: true, players: [waitingPlayer('me', 'Me'), waitingPlayer('other', '<script>Host</script>')] });
  const { page, room } = f;
  assert.equal(await page.locator('[data-action="start"], [data-action="addBot"], [data-remove]').count(), 0);
  assert.equal(await page.locator('.waiting-host-status').innerText(), 'Waiting for the host');
  assert.equal(await page.locator('.waiting-seat script').count(), 0);
  assert.match(await page.locator('.waiting-invite').innerText(), /Share its password separately/);
  await page.locator('#chat-input').fill('See you at the table');
  room.version++; room.host = 'me';
  await page.locator('[data-action="start"]').waitFor();
  assert.equal(await page.locator('#chat-input').inputValue(), 'See you at the table');
  assert.equal(await page.locator('#chat-input').evaluate(el => el === document.activeElement), true);
  await page.locator('#chat-form button').click();
  await page.locator('#messages .message').waitFor();
  assert.equal(room.messages[0].text, 'See you at the table');
  await waitingScreenshot(page, 'waiting-mobile');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  f.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  assert.equal(await page.locator('[data-action="start"]').isDisabled(), true);
  assert.equal(await page.locator('[data-action="addBot"]').isDisabled(), true);
  assert.equal(await page.locator('#connection-banner').isVisible(), true);
  assert.deepEqual(f.errors, []);
});
test('full waiting table keeps long names contained across viewports', async t => {
  const f = await fixture(t, { width: 1024, height: 768 }, false, { status: 'lobby', round: 0, hand: [], players: [waitingPlayer('me', 'Me'), ...Array.from({ length: 5 }, (_, i) => waitingPlayer(`friend-${i}`, 'AveryLongNameWithoutSpaces', { bot: i === 4 }))] });
  const { page } = f;
  assert.equal(await page.locator('.waiting-seat-open').count(), 0);
  assert.equal(await page.getByRole('progressbar', { name: 'Seats filled' }).getAttribute('aria-valuenow'), '6');
  assert.equal(await page.locator('[data-action="addBot"]').isDisabled(), true);
  assert.equal(await page.locator('[data-action="start"]').isEnabled(), true);
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), viewport.width);
    const overflow = await page.locator('.waiting-seat').evaluateAll(els => els.some(el => el.scrollWidth > el.clientWidth));
    assert.equal(overflow, false);
  }
  await waitingScreenshot(page, 'waiting-full-mobile');
  assert.deepEqual(f.errors, []);
});

for (const [width, height] of [[390, 844], [768, 1024], [1024, 768], [1920, 1080]]) {
  test(`source-styled active board fits six players at ${width}x${height}`, async t => {
    const players = [waitingPlayer('me', 'Me', { count: 13, total: 20 }),
      waitingPlayer('other', 'Friend', { count: 13, total: 40 }),
      waitingPlayer('third', 'LongPlayerNameWithNoSpaces', { count: 13 }),
      waitingPlayer('fourth', 'Away friend', { count: 13, presence: 'away' }),
      waitingPlayer('fifth', 'Dropped friend', { count: 0, dropped: true, total: 20 }),
      waitingPlayer('sixth', 'Practice bot', { count: 13, bot: true })];
    const { page, room, errors } = await fixture(t, { width, height }, false, { players, turn: 'other' });
    await page.locator('.gameplay-page img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    assert.equal(await page.locator('.seats .seat').count(), 5);
    assert.equal(await page.locator('.seat.active .seat-turn').innerText(), 'Playing now');
    assert.match(await page.locator('[data-player-seat="other"] .seat-score').innerText(), /40 pts/);
    assert.match(await page.locator('.self-score').innerText(), /20 total penalty pts/);
    assert.equal(await page.locator('.hand-scroll [data-card]').count(), 13);
    assert.equal(await page.locator('.seats [data-card]').count(), 0);
    assert.equal(await page.locator('[data-draw="stock"]').isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('.seat, .hand-footer .button').evaluateAll(els => els.every(el => {
      const b = el.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && b.width > 0 && b.height > 0;
    })), true);
    for (const action of ['discard', 'declare']) {
      const box = await page.locator(`[data-action="${action}"] img`).boundingBox();
      assert.equal(box.width, 18); assert.equal(box.height, 18);
    }
    assert.match(await page.locator('.felt-table').evaluate(el => getComputedStyle(el, '::before').backgroundImage), /waiting-table.png/);
    if (process.env.UI_SCREENSHOT_DIR) {
      await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: resolve(process.env.UI_SCREENSHOT_DIR, `gameplay-${width}.png`), fullPage: true });
    }
    room.turn = 'me'; room.version++;
    await page.waitForFunction(() => !document.querySelector('[data-draw="stock"]').disabled);
    assert.equal(await page.locator('.seat.active').count(), 0);
    await page.locator('[data-draw="stock"]').click();
    await page.locator('[data-card="drawn"]').waitFor();
    await page.locator('[data-card="drawn"]').click();
    assert.equal(await page.locator('[data-action="discard"]').isDisabled(), false);
    await page.locator('[data-action="discard"]').click();
    await page.waitForFunction(() => !!document.querySelector('[data-player-seat="other"].active'));
    assert.equal(await page.locator('.hand-scroll [data-card]').count(), 13);
    assert.deepEqual(errors, []);
  });
}

for (const [width, height] of [[390, 844], [1920, 1080]]) {
  test(`connection notice preserves the hand and retries one snapshot at ${width}px`, async t => {
    const f = await fixture(t, { width, height }); const { page, room } = f;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('[data-card="card-0"]').click();
    await page.locator('#chat-input').fill('Unsent message');
    f.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.locator('#connection-banner').waitFor();
    await page.waitForFunction(() => !document.querySelector('#connection-retry').disabled);
    await page.locator('#connection-banner img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    assert.match(await page.locator('#connection-detail').innerText(), /Server timers keep running/);
    assert.equal(await page.locator('[data-draw="stock"]').isDisabled(), true);
    assert.equal(await page.locator('[data-card="card-0"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#chat-input').inputValue(), 'Unsent message');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    for (const [name, desktopSize] of [['connection-lost', 86], ['connection-loading', 56]]) {
      const dimensions = await page.locator(`#connection-banner img[src$="${name}.svg"]`).evaluate(el => ({ width: el.offsetWidth, height: el.offsetHeight }));
      // The lost-connection illustration intentionally shrinks at the mobile breakpoint.
      const expectedSize = name === 'connection-lost' && width <= 600 ? 52 : desktopSize;
      assert.equal(dimensions.width, expectedSize); assert.equal(dimensions.height, expectedSize);
    }
    if (process.env.UI_SCREENSHOT_DIR) {
      await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: resolve(process.env.UI_SCREENSHOT_DIR, `connection-lost-${width}.png`), fullPage: true });
    }
    assert.equal(await page.locator('.connection-progress img').evaluate(el => getComputedStyle(el).animationName), 'none');
    const started = f.holdNextPoll(); f.setOffline(false);
    await page.evaluate(() => { const retry = document.querySelector('#connection-retry'); retry.focus(); retry.click(); retry.click(); retry.click(); });
    await started;
    assert.equal(await page.locator('#connection-retry').isDisabled(), true);
    assert.match(await page.locator('#connection-title').innerText(), /Refreshing/);
    assert.equal(await page.locator('[data-draw="stock"]').isDisabled(), true);
    f.releasePoll();
    await page.waitForFunction(() => document.querySelector('#connection-banner').hidden);
    assert.equal(await page.locator('[data-draw="stock"]').isDisabled(), false);
    assert.equal(await page.locator('[data-card="card-0"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#chat-input').inputValue(), 'Unsent message');
    assert.equal(f.requests.length, 0);
    // Presence-only snapshots restyle the existing seat without replacing cards or chat input.
    const input = await page.locator('#chat-input').elementHandle();
    room.players[1].presence = 'away';
    await page.locator('[data-player-seat="other"][data-player-presence="away"]').waitFor();
    assert.equal(await input.evaluate(el => el === document.querySelector('#chat-input')), true);
    if (process.env.UI_SCREENSHOT_DIR) await page.screenshot({ path: resolve(process.env.UI_SCREENSHOT_DIR, `player-away-${width}.png`), fullPage: true });
    room.players[1].presence = 'offline';
    await page.locator('[data-player-seat="other"][data-player-presence="offline"]').waitFor();
    assert.equal(await page.locator('[data-presence-player="other"]').innerText(), 'Not responding');
    assert.deepEqual(f.errors, []);
  });
}

test('declaration feedback uses source styling and settings remain independent', async t => {
  const { page, room, errors } = await fixture(t, { width: 390, height: 844 });
  await page.locator('[data-draw="stock"]').click();
  await page.locator('[data-card="drawn"]').click();
  await page.locator('[data-action="declare"]').click();
  await page.locator('#confirm-yes').click();
  await page.locator('#game-dialog.declaration-notice').waitFor();
  assert.match(await page.locator('.declaration-feedback').innerText(), /pure sequence/);
  assert.equal(room.hand.length, 14);
  assert.equal(await page.locator('#game-dialog').evaluate(d => d.scrollWidth <= d.clientWidth), true);
  if (process.env.UI_SCREENSHOT_DIR) {
    await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: resolve(process.env.UI_SCREENSHOT_DIR, 'declaration-feedback-mobile.png'), fullPage: true });
  }
  await page.keyboard.press('Escape'); await open(page, 'Settings');
  assert.equal(await page.locator('#game-dialog').evaluate(d => d.classList.contains('declaration-notice')), false);
  await page.keyboard.press('Escape'); assert.deepEqual(errors, []);
});

for (const [width, height] of [[390, 844], [768, 1024], [1024, 768], [1920, 1080]]) {
  test(`chat drawer fits ${width}px and composes quick replies and emoji without sending`, async t => {
    const messages = [
      { id: 'hello', name: 'Friend', text: 'Good luck, everyone!', time: 1793901600000 },
      { id: 'long', name: 'FriendWithALongUnbrokenDisplayName', text: '<img src=x onerror=alert(1)> ' + 'LongMessage'.repeat(15), time: 1793901660000 },
    ];
    const f = await fixture(t, { width, height }, false, { messages }); const { page } = f;
    await page.locator('[data-card="card-0"]').click();
    await open(page, 'Chat');
    await page.locator('#game-dialog img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    assert.equal(await page.locator('.chat-quick-replies button').count(), 6);
    assert.equal(await page.locator('#dialog-chat-send').isDisabled(), true);
    assert.equal(await page.locator('#game-dialog .message img').count(), 0);
    assert.match(await page.locator('#game-dialog .message').last().innerText(), /<img src=x/);
    assert.equal(await page.locator('#game-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const bounds = await page.locator('#game-dialog').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1);
    for (const [asset, size] of [['chat-back', 36], ['chat-emoji', 40], ['chat-send', 40]]) {
      const box = await page.locator(`#game-dialog img[src$="${asset}.svg"]`).boundingBox();
      assert.equal(box.width, size); assert.equal(box.height, size);
    }
    if (process.env.UI_SCREENSHOT_DIR) {
      await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: resolve(process.env.UI_SCREENSHOT_DIR, `chat-replies-${width}.png`), fullPage: true });
    }
    await page.getByRole('button', { name: 'Well played!', exact: true }).click();
    assert.equal(await page.locator('#dialog-chat-input').inputValue(), 'Well played!');
    assert.equal(f.requests.length, 0);
    await page.locator('#dialog-chat-input').fill('Hello ');
    await page.getByRole('button', { name: 'Choose emoji' }).click();
    assert.equal(await page.locator('.chat-emoji-grid button').count(), 8);
    await page.getByRole('button', { name: 'Insert thumbs up' }).click();
    assert.equal(await page.locator('#dialog-chat-input').inputValue(), 'Hello 👍');
    assert.equal(await page.locator('#dialog-chat-count').innerText(), '8/240');
    assert.equal(f.requests.length, 0);
    if (process.env.UI_SCREENSHOT_DIR) await page.screenshot({ path: resolve(process.env.UI_SCREENSHOT_DIR, `chat-emoji-${width}.png`), fullPage: true });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#chat-input').inputValue(), 'Hello 👍');
    assert.equal(await page.locator('[data-card="card-0"]').getAttribute('aria-pressed'), 'true');
    await open(page, 'Settings');
    assert.equal(await page.locator('#game-dialog').getAttribute('data-panel'), 'settings');
    await page.keyboard.press('Escape'); assert.deepEqual(f.errors, []);
  });
}

test('chat insertion respects cursor selection and length limit; incoming messages preserve draft and history position', async t => {
  const messages = Array.from({ length: 30 }, (_, i) => ({ id: `old-${i}`, name: 'Friend', text: `Earlier message ${i}`, time: 1793901600000 + i * 60000 }));
  const f = await fixture(t, { width: 390, height: 844 }, false, { messages }); const { page, room } = f;
  await open(page, 'Chat');
  assert.equal(await page.locator('#dialog-messages').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop < 2), true);
  await page.locator('#dialog-chat-input').fill('Hello friend');
  await page.locator('#dialog-chat-input').evaluate(el => el.setSelectionRange(6, 12));
  await page.getByRole('button', { name: 'Choose emoji' }).click();
  await page.getByRole('button', { name: 'Insert thumbs up' }).click();
  assert.equal(await page.locator('#dialog-chat-input').inputValue(), 'Hello 👍');
  await page.locator('#dialog-chat-input').fill('x'.repeat(240));
  await page.getByRole('button', { name: 'Insert heart' }).click();
  assert.equal((await page.locator('#dialog-chat-input').inputValue()).length, 240);
  assert.match(await page.locator('#toast').innerText(), /240/);
  await page.locator('#dialog-chat-input').fill('A draft while reading');
  await page.locator('#dialog-chat-input').evaluate(el => el.setSelectionRange(2, 7));
  await page.locator('#dialog-messages').evaluate(el => { el.scrollTop = 0; });
  room.messages.push({ id: 'incoming', name: 'Friend', text: 'Incoming update', time: 1793903500000 }); room.version++;
  await page.locator('#dialog-messages').getByText('Incoming update', { exact: true }).waitFor({ state: 'attached' });
  assert.equal(await page.locator('#dialog-chat-input').inputValue(), 'A draft while reading');
  assert.deepEqual(await page.locator('#dialog-chat-input').evaluate(el => [el.selectionStart, el.selectionEnd]), [2, 7]);
  assert.equal(await page.locator('#dialog-messages').evaluate(el => el.scrollTop), 0);
  assert.equal(await page.locator('#chat-emoji-toggle').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'dialog-chat-input');
  assert.equal(f.requests.length, 0); assert.deepEqual(f.errors, []);
});

test('rejected and pending chat sends retain drafts and do not send twice', async t => {
  const f = await fixture(t); const { page, requests, room } = f;
  await open(page, 'Chat');
  await page.locator('#dialog-chat-input').fill('Retry this draft');
  f.rejectNextChat(); await page.locator('#dialog-chat-send').click();
  await page.locator('#toast.error').waitFor();
  await page.waitForFunction(() => document.querySelector('#dialog-chat-input').value === 'Retry this draft' && !document.querySelector('#dialog-chat-send').disabled);
  assert.equal(await page.locator('#dialog-chat-count').innerText(), '16/240');
  assert.equal(requests.length, 1); assert.equal(room.messages.length, 0);
  f.hold(); await page.locator('#dialog-chat-send').click();
  await page.waitForFunction(() => document.querySelector('#dialog-chat-send').disabled);
  await page.locator('#dialog-chat-send').evaluate(el => { el.click(); el.click(); });
  assert.equal(requests.length, 2);
  await page.locator('#dialog-chat-input').fill('Newer draft');
  f.release(); await page.waitForFunction(() => !document.querySelector('#dialog-chat-send').disabled);
  assert.equal(await page.locator('#dialog-chat-input').inputValue(), 'Newer draft');
  assert.equal(room.messages.length, 1); assert.equal(room.messages[0].text, 'Retry this draft');
  assert.equal(requests.length, 2); assert.deepEqual(f.errors, []);
});

for (const [width, height] of [[390, 844], [768, 1024], [1024, 768], [1920, 1080]]) {
  test(`source settings fit ${width}px and display preferences persist after reload`, async t => {
    const f = await fixture(t, { width, height }); const { page } = f;
    await open(page, 'Settings');
    await page.locator('#game-dialog img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    assert.equal(await page.locator('[data-settings-panel="lastDeal"]').isDisabled(), true);
    assert.equal(await page.getByRole('checkbox').count(), 2);
    assert.match(await page.locator('.settings-option-unavailable').innerText(), /Game Music.*not available/s);
    for (const asset of ['settings-info', 'settings-music', 'settings-cards']) {
      const box = await page.locator(`#game-dialog img[src$="${asset}.svg"]`).boundingBox();
      assert.equal(box.width, 40); assert.equal(box.height, 40);
    }
    const back = await page.locator('#game-dialog img[src$="chat-back.svg"]').boundingBox();
    assert.equal(back.width, 36); assert.equal(back.height, 36);
    assert.equal(await page.locator('#game-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.UI_SCREENSHOT_DIR) {
      await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: resolve(process.env.UI_SCREENSHOT_DIR, `settings-${width}.png`), fullPage: true });
    }
    await page.getByLabel('Spread out hand cards', { exact: true }).check();
    await page.getByLabel('Reduce motion', { exact: true }).check();
    assert.match(await page.locator('#settings-save-status').innerText(), /Saved on this browser/);
    assert.equal(await page.locator('html').evaluate(el => el.classList.contains('roomy-cards') && el.classList.contains('quiet-motion')), true);
    await page.keyboard.press('Escape'); await page.reload(); await page.locator('#connection').waitFor();
    await open(page, 'Settings');
    assert.equal(await page.getByLabel('Spread out hand cards', { exact: true }).isChecked(), true);
    assert.equal(await page.getByLabel('Reduce motion', { exact: true }).isChecked(), true);
    assert.equal(f.requests.length, 0); assert.deepEqual(f.errors, []);
  });
}

test('settings remain usable offline and a completed round unlocks last deal without replacing focused preferences', async t => {
  const f = await fixture(t); const { page, room } = f;
  await open(page, 'Settings');
  const preference = page.getByLabel('Reduce motion', { exact: true }); await preference.focus();
  const element = await preference.elementHandle();
  room.history = [{ round: 1, winner: '<img src=x onerror=alert(1)>', scores: [{ name: '<script>Friend</script>', penalty: 0, total: 20 }, { name: 'Me', penalty: 40, total: 60 }] }]; room.version++;
  await page.waitForFunction(() => !document.querySelector('[data-settings-panel="lastDeal"]').disabled);
  assert.equal(await element.evaluate(el => el === document.activeElement), true);
  await page.locator('[data-settings-panel="lastDeal"]').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'game-panel-title');
  assert.match(await page.locator('.last-deal-summary').innerText(), /<img src=x/);
  assert.equal(await page.locator('#game-dialog .card, #game-dialog script').count(), 0);
  assert.equal(await page.locator('#game-dialog img').count(), 1);
  assert.equal(await page.locator('#game-dialog tbody tr').count(), 2);
  if (process.env.UI_SCREENSHOT_DIR) {
    await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: resolve(process.env.UI_SCREENSHOT_DIR, 'settings-last-deal-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: resolve(process.env.UI_SCREENSHOT_DIR, 'settings-last-deal-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1920, height: 1080 });
  }
  await page.getByRole('button', { name: 'Back to settings', exact: true }).click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'game-panel-title');
  await page.locator('[data-settings-panel="information"]').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'game-panel-title');
  assert.match(await page.locator('#game-dialog').innerText(), /60 seconds/);
  await page.getByRole('button', { name: 'Back to settings', exact: true }).click();
  f.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByLabel('Reduce motion', { exact: true }).check();
  assert.equal(await page.getByLabel('Reduce motion', { exact: true }).isChecked(), true);
  assert.equal(f.requests.length, 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.connection-progress img').evaluate(el => getComputedStyle(el).animationName), 'none');
  f.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => document.querySelector('#connection-banner').hidden);
  assert.deepEqual(f.errors, []);
});

test('settings explain unavailable browser storage and isolate styling from other panels', async t => {
  const f = await fixture(t, { width: 390, height: 844 }); const { page } = f;
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'mr-preferences') throw new DOMException('Blocked', 'QuotaExceededError'); return original.call(this, key, value); };
  });
  await open(page, 'Settings');
  await page.getByLabel('Spread out hand cards', { exact: true }).check();
  assert.match(await page.locator('#settings-save-status').innerText(), /Applied for this visit.*unavailable/);
  await page.keyboard.press('Escape'); await open(page, 'Settings');
  assert.equal(await page.getByLabel('Spread out hand cards', { exact: true }).isChecked(), true);
  assert.match(await page.locator('#settings-save-status').innerText(), /Applied for this visit/);
  await page.keyboard.press('Escape'); await open(page, 'Chat');
  assert.equal(await page.locator('#game-dialog').getAttribute('data-panel'), 'chat');
  assert.equal(await page.locator('.settings-options').count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(f.requests.length, 0); assert.deepEqual(f.errors, []);
});

for (const [width, height] of [[390, 844], [768, 1024], [1024, 768], [1920, 1080]]) {
  test(`game information fits ${width}px and describes supported rules without exposing cards`, async t => {
    const f = await fixture(t, { width, height }, false, { hasPassword: true }); const { page } = f;
    await open(page, 'Table info');
    await page.locator('#game-dialog img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    await page.evaluate(async () => { const img = new Image(); img.src = '/assets/figma/info-title.svg'; await img.decode(); if (!img.naturalWidth || !img.naturalHeight) throw Error('Missing information title artwork'); });
    assert.equal(await page.locator('#game-dialog .card, #game-dialog [data-draw]').count(), 0);
    const facts = await page.locator('.info-fact').evaluateAll(els => Object.fromEntries(els.map(el => [el.querySelector('dt').textContent, el.querySelector('dd').textContent])));
    assert.equal(await page.locator('.info-overview > span').count(), 3);
    assert.match(await page.locator('.info-overview').innerText(), /60 seconds/);
    assert.equal(await page.locator('.info-facts').getAttribute('aria-labelledby'), 'info-facts-heading');
    assert.equal(facts['No. of decks'], '2 packs');
    assert.equal(facts['Printed jokers'], '1 per deck · 2 total');
    assert.equal(facts['Human turns'], '60 seconds · Server timed');
    assert.equal(facts['First drop'], '20 penalty points');
    assert.equal(facts['Middle drop'], '40 penalty points');
    assert.equal(facts['Maximum round penalty'], '80 points');
    assert.equal(facts['Stakes'], 'Free play · No money involved');
    assert.match(facts.Privacy, /Password protected/);
    assert.match(await page.locator('#game-panel-title').evaluate(el => getComputedStyle(el).backgroundImage), /info-title.svg/);
    const icon = await page.locator('#game-dialog img[src$="info-close.svg"]').boundingBox();
    assert.equal(icon.width, 40); assert.equal(icon.height, 40);
    assert.equal(await page.locator('#game-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.UI_SCREENSHOT_DIR) {
      await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: resolve(process.env.UI_SCREENSHOT_DIR, `game-information-${width}.png`), fullPage: true });
    }
    for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => !!document.activeElement.closest('#game-dialog')), true); }
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#game-dialog').evaluate(el => el.open), false);
    assert.equal(f.requests.length, 0); assert.deepEqual(f.errors, []);
  });
}

test('information facts refresh without losing close-button focus and Settings return navigation works', async t => {
  const f = await fixture(t); const { page, room } = f;
  await open(page, 'Settings'); await page.locator('[data-settings-panel="information"]').click();
  await page.getByRole('button', { name: 'Close table panel', exact: true }).focus();
  room.players.push(waitingPlayer('newcomer', 'New friend', { count: 13 })); room.round = 2; room.hasPassword = true; room.version++;
  await page.waitForFunction(() => [...document.querySelectorAll('.info-fact')].some(el => el.querySelector('dt').textContent === 'Players' && el.querySelector('dd').textContent === '3 / 6'));
  assert.match(await page.locator('.info-facts').innerText(), /Round 2/);
  assert.match(await page.locator('.info-facts').innerText(), /Password protected/);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Close table panel');
  await page.getByRole('button', { name: 'Back to settings', exact: true }).click();
  assert.equal(await page.locator('#game-dialog').getAttribute('data-panel'), 'settings');
  assert.equal(await page.getByLabel('Reduce motion', { exact: true }).isVisible(), true);
  await page.keyboard.press('Escape'); await open(page, 'Chat');
  assert.equal(await page.locator('#game-dialog').getAttribute('data-panel'), 'chat');
  assert.equal(await page.locator('.info-facts').count(), 0);
  assert.equal(f.requests.length, 0); assert.deepEqual(f.errors, []);
});

test('information follows the selected table and its waiting state', async t => {
  const f = await fixture(t, { width: 390, height: 844 }, true, { hasPassword: true }); const { page, rooms } = f;
  const second = rooms.get('BBBBBB123456'); second.hasPassword = false; second.status = 'lobby'; second.round = 0; second.hand = []; second.version++;
  await open(page, 'Table info');
  assert.match(await page.locator('.info-room-summary').innerText(), /ABCDEF123456/);
  assert.match(await page.locator('.info-facts').innerText(), /Password protected/);
  await page.keyboard.press('Escape');
  await page.locator('[data-switch-table="BBBBBB123456"]').click(); await page.locator('.waiting-page').waitFor();
  await open(page, 'Table info');
  assert.match(await page.locator('.info-room-summary').innerText(), /BBBBBB123456/);
  assert.equal(await page.locator('#info-status').innerText(), 'Waiting for players');
  assert.match(await page.locator('.info-facts').innerText(), /Not started/);
  assert.doesNotMatch(await page.locator('#game-panel-content').innerText(), /ABCDEF123456|Password protected/);
  assert.equal(f.requests.length, 0); assert.deepEqual(f.errors, []);
});

for (const [width, height] of [[390, 844], [768, 1024], [1024, 768], [1920, 1080]]) {
  test(`standings fit six seats at ${width}px with tied ranks and public totals only`, async t => {
    const players = [waitingPlayer('me', 'Me', { total: 20, count: 13 }),
      waitingPlayer('other', 'Alpha', { total: 0, count: 13 }),
      waitingPlayer('third', 'Beta', { total: 0, count: 13 }),
      waitingPlayer('fourth', 'VeryLongUnbrokenPlayerDisplayName', { total: 80, count: 13 }),
      waitingPlayer('fifth', 'Practice bot', { total: 40, bot: true, count: 13 }),
      waitingPlayer('sixth', '<script>Friend</script>', { total: 25, count: 13 })];
    const f = await fixture(t, { width, height }, false, { players }); const { page } = f;
    await open(page, 'Standings');
    await page.locator('#game-dialog img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    const places = await page.locator('[data-standing-player] .standing-place>span').allTextContents();
    assert.deepEqual(places, ['1', '1', '3', '4', '5', '6']);
    assert.equal(await page.locator('.standing-place small').count(), 2);
    assert.match(await page.locator('[data-standing-player="me"]').innerText(), /You/);
    assert.equal(await page.locator('#game-dialog .card, #game-dialog script').count(), 0);
    assert.equal(await page.locator('.standing-winner').count(), 0);
    assert.equal(await page.locator('.standing-rank-badge').count(), 6);
    assert.equal(await page.locator('.standings-table tr[aria-current="true"]').count(), 1);
    assert.equal(await page.locator('.standings-table .standing-top-1').count() >= 1, true);
    assert.equal(await page.locator('.standing-round [aria-label="Not settled"]').count(), 6);
    assert.match(await page.locator('[data-standing-player="sixth"]').innerText(), /<script>Friend<\/script>/);
    assert.equal(await page.locator('#game-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await page.locator('.standings-table-wrap').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const icon = await page.locator('#game-dialog img[src$="info-close.svg"]').boundingBox();
    assert.equal(icon.width, 40); assert.equal(icon.height, 40);
    if (process.env.UI_SCREENSHOT_DIR) {
      await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: resolve(process.env.UI_SCREENSHOT_DIR, `standings-${width}.png`), fullPage: true });
    }
    await page.locator('#standings-back').scrollIntoViewIfNeeded(); await page.locator('#standings-back').click();
    assert.equal(await page.locator('#game-dialog').evaluate(el => el.open), false);
    assert.equal(f.requests.length, 0); assert.deepEqual(f.errors, []);
  });
}

test('standings distinguish the round winner from cumulative rank and clear revealed cards on a new round', async t => {
  const hands = Array.from({ length: 2 }, (_, p) => Array.from({ length: 13 }, (_, i) => ({ id: `revealed-${p}-${i}`, suit: p ? 'S' : 'H', rank: i + 1 })));
  const result = { winner: 'other', winnerName: 'Friend', reason: 'last-player', groups: [], scores: [
    { id: 'me', name: 'Me', penalty: 20, total: 20, hand: hands[0] },
    { id: 'other', name: 'Friend', penalty: 0, total: 50, hand: hands[1] },
  ] };
  const players = [waitingPlayer('me', 'Me', { total: 20, count: 13 }), waitingPlayer('other', 'Friend', { total: 50, count: 13 })];
  const f = await fixture(t, { width: 1920, height: 1080 }, false, { players, status: 'finished', deadline: 0, result, hand: hands[0] }); const { page, room } = f;
  await open(page, 'Standings');
  assert.equal(await page.locator('[data-standing-player="me"] .standing-place>span').innerText(), '1');
  assert.equal(await page.locator('[data-standing-player="other"] .standing-place>span').innerText(), '2');
  assert.equal(await page.locator('[data-standing-player="other"] .standing-round').innerText(), '0');
  assert.equal(await page.locator('[data-standing-player="other"] .standing-winner').innerText(), 'Round winner');
  assert.equal(await page.locator('[data-standing-player="me"] .standing-winner').count(), 0);
  await page.locator('#standings-reveal-toggle').click();
  assert.equal(await page.locator('.standings-revealed .card').count(), 26);
  room.messages.push({ id: 'update', name: 'Me', text: 'Round reviewed', time: Date.now() }); room.version++;
  await page.waitForFunction(() => document.querySelector('#game-dialog .standings-revealed')?.open && document.querySelector('#messages')?.textContent.includes('Round reviewed'));
  assert.equal(await page.locator('.standings-revealed').evaluate(el => el.open), true);
  if (process.env.UI_SCREENSHOT_DIR) {
    await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: resolve(process.env.UI_SCREENSHOT_DIR, 'standings-revealed-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: resolve(process.env.UI_SCREENSHOT_DIR, 'standings-revealed-mobile.png'), fullPage: true });
  }
  room.status = 'playing'; room.result = null; room.round = 2; room.version++; room.deadline = Date.now() + 60000;
  await page.waitForFunction(() => !document.querySelector('#game-dialog .standings-revealed'));
  assert.equal(await page.locator('#game-dialog .card').count(), 0);
  assert.equal(await page.locator('.standing-winner').count(), 0);
  assert.match(await page.locator('.standings-footer').innerText(), /Round 2 in progress/);
  assert.equal(f.requests.length, 0); assert.deepEqual(f.errors, []);
});

test('live standings reorder without losing close focus and stay scoped when switching tables', async t => {
  const f = await fixture(t, { width: 390, height: 844 }, true); const { page, room, rooms } = f;
  await open(page, 'Standings'); await page.getByRole('button', { name: 'Close table panel', exact: true }).focus();
  room.players[0].total = 40; room.players[1].total = 10; room.version++;
  await page.waitForFunction(() => document.querySelector('[data-standing-player]')?.dataset.standingPlayer === 'other');
  assert.equal(await page.locator('[data-standing-player="me"] .standing-total').innerText(), '40');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Close table panel');
  await page.keyboard.press('Escape');
  const second = rooms.get('BBBBBB123456'); second.players[0].total = 5; second.players[1].total = 60; second.version++;
  await page.locator('[data-switch-table="BBBBBB123456"]').click(); await open(page, 'Standings');
  assert.match(await page.locator('.standings-summary').innerText(), /BBBBBB123456/);
  assert.equal(await page.locator('[data-standing-player="me"] .standing-total').innerText(), '5');
  assert.doesNotMatch(await page.locator('.standings-summary').innerText(), /ABCDEF123456/);
  await page.keyboard.press('Escape'); await open(page, 'Settings');
  assert.equal(await page.locator('#game-dialog').getAttribute('data-panel'), 'settings');
  assert.equal(await page.locator('.standings-table').count(), 0);
  assert.equal(f.requests.length, 0); assert.deepEqual(f.errors, []);
});

for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [1920, 1080]]) {
  test(`private View Cards at ${width}px shows all 14 faces without overlap or horizontal scroll`, async t => {
    const hand = Array.from({ length: 14 }, (_, i) => ({ id: `inspect-${i}`, rank: i === 13 ? 0 : i + 1, suit: i === 13 ? 'J' : 'D' }));
    const f = await fixture(t, { width, height }, false, { hand, phase: 'discard' }); const { page } = f;
    await open(page, 'View cards');
    assert.equal(await page.locator('#game-dialog .card').count(), 14);
    assert.equal(await page.locator('#game-dialog button[data-card]').count(), 0);
    assert.equal(await page.locator('#game-dialog .joker').count(), 1);
    assert.equal(await page.locator('#game-dialog .wild-badge').count(), 1);
    assert.match(await page.locator('.hand-view-summary').innerText(), /14 cards/);
    assert.doesNotMatch(await page.locator('#game-panel-title').evaluate(el => getComputedStyle(el).fontFamily), /Georgia/);
    assert.match(await page.locator('#hand-view-note').innerText(), /timer keeps running/);
    assert.equal(await page.locator('#game-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const boxes = await page.locator('.hand-view-groups .card').evaluateAll(cards => cards.map(c => {
      const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    }));
    for (const [i, a] of boxes.entries()) {
      assert.equal(a.width, width <= 600 ? 57 : 72); assert.equal(a.height, width <= 600 ? 82 : 104);
      for (const b of boxes.slice(i + 1)) assert.ok(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y);
    }
    if (process.env.UI_SCREENSHOT_DIR) {
      await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: resolve(process.env.UI_SCREENSHOT_DIR, `view-cards-${width}.png`), fullPage: true });
    }
    await page.locator('#hand-view-back').scrollIntoViewIfNeeded();
    if (process.env.UI_SCREENSHOT_DIR && width <= 390) await page.screenshot({ path: resolve(process.env.UI_SCREENSHOT_DIR, `view-cards-bottom-${width}.png`), fullPage: true });
    await page.locator('#hand-view-back').click();
    assert.equal(await page.locator('#game-dialog').evaluate(d => d.open), false);
    assert.equal(f.requests.length, 0); assert.deepEqual(f.errors, []);
  });
}

test('View Cards preserves real groups and selection while live snapshots remove stale cards', async t => {
  const f = await fixture(t); const { page, room } = f;
  for (const id of ['card-0', 'card-1', 'card-2']) await page.locator(`[data-card="${id}"]`).click();
  await page.locator('[data-action="group"]').click();
  await page.locator('[data-card="card-3"]').click();
  await open(page, 'View cards');
  assert.deepEqual(await page.locator('.hand-view-group-heading h3').allTextContents(), ['Your group', 'Ungrouped']);
  assert.deepEqual(await page.locator('.hand-view-group-heading>span').allTextContents(), ['3 cards', '10 cards']);
  await page.locator('#hand-view-back').focus();
  room.hand = room.hand.filter(c => c.id !== 'card-0'); room.version++;
  await page.waitForFunction(() => document.querySelectorAll('#game-dialog .card').length === 12);
  assert.deepEqual(await page.locator('.hand-view-group-heading>span').allTextContents(), ['2 cards', '10 cards']);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'hand-view-back');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-card="card-3"]').getAttribute('aria-pressed'), 'true');
  assert.equal(f.requests.length, 0); assert.deepEqual(f.errors, []);
});

test('View Cards follows empty hands, rematches and table privacy without carrying stale cards', async t => {
  const f = await fixture(t, { width: 390, height: 844 }, true); const { page, room } = f;
  await open(page, 'View cards');
  room.hand = []; room.version++;
  await page.locator('.hand-view-empty').waitFor();
  assert.equal(await page.locator('#game-dialog .card').count(), 0);
  assert.match(await page.locator('.hand-view-summary').innerText(), /0 cards/);
  room.round = 2; room.hand = [{ id: 'new-round-card', rank: 12, suit: 'C' }]; room.wildRank = 12; room.players[0].dropped = true; room.version++;
  await page.waitForFunction(() => document.querySelector('.hand-view-summary')?.textContent.includes('ROUND 2'));
  assert.equal(await page.locator('#game-dialog .card').count(), 1);
  assert.equal(await page.locator('#game-dialog .card').getAttribute('aria-label'), 'Q clubs');
  assert.match(await page.locator('.hand-view-summary').innerText(), /Dropped/);
  assert.equal(await page.locator('#game-dialog .wild-badge').count(), 1);
  await page.keyboard.press('Escape');
  await page.locator('[data-switch-table="BBBBBB123456"]').click(); await open(page, 'View cards');
  assert.match(await page.locator('.hand-view-summary').innerText(), /BBBBBB123456/);
  assert.equal(await page.locator('#game-dialog .card').count(), 13);
  assert.equal(await page.locator('#game-dialog .red').count(), 0);
  assert.doesNotMatch(await page.locator('#game-dialog').innerText(), /Dropped/);
  await page.keyboard.press('Escape'); await open(page, 'Settings');
  assert.equal(await page.locator('.hand-view-groups').count(), 0);
  assert.equal(f.requests.length, 0); assert.deepEqual(f.errors, []);
});


test('house rules and add-table dialogs expose clear headings and fit mobile', async t => {
  const { page, errors } = await fixture(t, { width: 390, height: 844 });
  await open(page, 'Learn rummy');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#rules-dialog').getAttribute('aria-labelledby'), 'rules-dialog-title');
  assert.match(await page.locator('.rules-lead').innerText(), /essentials/i);
  assert.equal(await page.locator('#rules-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  assert.match(await page.locator('.tables-dialog-hint').innerText(), /invite code/i);
  assert.equal(await page.locator('#tables-dialog').getAttribute('aria-labelledby'), 'tables-dialog-title');
  assert.deepEqual(errors, []);
});


test('confirmation, invitation and mobile guide dialogs have accessible headings and responsive content', async t => {
  const { page, errors } = await fixture(t, { width: 390, height: 844 });
  for (const [id, heading] of [['confirm-dialog', 'confirm-title'], ['invite-dialog', 'invite-dialog-title'], ['mobile-dialog', 'mobile-dialog-title']]) {
    assert.equal(await page.locator('#' + id).getAttribute('aria-labelledby'), heading);
  }
  assert.equal(await page.locator('#confirm-dialog').getAttribute('aria-describedby'), 'confirm-text');
  assert.equal(await page.locator('#invite-dialog .invite-steps > span').count(), 3);
  assert.equal(await page.locator('#mobile-dialog .mobile-guide-quick > span').count(), 2);
  for (const id of ['confirm-dialog', 'invite-dialog', 'mobile-dialog']) {
    const width = await page.locator('#' + id).evaluate(el => {
      const prior = el.style.display; el.style.display = 'block';
      const result = el.getBoundingClientRect().width; el.style.display = prior; return result;
    });
    assert.equal(width <= 390, true, id + ' overflows mobile viewport');
  }
  assert.deepEqual(errors, []);
});


test('profile, hand and last-deal screens expose accessible region names', async t => {
  const { page, errors } = await fixture(t, { width: 390, height: 844 });
  assert.equal(await page.locator('#profile-dialog').getAttribute('aria-label'), 'Your player profile');
  await open(page, 'View cards');
  assert.equal(await page.locator('.hand-view-groups').getAttribute('aria-label'), 'Your arranged hand');
  assert.equal(await page.locator('#game-dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
});


test('account and table navigation expose accessible names on mobile', async t => {
  const { page, errors } = await fixture(t, { width: 390, height: 844 });
  assert.equal(await page.locator('.table-switcher').getAttribute('aria-label'), 'Joined tables');
  assert.equal(await page.locator('.table-switcher').getAttribute('tabindex'), '0');
  assert.equal(await page.locator('.table-switcher').evaluate(el => el.clientWidth <= 390), true);
  assert.deepEqual(errors, []);
});

test('home navigation preserves private card selection and local groups when rejoining', async t => {
  const { page, room, requests, errors } = await fixture(t, { width: 390, height: 844 }, true);
  await page.locator('[data-card="card-0"]').click();
  await page.locator('[data-home]').click();
  await page.locator('.home-table').first().waitFor();
  assert.equal(await page.locator('[data-card]').count(), 0);
  assert.equal(await page.locator('.home-table').count(), 2);
  assert.equal(await page.locator('[data-home-tab="joined"]').getAttribute('aria-current'), 'page');
  await page.locator('[data-home-tab="points"]').click();
  await page.locator('.home-intro').waitFor();
  await waitingScreenshot(page, 'home-points-mobile');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator(`[data-switch-table="${room.code}"]`).click();
  await page.locator('[data-card="card-0"][aria-pressed="true"]').waitFor();
  assert.equal(requests.length, 0);
  assert.deepEqual(errors, []);
});

for (const viewport of [{ width: 360, height: 800 }, { width: 768, height: 1024 }, { width: 1920, height: 1080 }]) {
  test(`empty lobby supports tabs, locally bundled artwork and create/join at ${viewport.width}px`, async t => {
    const { page, rooms, errors } = await fixture(t, viewport, false, {}, { empty: true });
    await page.getByText('No tables joined yet', { exact: true }).waitFor();
    await waitingScreenshot(page, `home-points-empty-${viewport.width}`);
    await page.locator('[data-home-tab="joined"]').click();
    assert.equal(await page.locator('.home-table').count(), 0);
    await waitingScreenshot(page, `home-joined-empty-${viewport.width}`);
    assert.equal(await page.locator('[data-home-entry="join"]').isEnabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    for (const img of await page.locator('.home-tabs img').all()) {
      assert.equal(await img.evaluate(el => el.complete && el.naturalWidth > 0), true);
    }
    await page.locator('[data-home-entry="join"]').click();
    await page.locator('#new-table-code').fill('DDDDDD123456');
    await page.locator('#new-table-password').fill('wrong');
    await page.locator('#table-entry-submit').click();
    await page.waitForFunction(() => document.querySelector('#table-entry-error').textContent.includes('Incorrect'));
    assert.equal(await page.locator('#new-table-code').inputValue(), 'DDDDDD123456');
    await page.locator('#new-table-password').fill('friends');
    await page.locator('#table-entry-submit').click();
    await page.waitForURL('**/?room=DDDDDD123456');
    assert.equal(rooms.size, 1);
    await page.locator('[data-home]').click();
    await page.locator('[data-home-entry="create"]').click();
    await page.locator('#table-entry-submit').click();
    await page.waitForURL('**/?room=CCCCCC123456');
    assert.equal(rooms.size, 2);
    assert.deepEqual(errors, []);
  });
}

test('invite links prefill the shared join form from an empty lobby', async t => {
  const { page } = await fixture(t, undefined, false, {}, { empty: true, invite: 'DDDDDD123456' });
  await page.locator('#tables-dialog[open]').waitFor();
  assert.equal(await page.locator('#new-table-code').inputValue(), 'DDDDDD123456');
  assert.notEqual(await page.locator('#new-table-code').getAttribute('required'), null);
});

test('home respects the table cap and resynchronizes before actions after disconnection', async t => {
  const f = await fixture(t, undefined, true); const { page } = f;
  await page.locator('[data-home]').click();
  await page.locator('[data-home-entry="create"]').click();
  await page.locator('#table-entry-submit').click();
  await page.waitForURL('**/?room=CCCCCC123456');
  await page.locator('[data-home]').click();
  assert.equal(await page.locator('[data-home-entry="join"]').isDisabled(), true);
  assert.equal(await page.locator('[data-home-entry="create"]').isDisabled(), true);
  f.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  assert.equal(await page.locator('[data-switch-table]').first().isDisabled(), true);
  f.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => !document.querySelector('[data-switch-table]').disabled);
  assert.equal(await page.locator('[data-home-entry="create"]').isDisabled(), true);
  assert.equal(await page.locator('.home-table').count(), 3);
});

async function accountFixture(t, viewport) {
  const f = await fixture(t, viewport);
  const profile = { ...f.room.account, id: 'me', username: 'me', avatar: null, wins: 21, roundsPlayed: 21, points: 12100 };
  const events = Array.from({ length: 21 }, (_, i) => ({ id: `event-${i}`, type:'win', round:21-i, room:f.room.code, time:Date.now()-i*1000, amount:100, balance:12100-i*100, opponents:1, match:{winner:'Me',penalty:0,totalPenalty:20,reason:'last-player'} }));
  let failSave = false;
  await f.page.route('http://rummy.test/api/profile*', async route => {
    if (route.request().method() === 'POST') {
      if (failSave) { failSave = false; return route.fulfill({ status:400, json:{error:'Please try another avatar.'} }); }
      profile.avatar = route.request().postDataJSON().avatar;
      f.room.account = { ...profile }; f.room.players[0].avatar = profile.avatar;
    }
    const params = new URL(route.request().url()).searchParams;
    const filter = params.get('filter') || 'all', offset = Number(params.get('offset') || 0);
    const filtered = ['all','win'].includes(filter) ? events : [];
    return route.fulfill({ json:{...profile, history:filtered.slice(offset,offset+20),historyTotal:filtered.length,historyAllTotal:events.length,historyFilter:filter,historyOffset:offset} });
  });
  return { ...f, profile, failSave: () => { failSave = true; } };
}

for (const viewport of [{width:390,height:844}, {width:768,height:1024}, {width:1920,height:1080}]) {
  test(`account avatar and round history stay usable at ${viewport.width}px`, async t => {
    const { page, profile, errors } = await accountFixture(t, viewport);
    await page.locator('#profile-button').click();
    await page.locator('.profile-identity').waitFor();
    await page.locator('[data-history-filter="win"]').click();
    await page.waitForFunction(() => document.querySelector('[data-history-filter="win"]').getAttribute('aria-current') === 'page');
    await page.locator('[data-profile-page="older"]').click();
    await page.waitForFunction(() => document.querySelector('.history-pages').textContent.includes('21–21'));
    await page.locator('.profile-event summary').click();
    assert.match(await page.locator('.profile-event-detail').innerText(), /Your round penalty/);
    assert.equal(await page.locator('#profile-dialog [data-card]').count(), 0);
    await page.getByText('Change avatar', {exact:true}).click();
    await page.getByLabel('Avatar 3', {exact:true}).check();
    await page.getByRole('button', {name:'Save avatar',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('#avatar-status').textContent.includes('saved to your account'));
    assert.equal(profile.avatar, 3);
    assert.match(await page.locator('.profile-portrait').getAttribute('src'), /avatar-3.svg$/);
    assert.equal(await page.locator('[data-history-filter="win"]').getAttribute('aria-current'), 'page');
    assert.match(await page.locator('.history-pages').innerText(), /21–21/);
    assert.equal(await page.locator('#profile-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    await page.locator('#profile-dialog img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    await waitingScreenshot(page, `account-avatar-history-${viewport.width}`);
    await page.locator('[data-history-filter="loss"]').click();
    await page.getByText('No activity in this category yet. Your completed rounds will appear here.').waitFor();
    assert.match(await page.locator('.history-pages').innerText(), /0–0 of 0/);
    await page.locator('[data-close="profile-dialog"]').click();
    assert.match(await page.locator('[data-avatar-player="me"]').first().getAttribute('src'), /avatar-3.svg$/);
    await page.reload(); await page.locator('#connection').waitFor();
    await page.locator('#profile-button').click();
    await page.locator('.profile-identity').waitFor();
    assert.match(await page.locator('.profile-portrait').getAttribute('src'), /avatar-3.svg$/);
    assert.deepEqual(errors, []);
  });
}

test('rejected avatar saves keep the selection and allow a deliberate retry', async t => {
  const f = await accountFixture(t); const {page, profile} = f;
  await page.locator('#profile-button').click(); await page.locator('.profile-identity').waitFor();
  await page.getByText('Change avatar', {exact:true}).click();
  await page.getByLabel('Avatar 4', {exact:true}).check();
  f.failSave(); await page.getByRole('button', {name:'Save avatar',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('#avatar-status').textContent.includes('Could not confirm'));
  assert.equal(profile.avatar, null);
  assert.equal(await page.getByLabel('Avatar 4', {exact:true}).isChecked(), true);
  assert.equal(await page.getByRole('button', {name:'Save avatar',exact:true}).isEnabled(), true);
  await page.getByRole('button', {name:'Save avatar',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('#avatar-status').textContent.includes('saved to your account'));
  assert.equal(profile.avatar, 4);
});

async function settingsFixture(t, viewport) {
  const f = await accountFixture(t, viewport);
  const receipts = new Map(), submissions = [];
  let uncertain = false;
  await f.page.route('http://rummy.test/api/username', async route => {
    const input = route.request().postDataJSON();
    if (input.currentPassword !== 'test-password-long') return route.fulfill({status:400,json:{error:'Incorrect username or password.'}});
    f.profile.username = input.username.toLowerCase(); f.room.account = {...f.profile};
    return route.fulfill({json:f.profile});
  });
  await f.page.route('http://rummy.test/api/feedback*', async route => {
    if (route.request().method() === 'GET') {
      const receipt = receipts.get(new URL(route.request().url()).searchParams.get('id'));
      return receipt ? route.fulfill({json:receipt}) : route.fulfill({status:404,json:{error:'Submission not found.'}});
    }
    const input = route.request().postDataJSON(); submissions.push(input);
    if (!receipts.has(input.id)) receipts.set(input.id, {...input,time:Date.now(),status:'received'});
    if (uncertain) { uncertain = false; return route.abort(); }
    return route.fulfill({json:receipts.get(input.id)});
  });
  return {...f,receipts,submissions,uncertainSave:()=>{uncertain=true;}};
}

for (const viewport of [{width:360,height:800},{width:768,height:1024},{width:1920,height:1080}]) {
  test(`next account pages support username, suggestions and confirmation at ${viewport.width}px`, async t => {
    const {page,receipts,profile,errors}=await settingsFixture(t,viewport);
    await page.locator('#profile-button').click(); await page.locator('.profile-identity').waitFor();
    await page.locator('[data-account-view="username"]').click();
    await page.getByRole('heading',{name:'Change Username',exact:true}).waitFor();
    await page.locator('#new-username').fill('updated_name');
    await page.locator('#rename-password').fill('wrong-password');
    await page.getByRole('button',{name:'Save username',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#account-page-status').textContent.includes('Incorrect'));
    assert.equal(await page.locator('#new-username').inputValue(),'updated_name');
    assert.equal(await page.locator('#rename-password').inputValue(),'');
    await page.locator('#rename-password').fill('test-password-long');
    await page.getByRole('button',{name:'Save username',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#account-page-status').textContent.includes('Username saved'));
    assert.equal(profile.username,'updated_name');
    assert.equal(await page.locator('#account-pages-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
    await waitingScreenshot(page,`username-${viewport.width}`);
    await page.locator('#account-pages-dialog [data-account-back]').click();
    await page.locator('.profile-handle').filter({hasText:'@updated_name'}).waitFor();
    await page.locator('[data-account-view="feedback"]').click();
    await page.getByRole('heading',{name:'Suggestion Box',exact:true}).waitFor();
    await page.locator('#feedback-category').selectOption('issue');
    await page.locator('#feedback-message').fill('<script>alert(1)</script> Improve the table layout.');
    await waitingScreenshot(page,`suggestion-form-${viewport.width}`);
    await page.getByRole('button',{name:'Submit suggestion',exact:true}).click();
    await page.getByRole('heading',{name:'Submission Confirmation',exact:true}).waitFor();
    assert.equal(receipts.size,1);
    assert.match(await page.locator('.feedback-receipt blockquote').innerText(),/<script>alert\(1\)<\/script>/);
    assert.equal(await page.locator('.feedback-receipt script').count(),0);
    assert.equal(await page.locator('#account-pages-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
    await waitingScreenshot(page,`suggestion-confirmation-${viewport.width}`);
    await page.locator('[data-feedback-new]').click();
    assert.equal(await page.locator('#feedback-message').inputValue(),'');
    await page.locator('[data-feedback-last]').click();
    await page.getByRole('heading',{name:'Submission Confirmation',exact:true}).waitFor();
    assert.equal(receipts.size,1); assert.deepEqual(errors,[]);
  });
}

test('uncertain suggestion save retains the draft and recovers the same receipt on explicit retry',async t=>{
  const {page,receipts,submissions,uncertainSave}=await settingsFixture(t);
  await page.locator('#profile-button').click(); await page.locator('.profile-identity').waitFor();
  await page.locator('[data-account-view="feedback"]').click();
  await page.locator('#feedback-message').fill('A better table layout.');
  uncertainSave(); await page.getByRole('button',{name:'Submit suggestion',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#account-page-status').textContent.includes('Could not confirm'));
  assert.equal(await page.locator('#feedback-message').inputValue(),'A better table layout.');
  await page.waitForFunction(()=>!document.querySelector('#feedback-form button[type="submit"]').disabled);
  await page.getByRole('button',{name:'Submit suggestion',exact:true}).click();
  await page.getByRole('heading',{name:'Submission Confirmation',exact:true}).waitFor();
  assert.equal(receipts.size,1); assert.equal(submissions.length,2); assert.equal(submissions[0].id,submissions[1].id);
});

test('local arrangement undo and clear selection stay scoped to a table and expire after drawing', async t => {
  const {page,room,requests,errors}=await fixture(t,{width:390,height:844},true);
  for(const id of ['card-0','card-1','card-2']) await page.locator(`[data-card="${id}"]`).click();
  await page.locator('[data-action="group"]').click();
  assert.equal(await page.locator('.ungroup').count(),1);
  await page.locator('[data-switch-table="BBBBBB123456"]').click();
  await page.waitForURL('**/?room=BBBBBB123456');
  assert.equal(await page.locator('[data-action="undo-arrangement"]').isDisabled(),true);
  await page.locator(`[data-switch-table="${room.code}"]`).click();
  await page.waitForURL(`**/?room=${room.code}`);
  await page.locator('[data-action="undo-arrangement"]').click();
  assert.equal(await page.locator('.ungroup').count(),0);
  assert.equal(await page.locator('.hand-scroll .selected').count(),3);
  assert.equal(await page.locator('[data-action="undo-arrangement"]').isDisabled(),true);
  await page.locator('[data-action="clear-selection"]').click();
  assert.equal(await page.locator('.hand-scroll .selected').count(),0);
  await page.locator('[data-action="sort"]').click();
  assert.equal(await page.locator('[data-action="undo-arrangement"]').isEnabled(),true);
  await page.locator('[data-draw="stock"]').click();
  await page.locator('[data-card="drawn"]').waitFor();
  assert.equal(await page.locator('[data-action="undo-arrangement"]').isDisabled(),true);
  assert.deepEqual(requests.map(r=>r.action),['draw']); assert.deepEqual(errors,[]);
});

test('picked open card explains the restriction before an invalid discard or declaration is sent',async t=>{
  const {page,requests}=await fixture(t,undefined,false,{topDiscard:{id:'drawn',rank:6,suit:'S'}});
  await page.locator('[data-draw="discard"]').click(); await page.locator('[data-card="drawn"]').waitFor();
  await page.locator('[data-card="drawn"]').click();
  await page.getByRole('heading',{name:'Choose a different discard',exact:true}).waitFor();
  assert.equal(await page.locator('[data-action="discard"]').isDisabled(),true);
  assert.equal(await page.locator('[data-action="declare"]').isDisabled(),true);
  assert.match(await page.locator('#hand-action-hint').innerText(),/open deck/);
  await page.locator('[data-action="clear-selection"]').click();
  await page.locator('[data-card="card-0"]').click();
  assert.equal(await page.locator('[data-action="discard"]').isEnabled(),true);
  await page.locator('[data-action="discard"]').click();
  await page.waitForFunction(()=>document.querySelector('#turn-guide-title').textContent.includes('Friend'));
  assert.deepEqual(requests.map(r=>r.action),['draw','discard']);
});

test('mobile hand position and keyboard focus survive selection and incoming snapshots',async t=>{
  const {page,room,requests,errors}=await fixture(t,{width:390,height:844});
  await open(page,'Settings');await page.getByLabel('Spread out hand cards').check();await close(page);
  await page.locator('[data-action="show-hand"]').click();
  const position=await page.locator('.hand-scroll').evaluate(el=>{el.scrollLeft=120;return el.scrollLeft;});
  assert.ok(position>0);
  const visible=await page.locator('.hand-scroll').evaluate(el=>{
    const box=el.getBoundingClientRect();return [...el.querySelectorAll('[data-card]')].find(card=>{const r=card.getBoundingClientRect();return r.left>=box.left+8&&r.right<=box.right-8;}).dataset.card;
  });
  await page.locator(`[data-card="${visible}"]`).click();
  assert.ok(Math.abs(await page.locator('.hand-scroll').evaluate(el=>el.scrollLeft)-position)<=1);
  const pageY=await page.evaluate(()=>scrollY);
  room.messages.push({name:'Friend',text:'Still here.',time:Date.now()});room.version++;
  await page.getByText('Still here.',{exact:true}).waitFor();
  assert.ok(Math.abs(await page.locator('.hand-scroll').evaluate(el=>el.scrollLeft)-position)<=1);
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.card),visible);
  assert.ok(Math.abs(await page.evaluate(()=>scrollY)-pageY)<=2);
  assert.equal(requests.length,0); assert.deepEqual(errors,[]);
});

for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1920,height:1080}]){
  test(`turn guide and hand actions remain readable at ${viewport.width}px`,async t=>{
    const f=await fixture(t,viewport,false,{deadline:Date.now()+9000});const {page}=f;
    assert.match(await page.locator('#turn-guide-title').innerText(),/Draw one card/);
    assert.equal(await page.locator('#hand-turn-timing').isVisible(),true);
    assert.ok(Number(await page.locator('#turn-progress').getAttribute('value'))<=10);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    f.hold();await page.locator('[data-draw="stock"]').click();
    await page.waitForFunction(()=>document.querySelector('#turn-guide-title').textContent.includes('Sending your action'));
    assert.equal(await page.locator('[data-action="sort"]').isDisabled(),true);
    f.release();await page.locator('[data-card="drawn"]').waitFor();
    await page.locator('[data-action="show-hand"]').click();
    await page.locator('[data-card="card-0"]').click();
    assert.match(await page.locator('.selection-summary strong').innerText(),/Ace of hearts/);
    await waitingScreenshot(page,`playing-experience-${viewport.width}`);
    f.setOffline(true);await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
    assert.equal(await page.locator('[data-action="discard"]').isDisabled(),true);
    assert.match(await page.locator('#hand-action-hint').innerText(),/fresh snapshot/);
    f.setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await page.waitForFunction(()=>!document.querySelector('[data-action="discard"]').disabled);
  });
}

test('Joined filters retain table numbers and turn attention opens the right game', async t => {
  const {page,room,rooms,requests,errors}=await fixture(t,{width:390,height:844},true);
  const waiting=rooms.get('BBBBBB123456'); waiting.status='lobby'; waiting.round=0; waiting.hand=[]; waiting.turn=null; waiting.version++;
  await page.locator('[data-home]').click();
  await page.locator('[data-home-tab="joined"]').click();
  await page.waitForFunction(()=>document.querySelector('.home-table-state')?.textContent==='Your turn'&&document.querySelectorAll('.home-table-state')[1]?.textContent==='Waiting for players');
  await page.locator('[data-home-filter="lobby"]').click();
  assert.deepEqual(await page.locator('.home-table h3').allTextContents(),['Table 2']);
  await page.locator('[data-home-filter="finished"]').click();
  await page.getByText('No tables match this filter',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Show all tables',exact:true}).click();
  assert.equal(await page.locator('.home-table').count(),2);
  await page.locator('[data-home-filter="your-turn"]').click();
  assert.deepEqual(await page.locator('.home-table h3').allTextContents(),['Table 1']);
  await waitingScreenshot(page,'joined-turn-filter-mobile');
  await page.locator(`[data-attention-table="${room.code}"]`).click();
  await page.locator('[data-card="card-0"]').waitFor();
  assert.equal(await page.locator(`[data-table-progress="${room.code}"]`).isVisible(),true);
  assert.equal(await page.locator('[data-table-progress="BBBBBB123456"]').isVisible(),false);
  assert.equal(requests.length,0); assert.deepEqual(errors,[]);
});

test('new chat messages respect reading position and count peers with the same name',async t=>{
  const messages=Array.from({length:30},(_,i)=>({id:`baseline-${i}`,playerId:'other',name:'Me',text:`History ${i}`,time:Date.now()+i}));
  const {page,room,requests,errors}=await fixture(t,{width:390,height:844},false,{messages});
  await open(page,'Chat');
  await page.locator('#dialog-messages').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
  await page.locator('#dialog-chat-input').fill('Keep this draft');
  await page.locator('#dialog-chat-input').evaluate(el=>el.setSelectionRange(2,7));
  room.messages.push({id:'peer-update',playerId:'other',name:'Me',text:'New peer message',time:Date.now()});room.version++;
  await page.locator('#dialog-messages').getByText('New peer message',{exact:true}).waitFor({state:'attached'});
  assert.equal(await page.locator('#dialog-messages').evaluate(el=>el.scrollTop),0);
  assert.deepEqual(await page.locator('#dialog-chat-input').evaluate(el=>[el.selectionStart,el.selectionEnd]),[2,7]);
  assert.equal(await page.locator('#chat-unread-count').textContent(),'1');
  await page.locator('#dialog-chat-latest').click();
  await page.waitForFunction(()=>document.querySelector('#chat-unread-count').hidden);
  assert.equal(await page.locator('#dialog-messages').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<2),true);
  assert.equal(await page.locator('#dialog-chat-input').inputValue(),'Keep this draft');
  await waitingScreenshot(page,'chat-latest-mobile');
  assert.equal(requests.length,0);assert.deepEqual(errors,[]);
});

test('sidebar chat keeps its draft selection and older history through an update',async t=>{
  const messages=Array.from({length:30},(_,i)=>({id:`sidebar-${i}`,playerId:'other',name:'Friend',text:`Sidebar history ${i}`,time:Date.now()+i}));
  const {page,room,errors}=await fixture(t,undefined,false,{messages});
  await page.locator('#chat-input').fill('Keep selected words');
  await page.locator('#chat-input').evaluate(el=>el.setSelectionRange(5,13));
  await page.locator('#messages').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
  room.messages.push({id:'sidebar-new',playerId:'other',name:'Friend',text:'Sidebar new message',time:Date.now()});room.version++;
  await page.locator('#messages').getByText('Sidebar new message',{exact:true}).waitFor({state:'attached'});
  assert.equal(await page.locator('#messages').evaluate(el=>el.scrollTop),0);
  assert.deepEqual(await page.locator('#chat-input').evaluate(el=>[el.selectionStart,el.selectionEnd]),[5,13]);
  await page.locator('#sidebar-chat-latest').click();
  assert.equal(await page.locator('#messages').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<2),true);
  assert.equal(await page.locator('#chat-input').inputValue(),'Keep selected words');assert.deepEqual(errors,[]);
});

for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1920,height:1080}]){
  test(`Round Results explain personal penalties and allow a rematch at ${viewport.width}px`,async t=>{
    const result={winner:'me',winnerName:'Me',reason:'declaration',groups:[],scores:[{id:'me',name:'Me',penalty:0,total:15,hand:[]},{id:'other',name:'Friend',penalty:40,total:50,hand:[]}],pointsAward:{eligible:true,winner:'me',amount:100}};
    const {page,requests,errors}=await fixture(t,viewport,false,{status:'finished',result});
    await page.getByRole('region',{name:'Your round summary',exact:true}).waitFor();
    assert.match(await page.locator('.personal-round').innerText(),/YOU WON THIS ROUND/);
    assert.match(await page.locator('.personal-round').innerText(),/Profile points earned\s*\+100/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await waitingScreenshot(page,`round-results-${viewport.width}`);
    await page.locator('[data-review-round]').click();
    await page.getByRole('dialog',{name:'Table standings',exact:true}).waitFor();await close(page);
    await page.locator('[data-results-home]').click();await page.locator('.home-page').waitFor();
    await page.locator('[data-home-filter="finished"]').click();
    await page.locator('[data-switch-table="ABCDEF123456"]').click();
    await page.locator('[data-action="start"]').click();await page.locator('[data-card="card-0"]').waitFor();
    assert.equal(await page.locator('.personal-round').count(),0);
    assert.deepEqual(requests.map(r=>r.action),['start']);assert.deepEqual(errors,[]);
  });
}

for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1920,height:1080}]){
  test(`Learn Rummy topics and practice preserve the live hand at ${viewport.width}px`,async t=>{
    const {page,requests,errors}=await fixture(t,viewport);
    await page.locator('[data-card="card-0"]').click();
    await open(page,'Learn rummy');
    await page.locator('[data-tutorial-topic="3"]').click();
    assert.equal(await page.locator('#tutorial-progress').textContent(),'Step 4 of 6');
    assert.match(await page.locator('#tutorial-live-note').textContent(),/timers keep running/);
    await page.locator('[data-tutorial-answer="1"]').click();
    assert.match(await page.locator('#tutorial-practice-feedback').textContent(),/Try another answer/);
    await page.locator('[data-tutorial-answer="0"]').click();
    assert.match(await page.locator('#tutorial-practice-feedback').textContent(),/Correct/);
    await page.locator('[data-tutorial-topic="1"]').click();
    await page.locator('[data-tutorial-topic="3"]').click();
    assert.equal(await page.locator('[data-tutorial-answer="0"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#tutorial-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await waitingScreenshot(page,`learn-topics-${viewport.width}`);
    await page.getByRole('button',{name:'Close tutorial',exact:true}).click();
    assert.equal(await page.locator('[data-card="card-0"]').getAttribute('aria-pressed'),'true');
    assert.equal(requests.length,0);assert.deepEqual(errors,[]);
  });

  test(`Last Deal browses settled rounds without jumping on new results at ${viewport.width}px`,async t=>{
    const deal=round=>({round,winner:`Winner ${round}`,scores:[{name:'Same',penalty:0,total:round*10},{name:'Same',penalty:40,total:round*20}]});
    const {page,room,requests,errors}=await fixture(t,viewport,false,{history:[deal(3),deal(2),deal(1)]});
    await open(page,'Settings');await page.locator('[data-settings-panel="lastDeal"]').click();
    assert.equal(await page.locator('#last-deal-round').inputValue(),'3');
    assert.equal(await page.locator('#last-deal-newer').isDisabled(),true);
    await page.locator('#last-deal-older').click();
    assert.equal(await page.locator('#last-deal-round').inputValue(),'2');
    room.history.unshift(deal(4));room.version++;
    await page.getByText('2 newer completed rounds are available.',{exact:false}).waitFor();
    assert.equal(await page.locator('#last-deal-round').inputValue(),'2');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'last-deal-round');
    assert.match(await page.locator('.last-deal-summary').textContent(),/Winner 2/);
    assert.equal(await page.locator('#game-dialog .card').count(),0);
    await page.locator('#last-deal-round').selectOption('1');
    assert.equal(await page.locator('#last-deal-older').isDisabled(),true);
    await page.locator('#last-deal-latest').click();
    assert.equal(await page.locator('#last-deal-round').inputValue(),'4');
    assert.equal(await page.locator('#game-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await waitingScreenshot(page,`last-deal-browser-${viewport.width}`);
    await page.locator('#last-deal-return').click();
    assert.equal(await page.locator('#game-dialog').evaluate(el=>el.open),false);
    assert.equal(requests.length,0);assert.deepEqual(errors,[]);
  });
}

test('declaration recovery updates turn context and returns focus to the real hand',async t=>{
  const f=await fixture(t,{width:390,height:844});const {page,room,requests,errors}=f;
  await page.locator('[data-draw="stock"]').click();await page.locator('[data-card="drawn"]').click();
  await page.locator('[data-action="declare"]').click();await page.locator('#confirm-yes').click();
  await page.locator('#declaration-turn-status').waitFor();
  assert.match(await page.locator('#declaration-turn-status').textContent(),/Selected:/);
  assert.equal(await page.locator('[data-declaration-clock]').isVisible(),true);
  f.setOffline(true);await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
  assert.match(await page.locator('#declaration-turn-status').textContent(),/fresh snapshot/);
  assert.equal(await page.locator('#declaration-arrange').isDisabled(),true);
  f.setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.waitForFunction(()=>!document.querySelector('#declaration-arrange').disabled);
  await page.locator('#declaration-guide').click();
  await page.getByRole('dialog',{name:'Best Possible Declaration',exact:true}).waitFor();
  room.turn='other';room.phase='draw';room.hand=room.hand.filter(c=>c.id!=='drawn');room.version++;
  await page.waitForFunction(()=>document.querySelector('#declaration-turn-status').textContent.includes('another player'));
  assert.equal(await page.locator('[data-declaration-clock]').count(),0);
  await page.locator('#declaration-guide-back').click();
  room.status='finished';room.version++;
  await page.waitForFunction(()=>document.querySelector('#declaration-turn-status').textContent.includes('not active'));
  assert.equal(await page.locator('#declaration-arrange').isDisabled(),true);
  assert.doesNotMatch(await page.locator('#game-dialog').innerText(),/Your turn is still active/);
  await waitingScreenshot(page,'declaration-live-context-mobile');
  await page.locator('#declaration-review').click();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'player-hand-title');
  assert.equal(await page.locator('.hand-scroll [data-card]').count(),13);
  assert.deepEqual(requests.map(r=>r.action),['draw','declare']);assert.deepEqual(errors,[]);
});

test('Last Deal resets to the selected table history and falls back when a round expires',async t=>{
  const deal=(round,winner)=>({round,winner,scores:[{name:winner,penalty:0,total:10}]});
  const {page,room,rooms,requests,errors}=await fixture(t,undefined,true,{history:[deal(2,'First table'),deal(1,'Old winner')]});
  rooms.get('BBBBBB123456').history=[deal(7,'Second table')];
  await open(page,'Settings');await page.locator('[data-settings-panel="lastDeal"]').click();
  await page.locator('#last-deal-round').selectOption('1');
  room.history=[deal(3,'Newest'),deal(2,'First table')];room.version++;
  await page.waitForFunction(()=>document.querySelector('#last-deal-round').value==='3');
  await close(page);await page.locator('[data-switch-table="BBBBBB123456"]').click();
  await page.waitForURL('**/?room=BBBBBB123456');
  await open(page,'Settings');await page.locator('[data-settings-panel="lastDeal"]').click();
  assert.equal(await page.locator('#last-deal-round').inputValue(),'7');
  assert.equal(await page.locator('#last-deal-round option').count(),1);
  assert.match(await page.locator('.last-deal-summary').textContent(),/Second table/);
  assert.equal(requests.length,0);assert.deepEqual(errors,[]);
});

async function authFixture(t,viewport={width:390,height:844}) {
  const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});t.after(()=>browser.close());
  const page=await browser.newPage({viewport});const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
  let account=null,allow=false,hold=false,release;
  await page.route('http://rummy.test/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/session')return route.fulfill({json:{csrf:'test',rooms:[],account}});
    if(path==='/api/tables')return route.fulfill({json:{tables:[],tableLimit:3,serverTime:Date.now(),active:null}});
    if(['/api/register','/api/login'].includes(path)){
      requests.push({path,data:route.request().postDataJSON()});
      if(hold)await new Promise(resolve=>{release=resolve;});
      if(!allow)return route.fulfill({status:400,json:{error:path==='/api/login'?'Incorrect username or password.':'That username is taken. Choose another.'}});
      account={name:'Player',username:'player_test',points:10000};return route.fulfill({json:{csrf:'test',rooms:[],account}});
    }
    if(path.startsWith('/api/'))return route.fulfill({status:404,json:{error:'Not found.'}});
    const file=path==='/'?'index.html':path.slice(1);
    try{return route.fulfill({body:await readFile(resolve('public',file)),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.png')?'image/png':'text/html'});}catch{return route.fulfill({status:404});}
  });
  await page.goto('http://rummy.test/');await page.locator('#auth-form').waitFor();
  return {page,requests,errors,allow:()=>{allow=true;},hold:()=>{hold=true;},release:()=>{hold=false;release?.();}};
}

for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1920,height:1080}]){
  test(`Create Account validates confirmation and clears secrets after signup at ${viewport.width}px`,async t=>{
    const f=await authFixture(t,viewport);const {page,requests,errors}=f;
    await page.locator('#account-name').fill('Player');await page.locator('#account-username').fill('player_test');
    await page.locator('#account-password').fill('safe-password-123');await page.locator('#account-confirm').fill('wrong-password-123');
    await page.locator('#auth-form [type="submit"]').click();
    assert.match(await page.locator('#auth-error').textContent(),/do not match/);assert.equal(requests.length,0);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'account-confirm');
    await page.locator('[data-password-toggle="account-password"]').click();
    assert.equal(await page.locator('#account-password').getAttribute('type'),'text');
    await page.locator('#account-confirm').fill('safe-password-123');
    assert.match(await page.locator('#account-password-match').textContent(),/Passwords match/);
    await waitingScreenshot(page,`create-account-${viewport.width}`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    f.allow();await page.locator('#auth-form [type="submit"]').click();await page.locator('.home-page').waitFor();
    assert.equal(requests.length,1);assert.equal(requests[0].path,'/api/register');assert.equal('confirmPassword' in requests[0].data,false);
    assert.equal(await page.locator('#account-password').count(),0);
    assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('safe-password-123')),false);assert.deepEqual(errors,[]);
  });
}

test('account tabs use arrows, keep identity and clear passwords before sign in',async t=>{
  const f=await authFixture(t);const {page,requests,errors}=f;
  await page.locator('#account-name').fill('My name');await page.locator('#account-username').fill('player_test');await page.locator('#account-password').fill('safe-password-123');
  await page.locator('[data-auth-mode="register"]').focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('[data-auth-mode="login"]').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#account-username').inputValue(),'player_test');assert.equal(await page.locator('#account-password').inputValue(),'');
  await page.keyboard.press('Home');assert.equal(await page.locator('#account-name').inputValue(),'My name');
  await page.keyboard.press('End');await page.locator('#account-password').fill('safe-password-123');
  const pendingLogin=page.waitForRequest('**/api/login');
  f.hold();await page.locator('#auth-form [type="submit"]').click();await pendingLogin;
  await page.waitForFunction(()=>document.querySelector('#auth-form').getAttribute('aria-busy')==='true');
  assert.equal(await page.locator('[data-auth-mode="register"]').isDisabled(),true);assert.equal(await page.locator('#account-password').isDisabled(),true);
  assert.equal(requests.length,1);f.release();
  await page.waitForFunction(()=>document.querySelector('#auth-error').textContent.includes('Incorrect username'));
  assert.equal(await page.locator('#account-password').inputValue(),'safe-password-123');assert.equal(await page.locator('#account-password').getAttribute('type'),'password');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'auth-error');
  await waitingScreenshot(page,'sign-in-inline-error-mobile');
  f.allow();await page.locator('#auth-form [type="submit"]').click();await page.locator('.home-page').waitFor();
  assert.deepEqual(requests.map(request=>request.path),['/api/login','/api/login']);assert.deepEqual(errors,[]);
});

test('Join Friends accepts full invite links and rejects unrelated links before sending',async t=>{
  const {page,rooms,errors}=await fixture(t,{width:390,height:844});const joins=[];
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/join')joins.push(request.postDataJSON());});
  await page.locator('[data-add-table]').click();await page.locator('[data-table-mode="join"]').click();
  await page.locator('#new-table-code').fill('https://other.test/?room=DDDDDD123456');await page.locator('#table-entry-submit').click();
  assert.equal(joins.length,0);assert.match(await page.locator('#table-entry-error').textContent(),/from this site/);
  await page.locator('#new-table-code').fill('http://rummy.test/?room=dddddd123456');await page.locator('#new-table-password').fill('wrong');
  await page.locator('#table-entry-submit').click();await page.waitForFunction(()=>document.querySelector('#table-entry-error').textContent.includes('Incorrect'));
  assert.equal(await page.locator('#new-table-code').inputValue(),'DDDDDD123456');assert.equal(rooms.size,1);
  await waitingScreenshot(page,'join-friends-inline-error-mobile');
  await page.locator('#new-table-password').fill('friends');await page.locator('#table-entry-submit').click();await page.waitForURL('**/?room=DDDDDD123456');
  assert.equal(joins.length,2);assert.equal(joins[1].code,'DDDDDD123456');assert.equal('accessKey' in joins[1],false);
  assert.equal(await page.locator('#new-table-password').inputValue(),'');assert.equal(rooms.size,2);assert.deepEqual(errors,[]);
});

for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1920,height:1080}]){
  test(`Create Table explains access and clears closed passwords at ${viewport.width}px`,async t=>{
    const {page,errors}=await fixture(t,viewport);
    await page.locator('[data-add-table]').click();
    assert.match(await page.locator('#table-setup-access').textContent(),/Anyone with the link/);
    await page.locator('#new-table-password').fill('room-secret');
    assert.match(await page.locator('#table-setup-access').textContent(),/Password-protected/);
    await page.locator('#table-password-toggle').click();assert.equal(await page.locator('#new-table-password').getAttribute('type'),'text');
    assert.equal(await page.locator('#tables-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await waitingScreenshot(page,`create-table-access-${viewport.width}`);
    await page.getByRole('button',{name:'Close add table',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#new-table-password').value==='');
    await page.locator('[data-add-table]').click();assert.equal(await page.locator('#new-table-password').getAttribute('type'),'password');
    await page.locator('[data-table-mode="join"]').click();assert.equal(await page.locator('#table-setup-summary').isVisible(),false);
    await page.locator('[data-table-mode="create"]').click();assert.equal(await page.locator('#table-setup-summary').isVisible(),true);
    assert.deepEqual(errors,[]);
  });
}

test('Invite Friends confirms real clipboard writes and selects the correct fallback text',async t=>{
  const {page,room,requests,errors}=await fixture(t,{width:390,height:844},false,{hasPassword:true});
  await page.evaluate(()=>{window.copied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied.push(text);}}});});
  await page.locator('[data-action="invite"]').first().click();
  assert.match(await page.locator('#invite-access-note').textContent(),/Send the room password separately/);
  await page.locator('#copy-invite').click();await page.waitForFunction(()=>document.querySelector('#invite-status').textContent.includes('link copied'));
  await page.locator('#copy-invite-code').click();await page.waitForFunction(()=>document.querySelector('#invite-status').textContent.includes('code copied'));
  assert.deepEqual(await page.evaluate(()=>window.copied),[`http://rummy.test/?room=${room.code}`,room.code]);
  await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw new Error('Clipboard denied');};});
  await page.locator('#copy-invite-code').click();await page.waitForFunction(()=>document.querySelector('#invite-status').textContent.includes('Automatic copy is unavailable'));
  assert.equal(await page.evaluate(()=>document.activeElement.id),'invite-code-value');
  assert.deepEqual(await page.locator('#invite-code-value').evaluate(el=>[el.selectionStart,el.selectionEnd]),[0,12]);
  assert.equal(await page.locator('#invite-url').inputValue(),`http://rummy.test/?room=${room.code}`);
  room.players.push({id:'third',name:'Third',count:0,total:0});room.version++;
  await page.waitForFunction(()=>document.querySelector('#invite-seat-summary').textContent.includes('3 open seats'));
  await waitingScreenshot(page,'invite-copy-fallback-mobile');assert.equal(requests.length,0);assert.deepEqual(errors,[]);
});

test('Drop and leave confirmations stop when the round conditions change',async t=>{
  const {page,room,requests,errors}=await fixture(t,{width:390,height:844});
  await page.locator('[data-action="drop"]').click();
  assert.match(await page.locator('#confirm-details').textContent(),/20 penalty points/);
  room.messages.push({id:'chat-only',name:'Friend',text:'Still here',time:Date.now()});room.version++;
  await page.locator('#messages').getByText('Still here',{exact:true}).waitFor({state:'attached'});
  assert.equal(await page.locator('#confirm-yes').isEnabled(),true);
  room.players[0].turns=1;room.version++;
  await page.waitForFunction(()=>document.querySelector('#confirm-yes').disabled);
  assert.match(await page.locator('#confirm-status').textContent(),/drop conditions changed/);
  await waitingScreenshot(page,'drop-stale-confirmation-mobile');
  await page.getByRole('button',{name:'Cancel',exact:true}).last().click();
  room.status='lobby';room.round=0;room.hand=[];room.version++;
  await page.locator('.waiting-page').waitFor();await page.locator('[data-action="leave"]').click();
  assert.match(await page.locator('#confirm-details').textContent(),/other joined tables remain/);
  room.status='playing';room.round=1;room.hand=Array.from({length:13},(_,i)=>({id:`next-${i}`,rank:i+1,suit:'H'}));room.version++;
  await page.waitForFunction(()=>document.querySelector('#confirm-yes').disabled);
  assert.equal(requests.length,0);assert.deepEqual(errors,[]);
});

test('Declaration confirmation cannot submit a changed hand',async t=>{
  const {page,room,requests,errors}=await fixture(t);
  await page.locator('[data-draw="stock"]').click();await page.locator('[data-card="drawn"]').click();
  await page.locator('[data-action="declare"]').click();
  room.hand=room.hand.filter(card=>card.id!=='drawn');room.phase='draw';room.turn='other';room.version++;
  await page.waitForFunction(()=>document.querySelector('#confirm-yes').disabled);
  assert.match(await page.locator('#confirm-status').textContent(),/turn or cards changed/);
  assert.deepEqual(requests.map(request=>request.action),['draw']);assert.deepEqual(errors,[]);
});

for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1920,height:1080}]){
  test(`View Cards filters preserve groups and selection at ${viewport.width}px`,async t=>{
    const {page,room,requests,errors}=await fixture(t,viewport);
    room.hand.push({id:'printed',rank:0,suit:'J'});room.version++;
    await page.locator('[data-card="printed"]').waitFor();
    for(const id of ['card-0','card-1','card-2'])await page.locator(`[data-card="${id}"]`).click();
    await page.locator('[data-action="group"]').click();await page.locator('[data-card="card-0"]').click();
    await open(page,'View cards');await page.locator('#hand-filter-jokers').click();
    assert.equal(await page.locator('#game-dialog .card').count(),2);
    await page.locator('#hand-filter-S').click();await page.getByText('No cards match this filter. Choose All to see your hand.',{exact:true}).waitFor();
    await page.locator('#hand-filter-H').click();assert.equal(await page.locator('#game-dialog .card').count(),13);
    await page.locator('#hand-filter-jokers').click();
    room.hand=room.hand.filter(card=>card.id!=='card-4');room.version++;
    await page.waitForFunction(()=>document.querySelector('#hand-filter-summary').textContent.includes('Showing 1 of 13'));
    assert.equal(await page.locator('#hand-filter-jokers').getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'hand-filter-jokers');
    assert.equal(await page.locator('#game-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await waitingScreenshot(page,`hand-joker-filter-${viewport.width}`);
    await page.locator('#hand-view-back').click();
    assert.equal(await page.locator('[data-card="card-0"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.ungroup').count(),1);
    assert.equal(requests.length,0);assert.deepEqual(errors,[]);
  });
}

test('Table Information topic focus survives incoming snapshots without showing cards',async t=>{
  const {page,room,requests,errors}=await fixture(t,{width:390,height:844});
  await open(page,'Table info');await page.locator('#info-jump-jokers').click();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'info-jokers-title');
  room.messages.push({id:'info-update',name:'Friend',text:'Info remains open',time:Date.now()});room.version++;
  await page.locator('#messages').getByText('Info remains open',{exact:true}).waitFor({state:'attached'});
  assert.equal(await page.evaluate(()=>document.activeElement.id),'info-jokers-title');
  assert.equal(await page.locator('#game-dialog .card').count(),0);
  await page.locator('#info-jump-details').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'info-facts-heading');
  await waitingScreenshot(page,'information-topic-navigation-mobile');
  assert.equal(requests.length,0);assert.deepEqual(errors,[]);
});

test('Offline Recovery keeps the room code and waits for a deliberate return',async t=>{
  const {page,errors}=await fixture(t,{width:390,height:844});
  await page.goto('http://rummy.test/offline.html?room=abcdef123456&next=https://other.test');
  await page.getByRole('heading',{name:'Reconnect to your game.',exact:true}).waitFor();
  assert.equal(await page.locator('#offline-return').getAttribute('href'),'/?room=ABCDEF123456');
  const url=page.url();
  await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:false});window.dispatchEvent(new Event('offline'));});
  assert.match(await page.locator('#offline-status').textContent(),/no network connection/);
  await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:true});window.dispatchEvent(new Event('online'));});
  assert.match(await page.locator('#offline-status').textContent(),/reports a network connection/);assert.equal(page.url(),url);
  assert.match(await page.locator('.offline-round-note').textContent(),/seat may have changed or expired/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await waitingScreenshot(page,'offline-recovery-mobile');
  await page.locator('#offline-return').click();await page.locator('#connection').waitFor();
  assert.deepEqual(errors,[]);
});
