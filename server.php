<?php
/**
 * Voice Full Duplex - PHP WebSocket Server (PHP 8.0+ Compatible)
 * Fitur: Group Publik, Group Call (WebRTC Mesh Signaling, Maks 6 Peserta), dan Chat Multimedia.
 * Jalankan: php server.php atau start_server.bat
 */

$config = file_exists(__DIR__ . '/config.php') ? require __DIR__ . '/config.php' : [];
$bindHost = $config['ws_bind_host'] ?? $config['ws_host'] ?? '0.0.0.0';
$port = $config['ws_port'] ?? 8765;
$maxGroupCallLimit = $config['group_call']['max_participants_limit'] ?? 6;

$masterSocket = socket_create(AF_INET, SOCK_STREAM, SOL_TCP);
if (!$masterSocket) {
    die("Gagal membuat socket: " . socket_strerror(socket_last_error()) . "\n");
}

// Allow socket reuse on non-Windows. On Windows, SO_REUSEADDR allows multiple processes
// to bind to the same port simultaneously, masking conflicts and causing socket hijacking.
if (PHP_OS_FAMILY !== 'Windows') {
    socket_set_option($masterSocket, SOL_SOCKET, SO_REUSEADDR, 1);
}

if (!@socket_bind($masterSocket, $bindHost, $port)) {
    $errCode = socket_last_error($masterSocket);
    $errMsg = socket_strerror($errCode);
    die("[ERROR] Gagal bind socket pada {$bindHost}:{$port}: $errMsg (Kode: $errCode).\nPastikan tidak ada server WebSocket lain yang berjalan pada port {$port}.\n");
}
socket_listen($masterSocket, 20);

// Deteksi alamat IP LAN laptop untuk kenyamanan pengguna
$lanIps = [];
if (PHP_OS_FAMILY === 'Windows') {
    @exec('ipconfig 2>nul', $ipLines);
    foreach ($ipLines as $line) {
        if (preg_match('/IPv4 Address[.\s]+:\s*([\d\.]+)/i', $line, $m)) {
            $ip = trim($m[1]);
            if ($ip !== '127.0.0.1' && !in_array($ip, $lanIps, true)) {
                $lanIps[] = $ip;
            }
        }
    }
}

echo "==============================================\n";
echo "  VoiceLink - WebSocket Server (Group & Voice)\n";
echo "  Listening on : ws://{$bindHost}:{$port}\n";
echo "  - Localhost  : ws://127.0.0.1:{$port}\n";
if (!empty($lanIps)) {
    foreach ($lanIps as $lip) {
        echo "  - LAN / HP   : ws://{$lip}:{$port}\n";
    }
}
echo "  Buka UI di browser (Laragon / Web Server):\n";
echo "  - Laptop : http://localhost/voice-full-duplex-master/\n";
if (!empty($lanIps)) {
    foreach ($lanIps as $lip) {
        echo "  - HP     : http://{$lip}/voice-full-duplex-master/\n";
        echo "             https://{$lip}/voice-full-duplex-master/ (jika SSL aktif)\n";
    }
}
echo "==============================================\n\n";

$clients     = []; // array of Socket objects
$handshakes  = []; // sockId => bool
$buffers     = []; // sockId => string (incoming TCP stream buffer)
$users       = []; // sockId => ['id' => ..., 'name' => ...]
$userSockets = []; // userId => Socket object
$rooms       = []; // roomId => [sockA, sockB] (1-on-1 calls)

// Group Call State (Public Group Voice Call, Max 6 participants)
$groupCall = [
    'active'          => false,
    'hostId'          => null,
    'maxParticipants' => $maxGroupCallLimit,
    'participants'    => [] // userId => ['id' => ..., 'name' => ..., 'isMuted' => bool]
];

// Riwayat pesan chat group publik (disimpan dalam memori, maksimal 50 pesan terakhir)
$groupChatHistory = [];

// Riwayat pesan chat personal: convKey => array of messages (maks 50 per percakapan)
$personalChatHistory = [];
$maxPersonalHistoryPerPair = $config['personal_chat']['max_history_per_pair'] ?? 50;

// State panggilan suara personal (WebRTC 1-on-1): callId => call data
$personalCalls = [];

function getConvKey($idA, $idB) {
    return strcmp($idA, $idB) < 0 ? "{$idA}_{$idB}" : "{$idB}_{$idA}";
}

function getSockId($sock) {
    return is_object($sock) ? spl_object_id($sock) : (int)$sock;
}

