#!/usr/bin/env node
// Run a command inside the official Playwright image. The image ships the browsers and
// fonts the baselines were captured with; running on the host instead makes the same
// screenshots differ by font metrics alone.
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const flag = name => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
};

const command = flag('command');
if (!command) {
  console.error('Usage: run.mjs --command <command> [--version <x.y.z>] [--image <image>]');
  process.exit(1);
}

const resolveImage = () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'resolve-playwright-image.mjs');
  const version = flag('version');
  const out = execFileSync('node', [script, ...(version ? ['--version', version] : [])], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: '' },
  });
  return out.match(/^image=(.+)$/m)[1];
};

const image = flag('image') || resolveImage();

const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--user',
    `${process.getuid()}:${process.getgid()}`,
    '-v',
    `${process.cwd()}:/work`,
    '-w',
    '/work',
    '-e',
    'CI=true',
    '-e',
    'HOME=/tmp',
    image,
    'sh',
    '-c',
    command,
  ],
  { stdio: 'inherit' }
);

if (result.error) {
  console.error(result.error.message);
}
process.exit(result.status ?? 1);
