/**
 * Instagram Focus — route policy.
 *
 * THE SINGLE SOURCE OF TRUTH for which URLs are blocked. `BLOCKED_PATTERNS` is
 * consumed in two places:
 *   1. here, at runtime in the WebView (and as a userscript / extension); and
 *   2. `scripts/build.mjs`, which generates `ios/FocusApp/GeneratedRoutes.swift`
 *      from this array so the native navigation delegate can cancel a blocked
 *      request *before* it loads, without duplicating the rules by hand.
 *
 * Portability rule: every pattern must be valid in BOTH JavaScript `RegExp` and
 * NSRegularExpression (ICU). That means no lookbehind and no named groups. The
 * one clever bit below is a negative lookahead, which both engines support.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else if (root) {
    root.IGFocusRoutes = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * First path segments that mean "an Instagram feature", never a username.
   * Used to keep `/<username>/reels/` from matching `/accounts/login/`-style
   * infrastructure routes.
   */
  var RESERVED_FIRST_SEGMENTS = [
    'accounts', 'about', 'activity', 'api', 'audio', 'challenge', 'developers',
    'direct', 'directory', 'emails', 'explore', 'explorer', 'graphql', 'help',
    'invitation', 'legal', 'live', 'location', 'music', 'nametag',
    'notifications', 'oauth', 'p', 'popular', 'privacy', 'reel', 'reels',
    'search', 'session', 'settings', 'stories', 'tags', 'terms', 'tv', 'web',
    'your_activity'
  ];

  /**
   * `configKey` names the toggle in core/config.js that controls the rule.
   * `except` lists patterns that override a match (used for search, which lives
   * under /explore/ but must keep working).
   */
  var BLOCKED_PATTERNS = [
    {
      name: 'home',
      configKey: 'blockHome',
      pattern: '^/$',
      except: [],
      note: 'The home feed. `/` with a query or hash is normalised away first.'
    },
    {
      name: 'reels',
      configKey: 'blockReels',
      pattern: '^/reels(?:/|$)',
      except: [],
      note: 'The Reels tab and every sub-route of it.'
    },
    {
      name: 'reel',
      configKey: 'blockReels',
      pattern: '^/reel/[^/]+(?:/|$)',
      except: [],
      note: 'A single Reel opened by its shortcode code.'
    },
    {
      name: 'search',
      configKey: 'blockSearch',
      pattern: '^/explore/search(?:/|$)',
      except: [],
      note:
        'Search. Placed BEFORE the explore rule on purpose. First matching rule '
        + 'wins and a match returns even when its toggle is off, so turning '
        + 'blockSearch off makes search allowed again rather than letting it '
        + 'fall through to "Explore is blocked". The explore rule keeps its '
        + 'exempt as well, as a second line of defence if this rule is ever '
        + 'reordered.'
    },
    {
      name: 'explore',
      configKey: 'blockExplore',
      pattern: '^/explore(?:/|$)',
      except: ['^/explore/search(?:/|$)'],
      note: 'Explore/Discover, including tags, locations and people. Search is exempt.'
    },
    {
      name: 'profile-reels',
      configKey: 'blockReels',
      pattern: '^/(?!' + RESERVED_FIRST_SEGMENTS.join('|') + ')[^/]+/reels(?:/|$)',
      except: [],
      note: 'The Reels tab on someone\'s profile.'
    }
  ];

  var _regexCache = {};

  /** Compiled patterns are cached; this runs on every SPA route change. */
  function rx(source) {
    if (!_regexCache[source]) _regexCache[source] = new RegExp(source);
    return _regexCache[source];
  }

  /**
   * Reduce anything (full URL, path, with query/hash, with duplicate slashes)
   * to a canonical `/like/this` pathname.
   */
  function normalizePath(input) {
    var s = input == null ? '/' : String(input);
    var origin = s.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)?$/i);
    if (origin) s = origin[1] || '/';
    if (s.indexOf('#') !== -1) s = s.slice(0, s.indexOf('#'));
    if (s.indexOf('?') !== -1) s = s.slice(0, s.indexOf('?'));
    if (s.charAt(0) !== '/') s = '/' + s;
    s = s.replace(/\/{2,}/g, '/');
    return s;
  }

  /** Non-empty path segments, e.g. `/a/b/` -> ['a', 'b']. */
  function segments(input) {
    return normalizePath(input).split('/').filter(Boolean);
  }

  function isReservedFirstSegment(segment) {
    return RESERVED_FIRST_SEGMENTS.indexOf(String(segment).toLowerCase()) !== -1;
  }

  /**
   * Decide what to do with a URL.
   *
   * @returns {{path: string, kind: string, blocked: boolean, reason: string}}
   *   `kind` is 'allowed' or the name of the rule that matched. `reason` is the
   *   config key when blocked, `<key>-disabled` when the rule matched but the
   *   user turned it off, and 'allowed' otherwise.
   */
  function classifyRoute(input, config) {
    var cfg = config || {};
    var path = normalizePath(input);

    for (var i = 0; i < BLOCKED_PATTERNS.length; i++) {
      var entry = BLOCKED_PATTERNS[i];
      if (!rx(entry.pattern).test(path)) continue;

      var exempt = false;
      for (var j = 0; j < entry.except.length; j++) {
        if (rx(entry.except[j]).test(path)) {
          exempt = true;
          break;
        }
      }
      if (exempt) continue;

      var enabled = cfg[entry.configKey] !== false;
      return {
        path: path,
        kind: entry.name,
        blocked: enabled,
        reason: enabled ? entry.configKey : entry.configKey + '-disabled'
      };
    }

    return { path: path, kind: 'allowed', blocked: false, reason: 'allowed' };
  }

  /** Convenience wrapper for the common yes/no question. */
  function isBlockedRoute(input, config) {
    return classifyRoute(input, config).blocked;
  }

  /**
   * Is this landing path safe to redirect to? If the answer is ever `true` we
   * would bounce the user back and forth forever, so the guard checks this
   * before redirecting.
   */
  function isSafeLandingPath(landingPath, config) {
    return !classifyRoute(landingPath, config).blocked;
  }

  return {
    BLOCKED_PATTERNS: BLOCKED_PATTERNS,
    RESERVED_FIRST_SEGMENTS: RESERVED_FIRST_SEGMENTS,
    normalizePath: normalizePath,
    segments: segments,
    isReservedFirstSegment: isReservedFirstSegment,
    classifyRoute: classifyRoute,
    isBlockedRoute: isBlockedRoute,
    isSafeLandingPath: isSafeLandingPath
  };
});
