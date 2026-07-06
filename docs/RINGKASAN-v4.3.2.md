# Main Kartu — Ringkasan Project & Catatan untuk v4.3.2

---

## 1. Gambaran Umum Project

**Main Kartu** adalah web multiplayer card game berbasis single-file HTML (~19.300 baris, vanilla JS) dengan Firebase Realtime Database sebagai backend.

| Item | Detail |
|------|--------|
| File utama | `truf-multiplayer-v3.html` |
| URL live | https://main-kartu-game.web.app |
| Firebase project | `truf-e3256` (Realtime DB, region `asia-southeast1`) |
| Hosting | Firebase Hosting (target: `main-kartu-game`) |
| Jumlah fungsi | ~389 fungsi JS |
| Deploy | `firebase deploy --only hosting` |

### Arsitektur
- **Single-file HTML** — semua CSS, JS, dan HTML dalam satu file
- **Firebase SDK v10.12.0** (modular import via CDN)
- **Realtime Database** untuk state management (rooms, players, game state, chat)
- **No build step** — langsung deploy file HTML ke Firebase Hosting
- **Vanilla JS** — tidak ada framework (React/Vue/dll)

### Firebase Database Structure
```
/accounts/{username}     → { name, username, password, uid, createdAt }
/leaderboards/{game}/{username} → { username, name, matches, points }
/rooms/{roomCode}        → { game state lengkap }
```

---

## 2. Fitur Utama

### 4 Game yang Tersedia
| Game | Pemain | Mekanisme |
|------|--------|-----------|
| **Truf** | 4 | Bidding + trump suit, 13 trick |
| **Cangkul** | 3-6 | Habiskan kartu duluan, tarik dari deck jika tidak punya suit |
| **Remi** | 4 | Dasar (run) + pararel (set), ambil buangan, tutupan, ranking |
| **Tebak Kartu** | 4-6 | Tebak kartu lawan berdasarkan rank, kumpulkan set |

### Fitur Cross-Game
- **Auth system** — login/register dengan username+password, data di Firebase
- **Admin panel** — akses via `__admin__` / `MAINKARTU2025`, lihat semua user, room aktif, cleanup
- **Bot AI** — 4 level kesulitan (Easy/Medium/Hard/Insane), 7 nama bot
- **Voice chat** — WebRTC peer-to-peer mesh, Firebase signaling, STUN server publik
- **Live chat** — text chat real-time per room
- **Leaderboard** — ranking per game berdasarkan poin kumulatif (min 10 ronde, tanpa bot)
- **Spectator mode** — tonton game Remi yang sedang berlangsung
- **Disconnect handling** — grace period 30 detik, lalu bot mengambil alih; pemain bisa reconnect
- **Host migration** — jika host disconnect, pemain lain otomatis jadi host
- **3 layout mode** — iOS / Android / PC (toggle via floating picker)
- **Sound system** — BGM (lobby/game/tense/win), SFX (kartu, ceki, dll)
- **Responsive** — mobile-first, CSS khusus per layout mode

### Fitur Khusus Remi (Fokus Utama)
- Combo: Dasar (run sesuit min 3) + Pararel (3+ rank sama)
- Ambil buangan multi-depth dengan aturan kartu terdalam (mustLayThisTurn)
- Tutupan dari buangan dengan sistem bonus/tarikan berdasarkan penyumbang
- Auto-discard 30 detik (timer visual, auto buang kartu legal random)
- Pause/Jeda (semua human bisa trigger, semua harus siap untuk lanjut)
- Sistem Rank + Babu (rank 4 berturut 4x = Babu Sejati, 10x = Babu Abadi)
- Kocok deck untuk rank 4 (wajib klik deck 20x di awal ronde)
- Match cap: skor +1000/-1000 mengakhiri permainan

---

## 3. Struktur Kode (Sections Utama)

