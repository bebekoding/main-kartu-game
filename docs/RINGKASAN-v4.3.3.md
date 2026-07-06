# Main Kartu — Ringkasan Project & Catatan untuk v4.3.3

---

## 1. Gambaran Umum Project

**Main Kartu** adalah web multiplayer card game berbasis single-file HTML (~19.376 baris, vanilla JS) dengan Firebase Realtime Database sebagai backend.

| Item | Detail |
|------|--------|
| File utama | `truf-multiplayer-v3.html` |
| URL live | https://main-kartu-game.web.app |
| Firebase project | `truf-e3256` (Realtime DB, region `asia-southeast1`) |
| Hosting | Firebase Hosting (target: `main-kartu-game`) |
| Deploy | `firebase deploy --only hosting` |

### Arsitektur
- **Single-file HTML** — semua CSS, JS, dan HTML dalam satu file (~19.376 baris)
- **Firebase SDK v10.12.0** (modular import via CDN)
- **Realtime Database** untuk state management (rooms, players, game state, chat)
- **No build step** — langsung deploy file HTML ke Firebase Hosting
- **Vanilla JS** — tidak ada framework

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
- **Auth system** — login/register dengan username+password
- **Admin panel** — akses via `__admin__` / `MAINKARTU2025`
- **Bot AI** — 4 level kesulitan (Easy/Medium/Hard/Insane), 7 nama bot
- **Voice chat** — WebRTC peer-to-peer mesh
- **Live chat** — text chat real-time per room
- **Leaderboard** — ranking per game (min 10 ronde, tanpa bot)
- **Spectator mode** — tonton game Remi yang sedang berlangsung
- **Disconnect handling** — grace period 30 detik, bot mengambil alih, pemain bisa reconnect
- **Host migration** — pemain lain otomatis jadi host jika host disconnect
- **3 layout mode** — iOS / Android / PC (floating picker)
- **Sound system** — BGM + SFX
- **Navigation guard** — konfirmasi saat refresh/back browser selama bermain (semua 4 game)

### Fitur Khusus Remi
- Combo: Dasar (run sesuit min 3) + Pararel (3+ rank sama)
- Ambil buangan multi-depth dengan aturan kartu terdalam
- Tutupan dari buangan/cabutan dengan sistem bonus berdasarkan penyumbang
- Auto-discard **45 detik** (timer visual, auto buang kartu legal random)
- Pause/Jeda
- Sistem Rank + Babu
- Match cap: skor +1000/-1000 mengakhiri permainan
- Celebration video saat menutup pemain

---

## 3. Struktur Kode (Sections Utama)

```
Baris   Konten
──────  ───────────────────────────────
1-5300      CSS (styles, responsive, Android fix)
5300-5850   HTML (auth, admin, lobby, room, game views, modals)
5850-6250   HTML (cangkul, remi, tebak, truf game views & modals)
6260-6300   Constants (bot names, heartbeat, timeout)
6300-6600   Sound module (Web Audio + mp3)
6600-6700   Turn Reminder / Remi Turn Timer (LIMIT_MS = 45000)
6700-7140   Voice Chat (WebRTC mesh)
7140-7530   Auth (login/register/admin)
7530-7670   Leaderboard
7670-8060   Game Select / Lobby / Room management
8060-8230   Presence / Reconnect / Disconnect detection
8230-8600   Game Toast / Connection notifications
8600-8750   Disconnect detection / Host migration
8750-9000   Event wiring (onclick handlers)
9000-9430   Room listener (onValue) — main game loop
9430-9640   Heartbeat / Spectator mode
9640-10100  Room join/leave, Remi game view lifecycle
10100-13700 Remi gameplay (render, bot, scoring, tutupan, stuck, pause)
13700-15400 Truf bidding (bot bid, AI logic)
15400-15500 Card rendering
15500-16200 Truf/Cangkul game view lifecycle
16200-16700 Cangkul bot + gameplay
16700-17800 Truf play phase
17800-18060 Leaderboard recording, navigation guard, seat rendering
18060-18900 Tebak Kartu gameplay
18900-19100 Tebak bot AI
19100-19376 Layout picker, init, DOMContentLoaded
```

---

## 4. Isu yang Diselesaikan di v4.3.2

### 4.1. Timer Remi Diperpanjang: 30 → 45 Detik

**Perubahan:** `RemiTurnTimer.LIMIT_MS` diubah dari `30000` ke `45000` untuk memberi ruang pemain dalam memikirkan taktik combo.

