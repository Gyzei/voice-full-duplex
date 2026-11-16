/**
 * VoiceLink - Full Duplex Voice Chat, Public Group, WebRTC Group Call & Multimedia Chat
 */

// --- Global State ---
let socket = null;
let myId = 'user_' + Math.random().toString(36).substr(2, 6);
let myName = '';
let reconnectTimer = null;

// ── Personal Chat State ──
let activeChatPeer = null;           // { id, name } or null (null = tampilan Group)
const personalChats = {};            // peerId => array of message objects
const unreadCounts = {};             // peerId => number of unread messages

// ── WebRTC 1-on-1 Personal Voice Call State ──
let personalCallState = 'idle';      // 'idle' | 'calling' | 'ringing' | 'incoming' | 'active'
let personalCallPeer = null;         // { id, name }
let personalCallId = null;
let personalCallIsCaller = false;
let personalCallActive = false;
let personalIsMuted = false;
let personalIsDeafened = false;

let personalPC = null;
let personalIceCandidatesQueue = [];
let personalLocalStream = null;
let personalAudioCtx = null;
let personalLocalAnalyser = null;
let personalRemoteAnalyser = null;
let personalAnimFrameId = null;
let personalCallStartTime = null;
let personalCallTimerInterval = null;

// Personal Voice Note recording state
let personalMediaRecorder = null;
let personalRecordedAudioChunks = [];
let personalVnRecordingStartTime = null;
let personalVnRecordingTimerInterval = null;

// Backward-compatibility aliases for legacy references if any
let currentPeer = null;
let pendingIncoming = null;
let callActive = false;
let isMuted = false;
let isDeafened = false;
let callStartTime = null;
let callTimerInterval = null;
let animFrameId = null;

// ── Public Group & WebRTC Group Call State ──
let groupUsers = []; // Anggota online di group publik
let groupCallState = {
    active: false,
    hostId: null,
    maxParticipants: 6,
    participants: [],
    count: 0
};
let inGroupCall = false;
let groupMicMuted = false;
let groupDeafened = false;
let groupLocalStream = null;
let groupCallStartTime = null;
let groupCallTimerInterval = null;
let groupSpeakingInterval = null;

// Map WebRTC Peer Connections untuk Group Call (Mesh Topology)
// peerId => { pc: RTCPeerConnection, audioEl: HTMLAudioElement, analyser: AnalyserNode }
const groupPeers = new Map();

// WebRTC ICE Servers Configuration (Google Public STUN)
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// ── Media Upload & Voice Note State ──
let uploadConfig = {
    maxImageSize: 10 * 1024 * 1024,  // 10 MB default
    maxVideoSize: 30 * 1024 * 1024,  // 30 MB default
    maxAudioSize: 10 * 1024 * 1024,  // 10 MB default
    maxImageSizeLabel: '10 MB',
    maxVideoSizeLabel: '30 MB',
    maxAudioSizeLabel: '10 MB'
};

let mediaRecorder = null;
let recordedAudioChunks = [];
let vnRecordingStartTime = null;
let vnRecordingTimerInterval = null;

// --- UI Elements ---
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const wsStatusDot = document.querySelector('#ws-status .dot');
const wsStatusText = document.getElementById('ws-status-text');
const usernameInput = document.getElementById('username-input');

const myAvatar = document.getElementById('my-avatar');
const myNameDisplay = document.getElementById('my-name-display');
const myIdDisplay = document.getElementById('my-id-display');
const userListEl = document.getElementById('user-list');

function applyTheme(theme) {
    const normalizedTheme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = normalizedTheme;
    document.querySelectorAll('.theme-toggle').forEach(button => {
        const nextTheme = normalizedTheme === 'dark' ? 'light' : 'dark';
        const label = nextTheme === 'light' ? 'Mode terang' : 'Mode gelap';
        const icon = nextTheme === 'light' ? '☀' : '☾';
        button.setAttribute('aria-label', `Ganti ke ${label.toLowerCase()}`);
        button.title = `Ganti ke ${label.toLowerCase()}`;
        const labelEl = button.querySelector('.theme-toggle-label');
        const iconEl = button.querySelector('.theme-toggle-icon');
        if (labelEl) labelEl.textContent = label;
        if (iconEl) iconEl.textContent = icon;
    });
}

function toggleTheme() {
    const nextTheme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(nextTheme);
    try { localStorage.setItem('voicelink-theme', nextTheme); } catch (_) {}
}

try {
    applyTheme(localStorage.getItem('voicelink-theme') || 'dark');
} catch (_) {
    applyTheme('dark');
}

// Group View Elements
const groupView = document.getElementById('group-view');
const groupOnlineBadge = document.getElementById('group-online-badge');
const groupHeaderOnlineText = document.getElementById('group-header-online-text');
const gcLimitSelect = document.getElementById('gc-limit-select');
const gcStartBox = document.getElementById('gc-start-box');
const gcLiveBox = document.getElementById('gc-live-box');
const gcLiveCountBadge = document.getElementById('gc-live-count-badge');
const groupCallActiveContainer = document.getElementById('group-call-active-container');
const gcTimer = document.getElementById('gc-timer');
const gcCapacityBadge = document.getElementById('gc-capacity-badge');
const gcParticipantsGrid = document.getElementById('gc-participants-grid');
const gcMuteBtn = document.getElementById('gc-mute-btn');
const gcMicIconOn = document.getElementById('gc-mic-icon-on');
const gcMicIconOff = document.getElementById('gc-mic-icon-off');
const gcMuteLabel = document.getElementById('gc-mute-label');
const gcDeafenBtn = document.getElementById('gc-deafen-btn');
const gcVolIconOn = document.getElementById('gc-vol-icon-on');
const gcVolIconOff = document.getElementById('gc-vol-icon-off');

// Chat Elements
const chatMessagesArea = document.getElementById('chat-messages-area');
const chatInput = document.getElementById('chat-input');
const mediaFileInput = document.getElementById('media-file-input');
const uploadProgressWrap = document.getElementById('upload-progress-wrap');
const uploadProgressFill = document.getElementById('upload-progress-fill');
const uploadProgressText = document.getElementById('upload-progress-text');
const vnRecorderBar = document.getElementById('vn-recorder-bar');
const vnTimer = document.getElementById('vn-timer');

// 1-on-1 Call Panels
const callingPanel = document.getElementById('calling-panel');
const incomingPanel = document.getElementById('incoming-panel');
const activeCallPanel = document.getElementById('active-call-panel');
const callingName = document.getElementById('calling-name');
const callingAvatar = document.getElementById('calling-avatar');
const callingStatusLabel = document.getElementById('calling-status-label');
const incomingName = document.getElementById('incoming-name');
const incomingAvatar = document.getElementById('incoming-avatar');
const activePeerName = document.getElementById('active-peer-name');
const activeAvatar = document.getElementById('active-avatar');
const callTimer = document.getElementById('call-timer');
const waveformLocal = document.getElementById('waveform-local');
const waveformRemote = document.getElementById('waveform-remote');
const remoteWaveLabel = document.getElementById('remote-wave-label');
const muteBtn = document.getElementById('mute-btn');
const micIconOn = document.getElementById('mic-icon-on');
const micIconOff = document.getElementById('mic-icon-off');
const volBtn = document.getElementById('vol-btn');
const volIconOn = document.getElementById('vol-icon-on');
const volIconOff = document.getElementById('vol-icon-off');

// Personal View Elements
const personalView = document.getElementById('personal-view');
const personalBackBtn = document.getElementById('personal-back-btn');
const personalPeerAvatar = document.getElementById('personal-peer-avatar');
const personalPeerName = document.getElementById('personal-peer-name');
const personalPeerDot = document.getElementById('personal-peer-dot');
const personalPeerStatus = document.getElementById('personal-peer-status');
const personalCallBtn = document.getElementById('personal-call-btn');
const personalChatContainer = document.getElementById('personal-chat-container');
const personalChatMessagesArea = document.getElementById('personal-chat-messages-area');
const personalUploadProgressWrap = document.getElementById('personal-upload-progress-wrap');
const personalUploadProgressFill = document.getElementById('personal-upload-progress-fill');
const personalUploadProgressText = document.getElementById('personal-upload-progress-text');
const personalVnRecorderBar = document.getElementById('personal-vn-recorder-bar');
const personalVnTimer = document.getElementById('personal-vn-timer');
const personalMediaFileInput = document.getElementById('personal-media-file-input');
const personalChatInput = document.getElementById('personal-chat-input');
const personalChatSendBtn = document.getElementById('personal-chat-send-btn');
const personalRemoteAudio = document.getElementById('personal-remote-audio');

// Modal Elements
const mediaModal = document.getElementById('media-modal');
const mediaModalBody = document.getElementById('media-modal-body');
const webrtcAudioContainer = document.getElementById('webrtc-audio-container');

// ── WebSocket Connection & Diagnostic State ──
let connectionTimeoutTimer = null;
let reconnectAttempts = 0;
const MAX_AUTO_RECONNECTS = 3;
let communityRooms = [];
let activeCommunityRoom = null;
let pendingRoomInvite = new URLSearchParams(window.location.search).get('room');

function getWebSocketUrl() {
    const isHttps = window.location.protocol === 'https:';
    if (isHttps) {
        // Melalui reverse proxy Apache mod_proxy_wstunnel pada port HTTPS (443) yang sama
        return `wss://${window.location.host}/voice-ws`;
    }

    let host = window.location.hostname || '127.0.0.1';
    // Di Windows laptop, jika dibuka via localhost atau ::1, petakan ke IPv4 127.0.0.1
    // JANGAN ubah jika dibuka melalui IP LAN (misal 192.168.x.x) agar HP tetap terhubung ke laptop
    if (host === 'localhost' || host === '::1') {
        host = '127.0.0.1';
    }

    return `ws://${host}:8765`;
}

function updateWsStatus(state, message, tooltip = '') {
    if (wsStatusDot) {
        wsStatusDot.className = `dot ${state}`;
    }
    if (wsStatusText) {
        wsStatusText.textContent = message;
        if (tooltip) wsStatusText.title = tooltip;
    }
    const retryBtn = document.getElementById('ws-retry-btn');
    if (retryBtn) {
        retryBtn.style.display = (state === 'disconnected') ? 'inline-block' : 'none';
    }
    const appConnStatus = document.getElementById('app-conn-status');
    const appConnText = document.getElementById('app-conn-text');
    if (appConnStatus && appConnText) {
        appConnStatus.className = `app-conn-status ${state}`;
        const dot = appConnStatus.querySelector('.dot');
        if (dot) dot.className = `dot ${state}`;
        appConnText.textContent = (state === 'connected') ? 'Online' : (state === 'connecting' ? 'Menghubungkan...' : 'Offline');
    }
}

function updateDiagInfo(wsUrl) {
    const diagWsUrl = document.getElementById('diag-ws-url');
    const diagContext = document.getElementById('diag-context');
    const diagMicSupport = document.getElementById('diag-mic-support');

    if (diagWsUrl) diagWsUrl.textContent = wsUrl || getWebSocketUrl();
    if (diagContext) {
        const isSecure = window.isSecureContext;
        diagContext.innerHTML = isSecure 
            ? '<span style="color:#00E676; font-weight:600;">Aman (Secure Context: HTTPS/Localhost)</span>' 
            : '<span style="color:#FF5252; font-weight:600;">Tidak Aman (Insecure Context: HTTP via IP)</span>';
    }
    if (diagMicSupport) {
        const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
        diagMicSupport.innerHTML = hasMedia 
            ? '<span style="color:#00E676; font-weight:600;">Tersedia di browser ini</span>' 
            : '<span style="color:#FF5252; font-weight:600;">Diblokir / Butuh HTTPS atau Flag Chrome</span>';
    }
}

function toggleDiagBox() {
    const box = document.getElementById('ws-diag-box');
    if (!box) return;
    const isHidden = box.style.display === 'none' || !box.style.display;
    box.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
        updateDiagInfo();
    }
}

async function testMicPermission() {
    const md = getMediaDevices();
    if (!md) {
        alert("Browser Anda memblokir mikrofon karena konteks halaman tidak aman (Insecure Context).\n\n" +
              "Solusi Cepat untuk HP Android:\n" +
              "1. Buka chrome://flags/#unsafely-treat-insecure-origin-as-secure di Chrome HP.\n" +
              "2. Masukkan URL laptop Anda (contoh: " + window.location.origin + ").\n" +
              "3. Pilih 'Enabled' lalu klik 'Relaunch'.\n\n" +
              "Atau buka via HTTPS dengan sertifikat yang telah dipasang di HP.");
        return;
    }
    try {
        const stream = await md.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
        alert("BERHASIL! Izin mikrofon aktif dan dapat digunakan untuk voice call di VoiceLink.");
        showToast("Mikrofon siap & diizinkan");
    } catch (err) {
        alert("Gagal mengakses mikrofon: " + (err.name || err.message) + "\nPastikan Anda mengizinkan akses mic pada notifikasi browser.");
    }
}

