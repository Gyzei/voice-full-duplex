<?php
/**
 * VoiceLink - Konfigurasi Aplikasi & Media Upload
 */

return [
    // WebSocket Server Configuration
    // Bind ke '0.0.0.0' agar server mendengarkan di semua antarmuka jaringan (Loopback & LAN IP untuk HP/perangkat lain)
    'ws_bind_host' => '0.0.0.0',
    'ws_port' => 8765,

    // Group Call Configuration
    'group_call' => [
        'min_participants' => 2,
        'max_participants_limit' => 6, // Nilai absolut maksimum yang diizinkan sistem
        'default_participants' => 6,
    ],

    // Personal Chat Configuration
    'personal_chat' => [
        'max_history_per_pair' => 50, // Batas maksimal pesan riwayat per pasangan pengguna
    ],

    // Upload & Media Configuration
    'uploads' => [
        'directory' => __DIR__ . '/uploads',
        'url_prefix' => 'uploads/',
        'max_image_size' => 10 * 1024 * 1024, // 10 MB
        'max_video_size' => 30 * 1024 * 1024, // 30 MB
        'max_audio_size' => 10 * 1024 * 1024, // 10 MB

        // MIME types dan ekstensi yang diizinkan
        'allowed_types' => [
            'image' => [
                'mimes' => ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
                'extensions' => ['jpg', 'jpeg', 'png', 'gif', 'webp']
            ],
            'video' => [
                'mimes' => ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
                'extensions' => ['mp4', 'webm', 'ogv', 'mov']
            ],
            'audio' => [
                'mimes' => ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/mpeg', 'audio/x-m4a', 'audio/aac'],
                'extensions' => ['webm', 'ogg', 'm4a', 'wav', 'mp3', 'aac']
            ]
        ],

        // Ekstensi berbahaya yang mutlak dilarang
        'forbidden_extensions' => [
            'php', 'php3', 'php4', 'php5', 'phtml', 'phps', 'phar',
            'exe', 'bat', 'cmd', 'sh', 'cgi', 'pl', 'py', 'js', 'jar',
            'html', 'htm', 'svg', 'vbs', 'ps1', 'dll', 'com'
        ]
    ]
];
