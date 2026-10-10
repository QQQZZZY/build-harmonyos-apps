import { mkdtemp, rm, access, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DevEco, runCommand, cancelCommands, identifier, text, parseJSON, EMULATOR_CONTROLS } from './adapter.mjs';
import { Preview, captureWindows } from './preview.mjs';

const str = { type: 'string', minLength: 1 }, num = { type: 'integer', minimum: 0 }, device = { ...str, description: 'Connected device serial; required if multiple devices are connected' };
const point = { type: 'object', properties: { x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 } }, required: ['x', 'y'], additionalProperties: false };
const session = {type:'integer',minimum:1};
const project = { ...str, description: 'Absolute HarmonyOS project directory with build-profile.json5' };
const emulatorProperties = { target: str, command: {type:'string',enum:Object.keys(EMULATOR_CONTROLS)} };
for (const fields of Object.values(EMULATOR_CONTROLS)) for (const [key, rule] of Object.entries(fields)) {
  const {decimals, ...schema} = rule;
  emulatorProperties[key] = emulatorProperties[key] ? {anyOf:[emulatorProperties[key],schema]} : schema;
}
const definitions = [
  ['hos_doctor', 'Inspect local CLI, HDC, device, emulator and ScreenCaptureKit readiness without requesting permission', {}],
  ['hos_devices', 'List connected HarmonyOS devices', {}],
  ['hos_emulators', 'List local emulator instances', {}],
  ['hos_emulator_start', 'Start a named existing emulator; does not accept license agreements', { name: str }, ['name']],
  ['hos_emulator_stop', 'Stop a named existing emulator or emulator serial', { name: str }, ['name']],
  ['hos_emulator_control', 'Official emulator controls; pass exactly one option; fold states are CLI-wide and may not apply to the target model', emulatorProperties, ['target','command']],
  ['hos_events', 'Read bounded operation history for the current preview session', {}],
  ['hos_build', 'Build a HarmonyOS project using installed DevEco CLI', { project, product: str, module: str, mode: { enum: ['debug','release'], type: 'string' } }, ['project']],
  ['hos_run', 'Build, install and launch a project with DevEco CLI; never uninstalls app data', { project, device, module: str, product: str, ability: str, skipBuild: { type: 'boolean' }, apply:{type:'boolean',description:'Incrementally compile and deploy changed files, then restart'}, hotReloadApply:{type:'boolean',description:'Apply changes to an already running official hot-reload watch session; does not start a daemon'}, changeFile:{...str,description:'Existing changed-file list basename under project .hvigor/'} }, ['project']],
  ['hos_install', 'Install an existing local HAP using official HDC', { hap: str, device }, ['hap']],
  ['hos_launch', 'Launch an installed ability using official HDC aa start', { bundle: str, ability: str, device }, ['bundle','ability']],
  ['hos_logs', 'Fetch bounded application/crash hilog; no persistent log process', { device, bundle: str, keyword: str, level: { type: 'string', enum: ['D','I','W','E','F'] }, tail: { ...num, minimum: 1, maximum: 2000 }, crash: { type: 'boolean' } }],
  ['hos_screenshot', 'Return a real device PNG image; optional absolute outputPath must not already exist', { device, outputPath: str }],
  ['hos_ui_tree', 'Read the visible ArkUI accessibility tree', { device, depth: { ...num, maximum: 100 }, allWindows: { type: 'boolean' } }],
  ['hos_tap', 'Tap device pixels, or tap the center of a visible UI node by id (exclusive)', { device, x: num, y: num, id: str }],
  ['hos_doubletap', 'Double-tap device pixels or a visible node id (exclusive)', { device, x:num, y:num, id:str }],
  ['hos_longpress', 'Long-press device pixels or a visible node id (exclusive)', { device, x:num, y:num, id:str }],
  ['hos_drag', 'Drag in device pixels using DevEco CLI', { device, x1:num, y1:num, x2:num, y2:num, speed:{...num,minimum:200,maximum:40000} }, ['x1','y1','x2','y2']],
  ['hos_swipe', 'Swipe in device pixels using DevEco CLI', { device, x1: num, y1: num, x2: num, y2: num, speed: { ...num, minimum: 200, maximum: 40000 } }, ['x1','y1','x2','y2']],
  ['hos_text', 'Enter text into the focused field or a visible UI node', { device, text: { ...str, maxLength: 2000 }, id: str }, ['text']],
  ['hos_key', 'Send the official HDC Back or Home system key; Back can dismiss the keyboard', { device, key: { type: 'string', enum: ['Back','Home'] } }, ['key']],
  ['hos_capture_windows', 'List DevEco emulator windows without requesting screen permission or exposing other app titles', {}],
  ['hos_preview_start', 'Start a loopback browser preview with SCK preferred and HDC fallback; returns authenticated URL', { device, source: { type: 'string', enum: ['auto','sck','hdc'] }, windowId: { ...num, minimum: 1 }, port: { ...num, maximum: 65535 }, fps: { ...num, minimum: 1, maximum: 30 }, intervalMs: { ...num, minimum: 250, maximum: 10000 } }],
  ['hos_preview_status', 'Inspect preview source, calibration and frame freshness', {}],
  ['hos_preview_calibrate', 'Calibrate touchscreen rectangle in normalized full-window preview coordinates', { session, rect: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } }, required: ['x','y','width','height'], additionalProperties: false } }, ['rect']],
  ['hos_preview_input', 'Operate normalized preview coordinates or visible node id; type text or send Home/Back', { action: { type: 'string', enum: ['tap','doubletap','longpress','swipe','drag','text','key'] }, point, start: point, end: point, id:str, session, key:{type:'string',enum:['Home','Back']}, speed:{...num,minimum:200,maximum:40000}, text: { ...str, maxLength: 2000 } }, ['action']],
  ['hos_preview_select', 'Switch preview to another connected device', {device,session}, ['device']],
  ['hos_preview_retry', 'Retry preview capture with an optional source or window', {source:{type:'string',enum:['auto','sck','hdc']},windowId:{...num,minimum:1},session}],
  ['hos_preview_stop', 'Stop only this MCP process’s preview and capture helper, freeing its port and temporary files', {}]
];
export const TOOLS = definitions.map(([name, description, properties, required = []]) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations: { readOnlyHint: /doctor|devices|emulators|logs|screenshot|tree|windows|status|events/.test(name), destructiveHint: false, openWorldHint: false } }));

