package main

import (
	"errors"
	"sync"
	"testing"
	"time"
)

type shortcutFixture struct {
	mu        sync.Mutex
	bound     map[string]func()
	boundAt   []string
	unboundAt []string
	attempts  map[string]int
	fail      map[string]bool
}

func newShortcutFixture() *shortcutFixture {
	return &shortcutFixture{
		bound: map[string]func(){}, attempts: map[string]int{}, fail: map[string]bool{},
	}
}

func (fixture *shortcutFixture) register(accelerator string, press func()) error {
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	fixture.attempts[accelerator]++
	if fixture.fail[accelerator] {
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
	fixture.unboundAt = append(fixture.unboundAt, accelerator)
	fixture.mu.Unlock()
}

func (fixture *shortcutFixture) setFail(accelerator string, fail bool) {
	fixture.mu.Lock()
	fixture.fail[accelerator] = fail
	fixture.mu.Unlock()
}

func (fixture *shortcutFixture) attemptCount(accelerator string) int {
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	return fixture.attempts[accelerator]
}

func (fixture *shortcutFixture) press(accelerator string) {
	if press := fixture.callback(accelerator); press != nil {
		press()
	}
}

func (fixture *shortcutFixture) callback(accelerator string) func() {
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	return fixture.bound[accelerator]
}

func (fixture *shortcutFixture) isBound(accelerator string) bool {
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	_, ok := fixture.bound[accelerator]
	return ok
}

func (fixture *shortcutFixture) boundAccelerators() []string {
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	return append([]string(nil), fixture.boundAt...)
}

func (fixture *shortcutFixture) unboundAccelerators() []string {
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	return append([]string(nil), fixture.unboundAt...)
}

type shortcutInlineScheduler struct {
	mu sync.Mutex
}

func (scheduler *shortcutInlineScheduler) schedule(reconcile func()) {
	scheduler.mu.Lock()
	defer scheduler.mu.Unlock()
	reconcile()
}

const (
	shortcutSelectionA = "80000000-0000-4000-8000-000000000a01"
	shortcutSelectionB = "80000000-0000-4000-8000-000000000a02"
)

func newShortcutUnderTest(fixture *shortcutFixture, pausePress, stopPress func(string)) *computerEmergencyShortcut {
	shortcut := newComputerEmergencyShortcut(pausePress, stopPress)
	shortcut.register = fixture.register
	shortcut.unregister = fixture.unregister
	scheduler := &shortcutInlineScheduler{}
	shortcut.schedule = scheduler.schedule
	return shortcut
}

type shortcutScheduler struct {
	mu      sync.Mutex
	pending []func()
}

func (scheduler *shortcutScheduler) schedule(reconcile func()) {
	scheduler.mu.Lock()
	scheduler.pending = append(scheduler.pending, reconcile)
	scheduler.mu.Unlock()
}

func (scheduler *shortcutScheduler) next(t *testing.T) func() {
	t.Helper()
	scheduler.mu.Lock()
	defer scheduler.mu.Unlock()
	if len(scheduler.pending) == 0 {
		t.Fatal("no shortcut reconcile was scheduled")
	}
	reconcile := scheduler.pending[0]
	scheduler.pending[0] = nil
	scheduler.pending = scheduler.pending[1:]
	return reconcile
}

func (scheduler *shortcutScheduler) pendingCount() int {
	scheduler.mu.Lock()
	defer scheduler.mu.Unlock()
	return len(scheduler.pending)
}

func (scheduler *shortcutScheduler) runAll(t *testing.T) {
	t.Helper()
	for scheduler.pendingCount() > 0 {
		scheduler.next(t)()
	}
}

func awaitShortcutPress(t *testing.T, pressed <-chan struct{}, name string) {
	t.Helper()
	select {
	case <-pressed:
	case <-time.After(time.Second):
		t.Fatalf("the %s shortcut did not press", name)
	}
}

func expectNoShortcutPress(t *testing.T, pressed <-chan struct{}, name string) {
	t.Helper()
	select {
	case <-pressed:
		t.Fatalf("an obsolete %s shortcut dispatched work", name)
	case <-time.After(100 * time.Millisecond):
	}
}

func awaitShortcutSelection(t *testing.T, pressed <-chan string, want, name string) {
	t.Helper()
	select {
	case selectionID := <-pressed:
		if selectionID != want {
			t.Fatalf("the %s shortcut dispatched for selection %q, want %q", name, selectionID, want)
		}
	case <-time.After(time.Second):
		t.Fatalf("the %s shortcut did not press", name)
	}
}

func expectNoShortcutSelection(t *testing.T, pressed <-chan string, name string) {
	t.Helper()
	select {
	case selectionID := <-pressed:
		t.Fatalf("an obsolete %s shortcut dispatched for %q", name, selectionID)
	case <-time.After(100 * time.Millisecond):
	}
}

// awaitShortcutCompletion waits for one action goroutine to return. The channel
// carries the selection the action ran for, so a stale no-op and a real press
// are both observable without closing a shared channel twice.
func awaitShortcutCompletion(t *testing.T, completed <-chan string, want, name string) {
	t.Helper()
	select {
	case selectionID := <-completed:
		if selectionID != want {
			t.Fatalf("the %s action completed for selection %q, want %q", name, selectionID, want)
		}
	case <-time.After(5 * time.Second):
		t.Fatalf("the %s action did not complete", name)
	}
}

func TestComputerShortcutBindsPauseAndStopOnlyWhileEligibleAndBackgrounded(t *testing.T) {
	fixture := newShortcutFixture()
	paused := make(chan struct{}, 4)
	stopped := make(chan struct{}, 4)
	shortcut := newShortcutUnderTest(fixture, func(string) { paused <- struct{}{} }, func(string) { stopped <- struct{}{} })

	shortcut.setDesired(shortcutSelectionA, shortcutSelectionA)
	shortcut.setForeground(false)
	if fixture.isBound(computerEmergencyPauseAccelerator) || fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("an ineligible app bound a global shortcut")
	}
	shortcut.setEligible(true)
	if !fixture.isBound(computerEmergencyPauseAccelerator) {
		t.Fatal("an eligible background app did not bind Pause")
	}
	if !fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("an eligible background app did not bind Stop")
	}
	if binding := fixture.boundAccelerators(); len(binding) != 2 ||
		binding[0] != computerEmergencyPauseAccelerator || binding[1] != computerEmergencyStopAccelerator {
		t.Fatalf("the shortcuts bound %v", binding)
	}
	// A second background notification cannot double-bind either chord.
	shortcut.setForeground(false)
	if binding := fixture.boundAccelerators(); len(binding) != 2 {
		t.Fatalf("a repeated background notification rebound a shortcut: %v", binding)
	}

	fixture.press(computerEmergencyPauseAccelerator)
	awaitShortcutPress(t, paused, "Pause")
	fixture.press(computerEmergencyStopAccelerator)
	awaitShortcutPress(t, stopped, "Stop")

	// The app's own focus releases both bindings, leaving the native menu
	// accelerators as the only paths (no double firing).
	shortcut.setForeground(true)
	if fixture.isBound(computerEmergencyPauseAccelerator) || fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("a foreground app kept a global shortcut")
	}
	shortcut.setForeground(false)
	if !fixture.isBound(computerEmergencyPauseAccelerator) || !fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("backgrounding did not restore both shortcuts")
	}

	// Stop is independent of the input-open Pause arm.
	shortcut.setDesired("", shortcutSelectionA)
	if fixture.isBound(computerEmergencyPauseAccelerator) {
		t.Fatal("Pause stayed armed without an input-open selection")
	}
	if !fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("Stop was released while the selection was still stoppable")
	}
	shortcut.setDesired(shortcutSelectionA, "")
	if !fixture.isBound(computerEmergencyPauseAccelerator) {
		t.Fatal("Pause was not armed for an input-open selection")
	}
	if fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("Stop stayed armed without a selection")
	}
}

