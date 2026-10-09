import { mkdtemp, rm, access, realpath } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { DevEco, runCommand, cancelCommands, identifier, integer, text, parseJSON } from './adapter.mjs';
import { Preview, captureWindows } from './preview.mjs';

const str = { type: 'string', minLength: 1 }, num = { type: 'integer', minimum: 0 }, device = { ...str, description: 'Connected device serial; required if multiple devices are connected' };
const point = { type: 'object', properties: { x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 } }, required: ['x', 'y'], additionalProperties: false };
const project = { ...str, description: 'Absolute HarmonyOS project directory with build-profile.json5' };
const definitions = [
  ['hos_doctor', 'Inspect local CLI, HDC, device, emulator and ScreenCaptureKit readiness without requesting permission', {}],
  ['hos_devices', 'List connected HarmonyOS devices', {}],
  ['hos_emulators', 'List local emulator instances', {}],
  ['hos_emulator_start', 'Start a named existing emulator; does not accept license agreements', { name: str }, ['name']],
  ['hos_build', 'Build a HarmonyOS project using installed DevEco CLI', { project, product: str, module: str, mode: { enum: ['debug','release'], type: 'string' } }, ['project']],
  ['hos_run', 'Build, install and launch a project with DevEco CLI; never uninstalls app data', { project, device, module: str, product: str, ability: str, skipBuild: { type: 'boolean' } }, ['project']],
  ['hos_install', 'Install an existing local HAP using official HDC', { hap: str, device }, ['hap']],
  ['hos_launch', 'Launch an installed ability using official HDC aa start', { bundle: str, ability: str, device }, ['bundle','ability']],
  ['hos_logs', 'Fetch bounded application/crash hilog; no persistent log process', { device, bundle: str, keyword: str, level: { type: 'string', enum: ['D','I','W','E','F'] }, tail: { ...num, minimum: 1, maximum: 2000 }, crash: { type: 'boolean' } }],
  ['hos_screenshot', 'Return a real device PNG image; optional absolute outputPath must not already exist', { device, outputPath: str }],
  ['hos_ui_tree', 'Read the visible ArkUI accessibility tree', { device, depth: { ...num, maximum: 100 }, allWindows: { type: 'boolean' } }],
  ['hos_tap', 'Tap device pixels, or tap the center of a visible UI node by id (exclusive)', { device, x: num, y: num, id: str }],
  ['hos_swipe', 'Swipe in device pixels using DevEco CLI', { device, x1: num, y1: num, x2: num, y2: num, speed: { ...num, minimum: 200, maximum: 40000 } }, ['x1','y1','x2','y2']],
  ['hos_text', 'Enter text into the focused field or a visible UI node', { device, text: { ...str, maxLength: 2000 }, id: str }, ['text']],
  ['hos_key', 'Send the official HDC Back or Home system key; Back can dismiss the keyboard', { device, key: { type: 'string', enum: ['Back','Home'] } }, ['key']],
  ['hos_capture_windows', 'List DevEco emulator windows without requesting screen permission or exposing other app titles', {}],
  ['hos_preview_start', 'Start a loopback browser preview with SCK preferred and HDC fallback; returns authenticated URL', { device, source: { type: 'string', enum: ['auto','sck','hdc'] }, windowId: { ...num, minimum: 1 }, port: { ...num, maximum: 65535 }, fps: { ...num, minimum: 1, maximum: 30 }, intervalMs: { ...num, minimum: 250, maximum: 10000 } }],
  ['hos_preview_status', 'Inspect preview source, calibration and frame freshness', {}],
  ['hos_preview_calibrate', 'Calibrate touchscreen rectangle in normalized full-window preview coordinates', { rect: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } }, required: ['x','y','width','height'], additionalProperties: false } }, ['rect']],
  ['hos_preview_input', 'Tap/swipe normalized preview coordinates after calibration, or type into focused field', { action: { type: 'string', enum: ['tap','swipe','text'] }, point, start: point, end: point, text: { ...str, maxLength: 2000 } }, ['action']],
  ['hos_preview_stop', 'Stop only this MCP process’s preview and capture helper, freeing its port and temporary files', {}]
];
export const TOOLS = definitions.map(([name, description, properties, required = []]) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations: { readOnlyHint: /doctor|devices|emulators|logs|screenshot|tree|windows|status/.test(name), destructiveHint: false, openWorldHint: false } }));

