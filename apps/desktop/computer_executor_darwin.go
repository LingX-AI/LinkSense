//go:build darwin

package main

// Private Darwin connector between the computer.go host gate and the private
// computerDriver. It implements the existing m1bComputerExecutor seam and is the
// product executor on macOS, built on demand from the signed runtime after the
// user's select gesture.
//
// Trust boundary: trusted Go host code supplies the exact window and selection;
// protocol frames only repeat ids and refs. Every click/type also needs a
// single-use computerHostAuthorization for that exact host-selected input,
// supplied by the product gate and never derived from the protocol, model,
// renderer, or UI. Driver errors and effects map only to the committed shared
// wire enums; bounded AX node names cross with the observation, while AX values
// and descriptions stay inside the driver.

import (
	"context"
	"errors"
	"sync"
	"time"
)

const (
	// Closed wire set from packages/shared/src/computer-use.ts.
	computerExecutorAccessDenied     = "COMPUTER_ACCESS_DENIED"
	computerExecutorUncertain        = "RUNNER_OPERATION_UNCERTAIN"
	computerExecutorUnavailable      = "COMPUTER_UNAVAILABLE"
	computerExecutorActionFailed     = "COMPUTER_ACTION_FAILED"
	computerExecutorTargetChanged    = "COMPUTER_TARGET_CHANGED"
	computerExecutorStaleObservation = "COMPUTER_STALE_OBSERVATION"
	computerExecutorStaleRef         = "COMPUTER_STALE_REF"
	computerExecutorInvalid          = "COMPUTER_INVALID"
	computerExecutorTimeout          = "COMPUTER_TIMEOUT"
	computerExecutorBusy             = "DEVICE_BUSY"

	// Shared node limits: role 1..64, name <=500 UTF-16 units.
	computerExecutorMaxNameUnits = 500
	computerExecutorMaxRoleUnits = 64
)

var (
	errComputerExecutorClosed       = errors.New("computer executor closed")
	errComputerAuthorizationPending = errors.New("computer authorization already pending")
	errComputerAuthorizationInvalid = errors.New("computer authorization invalid")
)

// computerHostAuthorization is the explicit single-use host approval for one
// exact mutating input. It is not derived from the protocol, model, renderer,
// or any UI. timeoutMS is part of the approved input, not an approved effect:
// it must match the same parser-normalized act and is never derived from a
// caller or transport deadline.
type computerHostAuthorization struct {
	selectionKey  string
	nativeCallID  string
	action        string
	observationID string
	ref           string
	text          string
	timeoutMS     int
	expiresAt     time.Time
}

func newComputerHostAuthorization(selection m1bComputerSelection, nativeCallID string, input m1bComputerAct, expiresAt time.Time) (computerHostAuthorization, error) {
	if !validComputerSelection(selection) ||
		!m1bComputerStringOK(nativeCallID, 1, m1bComputerMaxNativeID) ||
		expiresAt.IsZero() || !time.Now().Before(expiresAt) {
		return computerHostAuthorization{}, errComputerAuthorizationInvalid
	}
	switch input.Action {
	case "click":
		if input.Text != "" {
			return computerHostAuthorization{}, errComputerAuthorizationInvalid
		}
	case "type":
		if !validActionText(input.Text) {
			return computerHostAuthorization{}, errComputerAuthorizationInvalid
		}
	default:
		return computerHostAuthorization{}, errComputerAuthorizationInvalid
	}
	if !validObservationID(input.ObservationID) ||
		!m1bComputerStringOK(input.Ref, 1, m1bComputerMaxRef) ||
		!computerRefPattern.MatchString(input.Ref) ||
		input.TimeoutMS < m1bComputerMinTimeout || input.TimeoutMS > m1bComputerMaxTimeout {
		return computerHostAuthorization{}, errComputerAuthorizationInvalid
	}
	return computerHostAuthorization{
		selectionKey:  selection.bindingKey(),
		nativeCallID:  nativeCallID,
		action:        input.Action,
		observationID: input.ObservationID,
		ref:           input.Ref,
		text:          input.Text,
		timeoutMS:     input.TimeoutMS,
		expiresAt:     expiresAt,
	}, nil
}

