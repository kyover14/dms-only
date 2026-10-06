/**
 * Config tests. The important behaviour here is that a partial or malformed
 * override can never silently invert a safety setting: everything defaults to
 * "on", and only an exact type match overrides it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import config from '../core/config.js';

const { DEFAULTS, STORAGE_KEY, merge, resolve, save } = config;

/** Minimal localStorage stand-in. */
function fakeStorage(initial) {
  const data = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    _dump: () => Object.fromEntries(data)
  };
}

test('defaults block the feed, Reels, Explore and Search, and land on DMs', () => {
  assert.equal(DEFAULTS.blockHome, true);
  assert.equal(DEFAULTS.blockReels, true);
  assert.equal(DEFAULTS.blockExplore, true);
  assert.equal(DEFAULTS.blockSearch, true);
  assert.equal(DEFAULTS.blockSearchGrid, true);
  assert.equal(DEFAULTS.enforceRedirect, true);
  assert.equal(DEFAULTS.landingPath, '/direct/inbox/');
  assert.equal(DEFAULTS.debug, false);
});

test('the nav-chrome toggles all default to on', () => {
  // guard.js publishes exactly these three to guard.css as the chrome to hide.
  // If one of them ever defaults to off, the stylesheet loses the rule that
  // stops that nav entry from flashing, so pin the set here.
  const chrome = ['blockReels', 'blockExplore', 'blockSearch'];
  for (const key of chrome) {
    assert.equal(DEFAULTS[key], true, `${key} must default to on`);
    assert.equal(typeof DEFAULTS[key], 'boolean', `${key} must stay a boolean`);
  }
});

test('merge only accepts known keys with a matching type', () => {
  const merged = merge(DEFAULTS, {
    blockHome: false,
    landingPath: '/direct/t/1/',
    nope: true,
    blockReels: 'false' // string, not boolean: must be rejected
  });
  assert.equal(merged.blockHome, false);
  assert.equal(merged.landingPath, '/direct/t/1/');
  assert.equal(merged.blockReels, true, 'a string must not override a boolean');
  assert.ok(!('nope' in merged), 'unknown keys are dropped');
});

test('merge rejects null and undefined rather than treating them as false', () => {
  const merged = merge(DEFAULTS, { blockHome: null, blockReels: undefined });
  assert.equal(merged.blockHome, true);
  assert.equal(merged.blockReels, true);
});

test('resolve layers defaults under storage under the injected override', () => {
  const storage = fakeStorage({ [STORAGE_KEY]: JSON.stringify({ blockExplore: false }) });
  const resolved = resolve(storage, { blockReels: false });
  assert.equal(resolved.blockExplore, false, 'from storage');
  assert.equal(resolved.blockReels, false, 'from the injected override');
  assert.equal(resolved.blockHome, true, 'untouched default');
});

test('resolve survives corrupt or hostile storage', () => {
  assert.equal(resolve(fakeStorage({ [STORAGE_KEY]: 'not json' }), null).blockHome, true);
  assert.equal(resolve(null, null).blockHome, true);
  const throwing = {
    getItem() {
      throw new Error('Safari private mode');
    },
    setItem() {
      throw new Error('quota');
    }
  };
  assert.equal(resolve(throwing, null).blockHome, true);
  assert.doesNotThrow(() => save(throwing, { blockHome: false }));
});

test('save never discards the injected override', () => {
  // The regression this pins down: the iOS shell injects the settings screen's
  // values as an override, then calls setConfig() for every change. If the
  // override were rebuilt from defaults + localStorage, patching one key would
  // silently reset every other key the caller did not mention.
  const storage = fakeStorage();
  const injected = { enforceRedirect: false, blockReels: false, landingPath: '/direct/inbox/' };

  const saved = save(storage, { blockSearch: false }, injected);
  assert.equal(saved.blockSearch, false, 'the patch applies');
  assert.equal(saved.enforceRedirect, false, 'the injected value survives the write');
  assert.equal(saved.blockReels, false, 'and so does every other injected value');

  // The override still outranks the patch, exactly as it outranks storage.
  const overridden = save(storage, { blockReels: true }, injected);
  assert.equal(overridden.blockReels, false, 'the override is the highest layer');
});

test('save persists and returns the merged result', () => {
  const storage = fakeStorage();
  const saved = save(storage, { enforceRedirect: false, debug: true });
  assert.equal(saved.enforceRedirect, false);
  const stored = JSON.parse(storage._dump()[STORAGE_KEY]);
  assert.equal(stored.debug, true);
  assert.equal(stored.blockHome, true, 'the full config is written, not just the patch');
});
