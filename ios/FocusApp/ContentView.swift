import SwiftUI

/// The app screen: a thin toolbar over the guard-railed web view.
///
/// The toolbar is deliberately small — every point of vertical space it takes is
/// a point Instagram's mobile layout loses — but it earns its place by giving a
/// one-tap way back to Messages, which is what makes this app trustworthy enough
/// to keep using instead of the real one.
struct ContentView: View {
    @ObservedObject var settings: SettingsStore
    @StateObject private var browser = BrowserModel()
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            WebView(settings: settings, browser: browser)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle("Messages")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            browser.open(path: settings.landingPath)
                        } label: {
                            Label("Messages", systemImage: "bubble.left.and.bubble.right")
                        }
                        .accessibilityHint("Return to your Instagram messages")
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            showingSettings = true
                        } label: {
                            Label("Settings", systemImage: "gearshape")
                        }
                    }
                }
                .sheet(isPresented: $showingSettings) {
                    SettingsView(settings: settings)
                }
        }
    }
}

/// Settings, plus the one thing that is genuinely useful to know on-device:
/// that this app cannot change the Instagram application itself.
struct SettingsView: View {
    @ObservedObject var settings: SettingsStore

    @Environment(\.dismiss) private var dismiss

    private var contentToggles: [SettingKey] {
        [
            .blockHome, .blockReels, .blockExplore, .blockSearch, .blockSearchGrid,
            .stripSuggestedReels, .blockStoriesTray
        ]
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(contentToggles) { key in
                        Toggle(isOn: settings.binding(for: key)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(key.title)
                                if let footer = key.footer {
                                    Text(footer)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                } header: {
                    Text("What to hide")
                }

                Section {
                    Toggle(isOn: settings.binding(for: .enforceRedirect)) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(SettingKey.enforceRedirect.title)
                            if let footer = SettingKey.enforceRedirect.footer {
                                Text(footer).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    TextField("Landing path", text: $settings.landingPath)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .font(.system(.body, design: .monospaced))
                } header: {
                    Text("Behaviour")
                } footer: {
                    Text("Where blocked pages send you. Must stay somewhere allowed, or the app falls back to emptying the page in place.")
                }

                Section {
                    Button("Reset to defaults", role: .destructive) {
                        settings.resetToDefaults()
                    }
                } footer: {
                    Text("This app renders instagram.com with the feed, Reels and Explore removed. iOS gives no app any way to change the Instagram application itself, so if you open Instagram directly you will still see them.")
                }
            }
            .navigationTitle("Instagram Focus")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
