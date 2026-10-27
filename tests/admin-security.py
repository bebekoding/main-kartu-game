#!/usr/bin/env python3
"""Administrator authorization regression tests. Local demo emulator ONLY.
The hash below is deliberately fake; no production credential is read or tried.
"""
import base64
import copy
import importlib.util
import json
from pathlib import Path
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

spec=importlib.util.spec_from_file_location('fixtures',Path(__file__).with_name('room-host-security.py'))
helpers=importlib.util.module_from_spec(spec);spec.loader.exec_module(helpers)
ROOT=Path(__file__).resolve().parents[1]
BASE='http://127.0.0.1:19000'
NS='demo-main-kartu-host'
FAKE_HASH='fake-test-value-never-a-production-credential'

def token(uid,provider='password',email=None,auth_time=None):
    enc=lambda value:base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
    now=int(time.time())
    return enc({'alg':'none','typ':'JWT'})+'.'+enc({
        'sub':uid,'user_id':uid,'aud':NS,'iat':now,'exp':now+3600,
        'iss':'https://securetoken.google.com/'+NS,'firebase':{'sign_in_provider':provider},
        'email':email or ('__admin__@mainkartu.local' if uid=='admin' else uid+'@mainkartu.local'),
        'auth_time':now if auth_time is None else auth_time,
    })+'.'

def request(path,method='GET',value=None,uid='attacker',**claims):
    query={'ns':NS};headers={'Content-Type':'application/json'}
    if uid=='OWNER':headers['Authorization']='Bearer owner'
    elif uid:query['auth']=token(uid,**claims)
    req=urllib.request.Request(BASE+'/'+path+'.json?'+urllib.parse.urlencode(query),
        data=json.dumps(value).encode() if method in ['PUT','PATCH'] else None,method=method,headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=10) as response:return response.status,json.load(response)
    except urllib.error.HTTPError as error:
        status=error.code;body=json.load(error);error.close();return status,body

