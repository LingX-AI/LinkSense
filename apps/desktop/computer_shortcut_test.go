package main

import (
	"errors"
	"sync"
	"testing"
	"time"
)

type shortcutFixture struct {
	mu      sync.Mutex
	bound   map[string]func()
	boundAt []string
	fail    bool
}

func newShortcutFixture() *shortcutFixture {
	return &shortcutFixture{bound: map[string]func(){}}
}

func (fixture *shortcutFixture) register(accelerator string, press func()) error {
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	if fixture.fail {
		return errors.New("shortcut unavailable")
	}
	if _, exists := fixture.bound[accelerator]; exists {
		return errors.New("shortcut already registered")
	}
	fixture.bound[accelerator] = press
	fixture.boundAt = append(fixture.boundAt, accelerator)
	return nil
}

func (fixture *shortcutFixture) unregister(accelerator string) {
	fixture.mu.Lock()
	delete(fixture.bound, accelerator)
	fixture.mu.Unlock()
}

func (fixture *shortcutFixture) setFail(fail bool) {
	fixture.mu.Lock()
	fixture.fail = fail
	fixture.mu.Unlock()
}

func (fixture *shortcutFixture) press(accelerator string) {
	fixture.mu.Lock()
	press := fixture.bound[accelerator]
	fixture.mu.Unlock()
	if press != nil {
		press()
	}
}

func (fixture *shortcutFixture) isBound(accelerator string) bool {
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	_, ok := fixture.bound[accelerator]
	return ok
}

func newShortcutUnderTest(fixture *shortcutFixture, press func()) *computerEmergencyShortcut {
	shortcut := newComputerEmergencyShortcut(press)
	shortcut.register = fixture.register
	shortcut.unregister = fixture.unregister
	return shortcut
}

func TestComputerShortcutBindsOnlyWhileTheFeatureIsEligibleAndBackgrounded(t *testing.T) {
	fixture := newShortcutFixture()
	pressed := make(chan struct{}, 4)
	shortcut := newShortcutUnderTest(fixture, func() { pressed <- struct{}{} })

	shortcut.setArmed(true)
	shortcut.setForeground(false)
	if fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("an ineligible app bound the global shortcut")
	}
	shortcut.setEligible(true)
	if !fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("an eligible background app did not bind the shortcut")
	}
	if binding := fixture.boundAt; len(binding) != 1 || binding[0] != computerEmergencyAccelerator {
		t.Fatalf("the shortcut bound %v", binding)
	}
	// A second background notification cannot double-bind.
	shortcut.setForeground(false)
	if binding := fixture.boundAt; len(binding) != 1 {
		t.Fatalf("a repeated background notification rebound the shortcut: %v", binding)
	}

	fixture.press(computerEmergencyAccelerator)
	select {
	case <-pressed:
	case <-time.After(time.Second):
		t.Fatal("the bound shortcut did not press")
	}

	// The app's own focus releases the binding, leaving the native menu
	// accelerator as the only path (no double firing).
	shortcut.setForeground(true)
	if fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("a foreground app kept the global shortcut")
	}
	shortcut.setForeground(false)
	if !fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("backgrounding did not restore the shortcut")
	}
	// Without a live selection the global binding is not held.
	shortcut.setArmed(false)
	if fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("an inactive selection kept the global shortcut")
	}
	shortcut.setArmed(true)
	if !fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("an active background selection did not bind the shortcut")
	}
}

func TestComputerShortcutFailsSafeAndRetries(t *testing.T) {
	fixture := newShortcutFixture()
	shortcut := newShortcutUnderTest(fixture, func() {})
	shortcut.setArmed(true)
	shortcut.setEligible(true)
	fixture.setFail(true)
	shortcut.setForeground(false)
	if fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("a failed registration reported bound")
	}
	fixture.setFail(false)
	shortcut.setForeground(true)
	shortcut.setForeground(false)
	if !fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("the shortcut was not retried after a failed registration")
	}
}

func TestComputerShortcutPressNeverBlocksTheMainThread(t *testing.T) {
	fixture := newShortcutFixture()
	release := make(chan struct{})
	shortcut := newShortcutUnderTest(fixture, func() { <-release })
	shortcut.setArmed(true)
	shortcut.setEligible(true)
	shortcut.setForeground(false)

	done := make(chan struct{})
	go func() {
		fixture.press(computerEmergencyAccelerator)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("the shortcut callback blocked on the pause work")
	}
	close(release)
}

func TestComputerShortcutQuitReleasesAndCanceledQuitRestores(t *testing.T) {
	fixture := newShortcutFixture()
	shortcut := newShortcutUnderTest(fixture, func() {})
	shortcut.setArmed(true)
	shortcut.setEligible(true)
	shortcut.setForeground(false)
	if !fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("the shortcut was not bound before quit")
	}

	shortcut.quitBinding()
	if fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("quit kept the global shortcut")
	}
	// A canceled quit restores the binding only for an eligible background app.
	shortcut.restore()
	if !fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("a canceled quit did not restore the shortcut")
	}
	shortcut.quitBinding()
	shortcut.setForeground(true)
	shortcut.restore()
	if fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("a foreground app bound the shortcut during restore")
	}
}