func validComputerSelection(selection m1bComputerSelection) bool {
	for _, id := range []string{
		selection.OwnerID, selection.LinkID, selection.ConversationID, selection.RuntimeGeneration,
		selection.TurnID, selection.SessionID, selection.SelectionID,
	} {
		if !validUUID(id) {
			return false
		}
	}
	return !selection.ExpiresAt.IsZero()
}

// computerExecutorActRun is the one in-flight input. Canceling it stops the
// driver's slow preflight before the actual input when its selection is
// revoked, invalidated, closed, or replaced.
type computerExecutorActRun struct {
	selectionKey string
	cancel       context.CancelFunc
}

// computerExecutorDarwin owns one private driver and its exact host-picked
// binding. target is immutable: a different window needs a new executor.
type computerExecutorDarwin struct {
	driver *computerDriver
	target computerTarget

	mu       sync.Mutex
	binding  m1bComputerSelection
	observed string // binding key of the observation held by the driver
	pending  *computerHostAuthorization
	active   *computerExecutorActRun
	closed   bool
	// generation advances whenever the host-picked binding changes. A delayed
	// observe that started under an older generation can never mark its refs
	// observed for the renewed binding, and an act cannot install itself after
	// a renewal crossed its preflight.
	generation uint64

	closeOnce sync.Once
	closeErr  error
}

var _ m1bComputerExecutor = (*computerExecutorDarwin)(nil)

// newComputerExecutorDarwin constructs the connector from trusted Go host
// inputs. ctx is the live task context and bounds signed runtime verification;
// the explicit runtime proof still gates the driver construction.
func newComputerExecutorDarwin(ctx context.Context, target computerTarget, selection m1bComputerSelection, runtimeRoot, stateParent string, proof computerRuntimeProof) (*computerExecutorDarwin, error) {
	if ctx == nil {
		return nil, invalidArgument()
	}
	if err := target.validate(); err != nil {
		return nil, err
	}
	if !validComputerSelection(selection) {
		return nil, invalidArgument()
	}
	driver, err := newComputerDriverDarwin(ctx, runtimeRoot, stateParent, proof)
	if err != nil {
		return nil, err
	}
	return &computerExecutorDarwin{driver: driver, target: target, binding: selection}, nil
}

func (e *computerExecutorDarwin) selection() m1bComputerSelection {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.binding
}

// selectHostSelection replaces the exact host-picked binding for a new turn or
// session, or renews the same binding to a strictly later expiry. It is host
// policy only, never protocol input. Old refs stay with the driver but stop
// being actable; a new observe is required. A same-identity rebind is the
// explicit renewal: it must strictly advance the grant, and it invalidates the
// previous observation generation so a delayed observe cannot resurrect it.
func (e *computerExecutorDarwin) selectHostSelection(selection m1bComputerSelection) error {
	if !validComputerSelection(selection) {
		return invalidArgument()
	}
	var cancel context.CancelFunc
	e.mu.Lock()
	if e.closed {
		e.mu.Unlock()
		return errComputerExecutorClosed
	}
	sameBinding := e.binding.bindingKey() == selection.bindingKey()
	if sameBinding && !selection.ExpiresAt.After(e.binding.ExpiresAt) {
		// A renewal must strictly advance the exact grant; repeating or
		// shortening it could otherwise revive stale input.
		e.mu.Unlock()
		return invalidArgument()
	}
	if !sameBinding || !e.binding.ExpiresAt.Equal(selection.ExpiresAt) {
		e.generation++
		e.observed = ""
		e.pending = nil
		if e.active != nil {
			cancel = e.active.cancel
		}
	}
	e.binding = selection
	e.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return nil
}

