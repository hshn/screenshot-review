#!/usr/bin/env node
// Resolve the Playwright version and its official image. The version comes from the
// installed @playwright/test unless one is given explicitly, so the image tag can never
// drift from the browser build the baselines were captured with.
import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const flag = name => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
};

const installedVersion = () => {
  const require = createRequire(join(process.cwd(), 'package.json'));
  try {
    return require('@playwright/test/package.json').version;
  } catch {
    console.error('Could not read the version of @playwright/test. Install it, or pass --version.');
    process.exit(1);
  }
};

const version = flag('version') ?? installedVersion();
const image = `mcr.microsoft.com/playwright:v${version}-noble`;
const lines = `version=${version}\nimage=${image}\n`;

process.stdout.write(lines);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, lines);
}
