import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

if (process.platform !== 'darwin') {
  console.error('hos-capture requires macOS 14 or newer.');
  process.exit(1);
}
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const binaryDirectory = join(root, 'native', 'bin');
mkdirSync(binaryDirectory, { recursive: true });
const result = spawnSync('xcrun', ['swiftc', '-parse-as-library', '-O', '-target',
  `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx14.0`,
  join(root, 'native', 'HOSCapture.swift'), '-o', join(binaryDirectory, 'hos-capture')], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
