package main

// Background emergency controls for computer control.
//
// Pause (Cmd+Shift+Esc) is a global shortcut only while an installed selection
// still has its input gate open. Stop (Ctrl+Shift+Esc) is global while an
// installed selection is active or paused, including a pause, resume or renewal
// still in flight, but not while it is retiring. Both are registered only while
// another app has focus: when LinkSense becomes active its global registrations
// are released, leaving the native menu accelerators available. Registration
// requires a build/host that can construct the signed driver; otherwise the
// localized menu and tray items remain the app-local fallback. The callbacks
// only start a goroutine, so the main thread never waits on the device socket.

import (
	"sync"

	"github.com/egoist/mygo"
)

const (
	computerEmergencyPauseAccelerator = "Cmd+Shift+Esc"
	computerEmergencyStopAccelerator  = "Ctrl+Shift+Esc"
)

type computerShortcutBinding struct {
	accelerator string
	action      func()
	wanted      bool
	bound       bool
	// stale marks a registration attempt whose logical arm was cleared after
	// the attempt was reserved: both an in-flight native Register and an
	// installed registration are invalid until a new attempt replaces them.
	// It covers the attempt from reservation through native completion and
	// installed ownership. Only starting an attempt clears it; native
	// completion and release never do.
	stale bool
	// generation identifies the current registration attempt, allocated under
	// the lock before the native call. A callback retained by an older
	// registration cannot fire after a disarm or rearm.
	generation uint64
	// attempted is the lifecycle revision whose registration attempt already
	// ran. A duplicate reconcile at the same revision must not retry it.
	attempted uint64
}

// computerEmergencyShortcut owns both optional global bindings. Controller
// state changes record the desired arms synchronously and schedule a reconcile
// on the UI thread; focus, quit and cancel reconcile immediately on the main
// thread so a release cannot be stranded behind a stopping event loop. The UI
// serializes every native update, so Register and Unregister run outside every
// state and controller lock without a second reconciliation lock; the press
// callbacks dispatch the actual work off the UI thread.
type computerEmergencyShortcut struct {
	mu         sync.Mutex
	register   func(string, func()) error
	unregister func(string)
	schedule   func(func())
	pause      computerShortcutBinding
	stop       computerShortcutBinding
	eligible   bool
	foreground bool
	quit       bool
	revision   uint64
}

func newComputerEmergencyShortcut(pressPause, pressStop func()) *computerEmergencyShortcut {
	return &computerEmergencyShortcut{
		register:   mygo.GlobalShortcut.Register,
		unregister: mygo.GlobalShortcut.Unregister,
		schedule:   mygo.App.WhenReady,
		foreground: true,
		pause:      computerShortcutBinding{accelerator: computerEmergencyPauseAccelerator, action: pressPause},
		stop:       computerShortcutBinding{accelerator: computerEmergencyStopAccelerator, action: pressStop},
	}
}

func (shortcut *computerEmergencyShortcut) setEligible(eligible bool) {
	shortcut.updateNow(func() bool {
		if shortcut.eligible == eligible {
			return false
		}
		shortcut.eligible = eligible
		return true
	})
}

func (shortcut *computerEmergencyShortcut) setForeground(foreground bool) {
	shortcut.updateNow(func() bool {
		if shortcut.foreground == foreground {
			return false
		}
		shortcut.foreground = foreground
		return true
	})
}

// setDesired records what the live controller state can currently stop or
// pause, then schedules one reconcile when an arm changes. The reconcile reads
// these latest flags instead of replaying the booleans captured by this call.
func (shortcut *computerEmergencyShortcut) setDesired(pause, stop bool) {
	if shortcut == nil {
		return
	}
	changed := shortcut.change(func() bool {
		if shortcut.pause.wanted == pause && shortcut.stop.wanted == stop {
			return false
		}
		shortcut.pause.wanted, shortcut.stop.wanted = pause, stop
		return true
	})
	if changed {
		shortcut.scheduleReconcile()
	}
}

func (d *Desktop) setComputerEmergencyShortcuts(pause, stop bool) {
	if d == nil || d.computerShortcut == nil {
		return
	}
	d.computerShortcut.setDesired(pause, stop)
}

// quitBinding releases both bindings before the event loop stops. It is
// idempotent because both OnBeforeQuit and OnQuit call it, and runs on the main
// thread so the native unregister completes synchronously.
func (shortcut *computerEmergencyShortcut) quitBinding() {
	shortcut.updateNow(func() bool {
		if shortcut.quit {
			return false
		}
		shortcut.quit = true
		return true
	})
}

// restore reconciles a binding released by a quit the user then canceled.
func (shortcut *computerEmergencyShortcut) restore() {
	shortcut.updateNow(func() bool {
		if !shortcut.quit {
			return false
		}
		shortcut.quit = false
		return true
	})
}

