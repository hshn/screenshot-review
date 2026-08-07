#!/usr/bin/env node
// Fetch one generation of baseline images from the branch that stores them. By default it
// takes the generation captured at this branch's merge-base with the base branch, so a
// pull request compares against what it actually diverged from. When that generation is
// gone it falls back to the latest one and says so on the way out.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync } from 'node:fs';

const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};

const BRANCH = flag('branch', 'screenshot-baselines');
const DEST = flag('dir', '.screenshot-baselines');
const REQUESTED_REF = flag('ref', undefined);
const BASE_BRANCH = flag('base-branch', undefined);
const LATEST = 'latest';
const REMOTE_REF = `refs/remotes/origin/${BRANCH}`;

if (!REQUESTED_REF && !BASE_BRANCH) {
  console.error('Pass --base-branch <name> to compare against its branch point, or --ref <sha|latest>.');
  process.exit(1);
}

const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();

const tryGit = args => {
  try {
    return { ok: true, out: git(args) };
  } catch {
    return { ok: false, out: '' };
  }
};

// Tell "the branch is not there" (exit code 2) apart from "could not find out". Either
// way this exits 0 leaving an empty directory — Playwright then fails red on the missing
// baselines, which is the louder and more accurate report.
const lsRemoteStatus = () => {
  try {
    execFileSync('git', ['ls-remote', '--exit-code', '--heads', 'origin', BRANCH], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    return 0;
  } catch (err) {
    return err.status ?? 1;
  }
};

const finish = (sha, note) => {
  console.log(sha ? `Baselines: ${sha}${note ? ` — ${note}` : ''}` : `Baselines: none — ${note}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha ?? ''}\nnote=${note ?? ''}\n`);
  }
};

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

let requested = REQUESTED_REF;
if (!requested) {
  git(['fetch', '--no-tags', 'origin', BASE_BRANCH]);
  requested = git(['merge-base', git(['rev-parse', 'FETCH_HEAD']), 'HEAD']);
}

const status = lsRemoteStatus();
if (status !== 0) {
  const note = status === 2 ? `no ${BRANCH} branch yet` : `could not tell whether the ${BRANCH} branch exists`;
  finish(null, note);
  process.exit(0);
}

if (!tryGit(['fetch', '--no-tags', 'origin', `+refs/heads/${BRANCH}:${REMOTE_REF}`]).ok) {
  finish(null, `could not fetch the ${BRANCH} branch`);
  process.exit(0);
}

const hasGeneration = ref => {
  const found = tryGit(['ls-tree', '--name-only', REMOTE_REF, `${ref}/`]);
  return found.ok && found.out !== '';
};

let sha = requested !== LATEST && hasGeneration(requested) ? requested : null;
let note = null;

if (!sha) {
  const latest = tryGit(['show', `${REMOTE_REF}:${LATEST}`]);
  if (!latest.ok || latest.out === '') {
    finish(
      null,
      requested === LATEST
        ? 'no latest baseline found'
        : `neither the branch point ${requested.slice(0, 8)} nor latest has baselines`
    );
    process.exit(0);
  }
  sha = latest.out;

  if (!hasGeneration(sha)) {
    finish(null, 'no baselines found');
    process.exit(0);
  }

  if (requested !== LATEST) {
    note = `branch point ${requested.slice(0, 8)} has no baselines, using latest ${sha.slice(0, 8)}`;
  }
}

execFileSync(
  'bash',
  ['-c', `set -o pipefail; git archive ${REMOTE_REF} ${sha} | tar -x --strip-components=1 -C ${DEST}`],
  { stdio: 'inherit' }
);
finish(sha, note);
