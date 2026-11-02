const test=require('node:test'),assert=require('node:assert/strict'),P=require('../online-players.js');
test('counts unique accounts, ignoring stale tabs and forged future times',()=>{
  assert.equal(P.count({a:{one:100000,two:99999},b:{one:100000},c:{one:70000},d:{one:200000}},100000),2);
  assert.equal(P.count({},100000),0);assert.equal(P.count({a:{x:null}},100000),0);
});
test('registers connection cleanup before heartbeat, stops and ignores old callbacks',async()=>{
  const watches={},events=[],values=[];
  const fb={authUid:'a',db:{},ref:(_,p)=>p,serverTimestamp:()=>({'.sv':'timestamp'}),
    onValue:(p,fn)=>{watches[p]=fn;return()=>events.push('off:'+p);},
    onDisconnect:p=>({remove:async()=>events.push('disconnect:'+p)}),set:async p=>events.push('set:'+p),remove:async p=>events.push('remove:'+p)};
  const api=P.create(fb,{id:()=> 'a'.repeat(32),now:()=>100000,render:v=>values.push(v)});api.start();
  watches.onlinePlayers({val:()=>({a:{tab:100000}})});await watches['.info/connected']({val:()=>true});
  assert.equal(values.at(-1),1);assert.match(events[0],/^disconnect:/);assert.match(events[1],/^set:/);
  api.stop();const n=events.length;await watches['.info/connected']({val:()=>true});assert.equal(events.length,n);assert.equal(values.at(-1),null);
});