function initWebSocket() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
    }

    clearTimeout(connectionTimeoutTimer);
    clearTimeout(reconnectTimer);

    const wsUrl = getWebSocketUrl();
    updateWsStatus('connecting', `Menghubungkan ke ${wsUrl}...`, `Sedang mencoba membuka koneksi ke ${wsUrl}`);
    updateDiagInfo(wsUrl);

    try {
        socket = new WebSocket(wsUrl);
    } catch (e) {
        console.error('Failed to create WebSocket:', e);
        updateWsStatus('disconnected', `Gagal inisialisasi (${wsUrl})`, `Error: ${e.message || e}`);
        return;
    }

    // Set connection timeout: jika setelah 5 detik belum berhasil terhubung, anggap gagal/terblokir
    connectionTimeoutTimer = setTimeout(() => {
        if (socket && socket.readyState === WebSocket.CONNECTING) {
            console.warn(`[VoiceLink] Koneksi ke ${wsUrl} timeout setelah 5 detik.`);
            try { socket.close(); } catch (_) {}
            const isHttps = window.location.protocol === 'https:';
            const failMsg = isHttps
                ? `WSS Timeout (/voice-ws). Periksa reverse proxy Apache.`
                : `Timeout (${wsUrl}). Cek server & firewall port 8765.`;
            updateWsStatus('disconnected', failMsg, `Koneksi timeout. Pastikan start_server.bat berjalan dan port 8765 diizinkan di Windows Firewall.`);
            showToast('Koneksi WebSocket timeout. Periksa server dan firewall laptop.');
        }
    }, 5000);

    socket.onopen = () => {
        clearTimeout(connectionTimeoutTimer);
        clearTimeout(reconnectTimer);
        reconnectAttempts = 0;

        updateWsStatus('connected', `Server Online (${wsUrl})`, `Terhubung ke server WebSocket pada ${wsUrl}`);
        showToast('Terhubung ke WebSocket Server');
        updateServerReadyUI(true);

        // Jika sebelumnya sudah terdaftar (misal setelah terputus/reconnect), daftarkan ulang dengan ID yang sama
        if (myName) {
            socket.send(JSON.stringify({
                type: 'register',
                id: myId,
                name: myName
            }));
        }
    };

    socket.onclose = (ev) => {
        clearTimeout(connectionTimeoutTimer);

        const isHttps = window.location.protocol === 'https:';
        let failReason = `Server Offline (Jalankan start_server.bat)`;
        if (isHttps) {
            failReason = `WSS Terputus (Reverse proxy Apache /voice-ws belum aktif)`;
        } else if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
            failReason = `Gagal koneksi ke port 8765 (Cek firewall LAN laptop)`;
        }

        updateWsStatus('disconnected', failReason, `Tidak dapat terhubung ke ${wsUrl}. Pastikan server aktif dan port 8765 tidak terblokir firewall.`);
        updateServerReadyUI(false);

        if (personalCallActive || personalCallState !== 'idle' || callActive) {
            cleanupPersonalCall();
        }
        if (inGroupCall) {
            leaveGroupCall(false);
        }

        // Coba reconnect otomatis maksimal MAX_AUTO_RECONNECTS kali
        if (reconnectAttempts < MAX_AUTO_RECONNECTS) {
            reconnectAttempts++;
            reconnectTimer = setTimeout(initWebSocket, 3500);
        }
    };

    socket.onerror = (err) => {
        console.warn(`WebSocket error on ${wsUrl}. Pastikan server aktif dan port tidak terblokir.`, err);
    };

    socket.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleSocketMessage(msg);
        } catch (e) {
            console.error('Invalid message received:', event.data, e);
        }
    };
}

function manualRetryWebSocket() {
    reconnectAttempts = 0;
    showToast('Mencoba menyambungkan kembali ke server...');
    initWebSocket();
}

// ── Inisialisasi Startup ──
function boot() {
    initWebSocket();
    fetchUploadConfig();
    updateDiagInfo();

    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        console.warn('[VoiceLink] Berjalan di Insecure Context (HTTP via IP LAN). Browser HP akan memblokir mikrofon kecuali menggunakan HTTPS tepercaya atau mengaktifkan flag chrome://flags/#unsafely-treat-insecure-origin-as-secure.');
    }

    if (wsStatusText) {
        wsStatusText.style.cursor = 'pointer';
        wsStatusText.addEventListener('click', () => {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                manualRetryWebSocket();
            }
        });
    }

    if (usernameInput) {
        usernameInput.focus();
        usernameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') joinApp();
        });
    }

    // Auto resize textarea chat group
    if (chatInput) {
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendTextMessage();
            }
        });
    }

    // Auto resize / kirim textarea chat personal
    if (personalChatInput) {
        personalChatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendPersonalTextMessage();
            }
        });
    }

    updateServerReadyUI(false);

    window.addEventListener('beforeunload', () => {
        if (inGroupCall) {
            leaveGroupCall(true);
        }
        if (callActive) {
            endCall(true);
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}

// Mengambil batas konfigurasi ukuran media dari upload.php
async function fetchUploadConfig() {
    try {
        const res = await fetch('upload.php');
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.config) {
                uploadConfig = { ...uploadConfig, ...data.config };
            }
        }
    } catch (e) {
        console.warn('Gagal mengambil konfigurasi upload dari server, menggunakan batas default:', e);
    }
}

// ── Join Application (Masuk ke Group Publik Otomatis) ──
function joinApp() {
    const name = usernameInput.value.trim();
    if (!name) {
        showToast('Masukkan nama Anda terlebih dahulu');
        usernameInput.focus();
        return;
    }

    unlockAudio();

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        const wsUrl = getWebSocketUrl();
        if (socket && socket.readyState === WebSocket.CONNECTING) {
            showToast(`Sedang menghubungkan ke ${wsUrl}... Jika lama, periksa start_server.bat dan Windows Firewall.`);
        } else {
            showToast(`Server WebSocket offline (${wsUrl})! Pastikan server aktif dan port tidak terblokir.`);
            manualRetryWebSocket();
        }
        return;
    }

    myName = name;
    socket.send(JSON.stringify({
        type: 'register',
        id: myId,
        name: myName,
        inviteRoomId: pendingRoomInvite || activeCommunityRoom?.id || ''
    }));
    pendingRoomInvite = null;

    // Update profil di sidebar
    myAvatar.textContent = myName.charAt(0).toUpperCase();
    myNameDisplay.textContent = myName;
    myIdDisplay.textContent = `#${myId}`;

    loginScreen.classList.remove('active');
    appScreen.classList.add('active');

    // Pengguna otomatis masuk ke Group Publik sebagai layar utama
    switchToGroupView();
}

// Tampilkan tampilan daftar anggota di HP (Mobile View)
function showMobileMembersView() {
    if (appScreen) {
        appScreen.classList.remove('in-personal-chat');
        appScreen.classList.remove('in-call');
        appScreen.classList.add('in-members-view');
    }
}

// Beralih ke tampilan Group Publik
function switchToGroupView() {
    if (activeCommunityRoom) leaveCommunityRoom();
    [callingPanel, incomingPanel, activeCallPanel].forEach(p => p.classList.remove('active'));

    if (personalView) {
        personalView.classList.remove('active');
        personalView.style.display = 'none';
    }

    if (groupView) {
        groupView.classList.add('active');
        groupView.style.display = 'flex';
    }

    appScreen.classList.remove('in-call');
    appScreen.classList.remove('in-personal-chat');
    appScreen.classList.remove('in-members-view');
    activeChatPeer = null;

    const navGroupBtn = document.getElementById('nav-group-btn');
    if (navGroupBtn) navGroupBtn.classList.add('active');

    // Hapus status aktif dari semua item user di sidebar
    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
}

// ── Socket Message Dispatcher ──
function handleSocketMessage(msg) {
    switch (msg.type) {
        // Registrasi & Group Init
        case 'registered':
            myId = msg.id;
            myIdDisplay.textContent = `#${myId}`;
            break;

        case 'group_init':
            handleGroupInit(msg);
            break;

        case 'community_rooms':
            communityRooms = msg.rooms || [];
            if (activeCommunityRoom) {
                const activeRoom = communityRooms.find(room => room.id === activeCommunityRoom.id);
                if (!activeRoom) activeCommunityRoom = null;
                else activeCommunityRoom = { ...activeCommunityRoom, ...activeRoom };
            }
            renderCommunityRooms();
            break;

        case 'community_room_joined':
            activeCommunityRoom = msg.room;
            renderCommunityRooms();
            closeCommunityMembers();
            chatMessagesArea.innerHTML = '';
            const roomWelcome = document.createElement('div');
            roomWelcome.className = 'system-welcome';
            const isCommunityAdmin = msg.room.role === 'admin' || msg.room.ownerId === myId;
            roomWelcome.innerHTML = `<div class="welcome-badge">${escapeHtml(msg.room.name)}</div><div class="community-role-badge ${isCommunityAdmin ? 'admin' : 'member'}">${isCommunityAdmin ? 'Admin komunitas' : 'Anggota'}</div><p>Komunitas privat. Undang anggota lewat tautan atau nama pengguna.</p>`;
            chatMessagesArea.appendChild(roomWelcome);
            (msg.history || []).forEach(item => renderChatMessage(item, false));
            const roomTitle = document.querySelector('.group-title');
            if (roomTitle) roomTitle.textContent = msg.room.name;
            if (chatInput) chatInput.placeholder = `Tulis pesan ke ${msg.room.name}...`;
            const roomActions = document.getElementById('community-actions');
            if (roomActions) roomActions.style.display = 'flex';
            const membersButton = document.getElementById('community-members-btn');
            if (membersButton) membersButton.style.display = isCommunityAdmin ? '' : 'none';
            const publicCallActions = document.getElementById('group-call-header-action');
            if (publicCallActions) publicCallActions.style.display = 'none';
            const publicCallPanel = document.getElementById('group-call-active-container');
            if (publicCallPanel) publicCallPanel.style.display = 'none';
            ['attach-btn', 'start-vn-btn'].forEach(id => { const control = document.getElementById(id); if (control) control.style.display = 'none'; });
            showToast(`Masuk ke komunitas ${msg.room.name}`);
            break;

        case 'community_room_message':
            if (activeCommunityRoom && msg.roomId === activeCommunityRoom.id) handleIncomingGroupChat(msg);
            break;

        case 'community_room_members':
            if (activeCommunityRoom?.id === msg.roomId && activeCommunityRoom.ownerId === myId) {
                renderCommunityMembers(msg.members || []);
            }
            break;

        case 'community_room_members_update':
            if (activeCommunityRoom?.id === msg.roomId && activeCommunityRoom.ownerId === myId && document.getElementById('community-members-panel')?.style.display !== 'none') {
                renderCommunityMembers(msg.members || []);
            }
            break;

        case 'community_invite':
            if (confirm(`${msg.fromName} mengundang Anda ke komunitas “${msg.roomName}”. Gabung sekarang?`)) {
                socket.send(JSON.stringify({ type: 'community_room_join', roomId: msg.roomId }));
            }
            break;

        case 'user_list':
            updateUserList(msg.users);
            break;

        case 'group_system_msg':
            renderSystemMessage(msg.text, msg.time);
            break;

        case 'group_chat_msg':
            handleIncomingGroupChat(msg);
            break;

        // Group Call (WebRTC Mesh)
        case 'group_call_update':
            handleGroupCallUpdate(msg);
            break;

        case 'group_call_started':
        case 'group_call_joined':
            handleGroupCallJoined(msg);
            break;

        case 'group_call_peer_joined':
            handleGroupCallPeerJoined(msg.peer);
            break;

        case 'group_call_peer_left':
            handleGroupCallPeerLeft(msg.peerId);
            break;

        case 'group_call_left':
            handleGroupCallLeft();
            break;

        case 'group_call_mic_status':
            handleGroupCallMicStatus(msg.peerId, msg.isMuted);
            break;

        case 'group_call_error':
            showToast(msg.msg || 'Gagal mengikuti panggilan group');
            break;

        case 'webrtc_signal':
            handleWebRTCSignal(msg.fromId, msg.signal);
            break;

        // ── Personal Chat Messages ──
        case 'personal_chat_msg':
            handlePersonalChatMessage(msg);
            break;

        case 'personal_chat_sent':
            handlePersonalChatSent(msg);
            break;

        case 'personal_history_res':
            handlePersonalHistoryRes(msg);
            break;

        // ── Personal WebRTC Call Messages ──
        case 'personal_call_incoming':
        case 'incoming_call':
            handlePersonalCallIncoming(msg.callId, msg.fromId, msg.fromName);
            break;

        case 'personal_call_ringing':
            handlePersonalCallRinging(msg.callId, msg.targetId, msg.targetName);
            break;

        case 'personal_call_accepted':
        case 'call_accepted':
            handlePersonalCallAccepted(msg.callId, msg.peerId || msg.fromId, msg.peerName || msg.fromName);
            break;

        case 'personal_call_started':
        case 'call_started':
            handlePersonalCallStarted(msg.callId, msg.peerId || msg.fromId, msg.peerName || msg.fromName);
            break;

        case 'personal_call_rejected':
        case 'call_rejected':
            handlePersonalCallRejected(msg.byName);
            break;

        case 'personal_call_ended':
        case 'call_ended':
            handlePersonalCallEnded(msg.byName, msg.msg);
            break;

        case 'personal_call_error':
            handlePersonalCallError(msg.reason, msg.msg);
            break;

        case 'personal_webrtc_signal':
            handlePersonalWebRTCSignal(msg.fromId, msg.signal);
            break;

        case 'personal_mic_status':
            handlePersonalMicStatus(msg.fromId, msg.isMuted);
            break;

        case 'peer_disconnected':
            showToast('Lawan bicara terputus.');
            cleanupPersonalCall();
            break;

        case 'audio':
            // Fallback backward-compatibility untuk legacy raw audio jika masih dipanggil
            if (personalCallActive && !personalIsDeafened) {
                playReceivedAudioChunk(msg.data, msg.rate);
            }
            break;

        case 'error':
            showToast(msg.msg || 'Terjadi kesalahan');
            break;
    }
}

