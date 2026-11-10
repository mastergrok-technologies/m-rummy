<?php
declare(strict_types=1);
require_once __DIR__ . '/../server/accounts.php';
require __DIR__ . '/helpers.php';
function account_store(int $users = 2): array {
    $s = rummy_migrate(['sessions' => [], 'rooms' => [], 'limits' => []]);
    for ($i = 0; $i < $users; $i++) rummy_register($s, "p$i", "player_$i", "Player $i", 'test-password-long');
    return $s;
}
test('Signup creates exactly 10000 points, hashed credentials and one welcome ledger event', function() {
    $s = account_store(1); same($s['users']['p0']['points'], 10000); same(count($s['pointEvents']), 1);
    check(password_verify(hash('sha256', 'test-password-long'), $s['users']['p0']['passwordHash']));
    rummy_credit($s, 'p0', 'signup:p0', 10000, 'signup'); same($s['users']['p0']['points'], 10000);
    rejects(function() use (&$s) { rummy_register($s, 'p0', 'another', 'Another', 'test-password-long'); }, 'already');
});
test('Usernames are case-insensitive and invalid registrations never create a user', function() {
    $s = account_store(1);
    rejects(function() use (&$s) { rummy_register($s, 'p1', 'PLAYER_0', 'Friend', 'test-password-long'); }, 'taken');
    rejects(function() use (&$s) { rummy_register($s, 'p1', '../bad', 'Friend', 'test-password-long'); }, '3–24');
    rejects(function() use (&$s) { rummy_register($s, 'p1', 'valid_name', 'Friend', 'short'); }, '10–128');
    same(count($s['users']), 1); same(count($s['pointEvents']), 1);
});
test('Sign-in restores the stable identity, rejects wrong credentials and never grants another bonus', function() {
    $s = account_store(1); same(rummy_verify_login($s, 'PLAYER_0', 'test-password-long'), 'p0');
    rejects(function() use (&$s) { rummy_verify_login($s, 'player_0', 'wrong-password'); }, 'Incorrect');
    rejects(function() use (&$s) { rummy_verify_login($s, 'unknown_user', 'test-password-long'); }, 'Incorrect');
    same($s['users']['p0']['points'], 10000); same(count($s['pointEvents']), 1);
});
test('Human win grants 100 per human opponent; losses keep balance; settlement is idempotent', function() {
    $s = account_store(3); $r = table(3); rummy_start_after_finish($r, $s);
    rummy_drop($r, 'p1'); rummy_drop($r, 'p2'); rummy_settle($s, $r);
    same($s['users']['p0']['points'], 10200); same($s['users']['p1']['points'], 10000); same($s['users']['p2']['points'], 10000);
    same($s['users']['p0']['wins'], 1); same($s['users']['p1']['wins'], 0);
    same($s['users']['p0']['roundsPlayed'], 1); same($r['result']['pointsAward']['amount'], 200);
    $before = $s; rummy_settle($s, $r); same($s, $before);
    $r['pointsSettled'] = false; rummy_settle($s, $r); same($s, $before);
});
function rummy_start_after_finish(array &$r, array $s, int $points = 100): void {
    $r['status'] = 'finished'; rummy_start($r, 'p0', array_keys($s['users']), $points);
}
test('Bots do not count as earning opponents and bot-only practice leaves profile stats alone', function() {
    $s = account_store(1); $r = rummy_create('p0', 'Player'); rummy_bot($r, 'p0'); rummy_start($r, 'p0', array_keys($s['users']));
    rummy_finish($r, 0, [], 'last-player'); rummy_settle($s, $r);
    same($s['users']['p0']['points'], 10000); same($s['users']['p0']['roundsPlayed'], 0); same($s['users']['p0']['wins'], 0);
    same($r['result']['pointsAward']['amount'], 0);
});
test('Mixed tables award only for registered humans and snapshot the configured reward at deal', function() {
    $s = account_store(2); $r = rummy_create('p0', 'Player'); rummy_join($r, 'p1', 'Friend', ''); rummy_bot($r, 'p0');
    rummy_start($r, 'p0', array_keys($s['users']), 250); rummy_finish($r, 0, [], 'last-player'); rummy_settle($s, $r);
    same($s['users']['p0']['points'], 10250); same($r['result']['pointsAward']['perOpponent'], 250);
});
test('Unique round IDs keep rematch rewards distinct and a bot winner earns no account credit', function() {
    $s = account_store(2); $r = rummy_create('p0', 'Player'); rummy_join($r, 'p1', 'Friend', ''); rummy_bot($r, 'p0');
    rummy_start($r, 'p0', array_keys($s['users'])); $firstId = $r['roundId']; rummy_finish($r, 0); rummy_settle($s, $r);
    rummy_start($r, 'p0', array_keys($s['users'])); check($r['roundId'] !== $firstId); rummy_finish($r, 0); rummy_settle($s, $r);
    same($s['users']['p0']['points'], 10200); same($s['users']['p0']['wins'], 2);
    rummy_start($r, 'p0', array_keys($s['users'])); rummy_finish($r, 2); rummy_settle($s, $r); same($s['users']['p0']['points'], 10200);
});
test('Profiles expose only their own points history, paginate it, and omit password hashes', function() {
    $s = account_store(2);
    for ($i = 0; $i < 25; $i++) rummy_credit($s, 'p0', "test:$i", 100, 'win');
    $p = rummy_profile($s, 'p0'); same($p['points'], 12500); same($p['historyTotal'], 26); same(count($p['history']), 20);
    same(count(rummy_profile($s, 'p0', 20)['history']), 6); same(rummy_profile($s, 'p1')['historyTotal'], 1);
    check(!isset($p['passwordHash'])); check(!isset($p['history'][0]['userId'])); same(rummy_profile($s, 'unknown'), null);
});
test('Guest-only v1 migration preserves games and sessions, is repeatable, and awards no historical wins', function() {
    $r = table(); $s = ['sessions' => ['secret' => ['id' => 'p0']], 'rooms' => [$r['code'] => $r], 'limits' => []];
    $m = rummy_migrate($s); same($m['sessions'], $s['sessions']); same($m['rooms'], $s['rooms']); same($m['schemaVersion'], 2);
    same(rummy_migrate($m), $m); rummy_register($m, 'p0', 'legacy_player', 'Legacy Player', 'test-password-long');
    rummy_drop($m['rooms'][$r['code']], 'p1'); rummy_settle($m, $m['rooms'][$r['code']]);
    same($m['users']['p0']['points'], 10000); same(count($m['pointEvents']), 1);
    try { rummy_migrate(['schemaVersion' => 999] + $s); throw new RuntimeException('Expected future-schema rejection.'); } catch (LogicException $e) { check(str_contains($e->getMessage(), 'newer')); }
});
test('Avatars persist on accounts, validate IDs and never change balances or credentials', function() {
    $s = account_store(2); $before = $s; same(rummy_profile($s, 'p0')['avatar'], null);
    rummy_set_avatar($s, 'p0', 3); same(rummy_profile($s, 'p0')['avatar'], 3);
    same(rummy_profile($s, 'p1')['avatar'], null);
    $expected = $before; $expected['users']['p0']['avatar'] = 3; same($s, $expected);
    foreach ([null, '3', 0, 6, 1.5, '../photo'] as $bad) rejects(function() use (&$s, $bad) { rummy_set_avatar($s, 'p0', $bad); }, 'available');
    same($s, $expected);
});
test('History filters preserve account isolation, totals and pagination', function() {
    $s = account_store(2);
    for ($i = 0; $i < 25; $i++) rummy_credit($s, 'p0', "filtered:$i", 100, 'win');
    rummy_credit($s, 'p0', 'filtered-loss', 0, 'loss');
    $p = rummy_profile($s, 'p0', 20, 'win'); same($p['historyFilter'], 'win'); same($p['historyTotal'], 25); same(count($p['history']), 5); same($p['historyAllTotal'], 27);
    same(rummy_profile($s, 'p1', 0, 'win')['historyTotal'], 0);
    same(rummy_profile($s, 'p0', 0, 'loss')['historyTotal'], 1);
    rejects(fn() => rummy_profile($s, 'p0', 0, 'invalid'), 'filter');
});
test('Finished rounds retain only own penalty facts in the account ledger', function() {
    $s = account_store(2); $r = rummy_create('p0', 'Player'); rummy_join($r, 'p1', 'Friend', '');
    rummy_start($r, 'p0', array_keys($s['users'])); rummy_drop($r, 'p1'); rummy_settle($s, $r);
    $event = rummy_profile($s, 'p1', 0, 'loss')['history'][0];
    same($event['match']['winner'], 'Player'); same($event['match']['penalty'], 20); same($event['match']['reason'], 'last-player');
    check(!str_contains(json_encode($event), 'hand')); check(!isset($event['userId']));
    $before = $s['pointEvents']; rummy_settle($s, $r); same($s['pointEvents'], $before);
    unset($s['rooms'][$r['code']]); same(rummy_profile($s, 'p1', 0, 'loss')['history'][0], $event);
});
echo "\n$passed account, rewards, and migration tests passed.\n";
