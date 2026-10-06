import Foundation
import WebKit

/// Compiles `core/rules.json` into a `WKContentRuleList`.
///
/// This is the declarative layer: it hides the Reels/Explore nav links and the
/// feed container *before first paint*, scoped by URL, which plain CSS cannot
/// do. That URL scoping is what lets `main[role="main"]` be hidden on `/`
/// without also hiding your messages on `/direct/inbox/`.
///
/// Failure is non-fatal by design. If the list will not compile, the user
/// scripts and the navigation delegate still work; the app degrades to "a frame
/// of feed might flash" instead of "the app is broken".
enum RuleListCompiler {
    static let identifier = "InstagramFocusRules"

    static func compile(completion: @escaping (WKContentRuleList?) -> Void) {
        guard
            let url = Bundle.main.url(forResource: "rules", withExtension: "json"),
            let data = try? Data(contentsOf: url),
            let json = String(data: data, encoding: .utf8)
        else {
            NSLog("[InstagramFocus] rules.json missing from the bundle; declarative rules disabled")
            completion(nil)
            return
        }

        guard let store = WKContentRuleListStore.default() else {
            NSLog("[InstagramFocus] no default WKContentRuleListStore; declarative rules disabled")
            completion(nil)
            return
        }

        store.compileContentRuleList(forIdentifier: identifier, encodedContentRuleList: json) { list, error in
            if let error {
                NSLog("[InstagramFocus] rule list failed to compile: \(error.localizedDescription)")
            }
            // The completion handler is not guaranteed to be on the main queue.
            DispatchQueue.main.async { completion(list) }
        }
    }
}
