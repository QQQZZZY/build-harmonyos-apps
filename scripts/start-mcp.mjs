#!/usr/bin/env node
import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let preparationInterrupted = false;
const exists = async path => { try { await access(path); return true; } catch { return false; } };
const prepare = (command, args) => new Promise((resolve, reject) => {
  // Bootstrap diagnostics must not contaminate the stdio MCP protocol.
  const child = spawn(command, args, { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stop = () => { preparationInterrupted = true; try { process.kill(-child.pid, 'SIGTERM'); } catch {} };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  const cleanup = () => { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); };
  child.stdout.pipe(process.stderr, { end: false }); child.stderr.pipe(process.stderr, { end: false });
  child.on('error', error => { cleanup(); reject(error); }); child.on('exit', code => { cleanup(); code === 0 ? resolve() : reject(new Error(`${command} preparation failed (${code})`)); });
});
try {
  if (!await exists(join(root, 'node_modules/@modelcontextprotocol/sdk/package.json'))) await prepare('npm', ['ci', '--ignore-scripts', '--omit=dev']);
  if (process.platform === 'darwin' && !await exists(join(root, 'native/bin/hos-capture'))) {
    try { await prepare(process.execPath, ['scripts/build-native.mjs']); }
    catch (error) { if (preparationInterrupted) throw error; console.error(`Window capture unavailable: ${error.message}. HDC tools and screenshot fallback remain available.`); }
  }
  await import('../src/mcp.mjs');
} catch (error) { console.error(error.message); process.exitCode = 1; }
