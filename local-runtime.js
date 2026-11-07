/* Loopback always uses emulators. A missing local service never falls back. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LocalRuntime=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  function isLocal(location){return ['localhost','127.0.0.1','[::1]'].includes(location.hostname);}
  function config(location,production){
    if(!isLocal(location))return {local:false,firebase:production};
    return {local:true,project:'demo-main-kartu-v44',databasePort:19000,authPort:19099,
      firebase:{apiKey:'demo-main-kartu-v44',projectId:'demo-main-kartu-v44',authDomain:'demo-main-kartu-v44.firebaseapp.com',databaseURL:'http://127.0.0.1:19000?ns=demo-main-kartu-v44'}};
  }
  function authError(error,fallback){
    const code=error&&error.code;
    if(code==='auth/network-request-failed'||code==='auth/timeout')return 'Layanan uji lokal tidak bisa dihubungi. Coba lagi setelah layanan aktif.';
    return 'Login akun uji gagal. Pilih Daftar jika belum punya akun lokal. Akun game online tidak berlaku di preview ini.';
  }
  return {isLocal,config,authError};
});
