import { spawn } from 'node:child_process';
import { access, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const NATIVE = join(ROOT, 'native/bin/hos-capture');

export async function executable(path) {
  try { await access(path, constants.X_OK); return true; } catch { return false; }
}

const activeCommands = new Map();
export async function cancelCommands() {
  const pending = [...activeCommands.values()];
  for (const entry of pending) entry.stop('Command cancelled during shutdown');
  await Promise.all(pending.map(entry => entry.done));
}
export function runCommand(command, args, { cwd = ROOT, timeout = 30000, limit = 4 * 1024 * 1024, signal } = {}) {
  return new Promise((resolveResult, reject) => {
    if (signal?.aborted) { reject(new Error('Command cancelled during shutdown')); return; }
    const child = spawn(command, args, { cwd, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0, failure;
    const stop = message => {
      failure ||= new Error(message);
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 1000).unref();
    };
    const timer = setTimeout(() => stop(`${command} exceeded ${timeout}ms`), timeout);
    const abort = () => stop('Command cancelled during shutdown');
    signal?.addEventListener('abort', abort, { once: true });
    let finished;
    const done = new Promise(resolve => { finished = resolve; });
    activeCommands.set(child, { stop, done });
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); activeCommands.delete(child); finished(); };
    for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
      stream.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > limit) { stop(`${command} output exceeded ${limit} bytes`); return; }
        if (name === 'stdout') stdout += chunk; else stderr += chunk;
      });
    }
    child.on('error', error => { finish(); reject(error); });
    child.on('close', code => {
      finish();
      if (failure) reject(failure);
      else if (code !== 0 || /^(?:\[Fail\]|error:)/im.test(stdout)) reject(new Error((stderr || stdout || `${command} exited ${code}`).trim()));
      else resolveResult({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

export function text(value, name, max = 256) {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000\r\n]/.test(value)) throw new Error(`${name} must be a nonempty string (max ${max}, no control characters)`);
  return value;
}
export function integer(value, name, min = 0, max = 100000) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer in ${min}..${max}`);
  return value;
}
export function identifier(value, name) {
  const v = text(value, name);
  if (!/^[a-zA-Z0-9_.:@-]+$/.test(v) || v.startsWith('-')) throw new Error(`Invalid ${name}`);
  return v;
}
export function parseJSON(output) {
  try { return JSON.parse(output.trim()); } catch {}
  // CLI status messages may precede JSON; never silently accept malformed results.
  const start = output.search(/[\[{]/);
  if (start < 0) throw new Error('DevEco CLI did not return JSON');
  const end = Math.max(output.lastIndexOf(']'), output.lastIndexOf('}'));
  try { return JSON.parse(output.slice(start, end + 1)); }
  catch { throw new Error('Invalid JSON returned by DevEco CLI'); }
}
export function pngSize(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Screenshot is not a PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function inputScript(value) {
  if (typeof value !== 'string' || !value.length || value.length > 2000 || value.includes('\0')) throw new Error('Text must contain 1..2000 characters');
  const quoted = "'" + value.replaceAll("'", "'\"'\"'") + "'";
  return Buffer.from(`uitest uiInput text ${quoted}`, 'utf8').toString('base64');
}

const choice = values => ({ type: 'string', enum: values });
const range = (min, max, decimals) => ({ type: 'number', minimum: min, maximum: max, decimals });
export const EMULATOR_CONTROLS = {
  rotate: { direction: choice(['left','right']) },
  fold: { state: choice(['open','half-open','close','vertical-open','single','double','triple','left-folded-right-half-folded','left-half-folded-right-expanded','left-expanded-right-folded','left-half-folded-right-folded','left-expanded-right-half-folded','left-half-folded-right-half-folded']) },
  power: {},
  volume: { direction: choice(['up','down']) },
  battery: { level: { type:'integer', minimum:0, maximum:100 }, status: choice(['charging','discharging']) },
  geolocation: { longitude: range(-180,180,8), latitude: range(-90,90,8), altitude: range(-10000,10000,2), direction: range(0,359.99,2) },
  sensor: { lightIntensity: range(0,100000,1), humidity: range(0,100,1), temperature: range(-273.1,100,1), steps: { type:'integer', minimum:0, maximum:10000 }, heartrate: { type:'integer', minimum:0, maximum:255 } },
  scene: { type: choice(['outdoorRunning','outdoorCycling','drivingNavigation']) }
};
function knownArgs(args, allowed) {
  if (!args || Array.isArray(args) || typeof args !== 'object') throw new Error('Arguments must be an object');
  for (const key of Object.keys(args)) if (!allowed.includes(key)) throw new Error(`Unknown argument: ${key}`);
}
function emulatorTarget(value) {
  const target = text(value, 'emulator target');
  if (!/^[a-zA-Z0-9_.:@ -]+$/.test(target) || target.startsWith('-') || target.trim() !== target) throw new Error('Invalid emulator target');
  return target;
}

export function emulatorArguments(target, args) {
    emulatorTarget(target);
    if (!args || !Object.hasOwn(EMULATOR_CONTROLS,args.command)) throw new Error('Unsupported emulator command');
    const schema = EMULATOR_CONTROLS[args.command];
    knownArgs(args,['command',...Object.keys(schema)]);
    const fields = Object.keys(args).filter(k=>k !== 'command');
    if (fields.length !== (args.command === 'power' ? 0 : 1)) throw new Error('Specify exactly one operation option');
    const cmd = ['emulator',args.command];
    for (const key of fields) {
      const value=args[key], rule=schema[key];
      if (rule.enum) { if (!rule.enum.includes(value)) throw new Error(`Invalid ${key}`); }
      else if (rule.type === 'integer') integer(value,key,rule.minimum,rule.maximum);
      else {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < rule.minimum || value > rule.maximum) throw new Error(`Invalid ${key}`);
        const scaled=value * 10 ** rule.decimals;
        if (Math.abs(scaled-Math.round(scaled)) > 1e-6) throw new Error(`Invalid ${key} precision`);
      }
      if (['rotate','fold','volume','scene'].includes(args.command)) cmd.push(value);
      else cmd.push(key === 'lightIntensity' ? '--light-intensity' : `--${key}`,String(value));
    }
    return [...cmd,'--target',target];
}

export class DevEco {
  constructor({ cli = process.env.DEVECO_CLI_BIN || 'devecocli', hdc = process.env.HDC_BIN } = {}) { this.cli = cli; this.hdcOverride = hdc; this.abort = new AbortController(); }
  command(args, options) { return runCommand(this.cli, args, { ...options, signal: this.abort.signal }); }
  close() { this.abort.abort(); }
  async devices() { return parseJSON((await this.command(['device', 'list', '--format', 'json'])).stdout); }
  async emulators() {
    const [listed, devices] = await Promise.all([this.command(['emulator','list','--format','json']).then(r=>parseJSON(r.stdout)),this.devices()]);
    return listed.map(emulator => {
      // CLI 1.3.0 pairs serials by list order; connected device names identify the actual instance.
      const matches = devices.filter(device=>device.kind==='emulator' && device.name===emulator.name);
      return {...emulator,serial:matches.length===1 ? matches[0].serial : null};
    });
  }
  async device(value) {
    const devices = await this.devices();
    if (!Array.isArray(devices)) throw new Error('Unexpected device list');
    if (!value && devices.length === 1) return devices[0].serial;
    if (!value) throw new Error(devices.length ? 'Multiple devices: specify device serial' : 'No connected devices');
    text(value, 'device');
    const selected = devices.find(d => d.serial === value || d.name === value);
    if (!selected?.serial) throw new Error(`Device not connected: ${value}`);
    return selected.serial;
  }
  async hdc() {
    if (this.hdcOverride) {
      const path = resolve(this.hdcOverride);
      if (await executable(path)) return path;
      throw new Error(`HDC_BIN is not executable: ${path}`);
    }
    const roots = [process.env.DEVECO_CLI_STUDIO_PATH, process.env.DEVECO_HOME, process.env.DEVECO_PATH, '/Applications/DevEco-Studio.app/Contents'].filter(Boolean);
    const candidates = roots.flatMap(r => [join(r, 'sdk/default/openharmony/toolchains/hdc'), join(r, 'Contents/sdk/default/openharmony/toolchains/hdc')]);
    for (const base of (process.env.PATH || '').split(':')) candidates.push(join(base, 'hdc'));
    for (const path of candidates) if (await executable(path)) return realpath(path);
    throw new Error('HDC not found. Set HDC_BIN to its executable in the DevEco SDK.');
  }
  async project(value) {
    const path = await realpath(text(value, 'project', 4096));
    await access(join(path, 'build-profile.json5'));
    return path;
  }
  async screenshot(serial, path) {
    await this.command(['ui', 'screenshot', '--device', serial, '--path', path], { timeout: 20000 });
    const buffer = await readFile(path);
    return { buffer, ...pngSize(buffer) };
  }
  async ui(action, args, serial) {
    if (action === 'text') {
      const [value, ...options] = args;
      if (options.length) {
        if (options[0] !== '--id' || options.length !== 2) throw new Error('Text target must be a node id');
        await this.ui('click', options, serial);
      }
      // HDC strips host quotes; encode the quoted script so device sh parses text exactly once.
      return runCommand(await this.hdc(), ['-t', serial, 'shell', 'printf', '%s', inputScript(value), '|', 'base64', '-d', '|', 'sh'], { signal: this.abort.signal });
    }
    return this.command(['ui', action, ...args.map(String), '--device', serial]);
  }
  async install(hap, serial) {
    identifier(serial,'device serial');
    const path = await realpath(text(hap,'hap',4096));
    if (extname(path).toLowerCase() !== '.hap') throw new Error('Only .hap files can be installed');
    return runCommand(await this.hdc(),['-t',serial,'install',path],{timeout:120000,signal:this.abort.signal});
  }
  async launch(serial, bundle, ability) {
    identifier(serial,'device serial');
    identifier(bundle,'bundle'); identifier(ability,'ability');
    return runCommand(await this.hdc(),['-t',serial,'shell','aa','start','-b',bundle,'-a',ability],{signal:this.abort.signal});
  }
  async hapInfo(hap) {
    const path = await realpath(text(hap,'hap',4096));
    if (extname(path).toLowerCase() !== '.hap') throw new Error('Only .hap files can be inspected');
    let output;
    try { output = (await runCommand('/usr/bin/unzip',['-p',path,'module.json'],{limit:1024*1024,signal:this.abort.signal})).stdout; }
    catch (error) { if (/filename not matched:\s*module\.json/.test(error.message)) return null; throw error; }
    const metadata=JSON.parse(output);
    return {bundle:identifier(metadata?.app?.bundleName,'bundle'),ability:metadata?.module?.mainElement ? identifier(metadata.module.mainElement,'ability') : null,version:metadata?.app?.versionName ? text(metadata.app.versionName,'version') : null};
  }
  async gesture(action, args, serial) {
    identifier(serial, 'device serial');
    const mapped = {tap:'click', doubletap:'doubleclick', longpress:'longclick', swipe:'swipe', drag:'drag'}[action];
    if (!mapped) throw new Error('Unsupported gesture');
    const positional = ['tap','doubletap','longpress'].includes(action);
    knownArgs(args, positional ? ['id','x','y'] : ['x1','y1','x2','y2','speed']);
    let cmd;
    if (positional) {
      if (args.id !== undefined && (args.x !== undefined || args.y !== undefined)) throw new Error('Provide node id OR x/y, not both');
      cmd = args.id !== undefined ? ['--id',text(args.id,'id')] : [integer(args.x,'x'),integer(args.y,'y')];
    } else {
      cmd = ['x1','y1','x2','y2'].map(k => integer(args[k],k));
      if (args.speed !== undefined) cmd.push('--speed',integer(args.speed,'speed',200,40000));
    }
    return this.ui(mapped,cmd,serial);
  }
  async logs(serial, args = {}) {
    identifier(serial,'device serial');
    knownArgs(args,['bundle','keyword','level','tail','crash']);
    const cmd = ['log','--device',serial,'--tail',String(integer(args.tail ?? 200,'tail',1,2000))];
    if (args.bundle !== undefined) cmd.push('--bundle-name',identifier(args.bundle,'bundle'));
    if (args.keyword !== undefined) cmd.push('--keyword',text(args.keyword,'keyword'));
    if (args.level !== undefined) {
      if (!['D','I','W','E','F'].includes(args.level)) throw new Error('Invalid log level');
      cmd.push('--level',args.level);
    }
    if (args.crash !== undefined && typeof args.crash !== 'boolean') throw new Error('Invalid crash flag');
    if (args.crash) cmd.push('--crash');
    const result = await this.command(cmd,{timeout:30000,limit:4*1024*1024});
    return {...result,stdout:result.stdout.split('\n').filter(line=>!/^New version .+ available, run `devecocli update` to upgrade$/.test(line.trim())).join('\n').trim()};
  }
  async key(serial, key) {
    identifier(serial,'device serial');
    if (!['Back','Home'].includes(key)) throw new Error('Invalid system key');
    return runCommand(await this.hdc(),['-t',serial,'shell','uitest','uiInput','keyEvent',key],{signal:this.abort.signal});
  }
  async emulatorStart(name) { return this.command(['emulator','start',emulatorTarget(name)],{timeout:120000}); }
  async emulatorStop(name) { return this.command(['emulator','stop',emulatorTarget(name)],{timeout:120000}); }
  async emulatorControl(target, args) { return this.command(emulatorArguments(target,args)); }
  async doctor() {
    const report = { platform: process.platform, node: process.version, cli: this.cli };
    for (const [key, fn] of Object.entries({ cliVersion: () => this.command(['--version']).then(r => r.stdout), hdc: () => this.hdc(), devices: () => this.devices(), emulators: () => this.emulators(), capture: () => runCommand(NATIVE, ['doctor'], { signal: this.abort.signal }).then(r => parseJSON(r.stdout)) })) {
      try { report[key] = await fn(); } catch (error) { report[key] = { error: error.message }; }
    }
    return report;
  }
}
