#!/usr/bin/env python3
"""Expiry and reconnect races, exclusively on the local RTDB emulator."""
import importlib.util,json,time,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('helpers',Path(__file__).with_name('room-host-security.py'))
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
class RoomExpirySecurity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert h.call('.settings/rules','PUT',json.loads((h.ROOT/'database.rules.json').read_text()),'OWNER')[0]==200
    def setUp(self):
        self.data=h.fixture();self.room=self.data['rooms']['ZZ0I'];self.now=int(time.time()*1000)
        self.seed()
    def seed(self):self.assertEqual(h.call('','PUT',self.data,'OWNER')[0],200)
    def delete(self,allowed=False,uid='viewer'):
        status,body=h.call('rooms/ZZ0I','DELETE',uid=uid)
        self.assertEqual(status,200 if allowed else 401,body)
    def stale(self):
        for p in self.room['players'].values():p['lastSeen']=self.now-31000
        self.seed()
    def bots(self,age=None):
        for p in self.room['players'].values():p['isBot']=True
        self.room['host']=None
        if age is not None:self.room['emptySince']=self.now-age
        self.seed()
    def test_active_human_blocks_other_user_delete(self):self.delete()
    def test_one_fresh_human_blocks_delete_even_if_host_is_stale(self):
        self.stale();h.call('rooms/ZZ0I/players/member/lastSeen','PUT',{'.sv':'timestamp'},'member');self.delete()
    def test_all_four_games_expire_after_thirty_seconds_without_human_signal(self):
        for game in ['truf','remi','cangkul','tebak']:
            self.room['game']=game;self.stale();self.delete(True)
    def test_twenty_nine_seconds_is_not_thirty(self):
        for p in self.room['players'].values():p['lastSeen']=self.now-29000
        self.seed();self.delete()
    def test_recent_server_disconnect_keeps_full_grace_even_with_zero_heartbeat(self):
        self.stale();h.call('rooms/ZZ0I/players/member','PATCH',{'lastSeen':0,'disconnected':True,'disconnectedAt':{'.sv':'timestamp'}},'OWNER');self.delete()
    def test_old_disconnect_with_zero_heartbeat_expires(self):
        self.stale();h.call('rooms/ZZ0I/players/member','PATCH',{'lastSeen':0,'disconnected':True,'disconnectedAt':self.now-31000},'OWNER');self.delete(True)
    def test_fresh_heartbeat_overrides_old_disconnect_and_marker(self):
        self.stale();h.call('rooms/ZZ0I','PATCH',{'emptySince':self.now-90000,'players/member/disconnectedAt':self.now-90000,'players/member/lastSeen':{'.sv':'timestamp'}},'OWNER');self.delete()
    def test_bot_heartbeats_do_not_keep_empty_room_alive(self):
        self.bots(31000);self.delete(True)
    def test_bots_only_wait_thirty_seconds_after_last_human_exit(self):
        self.bots(29000);self.delete()
    def test_old_bots_only_room_gets_fresh_marker_before_expiry(self):
        self.bots();self.delete()
        self.assertEqual(h.call('rooms/ZZ0I/emptySince','PUT',{'.sv':'timestamp'},'viewer')[0],200)
        self.delete()
    def test_marker_cannot_be_forged_reset_or_added_to_live_room(self):
        self.assertEqual(h.call('rooms/ZZ0I/emptySince','PUT',{'.sv':'timestamp'},'viewer')[0],401)
        self.bots()
        self.assertEqual(h.call('rooms/ZZ0I/emptySince','PUT',self.now-90000,'viewer')[0],401)
        self.assertEqual(h.call('rooms/ZZ0I/emptySince','PUT',{'.sv':'timestamp'},'viewer')[0],200)
        self.assertEqual(h.call('rooms/ZZ0I/emptySince','PUT',{'.sv':'timestamp'},'viewer')[0],401)
        self.assertEqual(h.call('rooms/ZZ0I/emptySince','DELETE',uid='viewer')[0],401)
    def test_rejoin_between_snapshot_and_delete_is_protected(self):
        self.stale();old_snapshot=h.call('rooms/ZZ0I')[1]
        self.assertLess(old_snapshot['players']['member']['lastSeen'],self.now-30000)
        self.assertEqual(h.call('rooms/ZZ0I/players/member','PATCH',{'lastSeen':{'.sv':'timestamp'},'disconnected':None,'disconnectedAt':None},'member')[0],200)
        self.delete()
    def test_original_last_player_can_atomically_start_empty_timer(self):
        self.room['players']['member']['isBot']=True;self.room['emptySince']=self.now-90000;self.seed()
        patch={'players/host/isBot':True,'players/host/lastSeen':0,'host':None,'hostRequests':None,'emptySince':{'.sv':'timestamp'}}
        self.assertEqual(h.call('rooms/ZZ0I','PATCH',patch,'host')[0],200)
        self.assertGreater(h.call('rooms/ZZ0I/emptySince')[1],self.now-5000);self.delete()
    def test_missing_legacy_presence_needs_marker_and_full_grace(self):
        for p in self.room['players'].values():p['lastSeen']=0
        self.seed();self.delete()
        self.assertEqual(h.call('rooms/ZZ0I/emptySince','PUT',{'.sv':'timestamp'},'viewer')[0],200);self.delete()
        h.call('rooms/ZZ0I/emptySince','PUT',self.now-31000,'OWNER');self.delete(True)
    def test_anonymous_cannot_delete_even_expired_room(self):
        self.stale();self.delete(uid=None)
        self.assertEqual(h.call('rooms/ZZ0I','DELETE',uid='viewer',provider='anonymous')[0],401)
    def test_legacy_room_without_canonical_membership_is_not_publicly_deletable(self):
        self.stale();h.call('rooms/ZZ0I/membershipVersion','DELETE',uid='OWNER');self.delete()
    def test_empty_room_claim_resets_timer_and_preserves_rejoining_human(self):
        self.bots(31000)
        patch={'players/host':None,'players/viewer':h.player('viewer',0),'seats/0':'viewer','host':'viewer','hostRequests':None,'emptySince':None}
        self.assertEqual(h.call('rooms/ZZ0I','PATCH',patch,'viewer')[0],200);self.delete(uid='outsider')
    def test_cleanup_does_not_grant_game_or_result_write_access(self):
        self.stale()
        self.assertEqual(h.call('rooms/ZZ0I/remi/currentPlayer','PUT',1,'viewer')[0],401)
        self.assertEqual(h.call('rankedAwards/'+'a'*32,'PUT',{'contract':3},'viewer')[0],401)
        self.delete(True)
if __name__=='__main__':unittest.main(verbosity=2)
