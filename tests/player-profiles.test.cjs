const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),P=require('../player-profiles.js'),UI=require('../profile-ui.js'),{scripts}=require('../scripts/check-render-safety.cjs');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'truf-multiplayer-v3.html'),'utf8'),parsed=scripts(html);
function source(name){for(const {ast,code}of parsed){const n=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);if(n)return code.slice(n.start,n.end);}throw Error(name);}
const settle=()=>new Promise(setImmediate);
test('4–16 letters, digits and keyboard symbols are valid without trimming or key conversion',()=>{
  for(const value of ['Abcd','A'.repeat(16),'1234','!!!!','.#[]','/@#$','<>"\'','MiFty_07!'])assert.equal(P.validName(value),true,value);
  for(const value of ['', 'abc','a'.repeat(17),'ab cd','abcd\n',' abcde','abcd ','abcd\t','ab\u00a0cd','ab\u200bcd','ab\u202ecd','ab\x00cd','ab\x7fcd',null,1234])assert.equal(P.validName(value),false,String(value));
});
test('only sixteen curated IDs resolve to avatars; URL and class injection cannot be used',()=>{
  assert.equal(P.ICONS.length,16);assert.equal(new Set(P.ICONS.map(i=>i.id)).size,16);
  assert.equal(P.fallbackIcon('p0'),P.fallbackIcon('p0'));
  for(const value of ['https://bad/image.png','x y','<img>',null])assert.equal(P.validIcon(value),false);
  const dom=new JSDOM('<body>'),el=P.avatar(dom.window.document,'x onclick=bad',false);
  assert.equal(el.className,'player-avatar avatar-konoha');assert.equal(el.hasAttribute('onclick'),false);dom.window.close();
});
test('decorating a saved room changes display only; original identity, seats, cards, scores and ranking survive',()=>{
  const room={host:'p0',rankedMatchId:'a'.repeat(32),seats:{0:'p0'},players:{p0:{uid:'p0',username:'old-login',nickname:'Old',seat:0,isBot:false},bot:{uid:'bot',nickname:'Bot',seat:1,isBot:true}},
    savedGame:{humans:{0:'p0'}},totals:{0:42},remi:{hands:{0:[{rank:'K',suit:'H'}]}}};
  const before=structuredClone(room),decorated=P.decorateRoom(room,{p0:{displayName:'New.Name!','avatarId':'strawhat'},bot:{displayName:'NotABot','avatarId':'blueeye'}});
  assert.equal(decorated.players.p0.nickname,'New.Name!');assert.equal(decorated.players.p0.username,'old-login');assert.equal(decorated.players.bot.nickname,'Bot');
  assert.deepEqual(room,before);for(const key of ['host','rankedMatchId','seats','savedGame','totals','remi'])assert.deepEqual(decorated[key],before[key]);
});
function harness(){
  const dom=new JSDOM(html,{url:'https://local.invalid/remi'}),doc=dom.window.document,writes=[],events=[],watchers=[];
  let actor='p0',fail=false,loadResolve=null;
  const profiles={p0:{displayName:'Mifty_07',avatarId:'konoha',updatedAt:1}};
  const fb={authUid:'p0',db:{},ref:(_,p)=>p,serverTimestamp:()=>({'.sv':'timestamp'}),
    onValue:(_,fn)=>{watchers.push(fn);return()=>events.push('unsubscribe');},
    get:async p=>{if(loadResolve)return new Promise(r=>{loadResolve=r;});return{exists:()=>!!profiles[p.split('/')[1]],val:()=>structuredClone(profiles[p.split('/')[1]])};},
    set:async(p,v)=>{if(fail)throw Error('offline');writes.push({p,v});profiles[p.split('/')[1]]=structuredClone(v);}};
  const api=UI.create(fb,{document:doc,uid:()=>actor,loginName:()=>actor==='p0'?'old_login':'second',fallbackName:()=>actor==='p0'?'old_login':'second',changed:()=>events.push('changed'),saved:()=>events.push('saved')});
  api.start();watchers[0]({val:()=>structuredClone(profiles)});
  const input=doc.getElementById('profileNameInput');
  const type=value=>{input.value=value;input.dispatchEvent(new dom.window.Event('input'));};
  return{dom,doc,api,fb,writes,events,profiles,watchers,input,type,fail:v=>{fail=v;},identity:value=>{actor=value;fb.authUid=value;},close(){api.stop();dom.window.close();}};
}
test('actual profile UI saves chosen template and symbolic name under UID, never under login or leaderboard keys',async()=>{
  const h=harness();await h.api.open();assert.equal(h.doc.querySelectorAll('.profile-icon-choice').length,16);
  assert.match(h.doc.getElementById('profileLoginName').textContent,/old_login/);
  h.type('Ace@#[]!');h.doc.querySelector('[data-avatar-id="strawhat"]').click();await h.api.submit();
  assert.deepEqual(h.writes,[{p:'profiles/p0',v:{displayName:'Ace@#[]!',avatarId:'strawhat',updatedAt:{'.sv':'timestamp'}}}]);
  assert.equal(h.doc.getElementById('profileModal').hidden,true);assert.ok(h.events.includes('saved'));
  assert.match(h.doc.querySelector('[data-profile-open]').textContent,/Ace@#\[\]!/);h.close();
});
test('cancel discards edits, invalid names disable save, and a network failure keeps the draft',async()=>{
  const h=harness();await h.api.open();h.type('Too Long Profile Name');assert.equal(h.doc.getElementById('profileSaveBtn').disabled,true);
  await h.api.submit();assert.equal(h.writes.length,0);h.type('Valid_01');h.doc.getElementById('profileCancelBtn').click();assert.equal(h.writes.length,0);
  await h.api.open();assert.equal(h.input.value,'Mifty_07');h.type('New.Name!');h.fail(true);await h.api.submit();
  assert.equal(h.writes.length,0);assert.equal(h.doc.getElementById('profileModal').hidden,false);assert.equal(h.input.value,'New.Name!');assert.match(h.doc.getElementById('profileError').textContent,/belum tersimpan/);h.close();
});
test('random selection stays within templates and rendered profile names are plain text',async()=>{
  const h=harness();await h.api.open();h.type('<b>Ace!</b>');h.doc.getElementById('profileRandomBtn').click();
  assert.equal(h.doc.getElementById('profilePreview').querySelector('b'),null);assert.match(h.doc.getElementById('profilePreview').textContent,/<b>Ace!<\/b>/);
  const selected=h.doc.querySelector('.profile-icon-choice[aria-pressed="true"]');assert.ok(P.validIcon(selected.dataset.avatarId));assert.notEqual(selected.dataset.avatarId,'konoha');h.close();
});
test('avatar observer restores avatars after game render, updates icons and never duplicates them',async()=>{
  const h=harness(),name=h.doc.createElement('div');name.dataset.profileUid='p0';name.textContent='Mifty_07';h.doc.body.append(name);await settle();
  assert.equal(name.querySelectorAll('.player-avatar').length,1);assert.ok(name.querySelector('.avatar-konoha'));
  name.textContent='New.Name!';await settle();assert.equal(name.querySelectorAll('.player-avatar').length,1);
  h.profiles.p0.avatarId='scout';h.watchers[0]({val:()=>structuredClone(h.profiles)});await settle();assert.ok(name.querySelector('.avatar-scout'));assert.equal(name.querySelectorAll('.player-avatar').length,1);h.close();
});
test('stale profile callbacks cannot affect a different logged-in account',async()=>{
  const h=harness(),stale=h.watchers[0];h.identity('p1');h.api.start();const count=h.events.length;
  stale({val:()=>({p0:{displayName:'Stale!!!',avatarId:'reaper'}})});assert.equal(h.events.length,count);assert.equal(h.api.profiles.p0,undefined);
  h.doc.querySelector('[data-profile-open]').click();await settle();assert.match(h.doc.getElementById('profileLoginName').textContent,/second/);h.close();
});
test('an older profile load cannot overwrite a newly opened edit session',async()=>{
  const h=harness(),pending=[];h.fb.get=()=>new Promise(resolve=>pending.push(resolve));
  const first=h.api.open();h.api.close();const second=h.api.open();
  pending[1]({exists:()=>true,val:()=>({displayName:'Current!',avatarId:'scout'})});await second;h.type('MyDraft!');
  pending[0]({exists:()=>true,val:()=>({displayName:'Stale!!!',avatarId:'reaper'})});await first;
  assert.equal(h.input.value,'MyDraft!');assert.equal(h.doc.getElementById('profileModal').hidden,false);h.close();
});
test('existing auth email mapping and ranking identity remain independent from a profile name',()=>{
  const env=vm.createContext({AUTH_EMAIL_DOMAIN:'@mainkartu.local'});vm.runInContext(source('sanitizeKey')+'\n'+source('authEmailFor'),env);
  const login='old_login',before=env.authEmailFor(login),p={uid:'p0',username:login,nickname:login};
  const r=P.decorateRoom({players:{p0:p}},{p0:{displayName:'New.Name!',avatarId:'strawhat'}});
  assert.equal(r.players.p0.username,login);assert.equal(env.authEmailFor(r.players.p0.username),before);assert.equal(r.players.p0.nickname,'New.Name!');
});
test('actual leaderboard renderer resolves current profile name and UID icon without changing match totals',async()=>{
  const h=harness();h.doc.defaultView.PlayerProfiles=P;h.doc.defaultView.GameDisplay=null;
  const context=vm.createContext({document:h.doc,PlayerProfiles:P,_profileRankGame:null,myUsername:'old_login',
    getProfileController:()=>h.api,escapeHtml:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    setSafeHTML:(el,s)=>{const template=h.doc.createElement('template');template.innerHTML=s;el.replaceChildren(template.content);},
    fb:{db:{},ref:(_,p)=>p,get:async()=>({exists:()=>true,val:()=>({old_login:{authUid:'p0',username:'old_login',name:'Old',matches:3,points:9}})})}});
  vm.runInContext(source('openRankModal'),context);await context.openRankModal('remi');await settle();
  const body=h.doc.getElementById('rankModalBody');assert.match(body.textContent,/Mifty_07/);assert.match(body.textContent,/3\.00/);assert.equal(body.querySelector('[data-profile-uid]').dataset.profileUid,'p0');assert.equal(h.writes.length,0);h.close();
});
