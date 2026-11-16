# VoiceLink

Aplikasi komunikasi suara full-duplex berbasis browser, Web Audio API, WebRTC mesh group call, chat multimedia, dan server WebSocket PHP.

## Fitur Utama

1. **Group Publik & Pendaftaran Otomatis**:
   - Satu group publik yang otomatis diikuti seluruh pengguna setelah memasukkan nama.
   - Daftar anggota yang sedang online secara real-time.
   - Tanda notifikasi saat pengguna bergabung atau meninggalkan group publik.
   - Mekanisme de-duplikasi ID pengguna saat terputus dan menyambung kembali (reconnect).

2. **Group Call Suara Berbasis WebRTC (Maksimal 6 Peserta)**:
   - Pengguna dapat memulai atau bergabung ke panggilan suara group langsung dari Group Publik.
   - Pengaturan batas peserta (minimal 2 orang, maksimal 6 orang).
   - Penolakan peserta tambahan saat panggilan sudah mencapai kapasitas penuh dengan pesan yang jelas.
   - Indikator status mikrofon (Muted / Mic Aktif) dan animasi pendeteksi suara berbicara (*speaking ring*) untuk setiap peserta.
   - Pembebasan slot peserta secara otomatis saat pengguna keluar, menutup tab, atau koneksi terputus.
   - Menggunakan arsitektur WebRTC Mesh untuk transmisi audio group antar-browser dengan latensi rendah; WebSocket hanya digunakan untuk pertukaran sinyal (*signaling*).
   - Fitur panggilan 1-on-1 original tetap didukung penuh.

3. **Chat Multimedia & Berbagi Media**:
   - Chat teks real-time dengan status pengiriman (*Mengirim...*, *Terkirim*, *Gagal*), waktu, dan nama pengirim.
   - Perekaman dan pengiriman Voice Note interaktif (kontrol rekam, jeda, batalkan, putar, dan durasi).
   - Pengiriman foto (JPG, PNG, GIF, WebP) dan video (MP4, WebM, OGG) dengan thumbnail pratinjau dan pemutar video terintegrasi.
   - Modal Lightbox untuk melihat foto dan video ukuran penuh.
   - Validasi ganda tipe file dan batas ukuran di sisi browser maupun server.
   - Pengunggahan melalui endpoint HTTP `upload.php` dengan progress bar; WebSocket hanya menerima metadata dan URL file yang aman.
   - Penyimpanan aman di folder `uploads/` dengan nama file acak (32-karakter hex) dan perlindungan `.htaccess` untuk mencegah eksekusi skrip berbahaya.

4. **Chat Personal & Percakapan Pribadi (1-on-1 Direct Message)**:
   - Pengguna dapat memilih anggota online dari daftar di sidebar untuk membuka percakapan personal.
   - Pesan dan media hanya dikirimkan serta ditampilkan kepada dua pihak yang terlibat; pihak ketiga tidak menerima transmisi pesan (isolasi privasi 100%).
   - Indikator status pengiriman real-time: *⏳ Mengirim...*, *✓ Terkirim*, dan *✓ Tersimpan di server (offline)*.
   - Mendukung seluruh jenis konten: teks, foto, video, dan voice note.
   - Pengambilan riwayat percakapan otomatis saat membuka chat, dengan pembatasan hak akses ketat di sisi server.
   - Badge penghitung pesan belum dibaca (*unread count badge*) di daftar anggota.
   - Tombol navigasi kembali ke Group Publik yang nyaman di desktop dan ponsel.

5. **Panggilan Suara Personal (WebRTC Peer-to-Peer 1-on-1 Audio)**:
   - Tombol panggil suara langsung dari header chat personal atau ikon panggilan cepat di daftar anggota.
   - Aliran audio ditransmisikan langsung antar-peserta menggunakan **WebRTC P2P (Opus Codec)** dengan *hardware echo cancellation*, *noise suppression*, dan *auto gain control*; WebSocket murni digunakan hanya untuk signaling (*offer*, *answer*, *ICE candidate*, status panggilan).
   - Status panggilan lengkap: *Memanggil...*, *Berdering...*, *Tersambung*, *Ditolak*, *Berakhir*, *Sibuk*, dan *Lawan bicara terputus*.
   - Kontrol panggilan: Terima, Tolak, Tutup, Mute/Unmute mikrofon, Matikan/Aktifkan Speaker (Deafen), serta animasi visualizer waveform real-time.
   - Proteksi keamanan: pencegahan memanggil diri sendiri, deteksi sibuk (jika salah satu pihak sedang dalam group call atau call lain), dan pembersihan sesi otomatis jika koneksi terputus.

6. **Komunitas Privat**:
   - Buat beberapa komunitas dari sidebar dan kirim pesan teks khusus anggota komunitas.
   - Undang pengguna online berdasarkan nama yang mereka pakai saat masuk, atau salin tautan undangan untuk bergabung setelah login.
   - Daftar komunitas dan riwayat pesan disimpan di memori server, sehingga akan hilang saat WebSocket server dimulai ulang. Fitur komunitas saat ini mendukung chat teks.