function validate(value, schema, path = 'arguments') {
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
    if (this.closed) throw new Error('MCP is shutting down');
    const tool = TOOLS.find(t => t.name === name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    validate(args, tool.inputSchema);
    const a = this.adapter;
    if (name === 'hos_doctor') return a.doctor();
    if (name === 'hos_devices') return a.devices();
    if (name === 'hos_emulators') return a.emulators();
    if (name === 'hos_emulator_start') return a.command(['emulator', 'start', text(args.name, 'name')], { timeout: 120000 });
    if (name === 'hos_capture_windows') return captureWindows();
    if (name === 'hos_preview_start') return this.preview.start(args);
    if (name === 'hos_preview_status') return this.preview.status();
    if (name === 'hos_preview_stop') return this.preview.stop();
    if (name === 'hos_preview_calibrate') return this.preview.calibrate(args.rect);
    if (name === 'hos_preview_input') return this.preview.control(args.action, args);
    if (name === 'hos_build' || name === 'hos_run') {
      const cwd = await a.project(args.project);
      const cmd = name === 'hos_build' ? ['build'] : ['run', '--device', await a.device(args.device)];
      if (args.product) cmd.push('--product', identifier(args.product, 'product'));
      if (args.module) cmd.push(name === 'hos_build' ? '--modules' : '--module', identifier(args.module, 'module'));
      if (args.mode) cmd.push('--build-mode', args.mode);
      if (args.ability) cmd.push('--ability', identifier(args.ability, 'ability'));
      if (args.skipBuild) cmd.push('--skip-build');
      return a.command(cmd, { cwd, timeout: 10 * 60 * 1000, limit: 8 * 1024 * 1024 });
    }
    const serial = await a.device(args.device);
    if (name === 'hos_install') {
      const hap = await realpath(text(args.hap, 'hap', 4096));
      if (extname(hap).toLowerCase() !== '.hap') throw new Error('Only .hap files can be installed');
      return runCommand(await a.hdc(), ['-t', serial, 'install', hap], { timeout: 120000, signal: a.abort?.signal });
    }
    if (name === 'hos_launch') return runCommand(await a.hdc(), ['-t', serial, 'shell', 'aa', 'start', '-b', identifier(args.bundle, 'bundle'), '-a', identifier(args.ability, 'ability')], { signal: a.abort?.signal });
    if (name === 'hos_logs') {
      const cmd = ['log', '--device', serial, '--tail', String(args.tail ?? 200)];
      for (const [key, flag] of [['bundle','--bundle-name'], ['keyword','--keyword'], ['level','--level']]) if (args[key]) cmd.push(flag, text(args[key], key));
      if (args.crash) cmd.push('--crash');
      return a.command(cmd);
    }
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
    if (name === 'hos_tap') {
      const node = args.id !== undefined;
      if (node && (args.x !== undefined || args.y !== undefined)) throw new Error('Provide node id OR x/y, not both');
      const cmd = node ? ['--id', text(args.id, 'id')] : [integer(args.x, 'x'), integer(args.y, 'y')];
      return a.ui('click', cmd, serial);
    }
    if (name === 'hos_swipe') return a.ui('swipe', [args.x1, args.y1, args.x2, args.y2, ...(args.speed ? ['--speed', args.speed] : [])], serial);
    if (name === 'hos_text') return a.ui('text', [args.text, ...(args.id ? ['--id', text(args.id, 'id')] : [])], serial);
    if (name === 'hos_key') return runCommand(await a.hdc(), ['-t', serial, 'shell', 'uitest', 'uiInput', 'keyEvent', args.key], { signal: a.abort?.signal });
    throw new Error('Tool not implemented');
  }
  async close() { this.closed = true; this.adapter.close?.(); await cancelCommands(); return this.preview.stop(); }
}
