/* Shared room membership helpers. Browser + Node tests, no credentials. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RoomMembership = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const ONLINE_MS = 15000;
  const HOST_GRACE_MS = 42000;
  const clone = value => JSON.parse(JSON.stringify(value));

  function capacity(room) {
    if (room.game !== 'cangkul' && room.game !== 'tebak') return 4;
    return Math.max(room.game === 'tebak' ? 4 : 3, Math.min(6, room.maxPlayers || 4));
  }
  function indexPlayers(players, max = 6) {
    const seats = {};
    for (const [uid, p] of Object.entries(players || {})) {
      if (!p || p.uid !== uid || !Number.isInteger(p.seat) || p.seat < 0 || p.seat >= max || typeof p.isBot !== 'boolean') {
        throw new Error('Data kursi tidak valid. Hubungi host untuk membuka room baru.');
      }
      if (seats[p.seat]) throw new Error('Ada dua pemain di kursi yang sama. Hubungi host untuk membuka room baru.');
      seats[p.seat] = uid;
    }
    return seats;
  }
  function online(p, now) {
    return !!(p && !p.isBot && !p.disconnected && typeof p.lastSeen === 'number' &&
      p.lastSeen >= now - ONLINE_MS && p.lastSeen <= now + 5000);
  }
  function onlineHumans(room, now, exclude) {
    return Object.values(room.players || {}).filter(p => p.uid !== exclude && online(p, now))
      .sort((a, b) => a.seat - b.seat || a.uid.localeCompare(b.uid));
  }
  function allBots(room) {
    return room.membershipVersion === 2 && Object.values(room.players || {}).every(p => p.isBot === true);
  }
  function hostUnavailable(room, now) {
    const p = room.players && room.players[room.host];
    return !p || p.isBot || p.disconnected === true || !Number.isFinite(p.lastSeen) || p.lastSeen < now - HOST_GRACE_MS;
  }
  function roster(room) { return (room.gameState && room.gameState.roster) || room.roster || {}; }
  function originalSeat(room, uid) {
    const entry = Object.entries(roster(room)).find(([, p]) => p.uid === uid && !p.isBot);
    return entry ? Number(entry[0]) : null;
  }
  function joinPatch(room, uid, nickname, username, timestamp) {
    const players = room.players || {};
    const existing = players[uid];
    const changes = {};
    if (existing) {
      for (const [field, value] of Object.entries({nickname, username: username || null,
        isBot:false, leftHuman:null, disconnected:null, disconnectedAt:null, lastSeen:timestamp})) {
        changes['players/' + uid + '/' + field] = value;
      }
      return { changes, claiming: false };
    }
    const claiming = allBots(room);
    let seat = room.phase === 'lobby' ? null : originalSeat(room, uid);
    const bySeat = Object.fromEntries(Object.values(players).map(p => [p.seat,p]));
    if (claiming) {
      seat = Array.from({length:capacity(room)},(_,i)=>i).find(i=>!bySeat[i] || bySeat[i].isBot);
    } else if (room.phase === 'lobby') {
      seat = Array.from({length:capacity(room)},(_,i)=>i).find(i=>!bySeat[i]);
    } else if (seat === null) {
      throw new Error('Match sedang berjalan. Hanya pemain yang terdaftar bisa masuk kembali.');
    }
    if (seat == null) throw new Error('Semua kursi sudah terisi.');
    const occupant = bySeat[seat];
    if (occupant && !occupant.isBot) throw new Error('Kursi Anda masih dipakai pemain yang aktif.');
    if (occupant) changes['players/' + occupant.uid] = null;
    changes['players/' + uid] = {uid,nickname,username:username || null,seat,
      isBot:false,isHost:claiming,lastSeen:timestamp};
    if (claiming) { changes.host = uid; changes.hostRequests = null; }
    return {changes,claiming};
  }
  function applyPath(obj, path, value) {
    const parts = path.split('/');
    const last = parts.pop();
    let cur = obj;
    for (const part of parts) {
      if (!cur[part] || typeof cur[part] !== 'object') cur[part] = {};
      cur = cur[part];
    }
    if (value === null) delete cur[last];
    else cur[last] = clone(value);
  }
  function membershipPatch(room, changes) {
    const next = clone(room);
    for (const [path, value] of Object.entries(changes)) applyPath(next, path, value);
    const seats = indexPlayers(next.players, capacity(next));
    const patch = { ...changes };
    for (let seat = 0; seat < 6; seat++) {
      const before = (room.seats || {})[seat] || null;
      const after = seats[seat] || null;
      if (before !== after) patch['seats/' + seat] = after;
    }
    if (room.membershipVersion !== 2) patch.membershipVersion = 2;
    const hasHuman=Object.values(next.players||{}).some(p=>p.isBot===false);
    if(hasHuman&&room.emptySince!=null)patch.emptySince=null;
    else if(!hasHuman&&(room.emptySince==null||Object.values(room.players||{}).some(p=>p.isBot===false)))patch.emptySince={'.sv':'timestamp'};
    return patch;
  }

  // Existing gameplay can keep using the Firebase API. Membership writes are
  // expanded to ONE multi-location update so seat ownership cannot drift.
  // Conflicting reservations are rejected by server rules, not trusted here.
  function databaseBridge(raw) {
    function pathOf(ref) { return decodeURIComponent(new URL(ref.toString()).pathname).replace(/^\/+|\/+$/g, ''); }
    function membershipChange(path) { return /^players(?:\/[^/]+)?$/.test(path) || /^players\/[^/]+\/seat$/.test(path); }
    async function updateRoom(code, changes) {
      const structural = Object.keys(changes).some(membershipChange);
      if (!structural && !Object.hasOwn(changes,'host')) return raw.update(raw.ref(raw.db, 'rooms/' + code), changes);
      const roomRef = raw.ref(raw.db, 'rooms/' + code);
      const snap = await raw.get(roomRef);
      if (!snap.exists()) throw new Error('Room sudah ditutup.');
      const patch = structural ? membershipPatch(snap.val(), changes) : {...changes};
      if (Object.hasOwn(changes,'host') && changes.host !== snap.val().host) patch.hostRequests = null;
      return raw.update(roomRef, patch);
    }
    function route(ref, value, mode) {
      const path = pathOf(ref);
      const match = path.match(/^rooms\/([A-Z0-9]{4,6})(?:\/(.+))?$/);
      if (!match) return raw[mode](ref, value);
      const [, code, sub] = match;
      if (!sub && mode === 'set' && value) {
        const normalized = { ...value, membershipVersion: 2, seats: indexPlayers(value.players, capacity(value)) };
        return raw.set(ref, normalized);
      }
      if (mode === 'update') {
        const changes = Object.fromEntries(Object.entries(value).map(([key, v]) => [sub ? sub + '/' + key : key, v]));
        if (Object.keys(changes).some(membershipChange) || Object.hasOwn(changes,'host')) return updateRoom(code, changes);
      } else if (sub && membershipChange(sub)) {
        return updateRoom(code, { [sub]: mode === 'remove' ? null : value });
      }
      return mode === 'remove' ? raw.remove(ref) : raw[mode](ref, value);
    }
    return {
      set: (ref, value) => route(ref, value, 'set'),
      update: (ref, value) => route(ref, value, 'update'),
      remove: ref => route(ref, null, 'remove'),
    };
  }
  return { ONLINE_MS, HOST_GRACE_MS, capacity, indexPlayers, online, onlineHumans, allBots,
    hostUnavailable, originalSeat, roster, joinPatch, membershipPatch, databaseBridge };
});
