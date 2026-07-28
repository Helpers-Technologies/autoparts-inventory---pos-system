<?php
declare(strict_types=1);

const MAX_BODY_BYTES = 65536;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

function respond(array $body, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function clean_text(mixed $value, int $maxLength = 160): string
{
    return mb_substr(trim((string)($value ?? '')), 0, $maxLength);
}

function request_path(): string
{
    $path = (string)(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
    $scriptDirectory = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
    if ($scriptDirectory !== '' && $scriptDirectory !== '/' && str_starts_with($path, $scriptDirectory)) {
        $path = substr($path, strlen($scriptDirectory)) ?: '/';
    }
    return '/' . ltrim($path, '/');
}

function request_header(string $name): string
{
    $serverKey = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    return trim((string)($_SERVER[$serverKey] ?? ''));
}

function require_https(): void
{
    $https = strtolower((string)($_SERVER['HTTPS'] ?? ''));
    $forwarded = strtolower(request_header('X-Forwarded-Proto'));
    if ($https !== 'on' && $https !== '1' && $forwarded !== 'https') {
        respond(['ok' => false, 'error' => 'https_required'], 400);
    }
}

function load_config(): array
{
    $path = __DIR__ . '/config.php';
    if (!is_file($path)) {
        respond(['ok' => false, 'error' => 'service_not_configured'], 503);
    }
    $config = require $path;
    $required = [
        'db_host',
        'db_name',
        'db_user',
        'db_password',
        'bosta_webhook_secret',
        'desktop_poll_token',
    ];
    foreach ($required as $key) {
        if (!is_array($config) || trim((string)($config[$key] ?? '')) === '') {
            respond(['ok' => false, 'error' => 'service_not_configured'], 503);
        }
    }
    return $config;
}

function database(array $config): PDO
{
    try {
        return new PDO(
            sprintf(
                'mysql:host=%s;dbname=%s;charset=utf8mb4',
                $config['db_host'],
                $config['db_name'],
            ),
            $config['db_user'],
            $config['db_password'],
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ],
        );
    } catch (Throwable) {
        respond(['ok' => false, 'error' => 'database_unavailable'], 503);
    }
}

function read_json_body(): array
{
    $contentLength = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($contentLength > MAX_BODY_BYTES) {
        respond(['ok' => false, 'error' => 'payload_too_large'], 413);
    }
    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
    if ($raw === false || strlen($raw) > MAX_BODY_BYTES) {
        respond(['ok' => false, 'error' => 'payload_too_large'], 413);
    }
    try {
        $body = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        respond(['ok' => false, 'error' => 'invalid_json'], 400);
    }
    if (!is_array($body)) respond(['ok' => false, 'error' => 'invalid_json'], 400);
    return $body;
}

function authorize_bosta(array $config): void
{
    $provided = request_header('X-Autoparts-Webhook-Key');
    if (!hash_equals((string)$config['bosta_webhook_secret'], $provided)) {
        respond(['ok' => false, 'error' => 'unauthorized'], 401);
    }
}

function authorize_desktop(array $config): void
{
    $provided = request_header('Authorization');
    $expected = 'Bearer ' . $config['desktop_poll_token'];
    if (!hash_equals($expected, $provided)) {
        respond(['ok' => false, 'error' => 'unauthorized'], 401);
    }
}

function receive_bosta_event(PDO $db, array $config): never
{
    authorize_bosta($config);
    $body = read_json_body();
    $state = filter_var($body['state'] ?? null, FILTER_VALIDATE_INT);
    $trackingNumber = clean_text($body['trackingNumber'] ?? null);
    $orderId = clean_text($body['_id'] ?? null);
    $businessReference = clean_text($body['businessReference'] ?? null);
    if ($state === false || ($trackingNumber === '' && $orderId === '' && $businessReference === '')) {
        respond(['ok' => false, 'error' => 'invalid_payload'], 400);
    }
    $timestamp = is_numeric($body['timeStamp'] ?? null)
        ? (int)$body['timeStamp']
        : (int)round(microtime(true) * 1000);
    $payload = [
        '_id' => $orderId !== '' ? $orderId : null,
        'trackingNumber' => $trackingNumber !== '' ? $trackingNumber : null,
        'state' => $state,
        'type' => clean_text($body['type'] ?? null, 80) ?: null,
        'cod' => is_numeric($body['cod'] ?? null) ? (float)$body['cod'] : null,
        'timeStamp' => $timestamp,
        'isConfirmedDelivery' => is_bool($body['isConfirmedDelivery'] ?? null)
            ? $body['isConfirmedDelivery']
            : null,
        'deliveryPromiseDate' => clean_text($body['deliveryPromiseDate'] ?? null, 40) ?: null,
        'exceptionReason' => clean_text($body['exceptionReason'] ?? null, 500) ?: null,
        'exceptionCode' => is_numeric($body['exceptionCode'] ?? null) ? (int)$body['exceptionCode'] : null,
        'businessReference' => $businessReference !== '' ? $businessReference : null,
        'numberOfAttempts' => is_numeric($body['numberOfAttempts'] ?? null)
            ? (int)$body['numberOfAttempts']
            : null,
    ];
    $id = hash('sha256', implode('|', [
        $orderId,
        $trackingNumber,
        $businessReference,
        (string)$state,
        (string)$timestamp,
    ]));
    $statement = $db->prepare(
        'INSERT IGNORE INTO bosta_webhook_events
         (id, bosta_order_id, tracking_number, business_reference, state,
          event_timestamp, payload, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())',
    );
    $statement->execute([
        $id,
        $orderId ?: null,
        $trackingNumber ?: null,
        $businessReference ?: null,
        $state,
        $timestamp,
        json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);
    $db->exec("DELETE FROM bosta_webhook_events WHERE received_at < UTC_TIMESTAMP() - INTERVAL 45 DAY");
    respond(['ok' => true, 'eventId' => $id], 202);
}

function list_events(PDO $db, array $config): never
{
    authorize_desktop($config);
    $limit = max(1, min(100, (int)($_GET['limit'] ?? 50)));
    $statement = $db->prepare(
        'SELECT id, payload, received_at
           FROM bosta_webhook_events
          WHERE consumed_at IS NULL
          ORDER BY event_timestamp ASC
          LIMIT ' . $limit,
    );
    $statement->execute();
    $events = [];
    foreach ($statement->fetchAll() as $row) {
        try {
            $payload = json_decode((string)$row['payload'], true, 64, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            continue;
        }
        $events[] = [
            'id' => $row['id'],
            'receivedAt' => $row['received_at'],
            'payload' => $payload,
        ];
    }
    respond(['ok' => true, 'events' => $events]);
}

function acknowledge_events(PDO $db, array $config): never
{
    authorize_desktop($config);
    $body = read_json_body();
    $ids = array_values(array_slice(array_filter(
        $body['ids'] ?? [],
        static fn(mixed $id): bool => is_string($id) && preg_match('/^[a-f0-9]{64}$/', $id) === 1,
    ), 0, 100));
    if ($ids === []) respond(['ok' => false, 'error' => 'ids_required'], 400);
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $db->prepare(
        "UPDATE bosta_webhook_events SET consumed_at = UTC_TIMESTAMP() WHERE id IN ($placeholders)",
    );
    $statement->execute($ids);
    respond(['ok' => true, 'acknowledged' => count($ids)]);
}

require_https();
$config = load_config();
$db = database($config);
$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$path = request_path();

if ($method === 'GET' && $path === '/health') {
    respond(['ok' => true, 'service' => 'autoparts-bosta-webhook']);
}
if ($method === 'POST' && $path === '/v1/bosta/webhook') {
    receive_bosta_event($db, $config);
}
if ($method === 'GET' && $path === '/v1/bosta/events') {
    list_events($db, $config);
}
if ($method === 'POST' && $path === '/v1/bosta/events/ack') {
    acknowledge_events($db, $config);
}
respond(['ok' => false, 'error' => 'not_found'], 404);
