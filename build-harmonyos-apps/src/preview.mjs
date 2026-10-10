import { createServer } from 'node:http';
import { createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { ROOT, NATIVE, runCommand, parseJSON, integer, emulatorArguments } from './adapter.mjs';

export function cropRect(rect) {
  if (!rect || ['x','y','width','height'].some(k => !Number.isFinite(rect[k]))) throw new Error('A normalized screen rectangle is required');
  const { x, y, width, height } = rect;
  if (x < 0 || y < 0 || width < .02 || height < .02 || x + width > 1.000001 || y + height > 1.000001) throw new Error('Screen rectangle must fit inside the preview');
  return { x, y, width, height };
}
export function mapPoint(point, crop, size) {
  if (!crop || !size) throw new Error('Calibrate the device screen first');
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Invalid point');
  const x = (point.x - crop.x) / crop.width, y = (point.y - crop.y) / crop.height;
  if (x < -1e-9 || y < -1e-9 || x > 1 + 1e-9 || y > 1 + 1e-9) throw new Error('Point is outside the calibrated device screen');
  return { x: Math.round(Math.min(1, Math.max(0, x)) * (size.width - 1)), y: Math.round(Math.min(1, Math.max(0, y)) * (size.height - 1)) };
}

export async function captureWindows(options) { return parseJSON((await runCommand(NATIVE, ['windows'], options)).stdout).filter(window => /emulator/i.test(window.owner)); }

export function windowMatchesEmulator(command, name) {
  return /(?:\/|\s)Emulator\s/.test(command) && command.endsWith(`Emulator -start ${name} -bootmode snapshot`);
}

export class Preview {
  constructor(adapter) { this.adapter = adapter; this.active = false; this.frame = null; this.warning = null; this.crop = null; this.deviceSize = null; this.uiQueue = Promise.resolve(); this.lifecycle = Promise.resolve(); this.session = null; this.events = []; this.nextEvent = 0; this.frameVersion = 0; this.applications = new Map(); }
  transition(operation) { const next = this.lifecycle.then(operation); this.lifecycle = next.catch(() => {}); return next; }
  status() {
    const stale = this.switching || !this.device || this.frameSource !== this.source || (this.source === 'sck' ? !this.nativeFrameAt || !this.nativeStateAt || Date.now() - this.nativeStateAt > 3000 : !this.frameAt || Date.now() - this.frameAt > 10000);
    return { active: this.active, session: this.session, switching: !!this.switching, deviceName: this.deviceName || this.device, events: this.events, application: this.applications.get(this.device) || null, device: this.device, source: this.source, windowId: this.windowId, frameSize: this.frameSize, deviceSize: this.deviceSize, crop: this.crop, capturedAt: this.frameAt ? new Date(this.frameAt).toISOString() : null, stale, warning: this.warning };
  }
  start(options) { return this.transition(() => this.startNow(options)); }
  async startNow({ device, source = 'auto', windowId, port = 3200, intervalMs = 1000, fps = 10 } = {}) {
    if (this.active) throw new Error('A preview is already running; stop it before starting another');
    if (!['auto', 'sck', 'hdc'].includes(source)) throw new Error('source must be auto, sck or hdc');
    integer(port, 'port', 0, 65535); integer(intervalMs, 'intervalMs', 250, 10000); integer(fps, 'fps', 1, 30);
    this.options = { source, windowId, fps };
    this.intervalMs = intervalMs; this.source = 'hdc'; this.active = true; this.stopping = false; this.warning = null; this.session++;
    try {
      try { this.device = await this.adapter.device(device); }
      catch (error) { if (device || !/No connected devices|Multiple devices/.test(error.message)) throw error; this.device = null; }
      if (this.device) await this.startCapture(this.options);
      else this.warning = '请选择已连接设备，或启动本地模拟器';
      this.token = randomBytes(32).toString('hex');
      this.server = createServer((req, res) => this.handle(req, res).catch(error => this.respond(res, error.status || 400, { error: error.message })));
      await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(port, '127.0.0.1', resolve); });
      this.port = this.server.address().port;
      this.url = `http://127.0.0.1:${this.port}/#${this.token}`;
      this.schedulePoll();
      this.watchdog = setInterval(() => {
        if (!this.switching && this.source === 'sck' && ((!this.nativeFrameAt && Date.now() - this.captureStartedAt > 5000) || Date.now() - (this.nativeStateAt || this.captureStartedAt) > 4000)) this.fallback('Capture stopped delivering a frame or window health updates');
      }, 1000);
      return { url: this.url, ...this.status() };
    } catch (error) { await this.stopNow(); throw error; }
  }
  async startCapture({ source = 'auto', windowId, fps = 10 } = {}) {
    if (!['auto','sck','hdc'].includes(source)) throw new Error('Invalid preview source');
    this.dir = await mkdtemp(join(tmpdir(), 'serve-hos-'));
    this.source = 'hdc'; this.warning = null;
    await this.snapshot(true);
      if (source !== 'hdc') {
        try {
          const emulator = (await this.adapter.emulators()).find(e => e.status === 'running' && e.serial === this.device);
          if (!emulator) throw new Error('Selected serial is not a running local emulator; use HDC for physical devices');
          const commandOptions = { signal: this.adapter.abort?.signal };
          const permission = parseJSON((await runCommand(NATIVE, ['doctor'], commandOptions)).stdout);
          if (!permission.permission) throw new Error('Screen Recording permission is missing; run serve-hos permission and grant it in macOS Settings');
          const windows = await captureWindows(commandOptions);
          let window;
          if (windowId !== undefined) window = windows.find(w => w.id === integer(windowId, 'windowId', 1, 2 ** 32 - 1));
          else {
            const candidates = windows.filter(w => /emulator/i.test(w.owner) && w.onScreen && w.width > 100 && w.height > 100);
            const matches = [];
            for (const candidate of candidates) {
              const pid = integer(candidate.pid,'window process ID',1,2**31-1);
              try {
                const command = (await runCommand('/bin/ps',['-p',String(pid),'-o','command='],commandOptions)).stdout;
                if (windowMatchesEmulator(command,emulator.name)) matches.push(candidate);
              } catch {}
            }
            if (matches.length === 1) window = matches[0];
          }
          if (!window) throw new Error('Select one emulator window with serve-hos windows and --window-id');
          if (!/emulator/i.test(window.owner)) throw new Error('Selected window does not belong to an emulator');
          const pid = integer(window.pid, 'window process ID', 1, 2 ** 31 - 1);
          const processCommand = (await runCommand('/bin/ps', ['-p', String(pid), '-o', 'command='], commandOptions)).stdout;
          if (!windowMatchesEmulator(processCommand, emulator.name)) throw new Error('Cannot bind selected window to this device serial; use HDC preview');
          this.source = 'sck'; this.windowId = window.id; this.crop = null;
          this.beginCapture(fps);
        } catch (error) {
          if (source === 'sck') throw error;
          this.warning = `Using HDC screenshots: ${error.message}`;
        }
      }
  }
  async record(action, operation, device) {
    const began = Date.now(); let ok = false;
    try { const result = await operation(); ok = true; return result; }
    finally {
      this.events.push({ id: ++this.nextEvent, time: new Date().toISOString(), action, status: ok ? 'ok' : 'error', durationMs: Date.now()-began, device: device || this.device, summary: `${action} · ${ok ? '完成' : '失败'}` });
      if (this.events.length > 200) this.events.splice(0, this.events.length-200);
    }
  }
  select(device, session = this.session) {
    return this.record('device_select', () => this.transition(async () => {
      this.checkSession(session);
      const serial = await this.adapter.device(device);
      this.events = [];
      return this.reconfigure(serial, this.options);
    }));
  }
  retry(options = {}, session = this.session) {
    return this.record('retry', () => this.transition(() => {this.checkSession(session);return this.reconfigure(this.device, { ...this.options, ...options });}));
  }
  async reconfigure(serial, options, operation) {
    if (!this.active) throw new Error('Preview is not running');
    if (!['auto','sck','hdc'].includes(options.source ?? 'auto')) throw new Error('Invalid preview source');
    if (options.windowId !== undefined) integer(options.windowId,'windowId',1,2**32-1);
    const previous = this.device;
    this.switching = true; this.session++;
    try {
      await this.uiQueue;
      await this.stopCaptureNow();
      this.device = serial; this.deviceName = serial; this.options = options;
      if (operation) await operation();
      if (serial) {
        if (this.adapter.devices) {
          const devices = await this.adapter.devices();
          this.deviceName = devices.find(d => d.serial === serial)?.name || serial;
        }
        await this.startCapture(options);
      }
    } catch (error) {
      let reason = error.message;
      if (!this.dir && (serial || previous)) {
        this.device = serial || previous;
        try {await this.startCapture({...options,source:'hdc'});} catch (recovery) {reason += `; Capture recovery failed: ${recovery.message}`;}
      }
      this.warning = reason; throw error;
    }
    finally { this.switching = false; this.schedulePoll(); }
    return this.status();
  }
  async stopCaptureNow() {
    clearTimeout(this.pollTimer); clearTimeout(this.progressTimer);
    if (this.capture && this.capture.exitCode === null) {
      const child = this.capture;
      await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); },2000); timer.unref();
        child.once('exit',()=>{clearTimeout(timer);resolve();}); child.kill('SIGTERM');
      });
    }
    await this.pollPromise?.catch(() => {});
    if (this.dir) await rm(this.dir, { recursive: true, force: true });
    this.dir = null; this.capture = null; this.windowId = null; this.frame = null; this.frameSession = null; this.frameHash = null; this.frameSource = null; this.frameAt = null; this.frameSize = null; this.deviceSize = null; this.crop = null;
    this.pollPromise = null; this.nativeFrameAt = null; this.nativeStateAt = null; this.deviceHash = null; this.nativeAtLastSnapshot = null;
  }
  setFrame(buffer, type, width, height) {
    if (!this.active || this.stopping) return;
    if (this.frameSize && (width !== this.frameSize.width || height !== this.frameSize.height) && this.source === 'sck') this.crop = null;
    const hash = createHash('sha256').update(buffer).digest('hex');
    if (hash !== this.frameHash) { this.frameVersion++; this.frameHash = hash; }
    this.frameSession = this.session; this.frame = buffer; this.mime = type; this.frameSource = this.source; this.frameSize = { width, height }; this.frameAt = Date.now();
  }
  async snapshot(initial = false) {
    if (!this.dir || !this.device) return;
    const session = this.session, path = join(this.dir, 'snapshot.png');
    try {
      await rm(path, { force: true });
      const shot = await this.adapter.screenshot(this.device, path);
      if (this.stopping || session !== this.session) return;
      const deviceHash = createHash('sha256').update(shot.buffer).digest('hex');
      if (this.source === 'sck' && this.deviceHash && deviceHash !== this.deviceHash && this.nativeFrameAt && this.nativeFrameAt === this.nativeAtLastSnapshot) this.fallback('Device screen changed without a new window frame; emulator may pause background rendering');
      this.deviceHash = deviceHash; this.nativeAtLastSnapshot = this.nativeFrameAt;
      if (this.deviceSize && (shot.width !== this.deviceSize.width || shot.height !== this.deviceSize.height)) {
        this.crop = null;
        if (this.source === 'sck') this.fallback('Device display size changed; restart SCK preview and recalibrate');
      }
      this.deviceSize = { width: shot.width, height: shot.height };
      if (initial || this.source === 'hdc') {
        this.setFrame(shot.buffer, 'image/png', shot.width, shot.height);
        this.crop = { x: 0, y: 0, width: 1, height: 1 };
      }
    } catch (error) { if (initial) throw error; this.warning = `Screenshot failed: ${error.message}`; }
    finally { await rm(path, { force: true }); }
  }
  schedulePoll() {
    if (!this.active || this.stopping || this.switching || !this.device || !this.dir) return;
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(async () => {
      this.pollPromise ||= this.snapshot();
      await this.pollPromise;
      this.pollPromise = null;
      this.schedulePoll();
    }, this.source === 'sck' ? 5000 : this.intervalMs);
  }
  beginCapture(fps) {
    const session = this.session;
    this.captureStartedAt = Date.now(); this.nativeFrameAt = null; this.nativeStateAt = null; this.nativeAtLastSnapshot = null; this.windowSize = null; this.contentGeometry = null;
    const child = spawn(NATIVE, ['capture', '--window-id', String(this.windowId), '--output', this.dir, '--fps', String(fps)], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.capture = child;
    const lines = createInterface({ input: child.stdout });
    let reading = false;
    lines.on('line', async line => {
      if (this.stopping || session !== this.session || this.source !== 'sck') return;
      let acquired = false;
      try {
        const frame = JSON.parse(line);
        if (frame.type === 'state') {
          this.nativeStateAt = Date.now();
          if (!frame.onScreen || frame.missing) { this.fallback('Emulator window is minimized, offscreen or closed'); return; }
          if (this.windowSize && (frame.width !== this.windowSize.width || frame.height !== this.windowSize.height)) { this.fallback('Window size changed; restart SCK preview and recalibrate'); return; }
          this.windowSize = { width: frame.width, height: frame.height };
          return;
        }
        if (frame.type === 'frame') {
          if (reading) return;
          reading = true; acquired = true;
          integer(frame.width, 'frame.width', 1); integer(frame.height, 'frame.height', 1);
          const geometry = JSON.stringify([frame.contentRect, frame.contentScale, frame.scaleFactor]);
          if (this.contentGeometry && geometry !== this.contentGeometry) this.crop = null;
          this.contentGeometry = geometry;
          const image = await readFile(join(this.dir, 'latest.jpg'));
          if (session === this.session && this.source === 'sck') { this.setFrame(image, 'image/jpeg', frame.width, frame.height); this.nativeFrameAt = Date.now(); this.nativeAtLastSnapshot ??= this.nativeFrameAt; }
        }
      } catch (error) { this.warning = `Frame read failed: ${error.message}`; }
      finally { if (acquired) reading = false; }
    });
    let message = '';
    child.stderr.on('data', chunk => { message = (message + chunk.toString()).slice(-2000); });
    child.on('error', error => {if(session === this.session)this.fallback(error.message);});
    child.on('exit', code => { if (!this.stopping && session === this.session && this.source === 'sck') this.fallback(message.trim() || `Capture exited ${code}`); });
  }
  fallback(reason) {
    if (!this.active || this.stopping || this.source === 'hdc') return;
    this.source = 'hdc'; this.crop = null; this.warning = `Using HDC screenshots: ${reason}`;
    this.capture?.kill('SIGTERM');
    clearTimeout(this.pollTimer);
    this.schedulePoll();
  }
  calibrate(rect) {
    if (this.source !== 'sck') throw new Error('HDC preview already matches device pixels');
    if (!this.nativeFrameAt || this.status().stale) throw new Error('Wait for a live ScreenCaptureKit frame');
    this.crop = cropRect(rect);
    return this.status();
  }
  async screenshot() {
    const session = this.session;
    const take = async () => {
      this.checkSession(session);
      if (!this.device) throw new Error('请先选择设备');
      const dir = await mkdtemp(join(tmpdir(),'hos-export-'));
      try { const shot = await this.adapter.screenshot(this.device,join(dir,'device.png')); this.checkSession(session); return shot; }
      finally { await rm(dir,{recursive:true,force:true}); }
    };
    const next = this.uiQueue.then(take); this.uiQueue = next.catch(()=>{}); return next;
  }
  async installRequest(req) {
    const session = Number(req.headers['x-preview-session']);
    this.checkSession(session);
    if (!this.device) throw new Error('请先选择设备');
    const name = decodeURIComponent(req.headers['x-hap-name'] || 'package.hap');
    if (name.length > 256 || !/\.hap$/i.test(name) || /[\/\\\0\r\n]/.test(name)) throw new Error('请选择 .hap 安装包');
    const max = 128 * 1024 * 1024;
    if (Number(req.headers['content-length']) > max) throw new Error('安装包不能超过 128 MiB');
    const dir = await mkdtemp(join(tmpdir(),'hos-install-')), file = join(dir,'package.hap');
    let bytes = 0, prefix = Buffer.alloc(0);
    try {
      const limit = new Transform({transform(chunk,_encoding,done) {
        bytes += chunk.length;
        if (bytes > max) {done(new Error('安装包不能超过 128 MiB'));return;}
        if (prefix.length < 4) prefix=Buffer.concat([prefix,chunk.subarray(0,4-prefix.length)]);
        done(null,chunk);
      }});
      await pipeline(req,limit,createWriteStream(file,{flags:'wx',mode:0o600}));
      if (!prefix.equals(Buffer.from([80,75,3,4]))) throw new Error('安装包不是有效的 HAP/ZIP 文件');
      const install = () => this.record('install',async()=>{
        this.checkSession(session);
        const info = await this.adapter.hapInfo(file);
        const result = await this.adapter.install(file,this.device);
        const application = info ? {...info,installedAt:new Date().toISOString()} : null;
        if (application) this.applications.set(this.device,application);else this.applications.delete(this.device);
        return {...result,application};
      });
      const next = this.uiQueue.then(install);this.uiQueue = next.catch(()=>{});return await next;
    } finally {await rm(dir,{recursive:true,force:true});}
  }
  checkSession(session) {
    if (!this.active || this.switching || session !== this.session) {
      const error = new Error('Device session changed; refresh before operating'); error.status = 409; throw error;
    }
  }
  async control(action, { session = this.session, ...args } = {}) {
    this.checkSession(session);
    const allowed = {tap:['point','id'],doubletap:['point','id'],longpress:['point','id'],swipe:['start','end','speed'],drag:['start','end','speed'],text:['text','id'],key:['key'],tree:[],logs:['bundle','keyword','level','tail','crash'],launch:['bundle','ability'],calibrate:['rect'],device_select:['device'],retry:['source','windowId'],emulator_start:['name'],emulator_stop:['name']};
    if (action !== 'emulator_control') {
      if (!allowed[action]) throw new Error('Unknown preview action');
      for (const key of Object.keys(args)) if (!allowed[action].includes(key)) throw new Error(`Unknown argument: ${key}`);
    }
    if (action === 'device_select') return this.select(args.device,session);
    if (action === 'retry') return this.retry(args,session);
    if (action === 'emulator_start') return this.record(action,()=>this.adapter.emulatorStart(args.name),args.name);
    if (action === 'emulator_stop') return this.record(action,()=>this.transition(async()=>{
      this.checkSession(session);
      const emulators = await this.adapter.emulators();
      const selected = emulators.find(e => e.name === args.name || e.serial === args.name);
      const stop = () => this.adapter.emulatorStop(args.name);
      if (this.device && selected?.serial === this.device) return this.reconfigure(null,this.options,stop);
      return stop();
    }),args.name);
    if (action === 'emulator_control') {
      const target = this.device; emulatorArguments(target,args);
      return this.record(action,()=>this.transition(()=>{this.checkSession(session);return this.reconfigure(target,this.options,()=>this.adapter.emulatorControl(target,args));}));
    }
    const perform = () => this.record(action, async () => {
      this.checkSession(session);
      if (!this.device) throw new Error('请先选择设备');
      if (action === 'tree') return parseJSON((await this.adapter.ui('layout',['--format','json','--mode','full'],this.device)).stdout);
      if (action === 'logs') return this.adapter.logs(this.device,args);
      if (action === 'calibrate') return this.calibrate(args.rect);
      if (action === 'launch') {
        const result = await this.adapter.launch(this.device,args.bundle,args.ability);
        const old = this.applications.get(this.device);
        const application = {...(old?.bundle === args.bundle ? old : {}),bundle:args.bundle,ability:args.ability,launchedAt:new Date().toISOString()};
        this.applications.set(this.device,application);return {...result,application};
      }
      if (this.status().stale) throw new Error('Device preview is stale; input is disabled');
      const frameBeforeInput = this.nativeFrameAt;
      let result;
      if (['tap','doubletap','longpress'].includes(action)) {
        if (args.id !== undefined && args.point !== undefined) throw new Error('Provide node id OR point');
        const target = args.id !== undefined ? {id:args.id} : mapPoint(args.point,this.crop,this.deviceSize);
        result = await this.adapter.gesture(action,target,this.device);
      } else if (['swipe','drag'].includes(action)) {
        const a = mapPoint(args.start,this.crop,this.deviceSize), b = mapPoint(args.end,this.crop,this.deviceSize);
        result = await this.adapter.gesture(action,{x1:a.x,y1:a.y,x2:b.x,y2:b.y,...(args.speed !== undefined ? {speed:args.speed} : {})},this.device);
      } else if (action === 'text') {
        if (typeof args.text !== 'string' || !args.text.length || args.text.length>2000 || args.text.includes('\0')) throw new Error('Text must contain 1..2000 characters');
        result = await this.adapter.ui('text',[args.text,...(args.id !== undefined ? ['--id',args.id] : [])],this.device);
      } else if (action === 'key') result = await this.adapter.key(this.device,args.key);
      if (this.source === 'sck') {
        clearTimeout(this.progressTimer);
        this.progressTimer = setTimeout(()=>{if(this.source==='sck' && this.nativeFrameAt===frameBeforeInput)this.fallback('No new window frame after device input; emulator may pause background rendering');},2500);
      }
      return result;
    });
    const next = this.uiQueue.then(perform); this.uiQueue = next.catch(()=>{}); return next;
  }
  respond(res, status, value) {
    if (res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value));
  }
  async handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'");
    const origin = `http://127.0.0.1:${this.port}`;
    if (req.headers.host !== `127.0.0.1:${this.port}` || (req.headers.origin && req.headers.origin !== origin)) return this.respond(res, 403, { error: 'Local origin required' });
    const path = new URL(req.url, origin).pathname;
    const assets = { '/': ['index.html','text/html'], '/app.js': ['app.js','text/javascript'], '/style.css': ['style.css','text/css'] };
    if (req.method === 'GET' && assets[path]) {
      const [name, mime] = assets[path];
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); res.end(await readFile(join(ROOT, 'web', name))); return;
    }
    const auth = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${this.token}`);
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return this.respond(res, 401, { error: 'Preview token required; use the URL printed by serve-hos' });
    if (req.method === 'GET' && path === '/api/devices') return this.respond(res,200,{devices:await this.adapter.devices(),emulators:await this.adapter.emulators()});
    if (req.method === 'GET' && path === '/api/events') return this.respond(res,200,{session:this.session,events:this.events});
    if (req.method === 'GET' && path === '/api/screenshot') {
      const shot = await this.screenshot();
      res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Preview-Session':String(this.session)});res.end(shot.buffer);return;
    }
    if (req.method === 'GET' && path === '/api/status') return this.respond(res, 200, this.status());
    if (req.method === 'GET' && path === '/api/frame') {
      if (this.switching || this.frameSession !== this.session || !this.frame) return this.respond(res, 503, { error: 'No frame yet' });
      const etag = `\"${this.session}:${this.frameVersion}\"`;
      res.setHeader('ETag',etag); res.setHeader('X-Preview-Session',String(this.session));
      if (req.headers['if-none-match'] === etag) {res.writeHead(304);res.end();return;}
      res.writeHead(200, { 'Content-Type': this.mime, 'Cache-Control': 'no-store', 'X-Frame-Time': String(this.frameAt), 'X-Preview-Source': this.source }); res.end(this.frame); return;
    }
    if (req.method === 'POST' && path === '/api/install') return this.respond(res,200,await this.installRequest(req));
    if (req.method === 'POST' && path === '/api/action') {
      let body = '', length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > 16384) throw new Error('Request too large'); body += chunk; }
      const { action, ...args } = JSON.parse(body);
      return this.respond(res, 200, await this.control(action, args));
    }
    this.respond(res, 404, { error: 'Not found' });
  }
  stop() { return this.transition(() => this.stopNow()); }
  async stopNow() {
    this.stopping = true; this.active = false; this.session++;
    clearInterval(this.watchdog);
    await this.uiQueue;
    await this.stopCaptureNow();
    if (this.server?.listening) { this.server.closeAllConnections(); await new Promise(resolve=>this.server.close(resolve)); }
    this.server = null; this.device = null; this.deviceName = null;
    return { active: false };
  }
}
