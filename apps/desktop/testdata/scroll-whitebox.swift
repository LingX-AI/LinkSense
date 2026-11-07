import AppKit

final class ScrollDocument: NSView {
    override var isFlipped: Bool { true }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let window = NSWindow(
    contentRect: NSRect(x: 120, y: 120, width: 420, height: 300),
    styleMask: [.titled, .closable],
    backing: .buffered,
    defer: false
)
window.title = "LinkSense Native Scroll Whitebox"
window.isReleasedWhenClosed = false
let status = NSTextField(labelWithString: "Whitebox scroll offset: 0")
status.frame = NSRect(x: 20, y: 270, width: 380, height: 20)
let scroll = NSScrollView(frame: NSRect(x: 20, y: 20, width: 380, height: 230))
scroll.hasVerticalScroller = true
scroll.autohidesScrollers = false
scroll.setAccessibilityLabel("Whitebox scroll")
let document = ScrollDocument(frame: NSRect(x: 0, y: 0, width: 360, height: 1600))
let marker = NSTextField(labelWithString: "Isolated native scroll content")
marker.frame = NSRect(x: 16, y: 24, width: 300, height: 24)
document.addSubview(marker)
scroll.documentView = document
scroll.contentView.postsBoundsChangedNotifications = true
let observer = NotificationCenter.default.addObserver(
    forName: NSView.boundsDidChangeNotification,
    object: scroll.contentView,
    queue: .main
) { _ in
    status.stringValue = "Whitebox scroll offset: \(Int(scroll.contentView.bounds.origin.y))"
}
window.contentView?.addSubview(status)
window.contentView?.addSubview(scroll)
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
app.run()
