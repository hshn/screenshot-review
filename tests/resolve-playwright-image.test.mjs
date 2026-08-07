import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '../scripts/resolve-playwright-image.mjs');

function project({ playwrightVersion } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'resolve-image-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'consumer' }));
  if (playwrightVersion) {
    const pkgDir = join(root, 'node_modules', '@playwright', 'test');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@playwright/test', version: playwrightVersion })
    );
  }
  return root;
}

function resolve(cwd, args = []) {
  return execFileSync('node', [script, ...args], { cwd, encoding: 'utf8', timeout: 30_000 });
}

describe('resolve-playwright-image', () => {
  it('reads the version from the installed @playwright/test', () => {
    const out = resolve(project({ playwrightVersion: '1.55.0' }));

    assert.match(out, /^version=1\.55\.0$/m);
    assert.match(out, /^image=mcr\.microsoft\.com\/playwright:v1\.55\.0-noble$/m);
  });

  it('prefers an explicitly requested version over the installed one', () => {
    const out = resolve(project({ playwrightVersion: '1.55.0' }), ['--version', '1.50.1']);

    assert.match(out, /^version=1\.50\.1$/m);
    assert.match(out, /^image=mcr\.microsoft\.com\/playwright:v1\.50\.1-noble$/m);
  });

  it('fails when @playwright/test is absent and no version is given', () => {
    assert.throws(() => resolve(project()), /@playwright\/test/);
  });

  it('resolves without an installed package when a version is given', () => {
    const out = resolve(project(), ['--version', '1.50.1']);

    assert.match(out, /^image=mcr\.microsoft\.com\/playwright:v1\.50\.1-noble$/m);
  });
});