class AdministratorSecurity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        status,body=request('.settings/rules','PUT',json.loads((ROOT/'database.rules.json').read_text()),'OWNER')
        if status!=200:raise RuntimeError((status,body))

    def setUp(self):
        self.cutoff=int(time.time())-3
        self.data=helpers.fixture()
        self.data['config']={'adminUid':'admin','adminAuthAfter':self.cutoff,'adminHash':FAKE_HASH}
        # A leaked or previously granted session must now be inert.
        self.data['adminSessions']={'attacker':{'hash':FAKE_HASH,'ts':1},'admin':{'hash':FAKE_HASH,'ts':1}}
        self.data['accounts']={'victim':{'name':'Victim','authUid':'victim'}}
        self.seed()

    def seed(self):self.assertEqual(request('','PUT',self.data,'OWNER')[0],200)
    def check(self,path,method='GET',value=None,uid='attacker',allow=False,**claims):
        status,body=request(path,method,value,uid,**claims)
        self.assertEqual(status,200 if allow else 401,(path,body))

    def test_matching_old_hash_cannot_create_or_refresh_admin_session(self):
        for uid in ['attacker','host','admin']:
            self.check('adminSessions/'+uid,'PUT',{'hash':FAKE_HASH,'ts':int(time.time()*1000)},uid)

    def test_existing_sessions_do_not_authorize_room_deletion(self):
        self.check('rooms/ZZ0I','DELETE')
        self.assertIsNotNone(request('rooms/ZZ0I',uid=None)[1])
        self.check('rooms/ZZ0I','DELETE',uid='admin',allow=True)

    def test_profile_username_or_admin_flags_do_not_grant_privileges(self):
        self.check('accounts/__admin__','PUT',{'name':'Admin','username':'__admin__','authUid':'attacker','isAdmin':True},allow=True)
        self.check('rooms/ZZ0I','DELETE')
        self.check('accounts/victim/name','PUT','Injected')

    def test_only_reserved_uid_and_server_issued_email_are_accepted(self):
        self.check('config/adminUid',uid='admin',allow=True)
        self.check('config/adminUid',uid='attacker',email='__admin__@mainkartu.local')
        self.check('config/adminUid',uid='admin',email='other@mainkartu.local')
        self.check('rooms/ZZ0I','DELETE',uid='attacker',email='__admin__@mainkartu.local')
        self.check('rooms/ZZ0I','DELETE',uid='admin',email='other@mainkartu.local')

    def test_anonymous_provider_cannot_use_admin_uid_or_old_session(self):
        self.check('config/adminUid',uid='admin',provider='anonymous')
        self.check('rooms/ZZ0I','DELETE',uid='admin',provider='anonymous')

    def test_pre_cutoff_admin_session_is_denied_and_fresh_login_works(self):
        self.check('config/adminUid',uid='admin',auth_time=self.cutoff-1)
        self.check('rooms/ZZ0I','DELETE',uid='admin',auth_time=self.cutoff-1)
        self.check('config/adminUid',uid='admin',auth_time=self.cutoff,allow=True)
        self.check('rooms/ZZ0I','DELETE',uid='admin',auth_time=self.cutoff+1,allow=True)

    def test_fresh_id_token_does_not_replace_recent_authentication(self):
        # iat is current; auth_time still predates revocation.
        self.check('accounts/victim/name','PUT','Changed',uid='admin',auth_time=self.cutoff-100)

    def test_admin_uid_and_cutoff_are_owner_managed_even_for_admin(self):
        for uid in ['attacker','host','admin']:
            self.check('config/adminUid','PUT','attacker',uid)
            self.check('config/adminAuthAfter','PUT',0,uid)
            self.check('config','PATCH',{'adminUid':'attacker','adminAuthAfter':0},uid)
            self.check('config/adminUid','DELETE',uid=uid)

    def test_allowlist_revocation_applies_immediately(self):
        self.check('config/adminUid',uid='admin',allow=True)
        self.assertEqual(request('config/adminUid','PUT','replacement','OWNER')[0],200)
        self.check('config/adminUid',uid='admin')
        self.check('rooms/ZZ0I','DELETE',uid='admin')

    def test_moving_cutoff_revokes_existing_admin_tokens(self):
        self.assertEqual(request('config/adminAuthAfter','PUT',self.cutoff+10,'OWNER')[0],200)
        self.check('config/adminUid',uid='admin')
        self.check('accounts/victim/name','PUT','Changed',uid='admin')

    def test_account_edit_privilege_is_uid_bound(self):
        self.check('accounts/victim/name','PUT','Changed')
        self.check('accounts/victim/name','PUT','Changed',uid='admin',allow=True)
        self.check('accounts/victim/authUid','PUT','admin')

    def test_leaderboard_admin_exception_no_longer_uses_legacy_sessions(self):
        score={'matches':1,'points':5,'username':'victim'}
        self.check('leaderboards/remi/victim','PUT',score)
        # Administrators also need the immutable match/receipt protocol now.
        self.check('leaderboards/remi/victim','PUT',score,uid='admin')

    def test_voice_and_chat_admin_exceptions_are_uid_bound(self):
        self.data['rooms']['ZZ0I']['voice']={'victim':{'name':'Victim','muted':False}}
        self.data['rooms']['ZZ0I']['chat']={'message':{'uid':'victim','name':'Victim','text':'Hello','t':1}}
        self.seed()
        self.check('rooms/ZZ0I/voice/victim','DELETE')
        self.check('rooms/ZZ0I/chat/message','DELETE')
        self.check('rooms/ZZ0I/voice/victim','DELETE',uid='admin',allow=True)
        self.check('rooms/ZZ0I/chat/message','DELETE',uid='admin',allow=True)

    def test_private_hash_and_old_session_records_are_not_readable(self):
        for uid in ['attacker','admin',None]:
            self.check('config/adminHash',uid=uid)
            self.check('adminSessions/attacker',uid=uid)
            self.check('adminSessions',uid=uid)

    def test_missing_uid_or_cutoff_fails_closed(self):
        for field in ['adminUid','adminAuthAfter']:
            data=copy.deepcopy(self.data);data['config'].pop(field)
            self.assertEqual(request('','PUT',data,'OWNER')[0],200)
            self.check('rooms/ZZ0I','DELETE',uid='admin')

    def test_room_host_retains_ordinary_right_to_delete_own_room(self):
        self.check('rooms/ZZ0I','DELETE',uid='host',allow=True)

    def test_atomic_self_grant_cannot_bypass_authorization(self):
        patch={'config/adminUid':'attacker','config/adminAuthAfter':0,
            'adminSessions/attacker':{'hash':FAKE_HASH},'rooms/ZZ0I':None}
        self.assertEqual(request('','PATCH',patch,'attacker')[0],401)
        self.assertIsNotNone(request('rooms/ZZ0I',uid=None)[1])
        self.assertEqual(request('config/adminUid',uid='admin')[1],'admin')

if __name__=='__main__':unittest.main(verbosity=2)