func TestComputerShortcutFailureOfOneBindingLeavesTheOtherAndQuitIntact(t *testing.T) {
	fixture := newShortcutFixture()
	shortcut := newShortcutUnderTest(fixture, func(string) {}, func(string) {})
	fixture.setFail(computerEmergencyStopAccelerator, true)

	shortcut.setEligible(true)
	shortcut.setForeground(false)
	shortcut.setDesired(shortcutSelectionA, shortcutSelectionA)
	if !fixture.isBound(computerEmergencyPauseAccelerator) {
		t.Fatal("a failed Stop registration also prevented Pause from binding")
	}
	if fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("a failed Stop registration reported bound")
	}
	if attempts := fixture.attemptCount(computerEmergencyStopAccelerator); attempts != 1 {
		t.Fatalf("Stop registration was attempted %d times", attempts)
	}

	// Duplicate reconciles at the same lifecycle revision must not retry a
	// failed registration in a loop.
	shortcut.reconcile()
	shortcut.setForeground(false)
	if attempts := fixture.attemptCount(computerEmergencyStopAccelerator); attempts != 1 {
		t.Fatalf("a duplicate reconcile retried Stop %d times", attempts)
	}

	shortcut.quitBinding()
	if fixture.isBound(computerEmergencyPauseAccelerator) || fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("quit kept a global shortcut")
	}
	if unbound := fixture.unboundAccelerators(); len(unbound) != 1 || unbound[0] != computerEmergencyPauseAccelerator {
		t.Fatalf("quit unregistered bindings it did not own: %v", unbound)
	}
	if attempts := fixture.attemptCount(computerEmergencyStopAccelerator); attempts != 1 {
		t.Fatalf("quit retried the failed Stop registration: %d", attempts)
	}

	// A canceled quit is a later lifecycle change and may retry the failed arm
	// once; the successful Pause binding is restored independently.
	shortcut.restore()
	if !fixture.isBound(computerEmergencyPauseAccelerator) {
		t.Fatal("a canceled quit did not restore Pause")
	}
	if fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("a canceled quit bound Stop while registration still failed")
	}
	if attempts := fixture.attemptCount(computerEmergencyStopAccelerator); attempts != 2 {
		t.Fatalf("the canceled quit did not make exactly one new Stop attempt: %d", attempts)
	}

	// A later real focus change can try again once the binding is available.
	fixture.setFail(computerEmergencyStopAccelerator, false)
	shortcut.setForeground(true)
	shortcut.setForeground(false)
	if !fixture.isBound(computerEmergencyPauseAccelerator) || !fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("a later focus change did not retry and bind both shortcuts")
	}
	shortcut.quitBinding()
	if fixture.isBound(computerEmergencyPauseAccelerator) || fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("the final quit did not release both shortcuts")
	}
}