**Lokasi:** Sekitar baris 6625.

---

### 4.2. Konfirmasi Navigasi Saat Bermain (Semua Game)

**Problem:** Pemain bisa tidak sengaja menekan refresh/back browser saat bermain, kehilangan posisi di game.

**Fix:** Ditambahkan navigation guard untuk semua 4 game:
- **`beforeunload` event** — muncul dialog konfirmasi browser saat refresh/close tab
- **`history.pushState` + `popstate`** — muncul `confirm()` saat tekan back di browser
- **`isInActiveGame()`** — helper yang return true jika sedang dalam fase bermain di salah satu dari 4 game

**Penerapan:**
- `pushGameHistoryGuard()` dipanggil di semua `enter*GameView()` (Truf, Cangkul, Remi, Tebak)
- `clearGameHistoryGuard()` dipanggil di semua `exit*GameView()`
- `exitRemiToMain()` ditambah `confirm('Yakin keluar dari room?')` karena tidak melewati `handleLeaveRoom()` yang sudah punya konfirmasi

**Lokasi:** Sekitar baris 18023-18060 (guard functions), dan di masing-masing enter/exit view.

---

### 4.3. Fix Validasi Ambil Buangan untuk Pararel (Tutupan)

**Problem:** Saat pemain sudah punya dasar dan ingin menutup permainan dengan mengambil kartu dari buangan (misal: King) yang membentuk combo pararel, validasi `canDeepestFormCombo()` menolak padahal seharusnya valid.

**Root cause:** `findAllPararelsInHand()` greedy — mengambil semua 4 kartu rank yang sama sekaligus. Kalau semua 4 kartu = semua kartu di tangan, maka `leavesDiscardCard` check gagal (tidak ada sisa untuk dibuang). Padahal 3 kartu sudah cukup untuk pararel valid.

**Fix:** Ganti greedy enumeration dengan **explicit enumeration**:
- Coba semua kombinasi 3 kartu dari same-rank cards
- Coba kombinasi 4 kartu jika tersedia
- Untuk dasar juga dicoba semua sub-run (bukan hanya full run)

**Lokasi:** Sekitar baris 11747-11789 (di `canDeepestFormCombo()`).

---

### 4.4. Fix Bug Joker Scoring — Dead Joker Dianggap Hidup

**Problem:** Di akhir ronde, joker yang seharusnya mati (tidak membentuk combo valid) tetap dianggap hidup karena ikut "menempel" ke combo yang sudah lengkap tanpa joker.

**Root cause:** Fungsi `findAllJokerAwareCombos()` punya "Option B" (`bestJokerExtension`) yang memperbolehkan joker memperpanjang combo pure (combo yang sudah valid tanpa joker). Akibatnya, dead joker bisa "diserap" ke combo existing dan lolos scoring.

**Fix:** Hapus "Option B" (`bestJokerExtension`) seluruhnya. Joker hanya bisa **melengkapi combo BARU** yang tanpa joker tidak valid — tidak boleh menempel ke combo yang sudah lengkap sendiri.

**Lokasi:** Sekitar baris 10497-10519 (di `findAllJokerAwareCombos()`).

---

### 4.5. Fix Race Condition Tutupan — Bonus Poin Tidak Terhitung

**Problem:** Pemain menutup dari buangan, tapi di scoring hasilnya dianggap tutup dari cabutan (deck) sehingga bonus tutupan tidak diberikan.

**Root cause (3 lapis):**
1. **Bot menimpa `lastDrawnFrom`** — Setelah player close (buang kartu terakhir), giliran pindah ke player berikutnya. Jika next player = bot, bot langsung draw dari deck → `lastDrawnFrom` berubah dari `'discard'` ke `'deck'` sebelum resolve berjalan.
2. **Tidak ada snapshot saat close** — `closeMethod` tidak disimpan saat penutupan terjadi, hanya dibaca dari `lastDrawnFrom` saat resolve (1 detik kemudian).
3. **Resolve menimpa `closeMethod`** — Bahkan setelah fix pertama menambah `closeMethod`, resolve function masih overwrite nilainya dengan `c2.lastDrawnFrom || 'deck'`.

