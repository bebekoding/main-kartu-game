# Room membership and host ownership

Implemented 26 October 2026. Applies to Truf, Remi, Cangkul and Tebak Kartu.

- Normal players join during the lobby only. A running match admits an original
  participant by Firebase Auth UID, never by nickname. A returning player may
  reclaim only their original seat if it is empty or operated by a bot.
- Free host claim by a new participant requires **zero non-bot players**, including
  offline humans. Join, canonical seat reservation, bot replacement, and host claim
  are committed together and checked by database rules.
- A seated human requests ownership through the Host button. Only the current host
  may approve that live participant's request; the requester cannot self-approve.
- Requests are bound to the previous owner and cleared on every ownership change.
- Leaving during a match converts the leaving human into a bot in the same seat.
  A leaving host hands ownership to the lowest-seat online human. If there is no
  online human, ownership becomes empty; offline humans retain their reservation.
- During a lobby, leaving releases the seat and transfers ownership in the same
  operation. Closing the tab marks presence rather than deleting an indexed seat.
  The active host releases stale lobby reservations atomically. Rules reject that
  cleanup if the human has already reconnected with a fresh presence record.
- After a host stops sending heartbeats, existing online humans may elect the
  lowest-seat online human after 42 seconds. A live heartbeat is at most 15 seconds
  old. This recovery is separate from a new participant's all-bot free claim.
- Bot timers are bound to their originating room and re-check ownership so work
  scheduled by the previous host cannot continue after a transfer.

`seats/{0..5}` is the canonical UID index. Rules check both directions when a seat
changes. `membershipVersion: 2` marks indexed rooms. Gameplay payloads use the
`room-membership.js` bridge to maintain the index in the same multi-location write.
Rules, not the JavaScript helper, enforce the policy against direct REST requests.

Rules are generated with:

```bash
node scripts/build-room-rules.cjs
node --test tests/room-membership.test.cjs
python3 tests/room-host-security.py
```

The Python suite requires the official RTDB emulator at `127.0.0.1:19000` and uses
only the demo namespace `demo-main-kartu-host`. 30 security tests and 18 client/
handler tests pass. Browser preview used fake players to check approval, rejection,
pending requests, starting Remi with bots, and hiding controls from spectators.

The migration planner reads only room membership metadata, not cards, chat, accounts
or credentials. It prepares a forward patch and rollback patch. Corrupt, duplicate,
or out-of-range player records are excluded and fail closed; no room is deleted.
An existing browser tab should refresh after this security release, because older
clients cannot supply the new canonical index for membership-changing operations.

Other findings in `AUDIT-2026-10-26.md`, including public hands, general gameplay
action validation, and ranking authenticity, are separate work and remain open.
