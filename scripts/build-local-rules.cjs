/* Separate emulator-only overlay. Never deployed by firebase.json. */
const fs=require('node:fs'),path=require('node:path');
function build(source){
  const rules=JSON.parse(JSON.stringify(source)),r=rules.rules.rooms.$roomCode;
  function terminalGuard(node){for(const [key,value]of Object.entries(node)){if(typeof value==='string'&&value.includes('tebak_match_end')&&!value.includes('capsa_session_end'))node[key]=value.replaceAll('tebak_match_end','tebak_match_end|capsa_session_end');else if(value&&typeof value==='object')terminalGuard(value);}}
  terminalGuard(r);
  rules.rules.capsaPrivate={'.read':false,'.write':false};
  // Public rooms contain metadata only. Even the host cannot forge the state
  // summary or change the game/phase after an authoritative Capsa start.
  r['.validate']+=" && (data.child('game').val() !== 'capsa' || data.child('capsaMode').val() === 'browser_host' || (newData.child('game').val() === 'capsa' && newData.child('phase').val() === data.child('phase').val() && newData.child('capsaRevision').val() === data.child('capsaRevision').val()))";
  r.capsaRevision={'.validate':"newData.val() === data.val()"};
  r.$gameState['.write']+=" && $gameState !== 'capsaRevision'";
  return rules;
}
if(require.main===module){const root=path.join(__dirname,'..');fs.writeFileSync(path.join(root,'database.local.rules.json'),JSON.stringify(build(JSON.parse(fs.readFileSync(path.join(root,'database.rules.json')))),null,1)+'\n');}
module.exports={build};
