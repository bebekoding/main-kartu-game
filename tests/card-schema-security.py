#!/usr/bin/env python3
"""Actual rules, local emulator only. No production accounts or game data."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('host_test_helpers', Path(__file__).with_name('room-host-security.py'))
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
call = helpers.call
CARD = {'rank':'K','suit':'H'}
ATTACK = '<img src=x onerror="alert(1)">'
CARD_PATHS = ['hands/0/0','bidding/bids/0/cards/0','play/currentTrick/0/card',
    'remi/hands/0/0','remi/deck/0','remi/discard/0/card','remi/laidDown/0/0/cards/0','remi/lastDrawnCard',
    'cangkul/hands/0/0','cangkul/drawPile/0','cangkul/currentTrick/0/card','cangkul/lastDrawnCard',
    'tebak/hands/0/0','tebak/deck/0','tebak/jadi/0/0/cards/0']

def room():
    return {'code':'ZZ0I','game':'remi','phase':'playing','host':'host','membershipVersion':2,'maxPlayers':4,
        'players':{'host':helpers.player('host',0),'member':helpers.player('member',1)},'seats':{'0':'host','1':'member'},
        'hands':{'0':[CARD]}, 'bidding':{'bids':{'0':{'cards':[CARD],'point':0,'suit':'H'}}},
        'play':{'currentTrick':[{'seat':0,'card':CARD}]},
        'remi':{'hands':{'0':[CARD]},'deck':[CARD],'discard':[{'by':1,'card':CARD}],
            'laidDown':{'0':[{'kind':'dasar','cards':[CARD]}]},'lastDrawnCard':CARD},
        'cangkul':{'hands':{'0':[CARD]},'drawPile':[CARD],'currentTrick':[{'seat':0,'card':CARD}],'lastDrawnCard':CARD},
        'tebak':{'hands':{'0':[CARD]},'deck':[CARD],'jadi':{'0':[{'rank':'K','cards':[CARD]}]},
            'lastAction':{'type':'guess_hit','by':0,'target':1,'rank':'K','count':1,'at':1},
            'log':[{'by':0,'target':1,'rank':'K','hit':1,'at':1}]}}

class CardSchemaSecurity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        rules = json.loads((Path(__file__).resolve().parents[1]/'database.rules.json').read_text())
        status, body = call('.settings/rules','PUT',rules,'OWNER')
        if status != 200: raise RuntimeError((status,body))

    def setUp(self):
        self.assertEqual(call('','PUT',{'rooms':{'ZZ0I':room()}},'OWNER')[0],200)

    def write(self,path,value,allow=False,method='PUT',uid='member'):
        status,body=call('rooms/ZZ0I/'+path,method,value,uid)
        self.assertEqual(status,200 if allow else 401,(path,body))

    def test_all_normal_rank_suit_combinations_in_all_four_games(self):
        cards=[{'rank':r,'suit':s} for s in 'SHCD' for r in ['2','3','4','5','6','7','8','9','10','J','Q','K','A']]
        self.write('',{'hands/0':cards,'remi/deck':cards,'cangkul/drawPile':cards,'tebak/deck':cards},True,'PATCH')
        for path in CARD_PATHS: self.write(path,CARD,True)

    def test_jokers_only_in_remi_and_cangkul(self):
        for color in ['red','black']:
            joker={'rank':'JOKER','color':color}
            for path in ['remi/hands/0/0','remi/deck/0','cangkul/drawPile/0','cangkul/currentTrick/0/card']:
                self.write(path,joker,True)
            for path in ['hands/0/0','tebak/deck/0','bidding/bids/0/cards/0']:self.write(path,joker)

    def test_injected_rank_rejected_in_every_card_location(self):
        for path in CARD_PATHS:
            with self.subTest(path=path):self.write(path,{'rank':ATTACK,'suit':'H'})

    def test_suit_url_and_attribute_injection_rejected(self):
        for suit in ['H" onerror="alert(1)','../K-H','constructor','__proto__',ATTACK]:
            for path in ['hands/0/0','remi/deck/0','cangkul/drawPile/0','tebak/deck/0']:
                self.write(path,{'rank':'J','suit':suit})

    def test_card_must_be_object_with_valid_core_fields(self):
        for value in [ATTACK,1,True,{'rank':2,'suit':'H'},{'rank':'K'},{'rank':'K','suit':'H','color':'red'},
            {'rank':'JOKER','color':ATTACK},{'rank':'JOKER','color':'red','suit':'H'},{'rank':'JOKER'}]:
            self.write('remi/deck/0',value)

    def test_deleting_rank_or_suit_cannot_leave_broken_card(self):
        self.write('remi/hands/0/0/rank',None,method='DELETE')
        self.write('remi/hands/0/0/suit',None,method='DELETE')
        self.write('remi/hands/0/0',None,True,'DELETE')

    def test_legitimate_remi_pickup_tags_survive(self):
        tagged={**CARD,'fromDiscardBy':1,'justPicked':True,'justPickedSeq':0,'mustLayThisTurn':True,'pickupNonce':'pAbc123'}
        self.write('remi/hands/0/0',tagged,True)
        self.write('remi/laidDown/0/0',{'kind':'pararel','cards':[tagged],'atTurn':123},True)
        for field,value in [('pickupNonce',ATTACK),('justPicked',ATTACK),('justPickedSeq',ATTACK),('fromDiscardBy',ATTACK)]:
            self.write('remi/hands/0/0/'+field,value)

    def test_remi_discard_modern_and_legacy(self):
        self.write('remi/discard',[{'card':CARD,'by':1}],True)
        self.write('remi/discard',[CARD],True)
        self.write('remi/discard',[{'rank':ATTACK,'suit':'H'}])
        self.write('remi/discard',[{'card':{'rank':ATTACK,'suit':'H'},'by':1}])

    def test_combo_kind_cannot_inject_an_attribute(self):
        self.write('remi/laidDown/0/0/kind','" onmouseover="alert(1)')
        self.write('remi/laidDown/0/0/kind','dasar',True)

    def test_tebak_action_and_log_display_fields_are_typed(self):
        for field in ['rank','count','four/0']:
            self.write('tebak/lastAction/'+field,ATTACK)
        for field in ['rank','hit','four/0']:
            self.write('tebak/log/0/'+field,ATTACK)
        self.write('tebak/lastAction/four',['K','A'],True)
        self.write('tebak/log/0/four',['K','A'],True)

    def test_tebak_legacy_jadi_and_modern_card_sets(self):
        for value in [[{'rank':'K','cards':[CARD]}],[{'rank':'K'}],['K']]:self.write('tebak/jadi/0',value,True)
        self.write('tebak/jadi/0',[ATTACK])
        self.write('tebak/jadi/0',[{'rank':ATTACK}])

    def test_atomic_patch_and_parent_put_do_not_bypass_schema(self):
        self.write('',{'remi/hands/0/0/rank':ATTACK,'remi/currentPlayer':1},method='PATCH')
        malformed=room();malformed['remi']['deck'][0]={'rank':ATTACK,'suit':'H'}
        self.write('remi',malformed['remi'])
        self.write('',malformed,uid='host')
        self.assertEqual(call('rooms/ZZ0I/remi/hands/0/0/rank')[1],'K')

    def test_room_creation_also_validates_nested_cards(self):
        self.assertEqual(call('rooms/ZZ0I','DELETE',uid='OWNER')[0],200)
        malformed=room();malformed['remi']['deck'][0]={'rank':ATTACK,'suit':'H'}
        self.write('',malformed,uid='host')
        self.write('',room(),True,uid='host')

    def test_seat_and_list_keys_cannot_hide_unvalidated_cards(self):
        self.write('remi/hands/6',[CARD])
        self.write('remi/deck/56',CARD)
        self.write('remi/deck/garbage',CARD)
        self.write('remi/deck/0/onerror',ATTACK)
        self.write('remi/deck',ATTACK)

    def test_outsider_and_anonymous_still_cannot_write_valid_cards(self):
        self.write('remi/hands/0/0',CARD,uid='outsider')
        self.assertEqual(call('rooms/ZZ0I/remi/hands/0/0','PUT',CARD,'member','anonymous')[0],401)

if __name__=='__main__':unittest.main(verbosity=2)