// ── Inisialisasi Group Publik ──
function handleGroupInit(data) {
    if (data.users) updateUserList(data.users);
    if (data.groupCall) handleGroupCallUpdate(data.groupCall);
    if (data.history && Array.isArray(data.history)) {
        data.history.forEach(item => {
            renderChatMessage(item, false);
        });
        scrollChatToBottom();
    }
}

function renderCommunityRooms() {
    const list = document.getElementById('community-room-list');
    if (!list) return;
    list.innerHTML = '';
    if (!communityRooms.length) {
        list.innerHTML = '<div class="empty-list">Belum ada komunitas</div>';
        return;
    }
    communityRooms.forEach(room => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = `community-room-item ${activeCommunityRoom?.id === room.id ? 'active' : ''}`;
        const isAdmin = room.ownerId === myId;
        item.innerHTML = `<span class="community-room-name"># ${escapeHtml(room.name)}</span>${isAdmin ? '<span class="community-admin-tag">Admin</span>' : ''}`;
        item.title = `${isAdmin ? 'Admin · ' : ''}Buka ${room.name}`;
        item.addEventListener('click', () => {
            if (socket?.readyState !== WebSocket.OPEN) return showToast('Server belum terhubung.');
            socket.send(JSON.stringify({ type: 'community_room_join', roomId: room.id }));
        });
        list.appendChild(item);
    });
}

function createCommunityRoom() {
    if (!myName) return showToast('Masuk terlebih dahulu sebelum membuat komunitas.');
    if (socket?.readyState !== WebSocket.OPEN) return showToast('Server belum terhubung. Coba lagi setelah status koneksi online.');
    const name = prompt('Nama komunitas baru:');
    if (!name || !name.trim()) return;
    const normalizedName = name.trim();
    if ([...normalizedName].length > 48) return showToast('Nama komunitas maksimal 48 karakter.');
    socket.send(JSON.stringify({ type: 'community_room_create', name: normalizedName }));
}

function inviteCommunityByUsername() {
    if (!activeCommunityRoom) return showToast('Buka komunitas yang ingin dibagikan dulu.');
    const username = prompt('Masukkan nama pengguna yang sedang online:');
    if (!username || !username.trim()) return;
    socket.send(JSON.stringify({ type: 'community_room_invite_user', roomId: activeCommunityRoom.id, username: username.trim() }));
}

function requestCommunityMembers() {
    if (!activeCommunityRoom || activeCommunityRoom.ownerId !== myId) {
        return showToast('Hanya admin komunitas yang dapat melihat daftar anggota.');
    }
    if (socket?.readyState !== WebSocket.OPEN) return showToast('Server belum terhubung.');
    socket.send(JSON.stringify({ type: 'community_room_members', roomId: activeCommunityRoom.id }));
}

function renderCommunityMembers(members) {
    const panel = document.getElementById('community-members-panel');
    const list = document.getElementById('community-members-list');
    if (!panel || !list) return;
    list.innerHTML = '';
    if (!members.length) {
        list.innerHTML = '<div class="community-member-empty">Belum ada anggota.</div>';
    } else {
        members.forEach(member => {
            const row = document.createElement('div');
            row.className = 'community-member-row';
            const name = document.createElement('span');
            name.className = 'community-member-name';
            name.textContent = member.name;
            const role = document.createElement('span');
            role.className = `community-member-role ${member.role === 'admin' ? 'admin' : 'member'}`;
            role.textContent = member.role === 'admin' ? 'Admin' : 'Anggota';
            row.append(name, role);
            list.appendChild(row);
        });
    }
    panel.style.display = 'block';
}

function closeCommunityMembers() {
    const panel = document.getElementById('community-members-panel');
    if (panel) panel.style.display = 'none';
}

function shareCommunityInvite() {
    if (!activeCommunityRoom) return showToast('Buka komunitas yang ingin dibagikan dulu.');
    const url = new URL(window.location.href);
    url.searchParams.set('room', activeCommunityRoom.id);
    const inviteUrl = url.toString();
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(inviteUrl).then(() => showToast('Tautan undangan disalin. Penerima harus masuk dengan nama mereka.')).catch(() => prompt('Salin tautan undangan ini:', inviteUrl));
    } else prompt('Salin tautan undangan ini:', inviteUrl);
}

function leaveCommunityRoom() {
    if (!activeCommunityRoom) return;
    const roomId = activeCommunityRoom.id;
    if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'community_room_leave', roomId }));
    } else {
        return showToast('Server belum terhubung.');
    }
    activeCommunityRoom = null;
    const roomTitle = document.querySelector('.group-title');
    if (roomTitle) roomTitle.textContent = 'Group Publik VoiceLink';
    if (chatInput) chatInput.placeholder = 'Tulis pesan ke group publik... (Enter untuk kirim)';
    const roomActions = document.getElementById('community-actions');
    if (roomActions) roomActions.style.display = 'none';
    const membersButton = document.getElementById('community-members-btn');
    if (membersButton) membersButton.style.display = 'none';
    closeCommunityMembers();
    const publicCallActions = document.getElementById('group-call-header-action');
    if (publicCallActions) publicCallActions.style.display = '';
    const publicCallPanel = document.getElementById('group-call-active-container');
    if (publicCallPanel && inGroupCall) publicCallPanel.style.display = 'block';
    ['attach-btn', 'start-vn-btn'].forEach(id => { const control = document.getElementById(id); if (control) control.style.display = ''; });
    chatMessagesArea.innerHTML = '<div class="system-welcome"><div class="welcome-badge">Group Publik</div><p>Kembali ke percakapan publik VoiceLink.</p></div>';
    renderCommunityRooms();
}

// ── Update Daftar User Online ──
function updateUserList(users) {
    groupUsers = users || [];

    // Update badge online group publik
    const count = groupUsers.length;
    if (groupOnlineBadge) groupOnlineBadge.textContent = `${count} Online`;
    if (groupHeaderOnlineText) groupHeaderOnlineText.textContent = `${count} Anggota Online`;

    // Periksa status online lawan bicara personal jika chat sedang terbuka
    if (activeChatPeer) {
        const isOnline = groupUsers.some(u => u.id === activeChatPeer.id);
        updatePersonalPeerStatusUI(isOnline);
    }

    // Render daftar teman 1-on-1 (selain diri sendiri)
    userListEl.innerHTML = '';
    const otherUsers = groupUsers.filter(u => u.id !== myId);

    const mobileCountEl = document.getElementById('mobile-online-count');
    if (mobileCountEl) mobileCountEl.textContent = otherUsers.length;
    const mobileSidebarCountEl = document.getElementById('mobile-sidebar-count');
    if (mobileSidebarCountEl) mobileSidebarCountEl.textContent = otherUsers.length;

    if (otherUsers.length === 0) {
        userListEl.innerHTML = '<div class="empty-list">Belum ada user lain online.<br><small style="color:var(--text-muted);opacity:0.7">Buka tab baru atau hubungkan HP lain ke LAN untuk tes!</small></div>';
        return;
    }

    otherUsers.forEach(user => {
        const item = document.createElement('div');
        const isActive = activeChatPeer && activeChatPeer.id === user.id;
        item.className = `user-item ${isActive ? 'active' : ''}`;
        item.setAttribute('data-user-id', user.id);

        const unread = unreadCounts[user.id] || 0;
        const unreadBadgeHtml = unread > 0 ? `<span class="unread-badge">${unread}</span>` : '';

        item.innerHTML = `
            <div class="u-avatar">${escapeHtml(user.name.charAt(0).toUpperCase())}</div>
            <div class="u-info">
                <div class="u-name">${escapeHtml(user.name)}</div>
                <div class="u-status">Tap untuk chat pribadi</div>
            </div>
            ${unreadBadgeHtml}
            <button class="call-user-btn" title="Panggil Suara ${escapeHtml(user.name)}" aria-label="Panggil ${escapeHtml(user.name)}">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
                </svg>
            </button>
        `;

        // Klik row: Buka Chat Pribadi
        item.addEventListener('click', (e) => {
            if (e.target.closest('.call-user-btn')) return;
            openPersonalChat(user.id, user.name);
        });

        // Klik icon telepon: Mulai Panggilan Suara WebRTC
        const callBtn = item.querySelector('.call-user-btn');
        if (callBtn) {
            callBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                startPersonalCall(user.id, user.name);
            });
        }

        userListEl.appendChild(item);
    });
}

// ── GROUP CALL (WEBRTC AUDIO MESH, MAKS 6 PESERTA) ──

function handleGroupCallUpdate(state) {
    groupCallState = state;
    const participants = state.participants || [];
    const count = participants.length;
    const max = state.maxParticipants || 6;

    if (state.active) {
        gcStartBox.style.display = 'none';
        gcLiveBox.style.display = 'flex';
        gcLiveCountBadge.textContent = `Call Aktif (${count}/${max})`;

        const joinBtn = document.getElementById('join-gc-btn');
        if (inGroupCall) {
            joinBtn.style.display = 'none';
        } else {
            joinBtn.style.display = 'flex';
            if (count >= max) {
                joinBtn.disabled = true;
                joinBtn.title = `Panggilan penuh (maksimal ${max} peserta)`;
                joinBtn.innerHTML = '<span>Panggilan Penuh</span>';
            } else {
                joinBtn.disabled = false;
                joinBtn.title = 'Gabung panggilan group';
                joinBtn.innerHTML = '<span>Gabung Panggilan</span>';
            }
        }
    } else {
        gcStartBox.style.display = 'flex';
        gcLiveBox.style.display = 'none';
        if (inGroupCall) {
            leaveGroupCall(false);
        }
    }

    if (inGroupCall) {
        gcCapacityBadge.textContent = `Peserta: ${count}/${max}`;
        renderGroupCallParticipants(participants);
    }
}

async function startGroupCall() {
    if (callActive) {
        showToast('Anda sedang dalam panggilan 1-on-1.');
        return;
    }
    if (inGroupCall) {
        showToast('Anda sudah berada dalam panggilan group.');
        return;
    }

    await unlockAudio();

    // Nilai batas peserta: minimum 2, maksimum 6
    const selectedLimit = parseInt(gcLimitSelect.value, 10) || 6;
    const callLimit = Math.max(2, Math.min(6, selectedLimit));

    socket.send(JSON.stringify({
        type: 'group_call_start',
        maxParticipants: callLimit
    }));
}

async function joinGroupCall() {
    if (callActive) {
        showToast('Anda sedang dalam panggilan 1-on-1.');
        return;
    }
    if (inGroupCall) return;

    if (groupCallState.count >= groupCallState.maxParticipants) {
        showToast(`Panggilan group sudah penuh (maksimal ${groupCallState.maxParticipants} peserta).`);
        return;
    }

    await unlockAudio();

    socket.send(JSON.stringify({
        type: 'group_call_join'
    }));
}

async function handleGroupCallJoined(data) {
    inGroupCall = true;
    groupMicMuted = false;
    groupDeafened = false;

    groupCallActiveContainer.style.display = 'block';
    gcStartBox.style.display = 'none';
    gcLiveBox.style.display = 'flex';
    document.getElementById('join-gc-btn').style.display = 'none';

    updateGroupMicUI();
    startGroupCallTimer();

    try {
        const md = getMediaDevices();
        if (!md) {
            throw new Error('Perangkat tidak mendukung mikrofon.');
        }

        groupLocalStream = await md.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });

        // Setup WebRTC Peer Connection untuk setiap peserta yang sudah ada di panggilan
        const existingParticipants = (data.participants || []).filter(p => p.id !== myId);
        for (const peer of existingParticipants) {
            await createPeerConnectionFor(peer.id, true); // Sebagai initiator (buat offer)
        }

        renderGroupCallParticipants(data.participants || []);
        startGroupSpeakingDetector();
        showToast('Berhasil bergabung ke panggilan group!');
    } catch (e) {
        console.error('Gagal mengakses mic untuk group call:', e);
        showToast('Peringatan: Mikrofon tidak dapat diakses (' + e.message + ')');
    }
}