**Fix (3 lapis):**
1. **Snapshot `closeMethod` saat close** — Di `handleRemiDiscard` dan `handleRemiBotDiscard`, saat `newHand.length === 0`, simpan `updates['remi/closeMethod'] = c2.lastDrawnFrom || 'deck'`
2. **Guard bot setelah close** — Di `maybeRunRemiBot()`, tambah `if (c.closedBy != null) return;` di awal fungsi agar bot tidak menjalankan aksi apapun setelah penutupan
3. **Resolve tidak menimpa** — Ubah resolve menjadi `if (closedBy == null) updates['remi/closeMethod'] = null;` sehingga hanya reset kalau tidak ada penutupan

**Resolve membaca:** `closingMethod = c2.closeMethod || c2.lastDrawnFrom || 'deck'`

**Lokasi:**
- `handleRemiDiscard` — sekitar baris 12103-12108
- `handleRemiBotDiscard` — sekitar baris 12619-12622
- `maybeRunRemiBot` guard — sekitar baris 12322
- Resolve read — sekitar baris 12826
- Resolve no-overwrite — sekitar baris 12967

---

### 4.6. Celebration Media Diganti & Dikompresi

**Perubahan:**
- Video `close-celebration.mp4` diganti dengan video baru
- Dikompresi dari 15MB (4K 3840x2160, 8Mbps) → **418KB** (720p, CRF 30, H.264 + AAC 96kbps, faststart)
- Celebration video sekarang ditampilkan untuk **semua jenis penutupan** (dari deck maupun buangan), tidak lagi dibedakan
- Cache-busting `?v=2` ditambahkan ke URL video

**Lokasi:** Sekitar baris 13336-13348, URL video di sekitar baris 13125.

---

## 5. Known Issues & Catatan dari Versi Sebelumnya (v4.3.1)

Isu berikut sudah **diselesaikan di v4.3.1** tapi perlu diperhatikan konteksnya:

| # | Isu | Status |
|---|-----|--------|
| 1 | Bug rendering Android Chrome — backdrop-filter di-disable blanket | Fixed (v4.3.1), blanket approach |
| 2 | Bug hidden class pada re-entry game view | Fixed (v4.3.1) |
| 3 | Bot masih main setelah pemain reconnect | Fixed (v4.3.1) |
| 4 | Konfirmasi "Akhiri Permainan" | Fixed (v4.3.1) |
| 5 | Layout picker floating di semua halaman | Fixed (v4.3.1) |

---

## 6. Saran & Known Issues untuk v4.3.3

### Arsitektur & Teknis
1. **File size terus bertambah** — sekarang ~19.376 baris. Pertimbangkan split ke modul atau minimal comment markers yang konsisten untuk navigasi
2. **Blanket `backdrop-filter: none` di Android** — efektif tapi menghilangkan semua efek blur visual. Bisa dibuat lebih granular jika efek blur diinginkan
3. **Pattern `hidden` + `show`** — rawan konflik `!important`. Pertimbangkan standardisasi ke satu mekanisme toggle
4. **Bot action scheduling** — pattern `setTimeout` + re-fetch tersebar di 6+ tempat. Bisa direfactor ke helper `scheduleBotAction(seat, delay, callback)` yang otomatis re-fetch + guard `isBotControlled`

### Remi Gameplay
5. **Combo enumeration performance** — `canDeepestFormCombo()` sekarang coba semua sub-run dan subset pararel. Untuk tangan besar (13+ kartu), bisa jadi lambat — belum terasa tapi perlu dipantau
6. **Joker di pararel** — "Option B" dihapus (joker tidak boleh extend pure combo). Perlu verifikasi tidak ada edge case di mana joker seharusnya bisa memperpanjang pararel tapi sekarang tidak bisa
7. **Stuck detection** — perlu diverifikasi masih bekerja dengan benar setelah perubahan combo enumeration
8. **Spectator saat tutupan** — belum diverifikasi apakah spectator melihat celebration video saat ada penutupan

### UX
9. **Navigation guard di iOS Safari** — `beforeunload` tidak selalu dipanggil di iOS Safari. Perlu verifikasi di device fisik
10. **Timer 45 detik** — apakah terlalu lama? Pantau feedback pemain

### Deploy Checklist
```bash
cd /Users/960075/Documents/truf-game

# Deploy hosting saja
firebase deploy --only hosting

# Deploy database rules (jika ada)
firebase deploy --only database --project truf-e3256

# URL live
# https://main-kartu-game.web.app
```

---

*Dokumen ini dibuat 18 Juni 2026 sebagai handoff dari v4.3.2 ke v4.3.3.*
