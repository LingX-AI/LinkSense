package main

// Native dispatch for the M1b `computer.execute` operation.
//
// The Go bridge is the only component that knows both the negotiated device
// link and the host-picked selection. It consumes this operation before the
// frame reaches the runtime pipe, so the runner never sees a command outside
// its accepted closed set. On macOS the product controller installs an
// m1bComputerHost backed by the signed, on-demand executor; a connection with
// no host (another platform, or a host that cannot build the signed runtime)
// never offers the operation and rejects any unexpected computer-prefixed
// command instead of forwarding it.
//
// The host gate owns pause/stop fencing and the observation refs; the executor
// owns the host-picked window. The host binds the API-issued holder UUID on the
// first matching observe, keeps command ids once per transport command until
// expiry, and serializes one selection across socket generations. This file
// holds no driver, AX/screen access, app/PID/ref selector, live permission or
// registration code; those sit behind the executor seam.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/coder/websocket"
)

const (
	m1bComputerOperation = "computer.execute"

	// m1bComputerMaxWork bounds read-only status/observe and the quiesce
	// control path. Act instead uses its host-validated timeout_ms (default
	// 8_000, max 20_000), which the shared schema already caps. Wait uses its
	// own bounded timeout plus m1bComputerWaitGrace, so the native predicate
	// expiry envelope and the before/after identity checks can complete inside
	// the same finite transport context. Max wait work stays below the hard
	// 25-second tool request limit.
	m1bComputerMaxWork        = 5 * time.Second
	m1bComputerWaitGrace      = 4 * time.Second
	m1bComputerMaxCommands    = 1024
	m1bComputerMaxControls    = 1
	m1bComputerMaxTombstones  = 256
	m1bComputerTombstoneGrace = time.Minute
	m1bComputerMaxNativeID    = 240
	m1bComputerMaxObservID    = 120
	m1bComputerMaxRef         = 200
	m1bComputerDefaultTimeout = 8_000
	m1bComputerMinTimeout     = 100
	m1bComputerMaxTimeout     = 20_000
	m1bComputerMaxTextUnits   = 8_000
	m1bComputerMaxTextBytes   = 8_192
)

const (
	// Closed wait result set and the one fixed native predicate. These are
	// shared by the host-facing fixtures, the executor, and the Darwin driver,
	// so a non-Darwin build still has the stable wire vocabulary.
	computerWaitMet                 = "met"
	computerWaitTimedOut            = "timed_out"
	computerWaitPredicateActionable = "actionable"
)

var (
	errM1BComputerInvalid = errors.New("COMPUTER_INVALID")

	// v1.3.1 validates a ref as @<snapshot_id>:e<digits>, where the snapshot id
	// is 3-64 ASCII letters, digits, '-' or '_'. This definition is shared by
	// the host parser and the Darwin driver/executor so every layer accepts the
	// exact same qualified AX ref on every platform build.
	computerRefPattern = regexp.MustCompile(`^@[A-Za-z0-9_-]{3,64}:e[0-9]{1,10}$`)
)

// m1bComputerSelection is the host-picked binding for one device link and run.
// The payload can only repeat these ids; it can never name an application,
// process, window, or element target. The holder is deliberately absent: it is
// API-issued and adopted by the first matching observe.
type m1bComputerSelection struct {
	OwnerID           string
	LinkID            string
	ConversationID    string
	RuntimeGeneration string
	TurnID            string
	SessionID         string
	SelectionID       string
	ExpiresAt         time.Time
}

func (selection m1bComputerSelection) bindingKey() string {
	return strings.ToLower(strings.Join([]string{
		selection.OwnerID, selection.LinkID, selection.ConversationID, selection.RuntimeGeneration,
		selection.TurnID, selection.SessionID, selection.SelectionID,
	}, "\x00"))
}

// closedKey is per selection, not per link: quiesce permanently closes a
// selection even if a later socket generation presents the same selection id.
func (selection m1bComputerSelection) closedKey() string {
	return strings.ToLower(selection.OwnerID + "\x00" + selection.SelectionID)
}

// m1bComputerAct is the validated, normalized action input. Only one action is
// representable and unknown selector fields are rejected during decoding.
// timeout_ms is normalized once here (absent means 8_000) and the act is then
// passed unchanged to the executor so the one-shot host authorization compares
// the exact validated input.
type m1bComputerAct struct {
	Action        string
	ObservationID string
	Ref           string
	Text          string
	TimeoutMS     int
}

// m1bComputerWait is the validated read-only wait input. The predicate is
// fixed to actionable and there is no selector: only the exact ref from the
// latest observation and a bounded timeout cross this boundary.
type m1bComputerWait struct {
	ObservationID string
	Ref           string
	TimeoutMS     int
}

type m1bComputerRequest struct {
	Kind         string
	NativeCallID string
	Act          *m1bComputerAct
	Wait         *m1bComputerWait
}

type m1bComputerCommand struct {
	ID                string
	OwnerID           string
	ConversationID    string
	RuntimeGeneration string
	TurnID            string
	ExpiresAt         time.Time
	SessionID         string
	SelectionID       string
	HolderID          string
	Request           m1bComputerRequest
}

// Wire result types mirror the shared Zod schemas.
type m1bComputerStatus struct {
	Available           bool                   `json:"available"`
	Permissions         m1bComputerPermissions `json:"permissions"`
	ActiveGrant         bool                   `json:"active_grant"`
	AgentDesktopVersion string                 `json:"agent_desktop_version,omitempty"`
}

type m1bComputerPermissions struct {
	Accessibility string `json:"accessibility"`
}

type m1bComputerObservation struct {
	ObservationID string            `json:"observation_id"`
	TreeQuality   string            `json:"tree_quality"`
	Truncated     bool              `json:"truncated"`
	Nodes         []m1bComputerNode `json:"nodes"`
}

type m1bComputerNode struct {
	Ref  string  `json:"ref"`
	Role string  `json:"role"`
	Name *string `json:"name,omitempty"`
}

type m1bComputerActResult struct {
	OK       bool   `json:"ok"`
	Effect   string `json:"effect,omitempty"`
	WaitedMS int    `json:"waited_ms"`
	Error    string `json:"error,omitempty"`
}

type m1bComputerWaitResult struct {
	Result   string `json:"result"`
	WaitedMS int    `json:"waited_ms"`
}

type m1bComputerQuiesceResult struct {
	Quiesced bool `json:"quiesced"`
}