// authorize supplies the explicit single-use host approval for one exact
// input. Only the current selection's observation can be approved.
func (e *computerExecutorDarwin) authorize(auth computerHostAuthorization) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return errComputerExecutorClosed
	}
	if e.pending != nil {
		return errComputerAuthorizationPending
	}
	if auth.selectionKey != e.binding.bindingKey() || e.observed != auth.selectionKey {
		return errComputerAuthorizationInvalid
	}
	if !time.Now().Before(auth.expiresAt) {
		return errComputerAuthorizationInvalid
	}
	copy := auth
	e.pending = &copy
	return nil
}

func (e *computerExecutorDarwin) consumeAuthorization(selection m1bComputerSelection, nativeCallID string, input m1bComputerAct) (time.Time, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	auth := e.pending
	if auth == nil {
		return time.Time{}, false
	}
	key := selection.bindingKey()
	matched := auth.selectionKey == key && e.binding.bindingKey() == key && e.observed == key &&
		auth.nativeCallID == nativeCallID && auth.action == input.Action &&
		auth.observationID == input.ObservationID && auth.ref == input.Ref && auth.text == input.Text &&
		auth.timeoutMS == input.TimeoutMS
	if !matched || !time.Now().Before(auth.expiresAt) {
		// A proof presented for a different or expired input never survives.
		e.pending = nil
		return time.Time{}, false
	}
	e.pending = nil
	return auth.expiresAt, true
}

func (e *computerExecutorDarwin) failure(selection m1bComputerSelection, requireObserved bool) string {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return computerExecutorUnavailable
	}
	key := selection.bindingKey()
	if !sameComputerBinding(e.binding, selection) || (requireObserved && e.observed != key) {
		return computerExecutorTargetChanged
	}
	return ""
}

// observeStart captures the exact binding generation before the driver work. A
// renewal keeps the same ids but advances the expiry and generation, so both
// must match: an observation admitted for the pre-renewal expiry can never
// enter (or complete) against the renewed grant.
func (e *computerExecutorDarwin) observeStart(selection m1bComputerSelection) (uint64, string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return 0, computerExecutorUnavailable
	}
	if !sameComputerBinding(e.binding, selection) {
		return 0, computerExecutorTargetChanged
	}
	return e.generation, ""
}

// clearObserved drops the observation marker only for the exact binding and
// generation that started the driver work. A delayed error from an observation
// admitted before a renewal must not clear a fresh observation completed under
// the renewed grant.
func (e *computerExecutorDarwin) clearObserved(selection m1bComputerSelection, generation uint64) {
	e.mu.Lock()
	if !e.closed && sameComputerBinding(e.binding, selection) && e.generation == generation {
		e.observed = ""
		e.pending = nil
	}
	e.mu.Unlock()
}

func (e *computerExecutorDarwin) status(ctx context.Context, selection m1bComputerSelection) m1bComputerResult {
	if ctx == nil {
		return m1bComputerFailure(computerExecutorInvalid)
	}
	if failure := e.failure(selection, false); failure != "" {
		return m1bComputerFailure(failure)
	}
	status, err := e.driver.Status(ctx)
	if err != nil {
		return m1bComputerFailure(computerExecutorDriverCode(err))
	}
	if failure := e.failure(selection, false); failure != "" {
		return m1bComputerFailure(failure)
	}
	return m1bComputerStatusResult(m1bComputerStatus{
		Available:   status.PermissionsReady,
		Permissions: m1bComputerPermissions{Accessibility: computerExecutorPermission(status.Accessibility)},
		// No standing task grant exists in this slice; approval is per input.
		ActiveGrant:         false,
		AgentDesktopVersion: status.AgentDesktopVersion,
	})
}

