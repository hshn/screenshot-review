#!/usr/bin/env node
// Local entry point. It runs the same scripts the actions do, so what passes here passes
// in CI.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = join(dirname(dirname(fileURLToPath(import.meta.url))), 'scripts');

const COMMANDS = {
  'baseline pull': 'baseline-pull.mjs',
  run: 'run.mjs',
};

const argv = process.argv.slice(2);
// Match each command's words against the leading argv elements one at a time, not a
// joined-string prefix — a quoted "baseline pull" is one argv element, not two, and must
// not match.
const name = Object.keys(COMMANDS).find(key => key.split(' ').every((word, i) => argv[i] === word));

if (!name) {
  console.error(`Usage: screenshot-review <${Object.keys(COMMANDS).join('|')}> [options]`);
  process.exit(1);
}

const rest = argv.slice(name.split(' ').length);
const result = spawnSync('node', [join(scripts, COMMANDS[name]), ...rest], { stdio: 'inherit' });
process.exit(result.status ?? 1);