type m1bComputerTypedResult struct {
	Kind   string `json:"kind"`
	Result any    `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
}

type m1bComputerCommandResult struct {
	Type      string                 `json:"type"`
	ID        string                 `json:"id"`
	Operation string                 `json:"operation"`
	OK        bool                   `json:"ok"`
	Result    m1bComputerTypedResult `json:"result"`
}

type m1bComputerResult struct {
	kind        string
	status      m1bComputerStatus
	observation m1bComputerObservation
	wait        m1bComputerWaitResult
	act         m1bComputerActResult
	failure     string
}

func m1bComputerStatusResult(result m1bComputerStatus) m1bComputerResult {
	return m1bComputerResult{kind: "status", status: result}
}

func m1bComputerObservationResult(result m1bComputerObservation) m1bComputerResult {
	return m1bComputerResult{kind: "observe", observation: result}
}

func m1bComputerWaitOutcome(result m1bComputerWaitResult) m1bComputerResult {
	return m1bComputerResult{kind: "wait", wait: result}
}

func m1bComputerActOutcome(result m1bComputerActResult) m1bComputerResult {
	return m1bComputerResult{kind: "act", act: result}
}

func m1bComputerFailure(code string) m1bComputerResult {
	return m1bComputerResult{kind: "failure", failure: code}
}

// m1bComputerExecutor is the host seam implemented by the product gate
// (computerExecutorGate) and by test fakes. Implementations are host-picked:
// selection returns the trusted binding for this run, and invalidate clears the
// refs bound by the last observe after quiesce terminal.
type m1bComputerExecutor interface {
	selection() m1bComputerSelection
	status(context.Context, m1bComputerSelection) m1bComputerResult
	observe(context.Context, m1bComputerSelection) m1bComputerResult
	wait(context.Context, m1bComputerSelection, m1bComputerWait) m1bComputerResult
	act(context.Context, m1bComputerSelection, string, m1bComputerAct) m1bComputerResult
	invalidate(m1bComputerSelection)
}

// m1bComputerWaitPublication is implemented by the macOS product gate. It
// exposes the cancellation lifetime of one exact acknowledged grant so an
// admitted wait's driver work and its bounded final wire publication are
// closed together by pause, stop, expiry or same-id renewal. A test double
// without it keeps the existing transport-bound context.
type m1bComputerWaitPublication interface {
	waitPublicationContext(m1bComputerSelection) (context.Context, bool)
}

// m1bComputerDispatch is one admitted transport command. terminal closes when
// the executor returns; done closes after its result publication decision so a
// quiesce can never ack ahead of an old success.
type m1bComputerDispatch struct {
	id           string
	kind         string
	token        uint64
	expiresAt    time.Time
	deadline     time.Time
	ctx          context.Context
	selectionKey string
	cancel       context.CancelFunc
	canceled     bool
	terminal     chan struct{}
	done         chan struct{}
}

type m1bComputerBegin struct {
	work        *m1bComputerDispatch
	failure     string
	overflow    bool
	oldTerminal <-chan struct{}
	oldDone     <-chan struct{}
}

// m1bComputerTombstone keeps a quiesced selection closed across executor
// selection changes and links. It is keyed by owner+selection, never by link,
// and retires only after the original authorization deadline plus a bounded
// control/replay grace. New turns and resumptions must issue a new selection
// id; admission fails closed rather than evicting a live tombstone.
type m1bComputerTombstone struct {
	expiresAt time.Time
	holder    string
}

// m1bComputerHost serializes one executor across device connections.
//
// ponytail: one mutex and one current host-picked binding fit the single-device
// product host. The holder/closed state is bound to the full selection/link
// key, so a new socket generation never inherits an old holder. A new selection
// replaces the state; the product controller gives a resume a new selection id.
type m1bComputerHost struct {
	executor m1bComputerExecutor

	mu       sync.Mutex
	holder   uint64
	sequence uint64
	active   *m1bComputerDispatch
	// last is the most recent admitted input until its result publication
	// finishes. It lets a quiesce wait for a success that is still being
	// written after the executor already returned.
	last     *m1bComputerDispatch
	controls int

	selectionBinding   string
	selectionHolder    string
	selectionHasHolder bool
	selectionClosed    bool
	tombstones         map[string]m1bComputerTombstone

	commands map[string]*m1bComputerDispatch
}

func newM1BComputerHost(executor m1bComputerExecutor) *m1bComputerHost {
	return &m1bComputerHost{
		executor:   executor,
		tombstones: make(map[string]m1bComputerTombstone),
		commands:   make(map[string]*m1bComputerDispatch),
	}
}

func (host *m1bComputerHost) open() uint64 {
	host.mu.Lock()
	defer host.mu.Unlock()
	host.sequence++
	host.holder = host.sequence
	if host.active != nil {
		host.active.canceled = true
		if host.active.cancel != nil {
			host.active.cancel()
		}
	}
	return host.sequence
}

// release only clears the holder it was issued for, so an old connection can
// never release a newer one.
func (host *m1bComputerHost) release(token uint64) {
	host.mu.Lock()
	if host.holder == token {
		host.holder = 0
	}
	if host.active != nil && host.active.token == token {
		host.active.canceled = true
		if host.active.cancel != nil {
			host.active.cancel()
		}
	}
	host.mu.Unlock()
}

func (host *m1bComputerHost) current(token uint64) bool {
	host.mu.Lock()
	defer host.mu.Unlock()
	return token != 0 && host.holder == token
}

func (host *m1bComputerHost) isCanceled(work *m1bComputerDispatch) bool {
	host.mu.Lock()
	defer host.mu.Unlock()
	return work.canceled
}

func (host *m1bComputerHost) deliverable(work *m1bComputerDispatch) bool {
	host.mu.Lock()
	defer host.mu.Unlock()
	return !work.canceled && host.holder == work.token
}

// inputBusy reports whether an act is admitted or its result is still being
// published. An explicit renewal must not replace the grant while an act may
// already have reached the native executor under it. Read-only status/observe
// and wait work is not act input: status/observe is fenced by the executor's
// own generation, and a same-binding renewal cancels/cuts the wait generation
// instead of inheriting the act busy slot.
func (host *m1bComputerHost) inputBusy() bool {
	host.mu.Lock()
	defer host.mu.Unlock()
	if host.active != nil && host.active.kind == "act" {
		return true
	}
	return host.last != nil && host.last.kind == "act" && !m1bClosed(host.last.done)
}

// selectionCurrent revalidates the exact host-picked selection immediately
// before executor entry or ref invalidation.
func (host *m1bComputerHost) selectionCurrent(selection m1bComputerSelection) bool {
	return host.executor.selection().bindingKey() == selection.bindingKey()
}

// selectionCurrentExact also requires the acknowledged expiry. A wait is a
// read-only observation of one exact grant generation, so a same-identity
// renewal must not publish its pre-renewal success even when the id binding is
// unchanged.
func (host *m1bComputerHost) selectionCurrentExact(selection m1bComputerSelection) bool {
	current := host.executor.selection()
	return current.bindingKey() == selection.bindingKey() && current.ExpiresAt.Equal(selection.ExpiresAt)
}

func (host *m1bComputerHost) currentSelectionFor(kind string, selection m1bComputerSelection) bool {
	if kind == "wait" {
		return host.selectionCurrentExact(selection)
	}
	return host.selectionCurrent(selection)
}

// retire closes the exact selection's input binding without forgetting the
// holder adopted for it. The bound driver may already be detached, so a
// correlated server quiesce must still be able to match this exact
// binding/holder and prove the old publication; no observe/act may enter.
func (host *m1bComputerHost) retire(selection m1bComputerSelection) {
	if host == nil {
		return
	}
	host.mu.Lock()
	if host.selectionBinding == selection.bindingKey() {
		host.selectionClosed = true
	}
	host.mu.Unlock()
}

// sweepLocked keeps unexpired transport command ids and retires only expired
// ones. The runner uses this same expiry-sweep shape.
func (host *m1bComputerHost) sweepLocked(now time.Time) {
	for id, work := range host.commands {
		if !now.Before(work.expiresAt) {
			delete(host.commands, id)
		}
	}
}

func m1bComputerCommandKey(id string) string {
	return strings.ToLower(id)
}

// claimReceipt is the one receipt admission point. It runs after a successful
// strict parse of a live command and before any binding/holder authorization,
// so a correlated rejected command id also cannot be replayed into a different
// selection. Duplicate claims emit no reply and never enter.
func (host *m1bComputerHost) claimReceipt(id string, expiresAt time.Time) (*m1bComputerDispatch, bool, bool) {
	host.mu.Lock()
	defer host.mu.Unlock()
	host.sweepLocked(time.Now())
	key := m1bComputerCommandKey(id)
	if host.commands[key] != nil {
		return nil, true, false
	}
	if len(host.commands) >= m1bComputerMaxCommands {
		return nil, false, true
	}
	work := &m1bComputerDispatch{id: id, expiresAt: expiresAt, terminal: make(chan struct{}), done: make(chan struct{})}
	host.commands[key] = work
	return work, false, false
}

func m1bComputerTombstoneDeadline(selection m1bComputerSelection, now time.Time) time.Time {
	deadline := selection.ExpiresAt
	if deadline.Before(now) {
		deadline = now
	}
	return deadline.Add(m1bComputerTombstoneGrace)
}

func (host *m1bComputerHost) sweepTombstonesLocked(now time.Time) {
	for key, tombstone := range host.tombstones {
		if !now.Before(tombstone.expiresAt) {
			delete(host.tombstones, key)
		}
	}
}

func (host *m1bComputerHost) tombstoneLocked(selection m1bComputerSelection, now time.Time) (m1bComputerTombstone, bool) {
	host.sweepTombstonesLocked(now)
	tombstone, ok := host.tombstones[selection.closedKey()]
	return tombstone, ok
}

func (host *m1bComputerHost) bindingStateLocked(selection m1bComputerSelection) (string, bool, bool) {
	if host.selectionBinding != selection.bindingKey() {
		return "", false, false
	}
	return host.selectionHolder, host.selectionHasHolder, host.selectionClosed
}

// holderFailureLocked validates the holder rules without adopting. Status is
// read-only and carries no holder. Adoption happens only at the end of a
// successful first observe.
func (host *m1bComputerHost) holderFailureLocked(selection m1bComputerSelection, command m1bComputerCommand) (string, bool) {
	holder, hasHolder, _ := host.bindingStateLocked(selection)
	switch command.Request.Kind {
	case "observe":
		if hasHolder && !strings.EqualFold(holder, command.HolderID) {
			return "COMPUTER_TARGET_CHANGED", hasHolder
		}
	case "wait", "act":
		if !hasHolder || !strings.EqualFold(holder, command.HolderID) {
			return "COMPUTER_TARGET_CHANGED", hasHolder
		}
	}
	return "", hasHolder
}

func (host *m1bComputerHost) beginInput(link *m1bComputerLink, selection m1bComputerSelection, command m1bComputerCommand, deadline time.Time, ctx context.Context, cancel context.CancelFunc, work *m1bComputerDispatch) m1bComputerBegin {
	host.mu.Lock()
	defer host.mu.Unlock()
	now := time.Now()
	if host.holder != link.token {
		return m1bComputerBegin{failure: "COMPUTER_TARGET_CHANGED"}
	}
	if _, closed := host.tombstoneLocked(selection, now); closed {
		// A quiesced owner+selection stays closed across links and executor
		// selection switches until its bounded tombstone retires.
		return m1bComputerBegin{failure: "COMPUTER_TARGET_CHANGED"}
	}
	if _, _, closed := host.bindingStateLocked(selection); closed {
		// A stopped selection accepts only a live quiesce.
		return m1bComputerBegin{failure: "COMPUTER_TARGET_CHANGED"}
	}
	if !now.Before(deadline) {
		return m1bComputerBegin{failure: "COMPUTER_TIMEOUT"}
	}
	failure, hasHolder := host.holderFailureLocked(selection, command)
	if failure != "" {
		return m1bComputerBegin{failure: failure}
	}
	if host.controls > 0 {
		// No new input enters while a quiesce control is running.
		return m1bComputerBegin{failure: "DEVICE_BUSY"}
	}
	if host.active != nil || (host.last != nil && !m1bClosed(host.last.done)) {
		// The single-action slot includes the previous result publication, so
		// a new input cannot overlap a success still being written.
		return m1bComputerBegin{failure: "DEVICE_BUSY"}
	}
	work.token = link.token
	work.kind = command.Request.Kind
	work.deadline = deadline
	work.ctx = ctx
	work.selectionKey = selection.bindingKey()
	work.cancel = cancel
	if command.Request.Kind == "observe" && !hasHolder {
		// The first matching observe on the authenticated current connection
		// adopts the API-issued holder. No other kind can acquire.
		host.selectionBinding = selection.bindingKey()
		host.selectionHolder = command.HolderID
		host.selectionHasHolder = true
		host.selectionClosed = false
	}
	host.active = work
	host.last = work
	return m1bComputerBegin{work: work}
}

func (host *m1bComputerHost) beginQuiesce(link *m1bComputerLink, selection m1bComputerSelection, command m1bComputerCommand, deadline time.Time, ctx context.Context, cancel context.CancelFunc, work *m1bComputerDispatch) m1bComputerBegin {
	host.mu.Lock()
	defer host.mu.Unlock()
	now := time.Now()
	if host.holder != link.token {
		return m1bComputerBegin{failure: "COMPUTER_TARGET_CHANGED"}
	}
	// A stopped or grant-expired selection still accepts a live quiesce with
	// the exact holder. A tombstone retains the holder across executor
	// selection switches and links.
	tombstone, hasTombstone := host.tombstoneLocked(selection, now)
	var holder string
	if hasTombstone {
		holder = tombstone.holder
	} else {
		current, hasHolder, _ := host.bindingStateLocked(selection)
		if !hasHolder {
			return m1bComputerBegin{failure: "COMPUTER_TARGET_CHANGED"}
		}
		holder = current
	}
	if !strings.EqualFold(holder, command.HolderID) {
		return m1bComputerBegin{failure: "COMPUTER_TARGET_CHANGED"}
	}
	if !now.Before(deadline) {
		return m1bComputerBegin{failure: "COMPUTER_TIMEOUT"}
	}
	if !hasTombstone && len(host.tombstones) >= m1bComputerMaxTombstones {
		// Never evict a live tombstone to admit a new one.
		return m1bComputerBegin{overflow: true}
	}
	if host.controls >= m1bComputerMaxControls {
		return m1bComputerBegin{failure: "DEVICE_BUSY"}
	}
	work.token = link.token
	work.kind = command.Request.Kind
	work.deadline = deadline
	work.ctx = ctx
	work.selectionKey = selection.bindingKey()
	work.cancel = cancel
	host.controls++
	// Stop before waiting: the controls gate blocks new input while this
	// selection is closed. The tombstone is keyed by owner+selection, never by
	// link, so a resume with the same selection id stays closed.
	host.selectionBinding = selection.bindingKey()
	host.selectionHolder = holder
	host.selectionHasHolder = true
	host.selectionClosed = true
	if !hasTombstone {
		host.tombstones[selection.closedKey()] = m1bComputerTombstone{
			expiresAt: m1bComputerTombstoneDeadline(selection, now), holder: holder,
		}
	}
	old := host.active
	if old == nil && host.last != nil && !m1bClosed(host.last.done) {
		// The executor is terminal but its existing result may still be in the
		// write path; the ack must not overtake it.
		old = host.last
	}
	if old != nil && old.selectionKey != selection.bindingKey() {
		// Never cancel a different selection's active/replacement work.
		old = nil
	}
	var oldTerminal, oldDone <-chan struct{}
	if old != nil {
		old.canceled = true
		if old.cancel != nil {
			old.cancel()
		}
		oldTerminal, oldDone = old.terminal, old.done
	} else {
		terminal, done := make(chan struct{}), make(chan struct{})
		close(terminal)
		close(done)
		oldTerminal, oldDone = terminal, done
	}
	return m1bComputerBegin{work: work, oldTerminal: oldTerminal, oldDone: oldDone}
}

func (host *m1bComputerHost) finishInput(link *m1bComputerLink, work *m1bComputerDispatch) bool {
	host.mu.Lock()
	if host.active == work {
		host.active = nil
	}
	alive := !work.canceled && host.holder == work.token && link.ctx.Err() == nil
	close(work.terminal)
	host.mu.Unlock()
	return alive
}

func (host *m1bComputerHost) finishQuiesce(work *m1bComputerDispatch) {
	host.mu.Lock()
	if host.controls > 0 {
		host.controls--
	}
	close(work.done)
	host.mu.Unlock()
}

// finishPublication closes the input's terminal publication gate after its
// result was sent or suppressed, and releases the last-input slot.
func (host *m1bComputerHost) finishPublication(work *m1bComputerDispatch) {
	host.mu.Lock()
	close(work.done)
	if host.last == work {
		host.last = nil
	}
	host.mu.Unlock()
}

// cancel is scoped to the exact socket generation that issued the command. A
// known id from another generation is consumed but never cancels the newer
// command.
func (host *m1bComputerHost) cancel(id string, token uint64) bool {
	host.mu.Lock()
	work := host.commands[m1bComputerCommandKey(id)]
	if work == nil {
		host.mu.Unlock()
		return false
	}
	var cancel context.CancelFunc
	if work.token == token {
		work.canceled = true
		cancel = work.cancel
	}
	host.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return true
}

// m1bComputerLink is the per-socket view of the host. ctx is a per-socket
// context so socket/read/link shutdown cancels in-flight work before the
// deferred heartbeat join.
type m1bComputerLink struct {
	connection *deviceConnection
	socket     *websocket.Conn
	host       *m1bComputerHost
	token      uint64
	linkID     string
	ctx        context.Context
	live       func() bool
	write      func(context.Context, []byte) error
}

func (link *m1bComputerLink) executable() bool {
	if link == nil || link.connection == nil || link.ctx == nil || link.ctx.Err() != nil {
		return false
	}
	if !link.connection.authorized() {
		return false
	}
	return link.live == nil || link.live()
}

// interceptM1BComputerFrame consumes only computer operations and cancels for
// commands this host issued. Every other frame returns false and keeps the
// existing forwarding path unchanged.
func interceptM1BComputerFrame(link *m1bComputerLink, data []byte) bool {
	var header struct {
		Type      string `json:"type"`
		Operation string `json:"operation"`
		ID        string `json:"id"`
	}
	if json.Unmarshal(data, &header) != nil {
		return false
	}
	switch header.Type {
	case "command":
		// Match case-insensitively only to keep an unrecognized computer
		// command out of the runtime; the strict parser still requires the
		// canonical operation string.
		operation := strings.ToLower(header.Operation)
		if operation == m1bComputerOperation {
			if link == nil || link.host == nil || link.token == 0 {
				if link != nil {
					link.replyFailure(m1bComputerCommandID(data), "COMPUTER_UNAVAILABLE")
				}
			} else {
				link.dispatch(data)
			}
			return true
		}
		if strings.HasPrefix(operation, "computer.") {
			if link != nil {
				link.replyFailure(m1bComputerCommandID(data), "COMPUTER_UNAVAILABLE")
			}
			return true
		}
	case "command.cancel":
		return link != nil && link.host != nil && link.host.cancel(header.ID, link.token)
	}
	return false
}

func (link *m1bComputerLink) dispatch(data []byte) {
	if !link.executable() {
		return
	}
	command, id, err := m1bComputerParseCommand(data)
	if err != nil {
		link.replyFailure(id, "COMPUTER_INVALID")
		return
	}
	if !time.Now().Before(command.ExpiresAt) {
		// An expired transport command is not live and is not claimed.
		link.replyFailure(command.ID, "COMPUTER_TIMEOUT")
		return
	}
	// Claim the receipt before any binding/holder authorization. A correlated
	// rejected command id is retained too, so a replay cannot enter through a
	// later selection change and cannot emit a second reply.
	work, duplicate, overflow := link.host.claimReceipt(command.ID, command.ExpiresAt)
	if duplicate {
		return
	}
	if overflow {
		link.failClosed()
		return
	}
	selection := link.host.executor.selection()
	if failure := m1bComputerBindingFailure(link, command, selection); failure != "" {
		link.replyFailure(command.ID, failure)
		return
	}
	now := time.Now()
	if command.Request.Kind == "quiesce" {
		deadline, failure := m1bComputerControlDeadline(command, now)
		if failure != "" {
			link.replyFailure(command.ID, failure)
			return
		}
		ctx, cancel := context.WithDeadline(link.ctx, deadline)
		begin := link.host.beginQuiesce(link, selection, command, deadline, ctx, cancel, work)
		if !link.beginResult(command.ID, begin, cancel) {
			return
		}
		go link.runQuiesce(ctx, cancel, command.ID, begin.oldTerminal, begin.oldDone, begin.work, selection)
		return
	}
	deadline, failure := m1bComputerInputDeadline(selection, command, now)
	if failure != "" {
		link.replyFailure(command.ID, failure)
		return
	}
	ctx, cancel := m1bComputerInputContext(link, selection, command.Request.Kind, deadline)
	begin := link.host.beginInput(link, selection, command, deadline, ctx, cancel, work)
	if !link.beginResult(command.ID, begin, cancel) {
		return
	}
	go link.runInput(ctx, cancel, begin.work, selection, command.Request)
}

// beginResult handles tombstone capacity and immediate failure outcomes.
func (link *m1bComputerLink) beginResult(id string, begin m1bComputerBegin, cancel context.CancelFunc) bool {
	if begin.overflow {
		cancel()
		link.failClosed()
		return false
	}
	if begin.failure != "" {
		cancel()
		link.replyFailure(id, begin.failure)
		return false
	}
	return true
}

func (link *m1bComputerLink) failClosed() {
	if link == nil || link.connection == nil {
		return
	}
	// Do not reconnect with the same full unexpired command set.
	link.connection.cancel()
	if link.socket != nil {
		_ = link.socket.Close(websocket.StatusPolicyViolation, "computer command capacity")
	}
}

func (link *m1bComputerLink) runInput(ctx context.Context, cancel context.CancelFunc, work *m1bComputerDispatch, selection m1bComputerSelection, request m1bComputerRequest) {
	defer cancel()
	defer link.host.finishPublication(work)
	entered := false
	var outcome m1bComputerResult
	if !link.host.isCanceled(work) && link.executable() && link.host.currentSelectionFor(request.Kind, selection) &&
		time.Now().Before(work.deadline) && ctx.Err() == nil {
		// Guard immediately before entering the executor, after context,
		// account lease and runtime-link checks.
		entered = true
		switch request.Kind {
		case "status":
			outcome = link.host.executor.status(ctx, selection)
		case "observe":
			outcome = link.host.executor.observe(ctx, selection)
		case "wait":
			if request.Wait == nil {
				outcome = m1bComputerFailure("COMPUTER_INVALID")
				break
			}
			outcome = link.host.executor.wait(ctx, selection, *request.Wait)
		case "act":
			if request.Act == nil {
				outcome = m1bComputerFailure("COMPUTER_INVALID")
				break
			}
			// Pass the parser-normalized act unchanged. The host authorization is
			// bound to this exact input, including timeout_ms, and ctx already
			// carries the command/selection/requested-wait deadline. Mutating the
			// wait here would make an exact one-shot proof unmatchable as
			// transport time elapses.
			outcome = link.host.executor.act(ctx, selection, request.NativeCallID, *request.Act)
		}
	}
	alive := link.host.finishInput(link, work)
	if !alive {
		return
	}
	// Only an act can have an unknown side effect after entry. Read-only
	// status/observe timeouts stay clean timeouts.
	uncertain := entered && request.Kind == "act"
	if m1bComputerTimedOut(ctx, work.deadline) {
		if uncertain {
			link.replyWorkFailure(work, "RUNNER_OPERATION_UNCERTAIN")
		} else {
			link.replyWorkFailure(work, "COMPUTER_TIMEOUT")
		}
		return
	}
	if ctx.Err() != nil || !link.host.deliverable(work) || !link.executable() ||
		!link.host.currentSelectionFor(request.Kind, selection) {
		return
	}
	// Suppress or classify uncertainty when the deadline crosses between the
	// terminal and the write.
	if m1bComputerTimedOut(ctx, work.deadline) {
		if uncertain {
			link.replyWorkFailure(work, "RUNNER_OPERATION_UNCERTAIN")
		} else {
			link.replyWorkFailure(work, "COMPUTER_TIMEOUT")
		}
		return
	}
	if outcome.kind != request.Kind && outcome.kind != "failure" {
		outcome = m1bComputerFailure("COMPUTER_ACTION_FAILED")
	}
	link.sendOutcome(work, outcome)
}

func (link *m1bComputerLink) runQuiesce(ctx context.Context, cancel context.CancelFunc, id string, terminal, oldDone <-chan struct{}, work *m1bComputerDispatch, selection m1bComputerSelection) {
	defer cancel()
	defer link.host.finishQuiesce(work)
	terminalSeen := false
	select {
	case <-terminal:
		terminalSeen = true
	case <-ctx.Done():
	}
	if !terminalSeen {
		select {
		case <-terminal:
			terminalSeen = true
		default:
		}
	}
	if terminalSeen {
		// Clear only this exact selection's refs after the executor is
		// terminal, and before the ack.
		link.host.executor.invalidate(selection)
		select {
		case <-oldDone:
		case <-ctx.Done():
		}
	}
	if link.host.isCanceled(work) || ctx.Err() != nil || !link.executable() || !link.host.deliverable(work) {
		return
	}
	if !terminalSeen {
		// No executor terminal means no proof of quiescence.
		link.replyWorkFailure(work, "COMPUTER_TIMEOUT")
		return
	}
	select {
	case <-oldDone:
	default:
		// The old result publication is still in flight; an ack would be able
		// to overtake it.
		link.replyWorkFailure(work, "COMPUTER_TIMEOUT")
		return
	}
	if !time.Now().Before(work.deadline) {
		// An expired control never acks.
		return
	}
	link.sendWorkResult(work, m1bComputerTypedResult{Kind: "quiesce", Result: m1bComputerQuiesceResult{Quiesced: true}})
}

// m1bComputerInputContext combines the transport lifetime, the exact grant
// lifetime exposed by the product gate, and the existing command deadline.
// The grant is the direct parent so a pause, stop, expiry or renewal closes a
// blocked final write synchronously. The transport context is relayed into the
// same child, so socket shutdown still cancels the work. Non-wait input keeps
// the previous transport-only context.
func m1bComputerInputContext(link *m1bComputerLink, selection m1bComputerSelection, kind string, deadline time.Time) (context.Context, context.CancelFunc) {
	if link == nil || link.ctx == nil {
		return context.WithDeadline(context.Background(), deadline)
	}
	if kind != "wait" || link.host == nil {
		return context.WithDeadline(link.ctx, deadline)
	}
	grants, ok := link.host.executor.(m1bComputerWaitPublication)
	if !ok {
		return context.WithDeadline(link.ctx, deadline)
	}
	grant, ok := grants.waitPublicationContext(selection)
	if !ok || grant == nil {
		return context.WithDeadline(link.ctx, deadline)
	}
	if linkDeadline, has := link.ctx.Deadline(); has && linkDeadline.Before(deadline) {
		deadline = linkDeadline
	}
	ctx, cancel := context.WithDeadline(grant, deadline)
	if link.ctx.Err() != nil {
		cancel()
		return ctx, cancel
	}
	stop := context.AfterFunc(link.ctx, cancel)
	return ctx, func() {
		stop()
		cancel()
	}
}

func m1bComputerInputDeadline(selection m1bComputerSelection, command m1bComputerCommand, now time.Time) (time.Time, string) {
	if !now.Before(command.ExpiresAt) || !now.Before(selection.ExpiresAt) {
		return time.Time{}, "COMPUTER_TIMEOUT"
	}
	deadline := command.ExpiresAt
	if selection.ExpiresAt.Before(deadline) {
		deadline = selection.ExpiresAt
	}
	limit := now.Add(m1bComputerMaxWork)
	if command.Request.Kind == "wait" && command.Request.Wait != nil {
		// The native predicate timeout plus a finite identity-check grace. The
		// command expiry, selection/proof expiry, and caller cancellation still
		// cap the actual context; this never extends them.
		limit = now.Add(time.Duration(command.Request.Wait.TimeoutMS)*time.Millisecond + m1bComputerWaitGrace)
	}
	if command.Request.Kind == "act" && command.Request.Act != nil {
		// The strict parser already validated timeout_ms to 100..20_000 ms
		// (absent means 8_000). It is the act's bounded effect window, so the
		// fixed read window must not shorten a conforming act. Command expiry,
		// selection/proof expiry and caller cancellation still cap it.
		limit = now.Add(time.Duration(command.Request.Act.TimeoutMS) * time.Millisecond)
	}
	if limit.Before(deadline) {
		deadline = limit
	}
	return deadline, ""
}

func m1bComputerControlDeadline(command m1bComputerCommand, now time.Time) (time.Time, string) {
	// Quiesce uses min(its own command expires_at, 5s) and is independent of
	// the grant/selection expiry so it can stop revoked input.
	if !now.Before(command.ExpiresAt) {
		return time.Time{}, "COMPUTER_TIMEOUT"
	}
	deadline := command.ExpiresAt
	if limit := now.Add(m1bComputerMaxWork); deadline.After(limit) {
		deadline = limit
	}
	return deadline, ""
}

func m1bClosed(channel <-chan struct{}) bool {
	select {
	case <-channel:
		return true
	default:
		return false
	}
}

func m1bComputerTimedOut(ctx context.Context, deadline time.Time) bool {
	if ctx.Err() == context.DeadlineExceeded {
		return true
	}
	return ctx.Err() == nil && !time.Now().Before(deadline)
}

func (link *m1bComputerLink) sendOutcome(work *m1bComputerDispatch, outcome m1bComputerResult) {
	typed := m1bComputerTypedResult{Kind: "failure", Error: "COMPUTER_ACTION_FAILED"}
	switch outcome.kind {
	case "status":
		typed = m1bComputerTypedResult{Kind: "status", Result: outcome.status}
	case "observe":
		typed = m1bComputerTypedResult{Kind: "observe", Result: outcome.observation}
	case "wait":
		typed = m1bComputerTypedResult{Kind: "wait", Result: outcome.wait}
	case "act":
		typed = m1bComputerTypedResult{Kind: "act", Result: outcome.act}
	case "failure":
		code := outcome.failure
		if code == "" {
			code = "COMPUTER_ACTION_FAILED"
		}
		typed = m1bComputerTypedResult{Kind: "failure", Error: code}
	}
	link.sendWorkResult(work, typed)
}

// sendWorkResult publishes a success or ack only while the exact work's
// dispatch context is live. The work context carries the deadline and cancel;
// finishPublication/finishQuiesce runs after this returns.
func (link *m1bComputerLink) sendWorkResult(work *m1bComputerDispatch, typed m1bComputerTypedResult) {
	if work == nil || work.ctx == nil || work.ctx.Err() != nil {
		return
	}
	if !link.host.deliverable(work) || !link.executable() {
		return
	}
	// Last boundary: exact work, current link/account, and the work deadline.
	if work.ctx.Err() != nil || !link.host.deliverable(work) || !link.executable() {
		return
	}
	link.sendTyped(work.ctx, work, work.id, typed)
}

// replyWorkFailure publishes a timeout/uncertainty result on the existing
// failure path, bounded by the transport command expiry rather than the
// expired work deadline.
func (link *m1bComputerLink) replyWorkFailure(work *m1bComputerDispatch, code string) {
	if work == nil || link == nil || link.ctx == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithDeadline(link.ctx, work.expiresAt)
		defer cancel()
		if ctx.Err() != nil {
			return
		}
		link.sendTyped(ctx, work, work.id, m1bComputerTypedResult{Kind: "failure", Error: code})
	}()
}

func (link *m1bComputerLink) replyFailure(id, code string) {
	if link == nil || link.ctx == nil || !validUUID(id) {
		return
	}
	go link.sendTyped(link.ctx, nil, id, m1bComputerTypedResult{Kind: "failure", Error: code})
}

func (link *m1bComputerLink) sendTyped(ctx context.Context, work *m1bComputerDispatch, id string, typed m1bComputerTypedResult) {
	if link == nil || link.connection == nil || link.ctx == nil || ctx == nil || !validUUID(id) {
		return
	}
	if work == nil && link.socket == nil && link.write == nil {
		return
	}
	frame, err := json.Marshal(m1bComputerCommandResult{
		Type: "command.result", ID: id, Operation: m1bComputerOperation, OK: true, Result: typed,
	})
	if err != nil {
		return
	}
	link.sendFrame(ctx, work, frame)
}

// sendFrame revalidates the account lease, the exact socket generation and the
// runtime link immediately before one bounded socket write. No mutex is held
// across the wire write; the small check-to-write window is deliberate.
func (link *m1bComputerLink) sendFrame(ctx context.Context, work *m1bComputerDispatch, frame []byte) {
	if link == nil || link.connection == nil || link.ctx == nil || ctx == nil || ctx.Err() != nil {
		return
	}
	if link.ctx.Err() != nil || !link.connection.authorized() {
		return
	}
	if link.host != nil {
		if !link.host.current(link.token) {
			return
		}
		if work != nil && !link.host.deliverable(work) {
			return
		}
	}
	if link.live != nil && !link.live() {
		return
	}
	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if link.write != nil {
		_ = link.write(writeCtx, frame)
		return
	}
	if link.socket == nil {
		return
	}
	_ = link.socket.Write(writeCtx, websocket.MessageText, frame)
}

// m1bComputerBindingFailure rejects every payload id that does not repeat the
// host-picked owner/link/run/session/selection binding. The holder is checked
// separately because it is adopted from the first observe.
func m1bComputerBindingFailure(link *m1bComputerLink, command m1bComputerCommand, selection m1bComputerSelection) string {
	for _, pair := range [][2]string{
		{command.OwnerID, selection.OwnerID},
		{link.linkID, selection.LinkID},
		{command.ConversationID, selection.ConversationID},
		{command.RuntimeGeneration, selection.RuntimeGeneration},
		{command.TurnID, selection.TurnID},
		{command.SessionID, selection.SessionID},
		{command.SelectionID, selection.SelectionID},
	} {
		if !validUUID(pair[0]) || !validUUID(pair[1]) || !strings.EqualFold(pair[0], pair[1]) {
			return "COMPUTER_TARGET_CHANGED"
		}
	}
	return ""
}

func m1bComputerCommandID(data []byte) string {
	var partial struct {
		ID string `json:"id"`
	}
	if json.Valid(data) && json.Unmarshal(data, &partial) == nil && validUUID(partial.ID) {
		return partial.ID
	}
	return ""
}

// m1bComputerParseCommand enforces the strict envelope and body. The id is
// returned separately so a rejected frame with a readable id still gets one
// correlated failure result.
func m1bComputerParseCommand(data []byte) (m1bComputerCommand, string, error) {
	var frame struct {
		Type              string          `json:"type"`
		ID                string          `json:"id"`
		OwnerID           string          `json:"owner_id"`
		ConversationID    string          `json:"conversation_id"`
		RuntimeGeneration string          `json:"runtime_generation"`
		TurnID            string          `json:"turn_id"`
		ExpiresAt         string          `json:"expires_at"`
		Operation         string          `json:"operation"`
		Body              json.RawMessage `json:"body"`
	}
	if m1bDecodeStrict(data, &frame) != nil {
		return m1bComputerCommand{}, m1bComputerCommandID(data), errM1BComputerInvalid
	}
	id := ""
	if validUUID(frame.ID) {
		id = frame.ID
	}
	if frame.Type != "command" || frame.Operation != m1bComputerOperation ||
		!validUUID(frame.ID) || !validUUID(frame.OwnerID) || !validUUID(frame.ConversationID) ||
		!validUUID(frame.RuntimeGeneration) || !validUUID(frame.TurnID) || len(frame.Body) == 0 {
		return m1bComputerCommand{}, id, errM1BComputerInvalid
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, frame.ExpiresAt)
	if err != nil {
		return m1bComputerCommand{}, id, errM1BComputerInvalid
	}
	var body struct {
		SessionID   string          `json:"session_id"`
		SelectionID string          `json:"selection_id"`
		HolderID    json.RawMessage `json:"holder_id"`
		Request     json.RawMessage `json:"request"`
	}
	if m1bDecodeStrict(frame.Body, &body) != nil ||
		!validUUID(body.SessionID) || !validUUID(body.SelectionID) || len(body.Request) == 0 {
		return m1bComputerCommand{}, id, errM1BComputerInvalid
	}
	request, err := m1bComputerParseRequest(body.Request)
	if err != nil {
		return m1bComputerCommand{}, id, err
	}
	holderID, holderNull, err := m1bComputerParseHolder(body.HolderID)
	if err != nil {
		return m1bComputerCommand{}, id, errM1BComputerInvalid
	}
	if request.Kind == "status" {
		// Status is read-only and must carry the explicit null holder.
		if !holderNull {
			return m1bComputerCommand{}, id, errM1BComputerInvalid
		}
		holderID = ""
	} else if holderNull {
		return m1bComputerCommand{}, id, errM1BComputerInvalid
	}
	return m1bComputerCommand{
		ID: frame.ID, OwnerID: frame.OwnerID, ConversationID: frame.ConversationID,
		RuntimeGeneration: frame.RuntimeGeneration, TurnID: frame.TurnID, ExpiresAt: expiresAt,
		SessionID: body.SessionID, SelectionID: body.SelectionID,
		HolderID: holderID, Request: request,
	}, id, nil
}

func m1bComputerParseHolder(raw []byte) (string, bool, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return "", false, errM1BComputerInvalid
	}
	if bytes.Equal(trimmed, []byte("null")) {
		return "", true, nil
	}
	var holder string
	if json.Unmarshal(trimmed, &holder) != nil || !validUUID(holder) {
		return "", false, errM1BComputerInvalid
	}
	return holder, false, nil
}

func m1bComputerParseRequest(raw []byte) (m1bComputerRequest, error) {
	if !utf8.Valid(raw) {
		return m1bComputerRequest{}, errM1BComputerInvalid
	}
	var header struct {
		Kind string `json:"kind"`
	}
	if json.Unmarshal(raw, &header) != nil {
		return m1bComputerRequest{}, errM1BComputerInvalid
	}
	switch header.Kind {
	case "status", "observe", "quiesce":
		var request struct {
			Kind string `json:"kind"`
		}
		if m1bDecodeStrict(raw, &request) != nil || request.Kind != header.Kind {
			return m1bComputerRequest{}, errM1BComputerInvalid
		}
		return m1bComputerRequest{Kind: header.Kind}, nil
	case "wait":
		var request struct {
			Kind  string          `json:"kind"`
			Input json.RawMessage `json:"input"`
		}
		if m1bDecodeStrict(raw, &request) != nil || request.Kind != "wait" || len(request.Input) == 0 {
			return m1bComputerRequest{}, errM1BComputerInvalid
		}
		wait, err := m1bComputerParseWait(request.Input)
		if err != nil {
			return m1bComputerRequest{}, err
		}
		return m1bComputerRequest{Kind: "wait", Wait: &wait}, nil
	case "act":
		var request struct {
			Kind         string          `json:"kind"`
			NativeCallID string          `json:"native_call_id"`
			Input        json.RawMessage `json:"input"`
		}
		if m1bDecodeStrict(raw, &request) != nil || request.Kind != "act" ||
			!m1bComputerStringOK(request.NativeCallID, 1, m1bComputerMaxNativeID) || len(request.Input) == 0 {
			return m1bComputerRequest{}, errM1BComputerInvalid
		}
		act, err := m1bComputerParseAct(request.Input)
		if err != nil {
			return m1bComputerRequest{}, err
		}
		return m1bComputerRequest{Kind: "act", NativeCallID: request.NativeCallID, Act: &act}, nil
	}
	return m1bComputerRequest{}, errM1BComputerInvalid
}

func m1bComputerParseWait(raw []byte) (m1bComputerWait, error) {
	if !utf8.Valid(raw) {
		return m1bComputerWait{}, errM1BComputerInvalid
	}
	var input struct {
		ObservationID string          `json:"observation_id"`
		Ref           string          `json:"ref"`
		TimeoutMS     json.RawMessage `json:"timeout_ms"`
	}
	if m1bDecodeStrict(raw, &input) != nil ||
		!m1bComputerStringOK(input.ObservationID, 1, m1bComputerMaxObservID) ||
		!m1bComputerStringOK(input.Ref, 1, m1bComputerMaxRef) ||
		!computerRefPattern.MatchString(input.Ref) {
		return m1bComputerWait{}, errM1BComputerInvalid
	}
	timeout, err := m1bComputerTimeout(input.TimeoutMS)
	if err != nil {
		return m1bComputerWait{}, err
	}
	return m1bComputerWait{
		ObservationID: input.ObservationID, Ref: input.Ref, TimeoutMS: timeout,
	}, nil
}

func m1bComputerParseAct(raw []byte) (m1bComputerAct, error) {
	if !utf8.Valid(raw) {
		return m1bComputerAct{}, errM1BComputerInvalid
	}
	var header struct {
		Action string `json:"action"`
	}
	if json.Unmarshal(raw, &header) != nil {
		return m1bComputerAct{}, errM1BComputerInvalid
	}
	var act m1bComputerAct
	switch header.Action {
	case "click":
		var input struct {
			Action        string          `json:"action"`
			ObservationID string          `json:"observation_id"`
			Ref           string          `json:"ref"`
			TimeoutMS     json.RawMessage `json:"timeout_ms"`
		}
		if m1bDecodeStrict(raw, &input) != nil || input.Action != "click" {
			return m1bComputerAct{}, errM1BComputerInvalid
		}
		timeout, err := m1bComputerTimeout(input.TimeoutMS)
		if err != nil {
			return m1bComputerAct{}, err
		}
		act = m1bComputerAct{Action: "click", ObservationID: input.ObservationID, Ref: input.Ref, TimeoutMS: timeout}
	case "type":
		var input struct {
			Action        string          `json:"action"`
			ObservationID string          `json:"observation_id"`
			Ref           string          `json:"ref"`
			Text          string          `json:"text"`
			TimeoutMS     json.RawMessage `json:"timeout_ms"`
		}
		if m1bDecodeStrict(raw, &input) != nil || input.Action != "type" {
			return m1bComputerAct{}, errM1BComputerInvalid
		}
		timeout, err := m1bComputerTimeout(input.TimeoutMS)
		if err != nil {
			return m1bComputerAct{}, err
		}
		act = m1bComputerAct{Action: "type", ObservationID: input.ObservationID, Ref: input.Ref, Text: input.Text, TimeoutMS: timeout}
	default:
		return m1bComputerAct{}, errM1BComputerInvalid
	}
	if !m1bComputerStringOK(act.ObservationID, 1, m1bComputerMaxObservID) ||
		!m1bComputerStringOK(act.Ref, 1, m1bComputerMaxRef) {
		return m1bComputerAct{}, errM1BComputerInvalid
	}
	if act.Action == "type" &&
		(!m1bComputerStringOK(act.Text, 1, m1bComputerMaxTextUnits) || len(act.Text) > m1bComputerMaxTextBytes) {
		return m1bComputerAct{}, errM1BComputerInvalid
	}
	return act, nil
}

func m1bComputerTimeout(raw []byte) (int, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return m1bComputerDefaultTimeout, nil
	}
	// Zod's optional number rejects an explicit null; it is not "absent".
	if bytes.Equal(trimmed, []byte("null")) {
		return 0, errM1BComputerInvalid
	}
	var timeout int
	if json.Unmarshal(trimmed, &timeout) != nil || timeout < m1bComputerMinTimeout || timeout > m1bComputerMaxTimeout {
		return 0, errM1BComputerInvalid
	}
	return timeout, nil
}

// m1bComputerStringOK follows the shared Zod .max() unit: JavaScript string
// length is UTF-16 code units, not runes and not bytes.
func m1bComputerStringOK(value string, min, max int) bool {
	if !utf8.ValidString(value) {
		return false
	}
	units := 0
	for _, r := range value {
		if r > 0xFFFF {
			units += 2
		} else {
			units++
		}
	}
	return units >= min && units <= max
}

func m1bDecodeStrict(data []byte, target any) error {
	if !json.Valid(data) {
		return errM1BComputerInvalid
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return errM1BComputerInvalid
	}
	return nil
}

func hasM1BComputerOperation(operations []string) bool {
	for _, operation := range operations {
		if operation == m1bComputerOperation {
			return true
		}
	}
	return false
}
