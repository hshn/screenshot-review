#!/usr/bin/env node
// Fetch one generation of baseline images from the branch that stores them. By default it
// takes the generation captured at this branch's merge-base with the base branch, so a
// pull request compares against what it actually diverged from. When that generation is
// missing but newer than latest, its capture is most likely still running on the base
// branch, so it waits for it — up to --wait-timeout seconds. Otherwise, or when the wait
// runs out, it takes the generation of the nearest ancestor that has one, and only when no
// ancestor has one falls back to the latest generation — saying so on the way out.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
const PULLED_RECORD = '.pulled';

if (!REQUESTED_REF && !BASE_BRANCH) {
  console.error('Pass --base-branch <name> to compare against its branch point, or --ref <sha|latest>.');
  process.exit(1);
}

const seconds = (name, fallback, { allowZero }) => {
  const raw = flag(name, fallback);
  const value = Number(raw);
  if (raw === '' || !Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    console.error(`--${name} takes a number of seconds${allowZero ? '' : ' above zero'}, got "${raw}".`);
    process.exit(1);
  }
  return value;
};

const WAIT_TIMEOUT = seconds('wait-timeout', '600', { allowZero: true });
const WAIT_INTERVAL = seconds('wait-interval', '10', { allowZero: false });

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

// Playwright's default updateSnapshots 'missing' writes the actual image into this
// directory when a baseline is missing, so after the run a file here no longer proves it
// was a baseline. Record what was actually pulled — an empty record included — for the
// report to classify against.
const recordPulled = () => {
  const files = readdirSync(DEST).sort();
  writeFileSync(join(DEST, PULLED_RECORD), files.map(file => `${file}\n`).join(''));
};

const finish = (sha, note) => {
  recordPulled();
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

const fetchStorage = () => tryGit(['fetch', '--no-tags', 'origin', `+refs/heads/${BRANCH}:${REMOTE_REF}`]).ok;

if (!fetchStorage()) {
  finish(null, `could not fetch the ${BRANCH} branch`);
  process.exit(0);
}

const hasGeneration = ref => {
  const found = tryGit(['ls-tree', '--name-only', REMOTE_REF, `${ref}/`]);
  return found.ok && found.out !== '';
};

// Candidates come from the storage branch rather than from listing the commit's history:
// they are bounded by KEEP, while the history of a large repository is not. A generation
// whose commit is not in this repository fails the ancestry check and drops out.
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const nearestAncestorGeneration = commit => {
  const generations = tryGit(['ls-tree', '-d', '--name-only', REMOTE_REF]);
  if (!generations.ok) return null;
  const distances = generations.out
    .split('\n')
    .filter(gen => COMMIT_SHA.test(gen) && tryGit(['merge-base', '--is-ancestor', gen, commit]).ok)
    .map(gen => ({ gen, distance: Number(git(['rev-list', '--count', `${gen}..${commit}`])) }));
  if (distances.length === 0) return null;
  return distances.reduce((nearest, candidate) => (candidate.distance < nearest.distance ? candidate : nearest)).gen;
};

const latestPointer = () => {
  const latest = tryGit(['show', `${REMOTE_REF}:${LATEST}`]);
  return latest.ok && latest.out !== '' ? latest.out : null;
};

// The base branch captures a generation after each of its commits lands, so a base-branch
// commit newer than latest is one whose capture has most likely not finished yet. One that
// latest already descends from, or that shares no line with it, will not get a generation
// by waiting. Only the branch point is known to be a base-branch commit; a --ref may not be.
const captureInProgress = commit => {
  const latest = latestPointer();
  return latest !== null && latest !== commit && tryGit(['merge-base', '--is-ancestor', latest, commit]).ok;
};

const sleep = s => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, s * 1000);

const FOUND = 'found';
const SUPERSEDED = 'superseded';
const TIMED_OUT = 'timed out';

const waitForGeneration = commit => {
  console.log(`Waiting up to ${WAIT_TIMEOUT}s for the baselines of branch point ${commit.slice(0, 8)}`);
  const deadline = Date.now() + WAIT_TIMEOUT * 1000;
  for (let remaining = WAIT_TIMEOUT; remaining > 0; remaining = (deadline - Date.now()) / 1000) {
    sleep(Math.min(WAIT_INTERVAL, remaining));
    if (!fetchStorage()) continue;
    if (hasGeneration(commit)) return FOUND;
    if (!captureInProgress(commit)) return SUPERSEDED;
  }
  return TIMED_OUT;
};

let sha = requested !== LATEST && hasGeneration(requested) ? requested : null;
let note = null;
let missing = 'has no baselines';

if (!sha && !REQUESTED_REF && WAIT_TIMEOUT > 0 && captureInProgress(requested)) {
  const waited = waitForGeneration(requested);
  if (waited === FOUND) sha = requested;
  if (waited === TIMED_OUT) missing = `has no baselines after waiting ${WAIT_TIMEOUT}s`;
}

if (!sha && requested !== LATEST) {
  const ancestor = nearestAncestorGeneration(requested);
  if (ancestor) {
    sha = ancestor;
    note = `branch point ${requested.slice(0, 8)} ${missing}, using its nearest ancestor ${ancestor.slice(0, 8)}`;
  }
}

if (!sha) {
  const latest = latestPointer();
  if (latest === null) {
    finish(
      null,
      requested === LATEST
        ? 'no latest baseline found'
        : `neither the branch point ${requested.slice(0, 8)} nor latest has baselines`
    );
    process.exit(0);
  }
  sha = latest;

  if (!hasGeneration(sha)) {
    finish(null, 'no baselines found');
    process.exit(0);
  }

  if (requested !== LATEST) {
    note = `branch point ${requested.slice(0, 8)} ${missing}, using latest ${sha.slice(0, 8)}`;
  }
}

execFileSync(
  'bash',
  ['-c', `set -o pipefail; git archive ${REMOTE_REF} ${sha} | tar -x --strip-components=1 -C ${DEST}`],
  { stdio: 'inherit' }
);
finish(sha, note);
