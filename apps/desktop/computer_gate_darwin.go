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

	// grant is the cancellation lifetime of one exact acknowledged selection.
	// The host derives an admitted wait's work/publication context from it, so
	// closing, expiring or renewing that same grant also aborts the bounded
	// final socket write instead of only the driver call. grantSelection is the
	// exact identity+expiry it belongs to; a stale transition for an older
	// expiry can never cancel a newer read.
	grant          context.Context
	grantCancel    context.CancelFunc
	grantSelection m1bComputerSelection
}

func (gate *computerExecutorGate) selection() m1bComputerSelection {
	gate.mu.Lock()
	defer gate.mu.Unlock()
	return gate.selectionLocked(time.Now())
}

// waitPublicationContext returns the context of the exact grant the host
// admitted this wait under. It remains available after cancellation so a wait
// dispatch racing the transition observes the closed grant rather than falling
// back to the transport context. A different identity or expiry gets no
// context and is fenced by the existing exact selection check.
func (gate *computerExecutorGate) waitPublicationContext(selection m1bComputerSelection) (context.Context, bool) {
	gate.mu.Lock()
	defer gate.mu.Unlock()
	if gate.grant == nil || !sameComputerBinding(gate.grantSelection, selection) {
		return nil, false
	}
	return gate.grant, true
}

// startGrantLocked installs the cancellation lifetime for the exact current
// grant. The previous lifetime is canceled first, so no publication admitted
// under it survives the transition, including one already blocked in a write.
func (gate *computerExecutorGate) startGrantLocked(selection m1bComputerSelection) {
	gate.cancelGrantLocked()
	grant, cancel := context.WithCancel(context.Background())
	gate.grant = grant
	gate.grantCancel = cancel
	gate.grantSelection = selection
}

func (gate *computerExecutorGate) cancelGrantLocked() {
	if gate.grantCancel != nil {
		gate.grantCancel()
		gate.grantCancel = nil
	}
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

// wait admits one read-only wait through the same open-boundary and exact
// binding check as observe/act. It consumes no act proof, sets no act slot, and
// is canceled through the executor's active-input run when input closes.
func (gate *computerExecutorGate) wait(ctx context.Context, selection m1bComputerSelection, input m1bComputerWait) m1bComputerResult {
	if ctx == nil {
		return m1bComputerFailure("COMPUTER_INVALID")
	}
	gate.mu.Lock()
	inner, failure := gate.readableLocked(selection)
	gate.mu.Unlock()
	if failure != "" {
		return m1bComputerFailure(failure)
	}
	if selection.ExpiresAt.IsZero() || !time.Now().Before(selection.ExpiresAt) {
		return m1bComputerFailure("COMPUTER_TIMEOUT")
	}
	return inner.wait(ctx, selection, input)
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
	gate.startGrantLocked(executor.selection())
	gate.mu.Unlock()
}

func (gate *computerExecutorGate) resume(executor computerProductExecutor, selection m1bComputerSelection) error {
	gate.mu.Lock()
	current := gate.inner == executor
	gate.mu.Unlock()
	if !current {
		return errComputerUnavailable
	}
	// Close the old exact grant before the binding transition so a result
	// already in the bounded write path cannot publish under the old grant.
	gate.mu.Lock()
	if gate.inner != executor {
		gate.mu.Unlock()
		return errComputerUnavailable
	}
	gate.cancelGrantLocked()
	gate.mu.Unlock()
	if err := executor.selectHostSelection(selection); err != nil {
		return err
	}
	gate.mu.Lock()
	if gate.inner == executor {
		gate.startGrantLocked(selection)
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
		gate.cancelGrantLocked()
	}
	gate.mu.Unlock()
}

// quiesce closes input, invalidates the exact selection's refs and waits for
// the in-flight act to become terminal. Both the installed executor and its
// exact binding, including the acknowledged expiry, must still be the caller's;
// otherwise the transition is stale and its wait is released immediately
// without closing input, clearing refs, canceling the renewed grant or waiting
// on a newer action (the caller's epoch check then rejects it). A same-identity
// renewal therefore makes a pause/stop snapshot carrying the prior expiry
// harmless, while the existing wire quiesce keeps its id-keyed takeover. The
// match, input close, grant cancel and actDone capture are one critical
// section, so a resumed epoch on the same executor is never touched.
// Invalidation runs synchronously (outside the gate lock) so the executor's
// preflight is canceled before the caller's network wait starts; the returned
// channel ends when that exact act is terminal or ctx is done.
func (gate *computerExecutorGate) quiesce(ctx context.Context, executor computerProductExecutor, selection m1bComputerSelection) <-chan bool {
	result := make(chan bool, 1)
	gate.mu.Lock()
	if gate.inner != executor || !sameComputerBinding(gate.inner.selection(), selection) {
		gate.mu.Unlock()
		result <- true
		return result
	}
	gate.inputOpen = false
	// This snapshot is the exact current binding, so its grant is the current
	// publication lifetime and must be closed with the input.
	gate.cancelGrantLocked()
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
// an admitted act exactly as it is. A read-only wait intentionally does not set
// this slot; the executor's generation cancellation fences it instead.
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
	// Cancel before the rebind: a wait result blocked in the final write must
	// observe the closed grant, while a later read for the renewed expiry gets
	// the fresh lifetime installed below.
	gate.cancelGrantLocked()
	if err := executor.selectHostSelection(selection); err != nil {
		return err
	}
	gate.startGrantLocked(selection)
	return nil
}

// detachIf releases only the exact executor a product transition owns. An
// older asynchronous reset or expiry can therefore never detach a newer
// selection that was installed after it snapshotted its own executor.
func (gate *computerExecutorGate) detachIf(executor computerProductExecutor) {
	gate.mu.Lock()
	if gate.inner == executor {
		gate.inner = nil
		gate.inputOpen = false
		gate.cancelGrantLocked()
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
		gate.cancelGrantLocked()
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
