/**
 * VoiceLink - Full Duplex Voice Chat Client
 * Uses Web Audio API & WebSockets for ultra-low latency bidirectional audio streaming
 */

// --- State Variables ---
let socket = null;
let myId = 'user_' + Math.random().toString(36).substr(2, 6);
let myName = '';
let currentPeer = null;       // { id, name }
let pendingIncoming = null;   // { fromId, fromName }

let callActive = false;
let isMuted = false;
let isDeafened = false;

// Audio Context & Streaming
let audioCtx = null;
let micStream = null;
let micSource = null;
let scriptProcessor = null;
let localAnalyser = null;
let remoteGainNode = null;
let nextPlayTime = 0;
let callStartTime = null;
let callTimerInterval = null;
let animFrameId = null;

const SAMPLE_RATE = 16000; // 16kHz mono audio for fast network transmission

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

// Panels
const idlePanel = document.getElementById('idle-panel');
const callingPanel = document.getElementById('calling-panel');
const incomingPanel = document.getElementById('incoming-panel');
const activeCallPanel = document.getElementById('active-call-panel');

const callingName = document.getElementById('calling-name');
const callingAvatar = document.getElementById('calling-avatar');
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

// --- WebSocket Connection ---
function initWebSocket() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
    }

    let host = window.location.hostname || '127.0.0.1';
    // On Windows, localhost often resolves to IPv6 (::1) which fails with AF_INET PHP sockets. Force 127.0.0.1 on local PC.
    if (host === 'localhost') {
        host = '127.0.0.1';
    }

    const wsUrl = window.location.protocol === 'https:'
        ? `wss://${window.location.host}/voice-ws`
        : `ws://${host}:8765`;
    if (wsStatusText) wsStatusText.textContent = `Menghubungkan ke ${wsUrl}...`;
    if (wsStatusDot) wsStatusDot.className = 'dot connecting';

    try {
        socket = new WebSocket(wsUrl);
    } catch (e) {
        console.error('Failed to create WebSocket:', e);
        if (wsStatusText) wsStatusText.textContent = `Gagal terhubung (${wsUrl})`;
        if (wsStatusDot) wsStatusDot.className = 'dot disconnected';
        return;
    }

    socket.onopen = () => {
        if (wsStatusText) wsStatusText.textContent = `Server Online (${wsUrl})`;
        if (wsStatusDot) wsStatusDot.className = 'dot connected';
        showToast('Terhubung ke WebSocket Server');
        
        // If already logged in, re-register
        if (myName) {
            socket.send(JSON.stringify({
                type: 'register',
                id: myId,
                name: myName
            }));
        }
    };

    socket.onclose = () => {
        if (wsStatusText) wsStatusText.textContent = `Server Offline (${wsUrl})`;
        if (wsStatusDot) wsStatusDot.className = 'dot disconnected';
        if (callActive) {
            endCall(false);
        }
        setTimeout(initWebSocket, 3000);
    };

    socket.onerror = (err) => {
        console.warn('WebSocket error:', err);
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

// Ensure startup runs regardless of whether DOMContentLoaded has already fired
function boot() {
    initWebSocket();
    if (usernameInput) {
        usernameInput.focus();
        usernameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') joinApp();
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}

// --- Join Application ---
function joinApp() {
    const name = usernameInput.value.trim();
    if (!name) {
        showToast('Masukkan nama Anda terlebih dahulu');
        usernameInput.focus();
        return;
    }

    unlockAudio(); // User interaction: prepare AudioContext early

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        if (socket && socket.readyState === WebSocket.CONNECTING) {
            showToast('Sedang menghubungkan ke server, mohon tunggu sebentar...');
        } else {
            showToast('Menghubungkan ke server...');
            initWebSocket();
        }
        return;
    }

    myName = name;
    socket.send(JSON.stringify({
        type: 'register',
        id: myId,
        name: myName
    }));

    // Update profile in sidebar
    myAvatar.textContent = myName.charAt(0).toUpperCase();
    myNameDisplay.textContent = myName;
    myIdDisplay.textContent = `#${myId}`;

    loginScreen.classList.remove('active');
    appScreen.classList.add('active');
    showPanel('idle');
}

// --- Socket Message Handling ---
function handleSocketMessage(msg) {
    switch (msg.type) {
        case 'user_list':
            updateUserList(msg.users);
            break;

        case 'registered':
            myId = msg.id;
            myIdDisplay.textContent = `#${myId}`;
            break;

        case 'incoming_call':
            handleIncomingCall(msg.fromId, msg.fromName);
            break;

        case 'call_accepted':
            handleCallAccepted(msg.fromId, msg.fromName);
            break;

        case 'call_started':
            // For receiver
            handleCallAccepted(msg.peerId, msg.peerName);
            break;

        case 'call_rejected':
            showToast(`${msg.byName || 'Penerima'} menolak panggilan.`);
            showPanel('idle');
            currentPeer = null;
            break;

        case 'call_ended':
            showToast('Panggilan telah diakhiri lawan bicara.');
            teardownAudio();
            showPanel('idle');
            currentPeer = null;
            pendingIncoming = null;
            break;

        case 'peer_disconnected':
            showToast('Lawan bicara terputus.');
            teardownAudio();
            showPanel('idle');
            currentPeer = null;
            pendingIncoming = null;
            break;

        case 'audio':
            if (callActive && !isDeafened) {
                playReceivedAudioChunk(msg.data, msg.rate);
            }
            break;

        case 'error':
            showToast(msg.msg || 'Terjadi kesalahan');
            break;
    }
}

// --- User List Management ---
function updateUserList(users) {
    userListEl.innerHTML = '';
    const otherUsers = (users || []).filter(u => u.id !== myId);

    if (otherUsers.length === 0) {
        userListEl.innerHTML = '<div class="empty-list">Belum ada user lain online.<br><small style="color:var(--text-muted);opacity:0.7">Buka tab baru untuk tes!</small></div>';
        return;
    }

    otherUsers.forEach(user => {
        const item = document.createElement('div');
        item.className = 'user-item';
        item.innerHTML = `
            <div class="u-avatar">${escapeHtml(user.name.charAt(0).toUpperCase())}</div>
            <div class="u-info">
                <div class="u-name">${escapeHtml(user.name)}</div>
                <div class="u-status">Online</div>
            </div>
            <button class="call-user-btn" title="Panggil ${escapeHtml(user.name)}">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
                </svg>
            </button>
        `;

        item.addEventListener('click', () => {
            if (callActive) {
                showToast('Anda sedang berada dalam panggilan.');
                return;
            }
            startCall(user.id, user.name);
        });

        userListEl.appendChild(item);
    });
}

// Helper to safely get mediaDevices across browsers and environments
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

// Unlock audio context on user interaction (tap / click)
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

// --- Call Flow ---
async function startCall(targetId, targetName) {
    if (callActive || currentPeer) {
        showToast('Anda sedang dalam panggilan atau sedang memanggil.');
        return;
    }
    await unlockAudio();
    currentPeer = { id: targetId, name: targetName };
    callingName.textContent = targetName;
    callingAvatar.textContent = targetName.charAt(0).toUpperCase();
    showPanel('calling');

    socket.send(JSON.stringify({
        type: 'call',
        targetId: targetId
    }));
}

function cancelCall() {
    if (currentPeer) {
        socket.send(JSON.stringify({
            type: 'end_call',
            targetId: currentPeer.id
        }));
    }
    currentPeer = null;
    showPanel('idle');
}

function handleIncomingCall(fromId, fromName) {
    if (callActive) {
        // Busy - reject automatically
        socket.send(JSON.stringify({
            type: 'reject_call',
            targetId: fromId
        }));
        return;
    }

    pendingIncoming = { id: fromId, name: fromName };
    incomingName.textContent = fromName;
    incomingAvatar.textContent = fromName.charAt(0).toUpperCase();
    showPanel('incoming');
}

async function acceptCall() {
    if (!pendingIncoming) return;
    await unlockAudio();
    currentPeer = { ...pendingIncoming };
    pendingIncoming = null;

    socket.send(JSON.stringify({
        type: 'accept_call',
        targetId: currentPeer.id
    }));

    beginActiveCall();
}

function rejectCall() {
    if (pendingIncoming) {
        socket.send(JSON.stringify({
            type: 'reject_call',
            targetId: pendingIncoming.id
        }));
        pendingIncoming = null;
    }
    showPanel('idle');
}

function handleCallAccepted(peerId, peerName) {
    currentPeer = { id: peerId, name: peerName };
    beginActiveCall();
}

async function beginActiveCall() {
    showPanel('active');
    activePeerName.textContent = currentPeer.name;
    activeAvatar.textContent = currentPeer.name.charAt(0).toUpperCase();
    remoteWaveLabel.textContent = currentPeer.name;

    callActive = true;
    startCallTimer();

    try {
        await setupAudioPipeline();
        showToast(`Terhubung dengan ${currentPeer.name}!`);
    } catch (err) {
        console.error('Audio capture error:', err);
        showToast('Mikrofon tidak aktif: ' + err.message);
        // Do not force endCall() so users can still hear incoming audio or troubleshoot!
    }
}

function endCall(notifyServer = true) {
    if (notifyServer && currentPeer && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'end_call',
            targetId: currentPeer.id
        }));
    }

    teardownAudio();
    currentPeer = null;
    pendingIncoming = null;
    showPanel('idle');
}

