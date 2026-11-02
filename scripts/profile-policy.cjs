module.exports=function(document){
  const ids=require('../player-profiles.js').ICONS.map(icon=>icon.id).join('|');
  document.rules.profiles={
    '.read':"auth != null && auth.token.firebase.sign_in_provider === 'password'",
    '$uid':{
      '.write':"auth != null && auth.token.firebase.sign_in_provider === 'password' && $uid === auth.uid && newData.exists()",
      '.validate':"newData.hasChildren(['displayName','avatarId','updatedAt'])",
      displayName:{'.validate':"newData.isString() && newData.val().matches(/^[!-~]{4,16}$/)"},
      avatarId:{'.validate':`newData.isString() && newData.val().matches(/^(${ids})$/)`},
      updatedAt:{'.validate':'newData.isNumber() && newData.val() === now'},
      '$other':{'.validate':false},
    },
  };
};
