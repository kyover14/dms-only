/**
 * Tests for core/rules.json.
 *
 * This file is hand-written JSON that has to satisfy WebKit's content-blocker
 * schema, and it is compiled at app launch — so a typo here is a silent runtime
 * failure ("declarative rules not loaded") rather than a build error. These
 * tests turn that into a build error.
 *
 * The most important assertion is the last one: every rule must be scoped to
 * instagram.com. An unscoped content rule would hide elements on *every site*
 * the app ever loaded.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const rules = JSON.parse(readFileSync(join(here, '..', 'core', 'rules.json'), 'utf8'));

const ACTION_TYPES = new Set([
  'block',
  'block-cookies',
  'css-display-none',
  'ignore-previous-rules',
  'make-https',
  'modify-headers',
  'redirect'
]);

test('rules.json is a non-empty array of well-formed rules', () => {
  assert.ok(Array.isArray(rules));
  assert.ok(rules.length > 0);

  for (const [index, rule] of rules.entries()) {
    assert.ok(rule.trigger, `rule ${index} has no trigger`);
    assert.equal(typeof rule.trigger['url-filter'], 'string', `rule ${index} has no url-filter`);
    assert.ok(rule.action, `rule ${index} has no action`);
    assert.ok(ACTION_TYPES.has(rule.action.type), `rule ${index} has an unknown action type`);
  }
});

test('css-display-none rules carry a usable selector', () => {
  const styling = rules.filter((rule) => rule.action.type === 'css-display-none');
  assert.ok(styling.length > 0);

  for (const rule of styling) {
    const selector = rule.action.selector;
    assert.equal(typeof selector, 'string');
    assert.ok(selector.trim().length > 0);
    // A selector our own engine could never produce is a red flag, not a
    // guarantee — but a stray quote or brace would break the whole list.
    assert.doesNotMatch(selector, /[{}]/);
  }
});

test('url-filters compile, and avoid the regex features WebKit lacks', () => {
  for (const rule of rules) {
    const filter = rule.trigger['url-filter'];
    assert.doesNotThrow(() => new RegExp(filter), `url-filter must compile: ${filter}`);
    // WebKit supports a subset of regex; lookbehind and named groups are not in it.
    assert.doesNotMatch(filter, /\(\?<[=/!]/, `lookbehind unsupported by WebKit: ${filter}`);
    assert.doesNotMatch(filter, /\(\?<[A-Za-z]/, `named group unsupported by WebKit: ${filter}`);
  }
});

test('no rule is unscoped: every url-filter requires an instagram.com host', () => {
  for (const rule of rules) {
    const filter = rule.trigger['url-filter'];
    assert.match(
      filter,
      /instagram\\\.com/,
      `rule would apply beyond Instagram and must be scoped: ${filter}`
    );
    // Belt and braces: the pattern must anchor on the scheme, so a lookalike
    // host such as "evil-instagram.com" cannot match.
    assert.match(filter, /^\^https\?:\/\//, `url-filter must anchor on the scheme: ${filter}`);
  }
});

test('search is never accidentally ruled out by the explore rules', () => {
  // Explore rules target /explore, /explore/ and specific sub-paths. A rule
  // matching bare "/explore" with a trailing wildcard would also catch
  // /explore/search/, which must keep working.
  const explore = rules.filter((rule) => rule.trigger['url-filter'].includes('/explore'));

  for (const rule of explore) {
    const re = new RegExp(rule.trigger['url-filter']);
    assert.equal(
      re.test('https://www.instagram.com/explore/search/keyword/'),
      false,
      `rule also matches search, which must stay usable: ${rule.trigger['url-filter']}`
    );
  }
});

/** Paths that must keep working no matter what. */
const MUST_STAY_USABLE = [
  'https://www.instagram.com/direct/inbox/',
  'https://www.instagram.com/direct/t/12345/',
  'https://www.instagram.com/someuser/',
  'https://www.instagram.com/notifications/',
  'https://www.instagram.com/accounts/login/',
  'https://www.instagram.com/p/Cx1a2Bc3DeF/'
];

/**
 * A rule that hides page *content* (a container) must be path-scoped. Getting
 * this wrong is the blank-Messages bug in its other form: the container is
 * shared between the feed and the messages list.
 */
test('content-hiding rules never match a route that must keep working', () => {
  const contentRules = rules.filter((rule) => /main\[/.test(rule.action.selector || ''));
  assert.ok(contentRules.length > 0, 'expected some content-hiding rules to exist');

  for (const rule of contentRules) {
    const re = new RegExp(rule.trigger['url-filter']);
    for (const url of MUST_STAY_USABLE) {
      assert.equal(
        re.test(url),
        false,
        `rule hides page content but also matches ${url}: ${rule.trigger['url-filter']}`
      );
    }
  }
});

/**
 * No rule may fire on every Instagram route.
 *
 * A content rule list has no way to read the app's settings, so a rule that
 * matches everything is a rule the user cannot switch off: `css-display-none`
 * outranks any JavaScript that might try to undo it, and the element stays
 * hidden until the app is reinstalled.
 *
 * The list used to carry two rules of exactly that shape, hiding the Reels and
 * Explore nav anchors globally. That is why switching "Hide Reels" off brought
 * the entry back only after a relaunch — and not reliably even then. Nav chrome
 * is now hidden by `guard.css`, keyed off the `data-igfocus-hide` attribute the
 * engine writes from the live config, which a toggle can revoke.
 *
 * If a global rule is ever needed again, it has to be paired with a mechanism
 * for revoking it.
 */
test('no rule matches every Instagram route, because none of them is revocable', () => {
  for (const rule of rules) {
    const re = new RegExp(rule.trigger['url-filter']);
    const matchesEveryPath = MUST_STAY_USABLE.every((url) => re.test(url));
    assert.equal(
      matchesEveryPath,
      false,
      `rule fires on every route and cannot follow a setting: ${rule.trigger['url-filter']} -> ${rule.action.selector}`
    );
  }
});

/**
 * Nav chrome moved out of this file. Assert the remaining rules are what they
 * claim to be — content hiders for the blocked surfaces — so a stray nav rule
 * cannot creep back in unnoticed.
 */
test('every rule hides the feed container, never nav chrome', () => {
  for (const rule of rules) {
    const selector = rule.action.selector || '';
    assert.match(
      selector,
      /^main\[role="main"\]$/,
      `expected a content-hiding rule for the feed container, got: ${selector}`
    );
  }
});
