//go:build darwin && desktop_runtime_package

package main

// Joined M1b product-chain gateway.
//
// This test gateway is the native Mac half of the product proof. It boots the
// real supervised runtime (Node runner + pinned Codex) and the real
// authenticated device WebSocket, then drives the real computer control state
// machine with a synthetic platform. The platform is the only seam: it never
// constructs darwinComputerPlatform, never signs a driver, never runs
// agent-desktop, and never touches Accessibility, Screen Recording, TCC, a real
// window or a real application. All selections, observations, refs and effects
// are synthetic and stay on this test host.
//
// Commands arrive as one JSON object per stdin line; results are emitted as one
// JSON object per stdout line so the Node integration can correlate them.

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

type joinedGatewayFixture struct {
	Origin        string           `json:"origin"`
	DataRoot      string           `json:"dataRoot"`
	Credential    deviceCredential `json:"credential"`
	PrivateMarker string           `json:"privateMarker,omitempty"`
	DriverProbe   string           `json:"driverProbe,omitempty"`
}

// joinedGatewayCommand deliberately has no PID, process-name or process-group
// field. The one app-server exit action derives its target only from this Go
// host's owned descendants and never from the caller.
type joinedGatewayCommand struct {
	Action         string `json:"action"`
	ConversationID string `json:"conversation_id"`
	TurnID         string `json:"turn_id"`
}

// joinedAppServerExitOnce makes kill_app_server one-shot for the lifetime of
// this disposable gateway. A second invocation while the real supervisor is
// still recovering the retired worker is refused, so it can never signal the
// replacement app-server child.
var joinedAppServerExitOnce sync.Once

// The process protocol carries only an identity pair: the native PID and its
// Darwin seconds.microseconds start time. It never carries argv, a window, a
// path, a credential or any other process metadata. The app-server exit fixture
// adds one bounded event name and the disposable-gateway env gate.
const (
	joinedProcessesEvent       = "processes"
	joinedProcessProbeEvent    = "process_probe"
	joinedAppServerExitEvent   = "app_server_exit"
	joinedAppServerExitEnv     = "LINKSENSE_JOINED_APP_SERVER_EXIT"
	joinedActReplyLossEnv      = "LINKSENSE_JOINED_ACT_REPLY_LOSS"
	joinedAppServerExecutable  = "codex"
	joinedMaxProcessEntries    = 4096
	joinedMaxProcessReplyBytes = 1 << 20
	joinedMaxProbeInputBytes   = 1 << 20
	joinedMaxProbeWaitMS       = 25000
	joinedMaxProbeSurvivors    = 8
)

var fixtureStartPattern = regexp.MustCompile(`^\d+\.\d{6}$`)

type joinedProcessIdentity struct {
	PID   int    `json:"pid"`
	Start string `json:"start"`
}

type joinedProcessSnapshot struct {
	Event   string                  `json:"event"`
	PID     int                     `json:"pid"`
	Start   string                  `json:"start"`
	Entries []joinedProcessIdentity `json:"entries"`
}

type joinedProcessProbeRequest struct {
	Entries []joinedProcessIdentity `json:"entries"`
	WaitMS  int                     `json:"wait_ms"`
	Signal  bool                    `json:"signal"`
}

type joinedExecutorStats struct {
	Observes int `json:"observes"`
	Acts     int `json:"acts"`
	// Acts/ActNativeIDs stay the validated successful-act counters. The entry
	// counters below record every invocation before observation/ref validation.
	ActEntries        int      `json:"act_entries"`
	Authorizations    int      `json:"authorizations"`
	Mutations         int      `json:"mutations"`
	ActRefs           []string `json:"act_refs"`
	ActNativeIDs      []string `json:"act_native_ids"`
	ActEntryNativeIDs []string `json:"act_entry_native_ids"`
	Waits             int      `json:"waits"`
	WaitMet           int      `json:"wait_met"`
	WaitTimedOut      int      `json:"wait_timed_out"`
	WaitFailed        int      `json:"wait_failed"`
	WaitInFlight      int      `json:"wait_in_flight"`
	WaitRefs          []string `json:"wait_refs"`
	WaitObservIDs     []string `json:"wait_observation_ids"`
	WaitTimeouts      []int    `json:"wait_timeouts"`
	Closed            bool     `json:"closed"`
}

type joinedActBarrier struct {
	release     chan struct{}
	releaseOnce sync.Once
}

// releaseNow unblocks a withheld act result. It is nil-safe so shutdown and
// test failure can always use the one owned cleanup path.
func (barrier *joinedActBarrier) releaseNow() {
	if barrier == nil {
		return
	}
	barrier.releaseOnce.Do(func() { close(barrier.release) })
}

type joinedComputerExecutor struct {
	mu                sync.Mutex
	target            computerSelectedTarget
	binding           m1bComputerSelection
	observation       string
	observes          int
	acts              int
	actEntries        int
	authorizations    int
	mutations         int
	actRefs           []string
	actNativeIDs      []string
	actEntryNativeIDs []string
	waits             int
	waitMet           int
	waitTimedOut      int
	waitFailed        int
	waitInFlight      int
	waitRefs          []string
	waitObservIDs     []string
	waitTimeouts      []int
	closed            bool
	actBarrier        *joinedActBarrier
}

func (executor *joinedComputerExecutor) selection() m1bComputerSelection {
	executor.mu.Lock()
	defer executor.mu.Unlock()
	return executor.binding
}

