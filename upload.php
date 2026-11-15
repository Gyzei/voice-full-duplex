<?php
/**
 * VoiceLink - Endpoint Upload Media (Gambar, Video, Voice Note)
 */

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

$config = require __DIR__ . '/config.php';
$uploadCfg = $config['uploads'];

// Endpoint GET: Mengambil konfigurasi batas ukuran untuk antarmuka browser
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo json_encode([
        'success' => true,
        'config' => [
            'maxImageSize' => $uploadCfg['max_image_size'],
            'maxVideoSize' => $uploadCfg['max_video_size'],
            'maxAudioSize' => $uploadCfg['max_audio_size'],
            'maxImageSizeLabel' => round($uploadCfg['max_image_size'] / (1024 * 1024)) . ' MB',
            'maxVideoSizeLabel' => round($uploadCfg['max_video_size'] / (1024 * 1024)) . ' MB',
            'maxAudioSizeLabel' => round($uploadCfg['max_audio_size'] / (1024 * 1024)) . ' MB',
            'allowedExtensions' => [
                'image' => $uploadCfg['allowed_types']['image']['extensions'],
                'video' => $uploadCfg['allowed_types']['video']['extensions'],
                'audio' => $uploadCfg['allowed_types']['audio']['extensions'],
            ]
        ]
    ]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Metode HTTP tidak diizinkan. Gunakan POST.']);
    exit;
}

if (empty($_FILES['file'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Tidak ada file yang diunggah.']);
    exit;
}

$file = $_FILES['file'];

// Periksa error upload PHP
if ($file['error'] !== UPLOAD_ERR_OK) {
    $errorMessages = [
        UPLOAD_ERR_INI_SIZE   => 'Ukuran file melebihi batas upload_max_filesize pada php.ini server.',
        UPLOAD_ERR_FORM_SIZE  => 'Ukuran file melebihi batas form HTML.',
        UPLOAD_ERR_PARTIAL    => 'File hanya terunggah sebagian. Silakan coba lagi.',
        UPLOAD_ERR_NO_FILE    => 'Tidak ada file yang dipilih.',
        UPLOAD_ERR_NO_TMP_DIR => 'Folder temporary server tidak ditemukan.',
        UPLOAD_ERR_CANT_WRITE => 'Gagal menulis file ke disk server.',
        UPLOAD_ERR_EXTENSION  => 'Ekstensi PHP menghentikan proses upload file.',
    ];
    $msg = $errorMessages[$file['error']] ?? 'Terjadi kesalahan saat mengunggah file (kode ' . $file['error'] . ').';
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $msg]);
    exit;
}

$tmpPath = $file['tmp_name'];
$originalName = (string)$file['name'];
$fileSize = (int)$file['size'];

if ($fileSize <= 0 || !is_uploaded_file($tmpPath)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'File upload tidak valid atau kosong.']);
    exit;
}

// Dapatkan ekstensi dari nama asli file
$pathInfo = pathinfo($originalName);
$rawExt = strtolower($pathInfo['extension'] ?? '');

// Cegah ekstensi file berbahaya
if (in_array($rawExt, $uploadCfg['forbidden_extensions'], true)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => "Jenis file .$rawExt berbahaya dan dilarang untuk diunggah."]);
    exit;
}

// Deteksi MIME type riil dari isi file menggunakan finfo
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$detectedMime = finfo_file($finfo, $tmpPath);
finfo_close($finfo);

// Normalisasi deteksi untuk rekaman audio WebM / OGG yang kadang terdeteksi sebagai video/webm atau application/octet-stream
$mediaCategory = null;
$allowedMimes = [];
$maxAllowedSize = 0;

foreach ($uploadCfg['allowed_types'] as $cat => $rules) {
    if (in_array($detectedMime, $rules['mimes'], true)) {
        $mediaCategory = $cat;
        break;
    }
}

// Fallback khusus untuk audio webm/ogg rekaman browser yang mungkin terdeteksi video/webm atau audio/x-unknown
if (!$mediaCategory) {
    if (in_array($rawExt, ['webm', 'ogg', 'wav', 'mp3', 'm4a', 'aac'], true)) {
        if ($detectedMime === 'video/webm' || str_starts_with($detectedMime, 'audio/')) {
            $mediaCategory = 'audio';
        }
    }
}

if (!$mediaCategory) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => "Tipe file tidak didukung ($detectedMime). Hanya gambar, video, dan audio/voice note yang diizinkan."
    ]);
    exit;
}

// Validasi ukuran berdasarkan kategori media
if ($mediaCategory === 'image') {
    $maxAllowedSize = $uploadCfg['max_image_size'];
    $catLabel = 'Gambar';
} elseif ($mediaCategory === 'video') {
    $maxAllowedSize = $uploadCfg['max_video_size'];
    $catLabel = 'Video';
} else {
    $maxAllowedSize = $uploadCfg['max_audio_size'];
    $catLabel = 'Voice note / Audio';
}

if ($fileSize > $maxAllowedSize) {
    $maxMB = round($maxAllowedSize / (1024 * 1024));
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => "Ukuran $catLabel melebihi batas maksimum ($maxMB MB). Ukuran file Anda: " . round($fileSize / (1024 * 1024), 2) . " MB."
    ]);
    exit;
}

// Pastikan ekstensi valid untuk kategori tersebut
$validExtensions = $uploadCfg['allowed_types'][$mediaCategory]['extensions'];
$ext = in_array($rawExt, $validExtensions, true) ? $rawExt : $validExtensions[0];

// Pastikan folder tujuan ada
$targetDir = $uploadCfg['directory'];
if (!is_dir($targetDir)) {
    @mkdir($targetDir, 0755, true);
}

// Buat nama file unik dan aman (32 karakter hex acak)
$safeFileName = bin2hex(random_bytes(16)) . '.' . $ext;
$targetPath = $targetDir . '/' . $safeFileName;

if (!move_uploaded_file($tmpPath, $targetPath)) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Gagal memindahkan file ke penyimpanan server.']);
    exit;
}

@chmod($targetPath, 0644);

// Kembalikan URL publik dan metadata file
$fileUrl = $uploadCfg['url_prefix'] . $safeFileName;

echo json_encode([
    'success' => true,
    'url' => $fileUrl,
    'fileName' => htmlspecialchars($originalName, ENT_QUOTES, 'UTF-8'),
    'type' => $mediaCategory,
    'mime' => $detectedMime,
    'size' => $fileSize
]);
