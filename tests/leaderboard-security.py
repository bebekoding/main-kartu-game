#!/usr/bin/env python3
"""Ranking contract integration tests. Only local RTDB demo namespace."""
import copy, importlib.util, json, time, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('rank_helpers',Path(__file__).with_name('room-host-security.py'))
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
call=h.call
ID='a'*32
OTHER='b'*32

def fixture(game='remi',size=4):
    now=int(time.time()*1000)
    people={f'p{s}':{**h.player(f'p{s}',s),'username':f'p{s}','nickname':f'P{s}'} for s in range(size)}
    room={'code':'ZZ0I','game':game,'host':'p0','phase':'lobby','maxPlayers':size,'membershipVersion':2,
        'players':people,'seats':{str(s):f'p{s}' for s in range(size)}}
    accounts={f'p{s}':{'authUid':f'p{s}','username':f'p{s}','name':f'P{s}'} for s in range(size)}
    record={'contract':3,'roomCode':'ZZ0I','game':game,'size':size,'createdAt':now,
        'roster':{str(s):{'uid':f'p{s}','key':f'p{s}','username':f'p{s}','name':f'P{s}'} for s in range(size)},
        'memberSeats':{f'p{s}':s for s in range(size)}}
    return {'rooms':{'ZZ0I':room},'accounts':accounts,'config':{'leaderboardContract':3}},record