// Buat RTCPeerConnection untuk peer tertentu
async function createPeerConnectionFor(peerId, isInitiator) {
    if (groupPeers.has(peerId)) {
        return groupPeers.get(peerId).pc;
    }

    const pc = new RTCPeerConnection(rtcConfig);

    // Tambahkan track audio lokal ke koneksi
    if (groupLocalStream) {
        groupLocalStream.getTracks().forEach(track => {
            pc.addTrack(track, groupLocalStream);
        });
    }

    // Tangani ICE Candidate
    pc.onicecandidate = (event) => {
        if (event.candidate && socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'webrtc_signal',
                targetId: peerId,
                signal: {
                    type: 'candidate',
                    candidate: event.candidate
                }
            }));
        }
    };

    // Tangani aliran audio yang diterima dari peer ini
    pc.ontrack = (event) => {
        const remoteStream = event.streams[0];
        let audioEl = document.getElementById(`audio-peer-${peerId}`);
        if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = `audio-peer-${peerId}`;
            audioEl.autoplay = true;
            audioEl.playsInline = true;
            webrtcAudioContainer.appendChild(audioEl);
        }
        audioEl.srcObject = remoteStream;
        audioEl.muted = groupDeafened;

        // Hubungkan ke analyser untuk visualisasi indikator berbicara
        setupRemoteSpeakingAnalyser(peerId, remoteStream);
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            removePeerConnection(peerId);
        }
    };

    groupPeers.set(peerId, { pc, audioEl: null, analyser: null });

    // Jika initiator, buat dan kirim SDP Offer
    if (isInitiator) {
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.send(JSON.stringify({
                type: 'webrtc_signal',
                targetId: peerId,
                signal: {
                    type: 'offer',
                    sdp: offer.sdp
                }
            }));
        } catch (err) {
            console.error(`Gagal membuat offer WebRTC untuk ${peerId}:`, err);
        }
    }

    return pc;
}

// Tangani peserta baru yang masuk saat kita sudah di dalam call
async function handleGroupCallPeerJoined(peer) {
    if (!inGroupCall || peer.id === myId) return;
    showToast(`${peer.name} bergabung ke panggilan group`);
    // Tunggu offer dari peer baru atau inisiasi
}

// Tangani peserta yang meninggalkan group call
function handleGroupCallPeerLeft(peerId) {
    removePeerConnection(peerId);
    if (inGroupCall && groupCallState.participants) {
        groupCallState.participants = groupCallState.participants.filter(p => p.id !== peerId);
        renderGroupCallParticipants(groupCallState.participants);
    }
}

function removePeerConnection(peerId) {
    if (groupPeers.has(peerId)) {
        const item = groupPeers.get(peerId);
        if (item.pc) {
            item.pc.close();
        }
        const audioEl = document.getElementById(`audio-peer-${peerId}`);
        if (audioEl) {
            audioEl.srcObject = null;
            audioEl.remove();
        }
        groupPeers.delete(peerId);
    }
}

// Tangani pertukaran sinyal WebRTC (Offer, Answer, Candidate)
async function handleWebRTCSignal(fromId, signal) {
    if (!inGroupCall || !signal) return;

    try {
        let pcEntry = groupPeers.get(fromId);
        let pc = pcEntry ? pcEntry.pc : null;

        if (signal.type === 'offer') {
            if (!pc) {
                pc = await createPeerConnectionFor(fromId, false);
            }
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            socket.send(JSON.stringify({
                type: 'webrtc_signal',
                targetId: fromId,
                signal: {
                    type: 'answer',
                    sdp: answer.sdp
                }
            }));
        } else if (signal.type === 'answer') {
            if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
            }
        } else if (signal.type === 'candidate') {
            if (pc && signal.candidate) {
                await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            }
        }
    } catch (err) {
        console.error(`Error memproses sinyal WebRTC dari ${fromId}:`, err);
    }
}

// Tinggalkan panggilan group dan bebaskan slot
function leaveGroupCall(notifyServer = true) {
    if (!inGroupCall) return;
    inGroupCall = false;

    if (notifyServer && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'group_call_leave' }));
    }

    // Bersihkan semua koneksi peer WebRTC
    groupPeers.forEach((item, peerId) => {
        removePeerConnection(peerId);
    });
    groupPeers.clear();

    if (groupLocalStream) {
        groupLocalStream.getTracks().forEach(t => t.stop());
        groupLocalStream = null;
    }

    clearInterval(groupSpeakingInterval);
    groupSpeakingInterval = null;
    stopGroupCallTimer();

    groupCallActiveContainer.style.display = 'none';
    if (groupCallState.active) {
        gcLiveBox.style.display = 'flex';
        document.getElementById('join-gc-btn').style.display = 'flex';
    } else {
        gcStartBox.style.display = 'flex';
        gcLiveBox.style.display = 'none';
    }

    showToast('Anda telah meninggalkan panggilan group.');
}

function handleGroupCallLeft() {
    leaveGroupCall(false);
}

// Kontrol Mikrofon & Speaker di Group Call
function toggleGroupMute() {
    if (!inGroupCall || !groupLocalStream) return;
    groupMicMuted = !groupMicMuted;

    groupLocalStream.getAudioTracks().forEach(track => {
        track.enabled = !groupMicMuted;
    });

    socket.send(JSON.stringify({
        type: 'group_call_mic_status',
        isMuted: groupMicMuted
    }));

    updateGroupMicUI();
    showToast(groupMicMuted ? 'Mikrofon dimatikan (Muted)' : 'Mikrofon aktif');
}

function updateGroupMicUI() {
    if (groupMicMuted) {
        gcMuteBtn.classList.add('active');
        gcMicIconOn.style.display = 'none';
        gcMicIconOff.style.display = 'block';
        gcMuteLabel.textContent = 'Unmute';
    } else {
        gcMuteBtn.classList.remove('active');
        gcMicIconOn.style.display = 'block';
        gcMicIconOff.style.display = 'none';
        gcMuteLabel.textContent = 'Mute';
    }

    // Update status kartu sendiri di grid
    const selfCardStatus = document.getElementById(`gc-mic-badge-${myId}`);
    if (selfCardStatus) {
        selfCardStatus.className = `gc-p-status ${groupMicMuted ? 'muted' : 'active'}`;
        selfCardStatus.textContent = groupMicMuted ? 'Muted' : 'Mic Aktif';
    }
}

function toggleGroupDeafen() {
    if (!inGroupCall) return;
    groupDeafened = !groupDeafened;

    webrtcAudioContainer.querySelectorAll('audio').forEach(audioEl => {
        audioEl.muted = groupDeafened;
    });

    if (groupDeafened) {
        gcDeafenBtn.classList.add('active');
        gcVolIconOn.style.display = 'none';
        gcVolIconOff.style.display = 'block';
        showToast('Speaker dimatikan');
    } else {
        gcDeafenBtn.classList.remove('active');
        gcVolIconOn.style.display = 'block';
        gcVolIconOff.style.display = 'none';
        showToast('Speaker aktif');
    }
}

function handleGroupCallMicStatus(peerId, isMuted) {
    const badge = document.getElementById(`gc-mic-badge-${peerId}`);
    if (badge) {
        badge.className = `gc-p-status ${isMuted ? 'muted' : 'active'}`;
        badge.textContent = isMuted ? 'Muted' : 'Mic Aktif';
    }
}

// Render Kartu Peserta Panggilan Group (Maks 6)
function renderGroupCallParticipants(participants) {
    gcParticipantsGrid.innerHTML = '';
    participants.forEach(p => {
        const isSelf = p.id === myId;
        const card = document.createElement('div');
        card.className = 'gc-p-card';
        card.id = `gc-card-${p.id}`;

        const isMicMuted = isSelf ? groupMicMuted : (p.isMuted || false);

        card.innerHTML = `
            <div class="gc-p-avatar">${escapeHtml(p.name.charAt(0).toUpperCase())}</div>
            <div class="gc-p-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}${isSelf ? ' (Kamu)' : ''}</div>
            <div class="gc-p-status ${isMicMuted ? 'muted' : 'active'}" id="gc-mic-badge-${p.id}">
                ${isMicMuted ? 'Muted' : 'Mic Aktif'}
            </div>
        `;
        gcParticipantsGrid.appendChild(card);
    });
}

// Visualisasi Deteksi Suara Berbicara (Speaking Ring)
function setupRemoteSpeakingAnalyser(peerId, stream) {
    try {
        if (!audioCtx) return;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);

        const entry = groupPeers.get(peerId);
        if (entry) {
            entry.analyser = analyser;
        }
    } catch (e) {
        console.warn('Gagal memasang speaking analyser untuk peer:', e);
    }
}

function startGroupSpeakingDetector() {
    if (groupSpeakingInterval) clearInterval(groupSpeakingInterval);

    let localAnalyserNode = null;
    try {
        if (audioCtx && groupLocalStream) {
            const src = audioCtx.createMediaStreamSource(groupLocalStream);
            localAnalyserNode = audioCtx.createAnalyser();
            localAnalyserNode.fftSize = 64;
            src.connect(localAnalyserNode);
        }
    } catch (e) {}

    const buf = new Uint8Array(32);

    groupSpeakingInterval = setInterval(() => {
        if (!inGroupCall) return;

        // Cek diri sendiri
        if (localAnalyserNode && !groupMicMuted) {
            localAnalyserNode.getByteFrequencyData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) sum += buf[i];
            const avg = sum / buf.length;
            const selfCard = document.getElementById(`gc-card-${myId}`);
            if (selfCard) {
                if (avg > 18) selfCard.classList.add('speaking');
                else selfCard.classList.remove('speaking');
            }
        }

        // Cek remote peers
        groupPeers.forEach((entry, peerId) => {
            if (entry.analyser) {
                entry.analyser.getByteFrequencyData(buf);
                let sum = 0;
                for (let i = 0; i < buf.length; i++) sum += buf[i];
                const avg = sum / buf.length;
                const card = document.getElementById(`gc-card-${peerId}`);
                if (card) {
                    if (avg > 18) card.classList.add('speaking');
                    else card.classList.remove('speaking');
                }
            }
        });
    }, 120);
}

function startGroupCallTimer() {
    groupCallStartTime = Date.now();
    gcTimer.textContent = '00:00';
    clearInterval(groupCallTimerInterval);
    groupCallTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - groupCallStartTime) / 1000);
        const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const s = String(elapsed % 60).padStart(2, '0');
        gcTimer.textContent = `${m}:${s}`;
    }, 1000);
}

function stopGroupCallTimer() {
    clearInterval(groupCallTimerInterval);
    groupCallTimerInterval = null;
    gcTimer.textContent = '00:00';
}

// ── GROUP CHAT & MULTIMEDIA SHARING ──

function sendTextMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        showToast('Koneksi terputus. Menghubungkan kembali...');
        initWebSocket();
        return;
    }

    const tempId = 'temp_' + Date.now();

    // Render pesan lokal langsung dengan status "Mengirim..."
    renderChatMessage({
        id: tempId,
        tempId: tempId,
        senderId: myId,
        senderName: myName,
        msgType: 'text',
        text: text,
        time: getCurrentTime(),
        status: 'sending'
    }, true);

    socket.send(JSON.stringify({
        type: activeCommunityRoom ? 'community_room_send' : 'group_chat_send',
        roomId: activeCommunityRoom?.id || '',
        msgType: 'text',
        text: text,
        tempId: tempId
    }));

    chatInput.value = '';
    chatInput.style.height = '44px';
    scrollChatToBottom();
}