func TestComputerShortcutPauseFailureStillBindsStop(t *testing.T) {
	fixture := newShortcutFixture()
	shortcut := newShortcutUnderTest(fixture, func(string) {}, func(string) {})
	fixture.setFail(computerEmergencyPauseAccelerator, true)

	shortcut.setEligible(true)
	shortcut.setForeground(false)
	shortcut.setDesired(shortcutSelectionA, shortcutSelectionA)
	if fixture.isBound(computerEmergencyPauseAccelerator) {
		t.Fatal("a failed Pause registration reported bound")
	}
	if !fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("a failed Pause registration also prevented Stop from binding")
	}

	shortcut.quitBinding()
	if fixture.isBound(computerEmergencyPauseAccelerator) || fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("quit kept a global shortcut after a failed Pause registration")
	}
	if unbound := fixture.unboundAccelerators(); len(unbound) != 1 || unbound[0] != computerEmergencyStopAccelerator {
		t.Fatalf("quit unregistered bindings it did not own: %v", unbound)
	}
}

func TestComputerShortcutDelayedReconcileUsesTheLatestArms(t *testing.T) {
	fixture := newShortcutFixture()
	scheduler := &shortcutScheduler{}
	shortcut := newShortcutUnderTest(fixture, func(string) {}, func(string) {})
	shortcut.schedule = scheduler.schedule

	shortcut.setEligible(true)
	shortcut.setForeground(false)
	scheduler.runAll(t)
	shortcut.setDesired(shortcutSelectionA, shortcutSelectionA)
	shortcut.setDesired("", "")
	scheduler.next(t)()
	if fixture.isBound(computerEmergencyPauseAccelerator) || fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("a delayed stale arm bound a shortcut after the live arms were cleared")
	}
	scheduler.next(t)()
	if fixture.isBound(computerEmergencyPauseAccelerator) || fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("the cleared shortcut bound on a second delayed reconcile")
	}

	shortcut.setDesired(shortcutSelectionA, shortcutSelectionA)
	scheduler.next(t)()
	if !fixture.isBound(computerEmergencyPauseAccelerator) || !fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("the latest armed state did not bind both shortcuts")
	}

	// A delayed disarm invalidates the old registration; rearming before the
	// queued reconcile replaces it with a live one.
	shortcut.setDesired("", "")
	shortcut.setDesired(shortcutSelectionA, shortcutSelectionA)
	scheduler.next(t)()
	if !fixture.isBound(computerEmergencyPauseAccelerator) || !fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("a stale delayed disarm released the newly rearmed shortcuts")
	}
	scheduler.next(t)()
	if !fixture.isBound(computerEmergencyPauseAccelerator) || !fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("the repeated latest reconcile released a live shortcut")
	}

	// Repeating the same arms is not a new lifecycle state and must not queue
	// another native reconcile.
	before := scheduler.pendingCount()
	shortcut.setDesired(shortcutSelectionA, shortcutSelectionA)
	if after := scheduler.pendingCount(); after != before {
		t.Fatalf("unchanged arms queued %d reconciles", after-before)
	}
}

