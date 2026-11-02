# Online player count

The main game-selection page and each lobby show the number of authenticated
player accounts currently active in the app, including lobby users and viewers.
Bots and the dedicated admin panel do not publish player presence.

`online-players.js` writes a server timestamp every five seconds under
`onlinePlayers/{uid}/{randomConnectionId}`. Each tab has its own connection ID;
counts deduplicate by UID. Server onDisconnect removes only that connection.
Entries older than 30 seconds are excluded even if disconnect cleanup is delayed.
The display shows a connecting state rather than a misleading zero while offline.
Players on older app versions start publishing after refreshing the page.

`online-policy.cjs` permits password-authenticated users to write only their own
connection timestamps or remove their own connections. Server timestamps are
required; arbitrary counters, future times and another UID's writes are denied.
The node contains no nickname, email, room or profile information. Game-room
presence, cleanup, saved games and leaderboard identities remain separate.

Validated with unit tests, actual local emulator rules and two synthetic browser
accounts. The two browser pages both displayed 2 online accounts. Full existing
application/security/integration checks passed.