function handleIncomingGroupChat(msg) {
    // Jika pesan ini berasal dari pengiriman kita sendiri, update statusnya menjadi "Terkirim"
    if (msg.tempId) {
        const tempEl = document.getElementById(`msg-${msg.tempId}`);
        if (tempEl) {
            tempEl.id = `msg-${msg.id}`;
            const statusEl = tempEl.querySelector('.chat-status-icon');
            if (statusEl) {
                statusEl.className = 'chat-status-icon status-sent';
                statusEl.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                    </svg>
                    <span>Terkirim</span>
                `;
            }
            return;
        }
    }

    // Jika pesan dari orang lain, render ke daftar chat
    renderChatMessage(msg, true);
    scrollChatToBottom();
}

function renderSystemMessage(text, time) {
    const el = document.createElement('div');
    el.className = 'chat-sys-msg';
    el.innerHTML = `<span>${escapeHtml(text)}</span> <small style="opacity:0.6;margin-left:6px">${time || getCurrentTime()}</small>`;
    chatMessagesArea.appendChild(el);
    scrollChatToBottom();
}

function renderChatMessage(msg, shouldScroll = true) {
    const isSelf = msg.senderId === myId;
    const row = document.createElement('div');
    row.className = `chat-msg-row ${isSelf ? 'self' : 'other'}`;
    row.id = `msg-${msg.id || msg.tempId}`;

    let contentHtml = '';

    if (msg.msgType === 'text') {
        contentHtml = `<div class="chat-text">${escapeHtml(msg.text)}</div>`;
    } else if (msg.msgType === 'image') {
        contentHtml = `
            <img src="${escapeHtml(msg.fileUrl)}" class="chat-img-thumb" alt="${escapeHtml(msg.fileName || 'Foto')}" onclick="openMediaModal('${escapeHtml(msg.fileUrl)}', 'image')" loading="lazy"/>
        `;
    } else if (msg.msgType === 'video') {
        contentHtml = `
            <video src="${escapeHtml(msg.fileUrl)}" class="chat-video-player" controls playsinline preload="metadata"></video>
        `;
    } else if (msg.msgType === 'audio') {
        contentHtml = renderVoiceNotePlayerHtml(msg);
    }

    let statusHtml = '';
    if (isSelf) {
        if (msg.status === 'sending') {
            statusHtml = `
                <div class="chat-status-icon status-sending" title="Sedang mengirim...">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                    <span>Mengirim...</span>
                </div>
            `;
        } else {
            statusHtml = `
                <div class="chat-status-icon status-sent" title="Terkirim">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                    </svg>
                    <span>Terkirim</span>
                </div>
            `;
        }
    }

    row.innerHTML = `
        ${!isSelf ? `<div class="chat-sender-label">${escapeHtml(msg.senderName || 'User')}</div>` : ''}
        <div class="chat-bubble">
            ${contentHtml}
            <div class="chat-bubble-footer">
                <span class="chat-time">${msg.time || getCurrentTime()}</span>
                ${statusHtml}
            </div>
        </div>
    `;

    chatMessagesArea.appendChild(row);

    // Pasang event listener untuk audio voice note jika pesan berupa audio
    if (msg.msgType === 'audio') {
        initVoiceNoteAudioElement(row, msg.fileUrl);
    }

    if (shouldScroll) {
        scrollChatToBottom();
    }
}

function renderVoiceNotePlayerHtml(msg) {
    const durationLabel = msg.duration ? formatDuration(msg.duration) : 'Voice Note';
    return `
        <div class="chat-vn-player" data-src="${escapeHtml(msg.fileUrl)}">
            <button class="vn-play-btn" title="Putar Voice Note">
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                    <path d="M8 5v14l11-7z"/>
                </svg>
            </button>
            <div class="vn-timeline">
                <div class="vn-progress-bar">
                    <div class="vn-progress-fill"></div>
                </div>
                <div class="vn-duration">${durationLabel}</div>
            </div>
        </div>
    `;
}

function initVoiceNoteAudioElement(rowEl, fileUrl) {
    const playerEl = rowEl.querySelector('.chat-vn-player');
    if (!playerEl) return;

    const playBtn = playerEl.querySelector('.vn-play-btn');
    const progressFill = playerEl.querySelector('.vn-progress-fill');
    const progressBar = playerEl.querySelector('.vn-progress-bar');
    const durationText = playerEl.querySelector('.vn-duration');

    const audio = new Audio(fileUrl);
    let isPlaying = false;

    playBtn.addEventListener('click', () => {
        if (isPlaying) {
            audio.pause();
        } else {
            // Hentikan voice note lain yang mungkin sedang berputar
            document.querySelectorAll('audio').forEach(a => { if (a !== audio) a.pause(); });
            audio.play().catch(e => {
                showToast('Format audio tidak didukung oleh browser Anda.');
            });
        }
    });

    audio.addEventListener('play', () => {
        isPlaying = true;
        playBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg>
        `;
    });

    audio.addEventListener('pause', () => {
        isPlaying = false;
        playBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M8 5v14l11-7z"/>
            </svg>
        `;
    });

    audio.addEventListener('ended', () => {
        isPlaying = false;
        progressFill.style.width = '0%';
        playBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M8 5v14l11-7z"/>
            </svg>
        `;
    });

    audio.addEventListener('timeupdate', () => {
        if (audio.duration) {
            const pct = (audio.currentTime / audio.duration) * 100;
            progressFill.style.width = `${pct}%`;
            durationText.textContent = `${formatDuration(audio.currentTime)} / ${formatDuration(audio.duration)}`;
        }
    });

    audio.addEventListener('loadedmetadata', () => {
        durationText.textContent = formatDuration(audio.duration);
    });

    progressBar.addEventListener('click', (e) => {
        const rect = progressBar.getBoundingClientRect();
        const clickPos = (e.clientX - rect.left) / rect.width;
        if (audio.duration) {
            audio.currentTime = clickPos * audio.duration;
        }
    });
}

// ── PENGIRIMAN MEDIA FILE (FOTO & VIDEO) ──
function triggerFileInput() {
    mediaFileInput.value = '';
    mediaFileInput.click();
}

async function handleFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) {
        showToast('Format file tidak didukung. Pilih gambar (JPG, PNG, GIF, WebP) atau video (MP4, WebM, OGG).');
        return;
    }

    // Validasi ukuran di sisi browser sebelum mengunggah
    const maxSize = isImage ? uploadConfig.maxImageSize : uploadConfig.maxVideoSize;
    const maxLabel = isImage ? uploadConfig.maxImageSizeLabel : uploadConfig.maxVideoSizeLabel;
    const catName = isImage ? 'Gambar' : 'Video';

    if (file.size > maxSize) {
        const userMB = (file.size / (1024 * 1024)).toFixed(1);
        showToast(`Ukuran ${catName} terlalu besar (${userMB} MB). Maksimal: ${maxLabel}.`);
        return;
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        showToast('Koneksi WebSocket terputus. Pastikan server aktif sebelum mengunggah.');
        return;
    }

    // Tampilkan bar progress unggahan
    uploadProgressWrap.style.display = 'block';
    uploadProgressFill.style.width = '0%';
    uploadProgressText.textContent = `Mengunggah ${file.name}... 0%`;

    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'upload.php', true);

    xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
            const percent = Math.round((ev.loaded / ev.total) * 100);
            uploadProgressFill.style.width = `${percent}%`;
            uploadProgressText.textContent = `Mengunggah ${file.name}... ${percent}%`;
        }
    };

    xhr.onload = () => {
        uploadProgressWrap.style.display = 'none';
        try {
            const resp = JSON.parse(xhr.responseText);
            if (xhr.status === 200 && resp.success) {
                // Kirim metadata URL media lewat WebSocket (tidak mengirim binary besar lewat WS)
                const tempId = 'temp_' + Date.now();
                const msgType = isImage ? 'image' : 'video';

                renderChatMessage({
                    id: tempId,
                    tempId: tempId,
                    senderId: myId,
                    senderName: myName,
                    msgType: msgType,
                    fileUrl: resp.url,
                    fileName: resp.fileName,
                    time: getCurrentTime(),
                    status: 'sending'
                }, true);

                socket.send(JSON.stringify({
                    type: 'group_chat_send',
                    msgType: msgType,
                    fileUrl: resp.url,
                    fileName: resp.fileName,
                    fileSize: resp.size,
                    tempId: tempId
                }));
            } else {
                showToast(`Gagal mengunggah: ${resp.error || 'Terjadi kesalahan'}`);
            }
        } catch (err) {
            showToast('Respon server upload tidak valid.');
        }
    };

    xhr.onerror = () => {
        uploadProgressWrap.style.display = 'none';
        showToast('Koneksi upload gagal. Periksa koneksi internet atau server web Anda.');
    };

    xhr.send(formData);
}

// ── PEREKAMAN & PENGIRIMAN VOICE NOTE ──
async function startVoiceNoteRecording() {
    if (isRecordingVN()) {
        stopAndSendVoiceNote();
        return;
    }

    await unlockAudio();

    const md = getMediaDevices();
    if (!md) {
        showToast('Browser ini tidak mendukung perekaman suara.');
        return;
    }

    try {
        const stream = await md.getUserMedia({ audio: true });
        recordedAudioChunks = [];

        // Pilih format audio yang didukung browser
        let mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
                      (MediaRecorder.isTypeSupported('audio/ogg') ? 'audio/ogg' : 'audio/mp4');
        }

        mediaRecorder = new MediaRecorder(stream, { mimeType });

        mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                recordedAudioChunks.push(e.data);
            }
        };

        mediaRecorder.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
        };

        mediaRecorder.start(100); // Kumpulkan chunks setiap 100ms
        vnRecordingStartTime = Date.now();

        // Tampilkan bar perekaman
        vnRecorderBar.style.display = 'flex';
        vnTimer.textContent = '00:00';
        clearInterval(vnRecordingTimerInterval);
        vnRecordingTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - vnRecordingStartTime) / 1000);
            vnTimer.textContent = formatDuration(elapsed);
        }, 1000);

    } catch (err) {
        console.error('Gagal memulai rekaman voice note:', err);
        showToast('Izin mikrofon diperlukan untuk merekam voice note.');
    }
}

function isRecordingVN() {
    return mediaRecorder && mediaRecorder.state === 'recording';
}

function cancelVoiceNote() {
    if (mediaRecorder) {
        mediaRecorder.stop();
        mediaRecorder = null;
    }
    recordedAudioChunks = [];
    clearInterval(vnRecordingTimerInterval);
    vnRecorderBar.style.display = 'none';
    showToast('Rekaman voice note dibatalkan.');
}

async function stopAndSendVoiceNote() {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') return;

    const durationSec = Math.max(1, Math.floor((Date.now() - vnRecordingStartTime) / 1000));
    clearInterval(vnRecordingTimerInterval);
    vnRecorderBar.style.display = 'none';

    mediaRecorder.onstop = async () => {
        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(recordedAudioChunks, { type: mimeType });
        recordedAudioChunks = [];

        if (audioBlob.size <= 0) {
            showToast('Rekaman kosong.');
            return;
        }

        // Validasi ukuran di browser
        if (audioBlob.size > uploadConfig.maxAudioSize) {
            showToast(`Ukuran voice note terlalu besar. Batas maksimal: ${uploadConfig.maxAudioSizeLabel}.`);
            return;
        }

        // Tampilkan status upload
        uploadProgressWrap.style.display = 'block';
        uploadProgressFill.style.width = '0%';
        uploadProgressText.textContent = 'Mengunggah Voice Note...';

        const ext = mimeType.includes('ogg') ? 'ogg' : (mimeType.includes('mp4') ? 'm4a' : 'webm');
        const formData = new FormData();
        formData.append('file', audioBlob, `voicenote_${Date.now()}.${ext}`);

        try {
            const res = await fetch('upload.php', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            uploadProgressWrap.style.display = 'none';

            if (res.ok && data.success) {
                const tempId = 'temp_' + Date.now();

                renderChatMessage({
                    id: tempId,
                    tempId: tempId,
                    senderId: myId,
                    senderName: myName,
                    msgType: 'audio',
                    fileUrl: data.url,
                    fileName: data.fileName,
                    duration: durationSec,
                    time: getCurrentTime(),
                    status: 'sending'
                }, true);

                socket.send(JSON.stringify({
                    type: 'group_chat_send',
                    msgType: 'audio',
                    fileUrl: data.url,
                    fileName: data.fileName,
                    fileSize: data.size,
                    duration: durationSec,
                    tempId: tempId
                }));
            } else {
                showToast(`Gagal mengirim VN: ${data.error || 'Terjadi kesalahan'}`);
            }
        } catch (e) {
            uploadProgressWrap.style.display = 'none';
            showToast('Gagal mengunggah voice note ke server.');
        }
    };

    mediaRecorder.stop();
}

// ── MODAL LIGHTBOX PRATINJAU MEDIA ──
function openMediaModal(url, type) {
    mediaModalBody.innerHTML = '';
    if (type === 'image') {
        const img = document.createElement('img');
        img.src = url;
        mediaModalBody.appendChild(img);
    } else if (type === 'video') {
        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.autoplay = true;
        mediaModalBody.appendChild(video);
    }
    mediaModal.classList.add('active');
}

function closeMediaModal(e) {
    if (!e || e.target === mediaModal || e.target.classList.contains('btn-close-modal')) {
        mediaModal.classList.remove('active');
        mediaModalBody.innerHTML = '';
    }
}

// ── CHAT PRIBADI (1-ON-1 DIRECT MESSAGING) ──

function openPersonalChat(targetId, targetName) {
    if (personalCallActive || personalCallState !== 'idle') {
        showToast('Anda sedang dalam sesi panggilan suara.');
        return;
    }

    activeChatPeer = { id: targetId, name: targetName };
    unreadCounts[targetId] = 0;

    // Sembunyikan group view & members view, tampilkan personal view
    appScreen.classList.remove('in-members-view');
    appScreen.classList.add('in-personal-chat');
    if (groupView) {
        groupView.classList.remove('active');
        groupView.style.display = 'none';
    }
    const navGroupBtn = document.getElementById('nav-group-btn');
    if (navGroupBtn) navGroupBtn.classList.remove('active');

    if (personalView) {
        personalView.classList.add('active');
        personalView.style.display = 'flex';
    }

    // Update Header Personal View
    if (personalPeerAvatar) personalPeerAvatar.textContent = targetName.charAt(0).toUpperCase();
    if (personalPeerName) personalPeerName.textContent = targetName;

    const isOnline = groupUsers.some(u => u.id === targetId);
    updatePersonalPeerStatusUI(isOnline);

    // Tandai user item aktif di sidebar & hapus badge unread
    document.querySelectorAll('.user-item').forEach(el => {
        if (el.getAttribute('data-user-id') === targetId) {
            el.classList.add('active');
            const b = el.querySelector('.unread-badge');
            if (b) b.remove();
        } else {
            el.classList.remove('active');
        }
    });

    // Render riwayat percakapan lokal jika sudah ada
    renderPersonalChatHistory(targetId);

    // Minta riwayat terbaru dari server
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'get_personal_history',
            targetId: targetId
        }));
    }

    if (personalChatInput) {
        personalChatInput.focus();
    }
}

