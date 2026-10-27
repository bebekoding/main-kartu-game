# Room expiry and spectator exit

Updated 2026-10-27. Applies to canonical membership v2 rooms in all four games.

- An authenticated application watches rooms and checks expiry every second.
  A human's last server heartbeat or later server disconnect timestamp protects
  the room for 30 seconds. Every human must exceed that limit before cleanup is
  permitted. Fresh presence overrides old disconnected flags and empty markers.
- When the last human leaves normally, the membership bridge atomically starts
  `emptySince` using a server timestamp. Bots-only rooms then retain the full
  30-second grace. Bot heartbeats, spectators, chat, voice and old game rosters do
  not count as human presence.
- Old bots-only rooms and old human entries with no usable presence timestamp
  first receive a server marker and a full 30-second wait. Clients cannot forge,
  backdate, reset or remove an inactive marker to bypass that wait.
- Rules recheck current server data when a client deletes a room. A concurrent
  heartbeat or join prevents deletion even if the cleaner's snapshot is stale.
  This exception grants no gameplay, player, admin or ranking write privileges.
  Existing authenticated host deletion and verified administrator powers remain.
- Pending ranked results and permanent receipts are stored outside the room and
  survive its removal. No leaderboard history is reset by room cleanup.

This stays on the existing Firebase service without a paid scheduler. Physical
deletion requires an authenticated application that is open and connected.
Browser suspension, disconnection or all browsers closing can delay cleanup;
expired rooms are swept when an application becomes active again. The 30-second
limit is checked by rules, not a guarantee of background server execution when
no client is running. Legacy rooms without canonical membership are left to the
verified administrator rather than deleted using an incomplete seat index.

The global `Keluar Tonton` button is a body-level control above the pause,
standings and end-result overlays. Desktop places it at the top right; small
screens place it at the bottom right with a 44px minimum target and safe-area
spacing. It is hidden outside spectator mode. Exiting detaches the room listener,
stops timers and voice, clears overlays and pointer-event overrides, restores the
lobby URL, and returns to the originating lobby or administrator view. Room
deletion also invokes that exit path. Viewing never starts a player heartbeat.

Validation includes expiry boundaries, reconnect races, forged markers, unknown
legacy timestamps, bots-only rooms, all four games, ordinary/anonymous user
permissions, and paused spectator exit. Browser checks use two synthetic
identities against the local official RTDB emulator, not production players.
