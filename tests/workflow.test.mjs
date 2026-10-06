/**
 * Workflow tests.
 *
 * `.github/workflows/ios-build.yml` is the ONLY place the iOS app is ever
 * compiled, and it is compiled on a machine nobody here can reach: the app is
 * developed on Windows, built on a macOS runner, and installed by hand on a
 * phone. A YAML typo or a shell syntax error in that file costs a full CI round
 * trip to discover, and it fails in the job whose failure is least informative —
 * `xcodebuild` never even runs.
 *
 * So it gets checked here, in the fast job, before any of that. What is checked
 * is deliberately narrow, because a hand-rolled YAML parser is a liability: a
 * checker that is wrong is worse than no checker. Every rule below is one this
 * file can decide with certainty, and all of them have bitten real workflows.
 *
 *   1. Tabs (illegal in YAML) and odd indentation.
 *   2. Block-scalar bodies that are not indented deeper than the key they
 *      belong to — the classic silent "this is now a new key" failure.
 *   3. `bash -n` over every `run:` block. This proves the shell syntax without
 *      needing any of the tools those lines invoke to exist.
 *   4. The shape Actions requires: every job has `runs-on` and `steps`, and
 *      every `needs:` names a job that exists.
 *   5. Every step does exactly one of `uses:` / `run:`, and every `uses:` is
 *      pinned to a version.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = join(ROOT, '.github', 'workflows', 'ios-build.yml');

const lines = readFileSync(WORKFLOW, 'utf8').split('\n');

const indentOf = (text) => text.length - text.trimStart().length;

/** Lines that carry meaning: everything that is not blank or a full comment. */
const significant = lines
  .map((text, index) => ({ text, number: index + 1 }))
  .filter((line) => line.text.trim() !== '' && !line.text.trim().startsWith('#'));

/** A `key:` / `key: value` / `key: |` line. Does not match list items. */
function mappingKey(text) {
  const match = text.match(/^(\s*)([A-Za-z_][\w .-]*):(\s.*|)$/);
  if (!match) return null;
  return { indent: match[1].length, key: match[2], rest: match[3].trim() };
}

/** `- ` list items, with the text of everything that belongs to that item. */
function listItems() {
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].match(/^(\s*)- (\S.*)$/);
    if (!header) continue;

    const indent = header[1].length;
    const body = [header[2]];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const text = lines[j];
      if (text.trim() === '') {
        body.push('');
        continue;
      }
      if (indentOf(text) <= indent) break;
      body.push(text);
    }
    items.push({ line: i + 1, indent, text: body.join('\n') });
    i = j - 1;
  }
  return items;
}

test('the workflow has no tabs and its indentation is even', () => {
  for (const line of lines) {
    assert.equal(
      line.includes('\t'),
      false,
      `line ${lines.indexOf(line) + 1} contains a tab; YAML forbids tabs for indentation`
    );
  }
  for (const line of significant) {
    assert.equal(
      indentOf(line.text) % 2,
      0,
      `line ${line.number} is indented by an odd number of spaces, so it will not nest predictably`
    );
  }
});

test('block scalars are indented deeper than the key that opens them', () => {
  let openBlock = null;

  for (const line of significant) {
    const indent = indentOf(line.text);

    // A line at or above the key's own indent ends the block.
    if (openBlock && indent <= openBlock.indent) openBlock = null;

    if (openBlock) {
      assert.ok(
        indent > openBlock.indent,
        `line ${line.number} continues the block scalar opened on line ${openBlock.number}, ` +
          `but is not indented deeper than its key — YAML reads that as a new key`
      );
      continue;
    }

    const key = mappingKey(line.text);
    if (key && /^[|>][-+]?$/.test(key.rest)) {
      openBlock = { indent: key.indent, number: line.number };
    }
  }
});

/** Every `run:` block, with its own indentation stripped back off. */
function runBlocks() {
  const blocks = [];

  for (let i = 0; i < lines.length; i++) {
    const key = mappingKey(lines[i]);
    if (!key || key.key !== 'run' || !/^[|>][-+]?$/.test(key.rest)) continue;

    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const text = lines[j];
      if (text.trim() === '') {
        body.push('');
        continue;
      }
      if (indentOf(text) <= key.indent) break;
      body.push(text);
    }

    const indents = body.filter((text) => text.trim() !== '').map(indentOf);
    const common = indents.length ? Math.min(...indents) : 0;
    blocks.push({ line: i + 1, script: body.map((text) => text.slice(common)).join('\n') });
    i = j - 1;
  }

  return blocks;
}