func TestComputerShortcutFocusReleasesSynchronouslyWithoutRebindingFromQueuedWork(t *testing.T) {
	fixture := newShortcutFixture()
	scheduler := &shortcutScheduler{}
	paused := make(chan struct{}, 4)
	stopped := make(chan struct{}, 4)
	shortcut := newShortcutUnderTest(fixture,
		func(string) { paused <- struct{}{} }, func(string) { stopped <- struct{}{} })
	shortcut.schedule = scheduler.schedule

	shortcut.setEligible(true)
	shortcut.setForeground(false)
	shortcut.setDesired(shortcutSelectionA, shortcutSelectionA)
	scheduler.next(t)()
	oldPause := fixture.callback(computerEmergencyPauseAccelerator)
	oldStop := fixture.callback(computerEmergencyStopAccelerator)
	if oldPause == nil || oldStop == nil {
		t.Fatal("the fixture did not retain both registered callbacks")
	}

	// Leave delayed arm changes queued, then release on the foreground hook.
	// The release must complete before the hook returns, and the queued work
	// must not provide a second path while the app is active.
	shortcut.setDesired("", shortcutSelectionA)
	shortcut.setDesired(shortcutSelectionA, shortcutSelectionA)
	pending := scheduler.pendingCount()
	if pending == 0 {
		t.Fatal("the fixture did not queue the delayed arm changes")
	}
	shortcut.setForeground(true)
	if fixture.isBound(computerEmergencyPauseAccelerator) || fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("a foreground focus change waited for the delayed reconcile to release")
	}
	if queued := scheduler.pendingCount(); queued != pending {
		t.Fatalf("the foreground focus change queued %d extra reconciles", queued-pending)
	}
	oldPause()
	oldStop()
	expectNoShortcutPress(t, paused, "Pause")
	expectNoShortcutPress(t, stopped, "Stop")

	scheduler.runAll(t)
	if fixture.isBound(computerEmergencyPauseAccelerator) || fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("queued work rebound a shortcut while the app was active")
	}

	shortcut.setForeground(false)
	if !fixture.isBound(computerEmergencyPauseAccelerator) || !fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("backgrounding did not restore both shortcuts synchronously")
	}
	fixture.press(computerEmergencyPauseAccelerator)
	awaitShortcutPress(t, paused, "Pause")
	fixture.press(computerEmergencyStopAccelerator)
	awaitShortcutPress(t, stopped, "Stop")
}

