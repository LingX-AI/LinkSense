//go:build darwin

package main

// macOS product controller for M1b computer control.
//
// Trust boundaries:
//   - The trusted main page selects an action and supplies only conversation
//     and turn ids. The target window is chosen by the native picker from the
//     signed driver's own inventory; the page, model, device socket and server
//     never choose it.
//   - The server scopes or denies a selection, but the ids needed to bind the
//     local executor (owner, link, session, runtime generation) are derived
//     here from the live authenticated connection and the server's correlated
//     acknowledgement.
//   - The executor is built only after the user gesture that opens the picker,
//     and only from the signed, packaged runtime. There is no prepared or ad
//     hoc fallback.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

const (
	computerControlSelectAckTimeout = 20 * time.Second
	computerControlPauseAckTimeout  = 15 * time.Second
	computerControlStopAckTimeout   = 15 * time.Second
	computerControlResumeAckTimeout = 15 * time.Second
	computerControlRenewAckTimeout  = 15 * time.Second
	computerControlPickerTimeout    = 2 * time.Minute
)

// computerPlatform is the only seam between the control state machine and the
// native driver. Tests replace it with synthetic inventory and executor
// implementations, so no CLI, codesign, TCC or window is touched.
type computerPlatform interface {
	driverEligible() bool
	pickTarget(ctx context.Context, desktop *Desktop) (computerSelectedTarget, error)
	newExecutor(ctx context.Context, desktop *Desktop, target computerSelectedTarget, selection m1bComputerSelection) (computerProductExecutor, error)
}

// computerControlRetirement is the one exact-executor release path for expiry,
// reset/connection loss, a run terminal and stop. It owns the executor until
// the exact act is terminal and the driver is closed; while it exists, status
// may not claim stopped and no fresh selection may be admitted. `stopped`
// selects the final published state (stopped scope or idle); reset downgrades
// an in-flight stop to idle because the link that could observe stopped is
// gone.
type computerControlRetirement struct {
	selection m1bComputerSelection
	executor  computerProductExecutor
	stopped   bool
	done      chan struct{}
}

type computerControl struct {
	desktop  *Desktop
	platform computerPlatform
	host     *m1bComputerHost
	gate     *computerExecutorGate

	mu        sync.Mutex
	state     string
	selection m1bComputerSelection
	// target is the immutable host-picked window that produced selection. Only
	// an explicit renewal replays its bundle; the page can never name it.
	target computerSelectedTarget
	// shortcutMu serializes the derived Pause/Stop arms, so a late update from
	// an old transition cannot apply after a newer one. Native shortcut
	// registration/unregistration never runs under this lock (or mu).
	shortcutMu sync.Mutex
	// terminal is the exact conversation/turn and socket generation that last
	// stopped, so only that scope sees `stopped`; every other scope sees idle.
	terminal computerControlTerminal
	executor computerProductExecutor
	epoch    uint64
	opCancel context.CancelFunc
	// retiring is the exact executor being retired. It replaces the executor
	// slot's admission rights even though the executor stays installed until
	// its act is terminal and close returns.
	retiring  *computerControlRetirement
	selecting bool
	// selectingScope is the conversation/turn whose picker is open. A renderer
	// action for another scope must not cancel it.
	selectingScope computerControlScope
	pausing        bool
	resuming       bool
	// renewing is the explicit same-selection extension in flight. It never
	// opens a picker, never closes input and never changes the native target.
	renewing bool
	timer    *time.Timer
}

func newDesktopComputerControl(desktop *Desktop) computerControlService {
	control := &computerControl{
		desktop:  desktop,
		platform: darwinComputerPlatform{desktop: desktop},
		gate:     &computerExecutorGate{},
		state:    computerControlStateIdle,
	}
	control.host = newM1BComputerHost(control.gate)
	return control
}

// prepareConnection attaches the shared ingress and the eligibility check to a
// newly created device connection. The ingress is offered only when a signed
// driver could be built here; an older server simply never negotiates the
// operation.
func (c *computerControl) prepareConnection(connection *deviceConnection) {
	c.reset()
	if connection == nil || !c.platform.driverEligible() {
		return
	}
	connection.computer = c.host
	connection.computerEligible = c.platform.driverEligible
	connection.onLinkEnded = func(session *deviceControlSession) { c.connectionEnded(connection, session) }
	connection.onRuntimeFrame = func(frame []byte) { c.observeRuntimeFrame(connection, frame) }
}

// connectionEnded invalidates every local selection bound to the connection
// whose socket generation ended. A reconnect never resumes or replays it. The
// exact connection and socket generation are rechecked under mu, the same lock
// that installs a selection, so a callback that lost a race to a newer live
// socket cannot detach or close the newer selection. A nil current device is
// the close/shutdown path, which must still release the executor.
func (c *computerControl) connectionEnded(connection *deviceConnection, session *deviceControlSession) {
	if connection == nil {
		return
	}
	if c.desktop == nil {
		c.reset()
		return
	}
	c.mu.Lock()
	if current := c.desktop.currentDevice(); current != nil && current != connection {
		c.mu.Unlock()
		return
	}
	// The read loop clears its session before this deferred callback runs, so a
	// nil session is this generation's own teardown. A different live session
	// means a newer socket generation already owns the connection; neither the
	// stale callback nor its old link may retire the newer selection.
	if live := connection.currentControlSession(); live != nil && live != session {
		c.mu.Unlock()
		return
	}
	if c.executor != nil || c.retiring != nil {
		selection := c.selection
		if session != nil && selection.LinkID != "" &&
			!strings.EqualFold(selection.LinkID, session.linkID) {
			c.mu.Unlock()
			return
		}
		if !strings.EqualFold(selection.OwnerID, connection.credential.OwnerID) {
			c.mu.Unlock()
			return
		}
	}
	retirement, start := c.resetLocked()
	c.mu.Unlock()
	c.syncEmergencyShortcut()
	if start {
		c.startRetirement(retirement)
	}
}

// reset cancels any pending operation and starts the one exact-executor
// retirement. It is idempotent and deliberately does not touch the server: a
// lost link, expiry or account change is not a reason to retry a side effect.
func (c *computerControl) reset() {
	c.mu.Lock()
	retirement, start := c.resetLocked()
	c.mu.Unlock()
	c.syncEmergencyShortcut()
	if start {
		c.startRetirement(retirement)
	}
}

// resetLocked clears derived state and, when an executor exists, hands it to
// the retirement path. The caller holds c.mu. No blocking close or terminal
// wait happens here; the retirement runs it after the lock is dropped.
func (c *computerControl) resetLocked() (*computerControlRetirement, bool) {
	c.epoch++
	if c.opCancel != nil {
		c.opCancel()
		c.opCancel = nil
	}
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	c.selectingScope = computerControlScope{}
	c.selecting, c.pausing, c.resuming, c.renewing = false, false, false, false
	executor := c.executor
	if executor == nil {
		// A retirement that is already running owns the only executor.
		if c.retiring == nil {
			c.state = computerControlStateIdle
			c.selection = m1bComputerSelection{}
			c.target = computerSelectedTarget{}
			c.terminal = computerControlTerminal{}
			c.gate.closeInputIf(nil)
			c.gate.detachIf(nil)
		}
		return nil, false
	}
	retirement, start := c.beginRetirementLocked(c.selection, executor, false)
	return retirement, start
}

