<?php
declare(strict_types=1);

/** Public receipt fields are returned only to the submitting account. */
function rummy_feedback_receipt(array $store, string $userId, mixed $id): array {
    rummy_require(is_string($id) && preg_match('/^[a-f0-9]{32}$/D', $id), 'Invalid submission reference.');
    $entry = $store['feedback'][$id] ?? null;
    if (!$entry || $entry['userId'] !== $userId) throw new RummyApiError('Submission not found.', 404);
    unset($entry['userId']);
    return $entry;
}
function rummy_submit_feedback(array &$store, string $userId, array $input): array {
    rummy_require(isset($store['users'][$userId]), 'Sign in to send a suggestion.');
    rummy_require(count($input) === 3 && isset($input['id'], $input['category'], $input['message']), 'Send a category, message and submission reference.');
    $id = $input['id']; $category = $input['category']; $message = $input['message'];
    rummy_require(is_string($id) && preg_match('/^[a-f0-9]{32}$/D', $id), 'Invalid submission reference.');
    rummy_require(is_string($category) && in_array($category, ['idea', 'issue', 'other'], true), 'Choose a valid category.');
    rummy_require(is_string($message) && strlen($message) <= 4000 && preg_match('//u', $message) === 1, 'Use a message of 1–1,000 characters.');
    $message = trim($message);
    rummy_require($message !== '' && count(preg_split('//u', $message, -1, PREG_SPLIT_NO_EMPTY)) <= 1000, 'Use a message of 1–1,000 characters.');
    if (isset($store['feedback'][$id])) {
        $existing = $store['feedback'][$id];
        rummy_require($existing['userId'] === $userId && $existing['category'] === $category && $existing['message'] === $message, 'This reference belongs to a different submission. Start a new suggestion.');
        return rummy_feedback_receipt($store, $userId, $id);
    }
    rummy_require(count($store['feedback'] ?? []) < 1000, 'The suggestion box is full. Please contact your host.');
    rummy_limit($store, "feedback:$userId", 5, 86400000);
    $store['feedback'][$id] = ['id' => $id, 'userId' => $userId, 'category' => $category, 'message' => $message, 'time' => rummy_now(), 'status' => 'received'];
    return rummy_feedback_receipt($store, $userId, $id);
}
