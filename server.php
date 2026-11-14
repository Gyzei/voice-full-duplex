<?php
/**
 * Voice Full Duplex - PHP WebSocket Server (PHP 8.0+ Compatible)
 * Jalankan: php server.php
 */

$host = '127.0.0.1';
$port = 8765;

$masterSocket = socket_create(AF_INET, SOCK_STREAM, SOL_TCP);
if (!$masterSocket) {
    die("Gagal membuat socket: " . socket_strerror(socket_last_error()) . "\n");
}
// Allow socket reuse
socket_set_option($masterSocket, SOL_SOCKET, SO_REUSEADDR, 1);

if (!@socket_bind($masterSocket, $host, $port)) {
    die("Port {$port} sudah digunakan oleh proses lain! Tutup proses tersebut terlebih dahulu.\n");
}
socket_listen($masterSocket, 10);

echo "==============================================\n";
echo "  Voice Full Duplex - WebSocket Server\n";
echo "  Listening on ws://{$host}:{$port} (Apache WSS proxy)\n";
echo "  Buka UI di alamat server web yang dijalankan terpisah.\n";
echo "==============================================\n\n";

$clients     = []; // array of Socket objects
$handshakes  = []; // sockId => bool
$buffers     = []; // sockId => string (incoming TCP stream buffer)
$users       = []; // sockId => ['id' => ..., 'name' => ...]
$userSockets = []; // userId => Socket object
$rooms       = []; // roomId => [sockA, sockB]

function getSockId($sock) {
    return is_object($sock) ? spl_object_id($sock) : (int)$sock;
}

