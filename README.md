# Main Kartu

Web multiplayer card game (Truf, Cangkul, Remi, Tebak Kartu) berbasis single-file HTML dengan Firebase Realtime Database.

- **Live:** https://main-kartu-game.web.app
- **File utama:** `truf-multiplayer-v3.html`
- **Backend:** Firebase Realtime Database (`truf-e3256`, region `asia-southeast1`)
- **Stack:** Vanilla JS + Firebase SDK v10.12.0 (no build step)

## 4 Game

| Game | Pemain | Mekanisme |
|------|--------|-----------|
| Truf | 4 | Bidding + trump suit, 13 trick |
| Cangkul | 3–6 | Habiskan kartu duluan, tarik dari deck jika tidak punya suit |
| Remi | 4 | Dasar (run) + pararel (set), ambil buangan, tutupan, ranking |
| Tebak Kartu | 4–6 | Tebak kartu lawan berdasarkan rank, kumpulkan set |

## Fitur Cross-Game

Auth (username+password), admin panel, bot AI 4 level, voice chat WebRTC mesh, live text chat, leaderboard per game, spectator Remi, disconnect handling + host migration, 3 layout mode (iOS/Android/PC), sound system, navigation guard.

## Deploy

```bash
firebase deploy --only hosting
firebase deploy --only database --project truf-e3256
```

## Dokumentasi

Ringkasan per versi ada di `docs/`:
- `RINGKASAN-v4.3.2.md` — fix timer 45s, nav guard, combo enumeration, joker scoring, race condition tutupan
- `RINGKASAN-v4.3.3.md` — handoff v4.3.3, saran arsitektur & gameplay
- `REMI_RULES.md` — aturan lengkap Remi

Versi saat ini: **v4.3.3** (development)