```
Baris   Konten
──────  ───────────────────────────────
1-5300      CSS (styles untuk semua view, responsive, Android fix)
5300-5850   HTML (auth, admin, lobby, room, game views, modals)
5850-6250   HTML (cangkul, remi, tebak, truf game views & modals)
6260-6300   Constants (bot names, heartbeat, timeout)
6300-6600   Sound module (Web Audio + mp3-backed)
6600-6700   Turn Reminder / Remi Turn Timer
6700-7140   Voice Chat (WebRTC mesh)
7140-7530   Auth (login/register/admin)
7530-7670   Leaderboard
7670-8060   Game Select / Lobby / Room management
8060-8230   Presence / Reconnect / Disconnect detection
8230-8600   Game Toast / Connection notifications / Seat rendering
8600-8750   Disconnect detection / Host migration
8750-9000   Event wiring (semua onclick handlers)
9000-9430   Room listener (onValue) — main game loop
9430-9640   Heartbeat / Spectator mode
9640-10100  Room join/leave, Remi game view lifecycle
10100-13700 Remi gameplay (render, bot, scoring, tutupan, stuck, pause)
13700-15400 Truf bidding (bot bid, AI logic 4 difficulty levels)
15400-15500 Card rendering
15500-16200 Truf/Cangkul game view lifecycle
16200-16700 Cangkul bot + gameplay
16700-17800 Truf play phase (bot play, trick resolution, scoring)
17800-18000 Leaderboard recording, seat rendering
18000-18900 Tebak Kartu gameplay
18900-19100 Tebak bot AI
19100-19322 Layout picker, init, DOMContentLoaded
```

---

## 4. Isu yang Diselesaikan (Sesi Terakhir)

### 4.1. Bug Rendering Android Chrome — "Kotak" Backdrop Filter

**Problem:** Di Chrome Android (terutama Realme GT), elemen dengan `backdrop-filter` + `position: fixed` + `transform` membuat compositing layer yang ter-render di atas sibling meskipun z-index lebih rendah. Ini menyebabkan:
- "Kotak" blur menimpa kartu di auth view
- Game view (Cangkul/Remi/Tebak) tampil putih/kosong karena modal-modal dengan `backdrop-filter: blur()` di `opacity: 0` tetap membuat compositing layer yang mengganggu rendering

**Root cause:** Chrome Android compositing engine bug — `position: fixed` elements dengan `backdrop-filter` (bahkan di `opacity: 0`) membuat layer terpisah yang mengacaukan rendering elemen lain.

**Fix yang diterapkan:**
```css
/* Blanket: matikan SEMUA backdrop-filter di Android */
body.is-android *,
body.is-android *::before,
body.is-android *::after {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
}
/* Kompensasi blur yang hilang dengan background opaque */
body.is-android .modal-overlay { background: rgba(5,18,14,0.92) !important; }
body.is-android .game-topbar, .cangkul-topbar { background: rgba(10,30,23,0.95) !important; }
body.is-android .player-card { background: solid gradient !important; }
body.is-android .auth-backdrop { display: none !important; }
body.is-android .card-box { backdrop-filter:none; transform:none; background: opaque; }
```

**Catatan untuk v4.3.2:** Pendekatan blanket `* { backdrop-filter: none }` efektif tapi kasar. Jika ingin efek blur di Android, perlu investigasi per-elemen mana yang aman dan mana yang menyebabkan compositing bug. Atau gunakan CSS `@supports` untuk deteksi yang lebih granular.

### 4.2. Bug Hidden Class pada Re-entry Game View

**Problem:** Setelah keluar dari room (via `handleForceLeaveRoom`), masuk game baru tidak menampilkan game view — layar kosong/hijau saja.

**Root cause:** `handleForceLeaveRoom()` menambah class `hidden` ke `remiGameView` dan `cangkulGameView`. Tapi `enterRemiGameView()` dan `enterCangkulGameView()` hanya menambah class `show` tanpa menghapus `hidden`. Karena `.hidden { display: none !important }` selalu menang atas selector lain, game view tetap tersembunyi.

**Fix:** Tambah `classList.remove('hidden')` di `enterRemiGameView()` dan `enterCangkulGameView()` sebelum menambah `show`.

**Catatan untuk v4.3.2:** Pattern `hidden` + `show` rawan konflik. Pertimbangkan migrasi ke satu class toggle saja (misalnya hanya pakai `show` tanpa `hidden`, atau ganti ke `display` inline style).