func (e *computerExecutorDarwin) observe(ctx context.Context, selection m1bComputerSelection) m1bComputerResult {
	if ctx == nil {
		return m1bComputerFailure(computerExecutorInvalid)
	}
	generation, failure := e.observeStart(selection)
	if failure != "" {
		return m1bComputerFailure(failure)
	}
	observation, err := e.driver.Observe(ctx, e.target)
	if err != nil {
		// The driver drops its refs before a refresh; mirror that binding state
		// only while the exact observation generation still owns it.
		e.clearObserved(selection, generation)
		return m1bComputerFailure(computerExecutorDriverCode(err))
	}
	key := selection.bindingKey()
	e.mu.Lock()
	closed := e.closed
	sameBinding := sameComputerBinding(e.binding, selection)
	sameGeneration := e.generation == generation
	if !closed && sameBinding && sameGeneration {
		// Recheck under the same lock that publishes the observation marker.
		if ctx.Err() == nil {
			e.observed = key
			e.mu.Unlock()
			return m1bComputerObservationResult(computerExecutorObservation(observation))
		}
	}
	e.mu.Unlock()
	if !closed && sameBinding && sameGeneration {
		// The exact observation was canceled after the driver refreshed its
		// refs; drop them. A renewal/replacement owns a newer observation, so
		// never invalidate that from a delayed older result.
		e.driver.Invalidate()
		return m1bComputerFailure(computerExecutorTimeout)
	}
	if ctx.Err() != nil {
		return m1bComputerFailure(computerExecutorTimeout)
	}
	return m1bComputerFailure(computerExecutorTargetChanged)
}

// actStart captures the exact binding generation and act slot before the host
// proof is consumed. A renewal that lands while the act waits for its proof
// advances the generation and expiry, so an act admitted for the old grant can
// never install itself afterwards.
func (e *computerExecutorDarwin) actStart(selection m1bComputerSelection) (uint64, string, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return 0, computerExecutorUnavailable, false
	}
	key := selection.bindingKey()
	if !sameComputerBinding(e.binding, selection) || e.observed != key {
		return 0, computerExecutorTargetChanged, false
	}
	return e.generation, "", e.active != nil
}

// act dispatches at most one click/type and never retries. The consumed proof,
// the selection expiry, the validated input timeout and the caller context
// bound the driver context, so expiry or cancellation during the driver's slow
// preflight stops it before input. The driver enforces its own process and CLI
// operation limits inside that context; no separate CLI budget is passed.
func (e *computerExecutorDarwin) act(ctx context.Context, selection m1bComputerSelection, nativeCallID string, input m1bComputerAct) m1bComputerResult {
	if ctx == nil {
		return m1bComputerActOutcome(m1bComputerActResult{OK: false, Error: computerExecutorInvalid})
	}
	generation, failure, busy := e.actStart(selection)
	if failure != "" {
		return m1bComputerActOutcome(m1bComputerActResult{OK: false, Error: failure})
	}
	if busy {
		return m1bComputerActOutcome(m1bComputerActResult{OK: false, Error: computerExecutorBusy})
	}
	proofExpiry, ok := e.consumeAuthorization(selection, nativeCallID, input)
	if !ok {
		return m1bComputerActOutcome(m1bComputerActResult{OK: false, Error: computerExecutorAccessDenied})
	}
	deadline := selection.ExpiresAt
	if proofExpiry.Before(deadline) {
		deadline = proofExpiry
	}
	if callerDeadline, has := ctx.Deadline(); has && callerDeadline.Before(deadline) {
		deadline = callerDeadline
	}
	// The consumed proof guarantees input.TimeoutMS is the same bounded
	// 100..20_000 ms wait (default 8_000) the host approved. Enforce it here too,
	// so a direct private caller and the driver context never outlive the
	// requested wait even if the selection or proof deadline is wider.
	if limit := time.Now().Add(time.Duration(input.TimeoutMS) * time.Millisecond); limit.Before(deadline) {
		deadline = limit
	}
	if !time.Now().Before(deadline) {
		return m1bComputerActOutcome(m1bComputerActResult{OK: false, Error: computerExecutorTimeout})
	}
	actCtx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	key := selection.bindingKey()
	run := &computerExecutorActRun{selectionKey: key, cancel: cancel}
	e.mu.Lock()
	code := ""
	switch {
	case e.closed:
		code = computerExecutorUnavailable
	case !sameComputerBinding(e.binding, selection) || e.observed != key || e.generation != generation:
		code = computerExecutorTargetChanged
	case e.active != nil:
		code = computerExecutorBusy
	default:
		e.active = run
	}
	e.mu.Unlock()
	if code != "" {
		return m1bComputerActOutcome(m1bComputerActResult{OK: false, Error: code})
	}
	start := time.Now()
	result, err := e.driver.Act(actCtx, computerAction{
		ObservationID: input.ObservationID,
		Kind:          computerActionKind(input.Action),
		Ref:           input.Ref,
		Text:          input.Text,
	})
	e.mu.Lock()
	if e.active == run {
		e.active = nil
	}
	e.mu.Unlock()
	if !result.Sent {
		if failure := e.failure(selection, true); failure != "" {
			// The preflight was canceled by revocation, invalidation or close:
			// proven no dispatch.
			return m1bComputerActOutcome(m1bComputerActResult{
				OK: false, Error: failure, WaitedMS: computerExecutorWaited(time.Since(start)),
			})
		}
	}
	return m1bComputerActOutcome(computerExecutorActResult(result, err, time.Since(start)))
}