// updateNow records one main-thread lifecycle change and reconciles before it
// returns. Startup eligibility, focus, quit and cancel use this so releasing or
// restoring the native bindings cannot be stranded behind a later UI task.
func (shortcut *computerEmergencyShortcut) updateNow(change func() bool) {
	if shortcut == nil {
		return
	}
	if shortcut.change(change) {
		shortcut.reconcile()
	}
}

func (shortcut *computerEmergencyShortcut) change(change func() bool) bool {
	shortcut.mu.Lock()
	changed := change()
	if changed {
		shortcut.revision++
		shortcut.invalidateDisarmedLocked()
	}
	shortcut.mu.Unlock()
	return changed
}

// invalidateDisarmedLocked revokes any registration identity whose logical arm
// is now off, whether it is installed or still in flight in a native Register
// call. The native completion may then observe the mark and release what it
// acquired; a callback retained by the attempt cannot act on a replacement
// selected meanwhile.
func (shortcut *computerEmergencyShortcut) invalidateDisarmedLocked() {
	for _, binding := range [2]*computerShortcutBinding{&shortcut.pause, &shortcut.stop} {
		if !shortcut.desiredLocked(binding) {
			binding.stale = true
		}
	}
}

func (shortcut *computerEmergencyShortcut) scheduleReconcile() {
	shortcut.mu.Lock()
	schedule := shortcut.schedule
	shortcut.mu.Unlock()
	if schedule != nil {
		schedule(shortcut.reconcile)
	}
}

// reconcile applies the latest desired state to both bindings. The UI thread
// serializes calls, so no extra reconciliation lock spans the native work, and
// Register/Unregister never run under the state lock. A failure in one binding
// leaves the other and the menus untouched; the failed arm is retried only by a
// later lifecycle revision, focus change or selection change.
func (shortcut *computerEmergencyShortcut) reconcile() {
	for _, binding := range [2]*computerShortcutBinding{&shortcut.pause, &shortcut.stop} {
		shortcut.reconcileBinding(binding)
	}
}

func (shortcut *computerEmergencyShortcut) reconcileBinding(binding *computerShortcutBinding) {
	shortcut.mu.Lock()
	if binding.bound && binding.stale {
		// The arm was cleared while this registration was still installed.
		// Remove it before a rearm installs a replacement under the same
		// accelerator, then decide from the state left by the release.
		shortcut.mu.Unlock()
		shortcut.releaseBinding(binding)
		shortcut.mu.Lock()
	}
	want := shortcut.desiredLocked(binding)
	owned := binding.bound
	attempted := binding.attempted
	revision := shortcut.revision
	if want && !owned && attempted != revision {
		// Reserve the callback identity and the failure bookkeeping under the
		// same lock that read the desired state, so a later disarm marks this
		// in-flight attempt stale instead of being invisible to it.
		binding.attempted = revision
		binding.generation++
		generation := binding.generation
		binding.stale = false
		shortcut.mu.Unlock()
		press := func() { shortcut.fire(binding, generation) }
		if err := shortcut.register(binding.accelerator, press); err != nil {
			return
		}
		shortcut.mu.Lock()
		outdated := binding.stale
		if !outdated {
			binding.bound = true
		}
		shortcut.mu.Unlock()
		if outdated {
			// A disarm during the native call invalidated this attempt even if
			// the arm was rearmed before Register returned. Release what was
			// just acquired; the queued latest-state reconcile reserves a fresh
			// registration identity if the arm is wanted again.
			shortcut.releaseBinding(binding)
		}
		return
	}
	shortcut.mu.Unlock()
	if !want && owned {
		shortcut.releaseBinding(binding)
	}
}

// releaseBinding invalidates the callback before the native removal so a
// retained callback from this registration can no longer dispatch work. The
// attempt stays stale and keeps its generation until a fresh reservation
// installs a new identity; completion must not clear a disarm that happened
// while the native call was in flight.
func (shortcut *computerEmergencyShortcut) releaseBinding(binding *computerShortcutBinding) {
	shortcut.mu.Lock()
	binding.bound = false
	binding.stale = true
	accelerator := binding.accelerator
	shortcut.mu.Unlock()
	shortcut.unregister(accelerator)
}

func (shortcut *computerEmergencyShortcut) desiredLocked(binding *computerShortcutBinding) bool {
	return binding.wanted && shortcut.eligible && !shortcut.foreground && !shortcut.quit
}

// fire runs on the main thread. The pause or stop itself waits on the
// authenticated socket, so it is always dispatched off the UI thread.
func (shortcut *computerEmergencyShortcut) fire(binding *computerShortcutBinding, generation uint64) {
	shortcut.mu.Lock()
	enabled := binding.bound && !binding.stale && binding.generation == generation &&
		shortcut.desiredLocked(binding)
	action := binding.action
	shortcut.mu.Unlock()
	if enabled && action != nil {
		go action()
	}
}
