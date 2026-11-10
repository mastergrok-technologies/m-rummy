<?php
declare(strict_types=1);
require_once __DIR__ . '/../server/bootstrap.php';
require __DIR__ . '/helpers.php';
function tables_store(): array {
    $store = rummy_migrate(['sessions' => [], 'rooms' => [], 'limits' => []]);
    foreach (['a', 'b', 'c', 'outsider'] as $id) rummy_register($store, $id, "user_$id", "Player $id", 'test-password-long');
    $store['sessions']['test-token'] = ['id' => 'a', 'csrf' => 'test-csrf', 'expires' => rummy_now() + 60000, 'accountId' => 'a'];
    $_COOKIE['mr_session'] = 'test-token'; $_SERVER['HTTP_X_CSRF_TOKEN'] = 'test-csrf';
    return $store;
}
function tables_config(): array { return ['create_room_key' => '', 'max_rooms' => 100, 'app_origin' => '', 'win_points_per_opponent' => 100]; }
function tables_add(array &$store, string $id): string {
    $r = rummy_create($id, "Player $id"); $store['rooms'][$r['code']] = $r; return $r['code'];
}
test('One account can create three tables; cap and same-table rejoin are enforced', function() {
    $s = tables_store(); $codes = [];
    for ($i = 0; $i < 3; $i++) $codes[] = rummy_handle($s, tables_config(), 'create', 'POST', [])['code'];
    same(count(rummy_joined_codes($s, 'a')), 3);
    rejects(function() use (&$s) { rummy_handle($s, tables_config(), 'create', 'POST', []); }, 'up to 3');
    same(rummy_handle($s, tables_config(), 'join', 'POST', ['code' => $codes[0]])['code'], $codes[0]);
    $other = tables_add($s, 'b');
    rejects(function() use (&$s, $other) { rummy_handle($s, tables_config(), 'join', 'POST', ['code' => $other]); }, 'up to 3');
    $first = $s['rooms'][$codes[0]];
    rummy_handle($s, tables_config(), 'action', 'POST', ['code' => $codes[0], 'action' => 'leave', 'version' => $first['version']]);
    same(rummy_handle($s, tables_config(), 'join', 'POST', ['code' => $other])['code'], $other);
    same(count(rummy_joined_codes($s, 'a')), 3);
});
test('Summary only lists own memberships and never leaks private hands or credentials', function() {
    $s = tables_store(); $own = tables_add($s, 'a'); $other = tables_add($s, 'b');
    rummy_join($s['rooms'][$own], 'b', 'Player b', ''); rummy_start($s['rooms'][$own], 'a', array_keys($s['users']));
    $view = rummy_tables_view($s, 'a', $own);
    same(count($view['tables']), 1); same($view['tables'][0]['code'], $own); same($view['tableLimit'], 3);
    same(count($view['active']['hand']), 13); check($view['tables'][0]['yourTurn']);
    $json = json_encode($view['tables']);
    foreach (['hand', 'stock', 'password', 'csrf', 'session', $other] as $secret) check(!str_contains($json, $secret));
    foreach ($view['active']['players'] as $player) check(!isset($player['hand']));
    same(rummy_tables_view($s, 'a', $other)['active'], null);
    same(rummy_tables_view($s, 'outsider', $own)['tables'], []);
});
test('Inactive tables advance deadlines and settle once without changing another hand', function() {
    $s = tables_store(); $codes = [];
    foreach (['b', 'c'] as $opponent) {
        $code = tables_add($s, 'a'); $codes[] = $code;
        rummy_join($s['rooms'][$code], $opponent, "Player $opponent", ''); rummy_start($s['rooms'][$code], 'a', array_keys($s['users']));
    }
    $first = $s['rooms'][$codes[0]]; $secondVersion = $s['rooms'][$codes[1]]['version'];
    $s['rooms'][$codes[1]]['deadline'] = rummy_now() - 1;
    rummy_tables_view($s, 'a', $codes[0]);
    same($s['rooms'][$codes[0]], $first); check($s['rooms'][$codes[1]]['version'] > $secondVersion);
    // Finish the inactive table; repeated aggregate polls must not duplicate credit.
    rummy_drop($s['rooms'][$codes[1]], 'c');
    rummy_tables_view($s, 'a', $codes[0]); $points = $s['users']['a']['points'];
    rummy_tables_view($s, 'a', $codes[0]); same($s['users']['a']['points'], $points); same($points, 10100);
});
test('Commands, card identity and version checks remain scoped to their table', function() {
    $s = tables_store(); $a = tables_add($s, 'a'); $b = tables_add($s, 'a');
    foreach ([$a, $b] as $code) { rummy_join($s['rooms'][$code], 'b', 'Player b', ''); rummy_start($s['rooms'][$code], 'a', array_keys($s['users'])); }
    $before = $s['rooms'][$b]; $version = $s['rooms'][$a]['version'];
    rummy_handle($s, tables_config(), 'action', 'POST', ['code' => $a, 'version' => $version, 'action' => 'draw', 'source' => 'stock']);
    same($s['rooms'][$b], $before); same(count($s['rooms'][$a]['players'][0]['hand']), 14);
    try { rummy_handle($s, tables_config(), 'action', 'POST', ['code' => $a, 'version' => $version, 'action' => 'draw', 'source' => 'stock']); throw new Exception('Expected conflict'); }
    catch (RummyApiError $e) { same($e->status, 409); same($e->state['code'], $a); }
});
test('Profile updates are authenticated and verified without changing game state', function() {
    $s = tables_store(); $code = tables_add($s, 'a');
    rummy_join($s['rooms'][$code], 'b', 'Player b', ''); rummy_start($s['rooms'][$code], 'a', array_keys($s['users']));
    $roomBefore = $s['rooms'][$code]; $eventsBefore = $s['pointEvents']; $pointsBefore = $s['users']['a']['points'];
    $_SERVER['HTTP_HOST'] = 'localhost'; $_SERVER['HTTP_ORIGIN'] = 'http://localhost'; $_GET = [];
    $profile = rummy_handle($s, tables_config(), 'profile', 'POST', ['avatar' => 3]); same($profile['avatar'], 3);
    same($s['rooms'][$code], $roomBefore); same($s['pointEvents'], $eventsBefore); same($s['users']['a']['points'], $pointsBefore);
    $view = rummy_room_view($s, $s['rooms'][$code], 'b');
    same($view['players'][0]['avatar'], 3); same($view['version'], $roomBefore['version']);
    check(!isset($view['players'][0]['passwordHash'])); check(!isset($view['players'][0]['hand']));
    $_SERVER['HTTP_X_CSRF_TOKEN'] = 'bad';
    rejects(function() use (&$s) { rummy_handle($s, tables_config(), 'profile', 'POST', ['avatar' => 4]); }, 'verification');
    $_SERVER['HTTP_X_CSRF_TOKEN'] = 'test-csrf'; $_SERVER['HTTP_ORIGIN'] = 'https://evil.example';
    rejects(function() use (&$s) { rummy_handle($s, tables_config(), 'profile', 'POST', ['avatar' => 4]); }, 'verification');
    $_SERVER['HTTP_ORIGIN'] = 'http://localhost';
    rejects(function() use (&$s) { rummy_handle($s, tables_config(), 'profile', 'POST', ['avatar' => 4, 'points' => 1000000]); }, 'Only avatar');
    same($s['users']['a']['avatar'], 3);
    $_GET = ['filter' => ['win']];
    rejects(function() use (&$s) { rummy_handle($s, tables_config(), 'profile', 'GET', []); }, 'filter');
    $_GET = []; unset($s['sessions']['test-token']['accountId']);
    rejects(function() use (&$s) { rummy_handle($s, tables_config(), 'profile', 'POST', ['avatar' => 4]); }, 'Sign in');
    unset($_SERVER['HTTP_ORIGIN']);
});
echo "\n$passed multi-table tests passed.\n";
