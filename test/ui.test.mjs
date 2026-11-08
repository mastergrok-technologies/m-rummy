// Deterministic browser fixtures exercise presentation only. PHP/HTTP tests cover rules.
// Run: npm install --no-save playwright && npx playwright install chromium
//      npm run test:ui
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function fixture(t, viewport = { width: 1920, height: 1080 }, multi = false, initial = {}) {
  const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const hand = Array.from({ length: 13 }, (_, i) => ({ id: `card-${i}`, rank: i + 1, suit: 'H' }));
  const room = { code: 'ABCDEF123456', version: 1, round: 1, status: 'playing', phase: 'draw', me: 'me', host: 'me', turn: 'me', deadline: Date.now() + 60000, hand,
    players: [{ id: 'me', name: 'Me', total: 0, turns: 0, count: 13 }, { id: 'other', name: 'Friend', total: 10, count: 13 }],
    indicator: { id: 'wild', rank: 5, suit: 'C' }, wildRank: 5, stockCount: 70, topDiscard: { id: 'discard', rank: 6, suit: 'S' }, messages: [], activity: [], history: [], account: { name: 'Me', points: 10000 } };
  Object.assign(room, initial);
  const rooms = new Map([[room.code, room]]);
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
        if (input.action === 'start') { target.status = 'playing'; target.round = 1; target.hand = hand; }
        if (input.action === 'draw') { target.phase = 'discard'; target.hand = [...target.hand, { id: 'drawn', rank: 2, suit: 'S' }]; }
        if (input.action === 'discard') { target.hand = target.hand.filter(c => c.id !== input.cardId); target.turn = 'other'; target.phase = 'draw'; target.deadline = Date.now() + 60000; }
        if (input.action === 'chat') target.messages.push({ id: `m${requests.length}`, name: 'Me', text: input.text, time: Date.now() });
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
  await page.goto('http://rummy.test/');
  await page.locator('#connection').waitFor();
  return { page, room, rooms, requests, errors, rejectNextChat: () => { rejectChat = true; }, holdNextPoll: () => { holdPoll = true; return new Promise(r => { pollStarted = r; }); }, releasePoll: () => releasePoll?.(), setOffline: value => { offline = value; }, hold: () => { hold = true; }, release: () => { hold = false; held?.(); } };
}
const open = (page, name) => page.getByRole('button', { name, exact: true }).click();
const close = page => page.getByRole('button', { name: 'Close table panel' }).click();

test('table panels show private hand, real standings, settings and safe chat', async t => {
  const { page, room, errors } = await fixture(t);
  await open(page, 'View cards'); assert.equal(await page.locator('#game-dialog .card').count(), 13); await close(page);
  await open(page, 'Standings'); assert.match(await page.locator('#game-dialog').innerText(), /Friend/); assert.equal(await page.locator('#game-dialog .card').count(), 0); await close(page);
  await open(page, 'Table info'); assert.match(await page.locator('#game-dialog').innerText(), /Free play/); await close(page);
  await open(page, 'Settings'); await page.getByLabel('Spread out hand cards').check();
  assert.match(await page.locator('html').getAttribute('class'), /roomy-cards/); await close(page);
  await open(page, 'Chat'); await page.locator('#dialog-chat-input').fill('<img src=x onerror=alert(1)>');
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
  await page.getByRole('heading', { name: 'Review your declaration' }).waitFor();
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
  for (let step = 1; step <= 6; step++) {
    assert.equal(await page.locator('#tutorial-progress').textContent(), `Step ${step} of 6`);
    if (step === 3) {
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
    for (const [name, size] of [['connection-lost', 86], ['connection-loading', 56]]) {
      const dimensions = await page.locator(`#connection-banner img[src$="${name}.svg"]`).evaluate(el => ({ width: el.offsetWidth, height: el.offsetHeight }));
      assert.equal(dimensions.width, size); assert.equal(dimensions.height, size);
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
