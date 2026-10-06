#!/usr/bin/env node
/**
 * Build script. Zero dependencies, Node only — it runs identically on Windows
 * and on the GitHub Actions macOS runner that compiles the iOS app.
 *
 * It does four things, all from the same `core/` source of truth:
 *   1. dist/userscript/…  — one self-contained .user.js for iOS Safari via the
 *      Userscripts app, and for desktop browsers.
 *   2. dist/chrome, dist/safari — MV3 extension folders (identical files; Safari
 *      only differs in how you load them).
 *   3. dist/instagram-mock.html — the offline fixture, with core/ inlined so it
 *      works even when the file server roots somewhere else.
 *   4. ios/FocusApp/Resources + ios/FocusApp/GeneratedRoutes.swift — the files
 *      the Swift app bundles, including the route table generated from
 *      core/routes.js so the native delegate can never drift from the JS.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CORE = join(ROOT, 'core');

const require = createRequire(import.meta.url);
const pkg = require(join(ROOT, 'package.json'));
const routes = require(join(CORE, 'routes.js'));

const VERSION = pkg.version;
const DIST = join(ROOT, 'dist');
const IOS_RESOURCES = join(ROOT, 'ios', 'FocusApp', 'Resources');

/** Shallow, phone-findable copy of the userscript. Gitignored; see buildPhoneFolder(). */
const PHONE_DIR = 'Put-On-Your-Phone';

/** The load order is load-bearing: guard.js consumes the other three. */
const CORE_SCRIPTS = ['config.js', 'routes.js', 'selectors.js', 'guard.js'];

function readCore(name) {
  return readFileSync(join(CORE, name), 'utf8');
}

/**
 * The engine reports its own version in `IGFocus.status()`, which is how you
 * confirm from a device that you are running the build you think you are. That
 * only works if the two version strings agree, so check rather than hope.
 */
function assertVersionInSync() {
  const source = readCore('guard.js');
  const match = source.match(/var VERSION = '([^']+)'/);
  if (!match) {
    throw new Error("build: could not find `var VERSION = '...'` in core/guard.js");
  }
  if (match[1] !== VERSION) {
    throw new Error(
      `build: version drift — package.json says ${VERSION}, core/guard.js says ${match[1]}.\n` +
        'Bump both so the version reported on-device is trustworthy.'
    );
  }
}

/**
 * The iOS target number has to agree too.
 *
 * On a sideloaded build the only way to answer "did the new build actually
 * install?" is to read the version off the app, so one number has to mean one
 * build. Asserted here, at build time, rather than discovered on the device.
 * Skipped when project.yml is absent, so the web-only flow still builds.
 */
function assertIosVersionInSync() {
  const projectFile = join(ROOT, 'ios', 'project.yml');
  if (!existsSync(projectFile)) return;

  const source = readFileSync(projectFile, 'utf8');
  const match = source.match(/MARKETING_VERSION:\s*"([^"]+)"/);
  if (!match) {
    throw new Error(
      'build: ios/project.yml has no `MARKETING_VERSION: "..."` setting, so the app ' +
        'version cannot be checked against package.json.'
    );
  }
  if (match[1] !== VERSION) {
    throw new Error(
      `build: version drift — package.json says ${VERSION}, ios/project.yml says ${match[1]}.\n` +
        "Bump both so the version shown on the device matches the build you installed."
    );
  }
}

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

