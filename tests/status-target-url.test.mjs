import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '../scripts/status-target-url.mjs');

const SHA = 'a'.repeat(40);
const TESTS_RUN = 'https://github.com/acme/web/actions/runs/1001';

// A stand-in for gh on PATH. It records the arguments it was called with and answers with
// the canned response, so the script's request and its reading of the answer are both
// observable without a network.
function fakeGh({ response, fail = false }) {
  const dir = mkdtempSync(join(tmpdir(), 'fake-gh-'));
  const argsFile = join(dir, 'args');
  const responseFile = join(dir, 'response');
  writeFileSync(responseFile, response === undefined ? '' : JSON.stringify(response));
  writeFileSync(
    join(dir, 'gh'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\n${fail ? 'exit 1\n' : `cat "${responseFile}"\n`}`
  );
  chmodSync(join(dir, 'gh'), 0o755);
  return { dir, args: () => readFileSync(argsFile, 'utf8').split('\n').filter(line => line !== '') };
}

function lookup(gh, args, { repository = 'acme/web' } = {}) {
  return spawnSync('node', [script, ...args], {
    env: { ...process.env, PATH: `${gh.dir}:${process.env.PATH}`, GITHUB_REPOSITORY: repository },
    encoding: 'utf8',
    timeout: 30_000,
  });
}

// The combined status: one entry per context, the latest each.
const combined = statuses => ({ state: 'failure', sha: SHA, statuses });

describe('status-target-url', () => {
  it('prints where the status with that context currently links to', () => {
    const gh = fakeGh({
      response: combined([
        { context: 'ci/lint', state: 'success', target_url: 'https://github.com/acme/web/actions/runs/1000' },
        { context: 'Screenshot Review', state: 'failure', target_url: TESTS_RUN },
      ]),
    });

    const result = lookup(gh, ['--sha', SHA, '--context', 'Screenshot Review']);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${TESTS_RUN}\n`);
  });

  it('prints nothing when no status with that context has been written yet', () => {
    const gh = fakeGh({
      response: combined([{ context: 'ci/lint', state: 'success', target_url: 'https://example.test/lint' }]),
    });

    const result = lookup(gh, ['--sha', SHA, '--context', 'Screenshot Review']);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  });

  it('asks for the combined status of that commit in that repository', () => {
    const gh = fakeGh({ response: combined([]) });

    lookup(gh, ['--sha', SHA, '--context', 'Screenshot Review'], { repository: 'acme/web' });

    const [api, path] = gh.args();
    assert.equal(api, 'api');
    assert.match(path, new RegExp(`^repos/acme/web/commits/${SHA}/status(\\?|$)`));
  });

  it('fails when the lookup itself fails, rather than answering as if nothing was there', () => {
    const gh = fakeGh({ fail: true });

    const result = lookup(gh, ['--sha', SHA, '--context', 'Screenshot Review']);

    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  });
});