class LeaderboardSecurity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        rules=json.loads((Path(__file__).resolve().parents[1]/'database.rules.json').read_text())
        status,body=call('.settings/rules','PUT',rules,'OWNER')
        if status!=200:raise RuntimeError((status,body))
    def setUp(self):self.seed()
    def seed(self,game='remi',size=4):
        self.data,self.record=fixture(game,size);self.game=game;self.size=size
        self.assertEqual(call('','PUT',self.data,'OWNER')[0],200)
    def write(self,path,value,uid='p0',allow=False,method='PUT'):
        status,body=call(path,method,value,uid)
        self.assertEqual(status,200 if allow else 401,(path,body))
    def start(self):
        self.write('',{f'rankedMatches/{ID}':self.record,'rooms/ZZ0I/rankedMatchId':ID},allow=True,method='PATCH')
    def finish(self):
        totals={str(s):100-s for s in range(self.size)}
        phase={'truf':'tournament_end','remi':'remi_tournament_end','cangkul':'cangkul_tournament_end','tebak':'tebak_match_end'}[self.game]
        state={'phase':phase,'totals':totals}
        if self.game=='remi':state['remi']={'roundNumber':10,'endReason':'closed','handPenalty':{str(s):0 for s in range(self.size)}}
        elif self.game=='tebak':state['tebak']={'roundNumber':10,'roundRanks':{str(s):s+1 for s in range(self.size)},'roundPoints':{str(s):self.size-s for s in range(self.size)}}
        elif self.game=='cangkul':state['cangkul']={'sessionNumber':1,'eliminationOrder':list(range(self.size)),'finalScores':{str(s):self.size-s for s in range(self.size)}}
        else:state.update({'gameState':{'session':1},'sessionResult':{'sessionNumber':1,'deltas':{str(s):0 for s in range(self.size)}},'play':{'trickNumber':13,'tricksWon':{'0':13,'1':0,'2':0,'3':0}}})
        self.assertEqual(call('rooms/ZZ0I','PATCH',state,'OWNER')[0],200)
    def proposal(self):
        result={'finishedAt':int(time.time()*1000),'rounds':10 if self.game in ['remi','tebak'] else 1,
            'entries':{str(s):{'total':100-s,'points':self.size-s} for s in range(self.size)}}
        return {f'rankedMatches/{ID}/result':result,**{f'rankedPending/p{s}/{ID}':True for s in range(self.size)}}
    def propose(self):self.write('',self.proposal(),allow=True,method='PATCH')
    def approve(self):
        for s in range(self.size):self.write(f'rankedMatches/{ID}/votes/p{s}',True,f'p{s}',True)
    def packet(self,previous=None):
        previous=previous or {}
        result={f'rankedAwards/{ID}':{'contract':3,'game':self.game,'srcRoom':'ZZ0I','srcMatch':ID,'at':int(time.time()*1000)}}
        for s in range(self.size):
            key=f'p{s}';cur=previous.get(key,{})
            matches=cur.get('matches',0)+1
            result[f'leaderboards/{self.game}/{key}']={'contract':3,'authUid':key,'username':key,'name':f'P{s}',
                'matches':matches,'points':cur.get('points',0)+self.size-s+(5 if matches%5==0 else 0),'srcRoom':'ZZ0I','srcMatch':ID}
            result[f'rankedPending/{key}/{ID}']=None
        return result
    def ready(self):self.start();self.finish();self.propose();self.approve()

    def test_baseline_direct_host_increment_is_denied_even_with_srcRoom(self):
        old={'matches':1,'points':4,'username':'p0','srcRoom':'ZZ0I'}
        for phase in ['lobby','playing','remi_tournament_end']:
            call('rooms/ZZ0I/phase','PUT',phase,'OWNER')
            self.write('leaderboards/remi/p0',old)
    def test_match_registration_and_first_complete_award(self):
        self.ready();self.write('',self.packet(),allow=True,method='PATCH')
        self.assertEqual(call('leaderboards/remi/p0')[1]['matches'],1)
        self.assertEqual(call('rankedPending/p0',uid='p0')[1],None)
    def test_retry_same_packet_and_incrementing_again_are_denied(self):
        self.ready();packet=self.packet();self.write('',packet,allow=True,method='PATCH')
        self.write('',packet,method='PATCH')
        current={f'p{s}':{'matches':1,'points':self.size-s} for s in range(self.size)}
        self.write('',self.packet(current),method='PATCH')
        self.assertEqual(call('leaderboards/remi/p0')[1]['matches'],1)
    def test_receipt_and_match_cannot_be_deleted_or_recreated(self):
        self.ready();self.write('',self.packet(),allow=True,method='PATCH')
        for path in [f'rankedAwards/{ID}',f'rankedMatches/{ID}',f'rankedMatches/{ID}/result']:
            self.write(path,None,method='DELETE')
        self.write(f'rankedMatches/{ID}',self.record)
    def test_marker_reset_or_room_deletion_does_not_reset_receipt(self):
        self.ready();self.write('',self.packet(),allow=True,method='PATCH')
        call('rooms/ZZ0I','DELETE',uid='OWNER')
        self.write('',self.packet(),method='PATCH')
        self.assertIsNotNone(call(f'rankedAwards/{ID}',uid='p0')[1])
    def test_match_without_result_or_all_votes_cannot_award(self):
        self.start();self.write('',self.packet(),method='PATCH')
        self.finish();self.propose();self.write(f'rankedMatches/{ID}/votes/p0',True,allow=True)
        self.write('',self.packet(),method='PATCH')
    def test_host_cannot_impersonate_other_votes_or_reset_a_rejection(self):
        self.start();self.finish();self.propose()
        self.write(f'rankedMatches/{ID}/votes/p1',True)
        self.write(f'rankedMatches/{ID}/votes/p1',False,'p1',True)
        self.write(f'rankedMatches/{ID}/votes/p1',True,'p1')
        self.write(f'rankedMatches/{ID}/votes/p1',None,'p1',method='DELETE')
        self.write('',self.packet(),method='PATCH')
    def test_outsiders_and_anonymous_cannot_register_propose_vote_or_award(self):
        self.start();self.finish();self.propose()
        self.write(f'rankedMatches/{ID}/votes/outsider',True,'outsider')
        self.write('',self.packet(),'outsider',method='PATCH')
        status,_=call(f'rankedMatches/{ID}/votes/p0','PUT',True,'p0','anonymous');self.assertEqual(status,401)
    def test_missing_participant_row_or_cleanup_makes_award_atomic_failure(self):
        self.ready()
        for path in ['leaderboards/remi/p1',f'rankedPending/p1/{ID}']:
            packet=self.packet();packet.pop(path);self.write('',packet,method='PATCH')
            self.assertIsNone(call('leaderboards/remi/p0')[1])
            self.assertIsNone(call(f'rankedAwards/{ID}',uid='p0')[1])
    def test_wrong_points_username_identity_and_bonus_are_denied(self):
        self.ready()
        for field,value in [('points',999),('matches',2),('authUid','p1'),('srcMatch',OTHER),('username','victim'),('contract',2)]:
            packet=self.packet();packet['leaderboards/remi/p0'][field]=value;self.write('',packet,method='PATCH')
    def test_new_match_same_room_gets_exactly_one_additional_credit(self):
        self.ready();first=self.packet();self.write('',first,allow=True,method='PATCH')
        global ID
        original=ID
        try:
            ID=OTHER
            call('rooms/ZZ0I','PATCH',{'phase':'lobby','totals':None},'OWNER');self.record['createdAt']=int(time.time()*1000)
            self.start();self.finish();self.propose();self.approve()
            old={f'p{s}':first[f'leaderboards/remi/p{s}'] for s in range(self.size)}
            self.write('',self.packet(old),allow=True,method='PATCH')
            self.assertEqual(call('leaderboards/remi/p0')[1]['matches'],2)
        finally:ID=original
    def test_existing_totals_and_fifth_match_bonus_are_preserved(self):
        previous={f'p{s}':{'username':f'p{s}','matches':4,'points':20} for s in range(self.size)}
        call('leaderboards/remi','PUT',previous,'OWNER');self.ready()
        self.write('',self.packet(previous),allow=True,method='PATCH')
        self.assertEqual(call('leaderboards/remi/p0')[1]['points'],29)
    def test_fake_profiles_bots_changed_roster_and_duplicate_usernames_cannot_qualify(self):
        for change in ['bot','profile','duplicate']:
            self.seed()
            if change=='bot':call('rooms/ZZ0I/players/p1/isBot','PUT',True,'OWNER')
            if change=='profile':call('accounts/p1/authUid','PUT','p0','OWNER')
            if change=='duplicate':self.record['roster']['1']['key']='p0'
            self.write('',{f'rankedMatches/{ID}':self.record,'rooms/ZZ0I/rankedMatchId':ID},method='PATCH')
    def test_host_cannot_prepopulate_forged_votes_or_results_during_creation(self):
        for field,value in [('votes',{'p0':True,'p1':True}),('result',{'rounds':20})]:
            record=copy.deepcopy(self.record);record[field]=value
            self.write('',{f'rankedMatches/{ID}':record,'rooms/ZZ0I/rankedMatchId':ID},method='PATCH')
    def test_registration_requires_lobby_and_server_link(self):
        self.write(f'rankedMatches/{ID}',self.record)
        call('rooms/ZZ0I/phase','PUT','playing','OWNER')
        self.write('',{f'rankedMatches/{ID}':self.record,'rooms/ZZ0I/rankedMatchId':ID},method='PATCH')
    def test_lobby_midgame_and_unfinished_round_are_not_finished_results(self):
        self.start();self.write('',self.proposal(),method='PATCH')
        self.finish();call('rooms/ZZ0I/remi/endReason','DELETE',uid='OWNER')
        self.write('',self.proposal(),method='PATCH')
    def test_round_nine_requires_actual_point_cap_not_just_reason_label(self):
        self.start();self.finish()
        call('rooms/ZZ0I/remi','PATCH',{'roundNumber':9},'OWNER')
        proposal=self.proposal();proposal[f'rankedMatches/{ID}/result']['rounds']=9
        self.write('',proposal,method='PATCH')
        call('rooms/ZZ0I/remi/matchOverReason','PUT','points','OWNER')
        self.write('',proposal,method='PATCH')
        call('rooms/ZZ0I/totals/0','PUT',1000,'OWNER')
        proposal[f'rankedMatches/{ID}/result']['entries']['0']['total']=1000
        self.write('',proposal,allow=True,method='PATCH')
    def test_late_lobby_join_invalidates_frozen_roster_at_start(self):
        self.seed('cangkul',3);self.start()
        extra={**h.player('p3',3),'username':'p3','nickname':'P3'}
        self.assertEqual(call('rooms/ZZ0I','PATCH',{'players/p3':extra,'seats/3':'p3'},'OWNER')[0],200)
        self.write('rooms/ZZ0I/phase','playing')
        self.assertEqual(call('rooms/ZZ0I/phase',uid='p0')[1],'lobby')
    def test_wrong_rank_points_or_score_in_proposal_is_denied(self):
        self.start();self.finish()
        for field,value in [('total',100000),('points',6)]:
            proposal=self.proposal();proposal[f'rankedMatches/{ID}/result']['entries']['1'][field]=value
            self.write('',proposal,method='PATCH')
    def test_proposal_is_immutable_and_requires_all_pending_notifications(self):
        self.start();self.finish();proposal=self.proposal();proposal.pop(f'rankedPending/p3/{ID}')
        self.write('',proposal,method='PATCH');self.propose()
        self.write(f'rankedMatches/{ID}/result/entries/0/total',999)
    def test_vote_and_credit_can_finish_after_host_leaves_or_room_is_deleted(self):
        self.start();self.finish();self.propose();call('rooms/ZZ0I','DELETE',uid='OWNER')
        self.approve();self.write('',self.packet(),'p2',True,'PATCH')
    def test_all_four_games_and_three_to_six_players(self):
        for game,size in [('truf',4),('remi',4),('cangkul',3),('cangkul',6),('tebak',4),('tebak',6)]:
            self.seed(game,size);self.ready();self.write('',self.packet(),'p1',True,'PATCH')
    def test_old_client_flag_does_not_authorize_a_credit(self):
        self.start();self.finish();call('rooms/ZZ0I/leaderboardRecorded','PUT',True,'OWNER')
        self.write('',self.packet(),method='PATCH')

if __name__=='__main__':unittest.main(verbosity=2)
