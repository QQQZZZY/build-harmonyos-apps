#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { DevEco, runCommand, NATIVE, parseJSON, cancelCommands } from './adapter.mjs';
import { Preview, captureWindows } from './preview.mjs';

const usage = `serve-hos [--device SERIAL] [--source auto|sck|hdc] [--window-id ID] [--port 3200] [--fps 10] [--interval-ms 1000]
serve-hos doctor | devices | windows | permission | mcp
macOS 14+ / Node 22+ / DevEco CLI. Preview listens on 127.0.0.1 only.`;
let preview;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: Object.fromEntries(['device','source','window-id','port','fps','interval-ms'].map(k => [k, { type: 'string' }]).concat([['help', { type: 'boolean', short: 'h' }]])) });
  if (values.help) console.log(usage);
  else if (positionals.length > 1) throw new Error(usage);
  else {
    const adapter = new DevEco();
    const command = positionals[0];
    if (command === 'doctor') console.log(JSON.stringify(await adapter.doctor(), null, 2));
    else if (command === 'devices') console.log(JSON.stringify(await adapter.devices(), null, 2));
    else if (command === 'windows') console.log(JSON.stringify(await captureWindows(), null, 2));
    else if (command === 'permission') console.log(JSON.stringify(parseJSON((await runCommand(NATIVE, ['permission'])).stdout)));
    else if (command === 'mcp') await import('./mcp.mjs');
    else if (command) throw new Error(usage);
    else {
      preview = new Preview(adapter);
      const options = { device: values.device, source: values.source };
      for (const [flag, key] of [['window-id','windowId'],['port','port'],['fps','fps'],['interval-ms','intervalMs']]) if (values[flag] !== undefined) options[key] = Number(values[flag]);
      const result = await preview.start(options);
      console.log(JSON.stringify(result, null, 2));
      let stopping = false;
      const close = async () => { if (stopping) return; stopping = true; adapter.close(); await cancelCommands(); await preview.stop(); process.exit(0); };
      process.on('SIGINT', close); process.on('SIGTERM', close);
    }
  }
} catch (error) { console.error(error.message); if (preview) await preview.stop(); process.exitCode = 1; }