function haveBash() {
  try {
    execFileSync('bash', ['-c', 'true'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('every run block is valid shell', () => {
  const blocks = runBlocks();
  assert.ok(blocks.length > 0, 'expected at least one run: block');

  if (!haveBash()) {
    console.log('      bash not available here; skipping the shell syntax check');
    return;
  }

  for (const block of blocks) {
    try {
      // -n parses without executing, so this needs none of the tools to exist.
      execFileSync('bash', ['-n'], { input: block.script, stdio: ['pipe', 'ignore', 'pipe'] });
    } catch (err) {
      assert.fail(
        `the run: block starting on line ${block.line} is not valid shell:\n` +
          `${err.stderr?.toString() || err.message}\n---\n${block.script}\n---`
      );
    }
  }
});

/** The names of the jobs declared under `jobs:`, in order. */
function jobNames() {
  const start = lines.findIndex((text) => /^jobs:\s*$/.test(text));
  assert.notEqual(start, -1, 'the workflow has no top-level jobs: section');

  const names = [];
  for (let i = start + 1; i < lines.length; i++) {
    const key = mappingKey(lines[i]);
    if (key && key.indent === 2) names.push({ name: key.key, line: i });
  }
  assert.ok(names.length > 0, 'no jobs found under jobs:');
  return names;
}

test('every job declares a runner and a non-empty steps list', () => {
  for (const [index, job] of jobNames().entries()) {
    const next = jobNames()[index + 1];
    const text = lines.slice(job.line + 1, next ? next.line : lines.length).join('\n');

    assert.match(text, /\n\s{4}runs-on: \S/, `job ${job.name} has no runs-on`);
    assert.match(text, /\n\s{4}steps:\s*\n/, `job ${job.name} has no steps:`);
    assert.match(text, /\n\s{6}- /, `job ${job.name} lists no steps`);
  }
});

test('every needs: names a job that exists', () => {
  const names = jobNames().map((job) => job.name);
  for (const [index, job] of jobNames().entries()) {
    const next = jobNames()[index + 1];
    const text = lines.slice(job.line + 1, next ? next.line : lines.length).join('\n');
    for (const match of text.matchAll(/\n\s{4}needs: ([\w-]+)/g)) {
      assert.ok(
        names.includes(match[1]),
        `job ${job.name} needs "${match[1]}", which is not one of: ${names.join(', ')}`
      );
    }
  }
});

test('the iOS build does not depend on the browser-binary job', () => {
  // The webkit job downloads browser binaries, which is the most likely thing
  // in this file to flake. If the .ipa ever depended on it, a Playwright outage
  // would stop the app from being built — a strange way to lose.
  const names = jobNames();
  const ios = names.find((job) => job.name === 'ios');
  assert.ok(ios, 'expected an ios job');

  const next = names[names.indexOf(ios) + 1];
  const text = lines.slice(ios.line + 1, next ? next.line : lines.length).join('\n');
  const needs = text.match(/\n\s{4}needs: ([\w-]+)/);
  if (needs) {
    assert.equal(needs[1], 'core', `the iOS job must not depend on ${needs[1]}`);
  }
});

test('every step does one thing, and every action is pinned to a version', () => {
  const steps = listItems().filter((item) => item.indent >= 6);
  assert.ok(steps.length > 0, 'no steps found');

  for (const step of steps) {
    const hasRun = /\n\s*run:/.test('\n' + step.text);
    const uses = step.text.match(/uses: *(\S+)/);

    assert.ok(
      hasRun !== Boolean(uses),
      `the step on line ${step.line} must have exactly one of run: / uses:, ` +
        `and has ${[hasRun && 'run', uses && 'uses'].filter(Boolean).join(' + ')}`
    );

    if (uses) {
      assert.match(
        uses[1],
        /@v?\d/,
        `the action on line ${step.line} is not pinned to a version: ${uses[1]}`
      );
    }
  }
});
