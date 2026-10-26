#!/usr/bin/env python3
"""Security regression tests against local RTDB emulator on port 19000 only.
Run: python3 tests/room-host-security.py. Never targets a production URL.
"""
import base64
import copy
import json
from pathlib import Path
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

BASE = 'http://127.0.0.1:19000'
NS = 'demo-main-kartu-host'
ROOT = Path(__file__).resolve().parents[1]


def jwt(uid, provider='password'):
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip('=')
    return enc({'alg': 'none', 'typ': 'JWT'}) + '.' + enc({
        'sub': uid, 'user_id': uid, 'aud': NS, 'iat': int(time.time()),
        'exp': int(time.time()) + 3600, 'iss': 'https://securetoken.google.com/' + NS,
        'firebase': {'sign_in_provider': provider},
    }) + '.'


def call(path, method='GET', value=None, uid=None, provider='password'):
    query, headers = {'ns': NS}, {'Content-Type': 'application/json'}
    if uid == 'OWNER':
        headers['Authorization'] = 'Bearer owner'
    elif uid:
        query['auth'] = jwt(uid, provider)
    request = urllib.request.Request(BASE + '/' + path + '.json?' + urllib.parse.urlencode(query),
        data=json.dumps(value).encode() if method in ('PUT', 'PATCH') else None,
        method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read() or 'null')
    except urllib.error.HTTPError as error:
        status, body = error.code, json.loads(error.read() or 'null')
        error.close()
        return status, body


def player(uid, seat, bot=False, **extra):
    return {'uid': uid, 'seat': seat, 'isBot': bot, 'nickname': uid,
            'lastSeen': int(time.time()*1000), **extra}


def fixture(phase='playing'):
    people = {p['uid']: p for p in [player('host', 0), player('member', 1),
                                   player('bot2', 2, True), player('bot3', 3, True)]}
    return {'rooms': {'ZZ0I': {'code': 'ZZ0I', 'game': 'remi', 'phase': phase,
        'host': 'host', 'membershipVersion': 2, 'maxPlayers': 4,
        'players': people, 'seats': {str(p['seat']): p['uid'] for p in people.values()},
        'gameState': {'roster': {str(p['seat']): {'uid': p['uid'], 'isBot': p['isBot'], 'nickname': p['nickname']} for p in people.values()}},
        'remi': {'currentPlayer': 0, 'hands': {'0': [{'rank': 'K', 'suit': 'H'}]}}
    }}}