// beginRetirementLocked starts (or joins) the one exact-executor retirement.
// It closes input for that executor synchronously, cancels any pending control
// operation and stops the grant timer, but never detaches or closes the
// executor and never changes the published state. The caller holds c.mu.
func (c *computerControl) beginRetirementLocked(selection m1bComputerSelection, executor computerProductExecutor, stopped bool) (*computerControlRetirement, bool) {
	if executor == nil {
		return nil, false
	}
	if c.retiring != nil {
		// A newer stop cannot turn a link-loss retirement back into a stopped
		// scope, and a reset downgrades a pending stop. Idle is sticky.
		if !stopped {
			c.retiring.stopped = false
		}
		return c.retiring, false
	}
	retirement := &computerControlRetirement{
		selection: selection, executor: executor, stopped: stopped, done: make(chan struct{}),
	}
	c.retiring = retirement
	c.epoch++
	if c.opCancel != nil {
		c.opCancel()
		c.opCancel = nil
	}
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	c.selectingScope = computerControlScope{}
	c.selecting, c.pausing, c.resuming, c.renewing = false, false, false, false
	c.gate.closeInputIf(executor)
	if c.host != nil {
		// Retain the exact adopted binding/holder for a correlated server
		// quiesce that can still arrive after the executor is detached, but
		// never admit a new observe/act for it. This reuses the existing host
		// binding state; it is not a second registry.
		c.host.retire(selection)
	}
	return retirement, true
}

// startRetirement waits for the exact executor's act terminal before closing
// the driver, then publishes the final state. Both waits run without c.mu, and
// a stale retirement can never clear a newer selection because finish checks
// pointer identity under the lock.
func (c *computerControl) startRetirement(retirement *computerControlRetirement) {
	if retirement == nil {
		return
	}
	go func() {
		quiesced := c.gate.quiesce(context.Background(), retirement.executor, retirement.selection)
		<-quiesced
		// Input release is proven by quiesce (exact act terminal and refs
		// cleared). Close only tears down the driver/state root; it marks itself
		// closed and clears refs before attempting cleanup, so its error is
		// cleanup-only and must not turn a proven stop into a retry.
		_ = retirement.executor.close()
		c.finishRetirement(retirement)
	}()
}

func (c *computerControl) finishRetirement(retirement *computerControlRetirement) {
	c.mu.Lock()
	if c.retiring != retirement {
		c.mu.Unlock()
		return
	}
	c.retiring = nil
	c.epoch++
	if c.opCancel != nil {
		c.opCancel()
		c.opCancel = nil
	}
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	c.selectingScope = computerControlScope{}
	c.selecting, c.pausing, c.resuming, c.renewing = false, false, false, false
	if c.executor == retirement.executor {
		c.executor = nil
		c.selection = m1bComputerSelection{}
		c.target = computerSelectedTarget{}
	}
	if retirement.stopped {
		c.state = computerControlStateStopped
		c.terminal = computerControlTerminal{
			computerControlScope: computerControlScope{
				ConversationID: retirement.selection.ConversationID,
				TurnID:         retirement.selection.TurnID,
			},
			OwnerID: retirement.selection.OwnerID,
			LinkID:  retirement.selection.LinkID,
		}
	} else {
		c.state = computerControlStateIdle
		c.terminal = computerControlTerminal{}
	}
	// Detach only the exact executor this retirement owns, but keep its
	// bounded binding visible so a correlated server quiesce for the just
	// retired selection can still prove its exact holder/publication. Input
	// stays closed and a newer executor is never touched.
	c.gate.retireBinding(retirement.executor, retirement.selection)
	c.mu.Unlock()
	c.syncEmergencyShortcut()
	close(retirement.done)
}

// awaitRetirement waits for the exact retirement to publish its final state
// and close its executor. The deadline only ends the caller's wait; the
// retirement itself continues and releases automatically at the real terminal.
func awaitRetirement(ctx context.Context, retirement *computerControlRetirement) bool {
	if retirement == nil {
		return true
	}
	select {
	case <-retirement.done:
		return true
	case <-ctx.Done():
		// The proof and the deadline can become ready in the same instant; a
		// ready exact retirement must not be turned into a timeout.
		select {
		case <-retirement.done:
			return true
		default:
			return false
		}
	}
}

// status is the one scope-bound read. It reports active, paused, retiring or
// stopped only for the exact owner, conversation/turn, live authenticated
// socket generation and the acknowledged selection link. Another scope always
// reads idle and never receives this selection's expiry. Active and paused are
// reported only with a still-live expiry; the bounded timer/retirement window
// reports retiring without an expiry so the page never receives an invalid
// active/paused grant.
func (c *computerControl) status(desktop *Desktop, conversationID, turnID string) ComputerControlStatus {
	unavailable := ComputerControlStatus{State: computerControlStateUnavailable}
	if c == nil || desktop == nil || c.host == nil {
		return unavailable
	}
	connection, session := c.usableConnection(desktop)
	if connection == nil || session == nil {
		return unavailable
	}
	ownerID := connection.credential.OwnerID
	c.mu.Lock()
	state, selection, terminal, retiring := c.state, c.selection, c.terminal, c.retiring
	c.mu.Unlock()
	switch state {
	case computerControlStateActive, computerControlStatePaused:
		if !strings.EqualFold(selection.ConversationID, conversationID) ||
			!strings.EqualFold(selection.TurnID, turnID) ||
			!strings.EqualFold(selection.LinkID, session.linkID) ||
			!strings.EqualFold(selection.OwnerID, ownerID) {
			return ComputerControlStatus{State: computerControlStateIdle}
		}
		if retiring != nil {
			// The exact act terminal and driver close are not proven yet. The
			// selection is no longer input-open, but it is not a completed stop.
			return ComputerControlStatus{State: computerControlStateRetiring}
		}
		// An elapsed grant is not proof that the prior act/driver is quiescent.
		// The bounded timer owns that transition; never claim active/paused
		// without a live expiry, and never claim stopped here.
		if selection.ExpiresAt.IsZero() || !time.Now().Before(selection.ExpiresAt) {
			return ComputerControlStatus{State: computerControlStateRetiring}
		}
		return ComputerControlStatus{
			State: state, ExpiresAt: selection.ExpiresAt.UTC().Format(time.RFC3339),
		}
	case computerControlStateStopped:
		if !strings.EqualFold(terminal.ConversationID, conversationID) ||
			!strings.EqualFold(terminal.TurnID, turnID) ||
			!strings.EqualFold(terminal.LinkID, session.linkID) ||
			!strings.EqualFold(terminal.OwnerID, ownerID) {
			return ComputerControlStatus{State: computerControlStateIdle}
		}
		return ComputerControlStatus{State: computerControlStateStopped}
	default:
		return ComputerControlStatus{State: computerControlStateIdle}
	}
}