func TestComputerShortcutRearmBeforeQueuedReconcileReplacesStaleRegistration(t *testing.T) {
	fixture := newShortcutFixture()
	scheduler := &shortcutScheduler{}
	stopped := make(chan struct{}, 4)
	shortcut := newShortcutUnderTest(fixture, func(string) {}, func(string) { stopped <- struct{}{} })
	shortcut.schedule = scheduler.schedule

	shortcut.setEligible(true)
	shortcut.setForeground(false)
	shortcut.setDesired("", shortcutSelectionA)
	scheduler.next(t)()
	oldStop := fixture.callback(computerEmergencyStopAccelerator)
	if oldStop == nil {
		t.Fatal("the fixture did not retain the registered Stop callback")
	}

	// Disarm and rearm before the queued release runs. The old registration is
	// still native, but its logical lease ended with the disarm.
	shortcut.setDesired("", "")
	shortcut.setDesired("", shortcutSelectionA)
	oldStop()
	expectNoShortcutPress(t, stopped, "Stop")

	scheduler.runAll(t)
	if !fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("the rearmed Stop did not replace its outdated registration")
	}
	if attempts := fixture.attemptCount(computerEmergencyStopAccelerator); attempts != 2 {
		t.Fatalf("the replacement Stop made %d registration attempts", attempts)
	}
	newStop := fixture.callback(computerEmergencyStopAccelerator)
	if newStop == nil {
		t.Fatal("the fixture did not retain the replacement Stop callback")
	}
	oldStop()
	expectNoShortcutPress(t, stopped, "Stop")
	newStop()
	awaitShortcutPress(t, stopped, "Stop")

	// An idle selection has no registration, and a retained callback cannot
	// replay the earlier Stop.
	shortcut.setDesired("", "")
	scheduler.runAll(t)
	if fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("an idle selection kept Stop bound")
	}
	newStop()
	expectNoShortcutPress(t, stopped, "Stop")
}

func TestComputerShortcutDisarmAndRearmDuringRegistrationInvalidatesTheInFlightAttempt(t *testing.T) {
	fixture := newShortcutFixture()
	scheduler := &shortcutScheduler{}
	stopped := make(chan struct{}, 4)
	shortcut := newShortcutUnderTest(fixture, func(string) {}, func(string) { stopped <- struct{}{} })
	shortcut.schedule = scheduler.schedule

	shortcut.setEligible(true)
	shortcut.setForeground(false)
	shortcut.setDesired("", shortcutSelectionA)
	registration := scheduler.next(t)

	// The first Stop registration is in flight while the controller, which
	// records state off the UI thread, disarms and rearms for a new selection.
	// The delayed scheduler keeps the latest-state reconcile queued until the
	// native Register call returns.
	var inFlight func()
	shortcut.register = func(accelerator string, press func()) error {
		if accelerator == computerEmergencyStopAccelerator && inFlight == nil {
			inFlight = press
			shortcut.setDesired("", "")
			shortcut.setDesired("", shortcutSelectionA)
		}
		return fixture.register(accelerator, press)
	}
	registration()

	if inFlight == nil {
		t.Fatal("the fixture did not capture the in-flight Stop callback")
	}
	if fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("the invalidated in-flight Stop registration stayed installed")
	}
	if unbound := fixture.unboundAccelerators(); len(unbound) != 1 || unbound[0] != computerEmergencyStopAccelerator {
		t.Fatalf("the invalidated in-flight Stop registration released %v", unbound)
	}
	inFlight()
	expectNoShortcutPress(t, stopped, "Stop")

	// The duplicate queued work from the disarm and rearm must install exactly
	// one replacement and keep the retained first callback inert.
	scheduler.runAll(t)
	if !fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("the latest armed state did not replace the invalidated Stop registration")
	}
	if attempts := fixture.attemptCount(computerEmergencyStopAccelerator); attempts != 2 {
		t.Fatalf("the replacement Stop made %d registration attempts", attempts)
	}
	inFlight()
	expectNoShortcutPress(t, stopped, "Stop")

	replacement := fixture.callback(computerEmergencyStopAccelerator)
	if replacement == nil {
		t.Fatal("the fixture did not retain the replacement Stop callback")
	}
	replacement()
	awaitShortcutPress(t, stopped, "Stop")

	// A reconcile after the queued work sees the installed owner and must not
	// add a third registration.
	shortcut.reconcile()
	if attempts := fixture.attemptCount(computerEmergencyStopAccelerator); attempts != 2 {
		t.Fatalf("duplicate queued work added a registration: %d attempts", attempts)
	}
	inFlight()
	expectNoShortcutPress(t, stopped, "Stop")
	replacement()
	awaitShortcutPress(t, stopped, "Stop")
}

