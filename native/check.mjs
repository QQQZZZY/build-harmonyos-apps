import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const binary = fileURLToPath(new URL('./bin/hos-capture', import.meta.url));
const run = (...args) => spawnSync(binary, args, { encoding: 'utf8' });
const doctor = run('doctor');
assert.equal(doctor.status, 0, doctor.stderr);
assert.equal(typeof JSON.parse(doctor.stdout).permission, 'boolean');
const windows = run('windows');
assert.equal(windows.status, 0, windows.stderr);
assert.ok(Array.isArray(JSON.parse(windows.stdout)));
for (const args of [[], ['capture'], ['capture', '--window-id', '-1', '--output', '/tmp'],
  ['capture', '--window-id', '1', '--output', 'relative'],
  ['capture', '--window-id', '1', '--output', '/tmp', '--fps', '0']]) {
  const result = run(...args);
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.trim());
  assert.equal(result.stdout, '');
}
console.log('doctor, windows and argument validation passed');

const windowID = process.argv[2];
if (windowID) {
  assert.match(windowID, /^[1-9]\d*$/);
  const output = await mkdtemp(join(tmpdir(), 'hos-capture-check-'));
  const child = spawn(binary, ['capture', '--window-id', windowID, '--output', output, '--fps', '10']);
  let stdout = '', stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`No frame within 8s: ${stderr}`)), 8000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Capture exited ${code}: ${stderr}`)); });
      child.stdout.on('data', chunk => {
        stdout += chunk;
        const lines = stdout.split('\n').slice(0, -1).map(line => JSON.parse(line));
        if (lines.some(value => value.type === 'frame')) { clearTimeout(timeout); resolve(); }
      });
    });
    const frame = stdout.split('\n').slice(0, -1).map(line => JSON.parse(line)).find(value => value.type === 'frame');
    assert.equal(frame.type, 'frame');
    assert.ok(frame.width > 0 && frame.height > 0);
    assert.ok(Number.isFinite(Date.parse(frame.capturedAt)));
    const bytes = await readFile(join(output, 'latest.jpg'));
    assert.equal(bytes.readUInt16BE(0), 0xffd8);
    await new Promise(resolve => setTimeout(resolve, 3000));
    child.kill('SIGTERM');
    const result = await Promise.race([exited, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('SIGTERM did not stop capture')), 3000);
      timer.unref();
    })]);
    assert.deepEqual(result, { code: 0, signal: null });
    const messages = stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.ok(messages.every(value => ['frame', 'state'].includes(value.type)));
    const frames = messages.filter(value => value.type === 'frame');
    const states = messages.filter(value => value.type === 'state');
    assert.ok(states.length >= 3);
    for (const state of states) {
      assert.equal(state.windowId, Number(windowID));
      assert.equal(typeof state.onScreen, 'boolean');
      assert.ok(state.width >= 0 && state.height >= 0);
      assert.ok(Number.isFinite(Date.parse(state.observedAt)));
    }
    console.log(`capture JPEG ${frame.width}x${frame.height}, ${frames.length} frames/${states.length} states over 3s, metadata and SIGTERM passed: ${output}`);
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
}