// --- Audio Pipeline (Full Duplex Streaming) ---
async function setupAudioPipeline() {
    // 1. Initialize AudioContext
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!audioCtx || audioCtx.state === 'closed') {
        audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }

    nextPlayTime = audioCtx.currentTime;

    // Gain node for remote audio
    if (!remoteGainNode) {
        remoteGainNode = audioCtx.createGain();
        remoteGainNode.gain.value = 1.0;
        remoteGainNode.connect(audioCtx.destination);
    }

    // 2. Check mediaDevices support
    const md = getMediaDevices();
    if (!md) {
        const isSecure = window.isSecureContext;
        const msg = !isSecure 
            ? 'Browser HP memblokir mic pada HTTP biasa. Buka chrome://flags di HP dan aktifkan unsafely-treat-insecure-origin-as-secure untuk IP ini.'
            : 'Perangkat atau browser ini tidak mendukung akses mikrofon.';
        alert(msg);
        throw new Error(msg);
    }

    // 3. Request User Microphone (WITHOUT rigid sampleRate to avoid mobile OverconstrainedError)
    micStream = await md.getUserMedia({
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        },
        video: false
    });

    // 4. Connect microphone to Analyser for local visualization
    micSource = audioCtx.createMediaStreamSource(micStream);
    localAnalyser = audioCtx.createAnalyser();
    localAnalyser.fftSize = 64;
    micSource.connect(localAnalyser);

    // 5. Capture raw PCM samples using ScriptProcessorNode
    const bufferSize = 2048;
    scriptProcessor = audioCtx.createScriptProcessor(bufferSize, 1, 1);

    scriptProcessor.onaudioprocess = (e) => {
        if (!callActive || isMuted || !currentPeer) return;

        const inputData = e.inputBuffer.getChannelData(0);
        // Convert Float32 to Int16 PCM
        const int16Buffer = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
            let s = Math.max(-1, Math.min(1, inputData[i]));
            int16Buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Convert to Base64 to transmit safely over WebSocket frame
        const base64Data = arrayBufferToBase64(int16Buffer.buffer);
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'audio',
                targetId: currentPeer.id,
                data: base64Data,
                rate: audioCtx.sampleRate
            }));
        }
    };

    micSource.connect(scriptProcessor);

    // Mute local feedback to prevent echo/feedback loops
    const zeroGain = audioCtx.createGain();
    zeroGain.gain.value = 0;
    scriptProcessor.connect(zeroGain);
    zeroGain.connect(audioCtx.destination);

    startWaveformVisualizer();
}

