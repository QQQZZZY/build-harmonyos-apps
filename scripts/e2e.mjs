#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ROOT } from '../src/adapter.mjs';

const {values} = parseArgs({ options: { project:{type:'string'}, device:{type:'string'}, output:{type:'string'}, source:{type:'string',default:'hdc'}, 'window-id':{type:'string'}, crop:{type:'string'} } });
if (!values.project || !values.device) throw new Error('Usage: node scripts/e2e.mjs --project ABS_FIXTURE_PROJECT --device SERIAL [--output DIR] [--source hdc|sck --window-id ID --crop x,y,width,height]');
const output = resolve(values.output || 'test-results');
await mkdir(output,{recursive:true});
const client = new Client({name:'harmonyos-e2e',version:'0.1.0'});
const transport = new StdioClientTransport({command:process.execPath,args:[join(ROOT,'scripts/start-mcp.mjs')],stderr:'pipe'});
transport.stderr.on('data',chunk=>process.stderr.write(chunk));
const evidence = {date:new Date().toISOString(),device:values.device,project:resolve(values.project),checks:[]};
async function call(name,args = {}) {
  process.stderr.write(`${name}\n`);
  const result = await client.callTool({name,arguments:args},undefined,{timeout:660000});
  assert.ok(!result.isError, `${name}: ${result.content?.[0]?.text}`);
  if (result.content[0]?.type === 'image') return result;
  return JSON.parse(result.content[0].text);
}
function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree==='object' ? [tree,...(tree.children || []).flatMap(nodes)] : []; }
function node(tree,id) { const found=nodes(tree).find(n=>n.id===id); assert.ok(found,`Missing fixture node ${id}`); return found; }
function center(n) { const [l,t,r,b]=n.bounds; return {x:Math.round((l+r)/2),y:Math.round((t+b)/2)}; }
const args={device:values.device};
async function waitTree(predicate, label) {
  let tree;
  const until=Date.now()+8000;
  while(Date.now()<until) {
    tree=await call('hos_ui_tree',args);
    if(predicate(tree)) return tree;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  await writeFile(join(output,'failed-ui-tree.json'),JSON.stringify(tree,null,2));
  throw new Error(`UI did not reach expected state: ${label}. Check device focus, keyboard setup or system dialog.`);
}
let success=false;
try {
  await client.connect(transport);
  evidence.tools=(await client.listTools()).tools.map(t=>t.name);
  evidence.doctor=await call('hos_doctor');
  await call('hos_build',{project:resolve(values.project),module:'entry'}); evidence.checks.push('build');
  await call('hos_run',{project:resolve(values.project),module:'entry',...args,skipBuild:true}); evidence.checks.push('install/launch');
  let tree=await call('hos_ui_tree',args);
  const count=Number(node(tree,'fixture-count').text.split(':')[1]);
  assert.ok(Number.isInteger(count),'Fixture must show a numeric count');
  await call('hos_tap',{...args,id:'fixture-increment'});
  tree=await waitTree(t=>nodes(t).some(n=>n.id==='fixture-count'&&n.text===`Count: ${count+1}`),'count after node tap'); evidence.checks.push('tap/node-id');
  const preview=await call('hos_preview_start',{...args,port:0,source:values.source,...(values['window-id']?{windowId:Number(values['window-id'])}:{})});
  const previewURL=new URL(preview.url),headers={Authorization:`Bearer ${previewURL.hash.slice(1)}`};
  assert.equal((await fetch(`${previewURL.origin}/api/frame`,{headers})).status,200);
  evidence.checks.push('authenticated browser frame');
  let crop={x:0,y:0,width:1,height:1};
  if(values.source==='sck') {
    assert.ok(values.crop,'SCK input acceptance requires an explicitly calibrated --crop x,y,width,height');
    const [x,y,width,height]=values.crop.split(',').map(Number); crop={x,y,width,height};
    for(let i=0;i<20;i++) { const s=await call('hos_preview_status'); if(!s.stale)break; await new Promise(r=>setTimeout(r,100)); }
    await call('hos_preview_calibrate',{rect:crop});
  }
  const button=center(node(tree,'fixture-increment')),size=preview.deviceSize;
  const point={x:crop.x+button.x/(size.width-1)*crop.width,y:crop.y+button.y/(size.height-1)*crop.height};
  const response=await fetch(`${previewURL.origin}/api/action`,{method:'POST',headers,body:JSON.stringify({action:'tap',point})});
  assert.equal(response.status,200,await response.text());
  tree=await waitTree(t=>nodes(t).some(n=>n.id==='fixture-count'&&n.text===`Count: ${count+2}`),'count after browser tap'); evidence.checks.push('browser mapped tap');
  const scroll=node(tree,'fixture-scroll'),[l,t,r,b]=scroll.bounds;
  const rowsBefore=nodes(tree).filter(n=>/^Row \d+$/.test(n.text||'')).map(n=>n.text);
  const scrollUp = Number((rowsBefore[0] || 'Row 1').split(' ')[1]) <= 1;
  await call('hos_swipe',{...args,x1:Math.round((l+r)/2),y1:scrollUp?b-30:t+30,x2:Math.round((l+r)/2),y2:scrollUp?t+30:b-30,speed:1500});
  tree=await call('hos_ui_tree',args);
  const rowsAfter=nodes(tree).filter(n=>/^Row \d+$/.test(n.text||'')).map(n=>n.text);
  assert.notDeepEqual(rowsAfter,rowsBefore,'Swipe must change visible rows'); evidence.checks.push('swipe changes visible rows');
  const enteredText='-Codex Harmony 测试 "<&$>"';
  await call('hos_text',{...args,id:'fixture-input',text:enteredText});
  await call('hos_key',{...args,key:'Back'});
  tree=await waitTree(t=>nodes(t).some(n=>n.id==='fixture-echo'&&n.text?.includes(enteredText)),'input echo after keyboard dismiss'); evidence.checks.push('text/state echo (Unicode/quotes/shell characters/leading dash)');
  const screenshot=await call('hos_screenshot',args);
  await writeFile(join(output,'device.png'),Buffer.from(screenshot.content[0].data,'base64'));
  await writeFile(join(output,'ui-tree.json'),JSON.stringify(tree,null,2));
  evidence.logs=await call('hos_logs',{...args,bundle:'com.example.servehosfixture',tail:100}); evidence.checks.push('device screenshot/UI tree/logs');
  evidence.preview=await call('hos_preview_status');
  await call('hos_preview_stop'); evidence.checks.push('preview stop');
  await assert.rejects(fetch(`${previewURL.origin}/api/status`));
  success=true;
} catch(error) { evidence.error=error.message; throw error; }
finally {
  evidence.success=success;
  await client.close();
  await writeFile(join(output,'e2e.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({success,output,checks:evidence.checks,error:evidence.error},null,2));
}
