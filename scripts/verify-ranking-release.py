#!/usr/bin/env python3
"""Read-only production release gate. Never reads accounts, cards or secrets."""
import argparse,json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import urllib.request

parser=argparse.ArgumentParser()
parser.add_argument('--base',default='https://main-kartu-game.web.app')
parser.add_argument('--rules',required=True,help='Owner CLI readback of /.settings/rules')
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
active=json.loads(Path(args.rules).read_text())
if isinstance(active,str):active=json.loads(active)
assert active==json.loads((root/'database.rules.json').read_text()),'Production rules differ from tested source'
policy=active['rules']
assert policy['rankedMatches']['$matchId']['contract']['.validate']=='newData.val() === 3'
assert 'rankedAwards' in policy['leaderboards']['$game']['$username']['.write']
assert policy['config']['leaderboardContract']=={'.read':True,'.write':False}
checks=[(route,'truf-multiplayer-v3.html') for route in ['/','/truf','/remi','/cangkul','/tebak','/remi/ZZ0I']]
checks += [(f'/{file}?v=3',file) for file in ['ranked-leaderboard.js','ranked-client.js','ranked-ui.js','room-membership.js']]
checks += [('/room-lifecycle.js?v=1','room-lifecycle.js')]
checks += [('/remi-celebration.js?v=1','remi-celebration.js')]
checks += [('/close-celebration.m4a?v=1','close-celebration.m4a','immutable')]
def verify(pair):
    route,file=pair[:2]
    cache=pair[2] if len(pair)>2 else 'no-store'
    req=urllib.request.Request(args.base.rstrip('/')+route,headers={'Cache-Control':'no-cache'})
    with urllib.request.urlopen(req,timeout=30) as response:
        assert response.read()==(root/file).read_bytes(),'Stale or different client asset: '+route
        assert cache in response.headers.get('Cache-Control',''),'Cache policy mismatch: '+route
    return route
for route in ThreadPoolExecutor(max_workers=5).map(verify,checks):print('VERIFIED',route)
url='https://truf-e3256-default-rtdb.asia-southeast1.firebasedatabase.app/config/leaderboardContract.json'
with urllib.request.urlopen(url,timeout=30) as response:assert json.load(response)==3,'Runtime ranking contract mismatch'
assert 'leaderboardRecorded: true' not in (root/'truf-multiplayer-v3.html').read_text()
print('Ranking contract v3: production rules, runtime metadata and every client route agree.')