func (executor *joinedComputerExecutor) selectHostSelection(selection m1bComputerSelection) error {
	if selection.bindingKey() == "" {
		return errComputerInvalid
	}
	executor.mu.Lock()
	defer executor.mu.Unlock()
	// Mirror the product executor: a same-identity rebind is the explicit
	// renewal and must strictly advance the grant. The initial ack rebind and a
	// resume change the immutable identity and are accepted normally.
	if executor.binding.bindingKey() == selection.bindingKey() &&
		!selection.ExpiresAt.After(executor.binding.ExpiresAt) {
		return errComputerInvalid
	}
	executor.binding = selection
	executor.observation = ""
	return nil
}

func (executor *joinedComputerExecutor) authorize(auth computerHostAuthorization) error {
	executor.mu.Lock()
	defer executor.mu.Unlock()
	if auth.nativeCallID == "" || auth.observationID != executor.observation ||
		(auth.action != "click" && auth.action != "type") ||
		(auth.action == "type" && auth.text == "") {
		return errComputerInvalid
	}
	executor.authorizations++
	return nil
}

func (executor *joinedComputerExecutor) status(context.Context, m1bComputerSelection) m1bComputerResult {
	return m1bComputerStatusResult(m1bComputerStatus{
		Available: true,
		Permissions: m1bComputerPermissions{
			Accessibility: "granted",
		},
		ActiveGrant: true,
	})
}

func (executor *joinedComputerExecutor) observe(context.Context, m1bComputerSelection) m1bComputerResult {
	executor.mu.Lock()
	defer executor.mu.Unlock()
	executor.observes++
	executor.observation = fmt.Sprintf("%032x", executor.observes)
	// The synthetic window reflects the one accepted mutation. No screenshot is
	// produced; the product relay never requests one in this proof.
	name := "Ready"
	if executor.mutations > 0 {
		name = fmt.Sprintf("Clicked %d", executor.mutations)
	}
	return m1bComputerObservationResult(m1bComputerObservation{
		ObservationID: executor.observation,
		TreeQuality:   "good",
		Truncated:     false,
		Nodes: []m1bComputerNode{
			{Ref: "@joined:e1", Role: "button", Name: &name},
			{Ref: "@joined:e2", Role: "button", Name: stringPointer("Alternate")},
		},
	})
}

// wait is the single synthetic actionability predicate. e1 is actionable and
// returns met; e2 never becomes actionable and returns timed_out after the
// caller's bounded timeout. Waits are read-only: unlike act they do not clear
// the observation, mutate the fixture, claim a native call, or authorize input.
// The work context is honored while the predicate timer is pending.
func (executor *joinedComputerExecutor) wait(
	ctx context.Context, _ m1bComputerSelection, input m1bComputerWait,
) m1bComputerResult {
	executor.mu.Lock()
	if executor.observation == "" || input.ObservationID != executor.observation {
		executor.mu.Unlock()
		return m1bComputerFailure("COMPUTER_STALE_OBSERVATION")
	}
	if input.Ref != "@joined:e1" && input.Ref != "@joined:e2" {
		executor.mu.Unlock()
		return m1bComputerFailure("COMPUTER_STALE_REF")
	}
	executor.waits++
	executor.waitInFlight++
	executor.waitRefs = append(executor.waitRefs, input.Ref)
	executor.waitObservIDs = append(executor.waitObservIDs, input.ObservationID)
	executor.waitTimeouts = append(executor.waitTimeouts, input.TimeoutMS)
	executor.mu.Unlock()
	defer func() {
		executor.mu.Lock()
		executor.waitInFlight--
		executor.mu.Unlock()
	}()
	if input.Ref == "@joined:e1" {
		executor.mu.Lock()
		executor.waitMet++
		executor.mu.Unlock()
		return m1bComputerWaitOutcome(m1bComputerWaitResult{Result: computerWaitMet, WaitedMS: 1})
	}
	timer := time.NewTimer(time.Duration(input.TimeoutMS) * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		executor.mu.Lock()
		executor.waitFailed++
		executor.mu.Unlock()
		return m1bComputerFailure("COMPUTER_TIMEOUT")
	case <-timer.C:
	}
	executor.mu.Lock()
	executor.waitTimedOut++
	executor.mu.Unlock()
	return m1bComputerWaitOutcome(m1bComputerWaitResult{Result: computerWaitTimedOut, WaitedMS: input.TimeoutMS})
}

func (executor *joinedComputerExecutor) act(
	_ context.Context, _ m1bComputerSelection, nativeCallID string, input m1bComputerAct,
) m1bComputerResult {
	executor.mu.Lock()
	// Count every entry that reaches the synthetic executor before validating
	// its observation/ref. A rejected duplicate invocation is still an
	// invocation and must never be hidden behind the success-only counters.
	executor.actEntries++
	executor.actEntryNativeIDs = append(executor.actEntryNativeIDs, nativeCallID)
	if executor.observation == "" || input.ObservationID != executor.observation {
		executor.mu.Unlock()
		return m1bComputerActOutcome(m1bComputerActResult{OK: false, Error: "COMPUTER_STALE_OBSERVATION"})
	}
	if input.Ref != "@joined:e1" && input.Ref != "@joined:e2" {
		executor.mu.Unlock()
		return m1bComputerActOutcome(m1bComputerActResult{OK: false, Error: "COMPUTER_STALE_REF"})
	}
	executor.acts++
	executor.mutations++
	executor.actRefs = append(executor.actRefs, input.Ref)
	executor.actNativeIDs = append(executor.actNativeIDs, nativeCallID)
	// A fresh observation is required before any later action.
	executor.observation = ""
	barrier := executor.actBarrier
	executor.mu.Unlock()
	if barrier != nil {
		// Synthetic reply-loss fixture: the effect and its counters are already
		// durable, but the result stays unsent until the API's bounded command
		// deadline proves the reply-loss ambiguity. Shutdown also releases this
		// barrier so a failed proof cannot leave the connection waiting. No
		// production path reads it, and a later release does not assert that the
		// withheld result reached the API.
		<-barrier.release
	}
	return m1bComputerActOutcome(m1bComputerActResult{OK: true, Effect: "done", WaitedMS: 1})
}

