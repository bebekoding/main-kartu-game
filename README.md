# Main Kartu

Web multiplayer card game (Truf, Cangkul, Remi, Tebak Kartu) berbasis single-file HTML dengan Firebase Realtime Database.

- **Live:** https://main-kartu-game.web.app
- **File utama:** `truf-multiplayer-v3.html`
- **Backend:** Firebase Realtime Database (`truf-e3256`, region `asia-southeast1`)
- **Stack:** Vanilla JS + Firebase SDK v10.12.0 (no build step)

## Game

| Game | Pemain | Mekanisme |
|------|--------|-----------|
| Truf | 4 | Bidding + trump suit, 13 trick |
| Cangkul | 3–6 | Habiskan kartu duluan, tarik dari deck jika tidak punya suit |
| Remi | 4 | Dasar (run) + pararel (set), ambil buangan, tutupan, ranking |
| Tebak Kartu | 4–6 | Tebak kartu lawan berdasarkan rank, kumpulkan set |
| Capsa | 4 | Banting, pembalikan kekuatan bomb dan penalti sisa kartu ×10 |

## Fitur Cross-Game

Auth (username+password), admin panel, bot AI 4 level, voice chat WebRTC mesh, live text chat, leaderboard per game, spectator Remi, disconnect handling + host migration, 3 layout mode (iOS/Android/PC), sound system, navigation guard.

## Deploy

```bash
firebase deploy --only hosting
firebase deploy --only database --project truf-e3256
```

## Rilis V4.4

Capsa diterbitkan ke web pada 3 November 2026. Game kelima bernama **Capsa (4 pemain)**, memakai mekanisme Banting. Arah giliran bergantian per ronde mulai searah jarum jam; timer 30 detik per giliran. Integrasi web Capsa memakai browser host sesuai pilihan pengguna agar tetap gratis; lihat [kontrak host](docs/CAPSA_HOST.md). Leaderboard Capsa belum diaktifkan. Lingkungan demo tetap dapat dijalankan lewat `npm run dev:local`.

- [Handoff lengkap menuju V4.4](docs/RINGKASAN-v4.4.md): perubahan, keputusan, batasan, PR dan rencana integrasi.
- [Draft aturan Capsa](docs/CAPSA_RULES_DRAFT.md): hasil riset dan penyesuaian pengguna beserta detail yang perlu dipilih.

- [Kontrak engine Capsa](docs/CAPSA_ENGINE.md): API, transisi ronde dan batas integrasi lokal.

- [Panduan Capsa lokal](docs/CAPSA_LOCAL.md): menjalankan emulator, checkpoint/pemulihan akun dan game, batas data/keamanan serta hasil pengujian.

## Dokumentasi

Ringkasan per versi ada di `docs/`:
- `RINGKASAN-v4.3.2.md` — fix timer 45s, nav guard, combo enumeration, joker scoring, race condition tutupan
- `RINGKASAN-v4.3.3.md` — handoff v4.3.3, saran arsitektur & gameplay
- `REMI_RULES.md` — aturan lengkap Remi

Dokumen fitur terkini: [host](docs/HOST_POLICY.md), [leaderboard](docs/LEADERBOARD_SECURITY.md), [room](docs/ROOM_LIFECYCLE.md), [save/resume](docs/SAVED_GAMES.md), [profil](docs/PLAYER_PROFILES.md), [online](docs/ONLINE_PLAYERS.md), [celebration Remi](docs/REMI_CELEBRATION.md).

Status versi: **V4.4, kandidat deploy Capsa**; status publikasi dicatat setelah verifikasi Hosting/rules aktif.
