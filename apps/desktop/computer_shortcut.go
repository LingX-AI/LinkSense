package main

// Background emergency pause for computer control.
//
// Cmd+Shift+Esc is a global shortcut only while a computer-control selection
// is active and the app is in the background: when another app has focus the
// native menu accelerator cannot fire. When the app becomes active, or the
// selection ends, the binding is released again, so the menu accelerator is the
// only path and one key press can never fire twice. Registration requires a
// build/host that can construct the signed driver; otherwise the localized menu
// and tray items remain the app-local fallback. The callback only starts a
// goroutine, so the main thread never waits on the device socket.

import (
	"sync"

	"github.com/egoist/mygo"
)

const computerEmergencyAccelerator = "Cmd+Shift+Esc"

// computerEmergencyShortcut owns the optional global binding. All lifecycle
// calls happen on the main thread (installShell and MyGo focus/quit hooks);
// the press callback is invoked there too and must stay non-blocking.
type computerEmergencyShortcut struct {
	mu         sync.Mutex
	register   func(string, func()) error
	unregister func(string)
	press      func()
	eligible   bool
	foreground bool
	armed      bool
	bound      bool
	quit       bool
}

func newComputerEmergencyShortcut(press func()) *computerEmergencyShortcut {
	return &computerEmergencyShortcut{
		register: mygo.GlobalShortcut.Register, unregister: mygo.GlobalShortcut.Unregister,
		press: press, foreground: true,
	}
}

func (shortcut *computerEmergencyShortcut) setEligible(eligible bool) {
	shortcut.apply(func() { shortcut.eligible = eligible })
}

func (shortcut *computerEmergencyShortcut) setForeground(foreground bool) {
	shortcut.apply(func() { shortcut.foreground = foreground })
}

// setArmed binds the shortcut only while a computer-control selection exists.
// The controller calls it outside its own state lock after an acknowledged
// install or a terminal release.
func (shortcut *computerEmergencyShortcut) setArmed(armed bool) {
	shortcut.apply(func() { shortcut.armed = armed })
}

func (d *Desktop) setComputerEmergencyShortcut(armed bool) {
	if d == nil || d.computerShortcut == nil {
		return
	}
	d.computerShortcut.setArmed(armed)
}

// quit releases the binding before the event loop stops. It is idempotent
// because both OnBeforeQuit and OnQuit call it.
func (shortcut *computerEmergencyShortcut) quitBinding() {
	shortcut.apply(func() { shortcut.quit = true })
}

// restore re-arms a binding released by a quit the user then canceled.
func (shortcut *computerEmergencyShortcut) restore() {
	shortcut.apply(func() { shortcut.quit = false })
}

// apply reconciles the desired binding after one state change. The register and
// unregister calls are made without holding the state lock; MyGo dispatches
// them to the main thread and they must never wait behind another caller.
func (shortcut *computerEmergencyShortcut) apply(change func()) {
	if shortcut == nil {
		return
	}
	shortcut.mu.Lock()
	change()
	want := shortcut.eligible && shortcut.armed && !shortcut.foreground && !shortcut.quit
	bound := shortcut.bound
	shortcut.mu.Unlock()
	switch {
	case want && !bound:
		if err := shortcut.register(computerEmergencyAccelerator, shortcut.fire); err == nil {
			shortcut.mu.Lock()
			shortcut.bound = true
			shortcut.mu.Unlock()
		}
	case !want && bound:
		shortcut.unregister(computerEmergencyAccelerator)
		shortcut.mu.Lock()
		shortcut.bound = false
		shortcut.mu.Unlock()
	}
}

// fire runs on the main thread. The pause itself waits on the authenticated
// socket, so it is always dispatched off the UI thread.
func (shortcut *computerEmergencyShortcut) fire() {
	shortcut.mu.Lock()
	press := shortcut.press
	enabled := shortcut.eligible && !shortcut.quit
	shortcut.mu.Unlock()
	if enabled && press != nil {
		go press()
	}
}

func (shortcut *computerEmergencyShortcut) isBound() bool {
	if shortcut == nil {
		return false
	}
	shortcut.mu.Lock()
	defer shortcut.mu.Unlock()
	return shortcut.bound
}
