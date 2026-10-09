import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { ROOT, NATIVE, runCommand, parseJSON, integer } from './adapter.mjs';

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
  constructor(adapter) { this.adapter = adapter; this.active = false; this.frame = null; this.warning = null; this.crop = null; this.deviceSize = null; this.uiQueue = Promise.resolve(); this.lifecycle = Promise.resolve(); }
  transition(operation) { const next = this.lifecycle.then(operation); this.lifecycle = next.catch(() => {}); return next; }
  status() {
    const stale = this.frameSource !== this.source || (this.source === 'sck' ? !this.nativeFrameAt || !this.nativeStateAt || Date.now() - this.nativeStateAt > 3000 : !this.frameAt || Date.now() - this.frameAt > 10000);
    return { active: this.active, device: this.device, source: this.source, windowId: this.windowId, frameSize: this.frameSize, deviceSize: this.deviceSize, crop: this.crop, capturedAt: this.frameAt ? new Date(this.frameAt).toISOString() : null, stale, warning: this.warning };
  }
  start(options) { return this.transition(() => this.startNow(options)); }
  async startNow({ device, source = 'auto', windowId, port = 3200, intervalMs = 1000, fps = 10 } = {}) {
    if (this.active) throw new Error('A preview is already running; stop it before starting another');
    if (!['auto', 'sck', 'hdc'].includes(source)) throw new Error('source must be auto, sck or hdc');
    integer(port, 'port', 0, 65535); integer(intervalMs, 'intervalMs', 250, 10000); integer(fps, 'fps', 1, 30);
    this.device = await this.adapter.device(device);
    this.dir = await mkdtemp(join(tmpdir(), 'serve-hos-'));
    this.intervalMs = intervalMs; this.source = 'hdc'; this.active = true; this.stopping = false; this.warning = null;
    try {
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
            if (candidates.length === 1) window = candidates[0];
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
      this.token = randomBytes(32).toString('hex');
      this.server = createServer((req, res) => this.handle(req, res).catch(error => this.respond(res, 400, { error: error.message })));
      await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(port, '127.0.0.1', resolve); });
      this.port = this.server.address().port;
      this.url = `http://127.0.0.1:${this.port}/#${this.token}`;
      this.schedulePoll();
      this.watchdog = setInterval(() => {
        if (this.source === 'sck' && ((!this.nativeFrameAt && Date.now() - this.captureStartedAt > 5000) || Date.now() - (this.nativeStateAt || this.captureStartedAt) > 4000)) this.fallback('Capture stopped delivering a frame or window health updates');
      }, 1000);
      return { url: this.url, ...this.status() };
    } catch (error) { await this.stopNow(); throw error; }
  }
  setFrame(buffer, type, width, height) {
    if (!this.active || this.stopping) return;
    if (this.frameSize && (width !== this.frameSize.width || height !== this.frameSize.height) && this.source === 'sck') this.crop = null;
    this.frame = buffer; this.mime = type; this.frameSource = this.source; this.frameSize = { width, height }; this.frameAt = Date.now();
  }
  async snapshot(initial = false) {
    const path = join(this.dir, 'snapshot.png');
    try {
      await rm(path, { force: true });
      const shot = await this.adapter.screenshot(this.device, path);
      if (this.stopping) return;
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
    if (!this.active || this.stopping) return;
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(async () => {
      this.pollPromise ||= this.snapshot();
      await this.pollPromise;
      this.pollPromise = null;
      this.schedulePoll();
    }, this.source === 'sck' ? 5000 : this.intervalMs);
  }
  beginCapture(fps) {
    this.captureStartedAt = Date.now(); this.nativeFrameAt = null; this.nativeStateAt = null; this.nativeAtLastSnapshot = null; this.windowSize = null; this.contentGeometry = null;
    const child = spawn(NATIVE, ['capture', '--window-id', String(this.windowId), '--output', this.dir, '--fps', String(fps)], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.capture = child;
    const lines = createInterface({ input: child.stdout });
    let reading = false;
    lines.on('line', async line => {
      if (this.stopping || this.source !== 'sck') return;
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
          if (this.source === 'sck') { this.setFrame(image, 'image/jpeg', frame.width, frame.height); this.nativeFrameAt = Date.now(); this.nativeAtLastSnapshot ??= this.nativeFrameAt; }
        }
      } catch (error) { this.warning = `Frame read failed: ${error.message}`; }
      finally { if (acquired) reading = false; }
    });
    let message = '';
    child.stderr.on('data', chunk => { message = (message + chunk.toString()).slice(-2000); });
    child.on('error', error => this.fallback(error.message));
    child.on('exit', code => { if (!this.stopping && this.source === 'sck') this.fallback(message.trim() || `Capture exited ${code}`); });
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
  async control(action, args) {
    const perform = async () => {
      if (!this.active || this.status().stale) throw new Error('Device preview is stale; input is disabled');
      const frameBeforeInput = this.nativeFrameAt;
      const trackProgress = result => {
        if (this.active && !this.stopping && this.source === 'sck') {
          clearTimeout(this.progressTimer);
          this.progressTimer = setTimeout(() => {
            if (this.source === 'sck' && this.nativeFrameAt === frameBeforeInput) this.fallback('No new window frame after device input; emulator may pause rendering in the background');
          }, 2500);
        }
        return result;
      };
      if (action === 'tap') {
        const p = mapPoint(args.point, this.crop, this.deviceSize);
        return trackProgress(await this.adapter.ui('click', [p.x, p.y], this.device));
      }
      if (action === 'swipe') {
        const a = mapPoint(args.start, this.crop, this.deviceSize), b = mapPoint(args.end, this.crop, this.deviceSize);
        return trackProgress(await this.adapter.ui('swipe', [a.x, a.y, b.x, b.y], this.device));
      }
      if (action === 'text') {
        if (typeof args.text !== 'string' || !args.text.length || args.text.length > 2000 || args.text.includes('\0')) throw new Error('Text must contain 1..2000 characters');
        return trackProgress(await this.adapter.ui('text', [args.text], this.device));
      }
      if (action === 'key') {
        if (!['Back','Home'].includes(args.key)) throw new Error('key must be Back or Home');
        return trackProgress(await runCommand(await this.adapter.hdc(), ['-t', this.device, 'shell', 'uitest', 'uiInput', 'keyEvent', args.key], { signal: this.adapter.abort?.signal }));
      }
      if (action === 'tree') return parseJSON((await this.adapter.ui('layout', ['--format', 'json', '--mode', 'full'], this.device)).stdout);
      if (action === 'calibrate') return this.calibrate(args.rect);
      throw new Error('Unknown preview action');
    };
    const next = this.uiQueue.then(perform);
    this.uiQueue = next.catch(() => {});
    return next;
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
    if (req.method === 'GET' && path === '/api/status') return this.respond(res, 200, this.status());
    if (req.method === 'GET' && path === '/api/frame') {
      if (!this.frame) return this.respond(res, 503, { error: 'No frame yet' });
      res.writeHead(200, { 'Content-Type': this.mime, 'Cache-Control': 'no-store', 'X-Frame-Time': String(this.frameAt), 'X-Preview-Source': this.source }); res.end(this.frame); return;
    }
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
    this.stopping = true; this.active = false;
    clearTimeout(this.pollTimer); clearTimeout(this.progressTimer); clearInterval(this.watchdog);
    if (this.capture && this.capture.exitCode === null) {
      const child = this.capture;
      await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000); timer.unref();
        child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM');
      });
    }
    await this.pollPromise?.catch(() => {});
    await this.uiQueue;
    if (this.server?.listening) { this.server.closeAllConnections(); await new Promise(resolve => this.server.close(resolve)); }
    if (this.dir) await rm(this.dir, { recursive: true, force: true });
    this.frame = null; this.frameSource = null; this.crop = null; this.frameSize = null; this.frameAt = null; this.pollPromise = null; this.server = null; this.capture = null; this.windowId = null;
    this.deviceHash = null; this.nativeAtLastSnapshot = null;
    return { active: false };
  }
}
