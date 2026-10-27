/* HTML is assembled by the legacy UI, but enters the DOM only through this
 * boundary. DOMPurify is pinned and served locally, before the application.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameDisplay = api;
})(typeof window === 'object' ? window : globalThis, function (root) {
  'use strict';
  const purifier = root.DOMPurify;
  const ranks = Object.freeze(['2','3','4','5','6','7','8','9','10','J','Q','K','A']);
  const suits = Object.freeze(['S','H','C','D']);
  const cssFunctions = new Set(['rgb','rgba','hsl','hsla','var','calc','min','max','clamp',
    'linear-gradient','radial-gradient','repeating-linear-gradient','repeating-radial-gradient',
    'translate','translatex','translatey','scale']);
  function isCard(card) {
    if (!card || typeof card !== 'object' || Array.isArray(card)) return false;
    if (card.rank === 'JOKER') {
      return card.suit == null && (card.color === 'red' || card.color === 'black');
    }
    return ranks.includes(card.rank) && suits.includes(card.suit) && card.color == null;
  }
  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, ch => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    })[ch]);
  }
  if (purifier && purifier.isSupported) {
    purifier.addHook('uponSanitizeAttribute', function (_node, attribute) {
      // Generated card art is the only image source used by dynamic UI.
      // No remote requests, executable URLs, or CSS resource loads from data.
      if (attribute.attrName === 'src' &&
          !/^cards\/(?:(?:J|Q|K)-[SHCD]|JOKER-(?:RED|BLACK))\.png(?:\?v=2)?$/.test(attribute.attrValue)) {
        attribute.keepAttr = false;
      }
      if (attribute.attrName === 'style' &&
          (/url|expression|behavior|binding|@|\\|\/\*|[<>]/i.test(attribute.attrValue) ||
           [...attribute.attrValue.matchAll(/([-a-z0-9]+)\s*\(/gi)]
             .some(match => !cssFunctions.has(match[1].toLowerCase())))) {
        attribute.keepAttr = false;
      }
    });
  }
  function setHTML(element, markup) {
    if (!element) return;
    if (markup == null || markup === '') { element.replaceChildren(); return; }
    if (!purifier || !purifier.isSupported) {
      // Never fall back to unfiltered markup on an unsupported browser.
      element.textContent = String(markup == null ? '' : markup);
      return;
    }
    const fragment = purifier.sanitize(String(markup == null ? '' : markup), {
      ALLOWED_TAGS: ['div','span','b','strong','i','em','small','br','img','button',
        'label','input','select','option','table','thead','tbody','tr','th','td',
        'p','h2','h3','h4','ul','ol','li'],
      ALLOWED_ATTR: ['id','class','style','title','alt','src','draggable','disabled',
        'type','value','role','tabindex','colspan','rowspan'],
      ALLOW_DATA_ATTR: true,
      ALLOW_ARIA_ATTR: true,
      RETURN_DOM_FRAGMENT: true,
    });
    // Do not concatenate or reparse the sanitized fragment after this point.
    element.replaceChildren(fragment);
  }
  return Object.freeze({ isCard, escapeHTML, setHTML, ranks, suits });
});
