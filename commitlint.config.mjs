export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // A scope names what a caller uses: an action, the approval workflow, or the CLI. The
    // nature of the change is the type's job (`ci:`, not `fix(ci):`).
    'scope-enum': [
      2,
      'always',
      [
        'baseline-publish',
        'baseline-pull',
        'diff-report',
        'review-status',
        'run',
        'approval',
        'cli',
        'deps',
      ],
    ],
    'header-max-length': [2, 'always', 72],
  },
};
