import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const realCli = join(dirname(fileURLToPath(import.meta.url)), '../bin/cli.mjs');

// A copy of the real cli.mjs alongside stub scripts standing in for baseline-pull.mjs and
// run.mjs, so a test observes exactly what argv the CLI forwards without touching git,
// docker, or the network. Each stub echoes the argv it received and exits with a distinct
// code, so a test can tell which script ran and that its exit code propagated.
function harness() {
  const root = mkdtempSync(join(tmpdir(), 'cli-test-'));
  mkdirSync(join(root, 'bin'));
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'bin', 'cli.mjs'), readFileSync(realCli));
  for (const [name, exitCode] of [
    ['baseline-pull.mjs', 3],
    ['run.mjs', 7],
  ]) {
    writeFileSync(
      join(root, 'scripts', name),
      `#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\nprocess.exit(${exitCode});\n`
    );
  }
  return join(root, 'bin', 'cli.mjs');
}

const run = (cli, args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', timeout: 10_000 });

describe('cli', () => {
  it('forwards every remaining argument to baseline-pull.mjs unchanged', () => {
    const cli = harness();

    const result = run(cli, ['baseline', 'pull', '--base-branch', 'main', '--extra', 'value']);

    assert.equal(result.status, 3);
    assert.deepEqual(JSON.parse(result.stdout), ['--base-branch', 'main', '--extra', 'value']);
  });

  it('forwards every remaining argument to run.mjs unchanged', () => {
    const cli = harness();

    const result = run(cli, ['run', '--command', 'echo hi']);

    assert.equal(result.status, 7);
    assert.deepEqual(JSON.parse(result.stdout), ['--command', 'echo hi']);
  });

  it('rejects the two-word subcommand quoted as a single argument instead of mis-slicing', () => {
    const cli = harness();

    const result = run(cli, ['baseline pull', '--branch', 'custom-baselines', '--base-branch', 'main']);

    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^Usage: /);
  });

  it('prints usage and exits 1 for an unknown command', () => {
    const cli = harness();

    const result = run(cli, ['bogus']);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Usage: /);
  });

  it('prints usage and exits 1 when no command is given', () => {
    const cli = harness();

    const result = run(cli, []);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Usage: /);
  });
});