func (executor *joinedComputerExecutor) invalidate(m1bComputerSelection) {
	executor.mu.Lock()
	executor.observation = ""
	executor.mu.Unlock()
}

func (executor *joinedComputerExecutor) close() error {
	executor.mu.Lock()
	executor.closed = true
	executor.mu.Unlock()
	return nil
}

func (executor *joinedComputerExecutor) stats() joinedExecutorStats {
	executor.mu.Lock()
	defer executor.mu.Unlock()
	return joinedExecutorStats{
		Observes: executor.observes, Acts: executor.acts, ActEntries: executor.actEntries,
		Authorizations: executor.authorizations, Mutations: executor.mutations,
		ActRefs:           append([]string(nil), executor.actRefs...),
		ActNativeIDs:      append([]string(nil), executor.actNativeIDs...),
		ActEntryNativeIDs: append([]string(nil), executor.actEntryNativeIDs...),
		Waits:             executor.waits, WaitMet: executor.waitMet, WaitTimedOut: executor.waitTimedOut,
		WaitFailed: executor.waitFailed, WaitInFlight: executor.waitInFlight,
		WaitRefs:      append([]string(nil), executor.waitRefs...),
		WaitObservIDs: append([]string(nil), executor.waitObservIDs...),
		WaitTimeouts:  append([]int(nil), executor.waitTimeouts...),
		Closed:        executor.closed,
	}
}

type joinedComputerPlatform struct {
	target computerSelectedTarget

	mu         sync.Mutex
	executor   *joinedComputerExecutor
	actBarrier *joinedActBarrier
	picks      atomic.Int32
	executors  atomic.Int32
}

func (platform *joinedComputerPlatform) driverEligible() bool { return true }

func (platform *joinedComputerPlatform) pickTarget(context.Context, *Desktop) (computerSelectedTarget, error) {
	platform.picks.Add(1)
	return platform.target, nil
}

func (platform *joinedComputerPlatform) newExecutor(
	context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection,
) (computerProductExecutor, error) {
	executor := &joinedComputerExecutor{target: platform.target, actBarrier: platform.actBarrier}
	platform.executors.Add(1)
	platform.mu.Lock()
	platform.executor = executor
	platform.mu.Unlock()
	return executor, nil
}

func (platform *joinedComputerPlatform) stats() (joinedExecutorStats, bool, int32, int32) {
	platform.mu.Lock()
	executor := platform.executor
	platform.mu.Unlock()
	if executor == nil {
		return joinedExecutorStats{}, false, platform.picks.Load(), platform.executors.Load()
	}
	return executor.stats(), true, platform.picks.Load(), platform.executors.Load()
}