function updatePersonalPeerStatusUI(isOnline) {
    if (!personalPeerDot || !personalPeerStatus || !personalCallBtn) return;
    const isServerReady = socket && socket.readyState === WebSocket.OPEN;

    if (isOnline) {
        personalPeerDot.className = 'peer-status-dot online';
        personalPeerStatus.textContent = 'Online di Group';
        personalCallBtn.disabled = !isServerReady;
        personalCallBtn.title = isServerReady ? 'Panggil Suara Personal (WebRTC P2P)' : 'Server sedang offline';
    } else {
        personalPeerDot.className = 'peer-status-dot offline';
        personalPeerStatus.textContent = 'Offline';
        personalCallBtn.disabled = true;
        personalCallBtn.title = 'Pengguna sedang offline';
    }
}

function renderPersonalChatHistory(peerId) {
    if (!personalChatMessagesArea) return;
    personalChatMessagesArea.innerHTML = `
        <div class="chat-system-notice" id="personal-system-notice">
            Percakapan pribadi ini hanya dapat dibaca oleh Anda dan lawan bicara.
        </div>
    `;

    const msgs = personalChats[peerId] || [];
    msgs.forEach(msg => {
        renderPersonalChatMessage(msg, false);
    });
    scrollPersonalChatToBottom();
}

function renderPersonalChatMessage(msg, shouldScroll = true) {
    if (!personalChatMessagesArea) return;

    // Cek apakah row sudah ada (misal update dari status sending ke sent/offline)
    const existingRow = (msg.id ? document.getElementById(`pmsg-${msg.id}`) : null) ||
                        (msg.tempId ? document.getElementById(`pmsg-${msg.tempId}`) : null);

    const isSelf = msg.senderId === myId;

    if (existingRow) {
        if (msg.id) existingRow.id = `pmsg-${msg.id}`;
        const statusEl = existingRow.querySelector('.msg-status-tag');
        if (statusEl) {
            if (msg.status === 'sending') {
                statusEl.className = 'msg-status-tag sending';
                statusEl.textContent = '⏳ Mengirim...';
                statusEl.title = 'Sedang dikirim...';
            } else if (msg.status === 'offline' || msg.offline) {
                statusEl.className = 'msg-status-tag offline';
                statusEl.textContent = '✓ Tersimpan di server (offline)';
                statusEl.title = 'Penerima offline. Pesan tersimpan di server.';
            } else {
                statusEl.className = 'msg-status-tag sent';
                statusEl.textContent = '✓ Terkirim';
                statusEl.title = 'Terkirim';
            }
        }
        return;
    }

    const row = document.createElement('div');
    row.className = `chat-msg-row ${isSelf ? 'self' : 'other'}`;
    row.id = `pmsg-${msg.id || msg.tempId}`;

    let contentHtml = '';
    if (msg.msgType === 'text') {
        contentHtml = `<div class="chat-text">${escapeHtml(msg.text)}</div>`;
    } else if (msg.msgType === 'image') {
        contentHtml = `
            <img src="${escapeHtml(msg.fileUrl)}" class="chat-img-thumb" alt="${escapeHtml(msg.fileName || 'Foto')}" onclick="openMediaModal('${escapeHtml(msg.fileUrl)}', 'image')" loading="lazy"/>
        `;
    } else if (msg.msgType === 'video') {
        contentHtml = `
            <video src="${escapeHtml(msg.fileUrl)}" class="chat-video-player" controls playsinline preload="metadata"></video>
        `;
    } else if (msg.msgType === 'audio') {
        contentHtml = renderVoiceNotePlayerHtml(msg);
    }

    let statusHtml = '';
    if (isSelf) {
        if (msg.status === 'sending') {
            statusHtml = `<span class="msg-status-tag sending" title="Sedang dikirim...">⏳ Mengirim...</span>`;
        } else if (msg.status === 'offline' || msg.offline) {
            statusHtml = `<span class="msg-status-tag offline" title="Penerima offline. Pesan tersimpan di server.">✓ Tersimpan di server (offline)</span>`;
        } else {
            statusHtml = `<span class="msg-status-tag sent" title="Terkirim">✓ Terkirim</span>`;
        }
    }

    row.innerHTML = `
        ${!isSelf ? `<div class="chat-sender-label">${escapeHtml(msg.senderName || 'Lawan Bicara')}</div>` : ''}
        <div class="chat-bubble">
            ${contentHtml}
            <div class="chat-bubble-footer">
                <span class="chat-time">${msg.time || getCurrentTime()}</span>
                ${statusHtml}
            </div>
        </div>
    `;

    personalChatMessagesArea.appendChild(row);

    if (msg.msgType === 'audio') {
        initVoiceNoteAudioElement(row, msg.fileUrl);
    }

    if (shouldScroll) {
        scrollPersonalChatToBottom();
    }
}

function scrollPersonalChatToBottom() {
    requestAnimationFrame(() => {
        if (personalChatMessagesArea) {
            personalChatMessagesArea.scrollTop = personalChatMessagesArea.scrollHeight;
        }
    });
}

function sendPersonalTextMessage() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        showToast('Server WebSocket belum siap. Menunggu koneksi...');
        return;
    }
    if (!activeChatPeer) return;

    const text = personalChatInput.value.trim();
    if (!text) return;

    personalChatInput.value = '';
    const tempId = 'ptemp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);

    const msgObj = {
        id: tempId,
        tempId: tempId,
        senderId: myId,
        senderName: myName,
        targetId: activeChatPeer.id,
        msgType: 'text',
        text: text,
        time: getCurrentTime(),
        status: 'sending'
    };

    if (!personalChats[activeChatPeer.id]) {
        personalChats[activeChatPeer.id] = [];
    }
    personalChats[activeChatPeer.id].push(msgObj);
    renderPersonalChatMessage(msgObj, true);

    socket.send(JSON.stringify({
        type: 'personal_chat_send',
        targetId: activeChatPeer.id,
        msgType: 'text',
        text: text,
        tempId: tempId
    }));
}

function handlePersonalChatMessage(msg) {
    const peerId = (msg.senderId === myId) ? msg.targetId : msg.senderId;

    if (!personalChats[peerId]) {
        personalChats[peerId] = [];
    }
    if (!personalChats[peerId].some(m => m.id === msg.id)) {
        personalChats[peerId].push(msg);
    }

    if (activeChatPeer && activeChatPeer.id === peerId) {
        renderPersonalChatMessage(msg, true);
    } else {
        unreadCounts[peerId] = (unreadCounts[peerId] || 0) + 1;
        updateUserList(groupUsers);
        showToast(`Pesan pribadi baru dari ${msg.senderName}`);
    }
}

function handlePersonalChatSent(msg) {
    if (!activeChatPeer) return;
    const peerId = activeChatPeer.id;
    const chatList = personalChats[peerId] || [];

    const found = chatList.find(m => m.tempId === msg.tempId);
    if (found) {
        found.id = msg.id;
        found.time = msg.time || found.time;
        found.status = msg.offline ? 'offline' : 'sent';
    }

    renderPersonalChatMessage({
        id: msg.id,
        tempId: msg.tempId,
        senderId: myId,
        status: msg.offline ? 'offline' : 'sent',
        offline: !!msg.offline
    }, false);
}

function handlePersonalHistoryRes(msg) {
    const targetId = msg.targetId;
    if (!targetId) return;

    personalChats[targetId] = msg.history || [];

    if (activeChatPeer && activeChatPeer.id === targetId) {
        renderPersonalChatHistory(targetId);
    }
}

async function handlePersonalMediaFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file || !activeChatPeer) return;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        showToast('Server WebSocket belum siap.');
        e.target.value = '';
        return;
    }

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) {
        showToast('Format file tidak didukung. Pilih foto atau video.');
        e.target.value = '';
        return;
    }

    const maxSize = isImage ? uploadConfig.maxImageSize : uploadConfig.maxVideoSize;
    const maxLabel = isImage ? uploadConfig.maxImageSizeLabel : uploadConfig.maxVideoSizeLabel;
    if (file.size > maxSize) {
        showToast(`Ukuran file melebihi batas maksimal ${maxLabel}.`);
        e.target.value = '';
        return;
    }

    const progressWrap = document.getElementById('personal-upload-progress-wrap');
    const progressFill = document.getElementById('personal-upload-progress-fill');
    const progressText = document.getElementById('personal-upload-progress-text');

    if (progressWrap) progressWrap.style.display = 'block';
    if (progressFill) progressFill.style.width = '0%';
    if (progressText) progressText.textContent = `Mengunggah ${isImage ? 'foto' : 'video'}...`;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch('upload.php', { method: 'POST', body: formData });
        const data = await res.json();
        if (progressWrap) progressWrap.style.display = 'none';

        if (res.ok && data.success) {
            const tempId = 'ptemp_' + Date.now();
            const msgObj = {
                id: tempId,
                tempId: tempId,
                senderId: myId,
                senderName: myName,
                targetId: activeChatPeer.id,
                msgType: isImage ? 'image' : 'video',
                fileUrl: data.url,
                fileName: data.fileName,
                fileSize: data.size,
                time: getCurrentTime(),
                status: 'sending'
            };

            if (!personalChats[activeChatPeer.id]) personalChats[activeChatPeer.id] = [];
            personalChats[activeChatPeer.id].push(msgObj);
            renderPersonalChatMessage(msgObj, true);

            socket.send(JSON.stringify({
                type: 'personal_chat_send',
                targetId: activeChatPeer.id,
                msgType: isImage ? 'image' : 'video',
                fileUrl: data.url,
                fileName: data.fileName,
                fileSize: data.size,
                tempId: tempId
            }));
        } else {
            showToast(`Gagal mengunggah: ${data.error || 'Terjadi kesalahan'}`);
        }
    } catch (err) {
        if (progressWrap) progressWrap.style.display = 'none';
        showToast('Gagal mengunggah file ke server.');
    } finally {
        e.target.value = '';
    }
}

async function startPersonalVoiceNote() {
    if (!activeChatPeer) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        showToast('Server WebSocket belum siap.');
        return;
    }
    if (personalMediaRecorder && personalMediaRecorder.state === 'recording') return;

    const md = getMediaDevices();
    if (!md) {
        if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
            alert("Merekam voice note di browser HP memerlukan Konteks Aman (HTTPS).\n\n" +
                  "Solusi cepat di HP Android:\n" +
                  "1. Buka chrome://flags/#unsafely-treat-insecure-origin-as-secure\n" +
                  "2. Masukkan URL: " + window.location.origin + "\n" +
                  "3. Aktifkan (Enabled) lalu Relaunch Chrome HP.\n\n" +
                  "Atau buka via HTTPS dengan sertifikat.");
        } else {
            showToast('Browser tidak mendukung akses mikrofon.');
        }
        return;
    }

    try {
        let stream = null;
        try {
            stream = await md.getUserMedia({ audio: true });
        } catch (e) {
            console.error('Mic access error:', e);
            showToast('Izin mikrofon diperlukan untuk merekam voice note.');
            return;
        }

        personalRecordedAudioChunks = [];

        // Deteksi format audio terbaik yang didukung browser perangkat (Android, iOS Safari, Desktop)
        let options = {};
        const candidates = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/ogg',
            'audio/mp4',
            'audio/aac'
        ];
        for (const cand of candidates) {
            if (window.MediaRecorder && typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(cand)) {
                options = { mimeType: cand };
                break;
            }
        }

        personalMediaRecorder = new MediaRecorder(stream, options);
        personalMediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) personalRecordedAudioChunks.push(e.data);
        };
        personalMediaRecorder.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
        };

        personalMediaRecorder.start(100);
        personalVnRecordingStartTime = Date.now();

        if (personalVnRecorderBar) personalVnRecorderBar.style.display = 'flex';
        if (personalVnTimer) personalVnTimer.textContent = '00:00';
        clearInterval(personalVnRecordingTimerInterval);
        personalVnRecordingTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - personalVnRecordingStartTime) / 1000);
            if (personalVnTimer) personalVnTimer.textContent = formatDuration(elapsed);
        }, 1000);

    } catch (err) {
        console.error('Mic error:', err);
        showToast('Izin mikrofon diperlukan untuk merekam voice note.');
    }
}