function performHandshake($socket, $data) {
    if (!preg_match('/Sec-WebSocket-Key: (.+)\r\n/i', $data, $keyMatch)
        || !preg_match('/^Host:\s*([^\r\n]+)/im', $data, $hostMatch)
        || !preg_match('/^Origin:\s*(https?:\/\/[^\r\n]+)/im', $data, $originMatch)) {
        @socket_write($socket, "HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return false;
    }

    $requestHost = strtolower((string)parse_url('//' . trim($hostMatch[1]), PHP_URL_HOST));
    $originHost = strtolower((string)parse_url(trim($originMatch[1]), PHP_URL_HOST));
    $isLoopbackAlias = in_array($requestHost, ['localhost', '127.0.0.1'], true)
        && in_array($originHost, ['localhost', '127.0.0.1'], true);
    if (!$originHost || (!$isLoopbackAlias && $originHost !== $requestHost)) {
        @socket_write($socket, "HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return false;
    }

    $key = trim($keyMatch[1]);
    $acceptKey = base64_encode(sha1($key . '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', true));
    $response  = "HTTP/1.1 101 Switching Protocols\r\n"
               . "Upgrade: websocket\r\n"
               . "Connection: Upgrade\r\n"
               . "Sec-WebSocket-Accept: {$acceptKey}\r\n\r\n";
    @socket_write($socket, $response);
    return true;
}

function encodeFrame($data) {
    $length = strlen($data);
    if ($length <= 125) {
        return "\x81" . chr($length) . $data;
    } elseif ($length <= 65535) {
        return "\x81\x7E" . pack('n', $length) . $data;
    } else {
        return "\x81\x7F" . pack('J', $length) . $data;
    }
}

function extractFrames(&$buffer) {
    $frames = [];
    while (strlen($buffer) >= 2) {
        $firstByte  = ord($buffer[0]);
        $secondByte = ord($buffer[1]);
        $opcode     = $firstByte & 0x0F;
        $masked     = ($secondByte >> 7) & 0x1;
        $length     = $secondByte & 0x7F;

        $offset = 2;
        if ($length === 126) {
            if (strlen($buffer) < 4) break;
            $length = unpack('n', substr($buffer, 2, 2))[1];
            $offset = 4;
        } elseif ($length === 127) {
            if (strlen($buffer) < 10) break;
            $length = unpack('J', substr($buffer, 2, 8))[1];
            $offset = 10;
        }

        $maskLen = $masked ? 4 : 0;
        $totalFrameLen = $offset + $maskLen + $length;

        if (strlen($buffer) < $totalFrameLen) {
            // Not enough bytes yet, wait for next socket read
            break;
        }

        $frame = substr($buffer, 0, $totalFrameLen);
        $buffer = (string)substr($buffer, $totalFrameLen);

        if ($opcode === 0x8) {
            $frames[] = ['opcode' => 0x8, 'payload' => null];
            break;
        }

        if ($masked) {
            $mask = substr($frame, $offset, 4);
            $payload = substr($frame, $offset + 4, $length);
            $decoded = '';
            for ($i = 0; $i < $length; $i++) {
                $decoded .= $payload[$i] ^ $mask[$i % 4];
            }
        } else {
            $decoded = substr($frame, $offset, $length);
        }

        $frames[] = ['opcode' => $opcode, 'payload' => $decoded];
    }
    return $frames;
}

function sendToSocket($socket, $message) {
    $frame = encodeFrame(json_encode($message));
    $totalLen = strlen($frame);
    $offset = 0;
    while ($offset < $totalLen) {
        $written = @socket_write($socket, substr($frame, $offset), $totalLen - $offset);
        if ($written === false || $written === 0) {
            break;
        }
        $offset += $written;
    }
}

function broadcastUserList($clients, $users, $handshakes) {
    $userList = [];
    foreach ($clients as $sock) {
        $sid = getSockId($sock);
        if (!empty($users[$sid])) {
            $userList[] = $users[$sid];
        }
    }
    foreach ($clients as $sock) {
        $sid = getSockId($sock);
        if (!empty($handshakes[$sid])) {
            sendToSocket($sock, ['type' => 'user_list', 'users' => $userList]);
        }
    }
}

while (true) {
    $read = array_merge([$masterSocket], $clients);
    $write = $except = null;

    // 10ms timeout for ultra-low latency audio forwarding without high CPU usage
    if (@socket_select($read, $write, $except, 0, 10000) === false) continue;

    // Check if new incoming connection on master socket
    $masterIndex = array_search($masterSocket, $read, true);
    if ($masterIndex !== false) {
        unset($read[$masterIndex]);
        $newSocket = socket_accept($masterSocket);
        if ($newSocket !== false) {
            $clients[] = $newSocket;
            $sid = getSockId($newSocket);
            $handshakes[$sid] = false;
            $buffers[$sid] = '';
            echo "[+] Client baru terhubung (ID: $sid)\n";
        }
    }

    // Process read ready sockets
    foreach ($read as $sock) {
        $sid = getSockId($sock);
        $data = @socket_read($sock, 65536, PHP_BINARY_READ);

        // Connection closed or lost
        if ($data === false || $data === '') {
            $userId = !empty($users[$sid]) ? $users[$sid]['id'] : null;
            echo "[-] Client terputus (ID: $sid)" . ($userId ? " (user: $userId)" : '') . "\n";

            foreach ($rooms as $roomId => $roomSocks) {
                if (in_array($sock, $roomSocks, true)) {
                    foreach ($roomSocks as $peerSock) {
                        $peerSid = getSockId($peerSock);
                        if ($peerSock !== $sock && !empty($handshakes[$peerSid])) {
                            sendToSocket($peerSock, ['type' => 'peer_disconnected']);
                        }
                    }
                    unset($rooms[$roomId]);
                }
            }

            if ($userId && isset($userSockets[$userId])) {
                unset($userSockets[$userId]);
            }
            unset($users[$sid]);
            unset($handshakes[$sid]);
            unset($buffers[$sid]);
            $clients = array_values(array_filter($clients, fn($s) => $s !== $sock));
            @socket_close($sock);
            broadcastUserList($clients, $users, $handshakes);
            continue;
        }

        // Perform WebSocket handshake
        if (empty($handshakes[$sid])) {
            $buffers[$sid] .= $data;
            if (strlen($buffers[$sid]) > 8192) {
                @socket_write($sock, "HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n");
                @socket_close($sock);
                unset($buffers[$sid], $handshakes[$sid]);
                $clients = array_values(array_filter($clients, fn($s) => $s !== $sock));
                continue;
            }
            $headerEnd = strpos($buffers[$sid], "\r\n\r\n");
            if ($headerEnd === false) continue;

            $handshakeData = substr($buffers[$sid], 0, $headerEnd + 4);
            $data = substr($buffers[$sid], $headerEnd + 4);
            $buffers[$sid] = '';
            if (!performHandshake($sock, $handshakeData)) {
                @socket_close($sock);
                unset($buffers[$sid], $handshakes[$sid]);
                $clients = array_values(array_filter($clients, fn($s) => $s !== $sock));
                continue;
            }
            $handshakes[$sid] = true;
            echo "[~] Handshake sukses (ID: $sid)\n";
        }

        // Append received raw bytes to stream buffer
        if (!isset($buffers[$sid])) {
            $buffers[$sid] = '';
        }
        $buffers[$sid] .= $data;

        // Extract and process all complete WebSocket frames in buffer
        $frames = extractFrames($buffers[$sid]);
        foreach ($frames as $frame) {
            if ($frame['opcode'] === 0x8) {
                // Client initiated close
                $userId = !empty($users[$sid]) ? $users[$sid]['id'] : null;
                echo "[-] Client close frame (ID: $sid)" . ($userId ? " (user: $userId)" : '') . "\n";
                if ($userId && isset($userSockets[$userId])) {
                    unset($userSockets[$userId]);
                }
                unset($users[$sid]);
                unset($handshakes[$sid]);
                unset($buffers[$sid]);
                $clients = array_values(array_filter($clients, fn($s) => $s !== $sock));
                @socket_close($sock);
                broadcastUserList($clients, $users, $handshakes);
                break;
            }

            if ($frame['opcode'] !== 0x1) continue; // Only handle text/json frames

            $msg = json_decode($frame['payload'], true);
            if (!is_array($msg) || !isset($msg['type']) || !is_string($msg['type'])) continue;
            if ($msg['type'] !== 'register' && empty($users[$sid])) continue;

            switch ($msg['type']) {

                case 'register':
                    if (isset($users[$sid]) || !isset($msg['name']) || !is_string($msg['name'])) break;
                    $name = trim($msg['name']);
                    if ($name === '' || strlen($name) > 120 || !preg_match('//u', $name)) break;
                    $userId = bin2hex(random_bytes(16));
                    $users[$sid] = [
                        'id'   => $userId,
                        'name' => $name,
                    ];
                    $userSockets[$userId] = $sock;
                    echo "[R] User terdaftar: {$name} ({$userId})\n";
                    sendToSocket($sock, ['type' => 'registered', 'id' => $userId]);
                    broadcastUserList($clients, $users, $handshakes);
                    break;

                case 'call':
                    $targetSock = $userSockets[$msg['targetId']] ?? null;
                    if ($targetSock) {
                        echo "[C] {$users[$sid]['name']} memanggil {$msg['targetId']}\n";
                        sendToSocket($targetSock, [
                            'type'     => 'incoming_call',
                            'fromId'   => $users[$sid]['id'],
                            'fromName' => $users[$sid]['name'],
                        ]);
                    } else {
                        sendToSocket($sock, ['type' => 'error', 'msg' => 'User tidak ditemukan']);
                    }
                    break;

                case 'accept_call':
                    $callerSock = $userSockets[$msg['targetId']] ?? null;
                    if ($callerSock) {
                        $callerSid = getSockId($callerSock);
                        $roomId = 'room_' . uniqid();
                        $rooms[$roomId] = [$sock, $callerSock];
                        echo "[A] Call diterima: {$users[$sid]['name']} <-> {$users[$callerSid]['name']}\n";
                        sendToSocket($callerSock, [
                            'type'     => 'call_accepted',
                            'fromId'   => $users[$sid]['id'],
                            'fromName' => $users[$sid]['name'],
                            'roomId'   => $roomId,
                        ]);
                        sendToSocket($sock, [
                            'type'     => 'call_started',
                            'peerId'   => $users[$callerSid]['id'],
                            'peerName' => $users[$callerSid]['name'],
                            'roomId'   => $roomId,
                        ]);
                    }
                    break;

                case 'reject_call':
                    $callerSock = $userSockets[$msg['targetId']] ?? null;
                    if ($callerSock) {
                        echo "[X] Call ditolak oleh: {$users[$sid]['name']}\n";
                        sendToSocket($callerSock, ['type' => 'call_rejected', 'byName' => $users[$sid]['name']]);
                    }
                    break;

                case 'audio':
                    $targetSock = $userSockets[$msg['targetId']] ?? null;
                    if ($targetSock) {
                        sendToSocket($targetSock, [
                            'type' => 'audio',
                            'data' => $msg['data'],
                            'rate' => $msg['rate'] ?? 16000,
                        ]);
                    }
                    break;

                case 'end_call':
                    $targetSock = $userSockets[$msg['targetId']] ?? null;
                    echo "[E] Call diakhiri oleh: {$users[$sid]['name']}\n";
                    foreach ($rooms as $roomId => $roomSocks) {
                        if (in_array($sock, $roomSocks, true)) {
                            unset($rooms[$roomId]);
                            break;
                        }
                    }
                    if ($targetSock) {
                        sendToSocket($targetSock, ['type' => 'call_ended']);
                    }
                    break;
            }
        }
    }
}

socket_close($masterSocket);
