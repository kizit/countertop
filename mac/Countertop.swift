// Countertop for Mac: a menu bar app that runs the Countertop server on this Mac, shows whether everything
// is working, and can send an Apple Reminders list to a Countertop server (on this Mac, or on Docker/Unraid).
//
// Two ways to get it:
//   - The download from the GitHub release: the server and its own Python are inside the app. Settings live in
//     ~/Library/Application Support/Countertop.
//   - mac/build.sh from a clone of the repository: the app runs tools/countertop.py from that folder with your
//     python3, and settings live in its work/ folder (so `git pull` + Restart Server updates it).
import AppKit
import EventKit
import ServiceManagement

let PORT = 8090
let REPO = "kizit/countertop"
let defaults = UserDefaults.standard

// MARK: - where the server and its data are

struct ServerSetup {
    let script: URL           // tools/countertop.py
    let data: URL             // where it saves everything
    let python: URL?          // bundled Python, or nil to use python3 from the login shell
    let bundled: Bool

    static func current() -> ServerSetup {
        let fm = FileManager.default
        // a folder chosen in the menu, or the clone build.sh was run from
        let folder = defaults.string(forKey: "folder") ?? (Bundle.main.object(forInfoDictionaryKey: "CountertopFolder") as? String) ?? ""
        if !folder.isEmpty, fm.fileExists(atPath: folder + "/tools/countertop.py") {
            let f = URL(fileURLWithPath: folder)
            return ServerSetup(script: f.appendingPathComponent("tools/countertop.py"), data: f.appendingPathComponent("work"), python: nil, bundled: false)
        }
        let res = Bundle.main.resourceURL ?? URL(fileURLWithPath: "/")
        let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Countertop")
        let py = res.appendingPathComponent("python/bin/python3")
        return ServerSetup(script: res.appendingPathComponent("server/tools/countertop.py"), data: support,
                           python: fm.isExecutableFile(atPath: py.path) ? py : nil, bundled: true)
    }
    var available: Bool { FileManager.default.fileExists(atPath: script.path) }
    var logURL: URL { data.appendingPathComponent("server.log") }
}

// MARK: - what /status says

struct Health {
    var answering = false     // a Countertop server answers on the port
    var version = ""
    var level = "ok"          // ok | warn | bad
    var problems: [String] = []
    var screenAgo: Int? = nil
    var update = false
    var latestTag = ""
    var latestURL = ""
    var portTaken = false     // something else is listening on the port
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    var lastIconColor: NSColor?
    let menu = NSMenu()
    var health = Health()
    var child: Process?
    var busy: String?
    var crashes: [Date] = []
    var gaveUp = false
    var timer: Timer?
    let sync = ReminderSync()