function validate(value, schema, path = 'arguments') {
  if (schema.anyOf) {
    for (const option of schema.anyOf) { try { validate(value,option,path); return; } catch {} }
    throw new Error(`Invalid ${path}`);
  }
  if (schema.type === 'object') {
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`${path} must be an object`);
    for (const key of schema.required || []) if (!(key in value)) throw new Error(`${path}.${key} is required`);
    for (const [key, child] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) throw new Error(`Unknown argument: ${path}.${key}`);
      validate(child, schema.properties[key], `${path}.${key}`);
    }
  } else {
    if (schema.type === 'integer' ? !Number.isInteger(value) : typeof value !== schema.type) throw new Error(`Invalid ${path}`);
    if (schema.enum && !schema.enum.includes(value)) throw new Error(`Invalid ${path}`);
    if (schema.type === 'string' && (value.length < (schema.minLength || 0) || value.length > (schema.maxLength || 4096) || value.includes('\0'))) throw new Error(`Invalid ${path}`);
    if (typeof value === 'number' && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) throw new Error(`Invalid ${path}`);
  }
}

export class Workflows {
  constructor(adapter = new DevEco()) { this.adapter = adapter; this.preview = new Preview(adapter); }
  async call(name, args = {}) {
    if (/^hos_(?:build|run|install|launch|tap|doubletap|longpress|swipe|drag|text|key|emulator_start)$/.test(name)) return this.preview.record(name,()=>this.perform(name,args),args.device ?? args.name);
    return this.perform(name,args);
  }
  async perform(name, args = {}) {
    if (this.closed) throw new Error('MCP is shutting down');
    const tool = TOOLS.find(t => t.name === name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    validate(args, tool.inputSchema);
    const a = this.adapter;
    if (name === 'hos_doctor') return a.doctor();
    if (name === 'hos_devices') return a.devices();
    if (name === 'hos_emulators') return a.emulators();
    if (name === 'hos_emulator_start') return a.emulatorStart(args.name);
    if (name === 'hos_emulator_stop') {
      if (this.preview.active && this.preview.device) {
        const e=(await a.emulators()).find(e=>e.serial===this.preview.device);
        if (args.name===this.preview.device || args.name===e?.name) return this.preview.control('emulator_stop',{name:args.name});
      }
      return this.preview.record(name,()=>a.emulatorStop(args.name),args.name);
    }
    if (name === 'hos_emulator_control') {
      const {target,...control}=args;
      if (this.preview.active && this.preview.device) {
        const e=(await a.emulators()).find(e=>e.serial===this.preview.device);
        if (target===this.preview.device || target===e?.name) return this.preview.control('emulator_control',control);
      }
      return this.preview.record(name,()=>a.emulatorControl(target,control),target);
    }
    if (name === 'hos_events') return {session:this.preview.session ?? null,events:this.preview.events ?? []};
    if (name === 'hos_capture_windows') return captureWindows();
    if (name === 'hos_preview_start') return this.preview.start(args);
    if (name === 'hos_preview_select') return this.preview.select(args.device,args.session);
    if (name === 'hos_preview_retry') {const {session,...options}=args;return this.preview.retry(options,session);}
    if (name === 'hos_preview_status') return this.preview.status();
    if (name === 'hos_preview_stop') return this.preview.stop();
    if (name === 'hos_preview_calibrate') return this.preview.control('calibrate',args);
    if (name === 'hos_preview_input') {const {action,...input}=args;return this.preview.control(action,input);}
    if (name === 'hos_build' || name === 'hos_run') {
      if (name === 'hos_run') {
        if (args.apply && args.hotReloadApply) throw new Error('apply and hotReloadApply are mutually exclusive');
        if ((args.apply || args.hotReloadApply) && args.skipBuild) throw new Error('Incremental deployment cannot use skipBuild');
        if (Boolean(args.apply || args.hotReloadApply) !== (args.changeFile !== undefined)) throw new Error('Incremental deployment requires changeFile, and changeFile requires apply or hotReloadApply');
        if (args.changeFile !== undefined) {
          const file=text(args.changeFile,'changeFile');
          if (file === '.' || file === '..' || file.startsWith('-') || /[\\/]/.test(file)) throw new Error('changeFile must be a basename, without a path or leading dash');
        }
      }
      const cwd = await a.project(args.project);
      if (args.changeFile !== undefined) await access(join(cwd,'.hvigor',args.changeFile));
      const cmd = name === 'hos_build' ? ['build'] : ['run', '--device', await a.device(args.device)];
      if (args.product) cmd.push('--product', identifier(args.product, 'product'));
      if (args.module) cmd.push(name === 'hos_build' ? '--modules' : '--module', identifier(args.module, 'module'));
      if (args.mode) cmd.push('--build-mode', args.mode);
      if (args.ability) cmd.push('--ability', identifier(args.ability, 'ability'));
      if (args.skipBuild) cmd.push('--skip-build');
      if (args.apply || args.hotReloadApply) cmd.push(args.apply ? '--apply' : '--hotreload-apply',args.changeFile);
      return a.command(cmd, { cwd, timeout: 10 * 60 * 1000, limit: 8 * 1024 * 1024 });
    }
    const serial = await a.device(args.device);
    if (name === 'hos_install') {
      const info=await a.hapInfo(args.hap);
      const result=await a.install(args.hap,serial);
      const application=info ? {...info,installedAt:Date.now()} : null;
      if (application) this.preview.applications.set(serial,application);
      else this.preview.applications.delete(serial);
      return {...result,application};
    }
    if (name === 'hos_launch') {
      const result=await a.launch(serial,args.bundle,args.ability);
      const previous=this.preview.applications.get(serial);
      const application={version:null,...(previous?.bundle === args.bundle ? previous : {}),bundle:args.bundle,ability:args.ability,launchedAt:Date.now()};
      this.preview.applications.set(serial,application);
      return {...result,application};
    }
    if (name === 'hos_logs') { const {device,...filters}=args; return a.logs(serial,filters); }
    if (name === 'hos_screenshot') {
      const dir = await mkdtemp(join(tmpdir(), 'hos-shot-'));
      try {
        const path = args.outputPath ? resolve(text(args.outputPath, 'outputPath', 4096)) : join(dir, 'screen.png');
        if (args.outputPath) {
          try { await access(path); throw new Error('outputPath already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        const { buffer, width, height } = await a.screenshot(serial, path);
        return { image: buffer, mime: 'image/png', width, height, ...(args.outputPath ? { path } : {}) };
      } finally { await rm(dir, { recursive: true, force: true }); }
    }
    if (name === 'hos_ui_tree') {
      const cmd = ['--format', 'json', '--mode', 'full'];
      if (args.depth !== undefined) cmd.push('--depth', String(args.depth));
      if (args.allWindows) cmd.push('--all-windows');
      return parseJSON((await a.ui('layout', cmd, serial)).stdout);
    }
    const gesture = {hos_tap:'tap',hos_doubletap:'doubletap',hos_longpress:'longpress',hos_swipe:'swipe',hos_drag:'drag'}[name];
    if (gesture) { const {device,...input}=args; return a.gesture(gesture,input,serial); }
    if (name === 'hos_text') return a.ui('text', [args.text, ...(args.id ? ['--id', text(args.id, 'id')] : [])], serial);
    if (name === 'hos_key') return a.key(serial,args.key);
    throw new Error('Tool not implemented');
  }
  async close() { this.closed = true; this.adapter.close?.(); await cancelCommands(); return this.preview.stop(); }
}