func (c *computerControl) control(ctx context.Context, desktop *Desktop, conversationID, turnID, action string) (ComputerControlStatus, error) {
	if c == nil {
		return ComputerControlStatus{State: computerControlStateUnavailable}, errComputerUnavailable
	}
	scope, ok := newComputerControlScope(conversationID, turnID)
	if !ok {
		return ComputerControlStatus{State: computerControlStateUnavailable}, errComputerInvalid
	}
	var status ComputerControlStatus
	var err error
	switch action {
	case "status":
		return c.status(desktop, scope.ConversationID, scope.TurnID), nil
	case "select":
		status, err = c.selectTarget(ctx, desktop, scope)
	case "renew":
		status, err = c.renew(ctx, desktop, scope)
	case "pause":
		status, err = c.pause(ctx, desktop, scope)
	case "resume":
		status, err = c.resume(ctx, desktop, scope)
	case "stop":
		status, err = c.stop(ctx, desktop, scope)
	default:
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerInvalid
	}
	// retiring is a read-only status. Even a race that starts a retirement
	// between an early-return decision and this read must not turn a mutation
	// into a positive acknowledgement of that state.
	if err == nil && status.State == computerControlStateRetiring {
		return status, errComputerUnavailable
	}
	return status, err
}

// usableConnection returns the live connection only when this exact socket
// generation negotiated computer control and the host can still build the
// signed driver.
func (c *computerControl) usableConnection(desktop *Desktop) (*deviceConnection, *deviceControlSession) {
	connection := desktop.currentDevice()
	if connection == nil || !connection.authorized() || !connection.Status().ComputerReady {
		return nil, nil
	}
	session := connection.currentControlSession()
	if session == nil {
		return nil, nil
	}
	return connection, session
}

func (c *computerControl) selectTarget(ctx context.Context, desktop *Desktop, scope computerControlScope) (ComputerControlStatus, error) {
	conversationID, turnID := scope.ConversationID, scope.TurnID
	connection, session := c.usableConnection(desktop)
	if connection == nil {
		return c.status(desktop, conversationID, turnID), errComputerUnavailable
	}

	c.mu.Lock()
	if c.selecting || c.pausing || c.resuming || c.renewing || c.retiring != nil {
		c.mu.Unlock()
		return c.status(desktop, conversationID, turnID), errComputerBusy
	}
	if c.state == computerControlStateActive || c.state == computerControlStatePaused {
		c.mu.Unlock()
		return c.status(desktop, conversationID, turnID), errComputerBusy
	}
	opContext, cancel := context.WithCancel(ctx)
	epoch := c.epoch
	c.selecting = true
	c.selectingScope = scope
	c.opCancel = cancel
	c.mu.Unlock()
	defer func() {
		cancel()
		c.mu.Lock()
		if c.epoch == epoch {
			c.selecting = false
			c.selectingScope = computerControlScope{}
			c.opCancel = nil
		}
		c.mu.Unlock()
	}()

	pickContext, stopPick := context.WithTimeout(opContext, computerControlPickerTimeout)
	target, err := c.platform.pickTarget(pickContext, desktop)
	stopPick()
	if err != nil {
		if errors.Is(err, errComputerPickerCanceled) || errors.Is(err, context.Canceled) ||
			errors.Is(err, context.DeadlineExceeded) {
			return c.status(desktop, conversationID, turnID), errComputerCanceled
		}
		return c.status(desktop, conversationID, turnID), errComputerUnavailable
	}
	if err := target.validate(); err != nil {
		return c.status(desktop, conversationID, turnID), errComputerInvalid
	}
	if opContext.Err() != nil {
		return c.status(desktop, conversationID, turnID), errComputerCanceled
	}
	// The picker can be open for a while. The selection is bound only to the
	// exact link that is still live after the user chose.
	liveConnection, liveSession := c.usableConnection(desktop)
	if liveConnection != connection || liveSession != session {
		return c.status(desktop, conversationID, turnID), errComputerUnavailable
	}

	// The executor must exist before the server is asked, so a local driver
	// failure never leaves a server-side activation behind. Its constructor
	// validates every identity field, so the pre-ack binding carries
	// placeholder session/runtime/expiry values. That provisional executor is
	// reachable only from this local variable: it is not installed in the gate,
	// cannot be addressed by the host and is closed on every failure path. The
	// acknowledged ids replace the placeholders before install.
	selection := m1bComputerSelection{
		OwnerID: connection.credential.OwnerID, LinkID: session.linkID,
		ConversationID: conversationID, TurnID: turnID, SelectionID: newComputerControlID(),
		SessionID: newComputerControlID(), RuntimeGeneration: newComputerControlID(),
		ExpiresAt: time.Now().Add(computerControlMaxGrant),
	}
	executor, err := c.platform.newExecutor(opContext, desktop, target, selection)
	if err != nil {
		return c.status(desktop, conversationID, turnID), errComputerUnavailable
	}
	requestID := newComputerControlID()
	frame, err := computerControlSelectFrame(requestID, conversationID, turnID, selection.SelectionID, target.BundleID)
	if err != nil {
		_ = executor.close()
		return c.status(desktop, conversationID, turnID), errComputerUnavailable
	}
	ackContext, cancelAck := context.WithTimeout(opContext, computerControlSelectAckTimeout)
	raw, ackSession, err := connection.computerControl(ackContext, session, requestID, frame)
	cancelAck()
	if err != nil {
		_ = executor.close()
		return c.status(desktop, conversationID, turnID), computerControlTransportError(err)
	}
	now := time.Now()
	ack, err := parseComputerControlResult(raw, requestID, "select", now)
	if err != nil {
		_ = executor.close()
		return c.status(desktop, conversationID, turnID), errComputerUnavailable
	}
	if ack.ErrorCode != "" {
		_ = executor.close()
		return c.status(desktop, conversationID, turnID), computerControlServerError(ack.ErrorCode)
	}
	if !strings.EqualFold(ack.SelectionID, selection.SelectionID) || ackSession != session ||
		connection.currentControlSession() != session || !connection.authorized() ||
		!connection.Status().ComputerReady ||
		!strings.EqualFold(selection.LinkID, session.linkID) ||
		!strings.EqualFold(selection.OwnerID, connection.credential.OwnerID) ||
		!now.Before(ack.ExpiresAt) || opContext.Err() != nil {
		_ = executor.close()
		return c.status(desktop, conversationID, turnID), errComputerUnavailable
	}
	selection.SessionID = ack.SessionID
	selection.RuntimeGeneration = ack.RuntimeGeneration
	selection.ExpiresAt = ack.ExpiresAt
	// The executor was constructed with the provisional binding. Rebind it to
	// the exact session/runtime the server acknowledged before it can act.
	if err := executor.selectHostSelection(selection); err != nil {
		_ = executor.close()
		return c.status(desktop, conversationID, turnID), errComputerUnavailable
	}

	c.mu.Lock()
	if c.epoch != epoch || !c.selecting || opContext.Err() != nil {
		c.mu.Unlock()
		_ = executor.close()
		return c.status(desktop, conversationID, turnID), errComputerUnavailable
	}
	c.epoch++
	c.state = computerControlStateActive
	c.selection = selection
	c.target = target
	c.terminal = computerControlTerminal{}
	c.executor = executor
	c.selecting = false
	c.selectingScope = computerControlScope{}
	c.opCancel = nil
	c.gate.install(executor)
	c.armTimerLocked(selection)
	c.mu.Unlock()
	c.syncEmergencyShortcut()
	return ComputerControlStatus{
		State: computerControlStateActive, ExpiresAt: selection.ExpiresAt.UTC().Format(time.RFC3339),
	}, nil
}

