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
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type joinedGatewayFixture struct {
	Origin        string           `json:"origin"`
	DataRoot      string           `json:"dataRoot"`
	Credential    deviceCredential `json:"credential"`
	PrivateMarker string           `json:"privateMarker,omitempty"`
	DriverProbe   string           `json:"driverProbe,omitempty"`
}

type joinedGatewayCommand struct {
	Action         string `json:"action"`
	ConversationID string `json:"conversation_id"`
	TurnID         string `json:"turn_id"`
}

type joinedExecutorStats struct {
	Observes       int      `json:"observes"`
	Acts           int      `json:"acts"`
	Authorizations int      `json:"authorizations"`
	Mutations      int      `json:"mutations"`
	ActRefs        []string `json:"act_refs"`
	ActNativeIDs   []string `json:"act_native_ids"`
	Closed         bool     `json:"closed"`
}

type joinedComputerExecutor struct {
	mu             sync.Mutex
	target         computerSelectedTarget
	binding        m1bComputerSelection
	observation    string
	observes       int
	acts           int
	authorizations int
	mutations      int
	actRefs        []string
	actNativeIDs   []string
	closed         bool
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

func (executor *joinedComputerExecutor) act(
	_ context.Context, _ m1bComputerSelection, nativeCallID string, input m1bComputerAct,
) m1bComputerResult {
	executor.mu.Lock()
	defer executor.mu.Unlock()
	if executor.observation == "" || input.ObservationID != executor.observation {
		return m1bComputerActOutcome(m1bComputerActResult{OK: false, Error: "COMPUTER_STALE_OBSERVATION"})
	}
	if input.Ref != "@joined:e1" && input.Ref != "@joined:e2" {
		return m1bComputerActOutcome(m1bComputerActResult{OK: false, Error: "COMPUTER_STALE_REF"})
	}
	executor.acts++
	executor.mutations++
	executor.actRefs = append(executor.actRefs, input.Ref)
	executor.actNativeIDs = append(executor.actNativeIDs, nativeCallID)
	// A fresh observation is required before any later action.
	executor.observation = ""
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
		Observes: executor.observes, Acts: executor.acts,
		Authorizations: executor.authorizations, Mutations: executor.mutations,
		ActRefs:      append([]string(nil), executor.actRefs...),
		ActNativeIDs: append([]string(nil), executor.actNativeIDs...),
		Closed:       executor.closed,
	}
}

type joinedComputerPlatform struct {
	target computerSelectedTarget

	mu        sync.Mutex
	executor  *joinedComputerExecutor
	picks     atomic.Int32
	executors atomic.Int32
}

func (platform *joinedComputerPlatform) driverEligible() bool { return true }

func (platform *joinedComputerPlatform) pickTarget(context.Context, *Desktop) (computerSelectedTarget, error) {
	platform.picks.Add(1)
	return platform.target, nil
}

func (platform *joinedComputerPlatform) newExecutor(
	context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection,
) (computerProductExecutor, error) {
	executor := &joinedComputerExecutor{target: platform.target}
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
	platform := &joinedComputerPlatform{target: computerSelectedTarget{
		BundleID: "com.example.LinkSenseProductFixture",
		// Window title/app name/PID/process instance never leave this host.
		WindowID:        "window-" + marker,
		PID:             424242,
		ProcessInstance: "instance-" + marker,
	}}
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
			cancelAsync()
			emit(map[string]any{"event": "shutdown"})
			return
		case "stats":
			stats, installed, picks, executors := platform.stats()
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
