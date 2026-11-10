<?php
declare(strict_types=1);
require __DIR__ . '/helpers.php';
require __DIR__ . '/../tools/install-release.php';
$fixtures = [];
function fixture(bool $existing = true, ?string $baseDirectory = null): array {
    global $fixtures;
    $base = ($baseDirectory ?? sys_get_temp_dir()) . '/mr-deploy-' . bin2hex(random_bytes(6)); $fixtures[] = $base;
    $root = $base . '/site'; $sha = str_repeat('a', 40); $stage = $root . '/.rummy-staging/' . $sha;
    mkdir($root . '/public_html', 0755, true); mkdir($stage, 0700, true);
    $files = ['public/index.html', 'public/api.php', 'public/.htaccess', 'public/app.js', 'public/board-state.js', 'public/tutorial.js', 'server/bootstrap.php', 'server/accounts.php', 'server/feedback.php', 'server/presence.php', 'server/game.php', 'server/rules.php'];
    $manifest = ['version' => 1, 'commit' => $sha, 'files' => []];
    foreach ($files as $file) {
        if (!is_dir(dirname($stage . '/' . $file))) mkdir(dirname($stage . '/' . $file), 0755, true);
        copy(__DIR__ . '/../' . $file, $stage . '/' . $file); $manifest['files'][$file] = hash_file('sha256', $stage . '/' . $file);
    }
    file_put_contents($stage . '/manifest.json', json_encode($manifest));
    if ($existing) {
        mkdir($root . '/server'); mkdir($root . '/data', 0700);
        file_put_contents($root . '/public_html/index.html', '<title>M Rummy previous release</title>');
        file_put_contents($root . '/public_html/api.php', '<?php /* previous api */');
        file_put_contents($root . '/server/bootstrap.php', '<?php /* M Rummy previous server */');
        $config = ['app_origin' => 'https://rummy.example.com', 'data_dir' => $root . '/data', 'create_room_key' => 'kept-private', 'win_points_per_opponent' => 225];
        file_put_contents($root . '/server/config.php', '<?php return ' . var_export($config, true) . ';');
        file_put_contents($root . '/data/state.json', json_encode(['schemaVersion' => 2, 'sessions' => [], 'rooms' => [], 'users' => ['p0' => ['points' => 42424]], 'pointEvents' => []]));
    }
    return [$root, $stage, $sha];
}
function run_install(array $f): void {
    ob_start();
    try { install_release($f[0], $f[1], 'https://rummy.example.com', $f[2]); }
    finally { ob_end_clean(); }
}
function remove_fixture(string $dir): void {
    if (is_link($dir) || is_file($dir)) { unlink($dir); return; }
    chmod($dir, 0700);
    foreach (array_diff(scandir($dir), ['.', '..']) as $name) remove_fixture($dir . '/' . $name);
    rmdir($dir);
}
register_shutdown_function(function() use (&$fixtures) { foreach ($fixtures as $f) if (is_dir($f)) remove_fixture($f); });