function cancelPersonalVoiceNote() {
    if (personalMediaRecorder) {
        personalMediaRecorder.stop();
        personalMediaRecorder = null;
    }
    personalRecordedAudioChunks = [];
    clearInterval(personalVnRecordingTimerInterval);
    if (personalVnRecorderBar) personalVnRecorderBar.style.display = 'none';
    showToast('Rekaman voice note dibatalkan.');
}

async function stopAndSendPersonalVoiceNote() {
    if (!personalMediaRecorder || personalMediaRecorder.state !== 'recording' || !activeChatPeer) return;

    const durationSec = Math.max(1, Math.floor((Date.now() - personalVnRecordingStartTime) / 1000));
    clearInterval(personalVnRecordingTimerInterval);
    if (personalVnRecorderBar) personalVnRecorderBar.style.display = 'none';

    const targetPeerId = activeChatPeer.id;

    personalMediaRecorder.onstop = async () => {
        const mimeType = personalMediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(personalRecordedAudioChunks, { type: mimeType });
        personalRecordedAudioChunks = [];

        if (audioBlob.size <= 0) {
            showToast('Rekaman kosong.');
            return;
        }

        if (audioBlob.size > uploadConfig.maxAudioSize) {
            showToast(`Voice note melebihi batas maksimal ${uploadConfig.maxAudioSizeLabel}.`);
            return;
        }

        const progressWrap = document.getElementById('personal-upload-progress-wrap');
        const progressFill = document.getElementById('personal-upload-progress-fill');
        const progressText = document.getElementById('personal-upload-progress-text');

        if (progressWrap) progressWrap.style.display = 'block';
        if (progressFill) progressFill.style.width = '0%';
        if (progressText) progressText.textContent = 'Mengunggah Voice Note...';

        const actualMime = mimeType.toLowerCase();
        let ext = 'webm';
        if (actualMime.includes('mp4') || actualMime.includes('m4a') || actualMime.includes('aac')) ext = 'm4a';
        else if (actualMime.includes('ogg')) ext = 'ogg';
        else if (actualMime.includes('wav')) ext = 'wav';

        const formData = new FormData();
        formData.append('file', audioBlob, `p_vn_${Date.now()}.${ext}`);

        try {
            const res = await fetch('upload.php', { method: 'POST', body: formData });
            const data = await res.json();
            if (progressWrap) progressWrap.style.display = 'none';

            if (res.ok && data.success) {
                const tempId = 'ptemp_' + Date.now();
                const msgObj = {
                    id: tempId,
                    tempId: tempId,
                    senderId: myId,
                    senderName: myName,
                    targetId: targetPeerId,
                    msgType: 'audio',
                    fileUrl: data.url,
                    fileName: data.fileName,
                    fileSize: data.size,
                    duration: durationSec,
                    time: getCurrentTime(),
                    status: 'sending'
                };

                if (!personalChats[targetPeerId]) personalChats[targetPeerId] = [];
                personalChats[targetPeerId].push(msgObj);
                renderPersonalChatMessage(msgObj, true);

                socket.send(JSON.stringify({
                    type: 'personal_chat_send',
                    targetId: targetPeerId,
                    msgType: 'audio',
                    fileUrl: data.url,
                    fileName: data.fileName,
                    fileSize: data.size,
                    duration: durationSec,
                    tempId: tempId
                }));
            } else {
                showToast(`Gagal mengirim VN: ${data.error || 'Terjadi kesalahan'}`);
            }
        } catch (err) {
            if (progressWrap) progressWrap.style.display = 'none';
            showToast('Gagal mengunggah voice note ke server.');
        }
    };

    personalMediaRecorder.stop();
}

// ── PANGGILAN SUARA PRIBADI (WEBRTC PEER-TO-PEER AUDIO) ──

async function startPersonalCall(targetId, targetName) {
    if (!targetId && activeChatPeer) {
        targetId = activeChatPeer.id;
        targetName = activeChatPeer.name;
    }
    if (!targetId) return;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        showToast('Server WebSocket belum siap.');
        return;
    }
    if (targetId === myId) {
        showToast('Tidak dapat memanggil diri sendiri.');
        return;
    }
    if (inGroupCall) {
        showToast('Tinggalkan panggilan group terlebih dahulu sebelum memulai panggilan personal.');
        return;
    }
    if (personalCallActive || personalCallState !== 'idle') {
        showToast('Anda sedang dalam panggilan atau sedang memanggil.');
        return;
    }

    // Buka kunci elemen audio dari gestur klik pengguna (penting untuk mobile autoplay policy)
    const remoteAudioEl = document.getElementById('personal-remote-audio');
    if (remoteAudioEl) {
        remoteAudioEl.play().catch(() => {});
    }

    const md = getMediaDevices();
    if (!md) {
        const isMobileInsecure = !window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
        if (isMobileInsecure) {
            alert("Akses mikrofon di browser HP diblokir karena halaman dibuka melalui HTTP biasa.\n\n" +
                  "Solusi Cepat untuk HP Android:\n" +
                  "1. Buka tab baru di Chrome HP: chrome://flags/#unsafely-treat-insecure-origin-as-secure\n" +
                  "2. Masukkan URL: " + window.location.origin + "\n" +
                  "3. Ubah menjadi 'Enabled' lalu tekan 'Relaunch'.\n\n" +
                  "Atau buka aplikasi menggunakan HTTPS.");
        } else {
            showToast('Perangkat atau browser tidak mendukung akses mikrofon.');
        }
        return;
    }

    // Minta izin mikrofon terlebih dahulu (dengan fallback jika constraint hardware gagal di HP)
    let stream = null;
    try {
        await unlockAudio();
        stream = await md.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
    } catch (err) {
        console.warn('Advanced audio constraints failed on mobile, retrying with basic audio: true', err);
        try {
            stream = await md.getUserMedia({ audio: true });
        } catch (basicErr) {
            console.error('Mikrofon error:', basicErr);
            const isMobileInsecure = !window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
            if (isMobileInsecure) {
                alert("Browser HP memblokir mikrofon karena halaman dibuka melalui HTTP.\n\n" +
                      "Gunakan HTTPS atau aktifkan flag Chrome Android:\n" +
                      "chrome://flags/#unsafely-treat-insecure-origin-as-secure");
            } else {
                showToast('Izin mikrofon ditolak atau mikrofon tidak tersedia.');
            }
            return;
        }
    }

    personalLocalStream = stream;
    personalCallState = 'calling';
    personalCallPeer = { id: targetId, name: targetName };
    personalCallIsCaller = true;

    if (callingAvatar) callingAvatar.textContent = targetName.charAt(0).toUpperCase();
    if (callingName) callingName.textContent = targetName;
    if (callingStatusLabel) callingStatusLabel.textContent = 'Memanggil...';

    show1on1Panel('calling');

    socket.send(JSON.stringify({
        type: 'personal_call_invite',
        targetId: targetId
    }));
}

// Alias untuk kompatibilitas
function startCall(targetId, targetName) {
    return startPersonalCall(targetId, targetName);
}

function handlePersonalCallRinging(callId, targetId, targetName) {
    personalCallId = callId;
    if (callingStatusLabel) callingStatusLabel.textContent = 'Berdering...';
}

function handlePersonalCallIncoming(callId, fromId, fromName) {
    if (personalCallActive || personalCallState !== 'idle' || inGroupCall) {
        socket.send(JSON.stringify({
            type: 'personal_call_reject',
            targetId: fromId,
            callId: callId
        }));
        return;
    }

    personalCallState = 'incoming';
    personalCallPeer = { id: fromId, name: fromName };
    personalCallId = callId;
    personalCallIsCaller = false;

    if (incomingAvatar) incomingAvatar.textContent = fromName.charAt(0).toUpperCase();
    if (incomingName) incomingName.textContent = fromName;

    show1on1Panel('incoming');
}

function handleIncomingCall(fromId, fromName) {
    handlePersonalCallIncoming(null, fromId, fromName);
}

async function acceptCall() {
    if (personalCallState !== 'incoming' || !personalCallPeer) return;

    // Buka kunci audio dari gestur klik 'Terima'
    const remoteAudioEl = document.getElementById('personal-remote-audio');
    if (remoteAudioEl) {
        remoteAudioEl.play().catch(() => {});
    }

    const md = getMediaDevices();
    if (!md) {
        const isMobileInsecure = !window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
        if (isMobileInsecure) {
            alert("Akses mikrofon di HP memerlukan HTTPS atau flag Chrome:\nchrome://flags/#unsafely-treat-insecure-origin-as-secure");
        } else {
            showToast('Perangkat tidak mendukung akses mikrofon.');
        }
        rejectCall();
        return;
    }

    let stream = null;
    try {
        await unlockAudio();
        stream = await md.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
    } catch (err) {
        console.warn('Advanced constraints failed on mobile, retrying basic audio: true', err);
        try {
            stream = await md.getUserMedia({ audio: true });
        } catch (basicErr) {
            console.error('Mic error:', basicErr);
            showToast('Izin mikrofon ditolak. Panggilan tidak dapat diterima.');
            rejectCall();
            return;
        }
    }

    personalLocalStream = stream;

    socket.send(JSON.stringify({
        type: 'personal_call_accept',
        targetId: personalCallPeer.id,
        callId: personalCallId
    }));
}

function acceptPersonalCall() {
    return acceptCall();
}

function rejectCall() {
    if (personalCallPeer && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'personal_call_reject',
            targetId: personalCallPeer.id,
            callId: personalCallId
        }));
    }
    cleanupPersonalCall();
}

function rejectPersonalCall() {
    return rejectCall();
}

function cancelPersonalCall() {
    if (personalCallPeer && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'personal_call_end',
            targetId: personalCallPeer.id,
            callId: personalCallId
        }));
    }
    cleanupPersonalCall();
}

function cancelCall() {
    return cancelPersonalCall();
}

function endCall(notifyServer = true) {
    if (notifyServer && personalCallPeer && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'personal_call_end',
            targetId: personalCallPeer.id,
            callId: personalCallId
        }));
    }
    cleanupPersonalCall();
}

function endPersonalCall(notifyServer = true) {
    return endCall(notifyServer);
}

async function handlePersonalCallAccepted(callId, peerId, peerName) {
    personalCallId = callId;
    if (peerName && personalCallPeer) personalCallPeer.name = peerName;
    await setupActiveWebRTCCall(true);
}

function handleCallAccepted(peerId, peerName) {
    handlePersonalCallAccepted(null, peerId, peerName);
}

async function handlePersonalCallStarted(callId, peerId, peerName) {
    personalCallId = callId;
    if (peerName && personalCallPeer) personalCallPeer.name = peerName;
    await setupActiveWebRTCCall(false);
}

function handlePersonalCallRejected(byName) {
    showToast(`${byName || 'Lawan bicara'} menolak panggilan.`);
    cleanupPersonalCall();
}

function handlePersonalCallEnded(byName, msg) {
    showToast(msg || `${byName || 'Lawan bicara'} mengakhiri panggilan.`);
    cleanupPersonalCall();
}

function handlePersonalCallError(reason, msg) {
    showToast(msg || 'Panggilan gagal.');
    cleanupPersonalCall();
}

async function setupActiveWebRTCCall(isCaller) {
    personalCallActive = true;
    callActive = true;
    personalCallState = 'active';

    show1on1Panel('active');
    if (activePeerName && personalCallPeer) activePeerName.textContent = personalCallPeer.name;
    if (activeAvatar && personalCallPeer) activeAvatar.textContent = personalCallPeer.name.charAt(0).toUpperCase();
    if (remoteWaveLabel && personalCallPeer) remoteWaveLabel.textContent = personalCallPeer.name;

    start1on1CallTimer();
    updatePersonalMicUI();
    updatePersonalVolUI();

    try {
        personalPC = new RTCPeerConnection(rtcConfig);

        // Tambahkan track audio lokal ke Peer Connection
        if (personalLocalStream) {
            personalLocalStream.getAudioTracks().forEach(track => {
                personalPC.addTrack(track, personalLocalStream);
            });
            setupPersonalLocalAnalyser(personalLocalStream);
        }

        // Pertukaran ICE candidate WebRTC melalui WebSocket
        personalPC.onicecandidate = (event) => {
            if (event.candidate && personalCallPeer) {
                socket.send(JSON.stringify({
                    type: 'personal_webrtc_signal',
                    targetId: personalCallPeer.id,
                    signal: { candidate: event.candidate }
                }));
            }
        };

        // Tangani track audio remote yang diterima dari lawan bicara (dengan fallback Web Audio API untuk HP)
        personalPC.ontrack = (event) => {
            const remoteStream = event.streams[0];
            const remoteAudio = document.getElementById('personal-remote-audio');
            if (remoteAudio) {
                remoteAudio.srcObject = remoteStream;
                const p = remoteAudio.play();
                if (p !== undefined) {
                    p.catch(err => {
                        console.warn('Audio play() failed on mobile, connecting to AudioContext destination:', err);
                        try {
                            if (personalAudioCtx && personalAudioCtx.state === 'running') {
                                const src = personalAudioCtx.createMediaStreamSource(remoteStream);
                                src.connect(personalAudioCtx.destination);
                            }
                        } catch (ctxErr) {
                            console.warn('AudioContext fallback error:', ctxErr);
                        }
                    });
                }
            }
            setupPersonalRemoteAnalyser(remoteStream);
        };

        startPersonalWaveforms();

        // Pemanggil (caller) membuat offer WebRTC
        if (isCaller) {
            const offer = await personalPC.createOffer();
            await personalPC.setLocalDescription(offer);
            socket.send(JSON.stringify({
                type: 'personal_webrtc_signal',
                targetId: personalCallPeer.id,
                signal: { sdp: personalPC.localDescription }
            }));
        }

        showToast(`Panggilan suara tersambung dengan ${personalCallPeer.name}`);
    } catch (err) {
        console.error('WebRTC setup error:', err);
        showToast('Gagal menghubungkan audio WebRTC: ' + err.message);
        endCall();
    }
}