function isAllowedHost($host) {
    if (!$host) return false;
    $host = strtolower(trim($host));

    // Loopback
    if (in_array($host, ['localhost', '127.0.0.1', '::1'], true)) {
        return true;
    }

    // Domain lokal pengembangan (.test, .local, .lan)
    if (str_ends_with($host, '.test') || str_ends_with($host, '.local') || str_ends_with($host, '.lan')) {
        return true;
    }

    // IP Private / LAN IPv4 (RFC 1918: 10.x.x.x, 172.16-31.x.x, 192.168.x.x, 169.254.x.x)
    if (filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
        $isPublic = filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
        return ($isPublic === false);
    }

    return false;
}

function performHandshake($socket, $data) {
    if (!preg_match('/Sec-WebSocket-Key:\s*([^\r\n]+)/i', $data, $keyMatch)
        || !preg_match('/^Host:\s*([^\r\n]+)/im', $data, $hostMatch)
        || !preg_match('/^Origin:\s*(https?:\/\/[^\r\n]+)/im', $data, $originMatch)) {
        @socket_write($socket, "HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return false;
    }

    $requestHost = strtolower((string)parse_url('//' . trim($hostMatch[1]), PHP_URL_HOST));
    $originHost  = strtolower((string)parse_url(trim($originMatch[1]), PHP_URL_HOST));

    // Periksa apakah ada header X-Forwarded-Host dari reverse proxy (misal Apache)
    if (preg_match('/^X-Forwarded-Host:\s*([^\r\n]+)/im', $data, $fwdMatch)) {
        $fwdRaw = trim(explode(',', $fwdMatch[1])[0]);
        $fwdHost = strtolower((string)parse_url('//' . $fwdRaw, PHP_URL_HOST));
        if ($fwdHost && isAllowedHost($fwdHost)) {
            $requestHost = $fwdHost;
        }
    }

    // Validasi Origin dan RequestHost: Hanya izinkan Localhost, IP Private LAN, dan Domain Lokal
    if (!isAllowedHost($originHost) || !isAllowedHost($requestHost)) {
        echo "[-] Handshake ditolak: Origin '$originHost' atau Host '$requestHost' tidak diizinkan.\n";
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

function broadcastToAll($clients, $handshakes, $message) {
    foreach ($clients as $sock) {
        $sid = getSockId($sock);
        if (!empty($handshakes[$sid])) {
            sendToSocket($sock, $message);
        }
    }
}

function broadcastUserList($clients, $users, $handshakes) {
    // Pastikan user unik berdasarkan id agar tidak ada duplikasi
    $uniqueUsers = [];
    foreach ($users as $u) {
        if (!empty($u['id'])) {
            $uniqueUsers[$u['id']] = $u;
        }
    }
    $userList = array_values($uniqueUsers);

    foreach ($clients as $sock) {
        $sid = getSockId($sock);
        if (!empty($handshakes[$sid])) {
            sendToSocket($sock, ['type' => 'user_list', 'users' => $userList]);
        }
    }
}

function broadcastGroupCallState($clients, $handshakes, $groupCall) {
    $payload = [
        'type'            => 'group_call_update',
        'active'          => $groupCall['active'],
        'hostId'          => $groupCall['hostId'],
        'maxParticipants' => $groupCall['maxParticipants'],
        'participants'    => array_values($groupCall['participants']),
        'count'           => count($groupCall['participants'])
    ];
    broadcastToAll($clients, $handshakes, $payload);
}

function broadcastGroupSystemMsg($clients, $handshakes, $text) {
    broadcastToAll($clients, $handshakes, [
        'type'       => 'group_system_msg',
        'id'         => 'sys_' . bin2hex(random_bytes(6)),
        'text'       => $text,
        'time'       => date('H:i')
    ]);
}

function handleDisconnect(
    $sock,
    &$clients,
    &$users,
    &$userSockets,
    &$handshakes,
    &$buffers,
    &$rooms,
    &$groupCall,
    &$personalCalls = []
) {
    $sid = getSockId($sock);
    $user = $users[$sid] ?? null;
    $userId = $user ? $user['id'] : null;
    $userName = $user ? $user['name'] : 'User';

    echo "[-] Client terputus (ID: $sid)" . ($userId ? " (user: $userId - $userName)" : '') . "\n";

    // 1. Tangani jika berada dalam Panggilan Suara Personal WebRTC
    foreach ($personalCalls as $cId => $cData) {
        if ($cData['callerSock'] === $sock || $cData['calleeSock'] === $sock) {
            $otherSock = ($cData['callerSock'] === $sock) ? $cData['calleeSock'] : $cData['callerSock'];
            $otherSid = getSockId($otherSock);
            if (!empty($handshakes[$otherSid])) {
                sendToSocket($otherSock, [
                    'type'   => 'personal_call_ended',
                    'callId' => $cId,
                    'reason' => 'peer_disconnected',
                    'byName' => $userName,
                    'msg'    => "Panggilan berakhir karena $userName terputus."
                ]);
            }
            unset($personalCalls[$cId]);
        }
    }

    // 1b. Tangani legacy 1-on-1 call
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

    // 2. Tangani jika berada dalam Group Call (Bebaskan slot peserta)
    if ($userId && isset($groupCall['participants'][$userId])) {
        unset($groupCall['participants'][$userId]);
        echo "[G] User $userName ($userId) keluar dari Group Call via disconnect.\n";

        // Beri tahu peserta group call lain bahwa peer ini keluar
        foreach ($groupCall['participants'] as $pId => $pData) {
            $pSock = $userSockets[$pId] ?? null;
            if ($pSock) {
                sendToSocket($pSock, [
                    'type'   => 'group_call_peer_left',
                    'peerId' => $userId
                ]);
            }
        }

        if (count($groupCall['participants']) === 0) {
            $groupCall['active'] = false;
            $groupCall['hostId'] = null;
        }

        broadcastGroupCallState($clients, $handshakes, $groupCall);
        broadcastGroupSystemMsg($clients, $handshakes, "$userName keluar dari panggilan group.");
    }

    // 3. Bersihkan mapping user & socket
    if ($userId && isset($userSockets[$userId]) && $userSockets[$userId] === $sock) {
        unset($userSockets[$userId]);
    }
    unset($users[$sid]);
    unset($handshakes[$sid]);
    unset($buffers[$sid]);
    $clients = array_values(array_filter($clients, fn($s) => $s !== $sock));
    @socket_close($sock);

    // 4. Siarkan perubahan ke seluruh anggota group publik
    if ($userId) {
        broadcastGroupSystemMsg($clients, $handshakes, "$userName keluar dari group publik.");
        broadcastUserList($clients, $users, $handshakes);
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
            handleDisconnect($sock, $clients, $users, $userSockets, $handshakes, $buffers, $rooms, $groupCall, $personalCalls);
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
                handleDisconnect($sock, $clients, $users, $userSockets, $handshakes, $buffers, $rooms, $groupCall, $personalCalls);
                break;
            }

            if ($frame['opcode'] !== 0x1) continue; // Only handle text/json frames

            $msg = json_decode($frame['payload'], true);
            if (!is_array($msg) || !isset($msg['type']) || !is_string($msg['type'])) continue;
            if ($msg['type'] !== 'register' && empty($users[$sid])) continue;

            $currentUserId = $users[$sid]['id'] ?? null;
            $currentUserName = $users[$sid]['name'] ?? null;

            switch ($msg['type']) {

                // ── 1. REGISTRASI & OTOMATIS MASUK GROUP PUBLIK ──
                case 'register':
                    if (isset($users[$sid]) || !isset($msg['name']) || !is_string($msg['name'])) break;
                    $name = trim($msg['name']);
                    if ($name === '' || strlen($name) > 120 || !preg_match('//u', $name)) break;

                    // Mencegah duplikasi user ID jika pengguna tersambung kembali (reconnect)
                    $requestedId = trim((string)($msg['id'] ?? ''));
                    if ($requestedId !== '' && preg_match('/^[a-zA-Z0-9_\-]+$/', $requestedId)) {
                        $userId = $requestedId;
                        // Jika ada socket lama dari user ID yang sama, tutup dan bersihkan socket lamanya
                        if (isset($userSockets[$userId]) && $userSockets[$userId] !== $sock) {
                            $oldSock = $userSockets[$userId];
                            $oldSid = getSockId($oldSock);
                            unset($users[$oldSid], $handshakes[$oldSid], $buffers[$oldSid]);
                            $clients = array_values(array_filter($clients, fn($s) => $s !== $oldSock));
                            @socket_close($oldSock);
                            echo "[R] Socket lama untuk $userId dibersihkan (reconnected).\n";
                        }
                    } else {
                        $userId = 'user_' . bin2hex(random_bytes(6));
                    }

                    $users[$sid] = [
                        'id'   => $userId,
                        'name' => $name,
                    ];
                    $userSockets[$userId] = $sock;
                    echo "[R] User terdaftar: {$name} ({$userId})\n";

                    // Kirim konfirmasi pendaftaran
                    sendToSocket($sock, [
                        'type' => 'registered',
                        'id'   => $userId,
                        'name' => $name
                    ]);

                    // Kirim status awal group publik (anggota online, status panggilan group, riwayat chat)
                    $uniqueUsers = [];
                    foreach ($users as $u) {
                        $uniqueUsers[$u['id']] = $u;
                    }
                    sendToSocket($sock, [
                        'type'            => 'group_init',
                        'users'           => array_values($uniqueUsers),
                        'groupCall'       => [
                            'active'          => $groupCall['active'],
                            'hostId'          => $groupCall['hostId'],
                            'maxParticipants' => $groupCall['maxParticipants'],
                            'participants'    => array_values($groupCall['participants']),
                            'count'           => count($groupCall['participants'])
                        ],
                        'history'         => $groupChatHistory
                    ]);

                    // Siarkan pesan sistem bahwa pengguna masuk ke group publik
                    broadcastGroupSystemMsg($clients, $handshakes, "$name bergabung ke group publik.");
                    broadcastUserList($clients, $users, $handshakes);
                    break;

                // ── 2. GROUP CALL (MAKSIMAL 6 PESERTA, WEBRTC SIGNALING) ──
                case 'group_call_start':
                    // Pengaturan batas peserta (maksimal 6, minimal 2)
                    $requestedLimit = isset($msg['maxParticipants']) ? (int)$msg['maxParticipants'] : $maxGroupCallLimit;
                    $callLimit = max(2, min($maxGroupCallLimit, $requestedLimit));

                    if ($groupCall['active']) {
                        // Jika sudah ada panggilan aktif, masukkan user ke panggilan tersebut jika belum penuh
                        if (count($groupCall['participants']) >= $groupCall['maxParticipants']) {
                            sendToSocket($sock, [
                                'type' => 'group_call_error',
                                'msg'  => "Panggilan group sudah penuh (maksimal {$groupCall['maxParticipants']} peserta)."
                            ]);
                            break;
                        }
                    } else {
                        $groupCall['active'] = true;
                        $groupCall['hostId'] = $currentUserId;
                        $groupCall['maxParticipants'] = $callLimit;
                        $groupCall['participants'] = [];
                    }

                    $groupCall['participants'][$currentUserId] = [
                        'id'      => $currentUserId,
                        'name'    => $currentUserName,
                        'isMuted' => false
                    ];
                    echo "[G] {$currentUserName} memulai Group Call (Batas: {$groupCall['maxParticipants']} peserta)\n";

                    // Beri tahu pemanggil bahwa panggilan berhasil dimulai
                    sendToSocket($sock, [
                        'type'            => 'group_call_started',
                        'participants'    => array_values($groupCall['participants']),
                        'maxParticipants' => $groupCall['maxParticipants']
                    ]);

                    broadcastGroupCallState($clients, $handshakes, $groupCall);
                    broadcastGroupSystemMsg($clients, $handshakes, "$currentUserName memulai panggilan suara group (Batas: {$groupCall['maxParticipants']} peserta).");
                    break;

                case 'group_call_join':
                    if (!$groupCall['active']) {
                        sendToSocket($sock, [
                            'type' => 'group_call_error',
                            'msg'  => 'Tidak ada panggilan group yang sedang berlangsung.'
                        ]);
                        break;
                    }

                    if (isset($groupCall['participants'][$currentUserId])) {
                        // Pengguna sudah ada di dalam panggilan
                        sendToSocket($sock, [
                            'type'            => 'group_call_joined',
                            'participants'    => array_values($groupCall['participants']),
                            'maxParticipants' => $groupCall['maxParticipants']
                        ]);
                        break;
                    }

                    // Validasi batas kapasitas peserta (Maksimum 6)
                    if (count($groupCall['participants']) >= $groupCall['maxParticipants']) {
                        echo "[G] User {$currentUserName} ditolak bergabung: Panggilan group PENUH ({$groupCall['maxParticipants']} peserta)\n";
                        sendToSocket($sock, [
                            'type' => 'group_call_error',
                            'msg'  => "Panggilan group sudah penuh (maksimal {$groupCall['maxParticipants']} peserta)."
                        ]);
                        break;
                    }

                    // Tambahkan peserta baru
                    $newParticipant = [
                        'id'      => $currentUserId,
                        'name'    => $currentUserName,
                        'isMuted' => false
                    ];
                    $groupCall['participants'][$currentUserId] = $newParticipant;
                    echo "[G] {$currentUserName} bergabung ke Group Call (Total: " . count($groupCall['participants']) . "/{$groupCall['maxParticipants']})\n";

                    // Kirim daftar peserta yang sudah ada ke peserta yang baru bergabung
                    sendToSocket($sock, [
                        'type'            => 'group_call_joined',
                        'participants'    => array_values($groupCall['participants']),
                        'maxParticipants' => $groupCall['maxParticipants']
                    ]);

                    // Beri tahu peserta lama bahwa ada peserta baru bergabung (untuk inisiasi WebRTC PeerConnection)
                    foreach ($groupCall['participants'] as $pId => $pData) {
                        if ($pId !== $currentUserId && isset($userSockets[$pId])) {
                            sendToSocket($userSockets[$pId], [
                                'type' => 'group_call_peer_joined',
                                'peer' => $newParticipant
                            ]);
                        }
                    }

                    broadcastGroupCallState($clients, $handshakes, $groupCall);
                    broadcastGroupSystemMsg($clients, $handshakes, "$currentUserName bergabung ke panggilan group.");
                    break;

                case 'group_call_leave':
                    if (isset($groupCall['participants'][$currentUserId])) {
                        unset($groupCall['participants'][$currentUserId]);
                        echo "[G] {$currentUserName} meninggalkan Group Call. Slot dibebaskan.\n";

                        // Beri tahu peserta lain untuk menutup koneksi WebRTC peer ini
                        foreach ($groupCall['participants'] as $pId => $pData) {
                            if (isset($userSockets[$pId])) {
                                sendToSocket($userSockets[$pId], [
                                    'type'   => 'group_call_peer_left',
                                    'peerId' => $currentUserId
                                ]);
                            }
                        }

                        if (count($groupCall['participants']) === 0) {
                            $groupCall['active'] = false;
                            $groupCall['hostId'] = null;
                        }

                        sendToSocket($sock, ['type' => 'group_call_left']);
                        broadcastGroupCallState($clients, $handshakes, $groupCall);
                        broadcastGroupSystemMsg($clients, $handshakes, "$currentUserName keluar dari panggilan group.");
                    }
                    break;

                case 'group_call_mic_status':
                    if (isset($groupCall['participants'][$currentUserId])) {
                        $isMuted = (bool)($msg['isMuted'] ?? false);
                        $groupCall['participants'][$currentUserId]['isMuted'] = $isMuted;

                        // Siarkan status mic ke seluruh peserta group call
                        foreach ($groupCall['participants'] as $pId => $pData) {
                            if (isset($userSockets[$pId])) {
                                sendToSocket($userSockets[$pId], [
                                    'type'    => 'group_call_mic_status',
                                    'peerId'  => $currentUserId,
                                    'isMuted' => $isMuted
                                ]);
                            }
                        }
                    }
                    break;

                // WebRTC Signaling Relay untuk audio group mesh (offer, answer, candidate)
                case 'webrtc_signal':
                    $targetId = $msg['targetId'] ?? null;
                    if ($targetId && isset($userSockets[$targetId], $groupCall['participants'][$targetId], $groupCall['participants'][$currentUserId])) {
                        sendToSocket($userSockets[$targetId], [
                            'type'   => 'webrtc_signal',
                            'fromId' => $currentUserId,
                            'signal' => $msg['signal'] ?? []
                        ]);
                    }
                    break;

                // ── 3. CHAT GRUP & BERBAGI MEDIA ──
                case 'group_chat_send':
                    $msgType = $msg['msgType'] ?? 'text';
                    if (!in_array($msgType, ['text', 'image', 'video', 'audio'], true)) {
                        break;
                    }

                    $text = trim((string)($msg['text'] ?? ''));
                    $fileUrl = trim((string)($msg['fileUrl'] ?? ''));
                    $fileName = trim((string)($msg['fileName'] ?? ''));
                    $fileSize = (int)($msg['fileSize'] ?? 0);
                    $duration = isset($msg['duration']) ? (float)$msg['duration'] : null;

                    // Validasi teks
                    if ($msgType === 'text') {
                        if ($text === '' || mb_strlen($text, 'UTF-8') > 2000) {
                            sendToSocket($sock, ['type' => 'error', 'msg' => 'Pesan teks tidak boleh kosong atau lebih dari 2000 karakter.']);
                            break;
                        }
                    }

                    // Validasi URL file media jika bukan teks
                    if ($msgType !== 'text') {
                        if ($fileUrl === '' || !preg_match('/^uploads\/[a-f0-9]{32}\.[a-z0-9]+$/i', $fileUrl)) {
                            sendToSocket($sock, ['type' => 'error', 'msg' => 'Format URL media tidak valid.']);
                            break;
                        }
                        $fullPath = __DIR__ . '/' . $fileUrl;
                        if (!file_exists($fullPath)) {
                            sendToSocket($sock, ['type' => 'error', 'msg' => 'File media tidak ditemukan di server.']);
                            break;
                        }
                    }

                    $chatItem = [
                        'type'       => 'group_chat_msg',
                        'id'         => 'msg_' . bin2hex(random_bytes(8)),
                        'tempId'     => $msg['tempId'] ?? null,
                        'senderId'   => $currentUserId,
                        'senderName' => $currentUserName,
                        'msgType'    => $msgType,
                        'text'       => htmlspecialchars($text, ENT_QUOTES, 'UTF-8'),
                        'fileUrl'    => htmlspecialchars($fileUrl, ENT_QUOTES, 'UTF-8'),
                        'fileName'   => htmlspecialchars($fileName, ENT_QUOTES, 'UTF-8'),
                        'fileSize'   => $fileSize,
                        'duration'   => $duration,
                        'time'       => date('H:i')
                    ];

                    // Simpan ke riwayat memori (maks 50 pesan)
                    $groupChatHistory[] = $chatItem;
                    if (count($groupChatHistory) > 50) {
                        array_shift($groupChatHistory);
                    }

                    // Siarkan pesan ke seluruh anggota group publik
                    broadcastToAll($clients, $handshakes, $chatItem);
                    break;

                // ── 4. CHAT PERSONAL (1-ON-1 DIRECT MESSAGE) ──
                case 'personal_chat_send':
                    $currentUserId   = $users[$sid]['id'] ?? null;
                    $currentUserName = $users[$sid]['name'] ?? 'User';
                    if (!$currentUserId) {
                        sendToSocket($sock, ['type' => 'error', 'msg' => 'Sesi tidak valid.']);
                        break;
                    }

                    $targetId = trim($msg['targetId'] ?? '');
                    if (!$targetId) {
                        sendToSocket($sock, ['type' => 'personal_chat_error', 'msg' => 'Penerima pesan tidak ditentukan.']);
                        break;
                    }
                    if ($targetId === $currentUserId) {
                        sendToSocket($sock, ['type' => 'personal_chat_error', 'msg' => 'Tidak dapat mengirim pesan ke diri sendiri.']);
                        break;
                    }

                    $msgType  = in_array($msg['msgType'] ?? '', ['text', 'image', 'video', 'audio'], true) ? $msg['msgType'] : 'text';
                    $text     = trim($msg['text'] ?? '');
                    $fileUrl  = trim($msg['fileUrl'] ?? '');
                    $fileName = trim($msg['fileName'] ?? '');
                    $fileSize = (int)($msg['fileSize'] ?? 0);
                    $duration = (int)($msg['duration'] ?? 0);
                    $tempId   = $msg['tempId'] ?? null;

                    if ($msgType === 'text' && $text === '') {
                        break;
                    }
                    if ($msgType !== 'text' && $fileUrl === '') {
                        break;
                    }

                    $convKey = getConvKey($currentUserId, $targetId);

                    $personalChatItem = [
                        'type'       => 'personal_chat_msg',
                        'id'         => 'pmsg_' . bin2hex(random_bytes(8)),
                        'tempId'     => $tempId,
                        'convKey'    => $convKey,
                        'senderId'   => $currentUserId,
                        'senderName' => $currentUserName,
                        'targetId'   => $targetId,
                        'msgType'    => $msgType,
                        'text'       => htmlspecialchars($text, ENT_QUOTES, 'UTF-8'),
                        'fileUrl'    => htmlspecialchars($fileUrl, ENT_QUOTES, 'UTF-8'),
                        'fileName'   => htmlspecialchars($fileName, ENT_QUOTES, 'UTF-8'),
                        'fileSize'   => $fileSize,
                        'duration'   => $duration,
                        'time'       => date('H:i')
                    ];

                    // Simpan ke riwayat percakapan personal di server (maksimal per pasangan)
                    if (!isset($personalChatHistory[$convKey])) {
                        $personalChatHistory[$convKey] = [];
                    }
                    $personalChatHistory[$convKey][] = $personalChatItem;
                    if (count($personalChatHistory[$convKey]) > $maxPersonalHistoryPerPair) {
                        array_shift($personalChatHistory[$convKey]);
                    }

                    $targetSock = $userSockets[$targetId] ?? null;
                    if ($targetSock && !empty($handshakes[getSockId($targetSock)])) {
                        // Penerima sedang online: kirim pesan personal langsung
                        sendToSocket($targetSock, $personalChatItem);
                        // Konfirmasi sukses ke pengirim
                        sendToSocket($sock, [
                            'type'   => 'personal_chat_sent',
                            'tempId' => $tempId,
                            'id'     => $personalChatItem['id'],
                            'time'   => $personalChatItem['time'],
                            'online' => true
                        ]);
                    } else {
                        // Penerima offline: beri tahu pengirim bahwa pesan disimpan di server
                        sendToSocket($sock, [
                            'type'    => 'personal_chat_sent',
                            'tempId'  => $tempId,
                            'id'      => $personalChatItem['id'],
                            'time'    => $personalChatItem['time'],
                            'online'  => false,
                            'offline' => true,
                            'msg'     => 'Penerima sedang offline. Pesan tersimpan di server.'
                        ]);
                    }
                    break;

                case 'get_personal_history':
                    $currentUserId = $users[$sid]['id'] ?? null;
                    if (!$currentUserId) break;

                    $targetId = trim($msg['targetId'] ?? '');
                    if (!$targetId || $targetId === $currentUserId) break;

                    $convKey = getConvKey($currentUserId, $targetId);
                    $history = $personalChatHistory[$convKey] ?? [];

                    sendToSocket($sock, [
                        'type'     => 'personal_history_res',
                        'targetId' => $targetId,
                        'convKey'  => $convKey,
                        'history'  => $history
                    ]);
                    break;

                // ── 5. PANGGILAN SUARA PERSONAL (WEBRTC PEER-TO-PEER) ──
                case 'personal_call_invite':
                case 'call':
                    $currentUserId   = $users[$sid]['id'] ?? null;
                    $currentUserName = $users[$sid]['name'] ?? 'User';
                    $targetId        = trim($msg['targetId'] ?? '');

                    if (!$currentUserId) break;

                    if ($targetId === '' || $targetId === $currentUserId) {
                        sendToSocket($sock, [
                            'type'   => 'personal_call_error',
                            'reason' => 'self',
                            'msg'    => 'Tidak dapat memanggil diri sendiri.'
                        ]);
                        break;
                    }

                    // Periksa apakah pemanggil sedang dalam group call
                    if (isset($groupCall['participants'][$currentUserId])) {
                        sendToSocket($sock, [
                            'type'   => 'personal_call_error',
                            'reason' => 'caller_in_group',
                            'msg'    => 'Tinggalkan panggilan group terlebih dahulu sebelum memulai panggilan personal.'
                        ]);
                        break;
                    }

                    // Periksa apakah target sedang online
                    $targetSock = $userSockets[$targetId] ?? null;
                    if (!$targetSock || empty($handshakes[getSockId($targetSock)])) {
                        sendToSocket($sock, [
                            'type'   => 'personal_call_error',
                            'reason' => 'offline',
                            'msg'    => 'Pengguna sedang offline atau tidak ditemukan.'
                        ]);
                        break;
                    }

                    $targetSid = getSockId($targetSock);
                    $targetName = $users[$targetSid]['name'] ?? 'User';

                    // Periksa apakah target sedang dalam group call
                    if (isset($groupCall['participants'][$targetId])) {
                        sendToSocket($sock, [
                            'type'   => 'personal_call_error',
                            'reason' => 'busy',
                            'msg'    => "$targetName sedang berada dalam panggilan group."
                        ]);
                        break;
                    }

                    // Periksa apakah target atau pemanggil sedang dalam panggilan personal lain
                    $isBusy = false;
                    foreach ($personalCalls as $cId => $cData) {
                        if ($cData['callerId'] === $targetId || $cData['calleeId'] === $targetId ||
                            $cData['callerId'] === $currentUserId || $cData['calleeId'] === $currentUserId) {
                            $isBusy = true;
                            break;
                        }
                    }
                    if ($isBusy) {
                        sendToSocket($sock, [
                            'type'   => 'personal_call_error',
                            'reason' => 'busy',
                            'msg'    => "$targetName sedang sibuk dalam panggilan lain."
                        ]);
                        break;
                    }

                    // Buat sesi panggilan personal
                    $callId = 'pcall_' . bin2hex(random_bytes(6));
                    $personalCalls[$callId] = [
                        'status'     => 'ringing',
                        'callerId'   => $currentUserId,
                        'callerName' => $currentUserName,
                        'callerSock' => $sock,
                        'calleeId'   => $targetId,
                        'calleeName' => $targetName,
                        'calleeSock' => $targetSock,
                        'createdAt'  => time()
                    ];

                    echo "[P-Call] $currentUserName ($currentUserId) memanggil $targetName ($targetId)\n";

                    // Kirim notifikasi panggilan masuk ke penerima
                    sendToSocket($targetSock, [
                        'type'     => 'personal_call_incoming',
                        'callId'   => $callId,
                        'fromId'   => $currentUserId,
                        'fromName' => $currentUserName
                    ]);

                    // Beri tahu caller bahwa panggilan sedang berdering
                    sendToSocket($sock, [
                        'type'       => 'personal_call_ringing',
                        'callId'     => $callId,
                        'targetId'   => $targetId,
                        'targetName' => $targetName
                    ]);
                    break;

                case 'personal_call_accept':
                case 'accept_call':
                    $currentUserId   = $users[$sid]['id'] ?? null;
                    $currentUserName = $users[$sid]['name'] ?? 'User';
                    $targetId        = trim($msg['targetId'] ?? '');
                    $callId          = trim($msg['callId'] ?? '');

                    $activeCallId = null;
                    foreach ($personalCalls as $cId => $cData) {
                        if (($callId && $cId === $callId) || ($cData['calleeId'] === $currentUserId && $cData['callerId'] === $targetId)) {
                            $activeCallId = $cId;
                            break;
                        }
                    }

                    if (!$activeCallId) {
                        sendToSocket($sock, [
                            'type'   => 'personal_call_error',
                            'reason' => 'expired',
                            'msg'    => 'Panggilan sudah tidak berlaku atau dibatalkan.'
                        ]);
                        break;
                    }

                    $cData = &$personalCalls[$activeCallId];
                    $cData['status'] = 'active';
                    $callerSock = $cData['callerSock'];
                    $callerId   = $cData['callerId'];
                    $callerName = $cData['callerName'];

                    echo "[P-Call] Call diterima: $callerName <-> $currentUserName\n";

                    // Caller menerima sinyal bahwa panggilan diterima
                    sendToSocket($callerSock, [
                        'type'     => 'personal_call_accepted',
                        'callId'   => $activeCallId,
                        'peerId'   => $currentUserId,
                        'peerName' => $currentUserName
                    ]);

                    // Callee menerima konfirmasi sesi aktif
                    sendToSocket($sock, [
                        'type'     => 'personal_call_started',
                        'callId'   => $activeCallId,
                        'peerId'   => $callerId,
                        'peerName' => $callerName
                    ]);
                    break;

                case 'personal_call_reject':
                case 'reject_call':
                    $currentUserId = $users[$sid]['id'] ?? null;
                    $targetId      = trim($msg['targetId'] ?? '');

                    foreach ($personalCalls as $cId => $cData) {
                        if ($cData['calleeId'] === $currentUserId && ($cData['callerId'] === $targetId || !$targetId)) {
                            $callerSock = $cData['callerSock'];
                            echo "[P-Call] Call ditolak oleh: {$users[$sid]['name']}\n";
                            if (!empty($handshakes[getSockId($callerSock)])) {
                                sendToSocket($callerSock, [
                                    'type'   => 'personal_call_rejected',
                                    'callId' => $cId,
                                    'byName' => $users[$sid]['name']
                                ]);
                            }
                            unset($personalCalls[$cId]);
                            break;
                        }
                    }
                    break;

                case 'personal_call_end':
                case 'end_call':
                    $currentUserId = $users[$sid]['id'] ?? null;
                    $targetId      = trim($msg['targetId'] ?? '');

                    foreach ($personalCalls as $cId => $cData) {
                        if ($cData['callerId'] === $currentUserId || $cData['calleeId'] === $currentUserId) {
                            $otherSock = ($cData['callerId'] === $currentUserId) ? $cData['calleeSock'] : $cData['callerSock'];
                            echo "[P-Call] Call diakhiri oleh: {$users[$sid]['name']}\n";
                            if (!empty($handshakes[getSockId($otherSock)])) {
                                sendToSocket($otherSock, [
                                    'type'   => 'personal_call_ended',
                                    'callId' => $cId,
                                    'byName' => $users[$sid]['name']
                                ]);
                            }
                            unset($personalCalls[$cId]);
                            break;
                        }
                    }
                    break;

                case 'personal_webrtc_signal':
                    $currentUserId = $users[$sid]['id'] ?? null;
                    $targetId      = trim($msg['targetId'] ?? '');
                    $signal        = $msg['signal'] ?? null;

                    if ($currentUserId && $targetId && $signal) {
                        $targetSock = $userSockets[$targetId] ?? null;
                        if ($targetSock && !empty($handshakes[getSockId($targetSock)])) {
                            sendToSocket($targetSock, [
                                'type'   => 'personal_webrtc_signal',
                                'fromId' => $currentUserId,
                                'signal' => $signal
                            ]);
                        }
                    }
                    break;

                case 'personal_mic_status':
                    $currentUserId = $users[$sid]['id'] ?? null;
                    $targetId      = trim($msg['targetId'] ?? '');
                    $isMuted       = (bool)($msg['isMuted'] ?? false);

                    if ($currentUserId && $targetId) {
                        $targetSock = $userSockets[$targetId] ?? null;
                        if ($targetSock && !empty($handshakes[getSockId($targetSock)])) {
                            sendToSocket($targetSock, [
                                'type'    => 'personal_mic_status',
                                'fromId'  => $currentUserId,
                                'isMuted' => $isMuted
                            ]);
                        }
                    }
                    break;

                case 'audio':
                    // Fallback backward-compatibility untuk legacy raw audio jika masih dipanggil
                    $targetSock = $userSockets[$msg['targetId']] ?? null;
                    if ($targetSock) {
                        sendToSocket($targetSock, [
                            'type' => 'audio',
                            'data' => $msg['data'],
                            'rate' => $msg['rate'] ?? 16000,
                        ]);
                    }
                    break;
            }
        }
    }
}

socket_close($masterSocket);