### 4.3. Bug Bot Masih Memainkan Pemain yang Sudah Reconnect

**Problem:** Ketika pemain disconnect dan bot mengambil alih, lalu pemain reconnect, bot tetap memainkan giliran pemain tersebut.

**Root cause:** Setiap bot action menggunakan `setTimeout(700-1400ms)` untuk delay realistis. Di dalam callback, kode re-fetch room state dari Firebase dan memeriksa apakah giliran masih sama, tapi TIDAK memeriksa ulang `isBotControlled()` pada player tersebut. Jika pemain reconnect selama delay, flag `disconnected` sudah di-clear tapi bot tetap bermain karena tidak ada pengecekan ulang.

**Fix:** Tambah pengecekan `isBotControlled()` setelah re-fetch di semua bot callback:
- `maybeRunBotPlay` (Truf play)
- `submitBotBid` (Truf bid)
- `maybeRunBotConfirms` (Truf bid confirm)
- `maybeRunBotTieDecision` (Truf tie)
- `maybeRunCangkulBot` (Cangkul)
- `maybeRunRemiBot` (Remi)
- `maybeRunTebakBot` (Tebak) — juga ubah gate awal dari `player.isBot` ke `isBotControlled(player)` agar disconnected human juga di-handle bot di Tebak

**Catatan untuk v4.3.2:** Pattern "schedule bot action → delay → re-fetch → play" ada di 6+ tempat. Pertimbangkan refactor ke satu helper `scheduleBotAction(seat, delay, callback)` yang otomatis re-fetch + guard `isBotControlled`.

### 4.4. Konfirmasi "Akhiri Permainan"

**Problem:** Tombol "Akhiri Permainan" (host only, muncul saat ronde selesai) langsung mengakhiri game tanpa konfirmasi — rawan salah tekan.

**Fix:** Tambah `confirm('Yakin ingin mengakhiri permainan?')` di:
- `handleRemiEndTournament()` — Remi
- `handleCangkulEndTournament()` — Cangkul
- `handleEndTournamentClick()` — Truf
- `endTebakMatch()` — Tebak Kartu

Tombol "Keluar Room" sudah memiliki konfirmasi sebelumnya.

### 4.5. Layout Picker Dipindah ke Semua Halaman

**Problem:** Toggle tampilan (iOS/Android/PC) sebelumnya hanya ada di lobby, sehingga pemain tidak bisa mengganti layout saat di halaman lain.

**Fix:** Layout picker dijadikan floating element (`#layoutFloating`) yang `position: fixed` di semua halaman. Visibility diatur via `setLayoutFloatingVisible()`:
- Tampil di: login, game select, lobby, room view, exit game
- Tersembunyi saat: in-game (semua tipe game)

---

## 5. Known Issues & Saran untuk v4.3.2

### Yang Perlu Diperhatikan
1. **File size** — 19.300 baris dalam satu file. Pertimbangkan split ke modul jika terus bertambah, atau minimal gunakan comment markers yang konsisten untuk navigasi
2. **Blanket backdrop-filter:none di Android** — efektif tapi menghilangkan semua efek blur. Bisa dibuat lebih granular jika perlu
3. **Pattern hidden+show** — rawan konflik karena `!important`. Standardisasi ke satu mekanisme toggle
4. **Bot action scheduling** — pattern `setTimeout` + re-fetch tersebar di 6+ tempat. Ripe for refactoring ke helper terpusat
5. **Tebak Kartu disconnect handling** — baru saja diperbaiki (`isBot` → `isBotControlled`), perlu dites lebih lanjut di production
6. **Android emulator testing** — Chrome di emulator (Android 10, Chrome 124) mungkin berbeda behavior dari device asli (Realme GT). Selalu verifikasi di device fisik juga

### Deploy Checklist
```bash
cd /Users/960075/Documents/truf-game

# Deploy hosting saja (perubahan HTML/CSS/JS)
firebase deploy --only hosting

# Deploy database rules (jika ada perubahan rules)
firebase deploy --only database --project truf-e3256

# URL live
# https://main-kartu-game.web.app
```

---

*Dokumen ini dibuat 14 Juni 2026 sebagai handoff untuk Main Kartu v4.3.2.*