func TestJoinedComputerGateway(t *testing.T) {
	input := bufio.NewScanner(os.Stdin)
	input.Buffer(make([]byte, 256), 64*1024)
	var async sync.WaitGroup
	var asyncMu sync.Mutex
	var asyncCancels []context.CancelFunc
	cancelAsync := func() {
		asyncMu.Lock()
		cancels := append([]context.CancelFunc(nil), asyncCancels...)
		asyncCancels = nil
		asyncMu.Unlock()
		for _, cancel := range cancels {
			cancel()
		}
		done := make(chan struct{})
		go func() {
			async.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			// The bounded teardown must never hold the fixture open; the process
			// exit still ends any remaining waiter.
		}
	}
	defer cancelAsync()
	if !input.Scan() {
		t.Fatal("expected the joined gateway fixture on stdin")
	}
	var fixture joinedGatewayFixture
	if json.Unmarshal(input.Bytes(), &fixture) != nil {
		t.Fatal("invalid joined gateway fixture")
	}
	origin, err := url.Parse(fixture.Origin)
	if err != nil || origin.Scheme != "http" || origin.Hostname() != "127.0.0.1" ||
		origin.Port() == "" || origin.User != nil || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" {
		t.Fatal("joined gateway fixture must use a local HTTP listener")
	}
	runtimeRoot := os.Getenv("LINKSENSE_DESKTOP_RUNTIME_DIST")
	if !filepath.IsAbs(runtimeRoot) || !filepath.IsAbs(fixture.DataRoot) || !fixture.Credential.valid() {
		t.Fatal("invalid joined gateway runtime fixture")
	}

	runtime := superviseRuntime(fixture.DataRoot, runtimeRoot, origin.String())
	t.Cleanup(runtime.close)
	deadline := time.Now().Add(45 * time.Second)
	for !runtime.ready.Load() && time.Now().Before(deadline) {
		select {
		case <-runtime.done:
			t.Fatal("supervised runtime stopped before readiness")
		case <-time.After(50 * time.Millisecond):
		}
	}
	if !runtime.ready.Load() {
		t.Fatal("supervised runtime readiness timed out")
	}

	marker := fixture.PrivateMarker
	if marker == "" {
		marker = "private-joined-marker"
	}
	var actBarrier *joinedActBarrier
	if os.Getenv(joinedActReplyLossEnv) == "1" {
		actBarrier = &joinedActBarrier{release: make(chan struct{})}
	}
	// Every return path, including an early fixture failure or scanner EOF,
	// releases the withheld result before the owned connection cleanup waits.
	defer actBarrier.releaseNow()
	platform := &joinedComputerPlatform{target: computerSelectedTarget{
		BundleID: "com.example.LinkSenseProductFixture",
		// Window title/app name/PID/process instance never leave this host.
		WindowID:        "window-" + marker,
		PID:             424242,
		ProcessInstance: "instance-" + marker,
	}, actBarrier: actBarrier}
	desktop := &Desktop{server: origin, dataRoot: fixture.DataRoot}
	control := newDesktopComputerControl(desktop).(*computerControl)
	control.platform = platform
	desktop.computer = control
	connection := newFixtureDeviceConnection(t, origin, fixture.Credential)
	connection.runtime = runtime
	control.prepareConnection(connection)
	desktop.mu.Lock()
	desktop.device = connection
	desktop.mu.Unlock()
	go connection.run()
	go func() {
		<-connection.done
		emit(map[string]any{"event": "disconnected"})
	}()
	t.Cleanup(func() {
		connection.cancel()
		waitDeviceDone(t, connection)
	})

	readyDeadline := time.Now().Add(45 * time.Second)
	for time.Now().Before(readyDeadline) {
		status := connection.Status()
		if status.ExecutionReady && status.ComputerReady {
			break
		}
		if connection.ctx.Err() != nil {
			t.Fatalf("device connection stopped before readiness: %s", status.ErrorCode)
		}
		time.Sleep(25 * time.Millisecond)
	}
	status := connection.Status()
	if !status.ExecutionReady || !status.ComputerReady {
		t.Fatalf("joined gateway did not negotiate computer control: %+v", status)
	}
	emit(map[string]any{"event": "ready", "computerReady": true})

	for input.Scan() {
		line := strings.TrimSpace(input.Text())
		if line == "" {
			continue
		}
		var command joinedGatewayCommand
		if json.Unmarshal([]byte(line), &command) != nil {
			emit(map[string]any{"event": "error", "error": "JOINED_INVALID_COMMAND"})
			continue
		}
		switch command.Action {
		case "shutdown":
			// Unblock any withheld act result before the connection cleanup waits.
			actBarrier.releaseNow()
			cancelAsync()
			emit(map[string]any{"event": "shutdown"})
			return
		case "stats":
			stats, installed, picks, executors := platform.stats()
			// Bounded connection metadata only: the server-generated connection
			// id and the derived device state. It never contains a token, window,
			// process identity or other native detail.
			connectionStatus := connection.Status()
			connectionLinkID := ""
			if session := connection.currentControlSession(); session != nil {
				connectionLinkID = session.linkID
			}
			control.mu.Lock()
			controlState := control.state
			statsSelection := control.selection
			control.mu.Unlock()
			control.gate.mu.Lock()
			inputOpen := control.gate.inputOpen
			inner := control.gate.inner != nil
			control.gate.mu.Unlock()
			control.host.mu.Lock()
			hostHolder := control.host.selectionHolder
			hostHasHolder := control.host.selectionHasHolder
			hostControls := control.host.controls
			hostBindingMatches := control.host.selectionBinding == statsSelection.bindingKey()
			control.host.mu.Unlock()
			selectionExpiresAt := ""
			if !statsSelection.ExpiresAt.IsZero() {
				selectionExpiresAt = statsSelection.ExpiresAt.UTC().Format(time.RFC3339Nano)
			}
			emit(map[string]any{
				"event": "stats", "executor": installed, "picks": picks, "executors": executors,
				"stats":        stats,
				"driverProbe":  driverProbeExists(fixture.DriverProbe),
				"controlState": controlState, "inputOpen": inputOpen, "gateInstalled": inner,
				"statsSelectionId":   statsSelection.SelectionID,
				"selectionExpiresAt": selectionExpiresAt,
				"hostHolder":         hostHolder, "hostHasHolder": hostHasHolder,
				"hostControls": hostControls, "hostBindingMatches": hostBindingMatches,
				"connectionId":            connectionLinkID,
				"connectionState":         string(connectionStatus.State),
				"connectionErrorCode":     connectionStatus.ErrorCode,
				"connectionReady":         connectionStatus.ExecutionReady,
				"connectionComputerReady": connectionStatus.ComputerReady,
			})
		case "renew_async":
			// The takeover proof needs a renewal that stays pending while the
			// same session sends Stop. The synchronous action still exists and
			// this dedicated command only starts that one control wait in the
			// background; its result uses the existing control event shape.
			ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
			asyncMu.Lock()
			asyncCancels = append(asyncCancels, cancel)
			asyncMu.Unlock()
			async.Add(1)
			go func() {
				defer async.Done()
				defer cancel()
				result, controlErr := control.control(ctx, desktop, command.ConversationID, command.TurnID, "renew")
				emitControlResult(control, "renew", result, controlErr)
			}()
		case "processes":
			emitJoinedProcesses()
		case "kill_app_server":
			// Strict one-shot request: only the action field is accepted, and
			// the process-wide latch refuses a second signal while the real
			// supervisor is still recovering the retired worker.
			if !joinedAppServerExitRequest(line) {
				emitJoinedAppServerExit(false, "JOINED_APP_SERVER_EXIT_UNSUPPORTED")
				break
			}
			joinedAppServerExit()
		case "release_act":
			if actBarrier == nil {
				emit(map[string]any{"event": "error", "error": "JOINED_ACT_BARRIER_DISABLED"})
				break
			}
			actBarrier.releaseNow()
			emit(map[string]any{"event": "act_released"})
		case "select", "renew", "pause", "resume", "stop", "status":
			ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
			result, controlErr := control.control(ctx, desktop, command.ConversationID, command.TurnID, command.Action)
			cancel()
			emitControlResult(control, command.Action, result, controlErr)
		default:
			emit(map[string]any{"event": "error", "error": "JOINED_INVALID_ACTION"})
		}
	}
}