func (c *computerControl) pause(ctx context.Context, desktop *Desktop, scope computerControlScope) (ComputerControlStatus, error) {
	return c.pauseScope(ctx, desktop, scope, false, "")
}

// renew is the explicit five-minute extension of the exact live selection. It
// never opens a picker, never names another target and never runs in the
// background: the trusted page must ask while the same active window, owner,
// link and scope are still input-open and no act is admitted. The server sees
// the existing `select` action with the same native selection id and bundle,
// keeps the session and selection, advances its internal epoch and returns a
// bounded later expiry.
func (c *computerControl) renew(ctx context.Context, desktop *Desktop, scope computerControlScope) (ComputerControlStatus, error) {
	connection, session := c.usableConnection(desktop)
	if connection == nil {
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerUnavailable
	}

	c.mu.Lock()
	if c.retiring != nil || c.selecting || c.pausing || c.resuming || c.renewing {
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerBusy
	}
	if c.state != computerControlStateActive || c.executor == nil || c.target.BundleID == "" {
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerBusy
	}
	previous := c.selection
	if !scope.matches(previous) {
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerInvalid
	}
	if !strings.EqualFold(previous.LinkID, session.linkID) ||
		!strings.EqualFold(previous.OwnerID, connection.credential.OwnerID) {
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerInvalid
	}
	if previous.ExpiresAt.IsZero() || !time.Now().Before(previous.ExpiresAt) {
		// An expired local grant is never revived by a renewal.
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerTimeout
	}
	executor, target := c.executor, c.target
	if c.gate == nil || !c.gate.open() || c.gate.busy() ||
		(c.host != nil && c.host.inputBusy()) {
		// A failed pause left input closed, or an act may already have reached
		// the driver. Leave the old state exactly as it is; no renewal and no
		// second side effect.
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerBusy
	}
	opContext, cancel := context.WithTimeout(ctx, computerControlRenewAckTimeout)
	epoch := c.epoch
	c.renewing = true
	c.opCancel = cancel
	c.mu.Unlock()
	defer func() {
		cancel()
		c.mu.Lock()
		if c.epoch == epoch {
			c.renewing = false
			c.opCancel = nil
		}
		c.mu.Unlock()
	}()

	requestID := newComputerControlID()
	frame, err := computerControlSelectFrame(requestID, previous.ConversationID, previous.TurnID,
		previous.SelectionID, target.BundleID)
	if err != nil {
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerUnavailable
	}
	ack, ackOK, ackErr := c.exchangeControl(opContext, connection, session, requestID, frame, "select",
		computerControlAckExpectation{
			SessionID: previous.SessionID, RuntimeGeneration: previous.RuntimeGeneration,
			SelectionID: previous.SelectionID, ExpiresAt: previous.ExpiresAt, Renew: true,
		})
	if !ackOK {
		// A parsed pre-commit refusal leaves the exact old selection as it was.
		// A late, invalid or failed result is uncertainty: the server may have
		// committed the renewal, so input must not stay open and the old grant
		// must not keep being presented as current.
		c.settleRenewalFailure(epoch, executor, previous, ack.ErrorCode)
		if ackErr != nil {
			return c.status(desktop, scope.ConversationID, scope.TurnID), ackErr
		}
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerUnavailable
	}
	// The same socket generation, owner and runtime must still be live, and the
	// old local grant must not have elapsed while the renewal waited. A positive
	// server renewal is discarded rather than reviving an expired local grant.
	now := time.Now()
	if !strings.EqualFold(previous.LinkID, session.linkID) ||
		!strings.EqualFold(previous.OwnerID, connection.credential.OwnerID) ||
		connection.currentControlSession() != session || !connection.authorized() ||
		!connection.Status().ComputerReady || !now.Before(previous.ExpiresAt) ||
		opContext.Err() != nil {
		// A positive ack this host cannot apply may already be committed
		// server-side, so the exact old grant is retired; a superseding owner
		// no-ops.
		c.settleRenewalFailure(epoch, executor, previous, "")
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerUnavailable
	}
	next := previous
	next.ExpiresAt = ack.ExpiresAt

	c.mu.Lock()
	if c.epoch != epoch || !c.renewing || c.retiring != nil ||
		c.state != computerControlStateActive || c.executor != executor ||
		c.selection.bindingKey() != previous.bindingKey() ||
		!c.selection.ExpiresAt.Equal(previous.ExpiresAt) ||
		c.gate == nil || !c.gate.open() || c.gate.busy() ||
		opContext.Err() != nil || !time.Now().Before(previous.ExpiresAt) {
		// A stop, pause, terminal, timer or link change superseded the renewal
		// and owns the selection; releasing c.mu first lets its epoch fence the
		// settle while a local-only failure still retires the exact grant.
		c.mu.Unlock()
		c.settleRenewalFailure(epoch, executor, previous, "")
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerUnavailable
	}
	// Same executor, same immutable window: keep the adopted native holder and
	// the host's tombstone state, but clear the old observation and advance the
	// executor generation so the next act requires a fresh observe.
	if err := c.gate.renew(executor, next); err != nil {
		c.mu.Unlock()
		// The acknowledged extension could not be installed locally (an act
		// admitted after the busy guard, a closed boundary or a rebind refusal).
		// Every such failure retires the exact grant and is reported as
		// unavailable: a busy result would leave the renderer presenting the
		// retired grant as still current.
		c.settleRenewalFailure(epoch, executor, previous, "")
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerUnavailable
	}
	c.epoch++
	c.selection = next
	c.renewing = false
	c.opCancel = nil
	c.armTimerLocked(next)
	c.mu.Unlock()
	return ComputerControlStatus{
		State: computerControlStateActive, ExpiresAt: next.ExpiresAt.UTC().Format(time.RFC3339),
	}, nil
}

// settleRenewalFailure keeps a conclusive pre-commit server refusal (the exact
// old selection is still current and input-open) and otherwise retires exactly
// this executor and selection. A transport failure, malformed result, ambiguous
// refusal or positively acknowledged extension this host could not apply may
// have been committed server-side, so leaving input open or continuing to
// report the old grant would be unsound. A superseding stop/pause/terminal
// already owns the state and is never downgraded here.
func (c *computerControl) settleRenewalFailure(epoch uint64, executor computerProductExecutor, previous m1bComputerSelection, code string) {
	c.mu.Lock()
	if c.epoch != epoch || !c.renewing || c.retiring != nil ||
		c.state != computerControlStateActive || c.executor != executor ||
		c.selection.bindingKey() != previous.bindingKey() ||
		!c.selection.ExpiresAt.Equal(previous.ExpiresAt) {
		c.mu.Unlock()
		return
	}
	if computerControlRefusalPreCommit(code) {
		c.mu.Unlock()
		return
	}
	retirement, start := c.beginRetirementLocked(c.selection, executor, false)
	c.mu.Unlock()
	c.syncEmergencyShortcut()
	if start {
		c.startRetirement(retirement)
	}
}

// computerControlRefusalPreCommit lists the stable server refusals emitted
// before a same-selection renewal can have committed. Only these leave the
// exact old local grant current and open. Missing codes (transport/malformed
// results) and ambiguous refusals (for example COMPUTER_UNAVAILABLE after a
// post-commit acknowledgement failure) fail closed.
func computerControlRefusalPreCommit(code string) bool {
	switch code {
	case "COMPUTER_TARGET_CHANGED", "COMPUTER_TIMEOUT", "COMPUTER_INVALID",
		"DEVICE_BUSY", "RUNNER_OPERATION_UNCERTAIN":
		return true
	default:
		return false
	}
}