    var runServer: Bool {           // off for people whose server runs elsewhere (Docker, Unraid) and only want Reminders sync
        get { defaults.object(forKey: "runServer") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "runServer") }
    }
    var userStopped: Bool {
        get { defaults.bool(forKey: "userStopped") }
        set { defaults.set(newValue, forKey: "userStopped") }
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        menu.delegate = self
        item.menu = menu
        setIcon(.systemGray)
        cleanUpOldVersions()
        if Bundle.main.bundlePath.contains("/AppTranslocation/") { askToMoveToApplications() }
        let s = ServerSetup.current()
        if let py = s.python {          // a downloaded app: let its own Python run without a Gatekeeper prompt per file
            _ = run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", py.deletingLastPathComponent().deletingLastPathComponent().path])
        }
        sync.onChange = { [weak self] in self?.updateIcon() }
        sync.startIfOn()
        refresh(thenStart: true)
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in self?.refresh(thenStart: true) }
    }

    func applicationWillTerminate(_ n: Notification) {
        if let c = child, c.isRunning { c.terminate(); c.waitUntilExit() }
    }

    // MARK: status

    func refresh(thenStart: Bool = false) {
        fetchJSON("/status") { j in
            var h = Health()
            if let j = j, (j["repo"] as? String) == REPO {
                h.answering = true
                h.version = j["version"] as? String ?? ""
                h.level = j["level"] as? String ?? "ok"
                h.problems = j["problems"] as? [String] ?? []
                h.screenAgo = (j["screen"] as? [String: Any])?["seenAgo"] as? Int
                h.update = j["update"] as? Bool ?? false
                let l = j["latest"] as? [String: Any] ?? [:]
                h.latestTag = l["tag"] as? String ?? ""
                h.latestURL = l["url"] as? String ?? ""
            } else {
                h.portTaken = !self.listeningPIDs().isEmpty && !(self.child?.isRunning ?? false)
            }
            DispatchQueue.main.async {
                self.health = h
                self.updateIcon()
                if thenStart && self.runServer && !self.userStopped && !self.gaveUp && self.busy == nil
                    && !h.answering && !h.portTaken && !(self.child?.isRunning ?? false) {
                    self.startServer()
                }
            }
        }
    }

    func updateIcon() {
        if busy != nil { return setIcon(.systemBlue) }
        if !runServer { return setIcon(sync.error.isEmpty ? .labelColor : .systemOrange) }
        if !health.answering { return setIcon((child?.isRunning ?? false) ? .systemBlue : .systemRed) }
        setIcon(health.level == "bad" ? .systemRed : (health.level == "warn" || !sync.error.isEmpty) ? .systemOrange : .systemGreen)
    }

    func setIcon(_ color: NSColor) {
        guard let b = item.button else { return }
        // Only touch the button when the colour changes; the status poll calls this every 15 seconds.
        if color == lastIconColor { return }
        lastIconColor = color
        let cfg = NSImage.SymbolConfiguration(pointSize: 14, weight: .regular).applying(NSImage.SymbolConfiguration(paletteColors: [color]))
        if let img = NSImage(systemSymbolName: "fork.knife.circle.fill", accessibilityDescription: "Countertop")?.withSymbolConfiguration(cfg) {
            img.isTemplate = false
            b.image = img
        } else {
            b.title = "Countertop"
        }
    }

    // MARK: server

    func startServer() {
        let s = ServerSetup.current()
        guard s.available else { return }
        try? FileManager.default.createDirectory(at: s.data, withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: s.logURL.path) { FileManager.default.createFile(atPath: s.logURL.path, contents: nil) }
        var args = ["--port", "\(PORT)"]
        if FileManager.default.fileExists(atPath: s.data.appendingPathComponent("tls/cert.pem").path) { args += ["--also-tls", "--tls-port", "8443"] }
        let p = Process()
        var env = ProcessInfo.processInfo.environment
        env["PYTHONUNBUFFERED"] = "1"
        if s.bundled { env["COUNTERTOP_DATA"] = s.data.path; env["COUNTERTOP_APP"] = "1" }
        if let py = s.python {        // the bundled Python has no access to the macOS keychain: give it a list of trusted certificates
            let ca = py.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("cacert.pem")
            if FileManager.default.fileExists(atPath: ca.path) { env["SSL_CERT_FILE"] = ca.path }
        }
        p.environment = env
        p.currentDirectoryURL = s.script.deletingLastPathComponent().deletingLastPathComponent()
        if let py = s.python {
            p.executableURL = py
            p.arguments = ["-I", s.script.path] + args
        } else {
            // the python3 you use in Terminal (a login shell finds Homebrew, pyenv or python.org installs)
            p.executableURL = URL(fileURLWithPath: "/bin/zsh")
            p.arguments = ["-lc", "exec python3 \"$0\" \"$@\"", s.script.path] + args
        }
        if let fh = try? FileHandle(forWritingTo: s.logURL) {
            fh.seekToEndOfFile()
            p.standardOutput = fh
            p.standardError = fh
        }
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async { self?.serverEnded(proc) }
        }
        do { try p.run(); child = p } catch { health.problems = ["Couldn't start the server: \(error.localizedDescription)"] }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.refresh() }
    }

    func serverEnded(_ p: Process) {
        guard p === child else { return }
        child = nil
        if busy != nil || userStopped || !runServer { return }
        // it stopped on its own: start it again, but not forever if it keeps failing
        crashes = crashes.filter { $0.timeIntervalSinceNow > -300 } + [Date()]
        if crashes.count >= 3 { gaveUp = true; updateIcon(); return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { self.refresh(thenStart: true) }
    }

    func stopServer() {
        if let c = child, c.isRunning {
            c.terminate()
            for _ in 0..<40 where c.isRunning { Thread.sleep(forTimeInterval: 0.1) }
            if c.isRunning { kill(c.processIdentifier, SIGKILL) }
            child = nil
        } else if health.answering {
            // a Countertop server this app didn't start (an older copy of the app, or Terminal): it said it's
            // Countertop on /status, so it's safe to stop whatever is listening on the port
            for pid in listeningPIDs() { kill(pid, SIGTERM) }
            for _ in 0..<40 where !listeningPIDs().isEmpty { Thread.sleep(forTimeInterval: 0.1) }
        }
    }

    func doBusy(_ label: String, _ work: @escaping () -> Void, then: (() -> Void)? = nil) {
        busy = label
        updateIcon()
        DispatchQueue.global().async {
            work()
            DispatchQueue.main.async {
                self.busy = nil
                then?()
                self.refresh()
            }
        }
    }

    @objc func startAction() { userStopped = false; gaveUp = false; crashes = []; doBusy("Starting…", {}, then: { self.startServer() }) }
    @objc func restartAction() { userStopped = false; gaveUp = false; crashes = []; doBusy("Restarting…", { self.stopServer() }, then: { self.startServer() }) }
    @objc func stopAction() { userStopped = true; doBusy("Stopping…", { self.stopServer() }) }
    @objc func toggleRunServer() {
        runServer.toggle()
        if runServer { startAction() } else { doBusy("Stopping…", { self.stopServer() }) }
    }

    // MARK: actions

    @objc func openPath(_ sender: NSMenuItem) {
        if let p = sender.representedObject as? String, let u = URL(string: "http://127.0.0.1:\(PORT)" + p) { NSWorkspace.shared.open(u) }
    }
    @objc func openRelease() {
        if let u = URL(string: health.latestURL.isEmpty ? "https://github.com/\(REPO)/releases/latest" : health.latestURL) { NSWorkspace.shared.open(u) }
    }
    @objc func showData() {
        let s = ServerSetup.current()
        try? FileManager.default.createDirectory(at: s.data, withIntermediateDirectories: true)
        NSWorkspace.shared.open(s.data)
    }
    @objc func showLog() { NSWorkspace.shared.open(ServerSetup.current().logURL) }
    @objc func toggleLogin() {
        let svc = SMAppService.mainApp
        do {
            if svc.status == .enabled { try svc.unregister() } else { try svc.register() }
        } catch {
            alert("Couldn't change Open at Login", error.localizedDescription + "\n\nYou can also add Countertop in System Settings > General > Login Items.")
        }
    }
    @objc func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.message = "Choose a Countertop folder downloaded from GitHub (the one with tools/countertop.py in it)."
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let u = panel.url else { return }
        guard FileManager.default.fileExists(atPath: u.appendingPathComponent("tools/countertop.py").path) else {
            return alert("That isn't a Countertop folder", "It should have tools/countertop.py inside.")
        }
        defaults.set(u.path, forKey: "folder")
        restartAction()
    }
    @objc func useBuiltIn() { defaults.removeObject(forKey: "folder"); restartAction() }
    @objc func setUpSync() { sync.setUp() }

    // MARK: updates

    /// Asks the server to look for a new release now, instead of waiting for its twice-a-day check.
    @objc func checkForUpdates() {
        busy = "Checking for updates…"
        updateIcon()
        fetchJSON("/status?check=1", timeout: 20) { j in
            DispatchQueue.main.async {
                self.busy = nil
                self.refresh()
                guard let j = j else { return self.sync.showAlert("Couldn't check for updates", "The server didn't answer. Try again in a moment.") }
                let latest = j["latest"] as? [String: Any] ?? [:]
                if let err = latest["error"] as? String, !err.isEmpty {
                    self.sync.showAlert("Couldn't reach GitHub", "Check this Mac's internet connection and try again.")
                } else if (j["update"] as? Bool) == true {
                    self.health.update = true
                    self.health.latestTag = latest["tag"] as? String ?? ""
                    self.health.latestURL = latest["url"] as? String ?? ""
                    self.installUpdate()
                } else {
                    self.sync.showAlert("You're up to date", "Countertop v\(j["version"] as? String ?? "") is the newest version.")
                }
            }
        }
    }

    @objc func installUpdate() {
        let tag = health.latestTag
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert()
        a.messageText = "Install Countertop \(tag)?"
        a.informativeText = "Countertop restarts to finish. Your settings stay as they are, and the screen reloads on its own."
        a.addButton(withTitle: "Install")
        a.addButton(withTitle: "What's New")
        a.addButton(withTitle: "Later")
        switch a.runModal() {
        case .alertFirstButtonReturn: break
        case .alertSecondButtonReturn: return openRelease()
        default: return
        }
        let setup = ServerSetup.current()
        if setup.bundled { downloadUpdate(tag) } else { pullUpdate(setup) }
    }

    /// A copy of the repository: git pull, then rebuild the app if its code changed, or restart the server.
    func pullUpdate(_ s: ServerSetup) {
        let root = s.script.deletingLastPathComponent().deletingLastPathComponent().path
        busy = "Updating…"; updateIcon()
        DispatchQueue.global().async {
            let q = { (x: String) in "'" + x.replacingOccurrences(of: "'", with: "'\\''") + "'" }
            let before = self.run("/usr/bin/git", ["-C", root, "rev-parse", "HEAD"]).trimmingCharacters(in: .whitespacesAndNewlines)
            let out = self.run("/bin/zsh", ["-lc", "git -C \(q(root)) pull --ff-only 2>&1; echo \"exit=$?\""])
            let ok = out.contains("exit=0")
            let changed = ok ? self.run("/usr/bin/git", ["-C", root, "diff", "--name-only", before, "HEAD", "--", "mac"]) : ""
            DispatchQueue.main.async {
                self.busy = nil
                if !ok { return self.alert("Couldn't update", "git pull in \(root) said:\n\n" + out.replacingOccurrences(of: "exit=", with: "(exit code ") + ")") }
                if !changed.isEmpty {
                    // the app itself changed: build.sh rebuilds it, quits this copy and opens the new one
                    let p = Process()
                    p.executableURL = URL(fileURLWithPath: "/bin/zsh")
                    p.arguments = ["-lc", "zsh \(q(root + "/mac/build.sh")) > /tmp/countertop-build.log 2>&1"]
                    do { try p.run() } catch { self.alert("Couldn't rebuild the app", "Run zsh mac/build.sh in \(root).") }
                } else {
                    self.restartAction()
                }
            }
        }
    }

    /// The downloaded app: fetch the zip for this Mac from the release, check it, swap it in and relaunch.
    func downloadUpdate(_ tag: String) {
        let app = Bundle.main.bundleURL
        if app.path.contains("/AppTranslocation/") {
            return alert("Move Countertop to Applications first", "macOS is running it from a temporary copy, which can't be updated. Drag Countertop into Applications, open it from there and try again.")
        }
        guard FileManager.default.isWritableFile(atPath: app.deletingLastPathComponent().path) else {
            alert("Countertop can't replace itself here", "Download the new version from the release page and drag it into \(app.deletingLastPathComponent().path).")
            return openRelease()
        }
        #if arch(arm64)
        let suffix = "-mac-apple-silicon.zip"
        #else
        let suffix = "-mac-intel.zip"
        #endif
        busy = "Downloading \(tag)…"; updateIcon()
        let fail = { (why: String) in
            DispatchQueue.main.async {
                self.busy = nil; self.updateIcon()
                self.alert("Couldn't install the update", why + "\n\nYou can download it from the release page instead.")
                self.openRelease()
            }
        }
        guard let api = URL(string: "https://api.github.com/repos/\(REPO)/releases/tags/\(tag)") else { return }
        var req = URLRequest(url: api, timeoutInterval: 20)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: req) { data, _, err in
            guard let d = data, let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                  let assets = j["assets"] as? [[String: Any]],
                  let zip = assets.first(where: { ($0["name"] as? String ?? "").hasSuffix(suffix) }),
                  let dl = (zip["browser_download_url"] as? String).flatMap(URL.init(string:)) else {
                return fail(err?.localizedDescription ?? "This release has no Mac download yet.")
            }
            URLSession.shared.downloadTask(with: dl) { file, _, err in
                guard let file = file else { return fail(err?.localizedDescription ?? "The download failed.") }
                let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("countertop-update-\(UUID().uuidString)")
                try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
                _ = self.run("/usr/bin/ditto", ["-x", "-k", file.path, tmp.path])
                let new = tmp.appendingPathComponent("Countertop.app")
                let info = NSDictionary(contentsOf: new.appendingPathComponent("Contents/Info.plist"))
                guard info?["CFBundleIdentifier"] as? String == Bundle.main.bundleIdentifier,
                      "v" + (info?["CFBundleShortVersionString"] as? String ?? "") == tag else {
                    return fail("The downloaded file didn't look like Countertop \(tag).")
                }
                DispatchQueue.main.async { self.swapAndRelaunch(new, over: app) }
            }.resume()
        }.resume()
    }

    func swapAndRelaunch(_ new: URL, over app: URL) {
        // a small script waits for this copy to quit (which stops the server), moves the new app into place and opens it
        let q = { (x: String) in "'" + x.replacingOccurrences(of: "'", with: "'\\''") + "'" }
        let old = app.path + ".old"
        let script = "while kill -0 \(getpid()) 2>/dev/null; do sleep 0.2; done; rm -rf \(q(old)); "
            + "if mv \(q(app.path)) \(q(old)) && mv \(q(new.path)) \(q(app.path)); then rm -rf \(q(old)); else mv \(q(old)) \(q(app.path)); fi; "
            + "/usr/bin/xattr -dr com.apple.quarantine \(q(app.path)); open \(q(app.path))"
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = ["-c", script]
        do { try p.run() } catch { busy = nil; return alert("Couldn't install the update", error.localizedDescription) }
        busy = "Restarting…"
        NSApp.terminate(nil)
    }
    @objc func syncNow() { sync.sendNow() }
    @objc func syncOff() { sync.turnOff() }

    func alert(_ title: String, _ text: String) {
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert()
        a.messageText = title
        a.informativeText = text
        a.runModal()
    }

    // MARK: menu

    func info(_ text: String, dot: NSColor? = nil, bold: Bool = false, dim: Bool = false) -> NSMenuItem {
        let mi = NSMenuItem(title: text, action: nil, keyEquivalent: "")
        let font = bold ? NSFont.boldSystemFont(ofSize: 13) : NSFont.menuFont(ofSize: 0)
        let s = NSMutableAttributedString()
        if let c = dot { s.append(NSAttributedString(string: "● ", attributes: [.font: font, .foregroundColor: c])) }
        s.append(NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: dim ? NSColor.secondaryLabelColor : NSColor.labelColor]))
        let label = NSTextField(labelWithAttributedString: s)
        label.lineBreakMode = .byTruncatingTail
        label.sizeToFit()
        let w = min(max(label.frame.width + 30, 280), 460)
        let box = NSView(frame: NSRect(x: 0, y: 0, width: w, height: 22))
        label.frame = NSRect(x: 14, y: (22 - label.frame.height) / 2, width: w - 20, height: label.frame.height)
        box.addSubview(label)
        mi.view = box
        return mi
    }
    func action(_ title: String, _ sel: Selector, key: String = "", path: String? = nil) -> NSMenuItem {
        let mi = NSMenuItem(title: title, action: sel, keyEquivalent: key)
        mi.target = self
        mi.representedObject = path
        return mi
    }
    func ago(_ s: Int) -> String {
        if s < 90 { return "just now" }
        if s < 5400 { return "\(s / 60) min ago" }
        return "\(s / 3600) hours ago"
    }

    func menuNeedsUpdate(_ m: NSMenu) {
        m.removeAllItems()
        let h = health, setup = ServerSetup.current()
        m.addItem(info("Countertop" + (h.version.isEmpty ? "" : " v" + h.version), bold: true))
        if let b = busy {
            m.addItem(info(b, dot: .systemBlue))
        } else if !runServer {
            m.addItem(info("Not running a server on this Mac", dot: .systemGray))
            if !sync.error.isEmpty { m.addItem(info("Reminders Sync: " + sync.error, dot: .systemOrange)) }
        } else if h.answering {
            let colors: [String: NSColor] = ["ok": .systemGreen, "warn": .systemOrange, "bad": .systemRed]
            m.addItem(info(h.problems.first ?? "Everything's working", dot: colors[h.level] ?? .systemGreen))
            if h.problems.count > 1 { m.addItem(info("   and \(h.problems.count - 1) more in Controls > Status", dim: true)) }
            if let a = h.screenAgo { m.addItem(info("   Screen checked in " + ago(a), dim: true)) }
            if !sync.error.isEmpty { m.addItem(info("Reminders Sync: " + sync.error, dot: .systemOrange)) }
        } else if h.portTaken {
            m.addItem(info("Port \(PORT) is used by another app", dot: .systemRed))
        } else if !setup.available {
            m.addItem(info("Countertop's server files are missing", dot: .systemRed))
        } else if gaveUp {
            m.addItem(info("The server keeps stopping. See the server log.", dot: .systemRed))
        } else if child?.isRunning ?? false {
            m.addItem(info("Starting…", dot: .systemBlue))
        } else {
            m.addItem(info("Server stopped", dot: .systemRed))
        }
        if h.update {
            m.addItem(action("Install Countertop \(h.latestTag)…", #selector(installUpdate)))
        } else if h.answering {
            m.addItem(action("Check for Updates", #selector(checkForUpdates)))
        }

        if runServer {
            m.addItem(.separator())
            let c = action("Open Controls", #selector(openPath(_:)), key: ",", path: "/control")
            m.addItem(c)
            m.addItem(action("Open Dashboard", #selector(openPath(_:)), path: "/dash"))
            m.addItem(action("Open Grocery List", #selector(openPath(_:)), path: "/list"))
            m.addItem(.separator())
            if h.answering || (child?.isRunning ?? false) {
                m.addItem(action("Restart Server", #selector(restartAction), key: "r"))
                m.addItem(action("Stop Server", #selector(stopAction)))
            } else {
                m.addItem(action("Start Server", #selector(startAction), key: "s"))
            }
        }

        m.addItem(.separator())
        let sm = NSMenu()
        if sync.isOn {
            sm.addItem(info(sync.summary, dot: sync.error.isEmpty ? .systemGreen : .systemOrange))
            sm.addItem(action("Send Now", #selector(syncNow)))
            sm.addItem(action("Change…", #selector(setUpSync)))
            sm.addItem(action("Turn Off", #selector(syncOff)))
        } else {
            if runServer {
                sm.addItem(info("Your server runs on this Mac, so you don't need this:", dim: true))
                sm.addItem(info("choose Apple Reminders in Controls > Setup > Lists.", dim: true))
                sm.addItem(info("Use Reminders Sync for a server on Docker or Unraid.", dim: true))
            } else {
                sm.addItem(info("Show an Apple Reminders list on a Countertop", dim: true))
                sm.addItem(info("server that runs on Docker or Unraid.", dim: true))
            }
            sm.addItem(action("Set Up…", #selector(setUpSync)))
        }
        let si = NSMenuItem(title: "Reminders Sync" + (sync.isOn ? ": On" : ""), action: nil, keyEquivalent: "")
        si.submenu = sm
        m.addItem(si)

        m.addItem(.separator())
        let login = action("Open at Login", #selector(toggleLogin))
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        m.addItem(login)
        let rs = action("Run the Server on This Mac", #selector(toggleRunServer))
        rs.state = runServer ? .on : .off
        m.addItem(rs)
        if runServer {
            m.addItem(action("Show Settings Folder", #selector(showData)))
            m.addItem(action("Show Server Log", #selector(showLog)))
            let adv = NSMenu()
            adv.addItem(info(setup.bundled ? "Using the server inside this app" : "Using " + setup.script.deletingLastPathComponent().deletingLastPathComponent().path, dim: true))
            adv.addItem(action("Use a Countertop Folder…", #selector(chooseFolder)))
            if defaults.string(forKey: "folder") != nil && Bundle.main.resourceURL.map({ FileManager.default.fileExists(atPath: $0.appendingPathComponent("server").path) }) == true {
                adv.addItem(action("Use the Server Inside This App", #selector(useBuiltIn)))
            }
            let ai = NSMenuItem(title: "Advanced", action: nil, keyEquivalent: "")
            ai.submenu = adv
            m.addItem(ai)
        }
        m.addItem(.separator())
        m.addItem(NSMenuItem(title: "Quit Countertop", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    }

    func menuWillOpen(_ m: NSMenu) { refresh() }

    // MARK: helpers

    func run(_ path: String, _ args: [String]) -> String {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice     // an unread pipe fills up and blocks the command (and the app) forever
        do { try p.run() } catch { return "" }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return String(data: data, encoding: .utf8) ?? ""
    }

    func listeningPIDs() -> [Int32] {
        run("/usr/sbin/lsof", ["-nP", "-iTCP:\(PORT)", "-sTCP:LISTEN", "-t"])
            .split(separator: "\n").compactMap { Int32($0.trimmingCharacters(in: .whitespaces)) }
    }

    func fetchJSON(_ path: String, timeout: TimeInterval = 4, _ done: @escaping ([String: Any]?) -> Void) {
        guard let url = URL(string: "http://127.0.0.1:\(PORT)\(path)") else { return done(nil) }
        var req = URLRequest(url: url)
        req.timeoutInterval = timeout
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            guard let data = data, (resp as? HTTPURLResponse)?.statusCode == 200,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return done(nil) }
            done(obj)
        }.resume()
    }

    /// Earlier builds were called "Kitchen Dashboard" and came with a separate List Sync app. Take over from them once.
    func cleanUpOldVersions() {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let oldAgent = home.appendingPathComponent("Library/LaunchAgents/local.kitchen-dashboard.menubar.plist")
        if FileManager.default.fileExists(atPath: oldAgent.path) {
            try? FileManager.default.removeItem(at: oldAgent)
            try? SMAppService.mainApp.register()
        }
        let old = UserDefaults(suiteName: "local.kitchen-dashboard.menubar")
        guard let f = old?.string(forKey: "projectDir"), !f.isEmpty,
              FileManager.default.fileExists(atPath: f + "/tools/countertop.py") else { return }
        old?.removeObject(forKey: "projectDir")     // only take over once
        if hasBundledServer {
            // a downloaded app keeps its own copy of the server: bring the old settings over instead of running the old folder
            let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Countertop")
            let work = URL(fileURLWithPath: f).appendingPathComponent("work")
            if !FileManager.default.fileExists(atPath: support.path), FileManager.default.fileExists(atPath: work.path) {
                try? FileManager.default.copyItem(at: work, to: support)
            }
        } else if defaults.string(forKey: "folder") == nil {
            defaults.set(f, forKey: "folder")
        }
    }

    var hasBundledServer: Bool {
        Bundle.main.resourceURL.map { FileManager.default.fileExists(atPath: $0.appendingPathComponent("server").path) } ?? false
    }

    /// macOS runs a downloaded app that was never moved from a read-only temporary copy, which can't be updated in place.
    func askToMoveToApplications() {
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert()
        a.messageText = "Move Countertop to Applications"
        a.informativeText = "Countertop is running from the folder it was downloaded to. Quit it, drag Countertop into your Applications folder in Finder, then open it from there. That lets it start at login and install updates."
        a.addButton(withTitle: "Quit and Show in Finder")
        a.addButton(withTitle: "Keep Running")
        if a.runModal() == .alertFirstButtonReturn {
            NSWorkspace.shared.open(FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Downloads"))
            NSApp.terminate(nil)
        }
    }
}

// MARK: - Reminders sync: sends one Reminders list to a Countertop server whenever it changes

final class ReminderSync {
    let store = EKEventStore()
    var pending: DispatchWorkItem?
    var lastSent = ""
    var error = ""
    var lastAt: Date?
    var count = 0
    var timer: Timer?
    var observing = false
    var onChange: (() -> Void)?

    var isOn: Bool { defaults.bool(forKey: "syncOn") }
    var server: String { defaults.string(forKey: "syncServer") ?? "http://127.0.0.1:\(PORT)" }
    var key: String { defaults.string(forKey: "syncKey") ?? "" }
    var listName: String { defaults.string(forKey: "syncList") ?? "Grocery" }
    var summary: String {
        if !error.isEmpty { return error }
        guard let t = lastAt else { return "“\(listName)”: waiting for the first send" }
        let f = DateFormatter(); f.timeStyle = .short
        return "“\(listName)”: \(count) item\(count == 1 ? "" : "s") sent at \(f.string(from: t))"
    }

    func startIfOn() {
        // settings from the separate List Sync app that came before this one
        if !isOn, let old = UserDefaults(suiteName: "local.countertop.listsync"), let k = old.string(forKey: "key"), !k.isEmpty {
            defaults.set(old.string(forKey: "server") ?? server, forKey: "syncServer")
            defaults.set(k, forKey: "syncKey")
            defaults.set(old.string(forKey: "list") ?? "Grocery", forKey: "syncList")
            defaults.set(true, forKey: "syncOn")
            old.removeObject(forKey: "key")
            retireOldHelper()
        }
        if isOn { access { ok in if ok { self.begin() } } }
    }

    func access(_ done: @escaping (Bool) -> Void) {
        let finish: (Bool, Error?) -> Void = { ok, _ in
            DispatchQueue.main.async {
                if !ok { self.error = "No access to Reminders. Allow it in System Settings > Privacy & Security > Reminders." ; self.onChange?() }
                done(ok)
            }
        }
        if #available(macOS 14.0, *) { store.requestFullAccessToReminders(completion: finish) }
        else { store.requestAccess(to: .reminder, completion: finish) }
    }

    func begin() {
        if !observing {
            observing = true
            NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { [weak self] _ in self?.soon() }
        }
        timer?.invalidate()
        // also resend every 10 minutes, in case the server restarted
        timer = Timer.scheduledTimer(withTimeInterval: 600, repeats: true) { [weak self] _ in self?.collect(force: true) }
        collect(force: true)
    }

    func soon() {      // changes come in bursts (iCloud, ticking several items): wait for them to settle
        guard isOn else { return }
        pending?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.collect(force: false) }
        pending = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: w)
    }

    func collect(force: Bool) {
        guard isOn else { return }
        let cals = store.calendars(for: .reminder).filter { $0.title == listName }
        if cals.isEmpty { error = "No Reminders list named “\(listName)”"; onChange?(); return }
        let pred = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: cals)
        store.fetchReminders(matching: pred) { rems in
            let items = (rems ?? []).sorted { ($0.creationDate ?? .distantPast) < ($1.creationDate ?? .distantPast) }.compactMap { r -> [String: String]? in
                let t = (r.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                return t.isEmpty ? nil : ["id": r.calendarItemIdentifier, "text": t]
            }
            DispatchQueue.main.async { self.send(items, force: force) }
        }
    }

    func send(_ items: [[String: String]], force: Bool) {
        let base = server.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        guard !key.isEmpty, let url = URL(string: base + "/lists/push") else { error = "Reminders Sync isn't set up"; onChange?(); return }
        let body: [String: Any] = ["key": key, "items": items, "via": "Reminders"]
        guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) else { return }
        let sig = String(decoding: data, as: UTF8.self)
        if sig == lastSent && !force { return }
        var req = URLRequest(url: url, timeoutInterval: 15)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = data
        URLSession.shared.dataTask(with: req) { _, r, err in
            let code = (r as? HTTPURLResponse)?.statusCode ?? 0
            DispatchQueue.main.async {
                if code == 200 { self.lastSent = sig; self.error = ""; self.lastAt = Date(); self.count = items.count }
                else if code == 403 { self.error = "The server didn't accept the sync key" }
                else { self.error = "Couldn't reach \(base)" + (err.map { ": " + $0.localizedDescription } ?? "") }
                self.onChange?()
            }
        }.resume()
    }

    func sendNow() { lastSent = ""; collect(force: true) }

    func turnOff() {
        defaults.set(false, forKey: "syncOn")
        timer?.invalidate()
        error = ""
        onChange?()
    }

    /// Asks for the server, the sync key and the list. Fills in the key itself when this Mac's own server has one.
    func setUp() {
        access { ok in
            guard ok else { return self.showAlert("Countertop can't see your Reminders", "Allow it in System Settings > Privacy & Security > Reminders, then try again.") }
            self.localKey { found in self.askSettings(foundKey: found) }
        }
    }

    func localKey(_ done: @escaping (String) -> Void) {
        guard let u = URL(string: "http://127.0.0.1:\(PORT)/sources") else { return done("") }
        URLSession.shared.dataTask(with: URLRequest(url: u, timeoutInterval: 3)) { data, _, _ in
            var k = ""
            if let d = data, let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
               let lists = (j["sources"] as? [String: Any])?["lists"] as? [[String: Any]] {
                k = lists.first { ($0["kind"] as? String) == "Sent from another app" }?["pushKey"] as? String ?? ""
            }
            DispatchQueue.main.async { done(k) }
        }.resume()
    }

    func askSettings(foundKey: String) {
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert()
        a.messageText = "Reminders Sync"
        a.informativeText = "Sends one Reminders list to Countertop whenever it changes, including changes from your iPhone. "
            + "In Controls > Setup > Lists, set your list to “Sent from another app”, save, and copy its sync key."
        a.addButton(withTitle: "Turn On")
        a.addButton(withTitle: "Cancel")
        let serverF = NSTextField(string: server)
        let keyF = NSTextField(string: key.isEmpty ? foundKey : key)
        keyF.placeholderString = "Sync key from Controls"
        let pop = NSPopUpButton()
        let names = store.calendars(for: .reminder).map { $0.title }.sorted()
        pop.addItems(withTitles: names.isEmpty ? [listName] : names)
        pop.selectItem(withTitle: names.contains(listName) ? listName : (names.first ?? listName))
        let grid = NSGridView(views: [[NSTextField(labelWithString: "Server"), serverF],
                                      [NSTextField(labelWithString: "Sync key"), keyF],
                                      [NSTextField(labelWithString: "List"), pop]])
        grid.frame = NSRect(x: 0, y: 0, width: 380, height: 92)
        grid.column(at: 1).width = 300
        a.accessoryView = grid
        a.window.initialFirstResponder = keyF
        guard a.runModal() == .alertFirstButtonReturn else { return }
        let k = keyF.stringValue.trimmingCharacters(in: .whitespaces)
        guard !k.isEmpty else { return showAlert("Paste the sync key", "Controls > Setup > Lists shows it once the list is set to “Sent from another app”.") }
        let addr = serverF.stringValue.trimmingCharacters(in: .whitespaces)
        guard let u = URL(string: addr), ["http", "https"].contains(u.scheme ?? ""), u.host != nil, (u.port ?? 80) <= 65535 else {
            return showAlert("Check the server address", "It should look like http://192.168.1.50:8090, the address you open Controls at.")
        }
        defaults.set(addr, forKey: "syncServer")
        defaults.set(k, forKey: "syncKey")
        defaults.set(pop.titleOfSelectedItem ?? listName, forKey: "syncList")
        defaults.set(true, forKey: "syncOn")
        retireOldHelper()
        lastSent = ""
        begin()
    }

    /// The separate "Countertop List Sync" app would send the same list twice: stop it and take it out of login.
    func retireOldHelper() {
        let agent = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/local.countertop.listsync.plist")
        guard FileManager.default.fileExists(atPath: agent.path) else { return }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        p.arguments = ["bootout", "gui/\(getuid())/local.countertop.listsync"]
        try? p.run(); p.waitUntilExit()
        try? FileManager.default.removeItem(at: agent)
    }

    func showAlert(_ t: String, _ s: String) {
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert(); a.messageText = t; a.informativeText = s; a.runModal()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
// quit cleanly (and stop the server) when asked to by kill or logout, not only from the menu
signal(SIGTERM, SIG_IGN)
let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
sigterm.setEventHandler { NSApp.terminate(nil) }
sigterm.resume()
app.run()