test('SSH release updates code and preserves exact player state and private configuration', function() {
    $f = fixture(); [$root, $stage, $sha] = $f;
    $config = file_get_contents($root . '/server/config.php'); $state = file_get_contents($root . '/data/state.json');
    run_install($f);
    same(file_get_contents($root . '/server/config.php'), $config); same(file_get_contents($root . '/data/state.json'), $state);
    same(hash_file('sha256', $root . '/server/accounts.php'), hash_file('sha256', $stage . '/server/accounts.php'));
    same(json_decode(file_get_contents($root . '/.m-rummy-deploy.json'), true)['commit'], $sha);
    $backups = glob($root . '/.rummy-backups/*'); same(count($backups), 1);
    same(file_get_contents($backups[0] . '/config.php'), $config); same(file_get_contents($backups[0] . '/state.json'), $state);
    same(fileperms($backups[0] . '/state.json') & 0777, 0600);
    run_install($f); same(file_get_contents($root . '/data/state.json'), $state); same(file_get_contents($root . '/server/config.php'), $config);
});
test('Missing required presence or browser modules are refused before replacing any code', function() {
    foreach (['server/feedback.php', 'server/presence.php', 'public/board-state.js', 'public/tutorial.js'] as $required) {
        $f = fixture(); $old = file_get_contents($f[0] . '/server/bootstrap.php');
        $manifest = json_decode(file_get_contents($f[1] . '/manifest.json'), true);
        unset($manifest['files'][$required]); file_put_contents($f[1] . '/manifest.json', json_encode($manifest));
        rejects(fn() => run_install($f), 'missing required');
        same(file_get_contents($f[0] . '/server/bootstrap.php'), $old);
        check(!file_exists($f[0] . '/.m-rummy-deploy.json'));
    }
});
test('First deployment initializes HTTPS configuration outside public_html', function() {
    $f = fixture(false); run_install($f); $config = require $f[0] . '/server/config.php';
    same($config['app_origin'], 'https://rummy.example.com'); same($config['secure_cookies'], true); same($config['win_points_per_opponent'], 100);
    check(is_dir($f[0] . '/data')); check(!file_exists($f[0] . '/public_html/config.php')); same(fileperms($f[0] . '/server/config.php') & 0777, 0600);
});
test('Tampered archive, wrong commit, and unsafe origins are rejected before changing code', function() {
    $f = fixture(); $old = file_get_contents($f[0] . '/public_html/api.php');
    file_put_contents($f[1] . '/public/app.js', 'tampered'); rejects(fn() => run_install($f), 'checksum');
    rejects(fn() => install_release($f[0], $f[1], 'https://rummy.example.com', str_repeat('b', 40)), 'staging');
    rejects(fn() => install_release($f[0], $f[1], 'https://someone@rummy.example.com', $f[2]), 'origin');
    same(file_get_contents($f[0] . '/public_html/api.php'), $old);
});
test('Active rounds and corrupt data prevent deployment, preserving live balances', function() {
    $f = fixture(); $path = $f[0] . '/data/state.json'; $before = file_get_contents($f[0] . '/public_html/index.html');
    file_put_contents($path, json_encode(['sessions' => [], 'rooms' => [['status' => 'playing', 'updatedAt' => (int)(microtime(true) * 1000)]]]));
    $state = file_get_contents($path); rejects(fn() => run_install($f), 'round is still'); same(file_get_contents($path), $state);
    file_put_contents($path, '{broken');
    try { run_install($f); throw new RuntimeException('Expected corrupt-state rejection.'); } catch (JsonException) { /* Expected. */ }
    same(file_get_contents($path), '{broken'); same(file_get_contents($f[0] . '/public_html/index.html'), $before);
});
test('Unrelated sites, protected paths, and symlink destinations are rejected', function() {
    $f = fixture(); file_put_contents($f[0] . '/public_html/index.php', '<?php /* another app */');
    rejects(fn() => run_install($f), 'another PHP site'); unlink($f[0] . '/public_html/index.php');
    $manifest = json_decode(file_get_contents($f[1] . '/manifest.json'), true); $manifest['files']['server/config.php'] = hash('sha256', 'bad');
    file_put_contents($f[1] . '/manifest.json', json_encode($manifest)); rejects(fn() => run_install($f), 'protected');
    unset($manifest['files']['server/config.php']); file_put_contents($f[1] . '/manifest.json', json_encode($manifest));
    symlink($f[0] . '/data/state.json', $f[0] . '/public_html/app.js'); rejects(fn() => run_install($f), 'symlink');
});
test('A failed code copy rolls back earlier updates and never restores or overwrites player data', function() {
    $f = fixture(); $root = $f[0]; $stage = $f[1];
    mkdir($root . '/public_html/blocked', 0500); mkdir($stage . '/public/blocked'); file_put_contents($stage . '/public/blocked/late.txt', 'new file');
    $manifest = json_decode(file_get_contents($stage . '/manifest.json'), true); $manifest['files']['public/blocked/late.txt'] = hash('sha256', 'new file');
    file_put_contents($stage . '/manifest.json', json_encode($manifest));
    $oldApi = file_get_contents($root . '/public_html/api.php'); $oldServer = file_get_contents($root . '/server/bootstrap.php'); $oldState = file_get_contents($root . '/data/state.json');
    rejects(fn() => run_install($f), 'atomic code update');
    same(file_get_contents($root . '/public_html/api.php'), $oldApi); same(file_get_contents($root . '/server/bootstrap.php'), $oldServer);
    same(file_get_contents($root . '/data/state.json'), $oldState); check(!file_exists($root . '/server/accounts.php')); check(!file_exists($root . '/.m-rummy-deploy.json'));
});
test('Nested subdomain deployment binds private code and preserves the main website and points', function() {
    $home = getenv('HOME');
    check((bool)preg_match('#^/home/[A-Za-z0-9_-]+$#D', $home));
    $f = fixture(true, $home); [$root, $stage, $sha] = $f;
    // Both roots share the same hosting account but only public assets go under the main domain.
    $domain = $home . '/domains/mr-test-' . bin2hex(random_bytes(6));
    global $fixtures; $fixtures[] = $domain;
    $public = $domain . '/public_html/m';
    mkdir($public, 0755, true);
    file_put_contents($domain . '/public_html/index.php', '<?php /* main app */');
    file_put_contents($public . '/api.php', '<?php /* old subdomain API */');
    $state = file_get_contents($root . '/data/state.json');
    ob_start();
    try { install_release($root, $stage, 'https://rummy.example.com', $sha, $public); }
    finally { ob_end_clean(); }
    same(file_get_contents($domain . '/public_html/index.php'), '<?php /* main app */');
    same(file_get_contents($root . '/data/state.json'), $state);
    $api = file_get_contents($public . '/api.php');
    check(str_contains($api, var_export($root, true) . " . '/server/bootstrap.php'"));
    check(str_contains($api, var_export($root, true) . " . '/.deploy.lock'"));
    check(!file_exists($public . '/server')); check(!file_exists($public . '/data'));
    ob_start();
    try { install_release($root, $stage, 'https://rummy.example.com', $sha, $public); }
    finally { ob_end_clean(); }
    same(file_get_contents($root . '/data/state.json'), $state);
    rejects(fn() => install_release($root, $stage, 'https://rummy.example.com', $sha, $domain . '/public_html'), 'dedicated subdomain');
    unlink($public . '/app.js'); symlink($domain . '/public_html/index.php', $public . '/app.js');
    rejects(fn() => install_release($root, $stage, 'https://rummy.example.com', $sha, $public), 'symlink');
});
echo "\n$passed deployment safety tests passed.\n";

