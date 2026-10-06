import Foundation

/// Cancels blocked navigations *before* they load.
///
/// This is the whole reason the app hosts a `WKWebView` instead of sending you
/// to Safari: a navigation request can be refused outright, so a blocked page
/// never renders, never autoplays and never flashes. By the time a JavaScript
/// content script could react, the feed would already be on screen.
///
/// Note what this file does NOT contain: route knowledge. The rule table is
/// generated into `GeneratedRoutes.swift` from `core/routes.js`, so the native
/// delegate and the in-page engine can never disagree about what is blocked.
/// Only the *matching* logic is duplicated here, and it mirrors
/// `classifyRoute()` in core/routes.js line for line.
struct NavigationGuard {
    struct CompiledRule {
        let name: String
        let configKey: String
        let pattern: NSRegularExpression
        let except: [NSRegularExpression]
    }

    struct Verdict {
        let kind: String
        let blocked: Bool
        let configKey: String?
    }

    let rules: [CompiledRule]

    init(rules: [CompiledRule] = NavigationGuard.compileGeneratedRules()) {
        self.rules = rules
    }

    /// Compile the generated table once, at launch.
    ///
    /// A pattern that fails to compile is skipped rather than fatal: losing one
    /// rule means that one route is not pre-emptively cancelled, and the
    /// in-page engine still catches it. Failing to launch would be far worse.
    static func compileGeneratedRules() -> [CompiledRule] {
        // The closure return type is spelled out on purpose: the body mixes
        // `return nil` with a `return CompiledRule(...)`, and inference across
        // those is exactly the kind of thing that compiles locally and then
        // fails on a different Swift version in CI.
        GeneratedRoutes.rules.compactMap { rule -> CompiledRule? in
            guard let pattern = try? NSRegularExpression(pattern: rule.pattern) else {
                NSLog("[InstagramFocus] generated pattern failed to compile: \(rule.name)")
                return nil
            }
            let exceptions = rule.except.compactMap { source -> NSRegularExpression? in
                if let compiled = try? NSRegularExpression(pattern: source) { return compiled }
                NSLog("[InstagramFocus] except-pattern failed to compile for rule: \(rule.name)")
                return nil
            }
            return CompiledRule(
                name: rule.name,
                configKey: rule.configKey,
                pattern: pattern,
                except: exceptions
            )
        }
    }

    /// Path for matching. `URL.path` already excludes the query and fragment, so
    /// this only has to guarantee a leading slash and collapse `//` — the same
    /// guarantees `normalizePath()` makes in core/routes.js.
    static func path(from url: URL) -> String {
        var path = url.path
        if path.isEmpty { path = "/" }
        while path.contains("//") {
            path = path.replacingOccurrences(of: "//", with: "/")
        }
        return path
    }

    /// First matching rule wins; `except` clauses exempt; a rule whose toggle is
    /// off matches but does not block. Identical ordering to the JavaScript.
    func verdict(for path: String, isEnabled: (String) -> Bool) -> Verdict {
        let range = NSRange(path.startIndex..<path.endIndex, in: path)

        for rule in rules {
            guard rule.pattern.firstMatch(in: path, options: [], range: range) != nil else {
                continue
            }
            let exempted = rule.except.contains { exception in
                exception.firstMatch(in: path, options: [], range: range) != nil
            }
            if exempted { continue }

            return Verdict(
                kind: rule.name,
                blocked: isEnabled(rule.configKey),
                configKey: rule.configKey
            )
        }

        return Verdict(kind: "allowed", blocked: false, configKey: nil)
    }
}
