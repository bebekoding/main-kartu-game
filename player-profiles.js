/* Profile identity is a Firebase UID; display names never become database keys. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PlayerProfiles=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const ICONS=Object.freeze([
    ['konoha','Konoha','Naruto'],['uchiha','Uchiha','Naruto'],['sharingan','Sharingan','Naruto'],['shuriken','Shuriken','Naruto'],
    ['strawhat','Topi Jerami','One Piece'],['heart','Heart Pirates','One Piece'],['whitebeard','Whitebeard','One Piece'],['redhair','Red Hair','One Piece'],
    ['scout','Sayap Kebebasan','Attack on Titan'],['garrison','Garrison','Attack on Titan'],['military','Military Police','Attack on Titan'],['cadet','Cadet Corps','Attack on Titan'],
    ['dragonball','Bola Bintang','Anime lainnya'],['flame','Pedang Api','Anime lainnya'],['blueeye','Mata Biru','Anime lainnya'],['reaper','Soul Reaper','Anime lainnya'],
  ].map(([id,label,group],index)=>Object.freeze({id,label,group,index})));
  const validName=name=>typeof name==='string'&&/^[!-~]{4,16}$/.test(name)&&!/\s/.test(name);
  const validIcon=id=>ICONS.some(icon=>icon.id===id);
  function fallbackIcon(uid){let hash=0;for(const c of String(uid||'player'))hash=(Math.imul(hash,31)+c.charCodeAt(0))>>>0;return ICONS[hash%ICONS.length].id;}
  function iconFor(uid,profiles){const id=profiles?.[uid]?.avatarId;return validIcon(id)?id:fallbackIcon(uid);}
  function nameFor(player,profiles){
    const name=player&&!player.isBot&&profiles?.[player.uid]?.displayName;
    return validName(name)?name:player?.nickname||player?.name||player?.username||'Pemain';
  }
  function decorateRoom(room,profiles){
    if(!room)return room;
    return {...room,players:Object.fromEntries(Object.entries(room.players||{}).map(([uid,p])=>[uid,
      {...p,nickname:nameFor(p,profiles),avatarId:iconFor(uid,profiles)}]))};
  }
  function avatar(doc,id,decorative=true){
    const icon=ICONS.find(x=>x.id===id)||ICONS[0],span=doc.createElement('span');
    span.className='player-avatar avatar-'+icon.id;
    if(decorative)span.setAttribute('aria-hidden','true');else{span.setAttribute('role','img');span.setAttribute('aria-label',icon.label);}
    return span;
  }
  return {ICONS,validName,validIcon,fallbackIcon,iconFor,nameFor,decorateRoom,avatar};
});