// invalidate clears refs only for the exact selection the quiesce terminal
// closed and cancels its in-flight preflight. A replacement is untouched, and
// the driver process/state root stay alive.
func (e *computerExecutorDarwin) invalidate(selection m1bComputerSelection) {
	key := selection.bindingKey()
	var cancel context.CancelFunc
	clearRefs := false
	e.mu.Lock()
	if e.closed || e.binding.bindingKey() != key {
		e.mu.Unlock()
		return
	}
	if e.active != nil && e.active.selectionKey == key {
		cancel = e.active.cancel
	}
	if e.observed == key {
		e.observed = ""
		clearRefs = true
	}
	e.pending = nil
	e.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if clearRefs {
		e.driver.Invalidate()
	}
}

// close cancels any in-flight preflight and is the single state cleanup point.
func (e *computerExecutorDarwin) close() error {
	e.closeOnce.Do(func() {
		e.mu.Lock()
		e.closed = true
		e.observed = ""
		e.pending = nil
		cancel := context.CancelFunc(nil)
		if e.active != nil {
			cancel = e.active.cancel
		}
		e.mu.Unlock()
		if cancel != nil {
			cancel()
		}
		e.closeErr = e.driver.Close()
	})
	return e.closeErr
}

// computerExecutorActResult keeps the shared invariant: success needs a proven
// effect; a started but unproven result is uncertain, never ok without effect.
func computerExecutorActResult(result computerActionResult, err error, elapsed time.Duration) m1bComputerActResult {
	act := m1bComputerActResult{WaitedMS: computerExecutorWaited(elapsed)}
	effect := computerExecutorEffect(result.Effect)
	if effect != "" {
		act.Effect = effect
	}
	switch {
	case err == nil && result.Accepted && effect != "":
		act.OK = true
	case err == nil && result.Accepted:
		act.OK = false
		act.Error = computerExecutorUncertain
	case err == nil:
		act.OK = false
		act.Error = computerExecutorActionFailed
	case !result.Sent:
		act.OK = false
		act.Error = computerExecutorDriverCode(err)
	case result.Delivery == computerDeliveryNotDelivered && result.Retry == computerRetrySafe:
		act.OK = false
		act.Error = computerExecutorDriverCode(err)
	default:
		act.OK = false
		act.Error = computerExecutorUncertain
	}
	return act
}