// Play received PCM audio seamlessly
function playReceivedAudioChunk(base64Data, remoteRate) {
    if (!audioCtx || audioCtx.state === 'closed') return;

    try {
        const rawBytes = base64ToArrayBuffer(base64Data);
        const int16Array = new Int16Array(rawBytes);
        const float32Array = new Float32Array(int16Array.length);

        // Convert Int16 back to Float32
        for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
        }

        // Create AudioBuffer with correct sample rate
        const rate = remoteRate || audioCtx.sampleRate || 16000;
        const audioBuffer = audioCtx.createBuffer(1, float32Array.length, rate);
        audioBuffer.copyToChannel(float32Array, 0);

        // Schedule playback sequentially to prevent overlap and stutter
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;

        if (!remoteGainNode) {
            remoteGainNode = audioCtx.createGain();
            remoteGainNode.gain.value = isDeafened ? 0 : 1.0;
            remoteGainNode.connect(audioCtx.destination);
        }
        source.connect(remoteGainNode);

        const currentTime = audioCtx.currentTime;
        if (nextPlayTime < currentTime) {
            nextPlayTime = currentTime + 0.02; // Small buffer headroom (20ms)
        } else if (nextPlayTime > currentTime + 0.12) {
            // Buffer drift correction: prevent permanent audio delay build-up
            nextPlayTime = currentTime + 0.03;
        }

        source.start(nextPlayTime);
        nextPlayTime += audioBuffer.duration;

        // Visual animation for remote wave
        animateRemoteBars(float32Array);
    } catch (e) {
        console.error('Error playing remote audio:', e);
    }
}