async function handlePersonalWebRTCSignal(fromId, signal) {
    if (!signal) return;

    try {
        if (!personalPC) {
            await setupActiveWebRTCCall(false);
        }

        if (signal.sdp) {
            if (signal.sdp.type === 'offer') {
                await personalPC.setRemoteDescription(new RTCSessionDescription(signal.sdp));

                // Kuras antrean candidate yang tiba sebelum remote description siap
                while (personalIceCandidatesQueue.length > 0) {
                    const queuedCand = personalIceCandidatesQueue.shift();
                    try {
                        await personalPC.addIceCandidate(new RTCIceCandidate(queuedCand));
                    } catch (e) {
                        console.warn('Error adding queued ICE candidate:', e);
                    }
                }

                const answer = await personalPC.createAnswer();
                await personalPC.setLocalDescription(answer);
                socket.send(JSON.stringify({
                    type: 'personal_webrtc_signal',
                    targetId: fromId,
                    signal: { sdp: personalPC.localDescription }
                }));
            } else if (signal.sdp.type === 'answer') {
                await personalPC.setRemoteDescription(new RTCSessionDescription(signal.sdp));

                // Kuras antrean candidate yang tiba sebelum remote description siap
                while (personalIceCandidatesQueue.length > 0) {
                    const queuedCand = personalIceCandidatesQueue.shift();
                    try {
                        await personalPC.addIceCandidate(new RTCIceCandidate(queuedCand));
                    } catch (e) {
                        console.warn('Error adding queued ICE candidate:', e);
                    }
                }
            }
        } else if (signal.candidate) {
            if (personalPC && personalPC.remoteDescription && personalPC.remoteDescription.type) {
                try {
                    await personalPC.addIceCandidate(new RTCIceCandidate(signal.candidate));
                } catch (e) {
                    console.warn('Personal addIceCandidate error:', e);
                }
            } else {
                personalIceCandidatesQueue.push(signal.candidate);
            }
        }
    } catch (err) {
        console.error('Personal WebRTC signal error:', err);
    }
}

function toggleMute() {
    if (!personalCallActive || !personalLocalStream) return;
    personalIsMuted = !personalIsMuted;
    personalLocalStream.getAudioTracks().forEach(track => {
        track.enabled = !personalIsMuted;
    });

    if (personalCallPeer && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'personal_mic_status',
            targetId: personalCallPeer.id,
            isMuted: personalIsMuted
        }));
    }

    updatePersonalMicUI();
    showToast(personalIsMuted ? 'Mikrofon dimatikan (Muted)' : 'Mikrofon aktif');
}

function updatePersonalMicUI() {
    if (muteBtn) {
        if (personalIsMuted) {
            muteBtn.classList.add('active');
            if (micIconOn) micIconOn.style.display = 'none';
            if (micIconOff) micIconOff.style.display = 'block';
            const span = muteBtn.querySelector('span');
            if (span) span.textContent = 'Unmute';
        } else {
            muteBtn.classList.remove('active');
            if (micIconOn) micIconOn.style.display = 'block';
            if (micIconOff) micIconOff.style.display = 'none';
            const span = muteBtn.querySelector('span');
            if (span) span.textContent = 'Mute';
        }
    }
}

function handlePersonalMicStatus(fromId, isMuted) {
    if (personalCallPeer && personalCallPeer.id === fromId && remoteWaveLabel) {
        remoteWaveLabel.textContent = isMuted ? `${personalCallPeer.name} (Muted)` : personalCallPeer.name;
    }
}

function toggleVolume() {
    personalIsDeafened = !personalIsDeafened;
    const remoteAudio = document.getElementById('personal-remote-audio');
    if (remoteAudio) {
        remoteAudio.muted = personalIsDeafened;
    }
    updatePersonalVolUI();
    showToast(personalIsDeafened ? 'Speaker dimatikan' : 'Speaker aktif');
}

function updatePersonalVolUI() {
    if (volBtn) {
        if (personalIsDeafened) {
            volBtn.classList.add('active');
            if (volIconOn) volIconOn.style.display = 'none';
            if (volIconOff) volIconOff.style.display = 'block';
        } else {
            volBtn.classList.remove('active');
            if (volIconOn) volIconOn.style.display = 'block';
            if (volIconOff) volIconOff.style.display = 'none';
        }
    }
}

function show1on1Panel(panelName) {
    if (groupView) { groupView.classList.remove('active'); groupView.style.display = 'none'; }
    if (personalView) { personalView.classList.remove('active'); personalView.style.display = 'none'; }
    hideAllCallPanels();
    appScreen.classList.add('in-call');

    if (panelName === 'calling') callingPanel.classList.add('active');
    else if (panelName === 'incoming') incomingPanel.classList.add('active');
    else if (panelName === 'active') activeCallPanel.classList.add('active');
}

function hideAllCallPanels() {
    [callingPanel, incomingPanel, activeCallPanel].forEach(p => {
        if (p) p.classList.remove('active');
    });
}

function cleanupPersonalCall() {
    personalCallActive = false;
    personalCallState = 'idle';
    callActive = false;
    currentPeer = null;
    pendingIncoming = null;
    personalIceCandidatesQueue = [];

    if (personalLocalStream) {
        personalLocalStream.getTracks().forEach(t => t.stop());
        personalLocalStream = null;
    }

    if (personalPC) {
        try { personalPC.close(); } catch (_) {}
        personalPC = null;
    }

    const remoteAudio = document.getElementById('personal-remote-audio');
    if (remoteAudio) {
        remoteAudio.srcObject = null;
    }

    stop1on1CallTimer();
    if (personalAnimFrameId) {
        cancelAnimationFrame(personalAnimFrameId);
        personalAnimFrameId = null;
    }
    resetWaveforms();

    hideAllCallPanels();
    appScreen.classList.remove('in-call');

    personalCallPeer = null;
    personalCallId = null;
    personalCallIsCaller = false;
    personalIsMuted = false;
    personalIsDeafened = false;
    updatePersonalMicUI();
    updatePersonalVolUI();

    // Kembali ke personal view jika sedang ada chat terbuka, atau ke group view
    if (activeChatPeer) {
        appScreen.classList.add('in-personal-chat');
        if (groupView) { groupView.classList.remove('active'); groupView.style.display = 'none'; }
        if (personalView) { personalView.classList.add('active'); personalView.style.display = 'flex'; }
    } else {
        appScreen.classList.remove('in-personal-chat');
        switchToGroupView();
    }
}

function teardownAudio() {
    cleanupPersonalCall();
}

function start1on1CallTimer() {
    personalCallStartTime = Date.now();
    if (callTimer) callTimer.textContent = '00:00';
    clearInterval(personalCallTimerInterval);
    personalCallTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - personalCallStartTime) / 1000);
        if (callTimer) callTimer.textContent = formatDuration(elapsed);
    }, 1000);
}

function stop1on1CallTimer() {
    clearInterval(personalCallTimerInterval);
    personalCallTimerInterval = null;
    if (callTimer) callTimer.textContent = '00:00';
}

function setupPersonalLocalAnalyser(stream) {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!personalAudioCtx || personalAudioCtx.state === 'closed') {
            personalAudioCtx = new AudioCtx();
        }
        personalLocalAnalyser = personalAudioCtx.createAnalyser();
        personalLocalAnalyser.fftSize = 64;
        const source = personalAudioCtx.createMediaStreamSource(stream);
        source.connect(personalLocalAnalyser);
    } catch (e) {
        console.warn('Local analyser error:', e);
    }
}

function setupPersonalRemoteAnalyser(stream) {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!personalAudioCtx || personalAudioCtx.state === 'closed') {
            personalAudioCtx = new AudioCtx();
        }
        personalRemoteAnalyser = personalAudioCtx.createAnalyser();
        personalRemoteAnalyser.fftSize = 64;
        const source = personalAudioCtx.createMediaStreamSource(stream);
        source.connect(personalRemoteAnalyser);
    } catch (e) {
        console.warn('Remote analyser error:', e);
    }
}

function startPersonalWaveforms() {
    const localBars = waveformLocal ? waveformLocal.querySelectorAll('span') : [];
    const remoteBars = waveformRemote ? waveformRemote.querySelectorAll('span') : [];
    const localData = new Uint8Array(32);
    const remoteData = new Uint8Array(32);

    function update() {
        if (!personalCallActive) return;

        if (personalLocalAnalyser && !personalIsMuted) {
            personalLocalAnalyser.getByteFrequencyData(localData);
            localBars.forEach((bar, idx) => {
                const val = (localData[idx % localData.length] / 255) * 45;
                bar.style.height = `${Math.max(6, val)}px`;
            });
        } else {
            localBars.forEach(b => b.style.height = '6px');
        }

        if (personalRemoteAnalyser && !personalIsDeafened) {
            personalRemoteAnalyser.getByteFrequencyData(remoteData);
            remoteBars.forEach((bar, idx) => {
                const val = (remoteData[idx % remoteData.length] / 255) * 45;
                bar.style.height = `${Math.max(6, val)}px`;
            });
        } else {
            remoteBars.forEach(b => b.style.height = '6px');
        }

        personalAnimFrameId = requestAnimationFrame(update);
    }

    personalAnimFrameId = requestAnimationFrame(update);
}

function resetWaveforms() {
    if (waveformLocal) {
        waveformLocal.querySelectorAll('span').forEach(b => b.style.height = '8px');
    }
    if (waveformRemote) {
        waveformRemote.querySelectorAll('span').forEach(b => b.style.height = '8px');
    }
}

function updateServerReadyUI(ready) {
    if (personalCallBtn) {
        if (!ready) {
            personalCallBtn.disabled = true;
            personalCallBtn.title = 'Server sedang offline';
        } else if (activeChatPeer) {
            const isOnline = groupUsers.some(u => u.id === activeChatPeer.id);
            personalCallBtn.disabled = !isOnline;
            personalCallBtn.title = isOnline ? 'Panggil Suara Personal (WebRTC P2P)' : 'Pengguna sedang offline';
        }
    }
    if (personalChatSendBtn) personalChatSendBtn.disabled = !ready;
    const chatSendBtn = document.getElementById('chat-send-btn');
    if (chatSendBtn) chatSendBtn.disabled = !ready;
    const startGcBtn = document.getElementById('start-gc-btn');
    if (startGcBtn) startGcBtn.disabled = !ready;
    const joinGcBtn = document.getElementById('join-gc-btn');
    if (joinGcBtn && !groupCallState.active) joinGcBtn.disabled = !ready;
}

// Fallback untuk memutar audio PCM lawas jika masih ada pesan format audio lama
function playReceivedAudioChunk(base64Data, remoteRate) {
    // Dipertahankan sebagai fallback no-op/graceful
}

// ── UTILITY HELPERS ──

function scrollChatToBottom() {
    requestAnimationFrame(() => {
        if (chatMessagesArea) {
            chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight;
        }
    });
}

function getMediaDevices() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        return navigator.mediaDevices;
    }
    const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
    if (legacy) {
        return {
            getUserMedia: (constraints) => new Promise((resolve, reject) => legacy.call(navigator, constraints, resolve, reject))
        };
    }
    return null;
}

async function unlockAudio() {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!audioCtx || audioCtx.state === 'closed') {
            audioCtx = new AudioContextClass();
        }
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }
    } catch (e) {
        console.warn('AudioContext unlock warning:', e);
    }
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast.timeout);
    toast.timeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3200);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getCurrentTime() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

function formatDuration(seconds) {
    const s = Math.floor(seconds || 0);
    const mins = String(Math.floor(s / 60)).padStart(2, '0');
    const secs = String(s % 60).padStart(2, '0');
    return `${mins}:${secs}`;
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

// Global exports untuk inline onclick handlers
window.showMobileMembersView = showMobileMembersView;
window.toggleTheme = toggleTheme;
window.switchToGroupView = switchToGroupView;
window.requestCommunityMembers = requestCommunityMembers;
window.closeCommunityMembers = closeCommunityMembers;
window.openPersonalChat = openPersonalChat;
window.startPersonalCall = startPersonalCall;
window.acceptCall = acceptCall;
window.rejectCall = rejectCall;
window.endPersonalCall = endPersonalCall;

