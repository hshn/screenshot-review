# screenshot-review

Review screenshot changes on a pull request. Baselines live on their own branch, not in
the working tree, so pull requests never serialize behind each other's baseline updates.

## How it works

- A push to the default branch captures a new generation of baselines onto a storage
  branch, named by the commit it was captured for.
- A pull request pulls the generation captured at its branch point and compares against
  it. When that generation is gone it falls back to the latest one and says so.
- A failed comparison pushes the screenshots to a side branch and writes them into the job
  summary, then writes a failing commit status.
- A human looks at them and adds a label. That flips the status to success. The status is
  per commit, so a new push silently drops the approval.

## Actions

| Action             | What it does                                                       |
| ------------------ | ------------------------------------------------------------------ |
| `run`              | Runs a command inside the official Playwright image                |
| `baseline-pull`    | Fetches one generation of baselines from the storage branch        |
| `baseline-publish` | Publishes one generation to the storage branch                     |
| `diff-report`      | Collects the screenshots needing review and writes the job summary |
| `review-status`    | Writes the commit status that gates the pull request               |

Every input has a default matching the layout described above. Nothing about your
repository — branch names, directories, labels, status names, package manager, script
names — is baked in.

## Permissions

Each action asks its caller for only what it does:

- `review-status` writes a commit status, so its job needs `statuses: write`.
- `baseline-publish` and `diff-report` push to a branch, so their jobs need
  `contents: write`.
- `baseline-pull` and `run` only read, so the job's default `contents: read` (from
  checkout) covers them.

Set these on the job, not on the step that calls into an action — a called action or
reusable workflow cannot grant itself more than its caller's job already has.

## Wiring them together

This is how the pieces above compose into one screenshot job. It pulls the baseline,
runs the comparison, and reports either a diff or a status depending on the outcome:

```yaml
jobs:
  screenshot:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      statuses: write
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0

      - name: Pull baseline
        id: baseline
        uses: ./tools/screenshot-review/baseline-pull

      - name: Run screenshot tests
        id: screenshot
        uses: ./tools/screenshot-review/run
        with:
          command: npx playwright test

      - name: Report diffs
        if: failure() && steps.screenshot.outcome == 'failure'
        uses: ./tools/screenshot-review/diff-report
        with:
          pr-number: ${{ github.event.pull_request.number }}
          github-token: ${{ github.token }}

      - name: Write status
        if: always()
        uses: ./tools/screenshot-review/review-status
        with:
          sha: ${{ github.event.pull_request.head.sha }}
          state: ${{ steps.screenshot.outcome == 'success' && 'success' || 'failure' }}
          note: ${{ steps.baseline.outputs.note }}
          github-token: ${{ github.token }}
```

The job grants `contents: write` so `diff-report`'s token can push the side branch it
needs. A token scoped separately (a GitHub App installation token, for instance) is the
tighter alternative to widening the whole job's permissions for one conditional step.

## Command line

`bin/cli.mjs` is the local equivalent of the actions above, exposed as the
`screenshot-review` bin. It runs the same scripts the actions call, so what passes
locally passes in CI:

```sh
screenshot-review baseline pull --base-branch develop
screenshot-review run --command "npx playwright test"
```

## Approval workflow

`.github/workflows/approval.yml` is a reusable workflow: a human adding the approval
label writes the success status, and a later push revokes it. It takes two inputs,
`label` (default `screenshot-approved`) and `status-context` (default
`Screenshot Review`, matched against `review-status`'s own `context` default), so
callers can rename either without editing the workflow.

It becomes callable with `uses:` only once this directory is the root of its own
repository — GitHub resolves reusable workflows solely from a repository's own
`.github/workflows`, and today's path (`tools/screenshot-review/.github/workflows/`)
is not that.

## Playwright config

The comparison is only as good as its threshold. Playwright's default `threshold` of 0.2
ignores anything under a 21% luminance change, which is enough to miss a panel being
rebuilt from empty to full when the surface and its border sit close in luminance.

```ts
export default defineConfig({
  // Baselines are not shared through the working tree; baseline-pull writes them here.
  snapshotPathTemplate: '.screenshot-baselines/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      threshold: 0.03,
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    },
  },
});
```

Capture and compare in the same rendering environment. Fonts differ enough between a
developer's machine and a Linux container to produce a difference on every screenshot,
which is why `run` goes through the Playwright image rather than the host.

## Working directory

`run`'s default image comes from the installed `@playwright/test` version, resolved via
Node's module resolution starting at `process.cwd()`. If the job's working directory
is not where the repository's `package.json` lives — a monorepo whose screenshot suite
sits in a subpackage, for instance — that resolution can find the wrong installation or
none at all. Pass `version:` or `image:` explicitly in that case instead of relying on
the default.

## Storage

`baseline-pull` and `baseline-publish` promise exactly one thing between them: a directory
of PNGs goes out and comes back. That the directory happens to travel on a branch is
inside the implementation.

Another backing store — snapshots committed in the tree, a workflow artifact, object
storage — belongs as a **separate pair of actions with the same inputs and outputs**, not
as a `storage` input on these. An input for a store nobody has built yet would be shaped
by guesswork, and would not fit whatever is actually needed later.

## Releasing

`.github/workflows/approval.yml` refers to this repository's own `review-status`
action. GitHub Actions does not allow expressions in `uses:`, so the ref is a
literal and does not follow the tag it is released under. Bump it by hand, in
this order:

1. Rewrite `review-status@<previous tag>` in `.github/workflows/approval.yml` to
   the new tag.
2. Bump `version` in `package.json`.
3. Commit.
4. Tag that commit.

Skipping step 1 leaves a silent version skew: a caller asking for
`approval.yml@v1.1.0` still runs the v1.0.0 action.
