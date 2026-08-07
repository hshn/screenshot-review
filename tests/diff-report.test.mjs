import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), '../scripts');
const collectScript = join(scriptsDir, 'diff-collect.sh');
const summaryScript = join(scriptsDir, 'diff-summary.sh');

// Playwright writes images into a subdirectory per test. Baselines sit flat.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'screenshot-report-'));
  const results = join(root, 'test-results');
  const baselines = join(root, 'baselines');
  const out = join(root, 'out');
  mkdirSync(results);
  mkdirSync(baselines);
  return { results, baselines, out };
}

function writeResult(results, testDir, file, content) {
  const dir = join(results, testDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), content);
}

function writeBaseline(baselines, file, content) {
  writeFileSync(join(baselines, file), content);
}

function collect({ results, baselines, out }) {
  const stdout = execFileSync('bash', [collectScript, results, baselines, out], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  const rows = stdout
    .split('\n')
    .filter(line => line !== '')
    .map(line => line.split('\t'));
  return { rows, files: readdirSync(out).sort() };
}

describe('diff-collect', () => {
  it('reports a screenshot that has a baseline as changed, alongside that baseline', () => {
    const f = fixture();
    writeResult(f.results, 'edit-chromium', 'resource-server-edit-actual.png', 'actual');
    writeResult(f.results, 'edit-chromium', 'resource-server-edit-diff.png', 'diff');
    writeBaseline(f.baselines, 'resource-server-edit.png', 'baseline');

    const { rows, files } = collect(f);

    assert.deepEqual(rows, [['changed', 'resource-server-edit', 'expected,actual,diff']]);
    assert.deepEqual(files, [
      'resource-server-edit-actual.png',
      'resource-server-edit-diff.png',
      'resource-server-edit-expected.png',
    ]);
    // Expected is the baseline image itself (not a copy from the test-results side)
    assert.equal(readFileSync(join(f.out, 'resource-server-edit-expected.png'), 'utf8'), 'baseline');
  });

  it('reports nothing when there are no images at all', () => {
    const f = fixture();

    const { rows, files } = collect(f);

    assert.deepEqual(rows, []);
    assert.deepEqual(files, []);
  });

  it('reports a screenshot with no baseline as added, with its actual image', () => {
    const f = fixture();
    // With no baseline, Playwright cannot compare and writes only the actual image.
    writeResult(f.results, 'grants-chromium', 'resource-server-grants-light-actual.png', 'new');

    const { rows, files } = collect(f);

    assert.deepEqual(rows, [['added', 'resource-server-grants-light', 'actual']]);
    assert.deepEqual(files, ['resource-server-grants-light-actual.png']);
  });

  it('reports a size mismatch as changed even though no diff image was produced', () => {
    const f = fixture();
    writeResult(f.results, 'edit-chromium', 'resource-server-edit-actual.png', 'actual');
    writeBaseline(f.baselines, 'resource-server-edit.png', 'baseline');

    const { rows, files } = collect(f);

    assert.deepEqual(rows, [['changed', 'resource-server-edit', 'expected,actual']]);
    assert.deepEqual(files, ['resource-server-edit-actual.png', 'resource-server-edit-expected.png']);
  });

  it('lists changed screenshots before added ones when both are present', () => {
    const f = fixture();
    writeResult(f.results, 'edit-chromium', 'resource-server-edit-actual.png', 'actual');
    writeResult(f.results, 'edit-chromium', 'resource-server-edit-diff.png', 'diff');
    writeBaseline(f.baselines, 'resource-server-edit.png', 'baseline');
    writeResult(f.results, 'grants-chromium', 'resource-server-grants-dark-actual.png', 'new-dark');
    writeResult(f.results, 'grants-chromium', 'resource-server-grants-light-actual.png', 'new-light');

    const { rows } = collect(f);

    assert.deepEqual(rows, [
      ['changed', 'resource-server-edit', 'expected,actual,diff'],
      ['added', 'resource-server-grants-dark', 'actual'],
      ['added', 'resource-server-grants-light', 'actual'],
    ]);
  });
});

const BASE_URL = 'https://example.test/raw/pr-1';

function summarize(classification) {
  return execFileSync('bash', [summaryScript, BASE_URL], {
    encoding: 'utf8',
    input: classification,
    timeout: 30_000,
  });
}

describe('diff-summary', () => {
  it('counts changed and added together and spells out the breakdown', () => {
    const markdown = summarize(
      'changed\tresource-server-edit\texpected,actual,diff\n' + 'added\tresource-server-grants-light\tactual\n'
    );

    assert.match(markdown, /^> \[!CAUTION\]$/m);
    assert.match(markdown, /^> 2 screenshot\(s\) need review: 1 changed, 1 added\.$/m);
  });

  it('leaves added out of the breakdown when there are none', () => {
    const markdown = summarize('changed\tresource-server-edit\texpected,actual,diff\n');

    assert.match(markdown, /^> 1 screenshot\(s\) need review: 1 changed\.$/m);
  });

  it('leaves changed out of the breakdown when there are none', () => {
    const markdown = summarize('added\tresource-server-grants-light\tactual\n');

    assert.match(markdown, /^> 1 screenshot\(s\) need review: 1 added\.$/m);
  });

  it('gives a changed screenshot three columns and an added one only its actual image', () => {
    const markdown = summarize(
      'changed\tresource-server-edit\texpected,actual,diff\n' + 'added\tresource-server-grants-light\tactual\n'
    );

    assert.match(markdown, /<summary><b>resource-server-edit<\/b> \(changed\)<\/summary>/);
    assert.match(markdown, /^\| Expected \| Actual \| Diff \|$/m);
    assert.match(
      markdown,
      /^\| !\[expected\]\(https:\/\/example\.test\/raw\/pr-1\/resource-server-edit-expected\.png\) \| !\[actual\]\(https:\/\/example\.test\/raw\/pr-1\/resource-server-edit-actual\.png\) \| !\[diff\]\(https:\/\/example\.test\/raw\/pr-1\/resource-server-edit-diff\.png\) \|$/m
    );

    assert.match(markdown, /<summary><b>resource-server-grants-light<\/b> \(added\)<\/summary>/);
    assert.match(markdown, /^\| Actual \|$/m);
    assert.match(
      markdown,
      /^\| !\[actual\]\(https:\/\/example\.test\/raw\/pr-1\/resource-server-grants-light-actual\.png\) \|$/m
    );
    // Nothing to compare against, so no link is built for an image that does not exist.
    assert.ok(!markdown.includes('resource-server-grants-light-expected.png'));
    assert.ok(!markdown.includes('resource-server-grants-light-diff.png'));
  });

  it('omits the diff column for a change that produced no diff image', () => {
    const markdown = summarize('changed\tresource-server-edit\texpected,actual\n');

    assert.match(markdown, /^\| Expected \| Actual \|$/m);
    assert.ok(!markdown.includes('resource-server-edit-diff.png'));
  });

  it('writes nothing when there is nothing to report', () => {
    assert.equal(summarize(''), '');
  });
});
