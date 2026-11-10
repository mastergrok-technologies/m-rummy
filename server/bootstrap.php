<?php
declare(strict_types=1);
require_once __DIR__ . '/accounts.php';
require_once __DIR__ . '/feedback.php';
require_once __DIR__ . '/presence.php';

final class RummyApiError extends RuntimeException {
    public function __construct(string $message, public int $status = 400, public ?array $state = null) { parent::__construct($message); }
}
function rummy_limit(array &$store, string $key, int $max, int $period = 60000): void {
    $now = rummy_now();
    if (!isset($store['limits'][$key]) || $store['limits'][$key]['until'] < $now) $store['limits'][$key] = ['count' => 0, 'until' => $now + $period];
    if (++$store['limits'][$key]['count'] > $max) throw new RummyApiError('Too many requests. Please wait a minute.', 429);
}
// Bounded concurrency keeps the shared-file polling architecture predictable.
const RUMMY_TABLE_LIMIT = 3;
function rummy_joined_codes(array $store, string $id): array {
    $codes = [];
    foreach ($store['rooms'] as $code => $room) if (rummy_find($room, $id) !== null) $codes[] = (string)$code;
    return $codes;
}
function rummy_current(array $store, string $id): ?string {
    return rummy_joined_codes($store, $id)[0] ?? null;
}
function rummy_tables_view(array &$store, string $id, string $selected = ''): array {
    $tables = []; $active = null;
    foreach (rummy_joined_codes($store, $id) as $code) {
        $room = &$store['rooms'][$code];
        // Resolve deadlines for inactive tables too, under the same storage lock.
        rummy_tick($room); rummy_settle($store, $room);
        $me = $room['players'][rummy_find($room, $id)];
        $tables[] = ['code' => $code, 'version' => $room['version'], 'round' => $room['round'],
            'status' => $room['status'], 'phase' => $room['phase'], 'deadline' => $room['deadline'],
            'yourTurn' => $room['status'] === 'playing' && !$me['dropped'] && $room['players'][$room['turn']]['id'] === $id,
            'dropped' => $me['dropped'], 'playerCount' => count($room['players'])];
        if ($code === $selected) $active = $code;
        unset($room);
    }
    $active = $active !== null ? rummy_room_view($store, $store['rooms'][$active], $id) : null;
    return ['tables' => $tables, 'active' => $active, 'tableLimit' => RUMMY_TABLE_LIMIT, 'serverTime' => rummy_now()];
}
function rummy_session_cookie(string $token, array $session, array $config): void {
    setcookie('mr_session', $token, ['expires' => (int)($session['expires'] / 1000), 'path' => '/', 'secure' => $config['secure_cookies'], 'httponly' => true, 'samesite' => 'Strict']);
}
function rummy_session_view(array $store, array $session): array {
    return ['id' => $session['id'], 'csrf' => $session['csrf'], 'room' => rummy_current($store, $session['id']),
        'rooms' => rummy_joined_codes($store, $session['id']), 'tableLimit' => RUMMY_TABLE_LIMIT,
        'account' => !empty($session['accountId']) ? rummy_profile($store, $session['id']) : null];
}
function rummy_rotate_session(array &$store, string $oldToken, string $id, bool $signedIn, array $config): array {
    unset($store['sessions'][$oldToken]);
    $token = bin2hex(random_bytes(32));
    $session = ['id' => $id, 'csrf' => bin2hex(random_bytes(24)), 'expires' => rummy_now() + 30 * 86400000, 'accountId' => $signedIn ? $id : null];
    $store['sessions'][$token] = $session; rummy_session_cookie($token, $session, $config);
    return rummy_session_view($store, $session);
}
function rummy_room_view(array $store, array $room, string $id): array {
    $view = rummy_public($room, $id);
    $presence = rummy_player_presence($store, $view['players'], rummy_now());
    foreach ($view['players'] as &$player) {
        $player['presence'] = $presence[$player['id']];
        $avatar = $store['users'][$player['id']]['avatar'] ?? null;
        $player['avatar'] = is_int($avatar) && $avatar >= 1 && $avatar <= 5 ? $avatar : null;
    }
    unset($player);
    return array_merge($view, ['account' => rummy_profile($store, $id)]);
}
function rummy_handle(array &$store, array $config, string $route, string $method, array $input): array {
    $now = rummy_now(); $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    rummy_limit($store, 'ip:' . hash('sha256', $ip), 1800);
    $token = $_COOKIE['mr_session'] ?? '';
    $session = is_string($token) ? ($store['sessions'][$token] ?? null) : null;
    if ($session && $session['expires'] < $now) $session = null;
    if ($route === 'session' && $method === 'GET') {
        if (!$session) {
            rummy_limit($store, 'new:' . hash('sha256', $ip), 30);
            rummy_require(count($store['sessions']) < 10000, 'Server session limit reached. Please try later.');
            $token = bin2hex(random_bytes(32));
            $session = ['id' => bin2hex(random_bytes(16)), 'csrf' => bin2hex(random_bytes(24)), 'expires' => $now + 30 * 86400000];
            $store['sessions'][$token] = $session;
            rummy_session_cookie($token, $session, $config);
        }
        return rummy_session_view($store, $session);
    }
    if (!$session) throw new RummyApiError('Your session expired. Reload this page.', 401);
    $id = $session['id']; rummy_limit($store, "user:$id", 180);
    if ($method === 'POST') {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        $expected = $config['app_origin'] ?: 'http://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
        if (($origin && $origin !== $expected) || !hash_equals($session['csrf'], $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '')) throw new RummyApiError('Request verification failed. Reload the page.', 403);
        rummy_limit($store, "actions:$id", 60);
    }
    if (in_array($route, ['register', 'login', 'logout'], true)) {
        if ($method !== 'POST') throw new RummyApiError('Method not allowed.', 405);
        rummy_limit($store, 'auth:' . hash('sha256', $ip), 20);
        if ($route === 'logout') return rummy_rotate_session($store, $token, bin2hex(random_bytes(16)), false, $config);
        rummy_require(empty($session['accountId']), 'Sign out before switching accounts.');
        if ($route === 'register') {
            rummy_limit($store, 'signup:' . hash('sha256', $ip), 30, 3600000);
            rummy_register($store, $id, $input['username'] ?? null, $input['name'] ?? null, $input['password'] ?? null);
            foreach ($store['rooms'] as &$existingRoom) {
                $seat = rummy_find($existingRoom, $id);
                if ($seat !== null) {
                    $existingRoom['players'][$seat]['name'] = $store['users'][$id]['name'];
                    rummy_log($existingRoom, $store['users'][$id]['name'] . ' saved their player profile.');
                }
            } unset($existingRoom);
            return rummy_rotate_session($store, $token, $id, true, $config);
        }
        rummy_require(rummy_current($store, $id) === null, 'Leave your guest table first, or create an account to keep that seat.');
        $accountId = rummy_verify_login($store, $input['username'] ?? null, $input['password'] ?? null);
        return rummy_rotate_session($store, $token, $accountId, true, $config);
    }
    if (in_array($route, ['username', 'feedback'], true)) {
        if (empty($session['accountId'])) throw new RummyApiError('Sign in to use account settings.', 401);
        if ($route === 'username') {
            if ($method !== 'POST') throw new RummyApiError('Method not allowed.', 405);
            rummy_require(count($input) === 2 && isset($input['username'], $input['currentPassword']), 'Enter your new username and current password.');
            rummy_limit($store, "username:$id", 5, 900000);
            rummy_change_username($store, $id, $input['username'], $input['currentPassword']);
            return rummy_profile($store, $id);
        }
        return $method === 'POST' ? rummy_submit_feedback($store, $id, $input) : rummy_feedback_receipt($store, $id, $_GET['id'] ?? null);
    }
    if ($route === 'profile') {
        if (empty($session['accountId'])) throw new RummyApiError('Sign in to view your profile.', 401);
        if ($method === 'POST') {
            rummy_require(count($input) === 1 && array_key_exists('avatar', $input), 'Only avatar changes are supported.');
            rummy_set_avatar($store, $id, $input['avatar']);
            return rummy_profile($store, $id);
        }
        $offset = filter_var($_GET['offset'] ?? 0, FILTER_VALIDATE_INT);
        rummy_require($offset !== false && $offset >= 0 && $offset <= 1000000, 'Invalid history page.');
        $filter = $_GET['filter'] ?? 'all';
        rummy_require(is_string($filter), 'Choose a valid history filter.');
        return rummy_profile($store, $id, $offset, $filter);
    }
    if ($route === 'tables' && $method === 'GET') {
        $selected = $_GET['code'] ?? '';
        rummy_require(is_string($selected) && ($selected === '' || preg_match('/^[A-Fa-f0-9]{12}$/D', $selected)), 'Invalid selected table.');
        $presence = rummy_presence_input($_GET);
        if ($presence !== null) rummy_record_presence($store['sessions'][$token], $presence, $now);
        return rummy_tables_view($store, $id, strtoupper($selected));
    }
    if (in_array($route, ['create', 'join'], true) && empty($session['accountId'])) throw new RummyApiError('Create an account or sign in to play.', 401);
    if ($route === 'create' && $method === 'POST') {
        $key = $config['create_room_key'];
        if ($key !== '' && (!is_string($input['accessKey'] ?? null) || !hash_equals($key, $input['accessKey']))) throw new RummyApiError('Enter the host access code to create a table.', 403);
        rummy_require(count(rummy_joined_codes($store, $id)) < RUMMY_TABLE_LIMIT, 'You can join up to 3 tables. Leave a table between rounds before adding another.');
        rummy_require(count($store['rooms']) < $config['max_rooms'], 'Server is full. Please try later.');
        $room = rummy_create($id, $store['users'][$id]['name'], $input['password'] ?? '');
        rummy_log($room, $room['players'][0]['name'] . ' opened the table.');
        $store['rooms'][$room['code']] = $room;
        return rummy_room_view($store, $room, $id);
    }
    $code = $method === 'GET' ? ($_GET['code'] ?? '') : ($input['code'] ?? '');
    $code = is_string($code) ? strtoupper($code) : '';
    if (!preg_match('/^[A-F0-9]{12}$/', $code) || !isset($store['rooms'][$code])) throw new RummyApiError('Room not found or expired. Check the invite code.', 404);
    $room = &$store['rooms'][$code];
    if ($route === 'join' && $method === 'POST') {
        rummy_limit($store, "join:$id", 10);
        rummy_require(rummy_find($room, $id) !== null || count(rummy_joined_codes($store, $id)) < RUMMY_TABLE_LIMIT, 'You can join up to 3 tables. Leave a table between rounds before adding another.');
        rummy_join($room, $id, $store['users'][$id]['name'], $input['password'] ?? '');
        return rummy_room_view($store, $room, $id);
    }
    rummy_require(rummy_find($room, $id) !== null, 'Join this room first.');
    // Every connected player's poll advances an expired turn. Only one turn
    // advances per request; the exclusive storage lock prevents double moves.
    rummy_tick($room);
    rummy_settle($store, $room);
    if ($route === 'room' && $method === 'GET') return rummy_room_view($store, $room, $id);
    if ($route !== 'action' || $method !== 'POST') throw new RummyApiError('Not found.', 404);
    $action = $input['action'] ?? '';
    if ($action === 'arrange') {
        rummy_limit($store, "arrange:$id", 12);
        return rummy_analyze($room['players'][rummy_find($room, $id)]['hand'], $room['wildRank']);
    }
    if (($input['version'] ?? null) !== $room['version']) throw new RummyApiError('The table changed. Your hand has been refreshed; try again.', 409, rummy_room_view($store, $room, $id));
    switch ($action) {
        case 'start': rummy_start($room, $id, array_keys($store['users']), (int)($config['win_points_per_opponent'] ?? 100)); break;
        case 'addBot': rummy_bot($room, $id); break;
        case 'removeBot':
            rummy_require($room['host'] === $id && $room['status'] !== 'playing', 'Only the host can remove bots between rounds.');
            $i = is_string($input['playerId'] ?? null) ? rummy_find($room, $input['playerId']) : null;
            rummy_require($i !== null && $room['players'][$i]['bot'], 'Practice bot not found.');
            array_splice($room['players'], $i, 1); rummy_log($room, 'Practice bot removed.'); break;
        case 'draw': rummy_draw($room, $id, $input['source'] ?? null); break;
        case 'discard': rummy_discard($room, $id, $input['cardId'] ?? null); break;
        case 'declare': rummy_declare($room, $id, $input['cardId'] ?? null); break;
        case 'drop': rummy_drop($room, $id); break;
        case 'leave':
            rummy_leave($room, $id);
            if (!array_filter($room['players'], fn($p) => !$p['bot'])) unset($store['rooms'][$code]);
            return ['left' => true];
        case 'chat':
            rummy_limit($store, "chat:$id", 15);
            $text = $input['text'] ?? null;
            rummy_require(is_string($text) && trim($text) !== '' && strlen($text) <= 960 && preg_match('//u', $text) === 1, 'Messages must be 1–240 characters.');
            rummy_require(count(preg_split('//u', $text, -1, PREG_SPLIT_NO_EMPTY)) <= 240, 'Messages must be 1–240 characters.');
            $p = $room['players'][rummy_find($room, $id)];
            $room['messages'][] = ['id' => bin2hex(random_bytes(8)), 'name' => $p['name'], 'playerId' => $id, 'text' => trim($text), 'time' => $now];
            $room['messages'] = array_slice($room['messages'], -40); $room['version']++; $room['updatedAt'] = $now; break;
        default: throw new RummyApiError('Unknown table action.');
    }
    rummy_settle($store, $room);
    return rummy_room_view($store, $room, $id);
}

