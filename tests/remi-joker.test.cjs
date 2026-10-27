const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),{scripts}=require('../scripts/check-render-safety.cjs');
const html=fs.readFileSync(path.join(__dirname,'../truf-multiplayer-v3.html'),'utf8'),parsed=scripts(html);
const card=(rank,suit='D')=>({rank:String(rank),suit}),joker=color=>({rank:'JOKER',suit:null,color:color||'black'});
const dasar=(suit='S')=>({kind:'dasar',cards:[8,9,10].map(rank=>card(rank,suit))});
const run=(ranks,suit='D')=>ranks.map(rank=>card(rank,suit));
const names=['isValidDasar','isValidPararel','isPureRemiCombo','findOneDasarInHand','findOnePararelInHand','findAllDasarsInHand','pendingPickupCardsInHand','tryJokerSubstitutedCombo','canDeepestFormCombo','enumerateOneJokerCandidates','bestJokerExtension','findAllJokerAwareCombos','remiCardValue','remiRankValue','comboTotalValue','handleRemiPickupDiscard','handleRemiLayDown','handleRemiDiscard','maybeResolveRemiRound','openRemiPickupModal'];
function source(name){for(const {ast,code}of parsed){const n=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);if(n)return code.slice(n.start,n.end);}throw Error(name);}
function harness(extra={}){
  const errors=[],env={mySeat:0,MAX_PLAYERS:4,myUid:'p0',currentRoom:'ABCD',_remiDrawInFlight:false,_remiGlowTurn:0,remiResolveScheduled:false,
    remiSelectedIndices:new Set(),remiCekiExpanded:false,Sound:{cardReveal:()=>{},cardDrop:()=>{}},
    console:{log:()=>{},warn:()=>{},error:(...args)=>errors.push(args.map(String).join(' '))},...extra};
  vm.createContext(env);vm.runInContext("const REMI_RANK_NUM={ '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,J:11,Q:12,K:13,A:14 };\n"+names.map(source).join('\n'),env);
  return{env,errors};
}
function pickupRoom(laid=[dasar()]){return{remi:{laidDown:{0:laid}}};}
function handScore(hand,laid=[]){
  const {env}=harness();const pureLaid=laid.some(co=>co.kind==='dasar'&&env.isPureRemiCombo(co));
  const pureHand=env.findAllDasarsInHand(hand).combos.length>0;
  const result=env.findAllJokerAwareCombos(hand,laid.some(co=>co.kind==='dasar')||pureHand,pureLaid||pureHand,pureLaid);
  return{...result,jadi:result.combos.reduce((s,co)=>s+env.comboTotalValue(co),0),dead:result.remaining.reduce((s,c)=>s+env.remiCardValue(c),0)};
}
test('reported pickup: J-heart and joker use deepest J-diamond and leave J-spade to close',()=>{
  const {env}=harness();assert.equal(env.canDeepestFormCombo(card('J','D'),[card('J','H'),joker()],[card('J','S')],pickupRoom()),true);
});
test('pickup result is independent of hand, shallower-card and joker ordering',()=>{
  const {env}=harness(),h=[card('J','H'),joker()],other=[card('J','S'),card('10','C')];
  for(const hand of [h,h.slice().reverse()])for(const taken of [other,other.slice().reverse()]){
    assert.equal(env.canDeepestFormCombo(card('J','D'),hand,taken,pickupRoom()),true);
  }
});
test('joker pickups still require own pure dasar already laid, not a candidate or opponent dasar',()=>{
  const {env}=harness(),deep=card('J','D'),h=[card('J','H'),joker()],other=[card('J','S')];
  for(const room of [pickupRoom([]),{remi:{laidDown:{1:[dasar()]}}},pickupRoom([{kind:'dasar',cards:[card('8','S'),card('9','S'),joker()]}])]){
    assert.equal(env.canDeepestFormCombo(deep,h,other,room),false);
  }
});
test('joker pickup keeps two original hand cards, a non-joker support and one discard',()=>{
  const {env}=harness();assert.equal(env.canDeepestFormCombo(card('J','S'),[card('J','H'),joker()],[],pickupRoom()),false);
  assert.equal(env.canDeepestFormCombo(card('J','D'),[joker(),card('2','C')],[card('J','S')],pickupRoom()),false);
  assert.equal(env.canDeepestFormCombo(card('J','D'),[joker(),joker('red'),card('2','C')],[],pickupRoom()),false);
});
test('joker dasar may leave a shallower natural card as discard rather than greedily consume it',()=>{
  const {env}=harness();assert.equal(env.canDeepestFormCombo(card('2'),[card('3'),joker()],[card('4')],pickupRoom()),true);
  assert.equal(env.canDeepestFormCombo(card('3'),[card('2'),joker()],[card('4')],pickupRoom()),true);
});
test('pickup respects suit uniqueness, rank bands, ace restriction and explicit bot seat',()=>{
  const {env}=harness();assert.equal(env.canDeepestFormCombo(card('J','D'),[card('J','D'),joker()],[card('2','S')],pickupRoom()),false);
  assert.equal(env.canDeepestFormCombo(card('J','D'),[card('10'),joker()],[card('2','S')],pickupRoom()),false);
  assert.equal(env.canDeepestFormCombo(card('A','D'),[card('2'),joker()],[card('3')],pickupRoom()),false);
  assert.equal(env.canDeepestFormCombo(card('J','D'),[card('J','H'),joker()],[card('J','S')],{remi:{laidDown:{2:[dasar()]}}},2),true);
});
test('both reported number hands score +20 with an independent pure dasar on table',()=>{
  for(const ranks of [[2,3,5],[2,3,4]]){
    const scored=handScore([...run(ranks),joker()],[dasar()]);assert.equal(scored.jadi,20);assert.equal(scored.dead,0);
  }
});
test('a pure run cannot be its own anchor for a joker extension',()=>{
  const scored=handScore([...run([2,3,4]),joker()]);assert.equal(scored.jadi,15);assert.equal(scored.dead,25);
});
test('another pure dasar in hand can anchor a joker, and that anchor remains pure',()=>{
  const scored=handScore([...run([8,9,10],'S'),...run([2,3,4]),joker()]);
  assert.equal(scored.jadi,35);assert.equal(scored.dead,0);
  assert.ok(scored.combos.some(co=>co.kind==='dasar'&&!co.cards.some(c=>c.rank==='JOKER')));
});
test('multiple jokers cannot consume the final independent anchor or share one combo',()=>{
  const hand=[...run([8,9,10],'S'),...run([2,3,4]),joker(),joker('red')];
  const scored=handScore(hand);assert.equal(scored.jadi,35);assert.equal(scored.dead,25);
  assert.ok(scored.combos.every(co=>co.cards.filter(c=>c.rank==='JOKER').length<=1));
  const external=handScore(hand,[dasar('C')]);assert.equal(external.jadi,40);assert.equal(external.dead,0);
});
test('a joker cannot extend a full rank band, full pararel or four-ace dasar',()=>{
  for(const hand of [[...run(['J','Q','K']),joker()], [...run([2,3,4,5,6,7,8,9,10]),joker()], [...['S','H','D','C'].map(s=>card('J',s)),joker()], [...['S','H','D','C'].map(s=>card('A',s)),joker()]]){
    assert.equal(handScore(hand,[dasar('C')]).dead,25);
  }
});
test('pararel and gap-completion scoring reuse the separate anchor and substituted rank value',()=>{
  for(const hand of [[card('J','S'),card('J','D'),card('J','H'),joker()], [card('Q','D'),card('K','D'),joker()]]){
    const scored=handScore(hand,[dasar()]);assert.equal(scored.jadi,hand.length*10);assert.equal(scored.dead,0);
  }
});
test('scoring preserves card identity and never counts or mutates a card twice',()=>{
  const hand=[...run([8,9,10],'S'),...run([2,3,4]),joker(),joker('red')],before=JSON.stringify(hand),scored=handScore(hand,[dasar('C')]);
  const used=scored.combos.flatMap(co=>Array.from(co.cards)).concat(Array.from(scored.remaining));
  assert.equal(new Set(used).size,hand.length);assert.equal(used.length,hand.length);assert.equal(JSON.stringify(hand),before);
});
function state(){return{code:'ABCD',game:'remi',host:'p0',phase:'playing',players:Object.fromEntries([0,1,2,3].map(seat=>['p'+seat,{uid:'p'+seat,seat,nickname:'P'+seat,isBot:seat>0}])),totals:{0:0,1:0,2:0,3:0},remi:{sessionNumber:1,roundNumber:1,currentPlayer:0,turnPhase:'draw',deck:[card('2','S')],hands:{0:[card('J','H'),joker()],1:[card('4','H')],2:[card('5','S')],3:[card('6','C')]},laidDown:{0:[dasar()]},discard:[{card:card('10','C'),by:2},{card:card('10','H'),by:3},{card:card('J','D'),by:1},{card:card('J','S'),by:2}]}};}
function engine(initial=state()){
  const room=structuredClone(initial),timers=[];
  const apply=patch=>{for(const [key,value]of Object.entries(patch)){const parts=key.split('/'),last=parts.pop();let node=room;for(const part of parts)node=node[part]||(node[part]={});if(value===null)delete node[last];else node[last]=structuredClone(value);}};
  const h=harness({_lastRoom:room,setTimeout:fn=>{timers.push(fn);return timers.length;},sortCangkulCardCompare:()=>0,checkAndResolveStuck:()=>{},fbGetRoomWithTimeout:async()=>({exists:true,val:structuredClone(room)}),
    fb:{db:{},ref:(_,p)=>p,serverTimestamp:()=>Date.now(),get:async()=>({exists:()=>true,val:()=>structuredClone(room)}),update:async(_ref,patch)=>apply(patch)}});
  return{...h,room,timers};
}
test('actual pickup → lay joker pararel → J-spade closing discard → round resolver',async()=>{
  const h=engine(),e=h.env;await e.handleRemiPickupDiscard(h.room,2);assert.equal(h.room.remi.hands[0].length,4);
  for(const [i,c]of h.room.remi.hands[0].entries())if(c.rank==='JOKER'||c.suit==='H'||c.suit==='D')e.remiSelectedIndices.add(i);
  await e.handleRemiLayDown(h.room,'pararel');assert.equal(h.room.remi.hands[0].length,1);assert.equal(h.room.remi.hands[0][0].suit,'S');
  assert.equal(e.pendingPickupCardsInHand(h.room.remi,0).length,0);
  await e.handleRemiDiscard(h.room,0,h.room.remi.hands[0][0]);assert.equal(h.room.remi.closedBy,0);assert.equal(h.room.remi.closeMethod,'discard');
  e.maybeResolveRemiRound(h.room);await h.timers.shift()();assert.equal(h.room.phase,'remi_end');assert.equal(h.room.remi.endReason,'closed');
  assert.equal(h.room.remi.laidBonus[0],45);assert.equal(h.room.remi.helperDelta[0],100);assert.equal(h.room.remi.helperDelta[1],-150);assert.equal(h.room.remi.helperDelta[2],0);
  assert.deepEqual(h.errors,[]);
});
test('actual round resolver records both reported hands as +20 and zero dead-card penalty',async()=>{
  for(const ranks of [[2,3,5],[2,3,4]]){
    const initial=state();initial.remi.deck=[];initial.remi.hands[0]=[...run(ranks),joker()];const h=engine(initial);
    h.env.maybeResolveRemiRound(h.room);await h.timers.shift()();assert.equal(h.room.remi.handJadi[0],20);assert.equal(Math.abs(h.room.remi.handTidakJadi[0]),0);assert.equal(h.room.totals[0],35);assert.deepEqual(h.errors,[]);
  }
});
test('actual pickup dialog enables exactly the valid depth in the screenshot',()=>{
  const dom=new JSDOM('<div id="remiPickupModal"><div id="remiPickupOptions"></div><button id="remiPickupCancelBtn"></button></div>');
  const h=harness({document:dom.window.document,setSafeHTML:(el)=>el.replaceChildren(),showRemiOverlay:()=>{},hideRemiOverlay:()=>{},renderRemiSmallCardEl:c=>{const el=dom.window.document.createElement('span');el.textContent=c.rank;return el;}});
  const r=state();h.env.openRemiPickupModal(r,r.remi.discard);
  assert.deepEqual([...dom.window.document.querySelectorAll('#remiPickupOptions > button')].map(b=>b.disabled),[true,false,true,true]);dom.window.close();
});