// admitsExactLocked reports whether a background chord reserved for
// selectionID may still act. The caller holds c.mu. Only the exact installed
// selection matches: a pending picker, an empty id, a replacement or an
// already-retiring selection is a no-op (its input is already closed), never a
// wildcard fallback.
func (c *computerControl) admitsExactLocked(selectionID string) bool {
	if selectionID == "" || c.selecting || c.retiring != nil {
		return false
	}
	return c.executor != nil && c.selection.SelectionID == selectionID
}

// pauseScope is shared by the renderer action, the native menu pause and the
// background chord. host is true for both host paths: the menu path carries no
// renderer ids and uses the host's current selection, while selectionID is
// nonempty only for the background chord, whose press must still find that
// exact installed selection under this admission lock. An empty id keeps the
// menu's existing wildcard behavior; the chord never supplies one. A pause is
// acknowledged paused only after both the correlated ack and the executor's
// terminal/refs-clear proof; a lost ack leaves local input closed but does not
// enable resume.
func (c *computerControl) pauseScope(ctx context.Context, desktop *Desktop, scope computerControlScope, host bool, selectionID string) (ComputerControlStatus, error) {
	connection, session := c.usableConnection(desktop)
	if connection == nil {
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerUnavailable
	}

	c.mu.Lock()
	if selectionID != "" && !c.admitsExactLocked(selectionID) {
		// The selection this press was armed for is already replaced, retiring
		// or behind an open picker. The background chord is inert here and must
		// not fall back to the host's current picker or selection.
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), nil
	}
	if c.selecting {
		if !host && (!strings.EqualFold(c.selectingScope.ConversationID, scope.ConversationID) ||
			!strings.EqualFold(c.selectingScope.TurnID, scope.TurnID)) {
			// Another scope's picker is open; this caller cannot cancel it.
			c.mu.Unlock()
			return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerBusy
		}
		// No selection was ever activated; cancel this scope's pending picker
		// instead of pausing a state that does not exist.
		if c.opCancel != nil {
			c.opCancel()
			c.opCancel = nil
		}
		c.selecting = false
		c.selectingScope = computerControlScope{}
		c.epoch++
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), nil
	}
	if c.retiring != nil {
		// Input is already closed and the exact act/driver is still retiring.
		// A pause cannot prove anything new and must not release it.
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerBusy
	}
	selection := c.selection
	if c.state == computerControlStateActive || c.state == computerControlStatePaused {
		// Validate the exact renderer owner/link/scope before any mutation. A
		// mis-scoped pause must never cancel a pending renewal or touch the
		// live selection's input. The native emergency path has no renderer ids
		// and keeps its existing host-derived semantics.
		if !strings.EqualFold(selection.LinkID, session.linkID) ||
			!strings.EqualFold(selection.OwnerID, connection.credential.OwnerID) ||
			(!host && !scope.matches(selection)) {
			c.mu.Unlock()
			return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerInvalid
		}
	}
	if c.renewing {
		// A pause must close input now. Cancel the renewal wait and advance the
		// epoch so a delayed renewal ack can never install its later expiry.
		if c.opCancel != nil {
			c.opCancel()
			c.opCancel = nil
		}
		c.renewing = false
		c.epoch++
	}
	if c.resuming {
		if !host {
			c.mu.Unlock()
			return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerBusy
		}
		// The emergency gesture must not let a pending resume reopen input.
		// Cancel that wait; the selection stays locally paused and closed.
		if c.opCancel != nil {
			c.opCancel()
			c.opCancel = nil
		}
		c.resuming = false
		c.epoch++
		c.mu.Unlock()
		c.syncEmergencyShortcut()
		return c.status(desktop, scope.ConversationID, scope.TurnID), nil
	}
	if c.state == computerControlStatePaused || c.state == computerControlStateStopped ||
		c.state == computerControlStateIdle {
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), nil
	}
	if c.pausing {
		// A pause is already in flight: report its current local state rather
		// than starting a second side effect.
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), nil
	}
	if selection.ExpiresAt.IsZero() || !time.Now().Before(selection.ExpiresAt) {
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerTimeout
	}
	executor := c.executor
	if executor == nil {
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerUnavailable
	}
	opContext, cancel := context.WithTimeout(ctx, computerControlPauseAckTimeout)
	epoch := c.epoch
	statusScope := scope
	if host {
		statusScope = computerControlScope{
			ConversationID: selection.ConversationID, TurnID: selection.TurnID,
		}
	}
	gate := c.gate
	c.pausing = true
	c.opCancel = cancel
	c.mu.Unlock()
	defer func() {
		cancel()
		c.mu.Lock()
		if c.epoch == epoch {
			c.pausing = false
			c.opCancel = nil
		}
		c.mu.Unlock()
	}()

	// Build the frame before touching local input: an unencodable request must
	// leave the current selection exactly as it was.
	requestID := newComputerControlID()
	frame, err := computerControlScopeFrame(requestID, "pause", selection.ConversationID, selection.TurnID, selection.SelectionID, "")
	if err != nil {
		return c.status(desktop, statusScope.ConversationID, statusScope.TurnID), errComputerUnavailable
	}
	// Local input stops before the network wait. Invalidation is synchronous,
	// so an in-flight preflight is canceled before the acknowledgement is
	// awaited; the old binding stays in place for the server to quiesce. Only
	// the acknowledgement plus the executor's terminal make the pause
	// successful.
	quiesce := gate.quiesce(opContext, executor, selection)
	// Input is now closed for this exact selection; derive the shortcut binding
	// from that live state instead of replaying a stale arming decision.
	c.syncEmergencyShortcut()

	ack, ackOK, ackErr := c.exchangeControl(opContext, connection, session, requestID, frame, "pause",
		computerControlAckExpectation{
			SessionID: selection.SessionID, RuntimeGeneration: selection.RuntimeGeneration,
			SelectionID: selection.SelectionID, ExpiresAt: selection.ExpiresAt,
		})
	quiesced := awaitQuiesce(opContext, quiesce)

	c.mu.Lock()
	if c.epoch != epoch || c.retiring != nil {
		// A stop, reset, terminal or expiry superseded this pause. It owns the
		// state; a lost acknowledgement is never turned into success here, and
		// a pending retirement keeps the release for itself.
		c.mu.Unlock()
		return c.status(desktop, statusScope.ConversationID, statusScope.TurnID), errComputerUnavailable
	}
	c.epoch++
	c.pausing = false
	c.opCancel = nil
	proven := ackOK && ackErr == nil && quiesced && time.Now().Before(selection.ExpiresAt)
	if proven {
		c.state = computerControlStatePaused
		if !ack.ExpiresAt.IsZero() {
			c.selection.ExpiresAt = ack.ExpiresAt
		}
		c.armTimerLocked(c.selection)
	}
	// On failure the state stays active while the boundary is already closed;
	// status therefore reports active, and resume (which requires a proven
	// paused state) stays unavailable.
	c.mu.Unlock()
	status := c.status(desktop, statusScope.ConversationID, statusScope.TurnID)
	switch {
	case proven:
		return status, nil
	case ackErr != nil:
		return status, ackErr
	case !ackOK:
		return status, errComputerUnavailable
	default:
		return status, errComputerTimeout
	}
}