function fresh(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

// ---------------------------------------------------------------------------
// 1. Userscript
// ---------------------------------------------------------------------------

function buildUserscript() {
  const header = `// ==UserScript==
// @name         Instagram Focus
// @namespace    https://github.com/local/instagram-focus
// @version      ${VERSION}
// @description  Loads Instagram with only messages and the useful parts: no home feed, no Reels, no Explore.
// @author       Instagram Focus
// @match        https://*.instagram.com/*
// @match        https://instagram.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==
`;

  // guard.css goes in through a <style> element: GM_addStyle is unavailable
  // with @grant none, and keeping @grant none avoids the sandbox entirely.
  const cssBootstrap = `
// --- inlined core/guard.css (injected here to keep this a single file) -------
(function () {
  'use strict';
  var css = ${JSON.stringify(readCore('guard.css'))};
  function inject() {
    if (document.getElementById('igfocus-style')) return;
    var style = document.createElement('style');
    style.id = 'igfocus-style';
    style.textContent = css;
    var host = document.head || document.documentElement;
    if (host) host.appendChild(style);
  }
  inject();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject, { once: true });
  }
})();
`;

  const body = CORE_SCRIPTS.map(
    (name) => `\n// --- core/${name} -------------------------------------------------\n${readCore(name)}`
  ).join('\n');

  write(join(DIST, 'userscript', 'instagram-focus.user.js'), header + cssBootstrap + body);
}

// ---------------------------------------------------------------------------
// 1b. The copy you can reach from the phone
// ---------------------------------------------------------------------------

/**
 * A duplicate of the userscript at the shallowest path we can put it on.
 *
 * Why this exists: the Safari route needs exactly one file on the phone and
 * nothing else, and the transfer is the fiddliest part of it. The real artefact
 * lives in dist/userscript/, which is correct for a build output and useless as
 * something to find in a phone's file browser — dist/ reads as "build junk" and
 * is buried among every other artefact.
 *
 * So the same file is also written one level below the project root, next to a
 * note addressed to whoever is holding the phone, with a name that says what it
 * is for. The transfer itself is then "attach this one file to an email to
 * yourself", which is the shortest path that needs no account, no cable, no
 * server and no cloud service in particular.
 *
 * Generated on every build, never edited, and gitignored, so it cannot drift
 * from the real artefact or become a second thing to keep in step.
 */
function buildPhoneFolder() {
  const dir = join(ROOT, PHONE_DIR);
  fresh(dir);

  const built = readFileSync(join(DIST, 'userscript', 'instagram-focus.user.js'), 'utf8');
  write(join(dir, 'instagram-focus.user.js'), built);

  write(
    join(dir, 'READ-ME-FIRST.txt'),
    [
      'INSTAGRAM FOCUS - the one file your iPhone needs',
      '=================================================',
      '',
      'You need exactly one file out of this folder:',
      '',
      '    instagram-focus.user.js',
      '',
      'On the phone:',
      '',
      '  1. Install "Userscripts" from the App Store. It is free.',
      '  2. Open it and choose a folder for scripts - pick somewhere in',
      '     iCloud Drive or "On My iPhone" so you can find it in Files.',
      '  3. Get instagram-focus.user.js into that folder. It is one small text',
      '     file, so send it to your phone however you like - email it to',
      '     yourself as an attachment and tap Share > Save to Files on the phone.',
      '     Then long-press the file in Files > Move > your script folder.',
      '     (Fastest is email; messaging apps and any cloud app you already use',
      '     work too. No cable needed.)',
      '  4. Settings > Apps > Safari > Extensions > Userscripts > Allow, and set',
      '     it to allow on instagram.com.',
      '  5. Open instagram.com in Safari. No feed, no Reels, no Explore, no',
      '     Search. Messages and profiles still work.',
      '',
      'To update it later, replace the file with a newer copy of the same name.',
      '',
      '-----------------------------------------------------------------------',
      'This is the SAFARI route, not the Focus app. There is no icon on your',
      'home screen and no app: it filters Instagram inside Safari.',
      'Full notes, and the real app, are in docs/INSTALL-iOS.md.',
      ''
    ].join('\n')
  );
}

// ---------------------------------------------------------------------------
// 2. Browser extensions
// ---------------------------------------------------------------------------

function manifest() {
  return {
    manifest_version: 3,
    name: 'Instagram Focus',
    version: VERSION,
    description:
      'Loads Instagram with only messages and the useful parts: no home feed, no Reels, no Explore.',
    content_scripts: [
      {
        matches: ['https://*.instagram.com/*', 'https://instagram.com/*'],
        js: CORE_SCRIPTS,
        css: ['guard.css'],
        run_at: 'document_start',
        all_frames: false
      }
    ],
    host_permissions: ['https://*.instagram.com/*', 'https://instagram.com/*'],
    permissions: []
  };
}

function buildExtension(dir) {
  fresh(dir);
  write(join(dir, 'manifest.json'), JSON.stringify(manifest(), null, 2) + '\n');
  for (const name of CORE_SCRIPTS) {
    write(join(dir, name), readCore(name));
  }
  write(join(dir, 'guard.css'), readCore('guard.css'));
  write(join(dir, 'rules.json'), readCore('rules.json'));
}

// ---------------------------------------------------------------------------
// 3. Self-contained offline fixture
// ---------------------------------------------------------------------------

function buildFixture() {
  const source = readFileSync(join(ROOT, 'fixtures', 'instagram-mock.html'), 'utf8');

  const substitutions = [
    ['<script src="../core/config.js"></script>', `<script>\n${readCore('config.js')}\n</script>`],
    ['<script src="../core/routes.js"></script>', `<script>\n${readCore('routes.js')}\n</script>`],
    ['<script src="../core/selectors.js"></script>', `<script>\n${readCore('selectors.js')}\n</script>`],
    ['<link rel="stylesheet" href="../core/guard.css">', `<style>\n${readCore('guard.css')}\n</style>`],
    ['<script src="../core/guard.js"></script>', `<script>\n${readCore('guard.js')}\n</script>`]
  ];

  let out = source;
  for (const [from, to] of substitutions) {
    if (!out.includes(from)) {
      throw new Error(
        `build: fixtures/instagram-mock.html no longer contains exactly "${from}". ` +
          `Update the substitution list in scripts/build.mjs.`
      );
    }
    // A FUNCTION replacer, not a string: source files contain things like
    // `pattern: '^/$'`, and in a string replacement `$'` means "everything after
    // the match" — which silently shreds the file. This is the fix for that.
    out = out.replace(from, () => to);
  }

  out = out.replace(
    '<title>Instagram Focus — offline fixture</title>',
    () => `<title>Instagram Focus — offline fixture (built)</title>`
  );

  // Belt and braces: prove every core file survived inlining byte-for-byte.
  // This is exactly the class of bug that a string-replacement mishap causes,
  // and it fails loudly here instead of mysteriously in the browser.
  for (const name of [...CORE_SCRIPTS, 'guard.css']) {
    const source = readCore(name);
    if (!out.includes(source)) {
      throw new Error(`build: core/${name} did not survive inlining into the fixture`);
    }
  }

  write(join(DIST, 'instagram-mock.html'), out);
}

// ---------------------------------------------------------------------------
// 4. iOS resources + generated Swift route table
// ---------------------------------------------------------------------------

/** Swift string literal escaping — patterns are regexes, so backslashes matter. */
function swiftString(value) {
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function buildIOS() {
  fresh(IOS_RESOURCES);
  for (const name of CORE_SCRIPTS) {
    write(join(IOS_RESOURCES, name), readCore(name));
  }
  write(join(IOS_RESOURCES, 'guard.css'), readCore('guard.css'));
  write(join(IOS_RESOURCES, 'rules.json'), readCore('rules.json'));

  const rules = routes.BLOCKED_PATTERNS.map((rule) => {
    const except = (rule.except || []).map(swiftString).join(', ');
    return (
      `        Rule(name: ${swiftString(rule.name)}, ` +
      `configKey: ${swiftString(rule.configKey)}, ` +
      `pattern: ${swiftString(rule.pattern)}, ` +
      `except: [${except}])`
    );
  }).join(',\n');

  const swift = `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Generated by scripts/build.mjs from core/routes.js -> BLOCKED_PATTERNS.
// Regenerate with: npm run build
//
// Why generate instead of hand-writing: this table and the JavaScript engine
// must agree exactly. If they drift, a route blocked in the WebView would still
// load normally when reached through a real navigation (or vice versa). Having
// one source of truth makes that impossible.

import Foundation

enum GeneratedRoutes {
    struct Rule {
        let name: String
        let configKey: String
        let pattern: String
        let except: [String]
    }

    static let rules: [Rule] = [
${rules}
    ]

    /// Rule names in the order they are evaluated, for diagnostics.
    static var names: [String] { rules.map(\\.name) }
}
`;

  write(join(ROOT, 'ios', 'FocusApp', 'GeneratedRoutes.swift'), swift);
}

// ---------------------------------------------------------------------------

function main() {
  assertVersionInSync();
  assertIosVersionInSync();
  fresh(DIST);

  buildUserscript();
  buildPhoneFolder();
  buildExtension(join(DIST, 'chrome'));
  buildExtension(join(DIST, 'safari'));
  buildFixture();
  buildIOS();

  const outputs = [
    'dist/userscript/instagram-focus.user.js',
    PHONE_DIR + '/ (the same file, shallow enough to find on a phone)',
    'dist/chrome/ (unpacked MV3 extension)',
    'dist/safari/ (unpacked MV3 extension)',
    'dist/instagram-mock.html (self-contained fixture)',
    'ios/FocusApp/Resources/ (bundled by the app)',
    'ios/FocusApp/GeneratedRoutes.swift (' + routes.BLOCKED_PATTERNS.length + ' rules)'
  ];
  console.log(`instagram-focus v${VERSION} — build complete`);
  for (const line of outputs) console.log('  ✓ ' + line);

  if (!existsSync(join(ROOT, 'ios', 'project.yml'))) {
    console.log('\n  note: ios/project.yml is missing, so XcodeGen has nothing to read.');
  }
}

main();
