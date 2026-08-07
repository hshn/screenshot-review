import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const script = join(dirname(fileURLToPath(import.meta.url)), '../scripts/replace-branch-with-dir.sh');

const TOKEN = 'APP_TOKEN';
const AMBIENT = 'Basic FROM_CHECKOUT_READONLY';

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

// Isolate from the runner's own git config (credential helpers, URL rewrites) so it
// cannot sway the result. Terminal prompting is forbidden so a hang fails fast instead.
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
};

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 30_000,
    stdio: 'pipe',
  });
}

// The test that observes the headers sent talks to an HTTP server in this same process, so
// it must not block the event loop while waiting (a synchronous run could not respond and
// would hang). Always hand cwd a disposable location, so an implementation that touches the
// working tree can never drag this repository in.
function run(branch, dir, remote, { cwd = tmp('cwd-') } = {}) {
  return execFileAsync('bash', [script, branch, dir, 'contents placed here'], {
    encoding: 'utf8',
    timeout: 30_000,
    cwd,
    env: {
      ...env,
      GH_TOKEN: TOKEN,
      GIT_IDENTITY_NAME: 'tester[bot]',
      GIT_IDENTITY_EMAIL: 'tester[bot]@users.noreply.github.com',
      PUSH_REMOTE: remote,
    },
  });
}

describe('replace-branch-with-dir', () => {
  it('authenticates with the token passed in, not the one checkout left behind', async () => {
    // actions/checkout leaves the job's token behind in local config under a URL-scoped
    // key. Confirm the token passed in is what's actually used, via the header it sends,
    // even when pushing from inside that checkout.
    const seen = [];
    const server = createServer((req, res) => {
      seen.push(req.headers.authorization ?? null);
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="git"' });
      res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;

    const checkout = tmp('checkout-');
    git(checkout, ['init', '-q', '.']);
    git(checkout, ['config', `http.${origin}/.extraheader`, `AUTHORIZATION: ${AMBIENT}`]);

    const payload = join(checkout, 'screenshot-diffs');
    mkdirSync(payload);
    writeFileSync(join(payload, 'a-diff.png'), 'png');

    try {
      await run('screenshot-diffs/pr-1', payload, `${origin}/repo.git`, { cwd: checkout });
    } catch {
      // The server always returns 401, so the push itself fails. All that matters here
      // is the header it sent.
    }
    await new Promise(resolve => server.close(resolve));

    const expected = `Basic ${Buffer.from(`x-access-token:${TOKEN}`).toString('base64')}`;
    assert.ok(seen.includes(expected), 'authenticates with the token passed in');
    assert.ok(!seen.includes(AMBIENT), 'never sends the token checkout left behind');
  });

  it("replaces the branch with the directory's contents as a single commit", async () => {
    const remote = tmp('remote-');
    git(remote, ['init', '-q', '--bare', '.']);

    const first = tmp('first-');
    writeFileSync(join(first, 'a-diff.png'), 'one');
    await run('screenshot-diffs/pr-1', first, remote);

    const second = tmp('second-');
    writeFileSync(join(second, 'b-diff.png'), 'two');
    await run('screenshot-diffs/pr-1', second, remote);

    const files = git(remote, ['ls-tree', '-r', '--name-only', 'refs/heads/screenshot-diffs/pr-1']);
    assert.deepEqual(files.trim().split('\n'), ['b-diff.png']);
    assert.equal(git(remote, ['rev-list', '--count', 'refs/heads/screenshot-diffs/pr-1']).trim(), '1');
  });

  it('refuses to push from a directory that is already a repository', async () => {
    const remote = tmp('remote-');
    git(remote, ['init', '-q', '--bare', '.']);

    const dir = tmp('already-');
    git(dir, ['init', '-q', '.']);
    writeFileSync(join(dir, 'a-diff.png'), 'one');

    await assert.rejects(() => run('screenshot-diffs/pr-1', dir, remote));
    assert.throws(() => git(remote, ['rev-parse', 'refs/heads/screenshot-diffs/pr-1']));
  });
});
