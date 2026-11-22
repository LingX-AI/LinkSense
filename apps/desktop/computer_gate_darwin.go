//go:build darwin

package main

// computerExecutorGate is the only value the device ingress host dispatches
// computer.execute to. It blocks new input the moment the product pauses or
// stops a selection, waits for the in-flight executor to become terminal
// before a pause/stop is acknowledged, and supplies the single-use host proof
// the signed executor requires for one exact mutating input.
//
// The proof is derived from the input that already passed computer.go's exact
// WS admission: strict envelope/body parse, negotiated link, owner/link/
// conversation/runtime/turn/session/selection binding, holder, one receipt per
// transport id, and the item deadline. No renderer, model or raw socket frame
// reaches this type directly, and a proof never outlives its one act call
// except through a pre-consumption failure, which invalidates the refs.

import (
	"context"
	"sync"
	"time"
)

// computerProductExecutor is the one executor the product host installs. The
// concrete macOS implementation is the signed agent-desktop executor.
type computerProductExecutor interface {
	m1bComputerExecutor
	selectHostSelection(m1bComputerSelection) error
	authorize(computerHostAuthorization) error
	close() error
}

type computerExecutorGate struct {
	mu        sync.Mutex
	inner     computerProductExecutor
	inputOpen bool
	actDone   chan struct{}
	// retiredBinding is the exact last selection detached by retirement. It is
	// never input-open; it exists only so the correlated server quiesce for the
	// just-retired selection can still match its holder after the driver close.
	// A fresh install replaces it and the tombstone deadline bounds it.
	retiredBinding m1bComputerSelection
	retiredUntil   time.Time
}

func (gate *computerExecutorGate) selection() m1bComputerSelection {
	gate.mu.Lock()
	defer gate.mu.Unlock()
	return gate.selectionLocked(time.Now())
}

func (gate *computerExecutorGate) selectionLocked(now time.Time) m1bComputerSelection {
	if gate.inner != nil {
		return gate.inner.selection()
	}
	if gate.retiredBinding.SelectionID != "" && now.Before(gate.retiredUntil) {
		return gate.retiredBinding
	}
	return m1bComputerSelection{}
}

func (gate *computerExecutorGate) status(ctx context.Context, selection m1bComputerSelection) m1bComputerResult {
	if ctx == nil {
		return m1bComputerFailure("COMPUTER_INVALID")
	}
	gate.mu.Lock()
	inner := gate.inner
	gate.mu.Unlock()
	if inner == nil {
		return m1bComputerFailure("COMPUTER_UNAVAILABLE")
	}
	return inner.status(ctx, selection)
}

func (gate *computerExecutorGate) observe(ctx context.Context, selection m1bComputerSelection) m1bComputerResult {
	if ctx == nil {
		return m1bComputerFailure("COMPUTER_INVALID")
	}
	gate.mu.Lock()
	inner, failure := gate.readableLocked(selection)
	gate.mu.Unlock()
	if failure != "" {
		return m1bComputerFailure(failure)
	}
	return inner.observe(ctx, selection)
}