func TestComputerShortcutStaleCallbackCannotFireAfterDisarmOrRearm(t *testing.T) {
	fixture := newShortcutFixture()
	scheduler := &shortcutScheduler{}
	paused := make(chan struct{}, 4)
	stopped := make(chan struct{}, 4)
	shortcut := newShortcutUnderTest(fixture, func(string) { paused <- struct{}{} }, func(string) { stopped <- struct{}{} })
	shortcut.schedule = scheduler.schedule

	shortcut.setEligible(true)
	shortcut.setForeground(false)
	scheduler.runAll(t)
	shortcut.setDesired(shortcutSelectionA, shortcutSelectionA)
	scheduler.next(t)()
	oldPause := fixture.callback(computerEmergencyPauseAccelerator)
	oldStop := fixture.callback(computerEmergencyStopAccelerator)
	if oldPause == nil || oldStop == nil {
		t.Fatal("the fixture did not retain both registered callbacks")
	}

	// The callback checks the live desired eligibility, not only the binding
	// that registered it. Pause is disarmed before its delayed reconcile.
	shortcut.setDesired("", shortcutSelectionA)
	if oldPause != nil {
		oldPause()
	}
	expectNoShortcutPress(t, paused, "Pause")
	oldStop()
	awaitShortcutPress(t, stopped, "Stop")
	scheduler.next(t)()
	if fixture.isBound(computerEmergencyPauseAccelerator) {
		t.Fatal("the delayed Pause disarm did not release its binding")
	}

	// Quit and restore register Stop again, so its old callback is from an
	// obsolete registration. The Pause rearm then gets a fresh generation too.
	shortcut.quitBinding()
	shortcut.restore()
	shortcut.setDesired(shortcutSelectionA, shortcutSelectionA)
	scheduler.next(t)()
	if !fixture.isBound(computerEmergencyPauseAccelerator) || !fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("the rearmed shortcuts did not bind")
	}
	oldPause()
	oldStop()
	expectNoShortcutPress(t, paused, "Pause")
	expectNoShortcutPress(t, stopped, "Stop")

	fixture.press(computerEmergencyPauseAccelerator)
	awaitShortcutPress(t, paused, "Pause")
	fixture.press(computerEmergencyStopAccelerator)
	awaitShortcutPress(t, stopped, "Stop")
}

func TestComputerShortcutPressNeverBlocksTheMainThread(t *testing.T) {
	fixture := newShortcutFixture()
	release := make(chan struct{})
	shortcut := newShortcutUnderTest(fixture, func(string) {}, func(string) { <-release })
	shortcut.setEligible(true)
	shortcut.setForeground(false)
	shortcut.setDesired("", shortcutSelectionA)

	done := make(chan struct{})
	go func() {
		fixture.press(computerEmergencyStopAccelerator)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("the shortcut callback blocked on the stop work")
	}
	close(release)
}