class RoomHostSecurity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        status, body = call('.settings/rules', 'PUT', json.loads((ROOT/'database.rules.json').read_text()), 'OWNER')
        if status != 200:
            raise RuntimeError(f'Invalid rules: {status}: {body}')

    def setUp(self):
        self.state = fixture()
        self.seed()

    def seed(self):
        self.assertEqual(call('', 'PUT', self.state, 'OWNER')[0], 200)

    def write(self, path, value, uid='member', method='PUT', allow=False):
        if path == 'host' and method == 'PUT':
            # Ownership changes also invalidate requests for the previous owner.
            path,method,value='','PATCH',{'host':value,'hostRequests':None}
        status, body = call('rooms/ZZ0I/' + path, method, value, uid)
        self.assertEqual(status, 200 if allow else 401, (path, body))

    def test_baselines(self):
        self.write('remi/currentPlayer', 1, uid=None)
        self.write('remi/currentPlayer', 1, uid='outsider')
        self.write('remi/currentPlayer', 1, uid='member', allow=True)
        self.write('remi/currentPlayer', 2, uid='host', allow=True)

    def test_no_live_match_injection_or_host_theft(self):
        self.write('players/outsider', player('outsider', 0), uid='outsider')
        self.write('host', 'outsider', uid='outsider')
        self.write('host', 'member')
        self.write('players/bot2', None, uid='outsider', method='DELETE')
        self.write('gameState/roster/2', {'uid':'outsider','isBot':False}, uid='member')
        self.write('seats/2', 'outsider', uid='outsider')
        self.write('membershipVersion', 1)

    def test_atomic_injection_cannot_bypass_rules(self):
        self.write('', {'players/outsider':player('outsider',2), 'players/bot2':None,
                        'seats/2':'outsider','host':'outsider'}, uid='outsider', method='PATCH')
        self.assertEqual(call('rooms/ZZ0I/host')[1], 'host')
        self.assertIsNone(call('rooms/ZZ0I/players/outsider')[1])

    def test_existing_member_cannot_reseat_or_takeover(self):
        self.write('', {'players/member/seat':2,'seats/1':None,'seats/2':'member',
                        'players/bot2':None}, method='PATCH')
        self.write('host', 'member')
        self.write('players/host/disconnected', True)
        self.write('players/host/lastSeen', 0)

    def test_seat_index_cannot_hide_existing_human(self):
        self.write('seats/1',None,method='DELETE')
        self.write('seats',{'0':'host','2':'bot2','3':'bot3'},uid='host')
        self.write('seats/0',None,uid='host',method='DELETE')

    def test_request_then_owner_approval(self):
        self.write('hostRequests/member', {'uid':'member','hostUid':'host','requestedAt':int(time.time()*1000)}, allow=True)
        self.write('host', 'member')  # requester cannot self-approve
        self.write('host', 'member', uid='host', allow=True)
        self.assertEqual(call('rooms/ZZ0I/host')[1], 'member')
        self.write('host', 'host', uid='host')  # previous host has no special right

    def test_owner_cannot_forge_request_or_transfer_without_it(self):
        self.write('host', 'member', uid='host')
        self.write('hostRequests/member', {'uid':'member','hostUid':'host','requestedAt':int(time.time()*1000)}, uid='host')

    def test_decline_request(self):
        self.write('hostRequests/member', {'uid':'member','hostUid':'host','requestedAt':int(time.time()*1000)}, allow=True)
        self.write('hostRequests/member', None, uid='host', method='DELETE', allow=True)
        self.write('host', 'member', uid='host')

    def test_stale_host_request_is_not_valid_for_new_owner(self):
        self.state['rooms']['ZZ0I']['hostRequests']={'member':{'uid':'member','hostUid':'previous','requestedAt':int(time.time()*1000)}}
        self.seed()
        self.write('host', 'member', uid='host')

    def test_transfer_must_clear_previous_owner_requests(self):
        self.write('hostRequests/member', {'uid':'member','hostUid':'host','requestedAt':int(time.time()*1000)}, allow=True)
        self.write('',{'host':'member'},uid='host',method='PATCH')
        self.write('host','member',uid='host',allow=True)
        self.assertIsNone(call('rooms/ZZ0I/hostRequests')[1])

    def test_approval_requires_online_human(self):
        r=self.state['rooms']['ZZ0I']
        r['hostRequests']={'member':{'uid':'member','hostUid':'host','requestedAt':int(time.time()*1000)}}
        r['players']['member']['lastSeen']=int(time.time()*1000)-30000
        self.seed()
        self.write('host', 'member', uid='host')

    def test_active_host_exit_transfers_atomically_and_preserves_match(self):
        self.write('', {'players/host/isBot':True,'players/host/leftHuman':True,
                        'players/host/lastSeen':0,'host':'member','hostRequests':None}, uid='host', method='PATCH', allow=True)
        self.assertEqual(call('rooms/ZZ0I/host')[1], 'member')
        self.assertIsNotNone(call('rooms/ZZ0I/remi/hands')[1])
        self.write('remi/currentPlayer',2,uid='host')  # departed bot UID is not a human writer

    def test_lobby_host_exit_transfers_and_releases_seat(self):
        self.state=fixture('lobby');self.seed()
        self.write('', {'players/host':None,'seats/0':None,'host':'member'}, uid='host', method='PATCH', allow=True)

    def test_failover_after_timeout_in_match_and_lobby(self):
        for phase in ('playing','lobby'):
            self.state=fixture(phase)
            self.state['rooms']['ZZ0I']['players']['host']['lastSeen']=int(time.time()*1000)-50000
            self.seed()
            self.write('host','member',allow=True)

    def test_cannot_trigger_failover_before_timeout(self):
        self.state['rooms']['ZZ0I']['players']['host']['lastSeen']=int(time.time()*1000)-20000
        self.seed()
        self.write('host','member')

    def test_failover_chooses_first_online_human(self):
        r=self.state['rooms']['ZZ0I'];r['players']['host']['lastSeen']=0
        r['players']['second']=player('second',2);r['seats']['2']='second';del r['players']['bot2']
        self.seed()
        self.write('host','second',uid='second')
        self.write('host','member',allow=True)

    def test_host_cannot_leave_to_offline_player(self):
        self.state['rooms']['ZZ0I']['players']['member']['lastSeen']=0;self.seed()
        self.write('',{'players/host/isBot':True,'host':'member'},uid='host',method='PATCH')

    def test_last_online_host_can_leave_no_free_claim_over_offline_human(self):
        self.state['rooms']['ZZ0I']['players']['member']['lastSeen']=0;self.seed()
        self.write('',{'players/host/isBot':True,'host':None},uid='host',method='PATCH',allow=True)
        self.write('',{'players/outsider':player('outsider',2),'players/bot2':None,
                       'seats/2':'outsider','host':'outsider'},uid='outsider',method='PATCH')

    def test_free_claim_only_all_bot_match(self):
        r=self.state['rooms']['ZZ0I']
        for p in r['players'].values():p['isBot']=True
        r['host']=None;self.seed()
        self.write('',{'players/outsider':player('outsider',2),'players/bot2':None,
                       'seats/2':'outsider','host':'outsider'},uid='outsider',method='PATCH',allow=True)
        self.write('host','member',uid='member')

    def test_claim_requires_seated_poststate(self):
        r=self.state['rooms']['ZZ0I']
        for p in r['players'].values():p['isBot']=True
        self.seed()
        self.write('host','outsider',uid='outsider')

    def test_lobby_join_and_seat_conflict(self):
        r=self.state['rooms']['ZZ0I'];r['phase']='lobby';del r['players']['bot2'];del r['seats']['2'];self.seed()
        self.write('',{'players/new':player('new',2),'seats/2':'new'},uid='new',method='PATCH',allow=True)
        self.write('',{'players/second':player('second',2),'seats/2':'second'},uid='second',method='PATCH')

    def test_full_bot_lobby_with_human_does_not_accept_replacement(self):
        self.state['rooms']['ZZ0I']['phase']='lobby';self.seed()
        self.write('',{'players/new':player('new',2),'players/bot2':None,'seats/2':'new'},uid='new',method='PATCH')

    def test_reconnect_uses_original_uid_not_nickname(self):
        r=self.state['rooms']['ZZ0I'];del r['players']['member'];r['players']['replacement']=player('replacement',1,True);r['seats']['1']='replacement';self.seed()
        self.write('',{'players/member':player('member',1),'players/replacement':None,'seats/1':'member'},method='PATCH',allow=True)
        self.write('',{'players/imposter':player('imposter',1,nickname='member'),'players/member':None,'seats/1':'imposter'},uid='imposter',method='PATCH')

    def test_real_bot_can_be_added_and_removed_only_by_host(self):
        r=self.state['rooms']['ZZ0I'];r['phase']='lobby';del r['players']['bot2'];del r['seats']['2'];self.seed()
        self.write('',{'players/botNew':player('botNew',2,True),'seats/2':'botNew'},uid='host',method='PATCH',allow=True)
        self.write('',{'players/botNew':None,'seats/2':None},uid='host',method='PATCH',allow=True)

    def test_lobby_cleanup_cannot_remove_fresh_human(self):
        self.state['rooms']['ZZ0I']['phase']='lobby';self.seed()
        self.write('',{'players/member':None,'seats/1':None},uid='host',method='PATCH')
        self.state['rooms']['ZZ0I']['players']['member']['disconnected']=True;self.seed()
        self.write('',{'players/member':None,'seats/1':None},uid='host',method='PATCH',allow=True)

    def test_anonymous_cannot_join_request_or_migrate(self):
        for path,method,value in [
            ('players/anon','PUT',player('anon',0)),('host','PUT','anon'),
            ('hostRequests/anon','PUT',{'uid':'anon','hostUid':'host','requestedAt':int(time.time()*1000)}),
        ]:
            self.assertEqual(call('rooms/ZZ0I/'+path,method,value,'anon','anonymous')[0],401)

    def test_host_recovers_original_human_only(self):
        r=self.state['rooms']['ZZ0I'];del r['players']['member'];del r['seats']['1'];self.seed()
        self.write('',{'players/member':player('member',1),'seats/1':'member'},uid='host',method='PATCH',allow=True)
        self.write('',{'players/outsider':player('outsider',2),'players/bot2':None,'seats/2':'outsider'},uid='host',method='PATCH')

    def test_parent_writes_cannot_bypass_host_policy(self):
        r=copy.deepcopy(self.state['rooms']['ZZ0I']);r['host']='member'
        self.write('',r,uid='member')
        self.write('players', {'member':r['players']['member']})

    def test_new_room_requires_secure_membership_and_human_owner(self):
        r=fixture('lobby')['rooms']['ZZ0I']
        self.assertEqual(call('rooms/ZZ0J','PUT',r,'host')[0],200)
        r.pop('seats');r.pop('membershipVersion')
        self.assertEqual(call('rooms/ZZ0K','PUT',r,'host')[0],401)

    def test_flexible_game_can_use_six_canonical_seats(self):
        r=self.state['rooms']['ZZ0I'];r['game']='tebak';r['maxPlayers']=6;r['phase']='lobby';self.seed()
        self.write('',{'players/fifth':player('fifth',4),'seats/4':'fifth'},uid='fifth',method='PATCH',allow=True)
        self.write('',{'players/sixth':player('sixth',5),'seats/5':'sixth'},uid='sixth',method='PATCH',allow=True)

    @classmethod
    def tearDownClass(cls):
        call('', 'DELETE', uid='OWNER')


if __name__ == '__main__':
    unittest.main(verbosity=2)
