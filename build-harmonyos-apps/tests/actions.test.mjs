import test from 'node:test';
import assert from 'node:assert/strict';
import { DevEco } from '../src/adapter.mjs';
import { Workflows } from '../src/tools.mjs';

function fixture() {
  const adapter = new DevEco(), commands = [];
  adapter.device = async () => 'fixture';
  adapter.command = async (args, options) => { commands.push({args,options}); return {stdout:'done'}; };
  return {adapter, commands, workflows:new Workflows(adapter)};
}
test('MCP gesture mapping and rejection use the shared CLI adapter', async () => {
  const {adapter,commands,workflows:w}=fixture();
  await w.call('hos_doubletap',{id:'submit'});
  await w.call('hos_longpress',{x:3,y:4});
  await w.call('hos_drag',{x1:0,y1:1,x2:3,y2:4,speed:200});
  assert.deepEqual(commands.map(c=>c.args), [ ['ui','doubleclick','--id','submit','--device','fixture'], ['ui','longclick','3','4','--device','fixture'], ['ui','drag','0','1','3','4','--speed','200','--device','fixture'] ]);
  await assert.rejects(w.call('hos_tap',{id:'x',x:1,y:2}),/OR/);
  await assert.rejects(adapter.gesture('swipe',{x1:0,y1:0,x2:1,y2:1,speed:1},'fixture'),/integer/);
  await assert.rejects(adapter.gesture('tap',{x:1,y:2,shell:'bad'},'fixture'),/Unknown/);
  assert.equal(commands.length,3);
  adapter.command=async()=>{throw new Error('device disconnected');};
  await assert.rejects(w.call('hos_longpress',{id:'submit'}),/disconnected/);
});
test('emulator controls are bounded and match official single-operation flags',async()=>{
  const {adapter,commands,workflows:w}=fixture();
  await w.call('hos_emulator_stop',{name:'Pura X Max'});
  await w.call('hos_emulator_control',{target:'Pura X Max',command:'rotate',direction:'left'});
  await adapter.emulatorControl('127.0.0.1:5555',{command:'geolocation',latitude:30.25});
  await adapter.emulatorControl('Pura X Max',{command:'sensor',lightIntensity:12.5});
  assert.deepEqual(commands.map(c=>c.args),[['emulator','stop','Pura X Max'],['emulator','rotate','left','--target','Pura X Max'],['emulator','geolocation','--latitude','30.25','--target','127.0.0.1:5555'],['emulator','sensor','--light-intensity','12.5','--target','Pura X Max']]);
  for(const args of [{command:'power',shell:'bad'},{command:'fold',state:'unknown'},{command:'battery',level:50,status:'charging'},{command:'geolocation',latitude:91},{command:'sensor',steps:1.5},{command:'geolocation',direction:1.001}]) await assert.rejects(adapter.emulatorControl('Pura X Max',args));
  await assert.rejects(adapter.emulatorControl('--help',{command:'power'}));
  assert.equal(commands.length,4);
});
test('emulator identities follow connected names rather than CLI list order',async()=>{
  const adapter=new DevEco();
  adapter.command=async()=>({stdout:JSON.stringify([{name:'A',serial:'b'},{name:'B',serial:'a'},{name:'Stopped',serial:'a'}])});
  adapter.devices=async()=>[{name:'A',serial:'a',kind:'emulator'},{name:'B',serial:'b',kind:'emulator'}];
  assert.deepEqual((await adapter.emulators()).map(e=>e.serial),['a','b',null]);
  adapter.devices=async()=>[{name:'A',serial:'a',kind:'emulator'},{name:'A',serial:'other',kind:'emulator'}];
  assert.equal((await adapter.emulators())[0].serial,null);
});
test('logs are bounded; preview tools delegate and preserve errors',async()=>{
  const {adapter,commands,workflows:w}=fixture();
  await w.call('hos_logs',{tail:50,level:'W',bundle:'app.demo',crash:true});
  assert.deepEqual(commands[0].args,['log','--device','fixture','--tail','50','--bundle-name','app.demo','--level','W','--crash']);
  await assert.rejects(adapter.logs('fixture',{tail:2001}));
  adapter.hdc=async()=>{throw new Error('HDC should not run for invalid key');};
  await assert.rejects(adapter.key('fixture','Power'),/Invalid system key/);
  assert.deepEqual(await w.call('hos_events'),{session:null,events:[]});
  adapter.key=async(serial,key)=>({serial,key});
  assert.deepEqual(await w.call('hos_key',{key:'Home'}),{serial:'fixture',key:'Home'});
  assert.equal((await w.call('hos_events')).events.at(-1).action,'hos_key');
  const delegated=[];
  w.preview={select:async value=>delegated.push(value),retry:async args=>delegated.push(args),events:[{action:'tap'}],session:2};
  await w.call('hos_preview_select',{device:'fixture'}); await w.call('hos_preview_retry',{source:'hdc'});
  assert.deepEqual(delegated,['fixture',{source:'hdc'}]);
  assert.deepEqual(await w.call('hos_events'),{session:2,events:[{action:'tap'}]});
});