func TestComputerShortcutQuitReleasesAndCanceledQuitRestores(t *testing.T) {
	fixture := newShortcutFixture()
	shortcut := newShortcutUnderTest(fixture, func(string) {}, func(string) {})
	shortcut.setEligible(true)
	shortcut.setForeground(false)
	shortcut.setDesired(shortcutSelectionA, shortcutSelectionA)
	if !fixture.isBound(computerEmergencyPauseAccelerator) || !fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("the shortcuts were not bound before quit")
	}

	shortcut.quitBinding()
	if fixture.isBound(computerEmergencyPauseAccelerator) || fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("quit kept a global shortcut")
	}
	// A canceled quit restores the bindings only for an eligible background app.
	shortcut.restore()
	if !fixture.isBound(computerEmergencyPauseAccelerator) || !fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("a canceled quit did not restore both shortcuts")
	}
	shortcut.quitBinding()
	shortcut.setForeground(true)
	shortcut.restore()
	if fixture.isBound(computerEmergencyPauseAccelerator) || fixture.isBound(computerEmergencyStopAccelerator) {
		t.Fatal("a foreground app bound a shortcut during restore")
	}
}

// TestComputerShortcutSelectionChangeInvalidatesKeptRegistrations proves a
// nonempty A -> B arm change with the same logical boolean arms retargets both
// chords immediately: the retained callbacks dispatch nothing, and exactly one
// replacement per chord is installed for the exact new selection.
func TestComputerShortcutSelectionChangeInvalidatesKeptRegistrations(t *testing.T) {
	fixture := newShortcutFixture()
	scheduler := &shortcutScheduler{}
	pressed := make(chan string, 8)
	shortcut := newShortcutUnderTest(fixture,
		func(selectionID string) { pressed <- selectionID },
		func(selectionID string) { pressed <- selectionID })
	shortcut.schedule = scheduler.schedule
	shortcut.setEligible(true)
	shortcut.setForeground(false)
	shortcut.setDesired(shortcutSelectionA, shortcutSelectionA)
	scheduler.next(t)()
	oldPause := fixture.callback(computerEmergencyPauseAccelerator)
	oldStop := fixture.callback(computerEmergencyStopAccelerator)
	if oldPause == nil || oldStop == nil {
		t.Fatal("the fixture did not retain both registered callbacks")
	}
	for _, accelerator := range []string{computerEmergencyPauseAccelerator, computerEmergencyStopAccelerator} {
		if attempts := fixture.attemptCount(accelerator); attempts != 1 {
			t.Fatalf("%s made %d initial registration attempts", accelerator, attempts)
		}
	}

	// Both arms stay nonempty, so a boolean-only owner would see no change even
	// though they now name a different selection.
	shortcut.setDesired(shortcutSelectionB, shortcutSelectionB)
	oldPause()
	oldStop()
	expectNoShortcutSelection(t, pressed, "Pause")
	expectNoShortcutSelection(t, pressed, "Stop")

	scheduler.runAll(t)
	for _, accelerator := range []string{computerEmergencyPauseAccelerator, computerEmergencyStopAccelerator} {
		if attempts := fixture.attemptCount(accelerator); attempts != 2 {
			t.Fatalf("%s made %d registration attempts, want exactly one replacement", accelerator, attempts)
		}
		if !fixture.isBound(accelerator) {
			t.Fatalf("%s was not bound to the replacement selection", accelerator)
		}
	}
	newPause := fixture.callback(computerEmergencyPauseAccelerator)
	newStop := fixture.callback(computerEmergencyStopAccelerator)
	if newPause == nil || newStop == nil {
		t.Fatal("the fixture did not retain the replacement callbacks")
	}
	newPause()
	awaitShortcutSelection(t, pressed, shortcutSelectionB, "Pause")
	newStop()
	awaitShortcutSelection(t, pressed, shortcutSelectionB, "Stop")
	oldPause()
	oldStop()
	expectNoShortcutSelection(t, pressed, "Pause")
	expectNoShortcutSelection(t, pressed, "Stop")
}