func (c *computerControl) resume(ctx context.Context, desktop *Desktop, scope computerControlScope) (ComputerControlStatus, error) {
	connection, session := c.usableConnection(desktop)
	if connection == nil {
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerUnavailable
	}

	c.mu.Lock()
	if c.resuming || c.pausing || c.selecting || c.renewing || c.retiring != nil {
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerBusy
	}
	// Resume requires proof of pause: only an acknowledged pause whose input was
	// terminal and refs-cleared ever reaches this state.
	if c.state != computerControlStatePaused {
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerBusy
	}
	previous := c.selection
	if !scope.matches(previous) {
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerInvalid
	}
	if !strings.EqualFold(previous.LinkID, session.linkID) ||
		!strings.EqualFold(previous.OwnerID, connection.credential.OwnerID) {
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerInvalid
	}
	if previous.ExpiresAt.IsZero() || !time.Now().Before(previous.ExpiresAt) {
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerTimeout
	}
	executor := c.executor
	if executor == nil {
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerUnavailable
	}
	opContext, cancel := context.WithTimeout(ctx, computerControlResumeAckTimeout)
	epoch := c.epoch
	c.resuming = true
	c.opCancel = cancel
	c.mu.Unlock()
	defer func() {
		cancel()
		c.mu.Lock()
		if c.epoch == epoch {
			c.resuming = false
			c.opCancel = nil
		}
		c.mu.Unlock()
	}()

	// A resume is a new selection in the same authorized scope and the same
	// immutable window. The server receives both ids; the old selection stays
	// locally paused until the acknowledgement proves the new one active.
	next := previous
	next.SelectionID = newComputerControlID()
	requestID := newComputerControlID()
	frame, err := computerControlScopeFrame(requestID, "resume", previous.ConversationID, previous.TurnID, previous.SelectionID, next.SelectionID)
	if err != nil {
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerUnavailable
	}
	ack, ackOK, ackErr := c.exchangeControl(opContext, connection, session, requestID, frame, "resume",
		computerControlAckExpectation{
			SessionID: previous.SessionID, RuntimeGeneration: previous.RuntimeGeneration,
			SelectionID: next.SelectionID, ExpiresAt: previous.ExpiresAt,
		})
	if !ackOK {
		if ackErr != nil {
			return c.status(desktop, scope.ConversationID, scope.TurnID), ackErr
		}
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerUnavailable
	}
	next.SessionID = ack.SessionID
	next.RuntimeGeneration = ack.RuntimeGeneration
	next.ExpiresAt = ack.ExpiresAt
	if !time.Now().Before(next.ExpiresAt) {
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerTimeout
	}

	c.mu.Lock()
	if c.epoch != epoch || !c.resuming || c.retiring != nil || c.state != computerControlStatePaused ||
		c.selection.bindingKey() != previous.bindingKey() || c.executor != executor ||
		opContext.Err() != nil {
		// A run terminal observed while this resume waited owns the release.
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerUnavailable
	}
	// Rebinding the same executor keeps the exact window PID/instance and
	// clears the old observation; the next action must observe that window
	// again before it can act.
	if err := c.gate.resume(executor, next); err != nil {
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerUnavailable
	}
	c.epoch++
	c.state = computerControlStateActive
	c.selection = next
	c.terminal = computerControlTerminal{}
	c.resuming = false
	c.opCancel = nil
	c.armTimerLocked(next)
	c.mu.Unlock()
	c.syncEmergencyShortcut()
	return ComputerControlStatus{
		State: computerControlStateActive, ExpiresAt: next.ExpiresAt.UTC().Format(time.RFC3339),
	}, nil
}

func (c *computerControl) stop(ctx context.Context, desktop *Desktop, scope computerControlScope) (ComputerControlStatus, error) {
	return c.stopScope(ctx, desktop, scope, false, "")
}

// stopScope is shared by the renderer action, the native menu stop and the
// background chord. host is true for both host paths: the menu path carries no
// renderer ids, so the exact scope is resolved from the live picker or selection
// under this same admission lock. A replacement installed between a menu
// gesture and this lock is therefore either the one current selection stopped
// here or a newer one that owns the state; a stale pre-lock snapshot is never
// used. selectionID is nonempty only for the background chord, which must still
// find that exact selection under this lock and is inert against a replacement
// or a pending picker; an empty id keeps the menu's wildcard behavior.
//
// The selection captured under this lock is the one the gesture stops. Its
// exact executor is retired first, which closes local input synchronously, and
// only then is the link that is live for that captured selection looked up. A
// reconnect that replaced the gesture's admission generation therefore cannot
// decide whether the stopped selection is reported: the one stop frame is sent
// only when the current link and owner still match the captured selection, and
// a stale generation never receives it.
func (c *computerControl) stopScope(ctx context.Context, desktop *Desktop, scope computerControlScope, host bool, selectionID string) (ComputerControlStatus, error) {
	// This lookup serves only the pending-picker stopped terminal below. The
	// selection path ignores it: nothing captured before admission may decide
	// the link that receives the stop frame.
	pickerConnection, pickerSession := c.usableConnection(desktop)

	c.mu.Lock()
	if selectionID != "" && !c.admitsExactLocked(selectionID) {
		// The selection this press was armed for is already replaced, retiring
		// or behind a pending picker. The background chord must not cancel that
		// picker or stop a different selection, so this press is a no-op.
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), nil
	}
	if host {
		switch {
		case c.retiring != nil:
			scope = computerControlScope{
				ConversationID: c.retiring.selection.ConversationID,
				TurnID:         c.retiring.selection.TurnID,
			}
		case c.selecting:
			scope = c.selectingScope
		default:
			scope = computerControlScope{
				ConversationID: c.selection.ConversationID,
				TurnID:         c.selection.TurnID,
			}
		}
	}
	if c.retiring != nil {
		// The exact executor is already retiring. A stop cannot claim stopped
		// or send a second control frame before the act terminal and close are
		// proven; the retirement releases automatically at the real terminal.
		retirement := c.retiring
		if !scope.matches(retirement.selection) {
			c.mu.Unlock()
			return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerInvalid
		}
		c.mu.Unlock()
		waitContext, cancelWait := context.WithTimeout(ctx, computerControlStopAckTimeout)
		done := awaitRetirement(waitContext, retirement)
		cancelWait()
		status := c.status(desktop, scope.ConversationID, scope.TurnID)
		if done && c.retirementStopped(retirement) {
			return status, nil
		}
		return status, errComputerUnavailable
	}
	if c.selecting {
		if !strings.EqualFold(c.selectingScope.ConversationID, scope.ConversationID) ||
			!strings.EqualFold(c.selectingScope.TurnID, scope.TurnID) {
			// Another scope's picker is open; this caller cannot cancel it.
			c.mu.Unlock()
			return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerBusy
		}
		if c.opCancel != nil {
			c.opCancel()
			c.opCancel = nil
		}
		c.selecting = false
		c.selectingScope = computerControlScope{}
		linkID, ownerID := "", ""
		if pickerSession != nil {
			linkID = pickerSession.linkID
		}
		if pickerConnection != nil {
			ownerID = pickerConnection.credential.OwnerID
		}
		c.finalizeStoppedWithoutInputLocked(scope, ownerID, linkID)
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), nil
	}
	if c.state == computerControlStateIdle || c.state == computerControlStateStopped {
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), nil
	}
	selection := c.selection
	if !scope.matches(selection) {
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), errComputerInvalid
	}
	if c.pausing || c.resuming || c.renewing {
		// Stop supersedes an in-flight pause, resume or renewal: cancel its
		// wait and take over the state. The earlier side effect is not retried.
		if c.opCancel != nil {
			c.opCancel()
			c.opCancel = nil
		}
		c.pausing, c.resuming, c.renewing = false, false, false
		c.epoch++
	}
	executor := c.executor
	if executor == nil {
		// No executor means no act or driver can still be running.
		c.finalizeStoppedWithoutInputLocked(scope, selection.OwnerID, selection.LinkID)
		c.mu.Unlock()
		return c.status(desktop, scope.ConversationID, scope.TurnID), nil
	}
	// The exact selection captured above is the one this gesture stops. Retire
	// it first so local input closes synchronously, then look up the link that
	// is live for it. A reconnect that replaced the gesture's admission
	// generation never receives this exact generation's stop frame, and a lost
	// link retires locally without a send or retry.
	retirement, start := c.beginRetirementLocked(selection, executor, true)
	opContext, cancel := context.WithTimeout(ctx, computerControlStopAckTimeout)
	c.mu.Unlock()
	c.syncEmergencyShortcut()
	if start {
		c.startRetirement(retirement)
	}
	defer cancel()

	connection, session := c.usableConnection(desktop)
	live := connection != nil && session != nil &&
		strings.EqualFold(selection.LinkID, session.linkID) &&
		strings.EqualFold(selection.OwnerID, connection.credential.OwnerID)
	ackOK, ackErr := false, errComputerUnavailable
	if live {
		requestID := newComputerControlID()
		frame, err := computerControlScopeFrame(requestID, "stop", selection.ConversationID, selection.TurnID, selection.SelectionID, "")
		if err == nil {
			_, ackOK, ackErr = c.exchangeControl(opContext, connection, session, requestID, frame, "stop",
				computerControlAckExpectation{
					SessionID: selection.SessionID, RuntimeGeneration: selection.RuntimeGeneration,
					SelectionID: selection.SelectionID, ExpiresAt: selection.ExpiresAt,
				})
		}
	}
	done := awaitRetirement(opContext, retirement)
	status := c.status(desktop, scope.ConversationID, scope.TurnID)
	stopped := c.retirementStopped(retirement)
	switch {
	case ackErr != nil:
		return status, ackErr
	case !ackOK:
		return status, errComputerUnavailable
	case !done:
		// The exact act/driver is still retiring. No stopped status and no new
		// selection until it becomes terminal; the retirement owns that release.
		return status, errComputerTimeout
	case !stopped:
		// A connection reset downgraded the pending stop to idle while this
		// stop waited; it must not report a stopped scope for a dead link.
		return status, errComputerUnavailable
	default:
		return status, nil
	}
}

