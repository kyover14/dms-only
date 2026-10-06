import SwiftUI

@main
struct InstagramFocusApp: App {
    /// One store for the whole app: the settings sheet and the web view must
    /// never disagree about what is blocked.
    @StateObject private var settings = SettingsStore()

    var body: some Scene {
        WindowGroup {
            ContentView(settings: settings)
        }
    }
}