// TestJoinedComputerWaitOfferAndOldReady proves the additive capability is
// offered by the new Mac only when the product computer host exists, while the
// same bridge still accepts an older ready frame that lists only
// computer.execute. It reuses the existing fixture socket/server seam and never
// touches a real driver, window, permission or GUI.
func TestJoinedComputerWaitOfferAndOldReady(t *testing.T) {
	credential := deviceFixtureCredential()
	selection := fixtureComputerSelection(credential)
	host := newM1BComputerHost(newFixtureComputerExecutor(selection))
	server, sockets := newComputerFixtureServer(t, credential, fixtureReadyOperations, []string{fixtureLink})
	run := startComputerFixture(t, server, sockets, credential, host)
	for _, operation := range []string{m1bComputerOperation, "computer.wait"} {
		if !strings.Contains(run.socket.offer, operation) {
			t.Fatalf("the new Mac did not offer %s: %q", operation, run.socket.offer)
		}
	}
	// The older ready frame deliberately omits the additive marker. The same
	// bridge still reaches normal execution readiness, so an old API/Mac pair is
	// not asked to upgrade or disconnected by the new offer.
	if status := run.connection.Status(); !status.ExecutionReady || status.ErrorCode != "" {
		t.Fatalf("an old ready frame without computer.wait was not accepted: %+v", status)
	}

	// Without the installed product host the additive wait marker is not
	// offered at all, so an older/no-host Mac keeps the previous readiness
	// shape and an old API sees only the operations it already knows.
	serverWithoutHost, socketsWithoutHost := newComputerFixtureServer(
		t, credential, fixtureReadyOperations, []string{fixtureLink})
	withoutHost := startComputerFixture(t, serverWithoutHost, socketsWithoutHost, credential, nil)
	if strings.Contains(withoutHost.socket.offer, "computer.") {
		t.Fatalf("a host-less fixture still offered a computer capability: %q", withoutHost.socket.offer)
	}
	if status := withoutHost.connection.Status(); status.ComputerReady {
		t.Fatalf("a host-less fixture claimed computer readiness: %+v", status)
	}
}

// emitJoinedProcesses publishes only this owned Go host and every current
// descendant read from the native process table. A tree beyond the entry or
// serialized-size bound fails closed with the shared error rather than
// returning a truncated receipt or an unbounded line. A failed observation is
// reported once with the same error shape instead of pretending the tree is
// empty.
func emitJoinedProcesses() {
	table, err := fixtureProcesses()
	if err != nil {
		emit(map[string]any{"event": "error", "error": "JOINED_PROCESSES_UNAVAILABLE"})
		return
	}
	host, ok := table[os.Getpid()]
	if !ok || host.Zombie {
		emit(map[string]any{"event": "error", "error": "JOINED_PROCESSES_UNAVAILABLE"})
		return
	}
	descendants := fixtureDescendants(table, host.PID)
	if len(descendants) > joinedMaxProcessEntries {
		// A truncated tree would let the receiver treat an incomplete observation
		// as a successful receipt, so the oversize tree fails closed instead.
		emit(map[string]any{"event": "error", "error": "JOINED_PROCESSES_UNAVAILABLE"})
		return
	}
	entries := make([]joinedProcessIdentity, 0, len(descendants))
	for _, descendant := range descendants {
		entries = append(entries, joinedProcessIdentity{PID: descendant.PID, Start: descendant.Start})
	}
	data, err := json.Marshal(joinedProcessSnapshot{
		Event: joinedProcessesEvent, PID: host.PID, Start: host.Start, Entries: entries,
	})
	if err != nil || len(data) > joinedMaxProcessReplyBytes {
		emit(map[string]any{"event": "error", "error": "JOINED_PROCESSES_UNAVAILABLE"})
		return
	}
	emitMu.Lock()
	fmt.Println(string(data))
	emitMu.Unlock()
}

// emitJoinedAppServerExit publishes the one bounded kill result. The frame
// carries only a boolean and, on failure, a stable reason code. It never
// carries a PID, argv, a path, a window or a credential.
func emitJoinedAppServerExit(ok bool, reason string) {
	event := map[string]any{"event": joinedAppServerExitEvent, "ok": ok}
	if !ok {
		event["error"] = reason
	}
	emit(event)
}

// joinedAppServerObservation re-observes one PID from the native process table.
// The returned comm is the exact kernel P_comm (the executable name), never
// argv, and the start time is the Darwin seconds.microseconds identity already
// used by the fixture snapshots. A failed observation is not a match.
func joinedAppServerObservation(pid int) (string, string, int, bool, bool) {
	info, err := unix.SysctlKinfoProc("kern.proc.pid", pid)
	if err != nil || info == nil || int(info.Proc.P_pid) != pid {
		return "", "", 0, false, false
	}
	start := fmt.Sprintf("%d.%06d", info.Proc.P_starttime.Sec, info.Proc.P_starttime.Usec)
	return unix.ByteSliceToString(info.Proc.P_comm[:]), start, int(info.Eproc.Ppid),
		info.Proc.P_stat == fixtureZombieState, true
}

