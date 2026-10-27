const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const {scripts,check} = require('../scripts/check-render-safety.cjs');
const Card = require('../game-display.js');
const root = path.join(__dirname,'..');
const html = fs.readFileSync(path.join(root,'truf-multiplayer-v3.html'),'utf8');
const appScripts = scripts(html);
const malicious = '<img src=x onerror="window.__injected=1">';
function environment(names = []) {
  // No resource loading and no production database. Inline handlers would run
  // when dispatched below if sanitization failed.
  const dom = new JSDOM('<!doctype html><body><main></main></body>', {
    url:'http://localhost/', runScripts:'dangerously',
  });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(root,'vendor/dompurify/purify.min.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(root,'game-display.js'),'utf8'));
  w.SUIT_SYMBOLS = {S:'♠',H:'♥',C:'♣',D:'♦'};
  w.SUIT_COLOR = {S:'black',C:'black',H:'red',D:'red'};
  w.SUITS = ['S','H','C','D'];
  w.RANKS = Array.from(Card.ranks);
  for (const name of names) {
    const script = appScripts.find(s => s.ast.body.some(n => n.type==='FunctionDeclaration' && n.id.name===name));
    const node = script.ast.body.find(n => n.type==='FunctionDeclaration' && n.id.name===name);
    w.eval(script.code.slice(node.start,node.end));
  }
  return {dom,w,el:w.document.querySelector('main')};
}
function harmless(w,el) {
  assert.equal(el.querySelector('script,iframe,object,embed,svg,math,style,link,base'),null);
  for (const node of el.querySelectorAll('*')) for (const attr of node.attributes) {
    assert.ok(!/^on/i.test(attr.name),attr.name);
  }
  for (const img of el.querySelectorAll('img')) img.dispatchEvent(new w.Event('error'));
  assert.equal(w.__injected,undefined);
}
test('all four real deck generators render every card and local face/joker image', () => {
  const names=['generateShuffledDeck','generateCekiDeck','generateCangkulDeck','generateTebakDeck'];
  const {dom,w,el}=environment([...names,'setSafeHTML','renderCardInnerHTML','renderCangkulCardEl','renderRemiCardEl','renderRemiSmallCardEl']);
  for (const name of names) {
    const deck=w[name](); assert.equal(deck.length, /Ceki|Cangkul/.test(name)?56:52);
    for (const card of deck) {
      assert.equal(w.GameDisplay.isCard(card),true,JSON.stringify(card));
      const node=w.renderRemiCardEl(card); el.replaceChildren(node);
      if (['J','Q','K','JOKER'].includes(card.rank)) {
        const img=node.querySelector('img'); assert.ok(img,JSON.stringify(card));
        const file=img.getAttribute('src').split('?')[0]; assert.ok(fs.existsSync(path.join(root,file)),file);
        assert.equal(img.complete,false); // resources never loaded by this test
      } else assert.ok(node.textContent.includes(card.rank));
      harmless(w,el);
    }
  }
  dom.window.close();
});
test('rank/suit/joker payloads become inert placeholder cards in actual renderers', () => {
  const {dom,w,el}=environment(['setSafeHTML','renderCardInnerHTML','renderCangkulCardEl','renderRemiCardEl']);
  const cards=[null,{},[],{rank:malicious,suit:'H'},{rank:'J',suit:'H.png" onerror="window.__injected=1'},
    {rank:'A',suit:'constructor'},{rank:2,suit:'H'},{rank:'JOKER',color:malicious},
    {rank:'JOKER',color:'red',suit:'H'},{rank:'K',suit:'H',color:'red'}];
  for(const card of cards){assert.equal(w.GameDisplay.isCard(card),false);w.GameDisplay.setHTML(el,w.renderCardInnerHTML(card));harmless(w,el);assert.equal(el.textContent,'?');
    el.replaceChildren(w.renderRemiCardEl(card));harmless(w,el);assert.equal(el.textContent,'?');}
  dom.window.close();
});
test('sanitizer blocks executable markup, external images, SVG, clobbering and CSS loads', () => {
  const {dom,w,el}=environment();
  for(const payload of [malicious,'<script>window.__injected=1</script>',
    '<svg onload="window.__injected=1"><a href="javascript:alert(1)">X</a></svg>',
    '<iframe srcdoc="<script>parent.__injected=1</script>"></iframe>',
    '<img src="https://attacker.invalid/steal"><img src="data:image/svg+xml,x">',
    '<div style="background:u\\72l(https://attacker.invalid)">X</div>',
    '<div style="background:url(https://attacker.invalid)">X</div>',
    '<div style="background:image-set(\'https://attacker.invalid\' 1x)">X</div>',
    '<style>@import "https://attacker.invalid";</style><form id=attributes><input name=children></form>',
    '<img src="cards/K-H.png" onerror="window.__injected=1">']) {
    w.GameDisplay.setHTML(el,payload);harmless(w,el);
    for(const img of el.querySelectorAll('img[src]'))assert.equal(img.getAttribute('src'),'cards/K-H.png');
    for(const node of el.querySelectorAll('[style]'))assert.ok(!/url|\\|@/i.test(node.getAttribute('style')));
  }
  dom.window.close();
});
test('legitimate generated controls keep IDs, data attributes, styles and working click handlers', () => {
  const {dom,w,el}=environment();
  w.GameDisplay.setHTML(el,'<button id="my-confirm-btn" class="confirm-btn" data-seat="2" style="color:var(--gold)">Konfirmasi</button>');
  const button=el.querySelector('#my-confirm-btn'); assert.equal(button.dataset.seat,'2');
  assert.equal(button.style.color,'var(--gold)'); let clicked=false;button.onclick=()=>clicked=true;button.click();assert.equal(clicked,true);
  w.GameDisplay.setHTML(el,'');assert.equal(el.childElementCount,0);dom.window.close();
});
test('unsupported sanitizer fails closed and never parses markup', () => {
  const {dom,w,el}=environment();
  delete w.DOMPurify;w.eval(fs.readFileSync(path.join(root,'game-display.js'),'utf8'));
  w.GameDisplay.setHTML(el,malicious);assert.equal(el.textContent,malicious);assert.equal(el.children.length,0);dom.window.close();
});
test('meja combo attributes cannot inject markup, including legacy corrupt data', () => {
  const {dom,w,el}=environment(['setSafeHTML','escapeHtml','renderCardInnerHTML','renderCangkulCardEl','renderRemiSmallCardEl','renderRemiMeja']);
  el.id='remiMeja';w.MAX_PLAYERS=4;
  w.renderRemiMeja({remi:{laidDown:{0:[{kind:'" onmouseover="window.__injected=1',cards:[{rank:malicious,suit:'H'}]}]}}},{0:{nickname:malicious}});
  harmless(w,el);assert.equal(el.querySelector('.combo-row').dataset.kind,'dasar');assert.ok(el.textContent.includes(malicious));dom.window.close();
});
test('AST release gate rejects direct HTML writes, including computed names', () => {
  assert.deepEqual(check(html),[]);
  for(const code of ['x.innerHTML=data','x["innerHTML"]=data','x.outerHTML=data','x.insertAdjacentHTML("beforeend",data)']) {
    assert.equal(check('<script>'+code+'</script>').length,1,code);
  }
});
test('actual Tebak status, result ranks and log keep hostile values as text', () => {
  const {dom,w,el}=environment(['setSafeHTML','escapeHtml','renderCardInnerHTML','renderCangkulCardEl','renderRemiCardEl','renderTebakGameView','_tebakCardKey']);
  for(const id of ['tebakRoundNum','tebakDeckCount','tebakDeckLabel','tebakDeckPile','tebakOpponents','tebakAllJadi','tebakSelfInfo','tebakHand','tebakStatus','tebakLogList']){
    const node=w.document.createElement('div');node.id=id;el.appendChild(node);
  }
  Object.assign(w,{mySeat:0,_tebakLastRoundForAnim:null,_tebakLastMyHandKeys:null,
    _tebakNewCardArrivals:{},_tebakAnimClearTimer:null,_tebakStandingsState:'closed',
    sortTebakHandCompare:()=>0,handleLeaveRoom:()=>{},TurnReminder:{set:()=>{}}});
  const state={phase:'playing',players:{u:{seat:0,nickname:'Alice'},v:{seat:1,nickname:'Bob'}},tebak:{
    numPlayers:2,currentPlayer:0,hands:{0:[{rank:'K',suit:'H'}],1:[]},jadi:{0:[{rank:malicious}]},
    lastAction:{type:'guess_hit',by:0,target:1,rank:malicious,count:malicious,four:[malicious]},
    log:[{by:0,target:1,rank:malicious,hit:1,four:[malicious]}]}};
  for(const type of ['guess_hit','guess_miss','four_of_kind']){
    state.tebak.lastAction.type=type;w.renderTebakGameView(state);
    for(const id of ['tebakStatus','tebakLogList','tebakAllJadi']){
      const node=w.document.getElementById(id);harmless(w,node);
      assert.equal(node.querySelector('img'),null);assert.ok(node.textContent.includes(malicious),id);
    }
  }
  dom.window.close();
});