test('incremental run validates its change list and preserves CLI failures',async()=>{
  const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'hos-apply-'));
  const {adapter,commands,workflows:w}=fixture();
  adapter.project=async()=>dir;
  try {
    await mkdir(join(dir,'.hvigor')); await writeFile(join(dir,'.hvigor','changes.txt'),'entry/src/main/ets/pages/Index.ets\n');
    await w.call('hos_run',{project:dir,apply:true,changeFile:'changes.txt'});
    await w.call('hos_run',{project:dir,hotReloadApply:true,changeFile:'changes.txt',module:'entry'});
    assert.deepEqual(commands.map(c=>c.args),[['run','--device','fixture','--apply','changes.txt'],['run','--device','fixture','--module','entry','--hotreload-apply','changes.txt']]);
    assert.equal(commands[0].options.cwd,dir);
    for(const args of [{apply:true,hotReloadApply:true,changeFile:'changes.txt'},{apply:true,skipBuild:true,changeFile:'changes.txt'},{hotReloadApply:true,skipBuild:true,changeFile:'changes.txt'},{apply:true},{changeFile:'changes.txt'},{apply:true,changeFile:'../changes.txt'},{apply:true,changeFile:'C:\\changes.txt'},{apply:true,changeFile:'-changes.txt'},{apply:true,changeFile:'missing.txt'}]) await assert.rejects(w.call('hos_run',{project:dir,...args}));
    assert.equal(commands.length,2);
    adapter.command=async()=>{throw new Error('hot reload watch session inactive');};
    await assert.rejects(w.call('hos_run',{project:dir,hotReloadApply:true,changeFile:'changes.txt'}),/watch session inactive/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('HAP metadata is bounded and application records only follow successful commands',async()=>{
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {runCommand}=await import('../src/adapter.mjs');
  const dir=await mkdtemp(join(tmpdir(),'hos-hap-'));
  const {adapter,workflows:w}=fixture();
  w.preview.applications=new Map();
  try {
    await writeFile(join(dir,'module.json'),JSON.stringify({app:{bundleName:'app.demo',versionName:'1.2'},module:{mainElement:'EntryAbility'}}));
    const hap=join(dir,'demo.hap');
    await runCommand('/usr/bin/zip',['-q',hap,'module.json'],{cwd:dir});
    assert.deepEqual(await adapter.hapInfo(hap),{bundle:'app.demo',ability:'EntryAbility',version:'1.2'});
    await writeFile(join(dir,'other.txt'),'no manifest');
    const other=join(dir,'other.hap'); await runCommand('/usr/bin/zip',['-q',other,'other.txt'],{cwd:dir});
    assert.equal(await adapter.hapInfo(other),null);
    await writeFile(join(dir,'module.json'),JSON.stringify({app:{bundleName:'app.demo',versionName:123},module:{mainElement:'EntryAbility'}}));
    const invalid=join(dir,'invalid.hap'); await runCommand('/usr/bin/zip',['-q',invalid,'module.json'],{cwd:dir});
    await assert.rejects(adapter.hapInfo(invalid),/version/);
    adapter.install=async()=>({stdout:'installed',stderr:''});
    const installed=await w.call('hos_install',{hap});
    assert.equal(installed.application.bundle,'app.demo');
    assert.equal(installed.application.installedAt,w.preview.applications.get('fixture').installedAt);
    adapter.launch=async()=>{throw new Error('start failed');};
    await assert.rejects(w.call('hos_launch',{bundle:'app.other',ability:'Main'}),/start failed/);
    assert.equal(w.preview.applications.get('fixture').bundle,'app.demo');
    adapter.launch=async()=>({stdout:'launched',stderr:''});
    const launched=await w.call('hos_launch',{bundle:'app.demo',ability:'EntryAbility'});
    assert.equal(launched.application.version,'1.2');
    assert.equal(typeof launched.application.launchedAt,'number');
    assert.equal(launched.application.installedAt,installed.application.installedAt);
  } finally {await rm(dir,{recursive:true,force:true});}
});
