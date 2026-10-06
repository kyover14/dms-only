/**
 * Documentation tests.
 *
 * The install path is documentation. There is no other interface: nobody
 * installs this app by reading the source, they install it by following
 * `docs/GET-IT-ON-YOUR-PHONE.md`. A relative link that points at a file which
 * moved is therefore a real failure — it strands the one person who has to get
 * through it — and it is exactly the kind of failure that is invisible in a
 * diff and painless in review.
 *
 * Only checks that can be decided with certainty are here. In particular this
 * does NOT validate `#anchor` links: doing that correctly means reimplementing
 * GitHub's heading-slug rules, and a slugger that is subtly wrong produces false
 * failures, which would be worse than not checking at all. File links are
 * unambiguous, so they are checked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every document a reader is expected to follow. */
const DOCS = [
  'README.md',
  'docs/INSTALL-iOS.md',
  'docs/GET-IT-ON-YOUR-PHONE.md'
];

/** `[text](target)` and `[text](target#anchor)`, but not images or bare URLs. */
function links(text) {
  const found = [];
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    found.push(target);
  }
  return found;
}

test('every relative link in the docs points at a file that exists', () => {
  for (const doc of DOCS) {
    const text = readFileSync(join(ROOT, doc), 'utf8');

    for (const target of links(text)) {
      // Strip the anchor: only the file part can be checked here.
      const [file] = target.split('#');
      if (!file) continue;

      const resolved = resolve(ROOT, dirname(doc), decodeURIComponent(file));
      assert.ok(
        existsSync(resolved),
        `${doc} links to "${target}", which does not exist (resolved to ${resolved})`
      );
    }
  }
});

test('the install path is reachable from the README', () => {
  // The point of the guide is that somebody finds it. If it is not linked from
  // where a reader starts, it may as well not exist.
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert.match(
    readme,
    /docs\/GET-IT-ON-YOUR-PHONE\.md/,
    'README.md no longer links the click-by-click install guide'
  );
  assert.match(
    readme,
    /docs\/INSTALL-iOS\.md/,
    'README.md no longer links the install reference'
  );
});

test('the guide says the things people actually get stuck on', () => {
  // Each of these cost a real support round trip at some point. A rewrite that
  // drops one of them would look fine and fail a person.
  const guide = readFileSync(join(ROOT, 'docs/GET-IT-ON-YOUR-PHONE.md'), 'utf8');

  const required = [
    ['the credential trap', /personal access token|\/settings\/tokens/],
    ['the empty-repository warning', /unticked|no README/i],
    ['Apple-verified iTunes/iCloud', /Microsoft Store/i],
    ['Developer Mode', /Developer Mode/],
    ['the free-account 7-day limit', /7 days/],
    ['that nothing exists to download yet', /nothing to download|does not exist until/i]
  ];

  for (const [what, pattern] of required) {
    assert.match(guide, pattern, `the install guide no longer explains ${what}`);
  }
});