func (gate *computerExecutorGate) act(ctx context.Context, selection m1bComputerSelection, nativeCallID string, input m1bComputerAct) m1bComputerResult {
	if ctx == nil {
		return m1bComputerActOutcome(m1bComputerActResult{OK: false, Error: "COMPUTER_INVALID"})
	}
	gate.mu.Lock()
	inner, failure := gate.readableLocked(selection)
	if failure != "" {
		gate.mu.Unlock()
		return m1bComputerActOutcome(m1bComputerActResult{OK: false, Error: failure})
	}
	if gate.actDone != nil {
		gate.mu.Unlock()
		return m1bComputerActOutcome(m1bComputerActResult{OK: false, Error: "DEVICE_BUSY"})
	}
	if selection.ExpiresAt.IsZero() || !time.Now().Before(selection.ExpiresAt) {
		gate.mu.Unlock()
		return m1bComputerActOutcome(m1bComputerActResult{OK: false, Error: "COMPUTER_TIMEOUT"})
	}
	done := make(chan struct{})
	gate.actDone = done
	gate.mu.Unlock()
	defer func() {
		gate.mu.Lock()
		if gate.actDone == done {
			gate.actDone = nil
		}
		close(done)
		gate.mu.Unlock()
	}()

	// The proof is bound to this exact parser-normalized input and selection
	// expiry, and is consumed by the executor inside this one act call.
	authorization, err := newComputerHostAuthorization(selection, nativeCallID, input, selection.ExpiresAt)
	if err != nil {
		return m1bComputerActOutcome(m1bComputerActResult{OK: false, Error: "COMPUTER_ACCESS_DENIED"})
	}
	if err := inner.authorize(authorization); err != nil {
		return m1bComputerActOutcome(m1bComputerActResult{OK: false, Error: "COMPUTER_ACCESS_DENIED"})
	}
	result := inner.act(ctx, selection, nativeCallID, input)
	if !result.act.OK && gateProofMayRemain(result.act.Error) {
		// The executor rejected before consuming the proof. Clear the stored
		// refs and the pending proof so no later input can inherit it; the next
		// act must be preceded by a fresh observe.
		inner.invalidate(selection)
	}
	return result
}

// gateProofMayRemain lists the executor failures that occur before the
// one-shot proof is consumed. consumeAuthorization clears the proof itself when
// the input does not match, so only these need an explicit invalidation.
func gateProofMayRemain(code string) bool {
	switch code {
	case "DEVICE_BUSY", "COMPUTER_TARGET_CHANGED", "COMPUTER_UNAVAILABLE", "COMPUTER_ACCESS_DENIED":
		return true
	default:
		return false
	}
}

func (gate *computerExecutorGate) invalidate(selection m1bComputerSelection) {
	gate.mu.Lock()
	inner := gate.inner
	gate.mu.Unlock()
	if inner != nil {
		inner.invalidate(selection)
	}
}

func (gate *computerExecutorGate) readableLocked(selection m1bComputerSelection) (computerProductExecutor, string) {
	if gate.inner == nil || !sameComputerBinding(gate.inner.selection(), selection) {
		return nil, "COMPUTER_TARGET_CHANGED"
	}
	if !gate.inputOpen {
		// Paused or stopped: the binding is still known but no input may enter.
		return nil, "COMPUTER_ACCESS_DENIED"
	}
	return gate.inner, ""
}

func (gate *computerExecutorGate) install(executor computerProductExecutor) {
	gate.mu.Lock()
	gate.inner = executor
	gate.inputOpen = true
	gate.actDone = nil
	gate.retiredBinding = m1bComputerSelection{}
	gate.retiredUntil = time.Time{}
	gate.mu.Unlock()
}

func (gate *computerExecutorGate) resume(executor computerProductExecutor, selection m1bComputerSelection) error {
	gate.mu.Lock()
	current := gate.inner == executor
	gate.mu.Unlock()
	if !current {
		return errComputerUnavailable
	}
	if err := executor.selectHostSelection(selection); err != nil {
		return err
	}
	gate.mu.Lock()
	if gate.inner == executor {
		gate.inputOpen = true
	}
	gate.mu.Unlock()
	return nil
}

// closeInputIf closes the boundary only for the exact executor a product
// transition owns. A newer executor installed after an asynchronous reset,
// expiry or terminal snapshot is never closed by the older transition.
func (gate *computerExecutorGate) closeInputIf(executor computerProductExecutor) {
	gate.mu.Lock()
	if gate.inner == executor {
		gate.inputOpen = false
	}
	gate.mu.Unlock()
}

