import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

async function availablePort() {
  const server = net.createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port; await new Promise(r => server.close(r)); return port;
}

test('HTTP multiplayer, isolation, CSRF, competing moves, reconnect, and durable state', async t => {
  const data = await mkdtemp(join(tmpdir(), 'mr-http-'));
  const port = await availablePort(), base = `http://127.0.0.1:${port}`;
  let processPHP;
  let stderr = '';
  async function start() {
    processPHP = spawn(process.env.PHP_BIN || 'php', ['-S', `127.0.0.1:${port}`, '-t', 'public', 'public/router.php'], { cwd: resolve('.'), env: { ...process.env, RUMMY_DEV: '1', RUMMY_TEST_DATA_DIR: data }, stdio: ['ignore', 'ignore', 'pipe'] });
    processPHP.stderr.on('data', chunk => { stderr += chunk; });
    for (let i = 0; i < 80; i++) {
      try { const response = await fetch(base); await response.text(); if (response.ok) return; } catch { /* Startup only. */ }
      await delay(50);
    }
    throw new Error(`PHP failed to start: ${stderr}`);
  }
  async function stop() { if (processPHP.exitCode === null) { processPHP.kill(); await new Promise(r => processPHP.once('exit', r)); } }
  t.after(async () => { await stop(); await rm(data, { recursive: true, force: true }); });
  await start();
  for (const file of ['app.js', 'board-state.js', 'tutorial.js', 'ui/gameplay.js', 'ui/waiting-room.js', 'ui/panels/chat.js', 'ui/profile.js', 'ui/avatars.js', 'ui/account-pages.js', 'ui/round-results.js', 'ui/tutorial.js']) {
    const module = await fetch(`${base}/${file}`); assert.equal(module.status, 200, `${file} must be served by the PHP router`);
    assert.match(module.headers.get('content-type'), /javascript/);
    // Drain and verify full source; leaving a large response unread can pause
    // Node's fetch parser while the PHP development server closes the socket.
    assert.equal(await module.text(), await readFile(`public/${file}`, 'utf8'));
  }
  for (const file of ['assets/figma/waiting-table.png', 'assets/figma/avatar-2.svg', 'assets/figma/home/pattern.png']) {
    const asset = await fetch(`${base}/${file}`);
    assert.equal(asset.status, 200, `${file} must be served`);
    assert.match(asset.headers.get('content-type'), /^image\//);
    assert.deepEqual(Buffer.from(await asset.arrayBuffer()), await readFile(`public/${file}`));
  }
  for (const path of ['/ui/missing.js', '/assets/figma/missing.svg', '/ui/profile.php', '/ui/%2e%2e/server/accounts.php']) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, `${path} must not be served`);
  }
  async function user() {
    const response = await fetch(`${base}/api/session`); const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.match(response.headers.get('set-cookie'), /HttpOnly/i); assert.match(response.headers.get('set-cookie'), /SameSite=Strict/i);
    const session = await response.json(); assert.ok(session.csrf); return { cookie, ...session };
  }
  async function request(user, route, input, headers = {}) {
    const response = await fetch(`${base}/api/${route}`, { method: input === undefined ? 'GET' : 'POST', headers: { Cookie: user?.cookie || '', ...(input !== undefined ? { 'Content-Type': 'application/json', 'X-CSRF-Token': user?.csrf || '', Origin: base } : {}), ...headers }, body: input === undefined ? undefined : JSON.stringify(input) });
    const result = await response.json();
    const cookie = response.headers.get('set-cookie'); if (cookie && user) user.cookie = cookie.split(';')[0];
    if (response.ok && ['register', 'login', 'logout', 'session'].includes(route) && user) Object.assign(user, result);
    return { status: response.status, body: result };
  }
  const a = await user(), b = await user(), outsider = await user();
  // A deploy lock gives a retryable maintenance response; releasing it keeps
  // the original session intact instead of initializing replacement state.
  const lockOwner = spawn(process.env.PHP_BIN || 'php', ['-r', '$f=fopen(".deploy.lock","c");flock($f,LOCK_EX);echo "locked\\n";fflush(STDOUT);fgets(STDIN);flock($f,LOCK_UN);'], { stdio: ['pipe', 'pipe', 'ignore'] });
  t.after(() => { if (lockOwner.exitCode === null) lockOwner.kill(); });
  await new Promise((resolve, reject) => { lockOwner.stdout.once('data', resolve); lockOwner.once('error', reject); });
  const duringDeploy = await fetch(`${base}/api/session`, { headers: { Cookie: a.cookie } });
  assert.equal(duringDeploy.status, 503); assert.equal(duringDeploy.headers.get('retry-after'), '10');
  lockOwner.stdin.end('\n'); await new Promise(r => lockOwner.once('exit', r));
  assert.equal((await request(a, 'session')).body.id, a.id);
  assert.equal((await request(a, 'create', { name: 'Sunil' })).status, 401);
  const guestCookie = a.cookie;
  const signup = await request(a, 'register', { username: 'sunil_test', name: 'Sunil', password: 'password-for-test-only' });
  assert.equal(signup.status, 200); assert.equal(signup.body.account.points, 10000); assert.notEqual(a.cookie, guestCookie);
  assert.equal((await request({ ...a, cookie: guestCookie }, 'session')).body.account, null);
  assert.equal((await request(b, 'register', { username: 'friend_test', name: 'Friend', password: 'password-for-test-only' })).status, 200);
  assert.equal((await request(outsider, 'register', { username: 'SUNIL_TEST', name: 'Duplicate', password: 'password-for-test-only' })).status, 400);
  assert.equal((await request(outsider, 'profile')).status, 401);
  assert.equal((await request(outsider, 'profile', { avatar: 2 })).status, 401);
  assert.equal((await request(a, 'profile', { avatar: 2 }, { 'X-CSRF-Token': 'bad' })).status, 403);
  assert.equal((await request(a, 'profile', { avatar: 2 }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request(a, 'profile', { avatar: 6 })).status, 400);
  assert.equal((await request(a, 'profile', { avatar: 2, points: 999999 })).status, 400);
  const updatedProfile = await request(a, 'profile', { avatar: 2 });
  assert.equal(updatedProfile.status, 200); assert.equal(updatedProfile.body.avatar, 2); assert.equal(updatedProfile.body.points, 10000);
  assert.equal((await request(a, 'session')).body.account.avatar, 2);
  assert.equal((await request(b, 'profile')).body.avatar, null);
  assert.equal((await request(a, 'profile?filter=invalid')).status, 400);
  assert.equal((await request(a, 'profile?filter=win')).body.historyTotal, 0);
  const created = await request(a, 'create', { name: 'Sunil', password: 'friends' }); assert.equal(created.status, 200);
  const code = created.body.code;
  assert.equal(created.body.players.find(p => p.id === a.id).avatar, 2);
  const joinedTables = await request(a, `tables?code=${code}`);
  assert.equal(joinedTables.status, 200); assert.equal(joinedTables.body.active.code, code);
  assert.equal(joinedTables.body.tables[0].code, code); assert.equal(joinedTables.body.tableLimit, 3);
  assert.deepEqual((await request(outsider, `tables?code=${code}`)).body.tables, []);
  assert.equal((await request(b, 'join', { code, name: 'Friend', password: 'wrong' })).status, 400);
  const joined = await request(b, 'join', { code, name: 'Friend', password: 'friends' }); assert.equal(joined.status, 200);
  const blocked = await request(outsider, `room?code=${code}`); assert.equal(blocked.status, 400); assert.equal(blocked.body.hand, undefined);
  const state = (await request(a, `room?code=${code}`)).body;
  assert.equal((await request(a, 'profile', { avatar: 3 })).status, 200);
  const avatarView = (await request(a, `room?code=${code}`)).body;
  assert.equal(avatarView.players.find(p => p.id === a.id).avatar, 3);
  assert.equal(avatarView.version, state.version); assert.equal(avatarView.deadline, state.deadline);
  const heartbeat = (user, client, visible, sequence) => request(user, `tables?code=${code}&client=${client.repeat(32)}&visible=${visible}&sequence=${sequence}`);
  const live = await heartbeat(a, 'a', 1, 1); assert.equal(live.status, 200);
  assert.equal(live.body.active.players.find(p => p.id === a.id).presence, 'online');
  assert.equal(live.body.active.version, state.version); assert.equal(live.body.active.deadline, state.deadline);
  await heartbeat(b, 'b', 0, 1);
  const observed = (await request(a, `room?code=${code}`)).body;
  assert.equal(observed.players.find(p => p.id === b.id).presence, 'away');
  assert.equal(observed.version, state.version);
  for (const secret of ['presenceClients', 'presenceSeen', 'seenAt', 'sequence', a.cookie.split('=')[1]]) assert.ok(!JSON.stringify(observed).includes(secret));
  assert.equal((await request(a, `tables?code=${code}&client=bad&visible=1&sequence=2`)).status, 400);
  assert.equal((await request(a, `tables?code=${code}`)).body.active.version, state.version);

  assert.equal((await request(a, 'action', { code, action: 'award', amount: 1000000, version: state.version })).status, 400);
  assert.equal((await request(a, 'profile')).body.points, 10000);
  assert.equal((await request(a, 'action', { code, action: 'start', version: state.version }, { 'X-CSRF-Token': 'bad' })).status, 403);
  assert.equal((await request(a, 'action', { code, action: 'start', version: state.version }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request(b, 'action', { code, action: 'start', version: state.version })).status, 400);
  const started = await request(a, 'action', { code, action: 'start', version: state.version }); assert.equal(started.body.status, 'playing');
  assert.equal(started.body.hand.length, 13); assert.ok(started.body.players.every(p => !('hand' in p)));
  assert.equal(started.body.stock, undefined); assert.equal(started.body.passwordHash, undefined);
  // Bearer cookies are distinct from public player IDs.
  assert.ok(!JSON.stringify(started.body).includes(a.cookie.split('=')[1]));
  const duplicate = await Promise.all([1, 2].map(() => request(a, 'action', { code, action: 'draw', source: 'stock', version: started.body.version })));
  assert.deepEqual(duplicate.map(r => r.status).sort(), [200, 409]);
  const drawn = duplicate.find(r => r.status === 200).body;
  assert.equal(drawn.hand.length, 14);
  const rejected = await request(a, 'action', { code, action: 'discard', cardId: 'not-my-card', version: drawn.version }); assert.equal(rejected.status, 400);
  const discarded = await request(a, 'action', { code, action: 'discard', cardId: drawn.hand.at(-1).id, version: drawn.version }); assert.equal(discarded.status, 200); assert.equal(discarded.body.turn, b.id);
  const friend = (await request(b, `room?code=${code}`)).body;
  assert.equal(friend.hand.length, 13); assert.ok(!friend.hand.some(c => discarded.body.hand.some(d => d.id === c.id)));
  const chat = await request(b, 'action', { code, action: 'chat', text: '<script>alert(1)</script>', version: friend.version }); assert.equal(chat.status, 200);
  assert.equal(chat.body.messages.at(-1).text, '<script>alert(1)</script>');
  assert.equal(chat.body.messages.at(-1).playerId, b.id);
  // Escaping is exercised by the chat renderer/browser tests. The entry point
  // delegates markup to UI modules, which are verified as served above.
  // Path and private-storage access cannot serve files.
  assert.equal((await fetch(`${base}/server/config.php`)).status, 404);
  assert.equal((await fetch(`${base}/data/state.json`)).status, 404);
  const storage = JSON.parse(await readFile(join(data, 'state.json'), 'utf8'));
  assert.ok(storage.rooms[code].passwordHash); assert.ok(!JSON.stringify(storage).includes('"password":"friends"'));
  await stop(); await start();
  const resumed = await request(a, 'session'); assert.equal(resumed.body.id, a.id); assert.equal(resumed.body.room, code);
  const saved = (await request(a, `room?code=${code}`)).body;
  assert.equal(saved.version, chat.body.version); assert.deepEqual(saved.hand, discarded.body.hand); assert.equal(saved.turn, b.id);
  assert.equal(saved.messages.at(-1).text, '<script>alert(1)</script>');
  const finished = await request(b, 'action', { code, action: 'drop', version: saved.version }); assert.equal(finished.body.status, 'finished'); assert.equal(finished.body.result.winner, a.id);
  assert.equal(finished.body.result.pointsAward.amount, 100);
  assert.equal((await request(a, 'profile')).body.points, 10100);
  assert.equal((await request(b, 'profile')).body.points, 10000);
  // Repeated polls and rejected duplicate drops must not pay the same win again.
  await request(a, `room?code=${code}`); await request(b, `room?code=${code}`);
  assert.equal((await request(b, 'action', { code, action: 'drop', version: finished.body.version })).status, 400);
  assert.equal((await request(a, 'profile')).body.wins, 1);
  const c = await user();
  assert.equal((await request(c, 'login', { username: 'sunil_test', password: 'incorrect-password' })).status, 400);
  const crossDevice = await request(c, 'login', { username: 'SUNIL_TEST', password: 'password-for-test-only' });
  assert.equal(crossDevice.body.id, a.id); assert.equal(crossDevice.body.room, code); assert.equal(crossDevice.body.account.points, 10100);
  await heartbeat(a, 'a', 0, 2); await heartbeat(c, 'c', 1, 1);
  assert.equal((await request(b, `room?code=${code}`)).body.players.find(p => p.id === a.id).presence, 'online');

  const authenticatedCookie = c.cookie;
  await request(c, 'logout', { logout: true });
  assert.equal((await request({ ...c, cookie: authenticatedCookie }, 'profile')).status, 401);
  await request(c, 'login', { username: 'sunil_test', password: 'password-for-test-only' });
  assert.equal(c.account.points, 10100);
  await stop(); await start();
  const retained = (await request(c, 'profile')).body;
  assert.equal(retained.points, 10100); assert.equal(retained.historyTotal, 2); assert.equal(retained.wins, 1);
  const rematch = await request(a, 'action', { code, action: 'start', version: finished.body.version }); assert.equal(rematch.body.round, 2); assert.equal(rematch.body.hand.length, 13);
  // Multiple memberships survive a process restart; another account cannot list them.
  const second = await request(a, 'create', { password: '' }), third = await request(a, 'create', { password: '' });
  assert.equal(second.status, 200, second.body.error); assert.equal(third.status, 200, third.body.error);
  assert.equal((await request(a, 'create', { password: '' })).status, 400);
  const multi = (await request(a, `tables?code=${second.body.code}`)).body;
  assert.equal(multi.tables.length, 3); assert.equal(multi.active.code, second.body.code);
  assert.ok(multi.tables.every(t => !('hand' in t) && !('messages' in t)));
  assert.equal((await request(b, `tables?code=${second.body.code}`)).body.active, null);
  await stop(); await start();
  assert.deepEqual((await request(a, 'session')).body.rooms, [code, second.body.code, third.body.code]);
  assert.equal((await request(a, `tables?code=${code}`)).body.active.hand.length, 13);

});

test('Existing guest deployment upgrades with a private backup and can save its seat as an account', async t => {
  const data = await mkdtemp(join(tmpdir(), 'mr-upgrade-'));
  const port = await availablePort(), base = `http://127.0.0.1:${port}`;
  const token = 'a'.repeat(64), csrf = 'b'.repeat(48), php = process.env.PHP_BIN || 'php';
  const room = JSON.parse(execFileSync(php, ['-r', 'require "server/game.php"; echo json_encode(rummy_create("legacy-seat", "Old guest"));'], { encoding: 'utf8' }));
  const original = { sessions: { [token]: { id: 'legacy-seat', csrf, expires: Date.now() + 3600000 } }, rooms: { [room.code]: room }, limits: {}, cleanedAt: 0 };
  const originalBytes = JSON.stringify(original);
  await writeFile(join(data, 'state.json'), originalBytes, { mode: 0o600 });
  const server = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', 'public', 'public/router.php'], { env: { ...process.env, RUMMY_DEV: '1', RUMMY_TEST_DATA_DIR: data }, stdio: 'ignore' });
  t.after(async () => { if (server.exitCode === null) { server.kill(); await new Promise(r => server.once('exit', r)); } await rm(data, { recursive: true, force: true }); });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch {} await delay(50); }
  const sessionResponse = await fetch(`${base}/api/session`, { headers: { Cookie: `mr_session=${token}` } });
  const guest = await sessionResponse.json(); assert.equal(guest.id, 'legacy-seat'); assert.equal(guest.room, room.code); assert.equal(guest.account, null);
  const backups = (await readdir(data)).filter(name => name.includes('.backup.json')); assert.equal(backups.length, 1);
  assert.equal(await readFile(join(data, backups[0]), 'utf8'), originalBytes);
  const migrated = JSON.parse(await readFile(join(data, 'state.json'), 'utf8')); assert.equal(migrated.schemaVersion, 2); assert.deepEqual(migrated.rooms[room.code], room);
  const signup = await fetch(`${base}/api/register`, { method: 'POST', headers: { Cookie: `mr_session=${token}`, Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ username: 'old_guest', name: 'Saved Player', password: 'test-upgrade-password' }) });
  assert.equal(signup.status, 200); const account = await signup.json(); assert.equal(account.id, 'legacy-seat'); assert.equal(account.room, room.code); assert.equal(account.account.points, 10000);
  const cookie = signup.headers.get('set-cookie').split(';')[0];
  const resumed = await (await fetch(`${base}/api/room?code=${room.code}`, { headers: { Cookie: cookie } })).json();
  assert.equal(resumed.players[0].name, 'Saved Player'); assert.equal(resumed.account.points, 10000);
  await fetch(`${base}/api/session`, { headers: { Cookie: cookie } });
  assert.equal((await readdir(data)).filter(name => name.includes('.backup.json')).length, 1);
});


