#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { copyFile } from 'node:fs/promises';
import { DevEco, ROOT } from '../src/adapter.mjs';

const { values } = parseArgs({ options: { path: { type: 'string' } } });
if (!values.path) throw new Error('Usage: node scripts/create-fixture.mjs --path ABS_EMPTY_PROJECT_PATH');
const path = resolve(values.path);
const adapter = new DevEco();
await adapter.command(['create', '--app-name', 'ServeHosFixture', '--bundle-name', 'com.example.servehosfixture', '--project-path', path], { timeout: 120000 });
await copyFile(join(ROOT, 'tests/fixture.ets'), join(path, 'entry/src/main/ets/pages/Index.ets'));
console.log(`Fixture project: ${path}`);