func computerExecutorWaited(elapsed time.Duration) int {
	waited := int(elapsed / time.Millisecond)
	if waited < 0 {
		return 0
	}
	if waited > m1bComputerMaxTimeout {
		return m1bComputerMaxTimeout
	}
	return waited
}

// computerExecutorObservation emits only actionable nodes: the shared node
// requires a non-empty ref and role, so window/group containers are skipped.
// tree_quality and truncated still describe the original tree.
func computerExecutorObservation(observation computerObservation) m1bComputerObservation {
	nodes := make([]m1bComputerNode, 0, len(observation.Elements))
	for _, element := range observation.Elements {
		ref := computerExecutorRef(element.Ref)
		role := computerExecutorUnits(element.Role, computerExecutorMaxRoleUnits)
		if ref == "" || role == "" {
			continue
		}
		node := m1bComputerNode{Ref: ref, Role: role}
		if name := computerExecutorUnits(element.Name, computerExecutorMaxNameUnits); name != "" {
			node.Name = &name
		}
		// Value and Description stay inside the driver.
		nodes = append(nodes, node)
	}
	return m1bComputerObservation{
		ObservationID: observation.ID,
		TreeQuality:   computerExecutorQuality(observation.TreeQuality),
		Truncated:     observation.Truncated,
		Nodes:         nodes,
	}
}

// computerExecutorUnits truncates at a UTF-16 code-unit budget without
// splitting a rune.
func computerExecutorUnits(value string, limit int) string {
	units := 0
	for index, char := range value {
		width := 1
		if char > 0xFFFF {
			width = 2
		}
		if units+width > limit {
			return value[:index]
		}
		units += width
	}
	return value
}

func computerExecutorRef(ref string) string {
	if ref == "" || !computerRefPattern.MatchString(ref) || !m1bComputerStringOK(ref, 1, m1bComputerMaxRef) {
		return ""
	}
	return ref
}

func computerExecutorQuality(quality string) string {
	switch quality {
	case computerTreeQualityGood, computerTreeQualityPartial, computerTreeQualityUnusable:
		return quality
	default:
		return computerTreeQualityUnusable
	}
}

// computerExecutorPermission maps driver states to the shared enum.
func computerExecutorPermission(state string) string {
	switch state {
	case "granted":
		return "granted"
	case "denied":
		return "missing"
	default:
		return "unknown"
	}
}

// computerExecutorEffect keeps only the shared effect values; an unknown driver
// effect is omitted.
func computerExecutorEffect(effect string) string {
	switch effect {
	case computerEffectDone, computerEffectSmallChange, computerEffectNoEffect, computerEffectPlaceChanged:
		return effect
	default:
		return ""
	}
}

// computerExecutorDriverCode maps driver errors to the shared failure enum.
func computerExecutorDriverCode(err error) string {
	var driverErr *computerDriverError
	if errors.As(err, &driverErr) {
		switch driverErr.Code {
		case computerErrorAccessDenied:
			return computerExecutorAccessDenied
		case computerErrorTargetChanged, computerErrorTargetUnavailable:
			return computerExecutorTargetChanged
		case computerErrorNoObservation, computerErrorStaleObservation:
			return computerExecutorStaleObservation
		case computerErrorStaleRef:
			return computerExecutorStaleRef
		case computerErrorInvalidArgument, computerErrorUnsupportedAction:
			return computerExecutorInvalid
		case computerErrorTimeout:
			return computerExecutorTimeout
		case computerErrorClosed, computerErrorStateUnavailable, computerErrorSandboxUnavailable,
			computerErrorRuntimeProofMissing, computerErrorRuntimeProofInvalid,
			computerErrorRuntimeUntrusted:
			return computerExecutorUnavailable
		}
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return computerExecutorTimeout
	}
	return computerExecutorActionFailed
}
