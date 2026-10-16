# Contributing

## Tests

```sh
node --run test
```

CI runs the same command on every pull request, with the Node version in
`.node-version`.

## Storage

`baseline-pull` and `baseline-publish` promise exactly one thing between them: a directory
of PNGs goes out and comes back. That the directory happens to travel on a branch is
inside the implementation.

Another backing store — snapshots committed in the tree, a workflow artifact, object
storage — belongs as a **separate pair of actions with the same inputs and outputs**, not
as a `storage` input on these. An input for a store nobody has built yet would be shaped
by guesswork, and would not fit whatever is actually needed later.

## Pull request titles

Pull requests are squash-merged, and the title becomes the commit on `main`. Write it as
a [Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/): the release
tooling reads these commits to pick the next version and to write the changelog.

- `fix` and `perf` bump the patch, `feat` the minor. `revert` also cuts a release.
- A breaking change (`feat!:`, or a `BREAKING CHANGE:` footer) bumps the major — the
  minor, while the version is below 1.0.0.
- `docs`, `ci`, `chore`, `test`, `refactor`, `build` and `style` cut no release on their
  own and stay out of the changelog.

## Releasing

Releases are cut by [release-please](https://github.com/googleapis/release-please).
Every push to `main` keeps a release pull request up to date; merging it tags the merge
commit and publishes the GitHub release.

Besides `version` in `package.json` and `CHANGELOG.md`, the release pull request rewrites
this repository's own refs to the new tag. GitHub Actions does not allow expressions in
`uses:`, so `.github/workflows/approval.yml` calls `review-status` by a literal ref that
does not follow the tag it is released under; without the rewrite, a caller asking for
`approval.yml@v0.3.0` would still run the previous release's action. The wiring example
in `README.md` is rewritten too, so a caller copying it gets the release, not the one
before.

release-please rewrites only the lines it is pointed at: a line ending in
`# x-release-please-version`, or lines between `x-release-please-start-version` and
`x-release-please-end`, in a file listed under `extra-files` in
`release-please-config.json`. A new self-reference outside those stays on the old tag
without a word, so mark it when adding it.

The workflow opens the release pull request as a GitHub App, because a pull request
opened with `GITHUB_TOKEN` triggers no workflows and CI would never run on it. The App
needs read and write access to contents, pull requests, issues (for the release labels),
and workflows (to rewrite `approval.yml`). Its client ID goes in the
`RELEASE_APP_CLIENT_ID` variable and its private key in the `RELEASE_APP_PRIVATE_KEY`
secret.
