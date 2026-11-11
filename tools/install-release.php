<?php
declare(strict_types=1);

// Executed over SSH outside the web root. No network-accessible deploy endpoint.
function deploy_require(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function deploy_path(string $root, string $relative): string {
    deploy_require((bool)preg_match('#^(?:public_html|server)/[A-Za-z0-9_./-]+$#D', $relative) && !str_contains($relative, '..'), 'Invalid release path.');
    $path = $root;
    foreach (explode('/', $relative) as $part) { $path .= '/' . $part; deploy_require(!is_link($path), 'Refusing a symlink in the deployment path.'); }
    return $path;
}
function deploy_copy(string $source, string $destination, int $mode = 0644): void {
    $dir = dirname($destination);
    deploy_require(is_dir($dir) || mkdir($dir, 0755, true), 'Cannot create release directory.');
    $temp = @tempnam($dir, '.m-rummy-');
    if ($temp === false || dirname($temp) !== $dir) {
        if ($temp !== false && is_file($temp)) unlink($temp);
        throw new RuntimeException('Cannot prepare atomic code update.');
    }
    try {
        deploy_require(copy($source, $temp) && chmod($temp, $mode) && rename($temp, $destination), 'Cannot replace release file.');
    } finally { if (is_file($temp)) unlink($temp); }
}
function deploy_lock(string $path) {
    deploy_require(!is_link($path), 'Refusing a symlink for a deployment/data lock.');
    $file = fopen($path, 'c'); deploy_require($file !== false, 'Cannot open deployment lock.'); chmod($path, 0600);
    $until = microtime(true) + 30;
    while (!flock($file, LOCK_EX | LOCK_NB)) {
        if (microtime(true) >= $until) { fclose($file); throw new RuntimeException('Timed out waiting for an in-progress request/deployment.'); }
        usleep(100000);
    }
    return $file;
}
function install_release(string $root, string $stage, string $origin, string $sha, ?string $publicRoot = null): void {
    deploy_require(version_compare(PHP_VERSION, '8.2.0', '>='), 'PHP CLI 8.2 or newer is required on Hostinger.');
    deploy_require((bool)preg_match('/^[a-f0-9]{40}$/D', $sha), 'Invalid source commit.');
    deploy_require($root !== '/' && count(explode('/', trim($root, '/'))) >= 3 && !str_contains($root, '..') && !preg_match('#(?:^|/)public_html(?:/|$)#', $root), 'Choose the private site directory above public_html.');
    $publicRoot ??= $root . '/public_html';
    deploy_require(realpath($root) === $root && !is_link($root), 'Private deployment root must be a real directory.');
    deploy_require(realpath($publicRoot) === $publicRoot && is_dir($publicRoot) && !is_link($publicRoot), 'Public document root must exist and be a real directory.');
    if ($publicRoot !== $root . '/public_html') {
        // Only an explicit nested subdomain folder is allowed, never the main site root.
        deploy_require((bool)preg_match('#^/home/([A-Za-z0-9_-]+)/domains/[A-Za-z0-9.-]+/public_html/[A-Za-z0-9_-]+$#D', $publicRoot, $match)
            && str_starts_with($root, '/home/' . $match[1] . '/'), 'Choose a dedicated subdomain folder under the same hosting account.');
    }
    $target = static function(string $relative) use ($root, $publicRoot): string {
        if (str_starts_with($relative, 'public_html/')) {
            $path = deploy_path($root, $relative); // Validate release-relative syntax.
            $path = $publicRoot;
            foreach (explode('/', substr($relative, 12)) as $part) {
                $path .= '/' . $part;
                deploy_require(!is_link($path), 'Refusing a symlink in the public deployment path.');
            }
            return $path;
        }
        return deploy_path($root, $relative);
    };
    deploy_require(realpath($stage) === $root . '/.rummy-staging/' . $sha, 'Invalid staging directory.');
    $parsed = parse_url($origin);
    deploy_require(is_array($parsed) && ($parsed['scheme'] ?? '') === 'https' && !empty($parsed['host']) && !isset($parsed['user']) && !isset($parsed['pass']) && !isset($parsed['query']) && !isset($parsed['fragment']) && empty($parsed['path']), 'Use the exact public HTTPS origin without a path.');
    $manifest = json_decode(file_get_contents($stage . '/manifest.json'), true, 512, JSON_THROW_ON_ERROR);
    deploy_require(($manifest['version'] ?? null) === 1 && ($manifest['commit'] ?? '') === $sha && is_array($manifest['files'] ?? null), 'Release manifest does not match the tested commit.');
    foreach (['public/index.html', 'public/api.php', 'public/.htaccess', 'public/app.js', 'public/board-state.js', 'public/tutorial.js', 'public/design-system.css', 'server/bootstrap.php', 'server/accounts.php', 'server/feedback.php', 'server/presence.php', 'server/game.php', 'server/rules.php'] as $required) deploy_require(isset($manifest['files'][$required]), 'Release is missing required application files.');
    $mapping = [];
    foreach ($manifest['files'] as $source => $hash) {
        deploy_require((bool)preg_match('#^(public|server)/[A-Za-z0-9_./-]+$#D', $source) && !str_contains($source, '..') && !in_array($source, ['server/config.php', 'public/router.php'], true), 'Release contains a protected or invalid file.');
        deploy_require(is_string($hash) && preg_match('/^[a-f0-9]{64}$/D', $hash) && is_file($stage . '/' . $source) && !is_link($stage . '/' . $source) && hash_file('sha256', $stage . '/' . $source) === $hash, 'Release file checksum failed.');
        $relative = str_starts_with($source, 'public/') ? 'public_html/' . substr($source, 7) : $source;
        $target($relative); $mapping[$relative] = $source;
    }
    deploy_require(!is_file($publicRoot . '/wp-config.php') && !is_file($publicRoot . '/index.php'), 'This document root belongs to another PHP site. Use a dedicated empty subdomain.');
    if (is_file($publicRoot . '/index.html')) deploy_require(str_contains(file_get_contents($publicRoot . '/index.html'), 'M Rummy'), 'Refusing to overwrite an unrelated index.html.');
    if (is_file($root . '/server/bootstrap.php')) deploy_require(str_contains(file_get_contents($root . '/server/bootstrap.php'), 'M Rummy'), 'Refusing to overwrite another application server directory.');
    $guard = deploy_lock($root . '/.deploy.lock'); $stateLock = null; $backup = null; $changed = []; $createdConfig = false;
    try {
        deploy_require(!is_link($root . '/server') && !is_link($root . '/server/config.php'), 'Private configuration must not be a symlink.');
        $configPath = $root . '/server/config.php';
        $config = is_file($configPath) ? require $configPath : ['app_origin' => $origin, 'data_dir' => $root . '/data'];
        deploy_require(is_array($config) && ($config['app_origin'] ?? '') === $origin, 'Existing app_origin must match HOSTINGER_APP_URL; configure it privately on the server.');
        $data = $config['data_dir'] ?? $root . '/data';
        deploy_require(is_string($data) && str_starts_with($data, '/') && !preg_match('#(?:^|/)public_html(?:/|$)#', $data), 'Game data must be outside public_html.');
        deploy_require(!is_link($data) && (is_dir($data) || mkdir($data, 0700, true)), 'Cannot prepare private game storage.');
        $realData = realpath($data);
        deploy_require($realData !== false && !preg_match('#(?:^|/)public_html(?:/|$)#', $realData), 'Game data resolves inside public_html.');
        $stateLock = deploy_lock($data . '/state.lock');
        if (is_file($data . '/state.json')) {
            $state = json_decode(file_get_contents($data . '/state.json'), true, 512, JSON_THROW_ON_ERROR);
            deploy_require(is_array($state) && isset($state['rooms'], $state['sessions']), 'Saved state is invalid; deployment stopped without changing it.');
            foreach ($state['rooms'] as $room) deploy_require(($room['status'] ?? '') !== 'playing' || (time() * 1000 - ($room['updatedAt'] ?? 0)) >= 86400000, 'A round is still playing. Finish it, then rerun the deployment.');
        }
        deploy_require(!is_link($root . '/.rummy-backups'), 'Private backups must not be a symlink.');
        $backup = $root . '/.rummy-backups/' . gmdate('Ymd-His') . '-' . substr($sha, 0, 12) . '-' . bin2hex(random_bytes(3));
        deploy_require(mkdir($backup, 0700, true), 'Cannot create the private deployment backup.');
        if (is_file($configPath)) deploy_copy($configPath, $backup . '/config.php', 0600);
        if (is_file($data . '/state.json')) deploy_copy($data . '/state.json', $backup . '/state.json', 0600);
        $existing = [];
        foreach ($mapping as $relative => $source) {
            $destination = $target($relative);
            $existing[$relative] = is_file($destination);
            if ($existing[$relative]) deploy_copy($destination, $backup . '/code/' . $relative);
        }
        $backupIndex = json_encode($existing, JSON_THROW_ON_ERROR);
        deploy_require(file_put_contents($backup . '/files.json', $backupIndex) === strlen($backupIndex) && chmod($backup . '/files.json', 0600), 'Cannot save the private backup index.');
        if (!is_file($configPath)) {
            deploy_require(is_dir(dirname($configPath)) || mkdir(dirname($configPath), 0755, true), 'Cannot prepare server directory.');
            $config = ['app_origin' => $origin, 'secure_cookies' => true, 'data_dir' => $data, 'create_room_key' => '', 'max_rooms' => 100, 'win_points_per_opponent' => 100];
            $configText = "<?php\nreturn " . var_export($config, true) . ";\n";
            $configTemp = tempnam(dirname($configPath), '.m-rummy-config-');
            deploy_require($configTemp !== false, 'Cannot prepare private configuration.');
            try {
                deploy_require(file_put_contents($configTemp, $configText) === strlen($configText), 'Cannot initialize private configuration.');
                deploy_copy($configTemp, $configPath, 0600); $createdConfig = true;
            } finally { if (is_file($configTemp)) unlink($configTemp); }
        }
        // Bind the public entry point to private code and the same deployment lock.
        $apiText = str_replace('dirname(__DIR__)', var_export($root, true), file_get_contents($stage . '/public/api.php'));
        $boundApi = $backup . '/bound-api.php';
        deploy_require(file_put_contents($boundApi, $apiText) === strlen($apiText), 'Cannot prepare private API binding.');
        // Install the request guard first; new API requests return retryable 503
        // during this short update. Existing file-lock-aware requests finish first.
        $ordered = ['public_html/api.php' => $mapping['public_html/api.php']] + $mapping;
        foreach ($ordered as $relative => $source) {
            deploy_copy($source === 'public/api.php' ? $boundApi : $stage . '/' . $source, $target($relative));
            $changed[] = $relative;
        }
        $marker = json_encode(['commit' => $sha, 'deployedAt' => gmdate(DATE_ATOM), 'backup' => basename($backup)], JSON_THROW_ON_ERROR);
        $markerTemp = tempnam($root, '.m-rummy-marker-');
        deploy_require($markerTemp !== false && file_put_contents($markerTemp, $marker) === strlen($marker) && chmod($markerTemp, 0600) && rename($markerTemp, $root . '/.m-rummy-deploy.json'), 'Cannot record deployment commit.');
        echo "Deployed tested commit $sha. Code/config/state backup retained privately.\n";
    } catch (Throwable $error) {
        $rollbackFailed = false;
        foreach (array_reverse($changed) as $relative) {
            try {
                $destination = $target($relative);
                if (is_file($backup . '/code/' . $relative)) deploy_copy($backup . '/code/' . $relative, $destination);
                elseif (is_file($destination)) deploy_require(unlink($destination), 'Cannot remove a new release file.');
            } catch (Throwable) { $rollbackFailed = true; }
        }
        if ($createdConfig && is_file($root . '/server/config.php')) unlink($root . '/server/config.php');
        if ($rollbackFailed) throw new RuntimeException('Deployment failed and code rollback needs manual recovery from the private backup.', 0, $error);
        throw $error;
    } finally {
        if (is_resource($stateLock)) { flock($stateLock, LOCK_UN); fclose($stateLock); }
        flock($guard, LOCK_UN); fclose($guard);
    }
}
if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    try {
        deploy_require(($argc === 5 || $argc === 6), 'Usage: php install.php SITE_DIRECTORY STAGING_DIRECTORY HTTPS_ORIGIN COMMIT_SHA [PUBLIC_DIRECTORY]');
        install_release($argv[1], $argv[2], $argv[3], $argv[4], $argv[5] ?? null);
    } catch (Throwable $e) { fwrite(STDERR, 'Deployment stopped: ' . $e->getMessage() . "\n"); exit(1); }
}