function teardownAudio() {
    callActive = false;
    stopCallTimer();

    if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }

    if (scriptProcessor) {
        scriptProcessor.disconnect();
        scriptProcessor = null;
    }
    if (micSource) {
        micSource.disconnect();
        micSource = null;
    }
    if (micStream) {
        micStream.getTracks().forEach(t => t.stop());
        micStream = null;
    }
    if (remoteGainNode) {
        remoteGainNode.disconnect();
        remoteGainNode = null;
    }

    resetWaveforms();
}

// --- Waveform Visualizer ---
function startWaveformVisualizer() {
    const localBars = waveformLocal.querySelectorAll('span');
    const dataArray = new Uint8Array(localAnalyser.frequencyBinCount);

    function update() {
        if (!callActive) return;

        localAnalyser.getByteFrequencyData(dataArray);

        // Update local bars
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        let avg = sum / dataArray.length;

        localBars.forEach((bar, idx) => {
            if (isMuted) {
                bar.style.height = '6px';
            } else {
                const val = (dataArray[idx % dataArray.length] / 255) * 45;
                bar.style.height = `${Math.max(6, val)}px`;
            }
        });

        animFrameId = requestAnimationFrame(update);
    }

    animFrameId = requestAnimationFrame(update);
}

function animateRemoteBars(samples) {
    if (!waveformRemote) return;
    const remoteBars = waveformRemote.querySelectorAll('span');

    // Calculate RMS amplitude
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
        sum += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sum / samples.length);
    const normalized = Math.min(1, rms * 4); // boost factor

    remoteBars.forEach((bar, idx) => {
        const jitter = Math.sin(Date.now() / 80 + idx) * 0.3 + 0.7;
        const height = Math.max(6, normalized * jitter * 48);
        bar.style.height = `${height}px`;
    });
}

function resetWaveforms() {
    if (waveformLocal) {
        waveformLocal.querySelectorAll('span').forEach(b => b.style.height = '8px');
    }
    if (waveformRemote) {
        waveformRemote.querySelectorAll('span').forEach(b => b.style.height = '8px');
    }
}

// --- Controls (Mute / Volume) ---
function toggleMute() {
    isMuted = !isMuted;
    if (isMuted) {
        muteBtn.classList.add('active');
        micIconOn.style.display = 'none';
        micIconOff.style.display = 'block';
        muteBtn.querySelector('span').textContent = 'Unmute';
        showToast('Mikrofon dimatikan (Muted)');
    } else {
        muteBtn.classList.remove('active');
        micIconOn.style.display = 'block';
        micIconOff.style.display = 'none';
        muteBtn.querySelector('span').textContent = 'Mute';
        showToast('Mikrofon aktif');
    }
}

function toggleVolume() {
    isDeafened = !isDeafened;
    if (remoteGainNode) {
        remoteGainNode.gain.value = isDeafened ? 0 : 1;
    }
    if (isDeafened) {
        volBtn.classList.add('active');
        volIconOn.style.display = 'none';
        volIconOff.style.display = 'block';
        showToast('Speaker dimatikan');
    } else {
        volBtn.classList.remove('active');
        volIconOn.style.display = 'block';
        volIconOff.style.display = 'none';
        showToast('Speaker aktif');
    }
}

// --- Call Timer ---
function startCallTimer() {
    callStartTime = Date.now();
    callTimer.textContent = '00:00';
    clearInterval(callTimerInterval);
    callTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        callTimer.textContent = `${mins}:${secs}`;
    }, 1000);
}

function stopCallTimer() {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
    callTimer.textContent = '00:00';
}

// --- Helpers ---
function showPanel(panelName) {
    [idlePanel, callingPanel, incomingPanel, activeCallPanel].forEach(p => p.classList.remove('active'));
    if (panelName === 'idle') {
        idlePanel.classList.add('active');
        appScreen.classList.remove('in-call');
    } else {
        appScreen.classList.add('in-call');
        if (panelName === 'calling') callingPanel.classList.add('active');
        else if (panelName === 'incoming') incomingPanel.classList.add('active');
        else if (panelName === 'active') activeCallPanel.classList.add('active');
    }
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast.timeout);
    toast.timeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3200);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
