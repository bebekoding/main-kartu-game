#!/usr/bin/env python3
"""Only synthetic profiles and accounts on the official local RTDB emulator."""
import copy,importlib.util,json,time,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('h',Path(__file__).with_name('room-host-security.py'))
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
STAMP={'.sv':'timestamp'}
class ProfileSecurity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        st,b=h.call('.settings/rules','PUT',json.loads((h.ROOT/'database.rules.json').read_text()),'OWNER');assert st==200,b
    def setUp(self):
        self.data=h.fixture();self.data['accounts']={'host':{'authUid':'host','username':'host','name':'Original Name'}}
        self.data['leaderboards']={'remi':{'host':{'authUid':'host','username':'host','name':'Original Name','matches':4,'points':9}}}
        self.assertEqual(h.call('','PUT',self.data,'OWNER')[0],200)
    def profile(self,name='Ace_123!',icon='konoha'):return {'displayName':name,'avatarId':icon,'updatedAt':STAMP}
    def write(self,value,uid='host',path='profiles/host',allowed=False,provider='password'):
        st,b=h.call(path,'PUT',value,uid,provider);self.assertEqual(st,200 if allowed else 401,(path,b))
    def test_self_create_and_edit_are_allowed(self):
        self.write(self.profile(),allowed=True);self.write(self.profile('Captain@2','scout'),allowed=True)
    def test_other_account_cannot_edit_profile_or_batch_replace_profiles(self):
        self.write(self.profile(),'member');self.write({'host':self.profile()},'host','profiles')
        st,_=h.call('','PATCH',{'profiles/member':self.profile(),'profiles/host':self.profile()},'host');self.assertEqual(st,401)
    def test_anonymous_and_unauthenticated_writes_denied(self):
        self.write(self.profile(),uid=None);self.write(self.profile(),provider='anonymous')
    def test_profiles_are_readable_only_to_registered_players(self):
        self.write(self.profile(),allowed=True)
        for uid,provider,expected in [(None,'password',401),('host','anonymous',401),('member','password',200)]:
            self.assertEqual(h.call('profiles',uid=uid,provider=provider)[0],expected)
    def test_letter_digit_symbol_and_mixed_names_at_length_boundaries(self):
        for name in ['Abcd','abcdefghijklmnop','1234','1234567890123456','!!!!','.#[]','/@#$','Ace_123!','<>"\'']:
            self.write(self.profile(name),allowed=True)
    def test_empty_short_long_and_non_string_names_denied(self):
        for name in ['', 'abc','a'*17,12345,True,None,{'name':'abcd'}]:self.write(self.profile(name))
    def test_every_kind_of_whitespace_and_invisible_control_is_denied(self):
        for name in ['abcd ', ' abcde','ab cd','abcd\n','abcd\r','ab\tcd','ab\ncd','abcd\u00a0','ab\u200bcd','ab\x00cd','ab\x7fcd','ab\u202ecd','ab\u2066cd']:
            self.write(self.profile(name))
    def test_only_curated_avatar_ids_are_allowed(self):
        for icon in ['jjk-orbs','jjk-envelope','jjk-spike','jjk-car','jjk-yuji','jjk-swirl','jjk-flame','jjk-shadow','jjk-seal','jjk-wolf','jjk-wave','jjk-nobara','jjk-gojo','jjk-dagger','konoha','uchiha','sharingan','shuriken','strawhat','heart','whitebeard','redhair','scout','garrison','military','cadet','dragonball','flame','blueeye','reaper']:
            self.write(self.profile(icon=icon),allowed=True)
        for icon in ['jjk-unknown','other','konoha\n','https://example.com/a.png','../../image','data:image/svg+xml,x','<script>',0,None]:self.write(self.profile(icon=icon))
    def test_unknown_fields_and_missing_required_fields_are_denied(self):
        for field in ['username','authUid','email','isAdmin','password','avatarUrl']:
            self.write({**self.profile(),field:'untrusted'})
        for field in ['displayName','avatarId','updatedAt']:
            value=self.profile();value.pop(field);self.write(value)
    def test_timestamp_is_server_time_and_profile_cannot_be_deleted(self):
        value=self.profile();value['updatedAt']=int(time.time()*1000)+3000;self.write(value)
        self.write(self.profile(),allowed=True)
        self.assertEqual(h.call('profiles/host','DELETE',uid='host')[0],401)
        self.assertEqual(h.call('profiles/host/avatarId','DELETE',uid='host')[0],401)
    def test_profile_change_preserves_login_identity_leaderboard_and_saved_game(self):
        before=copy.deepcopy(self.data)
        h.call('rooms/ZZ0I/savedGame','PUT',{'version':1,'id':'f'*32,'status':'saved','requestedBy':'host','requestedAt':1,'savedAt':1,'lastAccessAt':int(time.time()*1000),'humans':{'0':'host','1':'member'},'votes':{'host':'f'*32,'member':'f'*32}},'OWNER')
        room_before=h.call('rooms/ZZ0I',uid='host')[1]
        self.write(self.profile('New.Name!','strawhat'),allowed=True)
        self.assertEqual(h.call('accounts',uid='host')[1],before['accounts'])
        self.assertEqual(h.call('leaderboards',uid='host')[1],before['leaderboards'])
        self.assertEqual(h.call('rooms/ZZ0I',uid='host')[1]['phase'],'playing')
        self.assertEqual(h.call('rooms/ZZ0I/host',uid='host')[1],'host')
        self.assertEqual(h.call('rooms/ZZ0I',uid='host')[1],room_before)
    def test_admin_looking_name_does_not_grant_any_permission(self):
        self.write(self.profile('__admin__'),allowed=True)
        self.assertEqual(h.call('config/adminUid',uid='host')[0],401)
        self.assertEqual(h.call('adminSessions/host','PUT',True,'host')[0],401)
        self.assertEqual(h.call('rooms/ZZ0I/host','PUT','host','member')[0],401)
if __name__=='__main__':unittest.main(verbosity=2)
