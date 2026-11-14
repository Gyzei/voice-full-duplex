# VoiceLink

Aplikasi komunikasi suara full-duplex berbasis browser, Web Audio API, dan server WebSocket PHP.

## Persyaratan

- PHP CLI 8.0 atau lebih baru.
- Ekstensi PHP `sockets` aktif.
- Browser modern dengan izin mikrofon (Chrome, Edge, atau Firefox).
- Git, jika mengambil kode lewat clone.

Tidak ada dependency Composer atau Node.js.

## Setup lokal

1. Clone repository atau salin folder proyek.
2. Pastikan PHP tersedia di terminal (`php -v`) dan ekstensi sockets aktif:

   ```sh
   php -r "echo extension_loaded('sockets') ? 'sockets aktif' : 'sockets TIDAK aktif';"
   ```

   Jika belum aktif, aktifkan `extension=sockets` di `php.ini` yang digunakan PHP CLI, lalu buka terminal baru.
3. Dari folder proyek, jalankan server web:

   ```sh
   php -S localhost:8000
   ```

4. Di terminal kedua, jalankan server WebSocket:

   - Windows: `start_server.bat`
   - macOS/Linux: `php server.php`

5. Buka <http://localhost:8000>, masukkan nama, lalu buka alamat yang sama di tab atau browser lain untuk mencoba panggilan.

Hentikan masing-masing server dengan `Ctrl+C`. WebSocket menggunakan port `8765`; pastikan port itu belum dipakai aplikasi lain.

## Pengujian dari perangkat lain (opsional)

Server WebSocket saat ini hanya bind ke `127.0.0.1`, jadi koneksi perangkat lain belum didukung langsung. Selain itu, akses mikrofon di browser umumnya memerlukan HTTPS di perangkat non-localhost. Untuk menguji di LAN, siapkan bind WebSocket ke alamat jaringan, HTTPS/WSS reverse proxy dengan sertifikat tepercaya, dan sesuaikan URL/proxy pada konfigurasi aplikasi. Jangan mengekspos server ini ke internet tanpa meninjau keamanan dan kontrol akses.

## Struktur

- `index.html`, `style.css` — antarmuka.
- `app.js` — WebSocket client, audio, dan kontrol panggilan.
- `server.php` — server WebSocket (port `8765`).
- `start_server.bat` — launcher server WebSocket untuk Windows.