---

## Persyaratan Sistem

- PHP CLI 8.0 atau lebih baru.
- Ekstensi PHP `sockets` aktif (otomatis dimuat oleh `start_server.bat`).
- Browser modern dengan dukungan WebRTC dan izin mikrofon (Chrome, Edge, Firefox, Safari).
- Server web pendukung PHP (Apache Laragon atau PHP Built-in Server).

Tidak memerlukan dependency Composer atau Node.js.

---

## Konfigurasi Batas Ukuran & Panggilan

Pengaturan utama tersimpan di file `config.php`:

| Pengaturan | Nilai Default | Keterangan |
| :--- | :--- | :--- |
| `ws_bind_host` | `0.0.0.0` | Bind host WebSocket (mendengarkan di semua antarmuka LAN & localhost) |
| `ws_port` | `8765` | Port server WebSocket |
| `max_participants_limit` | `6` | Batas maksimum absolut peserta group call |
| `min_participants` | `2` | Batas minimum untuk memulai group call |
| `max_image_size` | `10 MB` | Ukuran maksimum file gambar |
| `max_video_size` | `30 MB` | Ukuran maksimum file video |
| `max_audio_size` | `10 MB` | Ukuran maksimum rekaman voice note |

> [!NOTE]
> Pastikan konfigurasi `php.ini` pada server web Anda mengizinkan batas upload ini (`upload_max_filesize = 30M` dan `post_max_size = 40M` atau lebih besar). Pada Laragon standar, batas ini umumnya sudah disetel ke 2GB.

---

## Panduan Akses Jaringan Lokal (Laptop & HP)

VoiceLink didesain agar laptop berfungsi sebagai host server, dan HP atau perangkat lain yang tersambung ke Wi-Fi / Hotspot yang sama dapat mengakses aplikasi, masuk ke grup, dan menggunakan fitur suara.

### 1. Mengetahui Alamat IPv4 LAN Laptop
Buka PowerShell atau Command Prompt di laptop, lalu jalankan:
```cmd
ipconfig
```
Perhatikan bagian adapter yang sedang aktif:
- **Jika menggunakan Mobile Hotspot Windows**: Cari adapter *Local Area Connection* yang memiliki IPv4, umumnya `192.168.137.1`.
- **Jika menggunakan Wi-Fi / Router Rumah**: Cari adapter *Wi-Fi* yang memiliki IPv4, contohnya `192.168.1.50` atau `192.168.110.76`.

Saat `start_server.bat` dijalankan, launcher akan secara otomatis mendeteksi dan menampilkan daftar seluruh URL akses yang siap dibuka di HP Anda.

### 2. URL Akses Aplikasi
- **Di Laptop**: `http://localhost/voice-full-duplex-master/` (atau `https://localhost/voice-full-duplex-master/`)
- **Di HP**: `http://<IP-LAN-Laptop>/voice-full-duplex-master/` (contoh: `http://192.168.137.1/voice-full-duplex-master/`)

---

## Aturan Windows Defender Firewall

Agar HP dapat terhubung ke server WebSocket (port 8765) dan Apache (port 80 / 443) di laptop, pastikan port tersebut diizinkan pada profil **Private Network**.

Jalankan perintah PowerShell berikut sebagai Administrator di laptop:
```powershell
New-NetFirewallRule -DisplayName "VoiceLink WebSocket Server" -Direction Inbound -Protocol TCP -LocalPort 8765 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "VoiceLink Web Server HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "VoiceLink Web Server HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow -Profile Private
```
*(Atau melalui Windows Defender Firewall with Advanced Security -> Inbound Rules -> New Rule -> Port -> TCP -> 8765, 80, 443 -> Allow the connection -> Centang Private).*

---

## Solusi HTTPS & WSS untuk Jaringan Lokal (Akses Mikrofon HP)

Browser modern pada HP (seperti Google Chrome di Android dan Safari di iOS) mewajibkan **Secure Context (HTTPS atau Localhost)** untuk mengakses mikrofon (`navigator.mediaDevices.getUserMedia`). Terdapat dua metode yang dapat digunakan:

