/**
 * Instagram Focus — configuration.
 *
 * This is the file you edit to change what the app blocks. Nothing here is
 * Instagram-specific: it is plain data plus two tiny persistence helpers, so it
 * runs unchanged in Node (for tests), in the WKWebView, and in a browser.
 *
 * Dual-export shim: Node's `require`-style `module.exports` when available,
 * otherwise a global so a plain <script> tag / injected user script can use it.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else if (root) {
    root.IGFocusConfig = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Every flag defaults to `true`/on. A flag is only respected when it is
   * explicitly `false`, which makes partial config objects (like the one the
   * iOS app injects from UserDefaults) safe to merge over the defaults.
   */
  var DEFAULTS = {
    /** Show `/` and redirect away from it. */
    blockHome: true,
    /** Hide the Reels nav entry, block `/reels/…` and `/reel/…`, and the `/user/reels/` profile tab. */
    blockReels: true,
    /** Block `/explore/…` (Explore/Discover) but always allow `/explore/search/…`. */
    blockExplore: true,
    /**
     * Block the whole search page, the same way home and Reels are blocked.
     *
     * Search is where the endless grid of posts and Reels actually lives, and on
     * Instagram it is reachable from one tap in the middle of the tab bar. It is
     * therefore blocked by default rather than merely trimmed.
     *
     * Turning this OFF is the way back: search is then allowed outright, and
     * `blockSearchGrid` below decides how much of it you see. Note the ordering
     * in `core/routes.js` — the search rule is evaluated before the explore
     * rule, so turning this off cannot fall through into "Explore is blocked".
     *
     * People are still findable without it: the Messages screen has its own
     * recipient search, which is how you start a new conversation. This only
     * removes the discovery grid.
     */
    blockSearch: true,
    /**
     * When search is allowed, strip its scrollable results grid and keep the
     * account rows and tabs. Only consulted while `blockSearch` is off; with
     * search blocked the whole route is redirected and there is no grid to trim.
     */
    blockSearchGrid: true,
    /** Remove the "Suggested Reels" / "Suggested for you" carousels from the feed. */
    stripSuggestedReels: true,
    /** Remove the stories tray. Off by default: stories are not the endless feed. */
    blockStoriesTray: false,
    /** Redirect blocked routes instead of leaving the (emptied) page in place. */
    enforceRedirect: true,
    /** Where blocked routes send you. DMs is the whole point of the app. */
    landingPath: '/direct/inbox/',
    /** Minimum gap between redirects, to stop a redirect loop from thrashing. */
    redirectCooldownMs: 1200,
    /** Log routing decisions to the console. */
    debug: false
  };

  var STORAGE_KEY = 'igfocus.config.v1';

  /** Shallow-merge `override` over `base`, ignoring keys that aren't in `base`. */
  function merge(base, override) {
    var out = {};
    var key;
    for (key in base) {
      if (Object.prototype.hasOwnProperty.call(base, key)) out[key] = base[key];
    }
    if (override && typeof override === 'object') {
      for (key in base) {
        if (!Object.prototype.hasOwnProperty.call(base, key)) continue;
        if (!Object.prototype.hasOwnProperty.call(override, key)) continue;
        // Types must match exactly. A boolean toggle that arrives as the string
        // "false" would otherwise read as truthy and silently invert the
        // setting — reject it instead and keep the default.
        if (typeof override[key] === typeof base[key]) {
          out[key] = override[key];
        }
      }
    }
    return out;
  }

  /**
   * Resolve the effective config.
   *
   * Priority, lowest to highest: DEFAULTS, then whatever `storage` holds, then
   * `window.IGFocusConfigOverride` (the iOS shell injects this from UserDefaults
   * so the native settings screen always wins). Pass `null` for `storage` in
   * environments without localStorage.
   */
  function resolve(storage, override) {
    var stored = null;
    if (storage) {
      try {
        var raw = storage.getItem(STORAGE_KEY);
        if (raw) stored = JSON.parse(raw);
      } catch (err) {
        stored = null;
      }
    }
    return merge(merge(DEFAULTS, stored), override);
  }

  /**
   * Persist a partial config. Returns the merged config actually written.
   *
   * `override` is layered back on TOP of the patch, and that is load-bearing:
   * the iOS shell injects `IGFocusConfigOverride` from UserDefaults, and the
   * override is supposed to outrank everything. Without this, a single
   * `setConfig()` call would rebuild the config from defaults + localStorage and
   * quietly drop the entire injected override — including settings the caller
   * never mentioned. On the device that meant one toggle silently reset all the
   * others to whatever localStorage happened to hold.
   */
  function save(storage, partial, override) {
    var next = merge(merge(resolve(storage, null), partial), override);
    if (storage) {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (err) {
        /* private mode / quota — the in-memory config still applies */
      }
    }
    return next;
  }

  return {
    DEFAULTS: DEFAULTS,
    STORAGE_KEY: STORAGE_KEY,
    merge: merge,
    resolve: resolve,
    save: save
  };
});
