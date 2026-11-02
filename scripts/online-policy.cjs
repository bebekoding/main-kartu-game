module.exports=function(document){
  document.rules.onlinePlayers={
    '.read':"auth != null && auth.token.firebase.sign_in_provider === 'password'",
    '$uid':{'$connection':{
      '.write':"auth != null && auth.token.firebase.sign_in_provider === 'password' && auth.uid === $uid && $connection.matches(/^[a-f0-9]{32}$/)",
      '.validate':'newData.isNumber() && newData.val() === now',
    }},
  };
};