// retirementStopped reads the final published kind of a retirement. `stopped`
// is written only under mu (a reset can downgrade a pending stop to idle).
func (c *computerControl) retirementStopped(retirement *computerControlRetirement) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return retirement != nil && retirement.stopped
}

// finalizeStoppedWithoutInputLocked publishes stopped for a selection that has
// no executor (a canceled picker or defensive no-executor state). It must never
// be used while an executor may still be running.
func (c *computerControl) finalizeStoppedWithoutInputLocked(scope computerControlScope, ownerID, linkID string) {
	c.epoch++
	c.state = computerControlStateStopped
	c.terminal = computerControlTerminal{computerControlScope: scope, OwnerID: ownerID, LinkID: linkID}
	c.executor = nil
	c.selection = m1bComputerSelection{}
	c.target = computerSelectedTarget{}
	c.selectingScope = computerControlScope{}
	c.selecting, c.pausing, c.resuming, c.renewing = false, false, false, false
	if c.opCancel != nil {
		c.opCancel()
		c.opCancel = nil
	}
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	c.gate.closeInputIf(nil)
	c.gate.detachIf(nil)
}

// awaitQuiesce returns the exact act's terminal proof even when the operation
// context ended in the same instant: both select cases can be ready at once,
// and a ready proof must not be turned into a timeout. No polling or retry.
func awaitQuiesce(ctx context.Context, quiesce <-chan bool) bool {
	select {
	case quiesced := <-quiesce:
		return quiesced
	case <-ctx.Done():
		select {
		case quiesced := <-quiesce:
			return quiesced
		default:
			return false
		}
	}
}

// computerControlAckExpectation is the exact local binding a scope action's
// success result must repeat. The expiry may not extend beyond the grant this
// host already holds, so a pause, resume or stop ack cannot revive or renew an
// expired selection. Renew is the one explicit extension: it must strictly
// advance the same grant and stay inside the server's five-minute window.
type computerControlAckExpectation struct {
	SessionID         string
	RuntimeGeneration string
	SelectionID       string
	ExpiresAt         time.Time
	Renew             bool
}

// exchangeControl sends one scope action and validates its correlated,
// expected-state acknowledgement. A transport error, invalid result, server
// refusal and supersession are returned separately so callers can keep the
// local disabled state while reporting a stable failure.
func (c *computerControl) exchangeControl(ctx context.Context, connection *deviceConnection, session *deviceControlSession,
	requestID string, frame []byte, action string, expect computerControlAckExpectation) (computerControlAck, bool, error) {
	raw, ackSession, err := connection.computerControl(ctx, session, requestID, frame)
	if err != nil {
		return computerControlAck{}, false, computerControlTransportError(err)
	}
	now := time.Now()
	ack, err := parseComputerControlResult(raw, requestID, action, now)
	if err != nil {
		return computerControlAck{}, false, errComputerUnavailable
	}
	if ackSession != session || connection.currentControlSession() != session || !connection.authorized() ||
		!connection.Status().ComputerReady {
		return computerControlAck{}, false, errComputerUnavailable
	}
	if ack.ErrorCode != "" {
		// Keep the parsed code with the refusal so the renewal path can tell a
		// pre-commit refusal from transport/malformed uncertainty.
		return ack, false, computerControlServerError(ack.ErrorCode)
	}
	// The success ack must name the exact session, runtime generation and old
	// or new selection this operation asked about. Ordinary scope actions may
	// not extend the bounded grant. The explicit renewal must strictly advance
	// it and remain inside the server's five-minute ceiling (with the small
	// audited clock tolerance), so a stale or overlong reply cannot install.
	if !strings.EqualFold(ack.SessionID, expect.SessionID) ||
		!strings.EqualFold(ack.RuntimeGeneration, expect.RuntimeGeneration) ||
		!strings.EqualFold(ack.SelectionID, expect.SelectionID) ||
		expect.ExpiresAt.IsZero() {
		return computerControlAck{}, false, errComputerUnavailable
	}
	if expect.Renew {
		if !ack.ExpiresAt.After(expect.ExpiresAt) ||
			ack.ExpiresAt.After(now.Add(computerControlRenewGrant+computerControlRenewClockTolerance)) {
			return computerControlAck{}, false, errComputerUnavailable
		}
	} else if ack.ExpiresAt.After(expect.ExpiresAt) {
		// A same-selection renewal may have committed before a stop superseded
		// its positive active acknowledgement. Only that stop may carry the
		// later bounded expiry; it is accepted for the exact session/selection/
		// runtime/socket above and is never applied to the local selection.
		if action != "stop" ||
			ack.ExpiresAt.After(now.Add(computerControlRenewGrant+computerControlRenewClockTolerance)) {
			return computerControlAck{}, false, errComputerUnavailable
		}
	}
	return ack, true, nil
}

