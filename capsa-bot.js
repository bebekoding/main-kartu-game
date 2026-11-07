/* Shared legal-move bot; no database privileges. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./capsa-engine.js'));else root.CapsaBot=factory(root.CapsaEngine);})(typeof window==='object'?window:globalThis,function(E){
'use strict';
function botMove(s){
  if(s.phase==='round_ready')return {type:'ready'};
  if(s.phase==='bomb_choice')return {type:'choose_bomb',flip:false};
  const hand=s.hands[s.turn],moves=[];
  const consider=cards=>{try{
    E.classify(cards);if(s.openingRequired&&!cards.some(c=>E.cardKey(c)==='3D'))return;
    if(s.table&&E.compare(cards,s.table.cards,s.reversed)!==1)return;moves.push(cards);
  }catch(_){}};
  if(!s.table||s.table.cards.length===1)hand.forEach(c=>consider([c]));
  if(!s.table||s.table.cards.length===2)for(let i=0;i<hand.length;i++)for(let j=i+1;j<hand.length;j++)consider([hand[i],hand[j]]);
  if(!s.table||s.table.cards.length===5){
    function select(start,chosen){if(chosen.length===5){consider(chosen);return;}for(let i=start;i<=hand.length-(5-chosen.length);i++)select(i+1,chosen.concat(hand[i]));}select(0,[]);
  }
  moves.sort((a,b)=>b.length-a.length||(E.compare(a,b,s.reversed)||0));
  return moves.length?{type:'play',cards:moves[0]}:{type:'pass'};
}
return {move:botMove};
});