// joinedAppServerExitRequest accepts only the canonical kill_app_server line.
// The comparison is literal because encoding/json accepts duplicate object
// keys (the last value wins), so {"action":"stop","action":"kill_app_server"}
// would otherwise decode as a valid request. Any other byte sequence, an
// unknown field, a duplicate key or a trailing value is refused before the
// process table is read, so the request cannot name or add a second target.
func joinedAppServerExitRequest(line string) bool {
	return line == `{"action":"kill_app_server"}`
}

// joinedAppServerTarget selects the single owned descendant that the per-PID
// observation proves is the packaged app-server. It returns a stable refusal
// reason instead of skipping an unobservable candidate: an identity it cannot
// confirm must never be silently replaced by another process.
func joinedAppServerTarget(descendants []fixtureProcess) (fixtureProcess, string) {
	var target fixtureProcess
	matches := 0
	for _, entry := range descendants {
		if entry.PID <= 1 || entry.Zombie {
			continue
		}
		comm, start, ppid, zombie, observed := joinedAppServerObservation(entry.PID)
		if !observed {
			return fixtureProcess{}, "JOINED_APP_SERVER_EXIT_IDENTITY"
		}
		if comm != joinedAppServerExecutable {
			continue
		}
		// A live observation must still be the exact snapshot identity. A
		// candidate that went zombie after the snapshot is observed but not
		// eligible, so it also refuses instead of falling through to another.
		if zombie || start != entry.Start || ppid != entry.PPID {
			return fixtureProcess{}, "JOINED_APP_SERVER_EXIT_IDENTITY"
		}
		target = entry
		matches++
	}
	switch matches {
	case 0:
		return fixtureProcess{}, "JOINED_APP_SERVER_EXIT_UNAVAILABLE"
	case 1:
		return target, ""
	default:
		return fixtureProcess{}, "JOINED_APP_SERVER_EXIT_AMBIGUOUS"
	}
}

// joinedAppServerExit is the strictly test-only app-server-only exit fixture.
// It is disabled unless the disposable gateway was started for the
// app-server-exit scenario, it is one-shot for this process, and it accepts no
// caller-selected PID, name or process group. Within this Go host's exact
// descendants it finds one live process whose kernel P_comm is exactly the
// packaged Codex executable and whose P_pid, native start time and PPID still
// match the gateway snapshot. It then rechecks that exact identity and live
// state against a fresh snapshot and one per-PID observation, and sends
// SIGKILL to that one PID only.
func joinedAppServerExit() {
	if os.Getenv(joinedAppServerExitEnv) != "1" {
		emitJoinedAppServerExit(false, "JOINED_APP_SERVER_EXIT_UNSUPPORTED")
		return
	}
	first := false
	joinedAppServerExitOnce.Do(func() { first = true })
	if !first {
		emitJoinedAppServerExit(false, "JOINED_APP_SERVER_EXIT_REPEATED")
		return
	}
	table, err := fixtureProcesses()
	if err != nil {
		emitJoinedAppServerExit(false, "JOINED_APP_SERVER_EXIT_UNAVAILABLE")
		return
	}
	host, ok := table[os.Getpid()]
	if !ok || host.Zombie {
		emitJoinedAppServerExit(false, "JOINED_APP_SERVER_EXIT_UNAVAILABLE")
		return
	}
	descendants := fixtureDescendants(table, host.PID)
	if len(descendants) > joinedMaxProcessEntries {
		emitJoinedAppServerExit(false, "JOINED_APP_SERVER_EXIT_UNAVAILABLE")
		return
	}
	target, problem := joinedAppServerTarget(descendants)
	if problem != "" {
		emitJoinedAppServerExit(false, problem)
		return
	}
	// Immediately recheck the exact native identity, ownership and live state
	// against a fresh snapshot before the one signal. A reused PID, a changed
	// start time or PPID, a zombie, or another eligible descendant is a
	// refusal, never a signal to a guessed or replacement target.
	recheck, err := fixtureProcesses()
	if err != nil {
		emitJoinedAppServerExit(false, "JOINED_APP_SERVER_EXIT_UNAVAILABLE")
		return
	}
	host, ok = recheck[os.Getpid()]
	if !ok || host.Zombie {
		emitJoinedAppServerExit(false, "JOINED_APP_SERVER_EXIT_UNAVAILABLE")
		return
	}
	owned := fixtureDescendants(recheck, host.PID)
	if len(owned) > joinedMaxProcessEntries {
		emitJoinedAppServerExit(false, "JOINED_APP_SERVER_EXIT_UNAVAILABLE")
		return
	}
	current, problem := joinedAppServerTarget(owned)
	if problem != "" || current.PID != target.PID ||
		current.Start != target.Start || current.PPID != target.PPID {
		emitJoinedAppServerExit(false, "JOINED_APP_SERVER_EXIT_IDENTITY")
		return
	}
	if err := unix.Kill(target.PID, unix.SIGKILL); err != nil {
		emitJoinedAppServerExit(false, "JOINED_APP_SERVER_EXIT_UNAVAILABLE")
		return
	}
	emitJoinedAppServerExit(true, "")
}

