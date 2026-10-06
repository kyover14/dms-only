/**
 * Route policy tests.
 *
 * These run in plain Node (`npm test`) so the blocking rules can be verified
 * from Windows, with no simulator and no network. `core/*.js` are CommonJS, so
 * the default import is the module's exports object.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import routes from '../core/routes.js';

const { classifyRoute, normalizePath, isSafeLandingPath, BLOCKED_PATTERNS, segments } = routes;

const ALL_ON = {};

test('normalizePath canonicalises URLs, queries, hashes and stray slashes', () => {
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath(''), '/');
  assert.equal(normalizePath(undefined), '/');
  assert.equal(normalizePath('reels'), '/reels');
  assert.equal(normalizePath('//reels//'), '/reels/');
  assert.equal(normalizePath('/?hl=en'), '/');
  assert.equal(normalizePath('/#'), '/');
  assert.equal(normalizePath('/reels/#top'), '/reels/');
  assert.equal(normalizePath('https://www.instagram.com/'), '/');
  assert.equal(normalizePath('https://www.instagram.com/?hl=en'), '/');
  assert.equal(normalizePath('https://www.instagram.com'), '/');
  assert.equal(normalizePath('https://www.instagram.com/reels/'), '/reels/');
  assert.equal(normalizePath('https://instagram.com/direct/inbox/?x=1'), '/direct/inbox/');
});

test('segments splits a normalised path', () => {
  assert.deepEqual(segments('/direct/inbox/'), ['direct', 'inbox']);
  assert.deepEqual(segments('/'), []);
});

test('blocked routes are blocked', () => {
  const blocked = [
    '/',
    '/?hl=en',
    '',
    'https://www.instagram.com/',
    '/reels/',
    '/reels',
    '/reels/audio/12345/',
    '/reel/Cx1a2Bc3DeF/',
    '/explore',
    '/explore/',
    '/explore/tags/cats/',
    '/explore/locations/newyork/',
    '/explore/people/',
    '/explore/search/',
    '/explore/search/keyword/?q=cats',
    '/someuser/reels/',
    '/someuser/reels',
    '/someuser/reels/audio/99/'
  ];
  for (const path of blocked) {
    const result = classifyRoute(path, ALL_ON);
    assert.equal(result.blocked, true, `expected ${path} to be blocked (got ${result.reason})`);
  }
});

test('messages, profiles and the rest of the useful app stay allowed', () => {
  const allowed = [
    '/direct/',
    '/direct/inbox/',
    '/direct/t/340282366841710300949128283905910783999/',
    '/notifications/',
    '/someuser/',
    '/someuser/tagged/',
    '/p/Cx1a2Bc3DeF/',
    '/stories/someuser/3300000000000000000/',
    '/accounts/login/',
    '/accounts/emailsignup/',
    '/accounts/password/reset/',
    '/challenge/',
    '/legal/terms/',
    '/about/',
    '/nametag/'
  ];
  for (const path of allowed) {
    const result = classifyRoute(path, ALL_ON);
    assert.equal(result.blocked, false, `expected ${path} to be allowed (kind=${result.kind})`);
  }
});

test('search is blocked by default, and reported under its own rule', () => {
  for (const path of ['/explore/search/', '/explore/search/keyword/?q=cats', '/explore/search/topsearch/']) {
    const result = classifyRoute(path, ALL_ON);
    assert.equal(result.blocked, true, `expected ${path} to be blocked`);
    assert.equal(result.kind, 'search', `${path} should be reported as the search rule`);
    assert.equal(result.reason, 'blockSearch');
  }
});

test('turning search off hands it back whole, not to the explore rule', () => {
  // This is the subtle one, and the reason the search rule is listed first.
  // `classifyRoute` returns on the first PATTERN match even when that rule's
  // toggle is off, so the explore rule never gets a look at /explore/search/.
  // Get the order wrong and turning search off would leave it blocked anyway.
  const cfg = { blockSearch: false };
  for (const path of ['/explore/search/', '/explore/search/keyword/?q=cats']) {
    const result = classifyRoute(path, cfg);
    assert.equal(result.blocked, false, `expected ${path} to be allowed`);
    assert.equal(result.reason, 'blockSearch-disabled', 'the match is still reported');
    assert.equal(result.kind, 'search', 'and it is still the search rule, not explore');
  }

  // Explore itself, and everything else under it, stays blocked.
  assert.equal(classifyRoute('/explore/', cfg).blocked, true);
  assert.equal(classifyRoute('/explore/tags/cats/', cfg).blocked, true);
  assert.equal(classifyRoute('/', cfg).blocked, true);

  // And the two toggles are genuinely independent.
  assert.equal(classifyRoute('/explore/search/', { blockExplore: false }).blocked, true);
  assert.equal(
    classifyRoute('/explore/search/', { blockExplore: false, blockSearch: false }).blocked,
    false
  );
});

test('search under /explore cannot be caught by the profile-reels rule', () => {
  // /explore/search/reels/ is reserved, so even with the search toggle off it
  // must never be read as "the Reels tab of the user named explore".
  for (const cfg of [ALL_ON, { blockSearch: false }]) {
    assert.notEqual(classifyRoute('/explore/search/reels/', cfg).kind, 'profile-reels');
  }
});

test('a username that happens to look like a feature route is still reserved', () => {
  // Nobody can have these names, so these are never treated as profile reels.
  for (const first of routes.RESERVED_FIRST_SEGMENTS) {
    const result = classifyRoute(`/${first}/reels/`, ALL_ON);
    if (first === 'reels') {
      assert.equal(result.blocked, true, '/reels/reels/ is still the Reels tab');
    } else {
      assert.notEqual(result.kind, 'profile-reels', `/${first}/ is a feature route, not a username`);
    }
  }
});

test('every rule reports which config key blocked it', () => {
  assert.equal(classifyRoute('/', ALL_ON).reason, 'blockHome');
  assert.equal(classifyRoute('/reels/', ALL_ON).kind, 'reels');
  assert.equal(classifyRoute('/reel/abc123/', ALL_ON).kind, 'reel');
  assert.equal(classifyRoute('/explore/search/', ALL_ON).kind, 'search');
  assert.equal(classifyRoute('/explore/', ALL_ON).kind, 'explore');
  assert.equal(classifyRoute('/someuser/reels/', ALL_ON).kind, 'profile-reels');
});

test('turning a toggle off allows that route but nothing else', () => {
  const reelsOff = classifyRoute('/reels/', { blockReels: false });
  assert.equal(reelsOff.blocked, false);
  assert.equal(reelsOff.reason, 'blockReels-disabled');
  assert.equal(reelsOff.kind, 'reels', 'the match is still reported, only the blocking is off');

  assert.equal(classifyRoute('/', { blockReels: false }).blocked, true);
  assert.equal(classifyRoute('/', { blockHome: false }).blocked, false);
  assert.equal(classifyRoute('/explore/', { blockExplore: false }).blocked, false);
  assert.equal(classifyRoute('/someuser/reels/', { blockReels: false }).blocked, false);
  assert.equal(classifyRoute('/explore/search/', { blockSearch: false }).blocked, false);
  assert.equal(classifyRoute('/explore/search/topsearch/', { blockSearch: false }).blocked, false);
});

test('the default landing path is never itself blocked', () => {
  assert.equal(isSafeLandingPath('/direct/inbox/', ALL_ON), true);
  assert.equal(isSafeLandingPath('/', ALL_ON), false);
  assert.equal(isSafeLandingPath('/reels/', ALL_ON), false);
});

test('an unsafe landing path is detected even when the toggle changes', () => {
  assert.equal(isSafeLandingPath('/reels/', { blockReels: true }), false);
  assert.equal(isSafeLandingPath('/reels/', { blockReels: false }), true);
});

test('patterns stay portable to NSRegularExpression', () => {
  // The native navigation delegate compiles these same strings with ICU.
  // Lookbehind and named groups are unsupported there, so forbid them here.
  for (const rule of BLOCKED_PATTERNS) {
    const all = [rule.pattern, ...rule.except];
    for (const source of all) {
      assert.doesNotMatch(source, /\(\?<[=/!]/, `${rule.name} uses lookbehind, which ICU lacks`);
      assert.doesNotMatch(source, /\(\?<[A-Za-z]/, `${rule.name} uses a named group, which ICU lacks`);
      assert.doesNotThrow(() => new RegExp(source), `${rule.name} pattern must compile`);
    }
    assert.equal(typeof rule.name, 'string');
    assert.equal(typeof rule.configKey, 'string');
    assert.ok(Array.isArray(rule.except), `${rule.name}.except must be an array`);
  }
});

test('rule sources are exported so the Swift generator can consume them', () => {
  assert.ok(BLOCKED_PATTERNS.length >= 6);
  const names = BLOCKED_PATTERNS.map((r) => r.name);
  for (const expected of ['home', 'reels', 'reel', 'search', 'explore', 'profile-reels']) {
    assert.ok(names.includes(expected), `missing rule: ${expected}`);
  }
});
