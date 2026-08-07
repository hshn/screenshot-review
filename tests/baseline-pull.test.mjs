import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '../scripts/baseline-pull.mjs');

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'tester',
  GIT_AUTHOR_EMAIL: 'tester@example.test',
  GIT_COMMITTER_NAME: 'tester',
  GIT_COMMITTER_EMAIL: 'tester@example.test',
};

const git = (cwd, args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', timeout: 30_000 }).trim();

const tmp = prefix => mkdtempSync(join(tmpdir(), prefix));

// A bare repository standing in for origin, with a base branch and a clone to work in.
function repository() {
  const origin = tmp('origin-');
  git(origin, ['init', '-q', '--bare', '-b', 'main', '.']);

  const seed = tmp('seed-');
  git(seed, ['init', '-q', '-b', 'main', '.']);
  writeFileSync(join(seed, 'README.md'), 'base');
  git(seed, ['add', '-A']);
  git(seed, ['commit', '-q', '-m', 'base']);
  git(seed, ['push', '-q', origin, 'main']);
  const baseSha = git(seed, ['rev-parse', 'HEAD']);

  const work = tmp('work-');
  git(work, ['clone', '-q', origin, '.']);
  return { origin, work, baseSha };
}

// The storage branch's layout: <sha>/<name>.png, plus "latest" and "manifest". Omit
// "latest" to reproduce a storage branch that was never given a latest pointer.
function publish(origin, { generations, latest, branch = 'screenshot-baselines' }) {
  const store = tmp('store-');
  git(store, ['init', '-q', '-b', branch, '.']);
  for (const sha of generations) {
    mkdirSync(join(store, sha));
    writeFileSync(join(store, sha, 'home.png'), `png for ${sha}`);
  }
  if (latest !== undefined) {
    writeFileSync(join(store, 'latest'), `${latest}\n`);
  }
  writeFileSync(join(store, 'manifest'), `${generations.join('\n')}\n`);
  git(store, ['add', '-A']);
  git(store, ['commit', '-q', '-m', 'baselines']);
  git(store, ['push', '-q', origin, branch]);
}

function pull(cwd, args) {
  const outputFile = join(tmp('gho-'), 'out');
  writeFileSync(outputFile, '');
  const result = spawnSync('node', [script, ...args], {
    cwd,
    env: { ...env, GITHUB_OUTPUT: outputFile },
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return Object.fromEntries(
    readFileSync(outputFile, 'utf8')
      .split('\n')
      .filter(line => line !== '')
      .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
  );
}

const OTHER = 'f'.repeat(40);

describe('baseline-pull', () => {
  it('takes the generation captured at the branch point', () => {
    const { origin, work, baseSha } = repository();
    publish(origin, { generations: [baseSha, OTHER], latest: OTHER });

    const outputs = pull(work, ['--base-branch', 'main']);

    assert.equal(outputs.sha, baseSha);
    assert.equal(outputs.note, '');
    assert.deepEqual(readdirSync(join(work, '.screenshot-baselines')), ['home.png']);
    assert.equal(readFileSync(join(work, '.screenshot-baselines', 'home.png'), 'utf8'), `png for ${baseSha}`);
  });

  it('falls back to the latest generation and says so when the branch point has none', () => {
    const { origin, work } = repository();
    publish(origin, { generations: [OTHER], latest: OTHER });

    const outputs = pull(work, ['--base-branch', 'main']);

    assert.equal(outputs.sha, OTHER);
    assert.match(outputs.note, /latest/);
    assert.equal(readFileSync(join(work, '.screenshot-baselines', 'home.png'), 'utf8'), `png for ${OTHER}`);
  });

  it('takes the latest generation without consulting the branch point when asked for it', () => {
    const { origin, work, baseSha } = repository();
    publish(origin, { generations: [baseSha, OTHER], latest: OTHER });

    const outputs = pull(work, ['--ref', 'latest']);

    assert.equal(outputs.sha, OTHER);
    assert.equal(outputs.note, '');
  });

  it('leaves an empty directory and reports why when the storage branch does not exist', () => {
    const { work } = repository();

    const outputs = pull(work, ['--base-branch', 'main']);

    assert.equal(outputs.sha, '');
    assert.match(outputs.note, /screenshot-baselines/);
    assert.deepEqual(readdirSync(join(work, '.screenshot-baselines')), []);
  });

  it('honours a storage branch and a destination given from outside', () => {
    const { origin, work, baseSha } = repository();
    publish(origin, { generations: [baseSha], latest: baseSha, branch: 'goldens' });

    const outputs = pull(work, ['--base-branch', 'main', '--branch', 'goldens', '--dir', '.goldens']);

    assert.equal(outputs.sha, baseSha);
    assert.deepEqual(readdirSync(join(work, '.goldens')), ['home.png']);
  });

  it('reports both missing when the storage branch has no latest pointer and the branch point has no generation', () => {
    const { origin, work, baseSha } = repository();
    publish(origin, { generations: [] });

    const outputs = pull(work, ['--base-branch', 'main']);

    assert.equal(outputs.sha, '');
    assert.equal(outputs.note, `neither the branch point ${baseSha.slice(0, 8)} nor latest has baselines`);
    assert.deepEqual(readdirSync(join(work, '.screenshot-baselines')), []);
  });

  it('reports no baselines found when latest points at a generation with no files', () => {
    const { origin, work } = repository();
    publish(origin, { generations: [], latest: OTHER });

    const outputs = pull(work, ['--base-branch', 'main']);

    assert.equal(outputs.sha, '');
    assert.equal(outputs.note, 'no baselines found');
    assert.deepEqual(readdirSync(join(work, '.screenshot-baselines')), []);
  });
});