// quiesce closes input, invalidates the exact selection's refs and waits for
// the in-flight act to become terminal. Both the installed executor and its
// exact binding must still be the caller's; otherwise the transition is stale
// and its wait is released immediately without closing input, invalidating or
// waiting on a newer action (the caller's epoch check then rejects it). The
// match, input close and actDone capture are
// one critical section, so a resumed epoch on the same executor is never
// touched. Invalidation runs synchronously (outside the gate lock) so the
// executor's preflight is canceled before the caller's network wait starts;
// the returned channel ends when that exact act is terminal or ctx is done.
func (gate *computerExecutorGate) quiesce(ctx context.Context, executor computerProductExecutor, selection m1bComputerSelection) <-chan bool {
	result := make(chan bool, 1)
	gate.mu.Lock()
	if gate.inner != executor || gate.inner.selection().bindingKey() != selection.bindingKey() {
		gate.mu.Unlock()
		result <- true
		return result
	}
	gate.inputOpen = false
	done := gate.actDone
	gate.mu.Unlock()
	executor.invalidate(selection)
	if done == nil {
		result <- true
		return result
	}
	go func() {
		select {
		case <-done:
			result <- true
		case <-ctx.Done():
			result <- false
		}
	}()
	return result
}

// open reports whether the current executor can still admit input. The
// emergency shortcut derives its binding from this exact live state.
func (gate *computerExecutorGate) open() bool {
	gate.mu.Lock()
	defer gate.mu.Unlock()
	return gate.inner != nil && gate.inputOpen
}

// busy reports whether one exact act is inside the gate. A renewal must leave
// an admitted input exactly as it is.
func (gate *computerExecutorGate) busy() bool {
	gate.mu.Lock()
	defer gate.mu.Unlock()
	return gate.actDone != nil
}

// renew rebinds the exact installed executor to a strictly advancing expiry for
// the same host-picked selection identity. The gate must already be open and
// its one act slot idle; holding the gate lock across the rebind means a
// concurrent act either started before and is refused by the idle check, or
// starts after and sees the renewed binding. It never closes or reopens input,
// so a concurrent stop's closed boundary is not resurrected.
func (gate *computerExecutorGate) renew(executor computerProductExecutor, selection m1bComputerSelection) error {
	gate.mu.Lock()
	defer gate.mu.Unlock()
	if gate.inner != executor || !gate.inputOpen {
		return errComputerUnavailable
	}
	if gate.inner.selection().bindingKey() != selection.bindingKey() {
		// Renewal extends the exact selection identity only; a different
		// selection needs the explicit install/resume path.
		return errComputerUnavailable
	}
	if gate.actDone != nil {
		return errComputerBusy
	}
	return executor.selectHostSelection(selection)
}

// detachIf releases only the exact executor a product transition owns. An
// older asynchronous reset or expiry can therefore never detach a newer
// selection that was installed after it snapshotted its own executor.
func (gate *computerExecutorGate) detachIf(executor computerProductExecutor) {
	gate.mu.Lock()
	if gate.inner == executor {
		gate.inner = nil
		gate.inputOpen = false
	}
	gate.mu.Unlock()
}

// retireBinding detaches only the exact executor the retirement owns and keeps
// its id/expiry binding visible until the existing bounded tombstone deadline.
// It never reopens input, never touches a newer executor, and replaces any
// previous retained binding with the exact one being retired.
func (gate *computerExecutorGate) retireBinding(executor computerProductExecutor, selection m1bComputerSelection) {
	gate.mu.Lock()
	if gate.inner == executor {
		gate.inner = nil
		gate.inputOpen = false
		gate.retiredBinding = selection
		gate.retiredUntil = m1bComputerTombstoneDeadline(selection, time.Now())
	}
	gate.mu.Unlock()
}

// sameComputerBinding is the exact identity for observation/act admission: the
// full id binding plus the acknowledged expiry. Control-only quiesce and
// invalidate intentionally compare the id binding only, so they remain
// independent of the grant expiry.
func sameComputerBinding(a, b m1bComputerSelection) bool {
	return a.bindingKey() == b.bindingKey() && a.ExpiresAt.Equal(b.ExpiresAt)
}