### Metode 1: Mengaktifkan Reverse Proxy HTTPS & WSS di Apache Laragon
VoiceLink menyertakan konfigurasi reverse proxy Apache yang siap pakai di [laragon-apache-voicelink.conf](file:///c:/laragon/www/voice-full-duplex-master/laragon-apache-voicelink.conf):
1. Salin file `laragon-apache-voicelink.conf` ke folder virtual host Apache Laragon:
   `C:\laragon\etc\apache2\sites-enabled\00-voicelink-ssl.conf`
2. Konfigurasi ini secara otomatis:
   - Memuat modul Apache: `mod_proxy`, `mod_proxy_wstunnel`, `mod_proxy_http`, dan `mod_ssl`.
   - Mengaktifkan listener port HTTPS 443 dengan sertifikat SSL bawaan Laragon (`C:/laragon/etc/ssl/laragon.crt`).
   - Meneruskan koneksi WebSocket `wss://<host>/voice-ws` langsung ke server PHP di `ws://127.0.0.1:8765/`.
3. Buka Laragon, klik **Reload** atau **Restart** Apache.
4. **Memasang Sertifikat di HP agar Dipercaya**:
   - Kirim file sertifikat Root CA Laragon (`C:\laragon\etc\ssl\laragon.crt` atau `cacert.pem`) ke HP Anda (via kabel data, WhatsApp, atau Google Drive).
   - Di HP Android, buka **Pengaturan** -> **Keamanan** -> **Kredensial & Enkripsi** -> **Pasang Sertifikat** -> **Sertifikat CA** -> Pilih file sertifikat tersebut.
   - Buka `https://<IP-LAN-Laptop>/voice-full-duplex-master/` di browser HP. Status gembok aman akan aktif dan izin mikrofon dapat langsung diberikan.

### Metode 2: Solusi Cepat Tanpa Sertifikat (Flag Chrome Android)
Jika Anda ingin mencoba langsung dari HP tanpa repot menginstal sertifikat SSL:
1. Buka peramban Google Chrome di HP Anda.
2. Ketik pada address bar:
   `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
3. Masukkan URL laptop Anda, contoh:
   `http://192.168.137.1` (atau `http://192.168.137.1/voice-full-duplex-master`)
4. Ubah dropdown dari **Disabled** menjadi **Enabled**.
5. Tekan tombol **Relaunch** di pojok kanan bawah Chrome HP.
6. Buka kembali `http://192.168.137.1/voice-full-duplex-master/`. Chrome sekarang memperlakukan alamat tersebut sebagai Secure Context, sehingga izin mikrofon dan panggilan suara langsung bekerja penuh!

---

## Setup & Menjalankan Proyek

1. **Jalankan Web Server (HTTP / HTTPS)**:
   - **Laragon**: Buka Laragon, klik **Start All** (Apache melayani HTTP port 80 dan HTTPS port 443).
   - **PHP Built-in Server** (Alternatif):
     ```cmd
     C:\laragon\bin\php\php-8.3.26-Win32-vs16-x64\php.exe -S 0.0.0.0:80 -t C:\laragon\www\voice-full-duplex-master
     ```

2. **Jalankan WebSocket Server**:
   - **Windows**: Klik dua kali [start_server.bat](file:///c:/laragon/www/voice-full-duplex-master/start_server.bat).
     Launcher akan memeriksa PHP, memuat ekstensi sockets, memeriksa port 8765, dan menampilkan IP LAN laptop Anda.
   - **CLI Manual**:
     ```cmd
     C:\laragon\bin\php\php-8.3.26-Win32-vs16-x64\php.exe -d extension=sockets server.php
     ```

3. **Buka Aplikasi**:
   - Di Laptop: `http://localhost/voice-full-duplex-master/`
   - Di HP: Buka URL LAN yang ditampilkan di jendela launcher (misal `http://192.168.137.1/voice-full-duplex-master/`).
   - Masukkan nama pengguna di masing-masing perangkat dan tekan **Masuk ke Group Publik**.
   - Nikmati obrolan multimedia, voice note, dan panggilan suara group (WebRTC)!

---

## Keterbatasan & Catatan Jaringan

1. **WebRTC NAT & Firewall (STUN/TURN)**:
   Aplikasi menggunakan Google Public STUN (`stun:stun.l.google.com:19302`) yang bekerja optimal pada koneksi localhost, LAN, dan jaringan tanpa symmetric NAT ketat. Untuk lingkungan produksi internet atau jaringan seluler dengan firewall tertutup, diperlukan relay TURN server (misal Coturn).
2. **Izin Mikrofon pada Perangkat Lain (HTTPS)**:
   Kebijakan keamanan browser modern (Chrome/Edge/Safari) memblokir akses mikrofon jika dibuka dari IP non-localhost tanpa protokol HTTPS. Untuk pengujian antar-perangkat di jaringan Wi-Fi, gunakan HTTPS reverse proxy atau aktifkan flag `chrome://flags/#unsafely-treat-insecure-origin-as-secure` di browser perangkat penguji.

---

## Struktur File Proyek

- `index.html` — Antarmuka web utama (Group Publik, Chat, Panggilan Group, dan 1-on-1).
- `style.css` — Tema visual cyberpunk gelap dan layout responsif untuk desktop dan ponsel.
- `app.js` — Client WebSocket, WebRTC audio mesh, perekam voice note, dan audio player.
- `config.php` — Pusat konfigurasi batas peserta, port, dan ukuran media upload.
- `upload.php` — Endpoint HTTP penanganan upload media aman dengan validasi MIME riil.
- `server.php` — WebSocket server signaling untuk group, panggilan WebRTC, dan chat.
- `start_server.bat` — Windows batch launcher otomatis untuk server WebSocket PHP.
- `uploads/` — Direktori penyimpanan media terlindungi dari eksekusi skrip (.htaccess).