// joinedProbeRequestProblem validates the bounded request without observing any
// process. It returns a short stable reason instead of echoing caller values.
func joinedProbeRequestProblem(request joinedProcessProbeRequest, self int, ancestors map[int]bool) string {
	if request.WaitMS < 0 || request.WaitMS > joinedMaxProbeWaitMS {
		return "wait"
	}
	if len(request.Entries) == 0 || len(request.Entries) > joinedMaxProcessEntries {
		return "entries"
	}
	seen := make(map[joinedProcessIdentity]bool, len(request.Entries))
	for _, entry := range request.Entries {
		if entry.PID <= 1 {
			return "pid"
		}
		if !fixtureStartPattern.MatchString(entry.Start) {
			return "start"
		}
		// The receiver merges snapshots by the complete (pid, start) identity, so
		// an exact pair is a duplicate while a reused PID with a different Darwin
		// start is a distinct process.
		if seen[entry] {
			return "duplicate"
		}
		seen[entry] = true
		if entry.PID == self {
			return "self"
		}
		if ancestors[entry.PID] {
			return "ancestor"
		}
	}
	return ""
}

// joinedProbeAncestors walks the probe's own parent chain so the probe can
// refuse to observe or signal itself or any process that owns it.
func joinedProbeAncestors(table fixtureProcessTable, self int) map[int]bool {
	ancestors := map[int]bool{}
	seen := map[int]bool{self: true}
	current := self
	for index := 0; index < 64; index++ {
		entry, ok := table[current]
		if !ok {
			break
		}
		parent := entry.PPID
		if parent <= 0 || seen[parent] {
			break
		}
		seen[parent] = true
		ancestors[parent] = true
		current = parent
	}
	return ancestors
}

func joinedProbeRecorded(request joinedProcessProbeRequest) []fixtureProcess {
	recorded := make([]fixtureProcess, 0, len(request.Entries))
	for _, entry := range request.Entries {
		recorded = append(recorded, fixtureProcess{PID: entry.PID, Start: entry.Start})
	}
	return recorded
}

// joinedProbePoll observes only the recorded identities until none is live or
// the caller's bound ends. It never enumerates or adopts extra PIDs.
func joinedProbePoll(entries []fixtureProcess, waitMS int) (fixtureProcessTable, error) {
	deadline := time.Now().Add(time.Duration(waitMS) * time.Millisecond)
	for {
		table, err := fixtureProcesses()
		if err != nil {
			return nil, err
		}
		if !fixtureSomeLive(table, entries) {
			return table, nil
		}
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return table, nil
		}
		if remaining > 50*time.Millisecond {
			remaining = 50 * time.Millisecond
		}
		time.Sleep(remaining)
	}
}

func joinedProbeLiveness(
	table fixtureProcessTable, entries []fixtureProcess,
) (int, int, int, int, []int) {
	live, zombie, reused, gone := 0, 0, 0, 0
	survivors := make([]int, 0, joinedMaxProbeSurvivors)
	for _, entry := range entries {
		switch fixtureLiveOf(table, entry) {
		case fixtureLive:
			live++
			if len(survivors) < joinedMaxProbeSurvivors {
				survivors = append(survivors, entry.PID)
			}
		case fixtureZombie:
			zombie++
		case fixtureReused:
			reused++
		default:
			gone++
		}
	}
	return live, zombie, reused, gone, survivors
}

func emitJoinedProcessProbeReceipt(
	table fixtureProcessTable, entries []fixtureProcess, signaled bool,
) {
	live, zombie, reused, gone, survivors := joinedProbeLiveness(table, entries)
	emit(map[string]any{
		"event":     joinedProcessProbeEvent,
		"reclaimed": live == 0,
		"live":      live,
		"zombie":    zombie,
		"reused":    reused,
		"gone":      gone,
		"signaled":  signaled,
		"survivors": survivors,
	})
}

// TestJoinedComputerProcessProbe is the explicit fixture-only probe entry the
// product chain runs through the already-compiled binary. It receives the exact
// recorded identities on stdin, reports bounded liveness counts, and only with
// explicit consent hands those same identities to the identity-checked cleanup.
// A request or observation failure exits without a receipt so the receiver can
// distinguish it from every successful proof.
func TestJoinedComputerProcessProbe(t *testing.T) {
	if os.Getenv("LINKSENSE_JOINED_PROCESS_PROBE") != "1" {
		t.Skip("LINKSENSE_JOINED_PROCESS_PROBE=1 is required for the joined process probe")
	}
	input := bufio.NewScanner(os.Stdin)
	input.Buffer(make([]byte, 256), joinedMaxProbeInputBytes)
	if !input.Scan() {
		if input.Err() != nil {
			t.Fatalf("PROCESS_PROBE_INPUT=too_large_or_unreadable")
		}
		t.Fatalf("PROCESS_PROBE_INPUT=empty")
	}
	line := strings.TrimSpace(input.Text())
	if line == "" {
		t.Fatalf("PROCESS_PROBE_INPUT=empty")
	}
	var request joinedProcessProbeRequest
	if json.Unmarshal([]byte(line), &request) != nil {
		t.Fatalf("PROCESS_PROBE_INPUT=invalid")
	}
	self := os.Getpid()
	table, err := fixtureProcesses()
	if err != nil {
		t.Fatalf("PROCESS_PROBE_OBSERVATION=failed")
	}
	if own, ok := table[self]; !ok || own.Zombie {
		t.Fatalf("PROCESS_PROBE_OBSERVATION=failed")
	}
	if problem := joinedProbeRequestProblem(request, self, joinedProbeAncestors(table, self)); problem != "" {
		t.Fatalf("PROCESS_PROBE_REQUEST=invalid reason=%s", problem)
	}
	entries := joinedProbeRecorded(request)
	if request.Signal {
		// Bounded teardown: observe once, then hand only the still-live recorded
		// identities to the identity-checked cleanup. Signalled stays true even
		// when the native exit wins the race, because the fallback was necessary.
		signaled := false
		if fixtureSomeLive(table, entries) {
			signaled = true
			fixtureCleanup(t, entries)
			if table, err = fixtureProcesses(); err != nil {
				t.Fatalf("PROCESS_PROBE_OBSERVATION=failed")
			}
		}
		emitJoinedProcessProbeReceipt(table, entries, signaled)
		return
	}
	table, err = joinedProbePoll(entries, request.WaitMS)
	if err != nil {
		t.Fatalf("PROCESS_PROBE_OBSERVATION=failed")
	}
	emitJoinedProcessProbeReceipt(table, entries, false)
}

