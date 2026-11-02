import importlib.util,json,unittest,time
from pathlib import Path
s=importlib.util.spec_from_file_location('h',Path(__file__).with_name('room-host-security.py'));h=importlib.util.module_from_spec(s);s.loader.exec_module(h)
class OnlineSecurity(unittest.TestCase):
 def test_presence_permissions(self):
  self.assertEqual(h.call('.settings/rules','PUT',json.loads((h.ROOT/'database.rules.json').read_text()),'OWNER')[0],200)
  p='onlinePlayers/host/'+'a'*32
  for uid,provider,value,allowed in [('host','password',{'.sv':'timestamp'},True),('member','password',{'.sv':'timestamp'},False),('host','anonymous',{'.sv':'timestamp'},False),('host','password',int(time.time()*1000)+60000,False),('host','password',{'isOnline':True},False)]:
   self.assertEqual(h.call(p,'PUT',value,uid,provider)[0],200 if allowed else 401)
  self.assertEqual(h.call(p,'DELETE',uid='member')[0],401)
  self.assertEqual(h.call(p,'DELETE',uid='host')[0],200)
  self.assertEqual(h.call('onlinePlayers',uid=None)[0],401)
if __name__=='__main__':unittest.main()
