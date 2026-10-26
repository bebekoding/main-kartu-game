#!/usr/bin/env python3
"""Read only public room membership metadata and prepare a migration patch.

No hands/decks/chat/accounts/credentials are fetched. This script does not apply
the patch. Review the summary, then use Firebase Admin CLI database:update /rooms.
Rooms with corrupt/duplicate/out-of-range seats are left unchanged (fail closed).
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import time
import urllib.parse
import urllib.request

BASE='https://truf-e3256-default-rtdb.asia-southeast1.firebasedatabase.app'


def read(path, query=''):
    with urllib.request.urlopen(BASE+'/'+urllib.parse.quote(path,safe='/')+'.json'+query,timeout=20) as response:
        return json.load(response)


def build(code):
    if not re.fullmatch('[A-Z0-9]{4,6}',code):
        return code,None,'invalid_room_code',0,{}
    players=read('rooms/'+code+'/players') or {}
    game=read('rooms/'+code+'/game') or 'truf'
    phase=read('rooms/'+code+'/phase')
    max_players=read('rooms/'+code+'/maxPlayers')
    original_roster=read('rooms/'+code+'/gameState/roster')
    roster=original_roster or read('rooms/'+code+'/roster')
    # Arrays are Firebase's representation of dense numeric maps.
    if isinstance(roster,list):roster={str(i):v for i,v in enumerate(roster) if v}
    if not isinstance(players,dict):return code,None,'invalid_players',0,{}
    online=sum(1 for p in players.values() if isinstance(p,dict) and not p.get('isBot') and
               isinstance(p.get('lastSeen'),(int,float)) and p['lastSeen']>=time.time()*1000-60000)
    flex=game in ('cangkul','tebak')
    try:
        capacity=max(4 if game=='tebak' else 3,min(6,int(max_players or 4))) if flex else 4
    except (ValueError,TypeError):capacity=4
    seats={}
    for uid,p in players.items():
        if not isinstance(p,dict) or p.get('uid')!=uid or not isinstance(p.get('seat'),int) or isinstance(p['seat'],bool) or not isinstance(p.get('isBot'),bool):
            return code,None,'invalid_player_record',online,{}
        seat=p['seat']
        if not 0<=seat<capacity:return code,None,'out_of_range_seat',online,{}
        if str(seat) in seats:return code,None,'duplicate_seat',online,{}
        if not isinstance(p.get('nickname'),str) or len(p['nickname'])>64:return code,None,'invalid_nickname',online,{}
        seats[str(seat)]=uid
    if phase is None:return code,None,'missing_room_phase',online,{}
    rollback={code+'/seats':read('rooms/'+code+'/seats'),
              code+'/membershipVersion':read('rooms/'+code+'/membershipVersion'),code+'/maxPlayers':max_players}
    patch={code+'/seats':seats or None,code+'/membershipVersion':2,code+'/maxPlayers':capacity}
    if phase!='lobby':
        if not roster:
            roster={str(p['seat']):{'uid':uid,'nickname':p['nickname'],'isBot':bool(p['isBot'] and not p.get('leftHuman'))} for uid,p in players.items()}
        patch[code+'/gameState/roster']=roster or None
        rollback[code+'/gameState/roster']=original_roster
    return code,patch,None,online,rollback


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    keys=read('rooms','?shallow=true') or {}
    patch={};rollback={};blocked=[];ready=0;online_rooms=0
    with ThreadPoolExecutor(max_workers=8) as pool:
        for code,data,error,online,undo in pool.map(build,keys):
            if data:patch.update(data);rollback.update(undo);ready+=1
            else:blocked.append({'code':code,'reason':error,'recentHumans':online})
            if online:online_rooms+=1
    target=Path(args.output)
    target.write_text(json.dumps(patch,ensure_ascii=False,indent=2)+'\n')
    target.chmod(0o600)
    undo_path=target.with_suffix('.rollback.json')
    undo_path.write_text(json.dumps(rollback,ensure_ascii=False,indent=2)+'\n');undo_path.chmod(0o600)
    report={'totalRooms':len(keys),'readyRooms':ready,'roomsWithRecentHumans':online_rooms,'blockedRooms':blocked}
    target.with_suffix('.summary.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
