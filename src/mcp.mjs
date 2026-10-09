#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Workflows, TOOLS } from './tools.mjs';
import { readFile } from 'node:fs/promises';

const workflows = new Workflows();
const { name, version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const server = new Server({ name, version }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    const result = await workflows.call(request.params.name, request.params.arguments || {});
    if (result.image) {
      const { image, mime, ...info } = result;
      return { content: [{ type: 'image', data: image.toString('base64'), mimeType: mime }, { type: 'text', text: JSON.stringify(info) }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
});
let exiting = false;
async function close() {
  if (exiting) return;
  exiting = true;
  await workflows.close();
  await server.close();
}
process.on('SIGINT', () => close().then(() => process.exit(0)));
process.on('SIGTERM', () => close().then(() => process.exit(0)));
process.stdin.on('end', () => close().then(() => process.exit(0)));
await server.connect(new StdioServerTransport());
