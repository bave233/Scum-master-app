import Cocoa
import UniformTypeIdentifiers
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var server: Process?
    private var pollTimer: Timer?
    private let port = 4310

    func applicationDidFinishLaunching(_ notification: Notification) {
        installMainMenu()
        if let iconPath = Bundle.main.path(forResource: "scum-master-logo", ofType: "png") {
            NSApp.applicationIconImage = NSImage(contentsOfFile: iconPath)
        }
        let projectPath = Bundle.main.bundleURL.deletingLastPathComponent().path
        guard FileManager.default.fileExists(atPath: "\(projectPath)/package.json") else {
            showError("ไม่พบโฟลเดอร์โปรเจกต์ข้างตัวแอป")
            return
        }
        guard let nodePath = findNode() else {
            showError("ไม่พบ Node.js กรุณาติดตั้ง Node.js 22 ขึ้นไป")
            return
        }

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Scum Master App"
        window.center()
        window.delegate = self
        webView = WKWebView(frame: .zero)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.loadHTMLString("<style>body{font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0b2628;color:white}</style><p>กำลังเปิด Scum Master App…</p>", baseURL: nil)
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)

        do {
            try runMigration(at: projectPath, nodePath: nodePath)
            try startServer(at: projectPath, nodePath: nodePath)
            pollTimer = Timer.scheduledTimer(
                timeInterval: 0.4,
                target: self,
                selector: #selector(loadWhenReady),
                userInfo: nil,
                repeats: true
            )
        } catch {
            showError(error.localizedDescription)
        }
    }

    private func installMainMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "Scum Master App")
        appMenu.addItem(withTitle: "Quit Scum Master App", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)
        NSApp.mainMenu = mainMenu
    }

    private func findNode() -> String? {
        for path in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
        where FileManager.default.isExecutableFile(atPath: path) {
            return path
        }
        return nil
    }

    private func runMigration(at projectPath: String, nodePath: String) throws {
        let migration = Process()
        migration.executableURL = URL(fileURLWithPath: nodePath)
        migration.arguments = [
            "node_modules/wrangler/bin/wrangler.js",
            "d1", "migrations", "apply", "site-creator-d1",
            "--local", "--persist-to", "app-data", "--config", "wrangler.jsonc"
        ]
        migration.currentDirectoryURL = URL(fileURLWithPath: projectPath)
        migration.standardOutput = FileHandle.nullDevice
        migration.standardError = FileHandle.nullDevice
        try migration.run()
        migration.waitUntilExit()
        if migration.terminationStatus != 0 {
            throw NSError(domain: "ScumMasterApp", code: 1, userInfo: [NSLocalizedDescriptionKey: "เตรียมฐานข้อมูล local ไม่สำเร็จ"])
        }
    }

    private func startServer(at projectPath: String, nodePath: String) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: nodePath)
        process.arguments = ["node_modules/vinext/dist/cli.js", "dev", "--port", String(port)]
        process.currentDirectoryURL = URL(fileURLWithPath: projectPath)
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        server = process
    }

    @objc private func loadWhenReady() {
        guard let url = URL(string: "http://localhost:\(port)") else { return }
        URLSession.shared.dataTask(with: url) { [weak self] _, response, _ in
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return }
            DispatchQueue.main.async {
                self?.pollTimer?.invalidate()
                self?.pollTimer = nil
                self?.webView.load(URLRequest(url: url))
            }
        }.resume()
    }

    private func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "เปิด Scum Master App ไม่สำเร็จ"
        alert.informativeText = message
        alert.runModal()
        NSApp.terminate(nil)
    }

    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.allowedContentTypes = [UTType(filenameExtension: "xlsx")!, .commaSeparatedText, .json]
        panel.beginSheetModal(for: window) { result in
            completionHandler(result == .OK ? panel.urls : nil)
        }
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if
            navigationAction.navigationType == .linkActivated,
            let url = navigationAction.request.url,
            url.host != "localhost"
        {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
    }

    func webView(
        _ webView: WKWebView,
        navigationAction: WKNavigationAction,
        didBecome download: WKDownload
    ) {
        download.delegate = self
    }

    func webView(
        _ webView: WKWebView,
        navigationResponse: WKNavigationResponse,
        didBecome download: WKDownload
    ) {
        download.delegate = self
    }

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        let fileExtension = (suggestedFilename as NSString).pathExtension
        panel.allowedContentTypes = [UTType(filenameExtension: fileExtension) ?? .data]
        panel.beginSheetModal(for: window) { result in
            completionHandler(result == .OK ? panel.url : nil)
        }
    }

    func windowWillClose(_ notification: Notification) {
        NSApp.terminate(nil)
    }

    func applicationWillTerminate(_ notification: Notification) {
        pollTimer?.invalidate()
        if server?.isRunning == true {
            server?.interrupt()
            server?.terminate()
        }
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.setActivationPolicy(.regular)
application.delegate = delegate
application.activate(ignoringOtherApps: true)
application.run()
