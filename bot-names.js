(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BotNames = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const pool = Object.freeze(['Lord Luhut', 'Bunda Teddy', 'Fufufafa', 'N. Pigai', 'KDM', "Rudy Mas'ud", 'Dasco']);

  function pick(takenNicknames, random = Math.random) {
    const taken = new Set(takenNicknames);
    const available = pool.filter(name => !taken.has(name));
    const choices = available.length ? available : pool;
    return choices[Math.floor(random() * choices.length)];
  }

  return { pool, pick };
});
