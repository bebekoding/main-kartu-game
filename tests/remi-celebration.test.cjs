const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),Celebration=require('../remi-celebration.js'),{scripts}=require('../scripts/check-render-safety.cjs');
const parsed=scripts(fs.readFileSync(path.join(__dirname,'../truf-multiplayer-v3.html'),'utf8'));
function source(name,variable=false){for(const {code,ast}of parsed){const n=ast.body.find(n=>variable?n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name===name):n.type==='FunctionDeclaration'&&n.id.name===name);if(n)return code.slice(n.start,n.end);}throw Error(name);}
class AudioFake{
  constructor(src){this.src=src;this.paused=true;this.currentTime=0;this.plays=0;this.listeners=new Map();}
  play(){this.plays++;if(this.reject)return Promise.reject(Object.assign(Error('test failure'),{name:this.reject}));this.paused=false;this.emit('playing');return Promise.resolve();}
  pause(){this.paused=true;}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  emit(type){if(type==='ended')this.paused=true;for(const fn of [...(this.listeners.get(type)||[])])fn();}
}
const settle=()=>new Promise(setImmediate);
function setup(){
  const audios=[];class Audio extends AudioFake{constructor(src){super(src);audios.push(this);}}
  const env=vm.createContext({Audio,window:{},localStorage:{getItem:()=>null,setItem:()=>{}}});vm.runInContext(source('Sound',true)+';globalThis.sound=Sound;',env);
  const dom=new JSDOM('<!doctype html><body></body>');
  dom.window.HTMLMediaElement.prototype.play=function(){return Promise.resolve();};dom.window.HTMLMediaElement.prototype.pause=function(){};dom.window.HTMLMediaElement.prototype.load=function(){};
  const audio=new AudioFake(),timers=new Map();let id=0;
  const api=Celebration.create({sound:env.sound,document:dom.window.document,audio,setTimer:fn=>{timers.set(++id,fn);return id;},clearTimer:n=>timers.delete(n)});
  return{sound:env.sound,api,audio,audios,dom,timers,wrap:()=>dom.window.document.querySelector('.remi-close-video-wrap'),bgm:mood=>audios.find(a=>a.src===({game:'2.mp3',end:'end-music.mp3',lobby:'lobby-mbg.mp3'}[mood])),close(){api.destroy();dom.window.close();}};
}
test('actual BGM pauses for the full closing song and resumes only on ended',async()=>{
  const h=setup();h.sound.playBgm('game');await settle();h.api.play({key:'a',heading:{text:'Mifty Menutup JS Fufufafa',tone:'discard'}});await settle();assert.equal(h.bgm('game').paused,true);assert.equal(h.audio.paused,false);
  assert.equal(h.wrap().firstElementChild.className,'remi-close-heading');assert.equal(h.wrap().querySelector('h2').textContent,'Mifty Menutup JS Fufufafa');
  h.sound.playBgm('game');h.sound.unlock();h.sound.setMuted(false);await settle();assert.equal(h.bgm('game').paused,true);
  assert.equal(h.timers.size,0,'no 15-second cutoff');h.wrap().querySelector('video').dispatchEvent(new h.dom.window.Event('ended'));
  assert.equal(h.bgm('game').paused,true);h.audio.emit('ended');await settle();assert.equal(h.bgm('game').paused,false);assert.equal(h.wrap(),null);h.close();
});
test('BGM mood changes queue behind the closing song and use the latest mood',async()=>{
  const h=setup();h.sound.playBgm('game');h.api.play({key:'a'});h.sound.playBgm('end');await settle();assert.equal(h.bgm('end').paused,true);
  h.audio.emit('ended');await settle();assert.equal(h.bgm('end').paused,false);assert.equal(h.bgm('game').paused,true);h.close();
});
test('hide-animation button never stops the song or releases BGM focus',async()=>{
  const h=setup();h.sound.playBgm('game');h.api.play({key:'a'});await settle();h.wrap().querySelectorAll('button')[1].click();
  assert.equal(h.wrap().classList.contains('minimized'),true);assert.equal(h.audio.paused,false);assert.equal(h.bgm('game').paused,true);h.close();
});
test('blocked autoplay exposes a gesture button and does not silently resume BGM',async()=>{
  const h=setup();h.sound.playBgm('game');h.audio.reject='NotAllowedError';h.api.play({key:'a'});await settle();
  assert.equal(h.wrap().dataset.audioState,'blocked');const button=h.wrap().querySelector('button');assert.equal(button.hidden,false);assert.equal(h.bgm('game').paused,true);
  h.audio.reject=null;button.click();await settle();assert.equal(h.wrap().dataset.audioState,'playing');assert.equal(button.hidden,true);
  h.audio.emit('ended');await settle();assert.equal(h.bgm('game').paused,false);h.close();
});
test('decode/network error requires retry or an explicit skip',async()=>{
  const h=setup();h.sound.playBgm('game');h.audio.reject='NotSupportedError';h.api.play({key:'a'});await settle();
  assert.equal(h.wrap().dataset.audioState,'failed');assert.equal(h.bgm('game').paused,true);
  const skip=[...h.wrap().querySelectorAll('button')].find(b=>b.textContent==='Lewati suara');assert.equal(skip.hidden,false);skip.click();await settle();assert.equal(h.bgm('game').paused,false);h.close();
});
test('GIF timeout never cuts off an audio track that is still playing',async()=>{
  const h=setup();h.sound.playBgm('game');h.api.play({key:'a',mode:'gif'});await settle();assert.ok(h.audio.src.includes('close-deck.mp3'));assert.ok(h.wrap().querySelector('img'));
  for(const fn of h.timers.values())fn();assert.equal(h.api.isActive(),true);assert.equal(h.bgm('game').paused,true);
  h.audio.emit('ended');await settle();assert.equal(h.api.isActive(),false);assert.equal(h.bgm('game').paused,false);h.close();
});
test('video failure falls back to the larger GIF without releasing song focus',async()=>{
  const h=setup();h.sound.playBgm('game');h.api.play({key:'a'});await settle();h.wrap().querySelector('video').dispatchEvent(new h.dom.window.Event('error'));
  assert.ok(h.wrap().querySelector('img'));assert.equal(h.audio.paused,false);assert.equal(h.bgm('game').paused,true);h.close();
});
test('mute and SFX-volume preferences apply immediately without restarting BGM',async()=>{
  const h=setup();h.sound.playBgm('game');h.api.play({key:'a'});await settle();h.sound.setSfxVol(0.25);assert.equal(h.audio.volume,0.25);
  h.sound.setMuted(true);assert.equal(h.audio.muted,true);h.sound.setMuted(false);await settle();assert.equal(h.audio.muted,false);assert.equal(h.bgm('game').paused,true);
  h.sound.setSfxVol(0);assert.equal(h.audio.volume,0);h.close();
});
test('leaving stops media and ignores stale ended callbacks without restarting old-room music',async()=>{
  const h=setup();h.sound.playBgm('game');h.api.play({key:'a'});await settle();const stale=[...h.audio.listeners.get('ended')][0];h.api.stop();stale();await settle();
  assert.equal(h.audio.paused,true);assert.equal(h.wrap(),null);assert.equal(h.bgm('game').paused,true);h.sound.playBgm('lobby');await settle();assert.equal(h.bgm('lobby').paused,false);h.close();
});
test('replacing an animation cannot resume BGM between songs; duplicate event is ignored',async()=>{
  const h=setup();h.sound.playBgm('game');await settle();h.api.play({key:'a'});await settle();const old=[...h.audio.listeners.get('ended')][0];
  h.api.play({key:'a'});assert.equal(h.audio.plays,1);h.api.play({key:'b'});await settle();old();assert.equal(h.bgm('game').plays,1);assert.equal(h.api.isActive(),true);
  h.audio.emit('ended');await settle();assert.equal(h.bgm('game').plays,2);h.close();
});
test('gesture priming cannot pause a celebration started before the prime promise resolves',async()=>{
  const h=setup();h.api.unlock();h.api.play({key:'a'});await settle();assert.equal(h.audio.paused,false);assert.equal(h.audio.volume,0.8);h.close();
});
test('real room-event helper deduplicates final standings and permits a new round for player or spectator',()=>{
  for(const spectator of [false,true]){
    const calls=[],env=vm.createContext({isSpectator:spectator,_remiCloseMediaSeen:new Set(),showRemiCloseVideo:key=>calls.push(key)});vm.runInContext(source('maybeShowRemiCelebration'),env);
    vm.runInContext(source('remiRoundHeading'),env);
    const room={code:'ABCD',game:'remi',phase:'remi_end',remi:{closedBy:0,roundNumber:1,lastDrawnAt:10}};
    env.maybeShowRemiCelebration(room);env.maybeShowRemiCelebration(room);room.phase='remi_tournament_end';env.maybeShowRemiCelebration(room);assert.equal(calls.length,1);
    room.phase='remi_end';room.remi.roundNumber=2;room.remi.lastDrawnAt=20;env.maybeShowRemiCelebration(room);assert.equal(calls.length,2);
    room.remi.closedBy=null;env.maybeShowRemiCelebration(room);assert.equal(calls.length,2);
  }
});
test('shared round heading includes the closing card and all punished players in seat order',()=>{
  const env=vm.createContext({});vm.runInContext(source('remiRoundHeading'),env);
  const room={players:{c:{seat:2,nickname:'C'},a:{seat:0,nickname:'A'},b:{seat:1,nickname:'B'}},remi:{closedBy:0,closeMethod:'discard',discard:[{card:{rank:'J',suit:'S'}}],helperDelta:{0:100,1:-100,2:-150}}};
  assert.equal(env.remiRoundHeading(room).text,'A Menutup JS B & C');
  room.remi.closeMethod='deck';assert.equal(env.remiRoundHeading(room).text,'A Menutup Dari Cabutan');
  room.remi.closedBy=null;assert.equal(env.remiRoundHeading(room).text,'Ronde Selesai');
});
test('caption names remain inert text and disappear with the GIF and audio',async()=>{
  const h=setup(),text='<img src=x onerror=alert(1)> Menutup Joker A & B';h.api.play({key:'a',mode:'gif',heading:{text,tone:'discard'}});await settle();
  const caption=h.wrap().querySelector('h2');assert.equal(caption.textContent,text);assert.equal(caption.querySelector('img,script,svg'),null);
  assert.ok(h.wrap().querySelector('.remi-close-media img'));h.audio.emit('ended');await settle();assert.equal(caption.isConnected,false);assert.equal(h.wrap(),null);h.close();
});
