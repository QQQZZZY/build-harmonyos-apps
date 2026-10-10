import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { Preview } from '../src/preview.mjs';
import { DevEco } from '../src/adapter.mjs';
import { Workflows } from '../src/tools.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
function adapter(connected = true) {
  const calls = [];
  return { calls, devices: async () => connected ? [{name:'A',serial:'a'},{name:'B',serial:'b'}] : [],
    emulators: async () => [], device: async value => { if (!connected) throw new Error('No connected devices'); return value || 'a'; },
    screenshot: async () => ({buffer:png,width:1,height:1}), gesture: DevEco.prototype.gesture,
    ui: async (...args) => { calls.push(args); return {stdout:'done'}; } };
}
test('switch keeps the authenticated workbench and rejects inputs from its old device session', async () => {
  const a=adapter(), p=new Preview(a);
  const first=await p.start({device:'a',source:'hdc',port:0,intervalMs:10000});
  const u=new URL(first.url),headers={Authorization:`Bearer ${u.hash.slice(1)}`};
  try {
    const shot=await fetch(`${u.origin}/api/frame`,{headers}),etag=shot.headers.get('etag');
    assert.ok(etag);
    assert.equal((await fetch(`${u.origin}/api/frame`,{headers:{...headers,'If-None-Match':etag}})).status,304);
    const oldDir=p.dir;
    const switched=await fetch(`${u.origin}/api/action`,{method:'POST',headers,body:JSON.stringify({action:'device_select',device:'b',session:first.session})});
    assert.equal(switched.status,200,await switched.text());
    await assert.rejects(access(oldDir),/ENOENT/);
    const status=await (await fetch(`${u.origin}/api/status`,{headers})).json();
    assert.equal(status.device,'b');assert.ok(status.session>first.session);assert.equal(p.url,first.url);
    const old=await fetch(`${u.origin}/api/action`,{method:'POST',headers,body:JSON.stringify({action:'tap',session:first.session,point:{x:.5,y:.5}})});
    assert.equal(old.status,409);assert.equal(a.calls.length,0);
    const tap=await fetch(`${u.origin}/api/action`,{method:'POST',headers,body:JSON.stringify({action:'tap',session:status.session,point:{x:.5,y:.5}})});
    assert.equal(tap.status,200);assert.deepEqual(a.calls[0],['click',[0,0],'b']);
    const changed=await fetch(`${u.origin}/api/frame`,{headers:{...headers,'If-None-Match':etag}});
    assert.equal(changed.status,200);assert.equal(Number(changed.headers.get('X-Preview-Session')),status.session);
    assert.ok(status.events.some(e=>e.action==='device_select'));
  } finally {await p.stop();}
});
test('workbench can list devices with none connected and event history never stores typed text', async () => {
  const a=adapter(false),p=new Preview(a);
  const start=await p.start({source:'hdc',port:0,intervalMs:10000});
  const u=new URL(start.url),headers={Authorization:`Bearer ${u.hash.slice(1)}`};
  try {
    assert.deepEqual(await (await fetch(`${u.origin}/api/devices`,{headers})).json(),{devices:[],emulators:[]});
    assert.equal((await fetch(`${u.origin}/api/frame`,{headers})).status,503);
    a.device=async()=> 'a';
    await p.select('a');
    await p.control('text',{text:'private input'});
    const events=await (await fetch(`${u.origin}/api/events`,{headers})).json();
    assert.equal(events.events.at(-1).action,'text');assert.ok(!JSON.stringify(events).includes('private input'));
    a.emulatorStart=async()=>({});a.emulatorStop=async()=>({});
    await p.control('emulator_start',{name:'B'});await p.control('emulator_stop',{name:'B'});
    assert.deepEqual(p.events.slice(-2).map(e=>e.device),['B','B']);
  } finally {await p.stop();}
});
test('queued controls retain their device session, hide old frames and recover from unsupported hardware commands', async () => {
  const a=adapter(),w=new Workflows(a),p=w.preview;
  const first=await p.start({device:'a',source:'hdc',port:0,intervalMs:10000});
  const u=new URL(first.url),headers={Authorization:`Bearer ${u.hash.slice(1)}`};
  let entered,release;
  const inside=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
  a.ui=async()=>{entered();await gate;return {stdout:'done'};};
  let controls=0;a.emulatorControl=async()=>{controls++;throw new Error('Unsupported by fixture');};
  try {
    const tap=w.call('hos_preview_input',{action:'tap',point:{x:.5,y:.5}});
    await inside;
    const change=p.control('device_select',{device:'b',session:first.session});
    const rejected=assert.rejects(p.control('emulator_control',{command:'rotate',direction:'left',session:first.session}),/session changed/);
    await new Promise(r=>setImmediate(r));
    assert.equal((await fetch(`${u.origin}/api/frame`,{headers})).status,503);
    release();await tap;await change;await rejected;assert.equal(controls,0);
    await assert.rejects(p.control('emulator_control',{command:'rotate',direction:'left'}),/Unsupported by fixture/);
    assert.equal(controls,1);assert.equal(p.device,'b');assert.equal(p.status().stale,false);
    assert.equal((await fetch(`${u.origin}/api/frame`,{headers})).status,200);
  } finally {release();await p.stop();}
});
test('HAP upload requires the selected session, a package signature, and cleans temporary bytes', async () => {
  const a=adapter(),p=new Preview(a);let installed;
  a.hapInfo=async()=>({bundle:'app.fixture',ability:'Main',version:'1'});
  a.install=async(file,serial)=>{installed={file,serial};return {stdout:'installed'};};
  const first=await p.start({device:'a',source:'hdc',port:0,intervalMs:10000}),u=new URL(first.url);
  const headers={Authorization:`Bearer ${u.hash.slice(1)}`,'X-Preview-Session':String(first.session),'X-Hap-Name':'fixture.hap'};
  try {
    const missing={...headers};delete missing['X-Preview-Session'];
    assert.equal((await fetch(`${u.origin}/api/install`,{method:'POST',headers:missing,body:Buffer.from([80,75,3,4])})).status,409);
    assert.equal((await fetch(`${u.origin}/api/install`,{method:'POST',headers,body:'not a zip'})).status,400);assert.equal(installed,undefined);
    const ok=await fetch(`${u.origin}/api/install`,{method:'POST',headers,body:Buffer.from([80,75,3,4])});
    assert.equal(ok.status,200);assert.equal((await ok.json()).application.bundle,'app.fixture');assert.equal(installed.serial,'a');
    await assert.rejects(access(installed.file),/ENOENT/);assert.equal(p.status().application.bundle,'app.fixture');
  } finally {await p.stop();}
});