test('Account settings routes preserve identity and store private idempotent feedback', async t => {
  const data = await mkdtemp(join(tmpdir(), 'mr-settings-http-'));
  const port = await availablePort(), base = `http://127.0.0.1:${port}`;
  const php = spawn(process.env.PHP_BIN || 'php', ['-S', `127.0.0.1:${port}`, '-t', 'public', 'public/router.php'], {env:{...process.env,RUMMY_DEV:'1',RUMMY_TEST_DATA_DIR:data},stdio:['ignore','ignore','ignore']});
  t.after(async()=>{if(php.exitCode===null){php.kill();await new Promise(r=>php.once('exit',r));}await rm(data,{recursive:true,force:true});});
  for(let i=0;i<80;i++){try{const ready=await fetch(base);await ready.text();break;}catch{await delay(50);}}
  let cookie='', csrf='';
  const call=async(route,input,override={})=>{
    const response=await fetch(`${base}/api/${route}`,{method:input===undefined?'GET':'POST',headers:{Cookie:cookie,...(input===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf,Origin:base}),...override},body:input===undefined?undefined:JSON.stringify(input)});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    const body=await response.json();if(body.csrf)csrf=body.csrf;return {status:response.status,body};
  };
  await call('session');
  assert.equal((await call('feedback',{id:'a'.repeat(32),category:'idea',message:'Idea'})).status,401);
  const registered=await call('register',{username:'original_name',name:'Player',password:'test-password-long'});
  const identity=registered.body.id;
  assert.equal((await call('username',{username:'updated_name',currentPassword:'wrong-password'})).status,400);
  const updated=await call('username',{username:'updated_name',currentPassword:'test-password-long'});
  assert.equal(updated.status,200);assert.equal(updated.body.id,identity);assert.equal(updated.body.points,10000);
  const input={id:'a'.repeat(32),category:'idea',message:'<script>alert(1)</script>'};
  assert.equal((await call('feedback',input,{'X-CSRF-Token':'bad'})).status,403);
  const saved=await call('feedback',input);assert.equal(saved.status,200);
  assert.deepEqual((await call('feedback',input)).body,saved.body);
  assert.deepEqual((await call(`feedback?id=${input.id}`)).body,saved.body);
  const state=JSON.parse(await readFile(join(data,'state.json'),'utf8'));assert.equal(Object.keys(state.feedback).length,1);
  assert.ok(!JSON.stringify(state.feedback).includes('test-password-long'));
  await call('logout',{logout:true});
  assert.equal((await call(`feedback?id=${input.id}`)).status,401);
  assert.equal((await call('login',{username:'original_name',password:'test-password-long'})).status,400);
  assert.equal((await call('login',{username:'updated_name',password:'test-password-long'})).status,200);
  assert.deepEqual((await call(`feedback?id=${input.id}`)).body,saved.body);
});