function rummy_api(): void {
    ini_set('display_errors', '0');
    header('Content-Type: application/json; charset=utf-8'); header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff'); header('Referrer-Policy: no-referrer');
    $config = ['app_origin' => '', 'secure_cookies' => true, 'data_dir' => dirname(__DIR__) . '/data', 'create_room_key' => '', 'max_rooms' => 100, 'win_points_per_opponent' => 100];
    if (is_file(__DIR__ . '/config.php')) $config = array_replace($config, require __DIR__ . '/config.php');
    if (getenv('RUMMY_TEST_DATA_DIR')) $config['data_dir'] = getenv('RUMMY_TEST_DATA_DIR');
    // Explicit dev flag is used only by the local CLI server, never hPanel.
    if (PHP_SAPI === 'cli-server' && getenv('RUMMY_DEV') === '1') $config['secure_cookies'] = false;
    $lock = null; $status = 200; $result = []; $store = null;
    try {
        $method = $_SERVER['REQUEST_METHOD']; $route = $_GET['route'] ?? '';
        if (!in_array($method, ['GET', 'POST'], true)) throw new RummyApiError('Method not allowed.', 405);
        if (!is_string($route) || !in_array($route, ['session', 'room', 'tables', 'create', 'join', 'action', 'register', 'login', 'logout', 'profile', 'username', 'feedback'], true)) throw new RummyApiError('Not found.', 404);
        if (!is_int($config['win_points_per_opponent']) || $config['win_points_per_opponent'] < 1 || $config['win_points_per_opponent'] > 10000) throw new LogicException('Invalid win points configuration.');
        $input = [];
        if ($method === 'POST') {
            if (!str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) throw new RummyApiError('Send JSON requests.', 415);
            $raw = file_get_contents('php://input', false, null, 0, 8193);
            if ($raw === false || strlen($raw) > 8192) throw new RummyApiError('Request is too large.', 413);
            try { $input = json_decode($raw, true, 32, JSON_THROW_ON_ERROR); } catch (JsonException) { throw new RummyApiError('Invalid JSON request.'); }
            rummy_require(is_array($input) && !array_is_list($input), 'Send a JSON object.');
        }
        $dir = $config['data_dir'];
        if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) throw new LogicException('Cannot create storage.');
        // Guard against accidental placement beneath the public document root.
        $realDir = realpath($dir); $public = realpath($_SERVER['DOCUMENT_ROOT'] ?? __DIR__ . '/../public');
        if ($public && ($realDir === $public || str_starts_with($realDir . '/', $public . '/'))) throw new LogicException('Storage must be outside the document root.');
        $lock = fopen($dir . '/state.lock', 'c');
        if (!$lock || !flock($lock, LOCK_EX)) throw new LogicException('Cannot lock storage.');
        chmod($dir . '/state.lock', 0600);
        $path = $dir . '/state.json';
        $store = is_file($path) ? json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR) : ['sessions' => [], 'rooms' => [], 'limits' => [], 'cleanedAt' => 0];
        if (!is_array($store) || !isset($store['sessions'], $store['rooms'], $store['limits'])) throw new LogicException('Invalid saved state. Restore a backup.');
        if (is_file($path) && ($store['schemaVersion'] ?? 1) < RUMMY_SCHEMA_VERSION) {
            $backup = $dir . '/state.v1.' . gmdate('Ymd-His') . '.' . bin2hex(random_bytes(3)) . '.backup.json';
            if (!copy($path, $backup) || !chmod($backup, 0600)) throw new LogicException('Cannot back up existing data for upgrade.');
        }
        $store = rummy_migrate($store);
        if (rummy_now() - ($store['cleanedAt'] ?? 0) > 60000) {
            $time = rummy_now();
            foreach ($store['sessions'] as $key => $s) if ($s['expires'] < $time) unset($store['sessions'][$key]);
            foreach ($store['rooms'] as $key => $r) if ($time - $r['updatedAt'] > 86400000) unset($store['rooms'][$key]);
            foreach ($store['limits'] as $key => $limit) if ($limit['until'] < $time) unset($store['limits'][$key]);
            $store['cleanedAt'] = $time;
        }
        // Keep throttles even on failures, but roll back partially applied moves.
        $before = $store;
        try { $result = rummy_handle($store, $config, $route, $method, $input); }
        catch (RummyApiError $e) {
            if ($e->status !== 409) $store = array_replace($before, ['limits' => $store['limits']]);
            $status = $e->status; $result = ['error' => $e->getMessage()];
            if ($e->state !== null) $result['state'] = $e->state;
        } catch (RuntimeException $e) { $store = array_replace($before, ['limits' => $store['limits']]); $status = 400; $result = ['error' => $e->getMessage()]; }
        $encoded = json_encode($store, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
        $temp = $dir . '/state.tmp';
        if (file_put_contents($temp, $encoded) !== strlen($encoded) || !chmod($temp, 0600) || !rename($temp, $path)) throw new LogicException('Cannot save game state.');
    } catch (RummyApiError $e) { $status = $e->status; $result = ['error' => $e->getMessage()]; }
    catch (RuntimeException $e) { $status = 400; $result = ['error' => $e->getMessage()]; }
    catch (Throwable $e) { error_log('M Rummy: ' . $e->getMessage()); $status = 503; $result = ['error' => 'The server could not load or save your table. Please try again shortly.']; }
    finally { if (is_resource($lock)) { flock($lock, LOCK_UN); fclose($lock); } }
    http_response_code($status); echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
}
