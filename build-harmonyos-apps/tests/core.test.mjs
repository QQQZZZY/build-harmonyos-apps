import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mapPoint, cropRect, Preview, windowMatchesEmulator } from '../src/preview.mjs';
import { parseJSON, pngSize, ROOT, runCommand, DevEco, cancelCommands, inputScript } from '../src/adapter.mjs';
import { Workflows, TOOLS } from '../src/tools.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');

test('preview coordinates preserve crop, device edges and reject unsafe points', () => {
  const crop = cropRect({ x: .1, y: .2, width: .8, height: .6 }), size = { width: 1001, height: 2001 };
  assert.deepEqual(mapPoint({x:.5,y:.5}, crop, size), {x:500,y:1000});
  assert.deepEqual(mapPoint({x:.1,y:.2}, crop, size), {x:0,y:0});
  assert.deepEqual(mapPoint({x:.9,y:.8}, crop, size), {x:1000,y:2000});
  assert.throws(() => mapPoint({x:.05,y:.5}, crop, size));
  assert.throws(() => mapPoint({x:NaN,y:.5}, crop, size));
  assert.throws(() => mapPoint({x:.5,y:.5}, null, size));
  assert.throws(() => cropRect({x:.5,y:0,width:.8,height:1}));
});

test('real CLI JSON suffixes and PNG trust boundary', () => {
  assert.deepEqual(parseJSON('[]\nNew version available'), []);
  assert.deepEqual(parseJSON('{"x":1}\nnotice'), {x:1});
  assert.equal(parseJSON('true'),true);
  assert.throws(() => parseJSON('[malformed]'));
  assert.deepEqual(pngSize(png), {width:1,height:1});
  assert.throws(() => pngSize(Buffer.from('not a png')));
  assert.equal(windowMatchesEmulator('/Applications/DevEco-Studio.app/Contents/tools/emulator/Emulator -start Pura X Max -bootmode snapshot','Pura X Max'),true);
  assert.equal(windowMatchesEmulator('/tools/emulator/Emulator -start Pura X Max -bootmode snapshot','Pura X'),false);
  assert.equal(windowMatchesEmulator('/tools/emulator/Emulator -start Mate X7 -bootmode snapshot','Pura X Max'),false);
  assert.equal(windowMatchesEmulator('/tools/emulator/Emulator -start Pura X Max - Demo -bootmode snapshot','Pura X Max'),false);
});

test('device workflow rejects ambiguous and unknown arguments before executing', async () => {
  let commands = 0;
  const fake = { gesture: DevEco.prototype.gesture, device: async () => 'fixture', ui: async () => { commands++; return {}; } };
  const w = new Workflows(fake);
  await assert.rejects(w.call('hos_tap', {id:'button',x:10,y:10}), /OR/);
  await assert.rejects(w.call('hos_tap', {x:10}), /integer/);
  await assert.rejects(w.call('hos_tap', {x:10,y:10,shell:'rm'}), /Unknown argument/);
  await assert.rejects(w.call('hos_swipe', {x1:0,y1:0,x2:5,y2:10,speed:10}), /Invalid/);
  assert.equal(commands, 0);
});

test('loopback preview enforces token/origin, applies device input and cleans its port/files', async () => {
  const operations = [];
  const adapter = {
    gesture: DevEco.prototype.gesture, device: async () => 'fixture',
    screenshot: async (_serial, path) => { await writeFile(path,png); return {buffer:png,width:1,height:1}; },
    ui: async (...args) => { operations.push(args); return {stdout:'done'}; }
  };
  const preview = new Preview(adapter);
  const {url} = await preview.start({source:'hdc',port:0,intervalMs:10000});
  const parsed = new URL(url), origin = parsed.origin, headers = {Authorization:`Bearer ${parsed.hash.slice(1)}`};
  const dir = preview.dir, port = preview.port;
  try {
    assert.equal((await fetch(`${origin}/api/frame`)).status,401);
    assert.equal((await fetch(`${origin}/api/status`,{headers:{...headers,Origin:'https://evil.example'}})).status,403);
    assert.equal((await fetch(`${origin}/api/frame`,{headers})).headers.get('content-type'),'image/png');
    const response = await fetch(`${origin}/api/action`,{method:'POST',headers,body:JSON.stringify({action:'tap',point:{x:.5,y:.5}})});
    assert.equal(response.status,200); assert.deepEqual(operations[0],['click',[0,0],'fixture']);
    assert.equal((await fetch(`${origin}/api/action`,{method:'POST',headers,body:JSON.stringify({action:'shell',command:'whoami'})})).status,400);
    preview.frameAt = Date.now()-20000;
    await assert.rejects(preview.control('tap',{point:{x:.5,y:.5}}),/stale/);
  } finally { await preview.stop(); }
  await assert.rejects(access(dir), /ENOENT/);
  const server = createServer();
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  await new Promise(resolve => server.close(resolve));
});