func computerControlTransportError(err error) error {
	switch {
	case errors.Is(err, errComputerControlSuperseded), errors.Is(err, errComputerUnavailable):
		return errComputerUnavailable
	case errors.Is(err, errComputerBusy):
		return errComputerBusy
	case errors.Is(err, errComputerInvalid):
		return errComputerInvalid
	case errors.Is(err, errAccountRequired):
		return errComputerForbidden
	case errors.Is(err, context.DeadlineExceeded):
		return errComputerTimeout
	case errors.Is(err, context.Canceled):
		return errComputerCanceled
	default:
		return errComputerUnavailable
	}
}

// armTimerLocked installs the bounded expiry cleanup for one selection. It
// runs once per acknowledged grant; an expired grant closes input and retires
// the executor without calling the server again. The callback is fenced by the
// exact (selection id, expiry) pair because an explicit renewal keeps the id
// and only advances the expiry: a timer armed for the previous grant must
// never stop the renewed one.
func (c *computerControl) armTimerLocked(selection m1bComputerSelection) {
	if c.timer != nil {
		c.timer.Stop()
	}
	identifier := selection.SelectionID
	expiresAt := selection.ExpiresAt
	delay := time.Until(expiresAt)
	if delay <= 0 {
		delay = 0
	}
	c.timer = time.AfterFunc(delay, func() { c.expire(identifier, expiresAt) })
}

func (c *computerControl) expire(identifier string, expiresAt time.Time) {
	c.mu.Lock()
	if c.retiring != nil || c.selection.SelectionID != identifier ||
		!c.selection.ExpiresAt.Equal(expiresAt) ||
		(c.state != computerControlStateActive && c.state != computerControlStatePaused) {
		c.mu.Unlock()
		return
	}
	executor := c.executor
	if executor == nil {
		c.mu.Unlock()
		return
	}
	retirement, start := c.beginRetirementLocked(c.selection, executor, true)
	c.mu.Unlock()
	c.syncEmergencyShortcut()
	if start {
		c.startRetirement(retirement)
	}
}

// observeRuntimeFrame ends this host's selection when the exact published local
// run reports a completed, failed or interrupted turn. The frame is the
// runtime's existing pipe output; it is not a renderer assertion, it never
// authorizes input, and it produces no server side effect. The same retirement
// path as expiry/stop closes input synchronously and publishes stopped only
// after the exact act terminal and driver close.
func (c *computerControl) observeRuntimeFrame(connection *deviceConnection, frame []byte) {
	terminal, ok := computerTerminalFromRuntimeFrame(frame)
	if !ok || c == nil {
		return
	}
	c.mu.Lock()
	if c.retiring != nil ||
		(c.state != computerControlStateActive && c.state != computerControlStatePaused) {
		c.mu.Unlock()
		return
	}
	selection := c.selection
	if !strings.EqualFold(selection.ConversationID, terminal.ConversationID) ||
		!strings.EqualFold(selection.TurnID, terminal.TurnID) ||
		!strings.EqualFold(selection.RuntimeGeneration, terminal.RuntimeGeneration) {
		c.mu.Unlock()
		return
	}
	if c.desktop == nil || c.desktop.currentDevice() != connection {
		c.mu.Unlock()
		return
	}
	session := connection.currentControlSession()
	if session == nil || !strings.EqualFold(selection.LinkID, session.linkID) {
		c.mu.Unlock()
		return
	}
	executor := c.executor
	if executor == nil {
		c.mu.Unlock()
		return
	}
	retirement, start := c.beginRetirementLocked(selection, executor, true)
	c.mu.Unlock()
	c.syncEmergencyShortcut()
	if start {
		c.startRetirement(retirement)
	}
}

// syncEmergencyShortcut derives both global bindings from the live selection
// state instead of replaying a transition's stale decision: Pause is armed only
// while an active selection's installed gate still admits input, and Stop while
// an installed selection is active or paused and not already retiring. Each arm
// carries that exact selection id, so a same-boolean replacement retargets and
// invalidates the old registration instead of leaving it able to act on the new
// selection. The controller records only these desired arms under shortcutMu,
// so a late reset, pause, expiry or terminal from an older scope cannot
// overwrite a newer one; the actual native update is scheduled on the UI thread
// by the shortcut owner and never waits here.
func (c *computerControl) syncEmergencyShortcut() {
	if c == nil || c.desktop == nil {
		return
	}
	c.shortcutMu.Lock()
	defer c.shortcutMu.Unlock()
	c.mu.Lock()
	pause, stop := "", ""
	selectionID := c.selection.SelectionID
	if c.retiring == nil && c.executor != nil && selectionID != "" {
		if c.state == computerControlStateActive && c.gate != nil && c.gate.open() {
			pause = selectionID
		}
		if c.state == computerControlStateActive || c.state == computerControlStatePaused {
			stop = selectionID
		}
	}
	c.mu.Unlock()
	c.desktop.setComputerEmergencyShortcuts(pause, stop)
}

// emergencyPause is the one native Pause path. An empty selectionID is the
// menu/tray wildcard and acts on the host's current selection; a background
// chord passes the exact selection id it was armed for, which the controller
// rechecks under the pause admission lock and is inert if the selection was
// replaced, is already retiring, or a picker is open.
func (c *computerControl) emergencyPause(desktop *Desktop, selectionID string) {
	if c == nil || desktop == nil {
		return
	}
	// The native menu/tray reports the selection current at entry; the background
	// chord must not read any pre-admission snapshot.
	scope := computerControlScope{}
	if selectionID == "" {
		c.mu.Lock()
		scope = computerControlScope{
			ConversationID: c.selection.ConversationID, TurnID: c.selection.TurnID,
		}
		c.mu.Unlock()
	}
	ctx, cancel := context.WithTimeout(context.Background(), computerControlPauseAckTimeout+5*time.Second)
	defer cancel()
	_, _ = c.pauseScope(ctx, desktop, scope, true, selectionID)
}

// emergencyStop is the one native Stop path. An empty selectionID is the
// menu/tray wildcard and resolves the current picker or exact selection under
// the stop admission lock. A background chord passes its exact armed selection;
// a replacement, a pending picker or an already-retiring selection makes the
// press inert, and the matching path keeps the existing post-admission link
// lookup and local-only offline retirement. Neither path opens a picker, sends
// a stop when the link is gone, or queues a retry.
func (c *computerControl) emergencyStop(desktop *Desktop, selectionID string) {
	if c == nil || desktop == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), computerControlStopAckTimeout+5*time.Second)
	defer cancel()
	_, _ = c.stopScope(ctx, desktop, computerControlScope{}, true, selectionID)
}

func newComputerControlID() string {
	value := randomLoginBytes()[:16]
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", value[0:4], value[4:6], value[6:8], value[8:10], value[10:16])
}
