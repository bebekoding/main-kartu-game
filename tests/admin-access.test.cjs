const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {scripts} = require('../scripts/check-render-safety.cjs');
const html = fs.readFileSync(path.join(__dirname,'../truf-multiplayer-v3.html'),'utf8');
const parsed = scripts(html);
function source(name) {
  for (const {ast,code} of parsed) {
    const node=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);
    if(node)return code.slice(node.start,node.end);
  }
  throw Error('Missing actual function '+name);
}
const core=['hasAdminAccess','revokeAdminAccess','verifyAdminAccess','clearAdminSession'];
function setup(names=[]) {
  const nodes=new Map(),events={},watchers=[],writes=[],state={authVisible:false,adminLoads:0,stopped:0,exits:0,unsubscribes:0};
  function el(id) {
    if(!nodes.has(id)){
      const classes=new Set(['hidden']);
      nodes.set(id,{id,value:'',textContent:'',style:{},classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)},focus:()=>{},addEventListener:()=>{}});
    }
    return nodes.get(id);
  }
  const snap=value=>({exists:()=>value!=null,val:()=>value});
  const env={console,Promise,Set,Map,Date,Error,
    document:{getElementById:el,querySelectorAll:()=>[]},
    addEventListener:(name,fn)=>events[name]=fn,
    myUid:'admin',myUsername:'',myNickname:'',isSpectator:false,_spectatorOrigin:null,
    LOGIN_FAIL_MSG:'Login gagal',AUTH_EMAIL_DOMAIN:'@mainkartu.local',
    authEmailFor:u=>u+'@mainkartu.local',sanitizeKey:u=>u,
    setSafeHTML:(node,text)=>node.textContent=text,
    stopAdminRoomsAutoRefresh:()=>state.stopped++,startAdminRoomsAutoRefresh:()=>{},
    startAutoCleanup:()=>{},stopAutoCleanup:()=>{},
    showAuthView:()=>state.authVisible=true,
    authSetError:msg=>state.error=msg,
    loadAdminRoomList:()=>state.adminLoads++,loadAdminUserList:()=>state.adminLoads++,
    handleExitSpectator:()=>{state.exits++;env.isSpectator=false;},
    setTimeout:()=>{},showVoluntaryPasswordChange:()=>{},
    localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},
    fb:{db:{},authUid:'admin',currentUser:{uid:'admin',email:'__admin__@mainkartu.local'},
      ref:(_,p)=>p,get:async()=>snap('admin'),
      onValue:(_ref,next,error)=>{const row={next,error};watchers.push(row);return()=>{row.stopped=true;state.unsubscribes++;};},
      set:async(...args)=>writes.push(args),update:async(...args)=>writes.push(args),remove:async(...args)=>writes.push(args),
      signIn:async()=>({user:env.fb.currentUser}),
    },
  };
  env.window=env;env.firebase=env.fb;
  const context=vm.createContext(env);
  vm.runInContext("const ADMIN_USERNAME='__admin__';let _adminAccessUid=null,_adminAccessUnsubscribe=null,_adminAccessGeneration=0;\n"+
    [...new Set([...core,...names])].map(source).join('\n'),context);
  for(const {ast,code} of parsed){const listener=ast.body.find(n=>n.type==='ExpressionStatement'&&code.slice(n.start,n.end).startsWith("window.addEventListener('firebase-identity-changed'"));if(listener)vm.runInContext(code.slice(listener.start,listener.end),context);}
  return {env,el,state,watchers,writes,snap,events,context};
}
test('valid administrator logs in through Auth and reads UID, never writes a hash/session',async()=>{
  const h=setup(['doLogin','showAdminView']);h.el('loginUsername').value='__admin__';h.el('loginPassword').value='dummy-local-test-password';
  let signed=0,paths=[];h.env.fb.signIn=async(email,password)=>{signed++;assert.equal(email,'__admin__@mainkartu.local');assert.equal(password,'dummy-local-test-password');return{user:h.env.fb.currentUser};};
  h.env.fb.get=async p=>{paths.push(p);return h.snap('admin');};
  await h.env.doLogin();
  assert.equal(signed,1);assert.deepEqual(paths,['config/adminUid']);assert.equal(h.env.hasAdminAccess(),true);
  assert.equal(h.el('adminView').classList.contains('hidden'),false);assert.equal(h.env.myUsername,'__admin__');assert.deepEqual(h.writes,[]);
});
test('a normal account cannot open the admin UI through username, storage or function call',async()=>{
  const h=setup(['showAdminView']);h.env.fb.authUid='normal';h.env.fb.currentUser={uid:'normal',email:'normal@mainkartu.local'};
  h.env.myUsername='__admin__';h.env.localStorage.getItem=()=>'{"username":"__admin__","admin":true}';
  assert.equal(await h.env.verifyAdminAccess(),false);assert.equal(h.env.showAdminView(),false);
  assert.equal(h.state.adminLoads,0);assert.equal(h.el('adminView').classList.contains('hidden'),true);
});
test('wrong UID, denied read and network failure never grant administrator UI',async()=>{
  for(const response of ['other',null,'deny']){
    const h=setup(['showAdminView']);h.env.fb.get=async()=>{if(response==='deny')throw Error('PERMISSION_DENIED');return h.snap(response);};
    assert.equal(await h.env.verifyAdminAccess(),false);assert.equal(h.env.showAdminView(),false);assert.equal(h.state.adminLoads,0);
  }
});
test('identity changed during an async permission check cannot receive its grant',async()=>{
  const h=setup();let finish;h.env.fb.get=()=>new Promise(resolve=>finish=resolve);
  const pending=h.env.verifyAdminAccess();h.env.fb.authUid='normal';h.env.fb.currentUser={uid:'normal',email:'normal@mainkartu.local'};finish(h.snap('admin'));
  assert.equal(await pending,false);assert.equal(h.env.hasAdminAccess(),false);assert.equal(h.watchers.length,0);
});
test('overlapping checks keep only the latest permission request',async()=>{
  const h=setup();const completions=[];h.env.fb.get=()=>new Promise(resolve=>completions.push(resolve));
  const first=h.env.verifyAdminAccess(),second=h.env.verifyAdminAccess();completions[1](h.snap('admin'));assert.equal(await second,true);
  completions[0](h.snap('admin'));assert.equal(await first,false);assert.equal(h.env.hasAdminAccess(),true);assert.equal(h.watchers.length,1);
});
test('server-side allowlist revocation hides admin UI and clears retained account data',async()=>{
  const h=setup(['showAdminView']);assert.equal(await h.env.verifyAdminAccess(),true);h.env.showAdminView();
  h.el('adminUserList').textContent='dummy retained profile';h.watchers[0].error(Error('PERMISSION_DENIED'));
  assert.equal(h.env.hasAdminAccess(),false);assert.equal(h.state.authVisible,true);assert.equal(h.el('adminUserList').textContent,'');assert.equal(h.watchers[0].stopped,true);
});
test('changing UID or signing out in another tab revokes the active admin interface',async()=>{
  const h=setup();await h.env.verifyAdminAccess();h.env.fb.authUid='normal';h.env.fb.currentUser={uid:'normal',email:'normal@mainkartu.local'};
  h.events['firebase-identity-changed']();assert.equal(h.env.hasAdminAccess(),false);assert.equal(h.state.authVisible,true);
});
test('revocation exits administrator spectator mode and prevents returning to admin UI',async()=>{
  const h=setup();await h.env.verifyAdminAccess();h.env.isSpectator=true;h.env._spectatorOrigin='admin';h.watchers[0].next(h.snap(null));
  assert.equal(h.state.exits,1);assert.equal(h.env._spectatorOrigin,'lobby');assert.equal(h.env.hasAdminAccess(),false);
});
test('clearing permission uses no database write and stale listeners cannot revoke a newer grant',async()=>{
  const h=setup();await h.env.verifyAdminAccess();const old=h.watchers[0];await h.env.verifyAdminAccess();old.error(Error('stale cancellation'));
  assert.equal(h.env.hasAdminAccess(),true);h.env.clearAdminSession();assert.equal(h.env.hasAdminAccess(),false);assert.deepEqual(h.writes,[]);
});
test('late account-list response after logout cannot repopulate cleared admin data',async()=>{
  const h=setup(['loadAdminUserList']);await h.env.verifyAdminAccess();let finish;
  h.env.fb.get=()=>new Promise(resolve=>finish=resolve);const pending=h.env.loadAdminUserList();h.env.clearAdminSession();
  finish(h.snap({dummy:{name:'Private Dummy',username:'dummy'}}));await pending;
  assert.equal(h.el('adminUserList').textContent,'');
});
test('actual administrator refresh path rechecks permission without trusting stored profile',async()=>{
  const h=setup(['initAuth']);let viewed=0;h.env.showAdminView=()=>viewed++;h.env.doLogout=()=>{};h.env.submitChangePw=()=>{};h.env.closeChangePwModal=()=>{};
  h.env.doLogin=()=>{};h.env.doRegister=()=>{};h.env.showForcedPasswordChange=()=>{};
  h.env.localStorage.getItem=()=>'{"name":"Wrong User","username":"wrong"}';
  await h.env.initAuth();assert.equal(viewed,1);assert.equal(h.env.hasAdminAccess(),true);
  h.env.fb.get=async()=>{throw Error('PERMISSION_DENIED');};await h.env.initAuth();assert.equal(viewed,1);assert.equal(h.state.authVisible,true);
});
test('recreated reserved email with different UID is denied by authoritative rules, not profile names',()=>{
  const rules=JSON.parse(fs.readFileSync(path.join(__dirname,'../database.rules.json'),'utf8'));
  assert.deepEqual(rules.rules.adminSessions,{'.read':false,'.write':false});
  assert.equal(JSON.stringify(rules).includes("root.child('adminSessions')"),false);
  assert.equal(html.includes('verifyAdminPassword'),false);assert.equal(html.includes('ADMIN_SALT'),false);
});