// TestJoinedProcessProbeRequestWhitebox covers the pure request boundary without
// observing the process table or sending any signal.
func TestJoinedProcessProbeRequestWhitebox(t *testing.T) {
	const self = 4321
	ancestors := map[int]bool{999: true}
	valid := joinedProcessIdentity{PID: 1234, Start: "1234567890.123456"}
	cases := []struct {
		name    string
		request joinedProcessProbeRequest
		want    string
	}{
		{
			"accepts a bounded unique identity",
			joinedProcessProbeRequest{Entries: []joinedProcessIdentity{valid}, WaitMS: joinedMaxProbeWaitMS},
			"",
		},
		{
			"rejects a non positive pid",
			joinedProcessProbeRequest{Entries: []joinedProcessIdentity{{PID: 1, Start: valid.Start}}},
			"pid",
		},
		{
			"rejects a malformed start",
			joinedProcessProbeRequest{Entries: []joinedProcessIdentity{{PID: 1234, Start: "1.2"}}},
			"start",
		},
		{
			"accepts a reused pid with a distinct start",
			joinedProcessProbeRequest{Entries: []joinedProcessIdentity{
				valid, {PID: 1234, Start: "1234567891.000001"},
			}},
			"",
		},
		{
			"rejects an exact duplicated identity",
			joinedProcessProbeRequest{Entries: []joinedProcessIdentity{valid, valid}},
			"duplicate",
		},
		{
			"rejects the probe's own pid",
			joinedProcessProbeRequest{Entries: []joinedProcessIdentity{{PID: self, Start: valid.Start}}},
			"self",
		},
		{
			"rejects an ancestor pid",
			joinedProcessProbeRequest{Entries: []joinedProcessIdentity{{PID: 999, Start: valid.Start}}},
			"ancestor",
		},
		{
			"rejects an empty identity list",
			joinedProcessProbeRequest{},
			"entries",
		},
		{
			"rejects a negative wait",
			joinedProcessProbeRequest{WaitMS: -1},
			"wait",
		},
		{
			"rejects an excessive wait",
			joinedProcessProbeRequest{WaitMS: joinedMaxProbeWaitMS + 1},
			"wait",
		},
		{
			"rejects more than 4096 entries",
			joinedProcessProbeRequest{Entries: make([]joinedProcessIdentity, joinedMaxProcessEntries+1)},
			"entries",
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := joinedProbeRequestProblem(testCase.request, self, ancestors); got != testCase.want {
				t.Fatalf("validation reason = %q, want %q", got, testCase.want)
			}
		})
	}
}

// TestJoinedAppServerExitRequestWhitebox covers the strict one-shot request
// shape without observing a process table or sending any signal.
func TestJoinedAppServerExitRequestWhitebox(t *testing.T) {
	cases := []struct {
		name string
		line string
		want bool
	}{
		{"accepts the action only", `{"action":"kill_app_server"}`, true},
		{"rejects an unknown field", `{"action":"kill_app_server","pid":42}`, false},
		{"rejects a duplicate action key", `{"action":"stop","action":"kill_app_server"}`, false},
		{"rejects a repeated value", `{"action":"kill_app_server"}{"action":"kill_app_server"}`, false},
		{"rejects another action", `{"action":"stop"}`, false},
		{"rejects an empty request", ``, false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := joinedAppServerExitRequest(testCase.line); got != testCase.want {
				t.Fatalf("request accepted = %t, want %t", got, testCase.want)
			}
		})
	}
}

// emitControlResult keeps every synchronous and asynchronous control result on
// the one existing event shape and label.
func emitControlResult(control *computerControl, action string, result ComputerControlStatus, controlErr error) {
	control.mu.Lock()
	controlSelection := control.selection
	control.mu.Unlock()
	event := map[string]any{
		"event": "control", "action": action, "state": result.State,
		"expiresAt":   result.ExpiresAt,
		"selectionId": controlSelection.SelectionID, "sessionId": controlSelection.SessionID,
		"runtimeGeneration": controlSelection.RuntimeGeneration,
	}
	if controlErr != nil {
		event["error"] = controlErr.Error()
	}
	emit(event)
}

func stringPointer(value string) *string { return &value }

func driverProbeExists(path string) bool {
	if path == "" {
		return false
	}
	_, err := os.Stat(path)
	return err == nil
}

var emitMu sync.Mutex

func emit(value map[string]any) {
	data, err := json.Marshal(value)
	if err != nil {
		return
	}
	// One stdout line per result even while the async renewal and the main
	// command loop publish concurrently.
	emitMu.Lock()
	fmt.Println(string(data))
	emitMu.Unlock()
}
