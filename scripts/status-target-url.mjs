#!/usr/bin/env node
// Print where the commit status with the given context currently links to, so a status
// written over it can keep pointing at the same place. Prints nothing when no status with
// that context exists yet. A failed lookup is a failure — answering "nothing" would let the
// caller write a link that points at the wrong place.
import { execFileSync } from 'node:child_process';

const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};

const SHA = flag('sha', undefined);
const CONTEXT = flag('context', undefined);
const REPOSITORY = flag('repo', process.env.GITHUB_REPOSITORY);

if (!SHA || !CONTEXT || !REPOSITORY) {
  console.error('Pass --sha <sha> --context <name>, and --repo <owner/name> unless GITHUB_REPOSITORY is set.');
  process.exit(1);
}

// The combined status carries the latest status per context, which is exactly what the
// pull request page shows. One page holds up to 100 contexts.
const combined = JSON.parse(
  execFileSync('gh', ['api', `repos/${REPOSITORY}/commits/${SHA}/status?per_page=100`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
);

const current = combined.statuses.find(status => status.context === CONTEXT);
if (current?.target_url) {
  console.log(current.target_url);
}
