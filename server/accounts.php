<?php
declare(strict_types=1);
require_once __DIR__ . '/game.php';

const RUMMY_SCHEMA_VERSION = 2;
const RUMMY_SIGNUP_POINTS = 10000;

/** Non-destructive, idempotent upgrade from the original guest-only store. */
function rummy_migrate(array $store): array {
    if (($store['schemaVersion'] ?? 1) > RUMMY_SCHEMA_VERSION) throw new LogicException('This state requires a newer application version.');
    if (!isset($store['sessions'], $store['rooms'], $store['limits'])) throw new LogicException('Invalid saved state. Restore a backup.');
    $store['users'] ??= [];
    $store['usernames'] ??= [];
    $store['pointEvents'] ??= [];
    $store['schemaVersion'] = RUMMY_SCHEMA_VERSION;
    return $store;
}
function rummy_username(mixed $value): string {
    rummy_require(is_string($value), 'Enter your username.');
    $value = strtolower(trim($value));
    rummy_require((bool)preg_match('/^[a-z0-9_]{3,24}$/', $value), 'Use 3–24 letters, numbers, or underscores for your username.');
    return $value;
}
function rummy_account_password(mixed $password): string {
    rummy_require(is_string($password) && strlen($password) >= 10 && strlen($password) <= 128, 'Use a password with 10–128 bytes.');
    // A fixed-length prehash avoids bcrypt's 72-byte input truncation.
    return hash('sha256', $password);
}
function rummy_credit(array &$store, string $id, string $eventId, int $amount, string $type, array $extra = []): void {
    if (isset($store['pointEvents'][$eventId])) return;
    rummy_require(isset($store['users'][$id]) && $amount >= 0 && $amount <= 1000000, 'Invalid points award.');
    $user = &$store['users'][$id];
    rummy_require($user['points'] <= PHP_INT_MAX - $amount, 'Points limit reached.');
    $user['points'] += $amount;
    $store['pointEvents'][$eventId] = array_merge($extra, [
        'id' => $eventId, 'userId' => $id, 'type' => $type, 'amount' => $amount,
        'balance' => $user['points'], 'time' => rummy_now(),
    ]);
}
function rummy_register(array &$store, string $id, mixed $username, mixed $name, mixed $password): string {
    rummy_require(!isset($store['users'][$id]), 'You are already signed in.');
    $username = rummy_username($username); $name = rummy_name($name); $hashInput = rummy_account_password($password);
    rummy_require(!isset($store['usernames'][$username]), 'That username is taken. Choose another.');
    rummy_require(count($store['users']) < 10000, 'Account limit reached. Contact your host.');
    $store['users'][$id] = [
        'id' => $id, 'username' => $username, 'name' => $name, 'passwordHash' => password_hash($hashInput, PASSWORD_DEFAULT),
        'points' => 0, 'wins' => 0, 'roundsPlayed' => 0, 'createdAt' => rummy_now(),
    ];
    $store['usernames'][$username] = $id;
    rummy_credit($store, $id, "signup:$id", RUMMY_SIGNUP_POINTS, 'signup');
    return $id;
}
function rummy_verify_login(array &$store, mixed $username, mixed $password): string {
    // Uniform errors for wrong credentials; unknown usernames still do one
    // password verification so username existence is not a cheap timing signal.
    $validName = is_string($username) && preg_match('/^[a-z0-9_]{3,24}$/', strtolower(trim($username)));
    $id = $validName ? ($store['usernames'][strtolower(trim($username))] ?? null) : null;
    $hash = $id ? $store['users'][$id]['passwordHash'] : '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.';
    $validPassword = is_string($password) && strlen($password) >= 10 && strlen($password) <= 128;
    $verified = password_verify(hash('sha256', $validPassword ? $password : ''), $hash);
    rummy_require($id !== null && $validPassword && $verified, 'Incorrect username or password.');
    if (password_needs_rehash($hash, PASSWORD_DEFAULT)) $store['users'][$id]['passwordHash'] = password_hash(hash('sha256', $password), PASSWORD_DEFAULT);
    return $id;
}
/** Avatar IDs map only to artwork bundled with the application. */
function rummy_set_avatar(array &$store, string $id, mixed $avatar): void {
    rummy_require(isset($store['users'][$id]), 'Sign in to change your avatar.');
    rummy_require(is_int($avatar) && $avatar >= 1 && $avatar <= 5, 'Choose one of the available avatars.');
    $store['users'][$id]['avatar'] = $avatar;
}
/** Keep the account ID, sessions and public player name stable when renaming. */
function rummy_change_username(array &$store, string $id, mixed $username, mixed $password): void {
    rummy_require(isset($store['users'][$id]), 'Sign in to change your username.');
    $username = rummy_username($username);
    $old = $store['users'][$id]['username'];
    rummy_require(rummy_verify_login($store, $old, $password) === $id, 'Incorrect current password.');
    rummy_require(!isset($store['usernames'][$username]) || $store['usernames'][$username] === $id, 'That username is taken. Choose another.');
    if ($username === $old) return;
    unset($store['usernames'][$old]);
    $store['usernames'][$username] = $id;
    $store['users'][$id]['username'] = $username;
}
function rummy_profile(array $store, string $id, int $offset = 0, string $filter = 'all'): ?array {
    if (!isset($store['users'][$id])) return null;
    rummy_require(in_array($filter, ['all', 'win', 'loss', 'signup'], true), 'Choose a valid history filter.');
    $p = $store['users'][$id]; unset($p['passwordHash']);
    $p['avatar'] = isset($p['avatar']) && is_int($p['avatar']) && $p['avatar'] >= 1 && $p['avatar'] <= 5 ? $p['avatar'] : null;
    $events = array_reverse(array_values(array_filter($store['pointEvents'], fn($event) => $event['userId'] === $id)));
    $p['historyAllTotal'] = count($events);
    if ($filter !== 'all') $events = array_values(array_filter($events, fn($event) => $event['type'] === $filter));
    $p['historyFilter'] = $filter;
    $p['history'] = array_map(function($event) { unset($event['userId']); return $event; }, array_slice($events, $offset, 20));
    $p['historyTotal'] = count($events); $p['historyOffset'] = $offset;
    return $p;
}
/** Called within the same storage lock/commit as a winning move or timeout. */
function rummy_settle(array &$store, array &$room): void {
    if ($room['status'] !== 'finished' || !empty($room['pointsSettled'])) return;
    // Historical/ongoing guest-only rounds have no reward snapshot: no
    // retroactive credits or guesses about who owned a previous guest seat.
    $eligible = $room['rewardParticipants'] ?? [];
    $humanRound = count($eligible) >= 2;
    $winner = $room['result']['winner'];
    $reward = 0;
    if ($humanRound && in_array($winner, $eligible, true)) {
        $reward = $room['winPointsPerOpponent'] * (count($eligible) - 1);
    }
    if ($humanRound) foreach ($eligible as $id) {
        if (!isset($store['users'][$id])) continue;
        $eventId = 'round:' . $room['roundId'] . ':' . $id;
        if (isset($store['pointEvents'][$eventId])) continue;
        $won = $id === $winner;
        $ownScore = null;
        foreach ($room['result']['scores'] as $score) if ($score['id'] === $id) { $ownScore = $score; break; }
        rummy_credit($store, $id, $eventId, $won ? $reward : 0, $won ? 'win' : 'loss', [
            'room' => $room['code'], 'round' => $room['round'], 'opponents' => count($eligible) - 1,
            'match' => ['winner' => $room['result']['winnerName'], 'reason' => $room['result']['reason'],
                'penalty' => $ownScore['penalty'] ?? null, 'totalPenalty' => $ownScore['total'] ?? null],
        ]);
        $store['users'][$id]['roundsPlayed']++;
        if ($won) $store['users'][$id]['wins']++;
    }
    $room['result']['pointsAward'] = ['winner' => $winner, 'amount' => $reward, 'eligible' => $humanRound, 'perOpponent' => $room['winPointsPerOpponent'] ?? 100];
    $room['pointsSettled'] = true;
    $room['version']++;
}