test('command runner preserves argument literals and terminates timed out process', async () => {
  const value = '$(touch bad); "quoted"';
  const result = await runCommand(process.execPath,['-e','process.stdout.write(process.argv[1])',value]);
  assert.equal(result.stdout,value);
  const input = '-Codex Harmony 测试 "O\'Reilly <&$>`"\nsecond line';
  const quoted = Buffer.from(inputScript(input),'base64').toString('utf8').replace(/^uitest uiInput text /,"printf '%s' ");
  assert.equal((await runCommand('/bin/sh',['-c',quoted])).stdout,input);
  assert.throws(()=>inputScript('bad\0text'));
  await assert.rejects(runCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:100}), /exceeded/);
  await assert.rejects(runCommand(process.execPath,['-e','console.log("error: start ability failed")']), /start ability failed/);
  const adapter = new DevEco({cli:process.execPath});
  const cancelled = assert.rejects(adapter.command(['-e','setInterval(()=>{},1000)']), /cancelled/);
  adapter.close(); await cancelCommands(); await cancelled;
});

test('concurrent preview lifecycle cannot overwrite sessions or close a new one', async () => {
  const adapter={device:async()=>{await new Promise(r=>setTimeout(r,20));return 'fixture';},screenshot:async()=>({buffer:png,width:1,height:1})};
  const preview=new Preview(adapter);
  const first=preview.start({source:'hdc',port:0,intervalMs:10000});
  const second=assert.rejects(preview.start({source:'hdc',port:0}),/already running/);
  await first; await second;
  const oldDirectory=preview.dir;
  const stopping=preview.stop();
  const next=preview.start({source:'hdc',port:0,intervalMs:10000});
  await stopping; await next;
  assert.equal(preview.active,true); assert.notEqual(preview.dir,oldDirectory);
  await assert.rejects(access(oldDirectory),/ENOENT/);
  await preview.stop();
});

test('SCK downgrades when real device pixels change but window frames stop progressing', async () => {
  let buffer=png;
  const adapter={device:async()=> 'fixture',screenshot:async()=>({buffer,width:1,height:1})};
  const preview=new Preview(adapter);
  await preview.start({source:'hdc',port:0,intervalMs:10000});
  try {
    preview.source='sck'; preview.frameSource='sck'; preview.nativeFrameAt=Date.now(); preview.nativeAtLastSnapshot=preview.nativeFrameAt; preview.nativeStateAt=Date.now();
    buffer=Buffer.concat([png,Buffer.from('different device frame')]);
    await preview.snapshot();
    assert.equal(preview.source,'hdc'); assert.equal(preview.status().stale,false);
    assert.match(preview.warning,/without a new window frame/);
    assert.deepEqual(preview.crop,{x:0,y:0,width:1,height:1});
  } finally { await preview.stop(); }
});

test('stdio MCP discovers tools, returns an image and owns preview cleanup', async () => {
  const dir = await mkdtemp(join(tmpdir(),'hos-test-')), script = join(dir,'devecocli');
  await writeFile(script, `#!/usr/bin/env node\nimport fs from 'node:fs';const args=process.argv.slice(2);if(args[0]==='device')console.log(JSON.stringify([{name:'Fixture',serial:'fixture'}]));else if(args[0]==='ui'&&args[1]==='screenshot'){fs.writeFileSync(args[args.indexOf('--path')+1],Buffer.from('${png.toString('base64')}','base64'));}else console.log('{}');`,{mode:0o755});
  const client = new Client({name:'integration',version:'0.1.0'});
  const transport = new StdioClientTransport({command:process.execPath,args:[join(ROOT,'src/mcp.mjs')],env:{...process.env,DEVECO_CLI_BIN:script},stderr:'pipe'});
  transport.stderr?.on('data',()=>{});
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length,TOOLS.length);
    assert.equal(new Set(tools.map(t=>t.name)).size,tools.length);
    const shot = await client.callTool({name:'hos_screenshot',arguments:{device:'fixture'}});
    assert.equal(shot.isError,undefined); assert.equal(shot.content[0].type,'image');
    assert.equal(shot.content[0].mimeType,'image/png');
    const invalid = await client.callTool({name:'hos_tap',arguments:{x:-1,y:0}});
    assert.equal(invalid.isError,true);
    const result = await client.callTool({name:'hos_preview_start',arguments:{source:'hdc',device:'fixture',port:0}});
    assert.equal(result.isError,undefined);
    const {url} = JSON.parse(result.content[0].text), parsed = new URL(url);
    assert.equal((await fetch(`${parsed.origin}/api/status`,{headers:{Authorization:`Bearer ${parsed.hash.slice(1)}`}})).status,200);
    const stop = await client.callTool({name:'hos_preview_stop',arguments:{}}); assert.equal(stop.isError,undefined);
    await assert.rejects(fetch(`${parsed.origin}/api/status`));
  } finally { await client.close(); await rm(dir,{recursive:true,force:true}); }
});
