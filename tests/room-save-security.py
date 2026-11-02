#!/usr/bin/env python3
"""Saved-game consent, freeze and expiry against the local emulator only."""
import copy,importlib.util,json,time,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('helpers',Path(__file__).with_name('room-host-security.py'))
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
STAMP={'.sv':'timestamp'}
class RoomSaveSecurity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        st,b=h.call('.settings/rules','PUT',json.loads((h.ROOT/'database.rules.json').read_text()),'OWNER')
        assert st==200,b
    def setUp(self):
        self.data=h.fixture();self.room=self.data['rooms']['ZZ0I'];self.seed()
    def seed(self):self.assertEqual(h.call('','PUT',self.data,'OWNER')[0],200)
    def write(self,path,value=None,uid='host',method='PUT',allowed=False,provider='password'):
        st,b=h.call('rooms/ZZ0I'+('/'+path if path else ''),method,value,uid,provider)
        self.assertEqual(st,200 if allowed else 401,(path,b));return b
    def state(self):return h.call('rooms/ZZ0I/savedGame')[1]
    def request(self,uid='host',humans=None):
        return {'version':1,'id':'a'*32,'status':'request','requestedBy':uid,'requestedAt':STAMP,'lastAccessAt':STAMP,
            'humans':humans or {'0':'host','1':'member'},'votes':{uid:'a'*32}}
    def begin(self):self.write('savedGame',self.request(),allowed=True)
    def save(self):
        self.begin();self.write('savedGame/votes/member','a'*32,'member',allowed=True)
        self.write('',{'savedGame/status':'saved','savedGame/savedAt':STAMP},method='PATCH',allowed=True)
    def resume(self,nonce='b'*32):
        self.write('',{'savedGame/status':'resuming','savedGame/resumeId':nonce,'savedGame/resumeAt':STAMP,'savedGame/ready':None},method='PATCH',allowed=True)
    def ready(self,uid='host',nonce='b'*32):self.write('savedGame/ready/'+uid,nonce,uid,allowed=True)
    def test_only_original_human_can_request(self):
        for uid,provider in [(None,'password'),('viewer','password'),('bot2','password'),('host','anonymous')]:
            self.write('savedGame',self.request(uid or 'viewer'),uid,provider=provider)
        self.begin()
    def test_roster_is_exact_including_disconnected_humans(self):
        for humans in [{'0':'host'},{'0':'host','1':'viewer'},{'0':'host','1':'member','2':'bot2'},{'0':'host','1':'host'},{'0':'host','1':'member','9':'viewer'}]:
            self.write('savedGame',self.request(humans=humans))
        self.room['players']['member']['disconnected']=True;self.seed();self.begin()
    def test_cannot_create_with_other_players_votes_or_future_timestamp(self):
        for field,value in [('votes',{'host':'a'*32,'member':'a'*32}),('lastAccessAt',int(time.time()*1000)+3000),('status','saved'),('requestedBy','member')]:
            s=self.request();s[field]=value;self.write('savedGame',s)
        self.begin()
    def test_no_save_in_lobby_or_completed_match(self):
        for phase in ['lobby','tournament_end','remi_tournament_end','cangkul_tournament_end','tebak_match_end']:
            self.room['phase']=phase;self.seed();self.write('savedGame',self.request())
    def test_unanimous_save_not_just_host(self):
        self.begin();self.write('',{'savedGame/status':'saved','savedGame/savedAt':STAMP},method='PATCH')
        self.write('savedGame/votes/member','a'*32)
        self.write('savedGame/votes/member','a'*32,'viewer')
        self.write('savedGame/votes/member','a'*32,'member',allowed=True)
        self.write('',{'savedGame/status':'saved','savedGame/savedAt':STAMP},uid='member',method='PATCH',allowed=True)
    def test_saved_state_cannot_be_replaced_or_members_rewritten(self):
        self.save();s=self.state();s['humans']={'0':'host'};self.write('savedGame',s)
        self.write('savedGame/humans/1','host');self.write('savedGame/id','c'*32)
        self.write('savedGame/votes/member',None,method='DELETE')
    def test_all_gameplay_and_membership_writes_are_frozen(self):
        self.save()
        for uid in ['host','member']:
            for path,value in [('phase','lobby'),('remi/currentPlayer',2),('hands/0',[{'rank':'A','suit':'S'}]),('play/currentPlayer',2),('bidding/revealed',True),('cangkul/currentPlayer',2),('tebak/currentPlayer',2),('totals/0',999),('gameState/roster/0/uid','viewer'),('host','member'),('seats/2','viewer'),('players/host/nickname','wrong'),('players/member/isBot',True),('savedGame/anything',True)]:
                self.write(path,value,uid)
            self.write('players/'+uid,None,uid,method='DELETE')
    def test_freeze_already_applies_during_save_request(self):
        self.begin();self.write('remi/currentPlayer',2);self.write('phase','lobby')
    def test_saved_room_cannot_be_deleted_by_host_or_other_user(self):
        self.save()
        for uid in ['host','member','viewer']:self.write('',uid=uid,method='DELETE')
        self.write('savedGame',uid='host',method='DELETE')
    def test_only_own_presence_can_be_updated(self):
        self.save()
        self.write('',{'players/host/lastSeen':STAMP,'players/host/disconnected':None,'players/host/disconnectedAt':None,'savedGame/lastAccessAt':STAMP},method='PATCH',allowed=True)
        self.write('players/member/lastSeen',STAMP)
        self.write('players/host/lastSeen',int(time.time()*1000)+3000)
        self.write('savedGame/lastAccessAt',STAMP,'viewer')
    def test_opening_does_not_resume_or_change_cards_scores_and_turn(self):
        self.save();before=h.call('rooms/ZZ0I')[1]
        self.write('',{'players/member/lastSeen':STAMP,'players/member/disconnected':None,'players/member/disconnectedAt':None,'savedGame/lastAccessAt':STAMP},'member','PATCH',True)
        after=h.call('rooms/ZZ0I')[1]
        for key in ['phase','remi','gameState','seats']:self.assertEqual(before[key],after[key])
        self.assertEqual(after['savedGame']['status'],'saved')
    def test_resume_requires_every_human_present_and_own_fresh_vote(self):
        self.save();self.resume();self.ready()
        self.write('savedGame',method='DELETE');self.write('savedGame/ready/member','b'*32)
        self.ready('member');self.write('players/member/disconnectedAt',STAMP,'member',allowed=True)
        self.write('savedGame',method='DELETE')
        self.write('players/member/disconnectedAt',None,'member','DELETE',True)
        self.write('savedGame',method='DELETE',allowed=True)
        self.write('remi/currentPlayer',1,allowed=True)
    def test_stale_nonce_and_ready_from_previous_attempt_cannot_resume(self):
        self.save();self.resume();self.ready();self.ready('member')
        self.write('savedGame/status','saved',allowed=True);self.resume('c'*32)
        self.assertIsNone(self.state().get('ready'))
        self.write('savedGame/ready/member','b'*32,'member');self.ready(nonce='c'*32)
        self.write('savedGame',method='DELETE');self.ready('member','c'*32)
        self.write('savedGame',method='DELETE',allowed=True)
    def test_timeout_or_rejection_thaws_without_changing_snapshot(self):
        self.begin();self.write('savedGame',uid='viewer',method='DELETE')
        self.write('savedGame',uid='member',method='DELETE',allowed=True)
        self.begin();h.call('rooms/ZZ0I/savedGame/requestedAt','PUT',int(time.time()*1000)-61000,'OWNER')
        self.write('',{'savedGame/status':'saved','savedGame/savedAt':STAMP},method='PATCH')
        self.write('savedGame',uid='viewer',method='DELETE',allowed=True)
    def test_seven_day_expiry_and_stale_cleanup_race(self):
        self.save();now=int(time.time()*1000)
        h.call('rooms/ZZ0I/savedGame/lastAccessAt','PUT',now-604799000,'OWNER')
        self.write('',uid='viewer',method='DELETE')
        self.write('savedGame/lastAccessAt',STAMP,'member',allowed=True)
        self.write('',uid='viewer',method='DELETE')
        h.call('rooms/ZZ0I/savedGame/lastAccessAt','PUT',now-604801000,'OWNER')
        self.write('savedGame/lastAccessAt',STAMP,'member')
        self.write('',uid='viewer',method='DELETE',allowed=True)
    def test_resume_cannot_reuse_old_metadata_by_changing_only_status(self):
        self.save();self.write('savedGame/status','resuming')
        self.resume();self.ready();self.write('savedGame/status','saved',allowed=True)
        self.write('savedGame/status','resuming')
    def test_pending_request_with_legacy_missing_presence_still_expires(self):
        self.room['players']['member']['lastSeen']=0;self.seed();self.begin()
        for path in ['players/host/lastSeen','savedGame/requestedAt']:
            h.call('rooms/ZZ0I/'+path,'PUT',int(time.time()*1000)-61000,'OWNER')
        self.write('',uid='viewer',method='DELETE',allowed=True)
    def test_initial_room_cannot_embed_an_unapproved_saved_game(self):
        self.room['savedGame']=self.request()
        st,_=h.call('rooms/NEW1','PUT',self.room,'host');self.assertEqual(st,401)
    def test_solo_save_resume_all_four_games(self):
        for game in ['truf','remi','cangkul','tebak']:
            self.data=h.fixture();self.room=self.data['rooms']['ZZ0I'];self.room['game']=game
            self.room['players']['member']['isBot']=True;self.seed()
            self.write('savedGame',self.request(humans={'0':'host'}),allowed=True)
            self.write('',{'savedGame/status':'saved','savedGame/savedAt':STAMP},method='PATCH',allowed=True)
            self.resume();self.ready();self.write('savedGame',method='DELETE',allowed=True)
    def test_all_six_humans_must_vote(self):
        self.room['game']='tebak';self.room['maxPlayers']=6
        for n in range(6):
            uid=['host','member','third','fourth','fifth','sixth'][n];self.room['players'][uid]=h.player(uid,n);self.room['seats'][str(n)]=uid
        self.room['players'].pop('bot2');self.room['players'].pop('bot3');self.seed()
        humans={str(n):u for n,u in enumerate(['host','member','third','fourth','fifth','sixth'])}
        self.write('savedGame',self.request(humans=humans),allowed=True)
        for u in ['member','third','fourth','fifth']:self.write('savedGame/votes/'+u,'a'*32,u,allowed=True)
        self.write('',{'savedGame/status':'saved','savedGame/savedAt':STAMP},method='PATCH')
        self.write('savedGame/votes/sixth','a'*32,'sixth',allowed=True)
        self.write('',{'savedGame/status':'saved','savedGame/savedAt':STAMP},method='PATCH',allowed=True)
if __name__=='__main__':unittest.main(verbosity=2)
