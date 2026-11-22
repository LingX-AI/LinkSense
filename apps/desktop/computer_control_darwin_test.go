//go:build darwin

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
	"github.com/coder/websocket"
	"github.com/egoist/mygo"
)

// Synthetic M1b host harness. It drives the real control state machine, real
// device connection and real WebSocket framing through the existing fixture
// runtime. No driver, CLI, codesign, TCC state, permission prompt or native
// window is touched; the platform and executor are seams.

const (
	controlConversation = "40000000-0000-4000-8000-000000000201"
	controlTurn         = "60000000-0000-4000-8000-000000000201"
	controlSession      = "70000000-0000-4000-8000-000000000201"
	controlGeneration   = "50000000-0000-4000-8000-000000000201"
	controlObservation  = "0123456789abcdef0123456789abcdef"
	controlHolder       = "90000000-0000-4000-8000-000000000701"
)

type controlTestPlatform struct {
	eligible bool
	pick     func(context.Context, *Desktop) (computerSelectedTarget, error)
	executor func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error)
	picks    atomic.Int32
}

func (platform *controlTestPlatform) driverEligible() bool { return platform.eligible }

func (platform *controlTestPlatform) pickTarget(ctx context.Context, desktop *Desktop) (computerSelectedTarget, error) {
	platform.picks.Add(1)
	if platform.pick == nil {
		return computerSelectedTarget{}, errComputerPickerCanceled
	}
	return platform.pick(ctx, desktop)
}

func (platform *controlTestPlatform) newExecutor(ctx context.Context, desktop *Desktop, target computerSelectedTarget, selection m1bComputerSelection) (computerProductExecutor, error) {
	if platform.executor == nil {
		return nil, errComputerUnavailable
	}
	return platform.executor(ctx, desktop, target, selection)
}

type controlTestExecutor struct {
	mu             sync.Mutex
	binding        m1bComputerSelection
	closed         bool
	authorizations int
	invalidations  int
	selects        int
	observes       int
	actStarted     chan struct{}
	actRelease     chan struct{}
	waitStarted    chan struct{}
	waitRelease    chan struct{}
	releaseOnce    sync.Once
	closedDone     chan struct{}
	closedOnce     sync.Once
	actError       string
	// selectErr, when set, refuses the next selectHostSelection rebind before it
	// changes the exact binding. It is the deterministic post-ack rebind cut.
	selectErr error
}

func (executor *controlTestExecutor) selection() m1bComputerSelection {
	executor.mu.Lock()
	defer executor.mu.Unlock()
	return executor.binding
}

func (executor *controlTestExecutor) selectHostSelection(selection m1bComputerSelection) error {
	executor.mu.Lock()
	defer executor.mu.Unlock()
	if executor.selectErr != nil {
		err := executor.selectErr
		executor.selectErr = nil
		return err
	}
	executor.binding = selection
	executor.selects++
	return nil
}

func (executor *controlTestExecutor) selectCount() int {
	executor.mu.Lock()
	defer executor.mu.Unlock()
	return executor.selects
}

func (executor *controlTestExecutor) authorize(computerHostAuthorization) error {
	executor.mu.Lock()
	executor.authorizations++
	executor.mu.Unlock()
	return nil
}

func (executor *controlTestExecutor) status(context.Context, m1bComputerSelection) m1bComputerResult {
	return m1bComputerStatusResult(m1bComputerStatus{Available: true, Permissions: m1bComputerPermissions{Accessibility: "granted"}})
}

func (executor *controlTestExecutor) observe(context.Context, m1bComputerSelection) m1bComputerResult {
	executor.mu.Lock()
	executor.observes++
	executor.mu.Unlock()
	return m1bComputerObservationResult(m1bComputerObservation{ObservationID: "obs", TreeQuality: "good"})
}

func (executor *controlTestExecutor) observeCount() int {
	executor.mu.Lock()
	defer executor.mu.Unlock()
	return executor.observes
}

func (executor *controlTestExecutor) wait(ctx context.Context, _ m1bComputerSelection, _ m1bComputerWait) m1bComputerResult {
	if executor.waitStarted != nil {
		select {
		case executor.waitStarted <- struct{}{}:
		default:
		}
	}
	if executor.waitRelease != nil {
		select {
		case <-executor.waitRelease:
		case <-ctx.Done():
			return m1bComputerFailure("COMPUTER_TIMEOUT")
		}
	}
	if ctx.Err() != nil {
		return m1bComputerFailure("COMPUTER_TIMEOUT")
	}
	return m1bComputerWaitOutcome(m1bComputerWaitResult{Result: computerWaitMet, WaitedMS: 1})
}

func (executor *controlTestExecutor) act(ctx context.Context, _ m1bComputerSelection, _ string, _ m1bComputerAct) m1bComputerResult {
	if executor.actStarted != nil {
		select {
		case executor.actStarted <- struct{}{}:
		default:
		}
	}
	if executor.actRelease != nil {
		select {
		case <-executor.actRelease:
		case <-ctx.Done():
		}
	}
	executor.mu.Lock()
	code := executor.actError
	executor.mu.Unlock()
	if code != "" {
		return m1bComputerActOutcome(m1bComputerActResult{OK: false, Error: code})
	}
	return m1bComputerActOutcome(m1bComputerActResult{OK: true, Effect: "done", WaitedMS: 1})
}

func (executor *controlTestExecutor) invalidate(m1bComputerSelection) {
	executor.mu.Lock()
	executor.invalidations++
	executor.mu.Unlock()
}

func (executor *controlTestExecutor) close() error {
	executor.mu.Lock()
	executor.closed = true
	executor.mu.Unlock()
	executor.releaseOnce.Do(func() {
		if executor.actRelease != nil {
			close(executor.actRelease)
		}
		if executor.waitRelease != nil {
			close(executor.waitRelease)
		}
	})
	executor.closedOnce.Do(func() {
		if executor.closedDone != nil {
			close(executor.closedDone)
		}
	})
	return nil
}

// awaitClosed observes the asynchronous release that follows a state
// transition; the closed flag alone can be set one scheduling tick later.
func (executor *controlTestExecutor) awaitClosed(t *testing.T) {
	t.Helper()
	if executor.closedDone == nil {
		t.Fatal("the fixture executor has no close observation channel")
	}
	select {
	case <-executor.closedDone:
	case <-time.After(3 * time.Second):
		t.Fatal("the fixture executor was not closed")
	}
}

func (executor *controlTestExecutor) snapshot() (closed bool, authorizations, invalidations int) {
	executor.mu.Lock()
	defer executor.mu.Unlock()
	return executor.closed, executor.authorizations, executor.invalidations
}

func controlFixtureTarget() computerSelectedTarget {
	return computerSelectedTarget{
		BundleID: "com.example.editor", WindowID: "4242", PID: 99, ProcessInstance: "instance-1",
	}
}

type controlFixtureSocket struct {
	connectionID string
	incoming     chan string
	closed       chan struct{}
	send         func([]byte) error
	close        func()
}

func newControlFixtureServer(t *testing.T, credential deviceCredential, operations []string) (*httptest.Server, <-chan *controlFixtureSocket) {
	t.Helper()
	sockets := make(chan *controlFixtureSocket, 8)
	var accepted atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		socket, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer socket.CloseNow()
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_, hello, err := socket.Read(ctx)
		if err != nil {
			return
		}
		var authentication struct {
			Type  string `json:"type"`
			Token string `json:"token"`
		}
		if json.Unmarshal(hello, &authentication) != nil ||
			authentication.Type != "hello" || authentication.Token != credential.Token {
			return
		}
		execution, tool := desktopExecutionVersion, desktopToolVersion
		connectionID := controlConnectionID(int(accepted.Add(1)) - 1)
		ready, _ := json.Marshal(deviceReady{
			Type: "ready", DeviceID: credential.DeviceID,
			ConnectionID:    connectionID,
			ProtocolVersion: 1, HeartbeatIntervalMS: 15_000,
			ExecutionVersion: &execution, ToolVersion: &tool, ToolOperations: operations,
		})
		if socket.Write(ctx, websocket.MessageText, ready) != nil {
			return
		}
		fixture := &controlFixtureSocket{
			connectionID: connectionID, incoming: make(chan string, 64), closed: make(chan struct{}),
		}
		fixture.send = func(frame []byte) error {
			writeCtx, writeCancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer writeCancel()
			return socket.Write(writeCtx, websocket.MessageText, frame)
		}
		fixture.close = func() { _ = socket.Close(websocket.StatusNormalClosure, "fixture disconnect") }
		defer close(fixture.closed)
		sockets <- fixture
		for {
			_, data, err := socket.Read(ctx)
			if err != nil {
				return
			}
			select {
			case fixture.incoming <- string(data):
			case <-ctx.Done():
				return
			}
		}
	}))
	t.Cleanup(server.Close)
	return server, sockets
}

func controlConnectionID(index int) string {
	return fmt.Sprintf("30000000-0000-4000-8000-%012d", 300+index)
}

type controlHarness struct {
	desktop    *Desktop
	control    *computerControl
	connection *deviceConnection
	socket     *controlFixtureSocket
	server     *httptest.Server
	sockets    <-chan *controlFixtureSocket
	messages   <-chan runtimePipeMessage
	credential deviceCredential
	// grantExpiry is the expiry the last acknowledged select granted. Scope
	// actions may not extend it, so their acks reuse it.
	grantExpiry time.Time
}

func newTestComputerControl(platform *controlTestPlatform, desktop *Desktop) *computerControl {
	control := &computerControl{
		desktop: desktop, platform: platform, gate: &computerExecutorGate{},
		state: computerControlStateIdle,
	}
	control.host = newM1BComputerHost(control.gate)
	return control
}

func startControlHarness(t *testing.T, operations []string, platform *controlTestPlatform) *controlHarness {
	t.Helper()
	credential := deviceFixtureCredential()
	server, sockets := newControlFixtureServer(t, credential, operations)
	runtime, _, messages := newFixtureRuntime(t)
	origin, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	desktop := &Desktop{server: origin, dataRoot: t.TempDir()}
	control := newTestComputerControl(platform, desktop)
	desktop.computer = control
	connection := newFixtureDeviceConnection(t, origin, credential)
	connection.runtime = runtime
	control.prepareConnection(connection)
	desktop.mu.Lock()
	desktop.device = connection
	desktop.mu.Unlock()
	go connection.run()
	t.Cleanup(func() {
		connection.cancel()
		select {
		case <-connection.done:
		case <-time.After(5 * time.Second):
			t.Error("device connection did not stop")
		}
	})
	var socket *controlFixtureSocket
	select {
	case socket = <-sockets:
	case <-time.After(5 * time.Second):
		t.Fatal("the fixture server did not accept the device socket")
	}
	hasComputer := false
	for _, operation := range operations {
		if operation == m1bComputerOperation {
			hasComputer = true
		}
	}
	wantComputer := hasComputer && platform.eligible
	waitControlStatus(t, connection, func(status DeviceConnectionStatus) bool {
		if !status.ExecutionReady {
			return false
		}
		return !wantComputer || status.ComputerReady
	})
	// The runtime link opens once per negotiated socket; drain that fixed
	// fixture message so later tests can watch for leaked frames.
	select {
	case message := <-messages:
		if message.Type != "link.open" {
			t.Fatalf("unexpected runtime message: %+v", message)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the runtime link was not opened")
	}
	return &controlHarness{
		desktop: desktop, control: control, connection: connection, socket: socket,
		server: server, sockets: sockets, messages: messages, credential: credential,
	}
}

// expectNoRuntimeControlFrame proves control frames are consumed before the
// runtime pipe; only ordinary execution frames may pass.
func expectNoRuntimeControlFrame(t *testing.T, messages <-chan runtimePipeMessage, wait time.Duration) {
	t.Helper()
	deadline := time.NewTimer(wait)
	defer deadline.Stop()
	for {
		select {
		case message := <-messages:
			if message.Type == "link.frame" && strings.Contains(string(message.Frame), computerControlRequestType) {
				t.Fatalf("a control frame reached the runtime pipe: %+v", message)
			}
		case <-deadline.C:
			return
		}
	}
}

func waitControlStatus(t *testing.T, connection *deviceConnection, ready func(DeviceConnectionStatus) bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if ready(connection.Status()) {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the fixture connection did not reach the expected status")
}

func nextControlFrame(t *testing.T, fixture *controlFixtureSocket, wantType string) map[string]any {
	t.Helper()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	for {
		select {
		case raw := <-fixture.incoming:
			var frame map[string]any
			if json.Unmarshal([]byte(raw), &frame) != nil {
				continue
			}
			if frame["type"] == "ping" {
				if fixture.send != nil {
					_ = fixture.send([]byte(`{"type":"pong"}`))
				}
				continue
			}
			if frame["type"] == wantType {
				return frame
			}
		case <-fixture.closed:
			t.Fatal("the fixture socket closed before the expected frame")
		case <-deadline.C:
			t.Fatalf("the expected %s frame did not arrive", wantType)
		}
	}
}

func expectNoControlFrame(t *testing.T, fixture *controlFixtureSocket, wait time.Duration) {
	t.Helper()
	deadline := time.NewTimer(wait)
	defer deadline.Stop()
	for {
		select {
		case raw := <-fixture.incoming:
			var frame map[string]any
			if json.Unmarshal([]byte(raw), &frame) == nil && frame["type"] == computerControlRequestType {
				t.Fatalf("an unexpected control frame was sent: %s", raw)
			}
		case <-deadline.C:
			return
		}
	}
}

func controlFrameBody(t *testing.T, frame map[string]any) map[string]any {
	t.Helper()
	body, ok := frame["body"].(map[string]any)
	if !ok {
		t.Fatalf("control frame had no body: %+v", frame)
	}
	return body
}

func sendControlAck(t *testing.T, fixture *controlFixtureSocket, id, state, sessionID, selectionID, generation string, expires time.Time) {
	t.Helper()
	frame, err := json.Marshal(map[string]any{
		"type": computerControlResultType, "id": id, "ok": true,
		"data": map[string]any{
			"state": state, "session_id": sessionID, "selection_id": selectionID,
			"runtime_generation": generation, "expires_at": expires.UTC().Format(time.RFC3339Nano),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.send(frame); err != nil {
		t.Fatal(err)
	}
}

func sendControlFailure(t *testing.T, fixture *controlFixtureSocket, id, code string) {
	t.Helper()
	frame, _ := json.Marshal(map[string]any{
		"type": computerControlResultType, "id": id, "ok": false, "error_code": code,
	})
	if err := fixture.send(frame); err != nil {
		t.Fatal(err)
	}
}

// sendControlComputerCommand writes one correlated computer.execute frame over
// the existing synthetic device link and returns its typed result. It uses the
// same envelope the API emits, so the real interception/host/quiesce path runs.
func sendControlComputerCommand(t *testing.T, harness *controlHarness, id, selectionID, holder string,
	holderNull bool, request string) map[string]any {
	t.Helper()
	holderJSON := "null"
	if !holderNull {
		holderJSON = fmt.Sprintf("%q", holder)
	}
	command := fmt.Sprintf(`{"type":"command","id":%q,"owner_id":%q,"conversation_id":%q,`+
		`"runtime_generation":%q,"turn_id":%q,"expires_at":%q,"operation":%q,`+
		`"body":{"session_id":%q,"selection_id":%q,"holder_id":%s,"request":%s}}`,
		id, harness.credential.OwnerID, controlConversation, controlGeneration, controlTurn,
		time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano), m1bComputerOperation,
		controlSession, selectionID, holderJSON, request)
	if err := harness.socket.send([]byte(command)); err != nil {
		t.Fatal(err)
	}
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	for {
		select {
		case raw := <-harness.socket.incoming:
			var frame map[string]any
			if json.Unmarshal([]byte(raw), &frame) != nil {
				continue
			}
			if frame["type"] == "ping" {
				if harness.socket.send != nil {
					_ = harness.socket.send([]byte(`{"type":"pong"}`))
				}
				continue
			}
			if frame["type"] == "command.result" && frame["id"] == id {
				return frame
			}
		case <-harness.socket.closed:
			t.Fatal("the fixture socket closed before the computer result")
		case <-deadline.C:
			t.Fatalf("the computer result %s did not arrive", id)
		}
	}
}

type controlResult struct {
	status ComputerControlStatus
	err    error
}

// controlAsync starts one binding-level operation and returns its result
// channel. The page ids are always the fixture conversation/turn.
func controlAsync(ctx context.Context, desktop *Desktop, action string) <-chan controlResult {
	results := make(chan controlResult, 1)
	go func() {
		status, err := desktop.computer.control(ctx, desktop, controlConversation, controlTurn, action)
		results <- controlResult{status: status, err: err}
	}()
	return results
}

func awaitControl(t *testing.T, results <-chan controlResult) controlResult {
	t.Helper()
	select {
	case result := <-results:
		return result
	case <-time.After(5 * time.Second):
		t.Fatal("the control operation did not return")
		return controlResult{}
	}
}

// selectActiveTarget performs the whole acknowledged select gesture and
// returns the acknowledged selection id. The platform must already provide the
// executor the test wants installed.
func selectActiveTarget(t *testing.T, harness *controlHarness, platform *controlTestPlatform) string {
	t.Helper()
	if platform.executor == nil {
		platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
			return &controlTestExecutor{}, nil
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	results := controlAsync(ctx, harness.desktop, "select")
	frame := nextControlFrame(t, harness.socket, computerControlRequestType)
	body := controlFrameBody(t, frame)
	selectionID, _ := body["selection_id"].(string)
	if !validUUID(selectionID) {
		t.Fatalf("select did not carry a fresh selection id: %+v", body)
	}
	harness.grantExpiry = time.Now().Add(time.Minute)
	sendControlAck(t, harness.socket, frame["id"].(string), computerControlStateActive,
		controlSession, selectionID, controlGeneration, harness.grantExpiry)
	result := awaitControl(t, results)
	if result.err != nil || result.status.State != computerControlStateActive {
		t.Fatalf("select did not activate: %+v", result)
	}
	return selectionID
}

func waitComputerStatus(t *testing.T, control *computerControl, desktop *Desktop, conversationID, turnID, want string) ComputerControlStatus {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		status := control.status(desktop, conversationID, turnID)
		if status.State == want {
			return status
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("computer status did not reach %s for %s/%s", want, conversationID, turnID)
	return ComputerControlStatus{}
}

// startComputerRenew starts the explicit renewal gesture and returns the one
// control frame the host sent, without answering it.
func startComputerRenew(t *testing.T, harness *controlHarness) (map[string]any, <-chan controlResult) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	results := controlAsync(ctx, harness.desktop, "renew")
	frame := nextControlFrame(t, harness.socket, computerControlRequestType)
	return frame, results
}

func waitControlRetiring(t *testing.T, control *computerControl) *computerControlRetirement {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		control.mu.Lock()
		retiring := control.retiring
		control.mu.Unlock()
		if retiring != nil {
			return retiring
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the computer control did not enter retirement")
	return nil
}

func controlTombstones(control *computerControl) int {
	control.host.mu.Lock()
	defer control.host.mu.Unlock()
	return len(control.host.tombstones)
}

func injectRuntimeLinkFrame(t *testing.T, harness *controlHarness, frame []byte) {
	t.Helper()
	link := harness.connection.link.Load()
	if link == nil {
		t.Fatal("the fixture runtime link is not open")
	}
	select {
	case link.frames <- json.RawMessage(frame):
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture runtime link did not accept the terminal frame")
	}
}

func controlTerminalEventsFrame(conversationID, turnID, generation, status string) []byte {
	return []byte(fmt.Sprintf(`{"type":"execution.callback","id":"90000000-0000-4000-8000-000000000401",`+
		`"operation":"events","conversation_id":%q,"turn_id":%q,"runtime_generation":%q,`+
		`"run_token":"%s","body":{"conversationId":%q,"events":[{"deliveryId":"90000000-0000-4000-8000-000000000402",`+
		`"event":{"method":"turn/completed","params":{"threadId":"90000000-0000-4000-8000-000000000403",`+
		`"turn":{"id":"%s","status":%q}}}}]}}`,
		conversationID, turnID, generation, strings.Repeat("a", 64), conversationID,
		"90000000-0000-4000-8000-000000000404", status))
}

func TestComputerControlSelectSendsOnlyIdsAndActivatesAfterAck(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{"web.search", m1bComputerOperation}, platform)
	installed := &controlTestExecutor{}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return installed, nil
	}
	selectionID := selectActiveTarget(t, harness, platform)
	executor := installed

	if picks := platform.picks.Load(); picks != 1 {
		t.Fatalf("the picker opened %d times", picks)
	}
	closed, authorizations, _ := executor.snapshot()
	if closed {
		t.Fatal("the acknowledged executor was closed")
	}
	if authorizations != 0 {
		t.Fatal("select authorized native input")
	}
	selection := executor.selection()
	if selection.SelectionID != selectionID || selection.SessionID != controlSession ||
		selection.RuntimeGeneration != controlGeneration ||
		selection.OwnerID != harness.credential.OwnerID ||
		selection.LinkID != harness.socket.connectionID ||
		selection.ConversationID != controlConversation || selection.TurnID != controlTurn {
		t.Fatalf("the executor was not bound to the acknowledged selection: %+v", selection)
	}

	status := harness.control.status(harness.desktop, controlConversation, controlTurn)
	if status.State != computerControlStateActive || status.ExpiresAt == "" {
		t.Fatalf("status did not report the active grant: %+v", status)
	}
	expectNoControlFrame(t, harness.socket, 80*time.Millisecond)
}

func TestComputerControlSelectCancelAndFailureDoNotSend(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick: func(context.Context, *Desktop) (computerSelectedTarget, error) {
			return computerSelectedTarget{}, errComputerPickerCanceled
		},
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result := awaitControl(t, controlAsync(ctx, harness.desktop, "select"))
	if result.err != errComputerCanceled || result.status.State != computerControlStateIdle {
		t.Fatalf("cancel returned %+v", result)
	}
	expectNoControlFrame(t, harness.socket, 80*time.Millisecond)
}

func TestComputerControlRejectsInvalidAck(t *testing.T) {
	for name, mutate := range map[string]func(id, selectionID string) map[string]any{
		"wrong selection": func(id, selectionID string) map[string]any {
			return map[string]any{"type": computerControlResultType, "id": id, "ok": true, "data": map[string]any{
				"state": computerControlStateActive, "session_id": controlSession,
				"selection_id":       "80000000-0000-4000-8000-000000000999",
				"runtime_generation": controlGeneration,
				"expires_at":         time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano),
			}}
		},
		"wrong state": func(id, selectionID string) map[string]any {
			return map[string]any{"type": computerControlResultType, "id": id, "ok": true, "data": map[string]any{
				"state": computerControlStatePaused, "session_id": controlSession,
				"selection_id": selectionID, "runtime_generation": controlGeneration,
				"expires_at": time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano),
			}}
		},
		"expired grant": func(id, selectionID string) map[string]any {
			return map[string]any{"type": computerControlResultType, "id": id, "ok": true, "data": map[string]any{
				"state": computerControlStateActive, "session_id": controlSession,
				"selection_id": selectionID, "runtime_generation": controlGeneration,
				"expires_at": time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano),
			}}
		},
		"extra field": func(id, selectionID string) map[string]any {
			return map[string]any{"type": computerControlResultType, "id": id, "ok": true, "text": "leak", "data": map[string]any{
				"state": computerControlStateActive, "session_id": controlSession,
				"selection_id": selectionID, "runtime_generation": controlGeneration,
				"expires_at": time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano),
			}}
		},
	} {
		t.Run(name, func(t *testing.T) {
			executor := &controlTestExecutor{}
			platform := &controlTestPlatform{
				eligible: true,
				pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
				executor: func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
					return executor, nil
				},
			}
			harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			results := controlAsync(ctx, harness.desktop, "select")
			frame := nextControlFrame(t, harness.socket, computerControlRequestType)
			selectionID := controlFrameBody(t, frame)["selection_id"].(string)
			raw, _ := json.Marshal(mutate(frame["id"].(string), selectionID))
			if err := harness.socket.send(raw); err != nil {
				t.Fatal(err)
			}
			result := awaitControl(t, results)
			if result.err != errComputerUnavailable || result.status.State != computerControlStateIdle {
				t.Fatalf("invalid ack returned %+v", result)
			}
			if closed, _, _ := executor.snapshot(); !closed {
				t.Fatal("invalid ack left the executor open")
			}
		})
	}
}

func TestComputerControlServerRefusalKeepsStableCode(t *testing.T) {
	executor := &controlTestExecutor{}
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
		executor: func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
			return executor, nil
		},
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	results := controlAsync(ctx, harness.desktop, "select")
	frame := nextControlFrame(t, harness.socket, computerControlRequestType)
	sendControlFailure(t, harness.socket, frame["id"].(string), "DEVICE_BUSY")
	result := awaitControl(t, results)
	if result.err == nil || result.err.Error() != "DEVICE_BUSY" || result.status.State != computerControlStateIdle {
		t.Fatalf("server refusal returned %+v", result)
	}
}

func TestComputerControlRejectsTurnMismatchWithoutASideEffect(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	selectActiveTarget(t, harness, platform)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	status, err := harness.desktop.computer.control(ctx, harness.desktop,
		controlConversation, "60000000-0000-4000-8000-000000000999", "pause")
	// Another turn sees its own idle scope, never this selection's active state
	// or expiry.
	if err != errComputerInvalid || status.State != computerControlStateIdle || status.ExpiresAt != "" {
		t.Fatalf("turn mismatch returned %+v %v", status, err)
	}
	expectNoControlFrame(t, harness.socket, 80*time.Millisecond)
}

func TestComputerControlPauseWaitsForExecutorTerminal(t *testing.T) {
	executor := &controlTestExecutor{actStarted: make(chan struct{}, 1), actRelease: make(chan struct{})}
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
		executor: func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
			return executor, nil
		},
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	selectionID := selectActiveTarget(t, harness, platform)

	selection := executor.selection()
	actDone := make(chan m1bComputerResult, 1)
	go func() {
		actDone <- harness.control.gate.act(context.Background(), selection, "call-1", m1bComputerAct{
			Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
		})
	}()
	select {
	case <-executor.actStarted:
	case result := <-actDone:
		t.Fatalf("the fixture executor returned before starting: %+v", result)
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture executor did not start")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	results := controlAsync(ctx, harness.desktop, "pause")
	frame := nextControlFrame(t, harness.socket, computerControlRequestType)
	body := controlFrameBody(t, frame)
	if body["action"] != "pause" || body["selection_id"] != selectionID ||
		body["conversation_id"] != controlConversation || body["turn_id"] != controlTurn {
		t.Fatalf("pause frame was not bound to the selection: %+v", body)
	}
	// The acknowledgement arrives immediately, before the in-flight input is
	// terminal. Pause must not report success on the ack alone.
	sendControlAck(t, harness.socket, frame["id"].(string), computerControlStatePaused,
		controlSession, selectionID, controlGeneration, harness.grantExpiry)
	select {
	case result := <-results:
		t.Fatalf("pause returned before the executor was terminal: %+v", result)
	case <-time.After(150 * time.Millisecond):
	}
	executor.releaseOnce.Do(func() { close(executor.actRelease) })
	result := awaitControl(t, results)
	if result.err != nil || result.status.State != computerControlStatePaused {
		t.Fatalf("pause did not finish after the terminal: %+v", result)
	}
	select {
	case <-actDone:
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture input did not return")
	}
	closed, authorizations, invalidations := executor.snapshot()
	if closed || authorizations != 1 || invalidations < 1 {
		t.Fatalf("pause teardown was wrong: closed=%v auth=%d invalidations=%d", closed, authorizations, invalidations)
	}
}

func TestComputerControlPauseAckLossKeepsInputClosedWithoutClaimingPaused(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	selectActiveTarget(t, harness, platform)

	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	result := awaitControl(t, controlAsync(ctx, harness.desktop, "pause"))
	if result.err == nil {
		t.Fatal("pause without an acknowledgement reported success")
	}
	// The boundary is closed immediately, but an unproven pause is not reported
	// paused and resume stays unavailable.
	if result.status.State != computerControlStateActive {
		t.Fatalf("unproven pause reported %+v", result.status)
	}
	if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateActive {
		t.Fatalf("status reported an acknowledged pause: %+v", status)
	}
	gateResult := harness.control.gate.act(context.Background(), harness.control.gate.selection(), "call-closed", m1bComputerAct{
		Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
	})
	if gateResult.act.OK || gateResult.act.Error != "COMPUTER_ACCESS_DENIED" {
		t.Fatalf("a lost-ack pause left input open: %+v", gateResult.act)
	}
	nextControlFrame(t, harness.socket, computerControlRequestType)
	expectNoControlFrame(t, harness.socket, 120*time.Millisecond)

	// Resume requires a proven pause; it must not send a side effect.
	resumeResults := controlAsync(context.Background(), harness.desktop, "resume")
	resumeResult := awaitControl(t, resumeResults)
	if resumeResult.err != errComputerBusy || resumeResult.status.State != computerControlStateActive {
		t.Fatalf("resume after a lost ack returned %+v", resumeResult)
	}
	expectNoControlFrame(t, harness.socket, 120*time.Millisecond)
}

func TestComputerControlResumeUsesFreshSelectionAndReobserves(t *testing.T) {
	executor := &controlTestExecutor{}
	created := 0
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
		executor: func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
			created++
			return executor, nil
		},
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	pausedID := selectActiveTarget(t, harness, platform)

	// Pause first.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pauseResults := controlAsync(ctx, harness.desktop, "pause")
	pauseFrame := nextControlFrame(t, harness.socket, computerControlRequestType)
	sendControlAck(t, harness.socket, pauseFrame["id"].(string), computerControlStatePaused,
		controlSession, pausedID, controlGeneration, harness.grantExpiry)
	if result := awaitControl(t, pauseResults); result.err != nil {
		t.Fatal(result.err)
	}

	resumeResults := controlAsync(ctx, harness.desktop, "resume")
	resumeFrame := nextControlFrame(t, harness.socket, computerControlRequestType)
	body := controlFrameBody(t, resumeFrame)
	freshID, _ := body["new_selection_id"].(string)
	if !validUUID(freshID) || freshID == pausedID || body["selection_id"] != pausedID {
		t.Fatalf("resume did not request a fresh selection id: %+v", body)
	}
	sendControlAck(t, harness.socket, resumeFrame["id"].(string), computerControlStateActive,
		controlSession, freshID, controlGeneration, harness.grantExpiry)
	result := awaitControl(t, resumeResults)
	if result.err != nil || result.status.State != computerControlStateActive {
		t.Fatalf("resume failed: %+v", result)
	}
	if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateActive {
		t.Fatalf("status is not active: %+v", status)
	}
	// Resume must reuse the exact executor (same immutable window PID/instance)
	// and rebind it so the old observation is cleared.
	if created != 1 {
		t.Fatalf("resume constructed %d executors", created)
	}
	if selection := executor.selection(); selection.SelectionID != freshID || selection.SessionID != controlSession ||
		selection.RuntimeGeneration != controlGeneration {
		t.Fatalf("resume did not rebind the acknowledged selection: %+v", selection)
	}
	if executor.selectCount() != 2 {
		t.Fatalf("resume did not clear the old observation via selectHostSelection: %d", executor.selectCount())
	}
}

func TestComputerControlStopClosesLocalStateAfterQuiesce(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	installed := &controlTestExecutor{}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return installed, nil
	}
	selectionID := selectActiveTarget(t, harness, platform)
	executor := installed

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	results := controlAsync(ctx, harness.desktop, "stop")
	frame := nextControlFrame(t, harness.socket, computerControlRequestType)
	if controlFrameBody(t, frame)["selection_id"] != selectionID {
		t.Fatalf("stop did not carry the current selection")
	}
	sendControlAck(t, harness.socket, frame["id"].(string), computerControlStateStopped,
		controlSession, selectionID, controlGeneration, time.Now())
	result := awaitControl(t, results)
	if result.err != nil || result.status.State != computerControlStateStopped {
		t.Fatalf("stop returned %+v", result)
	}
	if closed, _, _ := executor.snapshot(); !closed {
		t.Fatal("stop left the executor open")
	}
	expectNoControlFrame(t, harness.socket, 80*time.Millisecond)
}

func TestComputerControlSelectionExpiryStopsWithoutServerRetry(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	executor := &controlTestExecutor{closedDone: make(chan struct{})}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return executor, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	results := controlAsync(ctx, harness.desktop, "select")
	frame := nextControlFrame(t, harness.socket, computerControlRequestType)
	selectionID := controlFrameBody(t, frame)["selection_id"].(string)
	sendControlAck(t, harness.socket, frame["id"].(string), computerControlStateActive,
		controlSession, selectionID, controlGeneration, time.Now().Add(150*time.Millisecond))
	if result := awaitControl(t, results); result.err != nil {
		t.Fatal(result.err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if harness.control.status(harness.desktop, controlConversation, controlTurn).State == computerControlStateStopped {
			// The elapsed-grant read reports stopped before the release
			// goroutine closes the executor; wait for that exact teardown.
			executor.awaitClosed(t)
			expectNoControlFrame(t, harness.socket, 100*time.Millisecond)
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("the expired selection did not stop")
}

func TestComputerControlSupersededSocketNeverActivatesOrReplays(t *testing.T) {
	executor := &controlTestExecutor{}
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
		executor: func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
			return executor, nil
		},
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	results := controlAsync(ctx, harness.desktop, "select")
	nextControlFrame(t, harness.socket, computerControlRequestType)
	harness.socket.close()

	// The pending select fails; a late acknowledgement on the old socket has
	// nowhere to go and never activates.
	result := awaitControl(t, results)
	if result.err == nil || result.status.State == computerControlStateActive {
		t.Fatalf("superseded select returned %+v", result)
	}
	if closed, _, _ := executor.snapshot(); !closed {
		t.Fatal("superseded select left the executor open")
	}

	var second *controlFixtureSocket
	select {
	case second = <-harness.sockets:
	case <-time.After(5 * time.Second):
		t.Fatal("the fixture did not accept the reconnect")
	}
	waitControlStatus(t, harness.connection, func(status DeviceConnectionStatus) bool {
		return status.State == DeviceOnline && status.ComputerReady
	})
	// Reconnect must not replay the old control frame.
	expectNoControlFrame(t, second, 150*time.Millisecond)
	if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateIdle {
		t.Fatalf("reconnect restored a selection: %+v", status)
	}
	// A fresh gesture still works on the new generation.
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return &controlTestExecutor{}, nil
	}
	nextResults := controlAsync(ctx, harness.desktop, "select")
	nextFrame := nextControlFrame(t, second, computerControlRequestType)
	selectionID := controlFrameBody(t, nextFrame)["selection_id"].(string)
	sendControlAck(t, second, nextFrame["id"].(string), computerControlStateActive,
		controlSession, selectionID, controlGeneration, time.Now().Add(time.Minute))
	if result := awaitControl(t, nextResults); result.err != nil || result.status.State != computerControlStateActive {
		t.Fatalf("fresh select on the new socket failed: %+v", result)
	}
}

func TestComputerControlUnavailableWithoutNegotiationOrEligibility(t *testing.T) {
	t.Run("operation not negotiated", func(t *testing.T) {
		platform := &controlTestPlatform{eligible: true}
		harness := startControlHarness(t, []string{"web.search"}, platform)
		if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateUnavailable {
			t.Fatalf("status reported %+v", status)
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		result := awaitControl(t, controlAsync(ctx, harness.desktop, "select"))
		if result.err != errComputerUnavailable || result.status.State != computerControlStateUnavailable {
			t.Fatalf("select returned %+v", result)
		}
		if picks := platform.picks.Load(); picks != 0 {
			t.Fatal("an unavailable host opened the picker")
		}
	})

	t.Run("driver not eligible", func(t *testing.T) {
		platform := &controlTestPlatform{eligible: false}
		harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
		if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateUnavailable {
			t.Fatalf("status reported %+v", status)
		}
		if harness.connection.Status().ComputerReady {
			t.Fatal("an ineligible host advertised ComputerReady")
		}
	})

	t.Run("account loss", func(t *testing.T) {
		platform := &controlTestPlatform{
			eligible: true,
			pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
		}
		harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
		selectActiveTarget(t, harness, platform)
		harness.connection.account.clear()
		waitControlStatus(t, harness.connection, func(status DeviceConnectionStatus) bool {
			return status.State == DeviceUnpaired
		})
		if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateUnavailable {
			t.Fatalf("status after account loss reported %+v", status)
		}
	})
}

func TestComputerControlFramesNeverReachTheRuntimePipe(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	selectActiveTarget(t, harness, platform)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	results := controlAsync(ctx, harness.desktop, "pause")
	frame := nextControlFrame(t, harness.socket, computerControlRequestType)
	sendControlAck(t, harness.socket, frame["id"].(string), computerControlStatePaused,
		controlSession, controlFrameBody(t, frame)["selection_id"].(string), controlGeneration, harness.grantExpiry)
	if result := awaitControl(t, results); result.err != nil {
		t.Fatal(result.err)
	}
	expectNoRuntimeControlFrame(t, harness.messages, 120*time.Millisecond)
}

func TestComputerControlEmergencyPauseUsesTheHostSelection(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	selectionID := selectActiveTarget(t, harness, platform)

	go harness.control.emergencyPause(harness.desktop)
	frame := nextControlFrame(t, harness.socket, computerControlRequestType)
	body := controlFrameBody(t, frame)
	if body["action"] != "pause" || body["selection_id"] != selectionID ||
		body["conversation_id"] != controlConversation || body["turn_id"] != controlTurn {
		t.Fatalf("emergency pause was not bound to the host selection: %+v", body)
	}
	sendControlAck(t, harness.socket, frame["id"].(string), computerControlStatePaused,
		controlSession, selectionID, controlGeneration, harness.grantExpiry)
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if harness.control.status(harness.desktop, controlConversation, controlTurn).State == computerControlStatePaused {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("emergency pause did not reach the paused state")
}

func TestComputerGateBlocksInputAfterPause(t *testing.T) {
	executor := &controlTestExecutor{}
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
		executor: func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
			return executor, nil
		},
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	selectionID := selectActiveTarget(t, harness, platform)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pauseResults := controlAsync(ctx, harness.desktop, "pause")
	frame := nextControlFrame(t, harness.socket, computerControlRequestType)
	sendControlAck(t, harness.socket, frame["id"].(string), computerControlStatePaused,
		controlSession, selectionID, controlGeneration, harness.grantExpiry)
	if result := awaitControl(t, pauseResults); result.err != nil {
		t.Fatal(result.err)
	}
	_, authorizations, _ := executor.snapshot()
	result := harness.control.gate.act(context.Background(), executor.selection(), "call-blocked", m1bComputerAct{
		Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
	})
	if result.act.OK || result.act.Error != "COMPUTER_ACCESS_DENIED" {
		t.Fatalf("a paused gate accepted input: %+v", result.act)
	}
	if _, after, _ := executor.snapshot(); after != authorizations {
		t.Fatal("a paused gate authorized a native input")
	}
}

func TestComputerControlLateOrUnknownResultDoesNotBreakTheConnection(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	selectActiveTarget(t, harness, platform)

	// Unknown request ids and malformed control results are consumed without
	// completing anything or failing the authenticated socket.
	_ = harness.socket.send([]byte(`{"type":"computer.control.result","id":"80000000-0000-4000-8000-000000000999","ok":true,"data":{}}`))
	_ = harness.socket.send([]byte(`{"type":"computer.control.result","id":"not-a-uuid","ok":false,"error_code":"FORBIDDEN"}`))
	time.Sleep(100 * time.Millisecond)
	if status := harness.connection.Status(); status.State != DeviceOnline || !status.ComputerReady {
		t.Fatalf("a stray control result broke the connection: %+v", status)
	}
	if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateActive {
		t.Fatalf("a stray control result changed the selection: %+v", status)
	}
}

func TestShellMenusExposeLocalizedEmergencyPause(t *testing.T) {
	desktop := &Desktop{}
	for _, locale := range []string{"zh-CN", "en-US", "es-ES", "pt-BR", "fr-FR", "ja-JP"} {
		tx := locales.In(locale)
		app, tray := desktop.shellMenus(tx)
		for name, menu := range map[string]*mygo.Menu{"app": app, "tray": tray} {
			item := menu.ItemByID("pause-computer")
			if item == nil || item.Click == nil {
				t.Fatalf("%s has no pause action in %s", name, locale)
			}
			if item.Label != tx.PauseComputerControl() {
				t.Fatalf("%s pause label %q is not localized in %s", name, item.Label, locale)
			}
		}
		if accelerator := app.ItemByID("pause-computer").Accelerator; accelerator != "Cmd+Shift+Esc" {
			t.Fatalf("pause accelerator is %q", accelerator)
		}
	}
}

func TestComputerControlStatusIsBoundToExactScopeAndGeneration(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	selectActiveTarget(t, harness, platform)

	status := harness.control.status(harness.desktop, controlConversation, controlTurn)
	if status.State != computerControlStateActive || status.ExpiresAt == "" {
		t.Fatalf("exact scope did not see the active grant: %+v", status)
	}
	for name, scope := range map[string][2]string{
		"other conversation": {"40000000-0000-4000-8000-000000000991", controlTurn},
		"other turn":         {controlConversation, "60000000-0000-4000-8000-000000000991"},
	} {
		other := harness.control.status(harness.desktop, scope[0], scope[1])
		if other.State != computerControlStateIdle || other.ExpiresAt != "" {
			t.Fatalf("%s saw another selection: %+v", name, other)
		}
	}
	// The IPC controller rejects an empty or partial scope, so the wildcard the
	// native emergency path uses is unreachable from the renderer.
	for name, ids := range map[string][2]string{
		"empty":      {"", ""},
		"no turn":    {controlConversation, ""},
		"no convers": {"", controlTurn},
	} {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		result := awaitControl(t, controlAsyncIDs(ctx, harness.desktop, ids[0], ids[1], "pause"))
		cancel()
		if result.err != errComputerInvalid || result.status.State != computerControlStateUnavailable {
			t.Fatalf("%s scope returned %+v", name, result)
		}
	}
	expectNoControlFrame(t, harness.socket, 80*time.Millisecond)
}

func controlAsyncIDs(ctx context.Context, desktop *Desktop, conversationID, turnID, action string) <-chan controlResult {
	results := make(chan controlResult, 1)
	go func() {
		status, err := desktop.computer.control(ctx, desktop, conversationID, turnID, action)
		results <- controlResult{status: status, err: err}
	}()
	return results
}

func TestComputerControlScopeAckMustRepeatTheExactBinding(t *testing.T) {
	for name, mutate := range map[string]func(selectionID string, expires time.Time) map[string]any{
		"wrong session": func(selectionID string, expires time.Time) map[string]any {
			return controlScopedAck(computerControlStatePaused, "70000000-0000-4000-8000-000000000991", selectionID, controlGeneration, expires)
		},
		"wrong generation": func(selectionID string, expires time.Time) map[string]any {
			return controlScopedAck(computerControlStatePaused, controlSession, selectionID, "50000000-0000-4000-8000-000000000991", expires)
		},
		"wrong selection": func(selectionID string, expires time.Time) map[string]any {
			return controlScopedAck(computerControlStatePaused, controlSession, "80000000-0000-4000-8000-000000000991", controlGeneration, expires)
		},
		"extended expiry": func(selectionID string, expires time.Time) map[string]any {
			return controlScopedAck(computerControlStatePaused, controlSession, selectionID, controlGeneration, expires.Add(time.Second))
		},
	} {
		t.Run(name, func(t *testing.T) {
			platform := &controlTestPlatform{
				eligible: true,
				pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
			}
			harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
			selectionID := selectActiveTarget(t, harness, platform)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			results := controlAsync(ctx, harness.desktop, "pause")
			frame := nextControlFrame(t, harness.socket, computerControlRequestType)
			raw, _ := json.Marshal(mutate(selectionID, harness.grantExpiry))
			raw, _ = json.Marshal(withControlFrameID(raw, frame["id"].(string)))
			if err := harness.socket.send(raw); err != nil {
				t.Fatal(err)
			}
			result := awaitControl(t, results)
			if result.err != errComputerUnavailable || result.status.State != computerControlStateActive {
				t.Fatalf("invalid pause ack returned %+v", result)
			}
			if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateActive {
				t.Fatalf("invalid ack installed paused: %+v", status)
			}
			gateResult := harness.control.gate.act(context.Background(), harness.control.gate.selection(), "call-denied", m1bComputerAct{
				Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
			})
			if gateResult.act.OK || gateResult.act.Error != "COMPUTER_ACCESS_DENIED" {
				t.Fatalf("invalid ack left input open: %+v", gateResult.act)
			}
		})
	}
}

func controlScopedAck(state, sessionID, selectionID, generation string, expires time.Time) map[string]any {
	return map[string]any{
		"type": computerControlResultType, "ok": true,
		"data": map[string]any{
			"state": state, "session_id": sessionID, "selection_id": selectionID,
			"runtime_generation": generation, "expires_at": expires.UTC().Format(time.RFC3339Nano),
		},
	}
}

func withControlFrameID(raw []byte, id string) map[string]any {
	var frame map[string]any
	if json.Unmarshal(raw, &frame) != nil {
		return nil
	}
	frame["id"] = id
	return frame
}

func TestComputerControlProvisionalExecutorCannotActBeforeTheAck(t *testing.T) {
	created := make(chan m1bComputerSelection, 1)
	firstExecutor := &controlTestExecutor{}
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
		executor: func(_ context.Context, _ *Desktop, _ computerSelectedTarget, selection m1bComputerSelection) (computerProductExecutor, error) {
			created <- selection
			return firstExecutor, nil
		},
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	results := controlAsync(ctx, harness.desktop, "select")
	frame := nextControlFrame(t, harness.socket, computerControlRequestType)
	provisional := <-created
	// The provisional binding passes the real constructor's identity validation;
	// it is kept unreachable by never installing it rather than by producing a
	// malformed id.
	if !validComputerSelection(provisional) {
		t.Fatal("the provisional selection failed the real constructor validation")
	}
	if _, err := newComputerHostAuthorization(provisional, "call-provisional", m1bComputerAct{
		Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
	}, provisional.ExpiresAt); err != nil {
		t.Fatalf("the real authorization constructor rejected the provisional binding: %v", err)
	}
	if gateSelection := harness.control.gate.selection(); gateSelection.SelectionID != "" {
		t.Fatalf("the provisional executor was reachable through the gate: %+v", gateSelection)
	}
	if result := harness.control.gate.observe(context.Background(), provisional); result.failure != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("a provisional observe was not denied: %+v", result)
	}
	if result := harness.control.gate.status(context.Background(), provisional); result.failure != "COMPUTER_UNAVAILABLE" {
		t.Fatalf("a provisional status reached an executor: %+v", result)
	}
	if result := harness.control.gate.act(context.Background(), provisional, "call-provisional", m1bComputerAct{
		Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
	}); result.act.OK || result.act.Error != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("a provisional act reached an executor: %+v", result.act)
	}
	if _, authorizations, _ := firstExecutor.snapshot(); authorizations != 0 {
		t.Fatal("the provisional executor authorized input")
	}

	// A wrong acknowledgement must not install it.
	sendControlAck(t, harness.socket, frame["id"].(string), computerControlStateActive,
		"70000000-0000-4000-8000-000000000991", controlFrameBody(t, frame)["selection_id"].(string),
		controlGeneration, harness.grantExpiry)
	result := awaitControl(t, results)
	if result.err == nil || result.status.State == computerControlStateActive {
		t.Fatalf("a wrong acknowledgement activated the provisional executor: %+v", result)
	}
	if closed, _, _ := firstExecutor.snapshot(); !closed {
		t.Fatal("the rejected provisional executor stayed open")
	}
	if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateIdle {
		t.Fatalf("a rejected ack left a selection: %+v", status)
	}

	// Only a correctly bound acknowledgement installs an executor, with the
	// acknowledged ids rather than the provisional ones.
	installed := &controlTestExecutor{}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return installed, nil
	}
	selectionID := selectActiveTarget(t, harness, platform)
	selection := installed.selection()
	if selection.SelectionID != selectionID || selection.SessionID != controlSession ||
		selection.RuntimeGeneration != controlGeneration {
		t.Fatalf("the installed executor kept provisional ids: %+v", selection)
	}
	if selection.SessionID == provisional.SessionID || selection.RuntimeGeneration == provisional.RuntimeGeneration {
		t.Fatal("the acknowledged executor reused a provisional id")
	}
}

func TestComputerControlStaleExpiryAndLinkEndCannotDetachNewerSelection(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	selectActiveTarget(t, harness, platform)
	oldSelection := harness.control.gate.selection()
	oldSession := harness.connection.currentControlSession()
	oldEnded := harness.connection.onLinkEnded

	harness.socket.close()
	var second *controlFixtureSocket
	select {
	case second = <-harness.sockets:
	case <-time.After(5 * time.Second):
		t.Fatal("the fixture did not accept the reconnect")
	}
	waitControlStatus(t, harness.connection, func(status DeviceConnectionStatus) bool {
		return status.State == DeviceOnline && status.ComputerReady
	})
	deadline := time.Now().Add(5 * time.Second)
	for {
		select {
		case message := <-harness.messages:
			if message.Type == "link.open" {
				break
			}
			if message.Type != "link.close" {
				t.Fatalf("unexpected runtime message after reconnect: %+v", message)
			}
			if time.Now().After(deadline) {
				t.Fatal("the reconnected runtime link did not open")
			}
			continue
		case <-time.After(time.Until(deadline)):
			t.Fatal("the reconnected runtime link did not open")
		}
		break
	}

	installed := &controlTestExecutor{}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return installed, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	results := controlAsync(ctx, harness.desktop, "select")
	frame := nextControlFrame(t, second, computerControlRequestType)
	selectionID := controlFrameBody(t, frame)["selection_id"].(string)
	newExpiry := time.Now().Add(time.Minute)
	sendControlAck(t, second, frame["id"].(string), computerControlStateActive,
		controlSession, selectionID, controlGeneration, newExpiry)
	if result := awaitControl(t, results); result.err != nil || result.status.State != computerControlStateActive {
		t.Fatalf("select after reconnect failed: %+v", result)
	}

	// A stale expiry timer and the old socket generation's deferred link-end
	// callback must both leave the newer selection and its executor intact.
	harness.control.expire(oldSelection.SelectionID, oldSelection.ExpiresAt)
	oldEnded(oldSession)
	if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateActive {
		t.Fatalf("a stale callback stopped the newer selection: %+v", status)
	}
	if current := harness.control.gate.selection(); current.SelectionID != selectionID {
		t.Fatalf("a stale callback detached the newer executor: %+v", current)
	}
	if closed, _, _ := installed.snapshot(); closed {
		t.Fatal("a stale callback closed the newer executor")
	}
}

func TestComputerControlRunTerminalUnblocksTheNextSelect(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	first := &controlTestExecutor{}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return first, nil
	}
	selectActiveTarget(t, harness, platform)

	injectRuntimeLinkFrame(t, harness, controlTerminalEventsFrame(
		controlConversation, controlTurn, controlGeneration, "completed"))
	waitComputerStatus(t, harness.control, harness.desktop, controlConversation, controlTurn, computerControlStateStopped)
	closed, _, invalidations := first.snapshot()
	if !closed || invalidations < 1 {
		t.Fatalf("terminal did not close and invalidate the old executor: closed=%v invalidations=%d", closed, invalidations)
	}
	expectNoControlFrame(t, harness.socket, 80*time.Millisecond)

	installed := &controlTestExecutor{}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return installed, nil
	}
	nextSelection := selectActiveTarget(t, harness, platform)
	if nextSelection == "" {
		t.Fatal("a new select after terminal did not activate")
	}
}

func TestComputerControlRunTerminalWaitsForQuiescenceBeforeNewSelect(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	executor := &controlTestExecutor{actStarted: make(chan struct{}, 1), actRelease: make(chan struct{})}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return executor, nil
	}
	selectActiveTarget(t, harness, platform)

	selection := executor.selection()
	actDone := make(chan m1bComputerResult, 1)
	go func() {
		actDone <- harness.control.gate.act(context.Background(), selection, "call-terminal", m1bComputerAct{
			Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
		})
	}()
	select {
	case <-executor.actStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture act did not start")
	}
	injectRuntimeLinkFrame(t, harness, controlTerminalEventsFrame(
		controlConversation, controlTurn, controlGeneration, "interrupted"))

	picks := platform.picks.Load()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	busy := awaitControl(t, controlAsync(ctx, harness.desktop, "select"))
	cancel()
	if busy.err != errComputerBusy || platform.picks.Load() != picks {
		t.Fatalf("a new select proceeded before quiescence: %+v picks=%d", busy, platform.picks.Load())
	}
	executor.releaseOnce.Do(func() { close(executor.actRelease) })
	select {
	case <-actDone:
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture act did not return")
	}
	waitComputerStatus(t, harness.control, harness.desktop, controlConversation, controlTurn, computerControlStateStopped)
	selectActiveTarget(t, harness, platform)
}

func TestComputerControlStopWithoutDefinitiveAckKeepsBoundaryClosed(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	executor := &controlTestExecutor{}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return executor, nil
	}
	selectActiveTarget(t, harness, platform)
	selection := executor.selection()

	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	result := awaitControl(t, controlAsync(ctx, harness.desktop, "stop"))
	if result.err == nil {
		t.Fatal("stop without a definitive ack reported success")
	}
	if result.status.State != computerControlStateStopped {
		t.Fatalf("stop did not close the boundary: %+v", result.status)
	}
	if closed, _, _ := executor.snapshot(); !closed {
		t.Fatal("stop without an ack left the executor open")
	}
	if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateStopped || status.ExpiresAt != "" {
		t.Fatalf("stopped status was not exact and expiry-free: %+v", status)
	}
	other := harness.control.status(harness.desktop, "40000000-0000-4000-8000-000000000991", controlTurn)
	if other.State != computerControlStateIdle || other.ExpiresAt != "" {
		t.Fatalf("another conversation saw the stopped selection: %+v", other)
	}
	gateResult := harness.control.gate.act(context.Background(), selection, "call-stopped", m1bComputerAct{
		Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
	})
	if gateResult.act.OK || gateResult.act.Error != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("a failed stop left input reachable: %+v", gateResult.act)
	}
}

func TestComputerControlCannotCancelAnotherScopesPicker(t *testing.T) {
	release := make(chan struct{})
	platform := &controlTestPlatform{
		eligible: true,
		pick: func(context.Context, *Desktop) (computerSelectedTarget, error) {
			<-release
			return controlFixtureTarget(), nil
		},
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return &controlTestExecutor{}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	results := controlAsync(ctx, harness.desktop, "select")
	deadline := time.Now().Add(2 * time.Second)
	for platform.picks.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if platform.picks.Load() != 1 {
		t.Fatal("the picker did not open")
	}

	otherConversation := "40000000-0000-4000-8000-000000000992"
	for _, action := range []string{"pause", "stop"} {
		result := awaitControl(t, controlAsyncIDs(ctx, harness.desktop, otherConversation, controlTurn, action))
		if result.err != errComputerBusy {
			t.Fatalf("%s from another scope returned %+v", action, result)
		}
	}
	close(release)
	frame := nextControlFrame(t, harness.socket, computerControlRequestType)
	if !validUUID(controlFrameBody(t, frame)["selection_id"].(string)) {
		t.Fatalf("the picker's select frame was disturbed: %+v", frame)
	}
	sendControlAck(t, harness.socket, frame["id"].(string), computerControlStateActive,
		controlSession, controlFrameBody(t, frame)["selection_id"].(string), controlGeneration, time.Now().Add(time.Minute))
	if result := awaitControl(t, results); result.err != nil || result.status.State != computerControlStateActive {
		t.Fatalf("the picker's select failed after an unrelated action: %+v", result)
	}
}

func TestComputerControlArmsEmergencyShortcutOnlyWhileActive(t *testing.T) {
	fixture := newShortcutFixture()
	shortcut := newShortcutUnderTest(fixture, func() {})
	shortcut.setEligible(true)
	shortcut.setForeground(false)
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	harness.desktop.computerShortcut = shortcut
	selectActiveTarget(t, harness, platform)
	if !fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("an active background selection did not arm the emergency shortcut")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	results := controlAsync(ctx, harness.desktop, "stop")
	frame := nextControlFrame(t, harness.socket, computerControlRequestType)
	sendControlAck(t, harness.socket, frame["id"].(string), computerControlStateStopped,
		controlSession, controlFrameBody(t, frame)["selection_id"].(string), controlGeneration, harness.grantExpiry)
	if result := awaitControl(t, results); result.err != nil {
		t.Fatal(result.err)
	}
	if fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("a stopped selection kept the emergency shortcut bound")
	}
}

func TestComputerControlEmergencyPauseCancelsPendingResume(t *testing.T) {
	executor := &controlTestExecutor{}
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
		executor: func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
			return executor, nil
		},
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	pausedID := selectActiveTarget(t, harness, platform)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pauseResults := controlAsync(ctx, harness.desktop, "pause")
	pauseFrame := nextControlFrame(t, harness.socket, computerControlRequestType)
	sendControlAck(t, harness.socket, pauseFrame["id"].(string), computerControlStatePaused,
		controlSession, pausedID, controlGeneration, harness.grantExpiry)
	if result := awaitControl(t, pauseResults); result.err != nil {
		t.Fatal(result.err)
	}

	resumeResults := controlAsync(ctx, harness.desktop, "resume")
	resumeFrame := nextControlFrame(t, harness.socket, computerControlRequestType)
	// The emergency gesture races the pending resume ack: it must cancel the
	// wait and keep input closed instead of letting resume reopen it.
	harness.control.emergencyPause(harness.desktop)
	sendControlAck(t, harness.socket, resumeFrame["id"].(string), computerControlStateActive,
		controlSession, controlFrameBody(t, resumeFrame)["new_selection_id"].(string),
		controlGeneration, harness.grantExpiry)
	resumeResult := awaitControl(t, resumeResults)
	if resumeResult.err == nil || resumeResult.status.State != computerControlStatePaused {
		t.Fatalf("a canceled resume returned %+v", resumeResult)
	}
	if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStatePaused {
		t.Fatalf("the emergency pause lost the paused state: %+v", status)
	}
	gateResult := harness.control.gate.act(context.Background(), executor.selection(), "call-emergency", m1bComputerAct{
		Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
	})
	if gateResult.act.OK || gateResult.act.Error != "COMPUTER_ACCESS_DENIED" {
		t.Fatalf("a canceled resume left input open: %+v", gateResult.act)
	}
	expectNoControlFrame(t, harness.socket, 120*time.Millisecond)
}

// TestComputerGateQuiesceRejectsAStaleExecutorOrBinding proves that an older
// transition can neither close a newer selection's input, invalidate it, nor
// wait on its in-flight action, including after a same-executor resume.
func TestComputerGateQuiesceRejectsAStaleExecutorOrBinding(t *testing.T) {
	current := fixtureComputerSelection(deviceFixtureCredential())
	previous := current
	previous.SelectionID = "80000000-0000-4000-8000-000000000901"

	executor := &controlTestExecutor{actStarted: make(chan struct{}, 1), actRelease: make(chan struct{})}
	executor.binding = previous
	gate := &computerExecutorGate{}
	gate.install(executor)
	// Host-only rebind of the same executor and window, as a resume does.
	if err := executor.selectHostSelection(current); err != nil {
		t.Fatal(err)
	}

	actDone := make(chan m1bComputerResult, 1)
	go func() {
		actDone <- gate.act(context.Background(), current, "call-current", m1bComputerAct{
			Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
		})
	}()
	select {
	case <-executor.actStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("the current act did not start")
	}

	for name, stale := range map[string]struct {
		executor  computerProductExecutor
		selection m1bComputerSelection
	}{
		"other executor": {&controlTestExecutor{binding: current}, current},
		"older binding":  {executor, previous},
	} {
		quiesce := gate.quiesce(context.Background(), stale.executor, stale.selection)
		select {
		case quiesced := <-quiesce:
			if !quiesced {
				t.Fatalf("%s: a stale quiesce did not release its wait", name)
			}
		case <-time.After(time.Second):
			t.Fatalf("%s: a stale quiesce waited on the newer action", name)
		}
		if !gate.open() {
			t.Fatalf("%s: a stale quiesce closed the newer selection's input", name)
		}
	}
	if _, _, invalidations := executor.snapshot(); invalidations != 0 {
		t.Fatalf("a stale quiesce invalidated the newer binding: %d", invalidations)
	}

	executor.releaseOnce.Do(func() { close(executor.actRelease) })
	select {
	case result := <-actDone:
		if !result.act.OK {
			t.Fatalf("a stale quiesce canceled the newer action: %+v", result.act)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the current act did not return")
	}

	// The exact current transition still closes input and proves terminal.
	if quiesced := <-gate.quiesce(context.Background(), executor, current); !quiesced {
		t.Fatal("the current quiesce was not terminal")
	}
	if gate.open() {
		t.Fatal("the current quiesce left input open")
	}
	blocked := gate.act(context.Background(), current, "call-closed", m1bComputerAct{
		Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
	})
	if blocked.act.OK || blocked.act.Error != "COMPUTER_ACCESS_DENIED" {
		t.Fatalf("the current quiesce did not close input: %+v", blocked.act)
	}
	if _, _, invalidations := executor.snapshot(); invalidations != 1 {
		t.Fatalf("the current quiesce did not invalidate exactly its binding: %d", invalidations)
	}
}

// TestComputerControlStopAutomaticallyRetiresWithoutTerminalProof proves that
// a stop whose wait expires cannot report stopped, release the executor or
// admit a replacement; once the exact act is terminal the retirement releases
// stopped by itself, without another click or a retried wire action, and a
// fresh selection can start.
func TestComputerControlStopAutomaticallyRetiresWithoutTerminalProof(t *testing.T) {
	executor := &controlTestExecutor{
		actStarted: make(chan struct{}, 1), actRelease: make(chan struct{}), closedDone: make(chan struct{}),
	}
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
		executor: func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
			return executor, nil
		},
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	selectActiveTarget(t, harness, platform)
	selection := executor.selection()

	actDone := make(chan m1bComputerResult, 1)
	go func() {
		actDone <- harness.control.gate.act(context.Background(), selection, "call-stop", m1bComputerAct{
			Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
		})
	}()
	select {
	case <-executor.actStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture act did not start")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	stopResults := controlAsync(ctx, harness.desktop, "stop")
	nextControlFrame(t, harness.socket, computerControlRequestType)
	result := awaitControl(t, stopResults)
	if result.err == nil {
		t.Fatal("stop without terminal proof reported success")
	}
	if result.status.State != computerControlStateRetiring || result.status.ExpiresAt != "" {
		t.Fatalf("stop without terminal proof did not report the exact retirement: %+v", result.status)
	}
	if closed, _, _ := executor.snapshot(); closed {
		t.Fatal("stop without terminal proof closed the executor")
	}
	gateResult := harness.control.gate.act(context.Background(), selection, "call-blocked", m1bComputerAct{
		Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
	})
	if gateResult.act.OK || gateResult.act.Error != "COMPUTER_ACCESS_DENIED" {
		t.Fatalf("a failed stop left input open: %+v", gateResult.act)
	}
	busyCtx, busyCancel := context.WithTimeout(context.Background(), 2*time.Second)
	picks := platform.picks.Load()
	busy := awaitControl(t, controlAsync(busyCtx, harness.desktop, "select"))
	busyCancel()
	if busy.err != errComputerBusy || platform.picks.Load() != picks {
		t.Fatalf("a new selection was admitted before terminal proof: %+v picks=%d", busy, platform.picks.Load())
	}

	executor.releaseOnce.Do(func() { close(executor.actRelease) })
	select {
	case <-actDone:
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture act did not return")
	}

	// The exact act terminal releases the scope by itself; no second stop and
	// no retried control frame is needed.
	waitComputerStatus(t, harness.control, harness.desktop, controlConversation, controlTurn, computerControlStateStopped)
	executor.awaitClosed(t)
	if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateStopped || status.ExpiresAt != "" {
		t.Fatalf("automatic retirement did not publish the exact stopped scope: %+v", status)
	}
	expectNoControlFrame(t, harness.socket, 120*time.Millisecond)

	next := &controlTestExecutor{}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return next, nil
	}
	selectActiveTarget(t, harness, platform)
}

// TestComputerControlStopAcceptsLaterRenewedExpiryAndQuiescesRetainedBinding
// proves the exact stop may acknowledge a later expiry after the server
// committed a same-selection renewal and suppressed its active ack (the later
// expiry is accepted but never applied), and that the retired binding/holder
// can still satisfy the server's correlated quiesce after the executor is
// detached. The old selection can neither observe nor act again, and a newer
// executor is untouched.
func TestComputerControlStopAcceptsLaterRenewedExpiryAndQuiescesRetainedBinding(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	executor := &controlTestExecutor{
		actStarted: make(chan struct{}, 1), actRelease: make(chan struct{}), closedDone: make(chan struct{}),
	}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return executor, nil
	}
	selectionID := selectActiveTarget(t, harness, platform)

	// Adopt the exact API holder for this selection through the real ingress.
	const observeID = "90000000-0000-4000-8000-000000000801"
	observe := sendControlComputerCommand(t, harness, observeID, selectionID, controlHolder, false, `{"kind":"observe"}`)
	if kind, _ := typedComputerFrame(t, observe); kind != "observe" {
		t.Fatalf("the holder was not adopted: %+v", observe)
	}

	// A renewal is still settling when Stop takes over; the server may have
	// committed it, so the stop receipt names the later bounded expiry.
	_, renewResults := startComputerRenew(t, harness)

	// A local act is admitted under the old grant. Stop closes input and must
	// wait for that exact act to become terminal before releasing.
	selection := executor.selection()
	actDone := make(chan m1bComputerResult, 1)
	go func() {
		actDone <- harness.control.gate.act(context.Background(), selection, "call-stop-retain", m1bComputerAct{
			Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
		})
	}()
	select {
	case <-executor.actStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture act did not start")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stopResults := controlAsync(ctx, harness.desktop, "stop")
	stopFrame := nextControlFrame(t, harness.socket, computerControlRequestType)
	laterExpiry := time.Now().Add(3 * time.Minute)
	sendControlAck(t, harness.socket, stopFrame["id"].(string), computerControlStateStopped,
		controlSession, selectionID, controlGeneration, laterExpiry)
	if canceled := awaitControl(t, renewResults); canceled.err == nil {
		t.Fatalf("the superseded renewal reported success: %+v", canceled)
	}
	executor.releaseOnce.Do(func() { close(executor.actRelease) })
	select {
	case <-actDone:
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture act did not return")
	}
	stopped := awaitControl(t, stopResults)
	if stopped.err != nil || stopped.status.State != computerControlStateStopped ||
		stopped.status.ExpiresAt != "" {
		t.Fatalf("the stop did not accept the later bounded expiry: %+v", stopped)
	}
	executor.awaitClosed(t)
	harness.control.mu.Lock()
	retiredExpiry := harness.control.selection.ExpiresAt
	harness.control.mu.Unlock()
	if !retiredExpiry.IsZero() {
		t.Fatalf("the stop applied the later renewal expiry locally: %+v", retiredExpiry)
	}

	// The old selection cannot re-enter even before the server quiesce lands.
	observes := executor.observeCount()
	oldObserve := sendControlComputerCommand(t, harness, "90000000-0000-4000-8000-000000000802",
		selectionID, controlHolder, false, `{"kind":"observe"}`)
	if fixtureCommandError(oldObserve) != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("the retired selection observed again: %+v", oldObserve)
	}
	if executor.observeCount() != observes {
		t.Fatal("the retired selection reached the executor")
	}

	// The server's exact quiesce still matches the retained binding/holder and
	// is acknowledged only now, after the exact terminal/publication.
	quiesce := sendControlComputerCommand(t, harness, "90000000-0000-4000-8000-000000000803",
		selectionID, controlHolder, false, `{"kind":"quiesce"}`)
	if kind, nested := typedComputerFrame(t, quiesce); kind != "quiesce" || nested["quiesced"] != true {
		t.Fatalf("the retained exact quiesce was not acknowledged: %+v", quiesce)
	}
	oldAct := sendControlComputerCommand(t, harness, "90000000-0000-4000-8000-000000000804",
		selectionID, controlHolder, false,
		`{"kind":"act","native_call_id":"call-retired","input":{"action":"click","observation_id":"obs","ref":"e1"}}`)
	if fixtureCommandError(oldAct) != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("the retired selection acted again: %+v", oldAct)
	}

	// A fresh selection replaces the retained binding; the stale quiesce must
	// not touch it.
	next := &controlTestExecutor{}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return next, nil
	}
	nextID := selectActiveTarget(t, harness, platform)
	staleQuiesce := sendControlComputerCommand(t, harness, "90000000-0000-4000-8000-000000000805",
		selectionID, controlHolder, false, `{"kind":"quiesce"}`)
	if fixtureCommandError(staleQuiesce) != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("a stale quiesce matched the new selection: %+v", staleQuiesce)
	}
	if current := harness.control.gate.selection(); current.SelectionID != nextID {
		t.Fatalf("a stale quiesce changed the new binding: %+v", current)
	}
	if _, _, invalidations := next.snapshot(); invalidations != 0 {
		t.Fatalf("a stale quiesce invalidated the new executor: %d", invalidations)
	}
}

// TestComputerControlRunTerminalWaitsForTheExactTerminal proves a completed
// local run cannot report stopped or admit a replacement while that
// selection's synthesized act is still in flight.
func TestComputerControlRunTerminalWaitsForTheExactTerminal(t *testing.T) {
	executor := &controlTestExecutor{
		actStarted: make(chan struct{}, 1), actRelease: make(chan struct{}), closedDone: make(chan struct{}),
	}
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
		executor: func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
			return executor, nil
		},
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	selectActiveTarget(t, harness, platform)
	selection := executor.selection()

	actDone := make(chan m1bComputerResult, 1)
	go func() {
		actDone <- harness.control.gate.act(context.Background(), selection, "call-terminal", m1bComputerAct{
			Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
		})
	}()
	select {
	case <-executor.actStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture act did not start")
	}
	injectRuntimeLinkFrame(t, harness, controlTerminalEventsFrame(
		controlConversation, controlTurn, controlGeneration, "completed"))

	// The terminal frame closes input synchronously (the quiesce invalidates
	// this exact binding) but the act is still pending.
	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, _, invalidations := executor.snapshot(); invalidations > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the terminal frame did not quiesce the selection")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateRetiring || status.ExpiresAt != "" {
		t.Fatalf("a pending act did not report the exact retirement: %+v", status)
	}
	if closed, _, _ := executor.snapshot(); closed {
		t.Fatal("a pending act let the terminal close the executor")
	}
	busyCtx, busyCancel := context.WithTimeout(context.Background(), 2*time.Second)
	picks := platform.picks.Load()
	busy := awaitControl(t, controlAsync(busyCtx, harness.desktop, "select"))
	busyCancel()
	if busy.err != errComputerBusy || platform.picks.Load() != picks {
		t.Fatalf("a new selection was admitted before the act terminal: %+v picks=%d", busy, platform.picks.Load())
	}

	executor.releaseOnce.Do(func() { close(executor.actRelease) })
	select {
	case <-actDone:
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture act did not return")
	}
	waitComputerStatus(t, harness.control, harness.desktop, controlConversation, controlTurn, computerControlStateStopped)
	executor.awaitClosed(t)
	expectNoControlFrame(t, harness.socket, 80*time.Millisecond)

	installed := &controlTestExecutor{}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return installed, nil
	}
	selectActiveTarget(t, harness, platform)
}

// TestComputerControlLateTerminalCannotReleaseANewerSelection proves a late
// terminal result for an older epoch/executor has no side effect on the live
// selection.
func TestComputerControlLateTerminalCannotReleaseANewerSelection(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	first := &controlTestExecutor{closedDone: make(chan struct{})}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return first, nil
	}
	firstID := selectActiveTarget(t, harness, platform)

	harness.control.mu.Lock()
	oldSelection, oldExecutor := harness.control.selection, harness.control.executor
	harness.control.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stopResults := controlAsync(ctx, harness.desktop, "stop")
	stopFrame := nextControlFrame(t, harness.socket, computerControlRequestType)
	sendControlAck(t, harness.socket, stopFrame["id"].(string), computerControlStateStopped,
		controlSession, firstID, controlGeneration, harness.grantExpiry)
	if result := awaitControl(t, stopResults); result.err != nil {
		t.Fatal(result.err)
	}

	second := &controlTestExecutor{}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return second, nil
	}
	secondID := selectActiveTarget(t, harness, platform)

	stale := &computerControlRetirement{
		selection: oldSelection, executor: oldExecutor, stopped: true, done: make(chan struct{}),
	}
	harness.control.finishRetirement(stale)
	if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateActive {
		t.Fatalf("a late terminal released the newer selection: %+v", status)
	}
	if current := harness.control.gate.selection(); current.SelectionID != secondID {
		t.Fatalf("a late terminal detached the newer executor: %+v", current)
	}
	if closed, _, _ := second.snapshot(); closed {
		t.Fatal("a late terminal closed the newer executor")
	}
}

// TestComputerControlRenewAdvancesTheExactGrant proves the explicit renewal is
// one closed `select` frame for the host's existing selection: no picker, no
// second target, the same native selection/bundle, a strictly later expiry,
// and no wire quiesce or tombstone.
func TestComputerControlRenewAdvancesTheExactGrant(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	executor := &controlTestExecutor{}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return executor, nil
	}
	selectionID := selectActiveTarget(t, harness, platform)
	oldExpiry := harness.grantExpiry
	picks := platform.picks.Load()

	frame, results := startComputerRenew(t, harness)
	body := controlFrameBody(t, frame)
	if body["action"] != "select" || body["selection_id"] != selectionID ||
		body["bundle_id"] != controlFixtureTarget().BundleID ||
		body["conversation_id"] != controlConversation || body["turn_id"] != controlTurn ||
		len(body) != 5 {
		t.Fatalf("renewal was not the closed same-selection select frame: %+v", body)
	}
	if _, hasNew := body["new_selection_id"]; hasNew {
		t.Fatalf("renewal invented a replacement selection id: %+v", body)
	}
	newExpiry := time.Now().Add(3 * time.Minute)
	if !newExpiry.After(oldExpiry) {
		t.Fatal("the fixture renewal did not advance the grant")
	}
	sendControlAck(t, harness.socket, frame["id"].(string), computerControlStateActive,
		controlSession, selectionID, controlGeneration, newExpiry)
	result := awaitControl(t, results)
	if result.err != nil || result.status.State != computerControlStateActive {
		t.Fatalf("renewal did not stay active: %+v", result)
	}
	gotExpiry, err := time.Parse(time.RFC3339, result.status.ExpiresAt)
	if err != nil || !gotExpiry.Equal(newExpiry.Truncate(time.Second)) {
		t.Fatalf("renewal reported the wrong expiry: %+v", result.status)
	}
	if picks != platform.picks.Load() {
		t.Fatalf("renewal opened the picker: %d -> %d", picks, platform.picks.Load())
	}
	if executor.selectCount() != 2 {
		t.Fatalf("renewal did not rebind the same executor: %d", executor.selectCount())
	}
	if bound := executor.selection(); !bound.ExpiresAt.Equal(newExpiry) || bound.SelectionID != selectionID ||
		bound.SessionID != controlSession || bound.RuntimeGeneration != controlGeneration {
		t.Fatalf("the executor did not receive the renewed exact binding: %+v", bound)
	}
	status := harness.control.status(harness.desktop, controlConversation, controlTurn)
	if status.State != computerControlStateActive {
		t.Fatalf("status lost the renewed selection: %+v", status)
	}
	if parsed, err := time.Parse(time.RFC3339, status.ExpiresAt); err != nil || !parsed.Equal(newExpiry.Truncate(time.Second)) {
		t.Fatalf("status reported the old expiry: %+v", status)
	}
	if count := controlTombstones(harness.control); count != 0 {
		t.Fatalf("renewal closed the selection with a wire quiesce tombstone: %d", count)
	}
	expectNoControlFrame(t, harness.socket, 100*time.Millisecond)
}

func TestComputerControlRenewRefusesNonActiveBusyOrOtherScope(t *testing.T) {
	t.Run("paused", func(t *testing.T) {
		platform := &controlTestPlatform{
			eligible: true,
			pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
		}
		harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
		executor := &controlTestExecutor{}
		platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
			return executor, nil
		}
		selectionID := selectActiveTarget(t, harness, platform)

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		pauseResults := controlAsync(ctx, harness.desktop, "pause")
		pauseFrame := nextControlFrame(t, harness.socket, computerControlRequestType)
		sendControlAck(t, harness.socket, pauseFrame["id"].(string), computerControlStatePaused,
			controlSession, selectionID, controlGeneration, harness.grantExpiry)
		if result := awaitControl(t, pauseResults); result.err != nil {
			t.Fatal(result.err)
		}

		result := awaitControl(t, controlAsync(ctx, harness.desktop, "renew"))
		if result.err != errComputerBusy || result.status.State != computerControlStatePaused {
			t.Fatalf("a paused selection renewed: %+v", result)
		}
		if executor.selectCount() != 1 {
			t.Fatalf("a paused renewal rebound the executor: %d", executor.selectCount())
		}
		expectNoControlFrame(t, harness.socket, 100*time.Millisecond)
	})

	t.Run("other scope", func(t *testing.T) {
		platform := &controlTestPlatform{
			eligible: true,
			pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
		}
		harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
		selectActiveTarget(t, harness, platform)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		result := awaitControl(t, controlAsyncIDs(ctx, harness.desktop,
			"40000000-0000-4000-8000-000000000993", controlTurn, "renew"))
		if result.err != errComputerInvalid || result.status.State != computerControlStateIdle {
			t.Fatalf("another scope renewed the selection: %+v", result)
		}
		expectNoControlFrame(t, harness.socket, 100*time.Millisecond)
	})

	t.Run("admitted input", func(t *testing.T) {
		executor := &controlTestExecutor{actStarted: make(chan struct{}, 1), actRelease: make(chan struct{})}
		platform := &controlTestPlatform{
			eligible: true,
			pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
			executor: func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
				return executor, nil
			},
		}
		harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
		selectActiveTarget(t, harness, platform)
		selection := executor.selection()

		actDone := make(chan m1bComputerResult, 1)
		go func() {
			actDone <- harness.control.gate.act(context.Background(), selection, "call-renew-busy", m1bComputerAct{
				Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
			})
		}()
		select {
		case <-executor.actStarted:
		case <-time.After(2 * time.Second):
			t.Fatal("the fixture act did not start")
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		result := awaitControl(t, controlAsync(ctx, harness.desktop, "renew"))
		if result.err != errComputerBusy || result.status.State != computerControlStateActive {
			t.Fatalf("an admitted act was renewed underneath: %+v", result)
		}
		if executor.selectCount() != 1 {
			t.Fatalf("a busy renewal rebound the executor: %d", executor.selectCount())
		}
		expectNoControlFrame(t, harness.socket, 100*time.Millisecond)

		executor.releaseOnce.Do(func() { close(executor.actRelease) })
		select {
		case <-actDone:
		case <-time.After(2 * time.Second):
			t.Fatal("the fixture act did not return")
		}
		if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateActive {
			t.Fatalf("the busy refusal changed the old state: %+v", status)
		}
		// The refusal was not a partial renewal: a later explicit gesture works.
		frame, results := startComputerRenew(t, harness)
		sendControlAck(t, harness.socket, frame["id"].(string), computerControlStateActive,
			controlSession, controlFrameBody(t, frame)["selection_id"].(string), controlGeneration,
			time.Now().Add(3*time.Minute))
		if renewed := awaitControl(t, results); renewed.err != nil || renewed.status.State != computerControlStateActive {
			t.Fatalf("a renewal after the busy refusal failed: %+v", renewed)
		}
	})

	t.Run("closed gate", func(t *testing.T) {
		platform := &controlTestPlatform{
			eligible: true,
			pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
		}
		harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
		executor := &controlTestExecutor{}
		platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
			return executor, nil
		}
		selectActiveTarget(t, harness, platform)
		// A failed pause leaves the active state with its boundary already
		// closed; renewal must not reopen or extend it.
		harness.control.gate.closeInputIf(executor)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		result := awaitControl(t, controlAsync(ctx, harness.desktop, "renew"))
		if result.err != errComputerBusy || result.status.State != computerControlStateActive {
			t.Fatalf("a closed boundary was renewed: %+v", result)
		}
		if harness.control.gate.open() {
			t.Fatal("a refused renewal reopened input")
		}
		expectNoControlFrame(t, harness.socket, 100*time.Millisecond)
	})

	t.Run("expired local grant", func(t *testing.T) {
		platform := &controlTestPlatform{
			eligible: true,
			pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
		}
		harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
		executor := &controlTestExecutor{}
		platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
			return executor, nil
		}
		selectActiveTarget(t, harness, platform)
		harness.control.mu.Lock()
		if harness.control.timer != nil {
			harness.control.timer.Stop()
			harness.control.timer = nil
		}
		harness.control.selection.ExpiresAt = time.Now().Add(-time.Second)
		harness.control.mu.Unlock()

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		result := awaitControl(t, controlAsync(ctx, harness.desktop, "renew"))
		if result.err != errComputerTimeout || result.status.State != computerControlStateRetiring ||
			result.status.ExpiresAt != "" {
			t.Fatalf("an elapsed local grant was revived: %+v", result)
		}
		if executor.selectCount() != 1 {
			t.Fatalf("an elapsed grant was rebound: %d", executor.selectCount())
		}
		expectNoControlFrame(t, harness.socket, 100*time.Millisecond)
	})
}

func TestComputerControlRenewRejectsStaleOrOverlongAcks(t *testing.T) {
	for name, send := range map[string]func(t *testing.T, harness *controlHarness, frame map[string]any, selectionID string, oldExpiry time.Time){
		"wrong session": func(t *testing.T, harness *controlHarness, frame map[string]any, selectionID string, oldExpiry time.Time) {
			sendControlAck(t, harness.socket, frame["id"].(string), computerControlStateActive,
				"70000000-0000-4000-8000-000000000994", selectionID, controlGeneration, oldExpiry.Add(time.Minute))
		},
		"wrong generation": func(t *testing.T, harness *controlHarness, frame map[string]any, selectionID string, oldExpiry time.Time) {
			sendControlAck(t, harness.socket, frame["id"].(string), computerControlStateActive,
				controlSession, selectionID, "50000000-0000-4000-8000-000000000994", oldExpiry.Add(time.Minute))
		},
		"wrong selection": func(t *testing.T, harness *controlHarness, frame map[string]any, selectionID string, oldExpiry time.Time) {
			sendControlAck(t, harness.socket, frame["id"].(string), computerControlStateActive,
				controlSession, "80000000-0000-4000-8000-000000000994", controlGeneration, oldExpiry.Add(time.Minute))
		},
		"equal expiry": func(t *testing.T, harness *controlHarness, frame map[string]any, selectionID string, oldExpiry time.Time) {
			sendControlAck(t, harness.socket, frame["id"].(string), computerControlStateActive,
				controlSession, selectionID, controlGeneration, oldExpiry)
		},
		"older expiry": func(t *testing.T, harness *controlHarness, frame map[string]any, selectionID string, oldExpiry time.Time) {
			sendControlAck(t, harness.socket, frame["id"].(string), computerControlStateActive,
				controlSession, selectionID, controlGeneration, oldExpiry.Add(-time.Second))
		},
		"over the five-minute ceiling": func(t *testing.T, harness *controlHarness, frame map[string]any, selectionID string, oldExpiry time.Time) {
			sendControlAck(t, harness.socket, frame["id"].(string), computerControlStateActive,
				controlSession, selectionID, controlGeneration,
				time.Now().Add(computerControlRenewGrant+computerControlRenewClockTolerance+time.Minute))
		},
		"server refusal": func(t *testing.T, harness *controlHarness, frame map[string]any, selectionID string, oldExpiry time.Time) {
			sendControlFailure(t, harness.socket, frame["id"].(string), "COMPUTER_TARGET_CHANGED")
		},
	} {
		t.Run(name, func(t *testing.T) {
			platform := &controlTestPlatform{
				eligible: true,
				pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
			}
			harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
			executor := &controlTestExecutor{}
			platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
				return executor, nil
			}
			selectionID := selectActiveTarget(t, harness, platform)
			oldExpiry := harness.grantExpiry
			frame, results := startComputerRenew(t, harness)
			send(t, harness, frame, selectionID, oldExpiry)
			result := awaitControl(t, results)
			if result.err == nil {
				t.Fatalf("an invalid renewal ack was accepted: %+v", result)
			}
			if name == "server refusal" {
				// A parsed pre-commit refusal proves the server did not commit
				// the renewal, so the exact old grant stays current and open.
				status := harness.control.status(harness.desktop, controlConversation, controlTurn)
				if status.State != computerControlStateActive {
					t.Fatalf("a conclusive refusal changed the state: %+v", status)
				}
				if parsed, err := time.Parse(time.RFC3339, status.ExpiresAt); err != nil || !parsed.Equal(oldExpiry.Truncate(time.Second)) {
					t.Fatalf("a conclusive refusal changed the expiry: %+v", status)
				}
				if !harness.control.gate.open() {
					t.Fatal("a conclusive refusal closed the exact live input")
				}
			} else {
				// A late, invalid or failed ack may have been committed by the
				// server. The exact executor retires and the old grant is never
				// reported as an open active selection.
				waitComputerStatus(t, harness.control, harness.desktop,
					controlConversation, controlTurn, computerControlStateIdle)
				if harness.control.gate.open() {
					t.Fatal("an uncertain renewal left input open")
				}
				if closed, _, _ := executor.snapshot(); !closed {
					t.Fatal("an uncertain renewal left the executor open")
				}
			}
			if executor.selectCount() != 1 {
				t.Fatalf("an invalid renewal rebound the executor: %d", executor.selectCount())
			}
			if bound := executor.selection(); !bound.ExpiresAt.Equal(oldExpiry) {
				t.Fatalf("an invalid renewal changed the executor expiry: %+v", bound)
			}
			expectNoControlFrame(t, harness.socket, 80*time.Millisecond)
		})
	}
}

// TestComputerControlRenewingCannotResurrectAfterStopOrStaleTimer proves the
// renewal is fenced by (selection id, expiry) and by the control epoch: the
// old timer cannot stop the renewed grant, and a stop cancels a renewal so a
// delayed reply never reopens or extends the stopped selection.
func TestComputerControlRenewingCannotResurrectAfterStopOrStaleTimer(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	executor := &controlTestExecutor{closedDone: make(chan struct{})}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return executor, nil
	}
	selectionID := selectActiveTarget(t, harness, platform)
	oldExpiry := harness.grantExpiry

	// First renewal succeeds.
	frame, results := startComputerRenew(t, harness)
	newExpiry := time.Now().Add(3 * time.Minute)
	sendControlAck(t, harness.socket, frame["id"].(string), computerControlStateActive,
		controlSession, selectionID, controlGeneration, newExpiry)
	if result := awaitControl(t, results); result.err != nil {
		t.Fatal(result.err)
	}

	// The timer armed for the old grant must not stop the renewed one.
	harness.control.expire(selectionID, oldExpiry)
	if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateActive {
		t.Fatalf("the stale timer stopped the renewed selection: %+v", status)
	}
	if closed, _, _ := executor.snapshot(); closed {
		t.Fatal("the stale timer closed the renewed executor")
	}

	// A stop cancels the pending renewal; its delayed success ack must not
	// install a later expiry or reopen the stopping selection.
	secondFrame, secondResults := startComputerRenew(t, harness)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	stopResults := controlAsync(ctx, harness.desktop, "stop")
	stopFrame := nextControlFrame(t, harness.socket, computerControlRequestType)
	sendControlAck(t, harness.socket, stopFrame["id"].(string), computerControlStateStopped,
		controlSession, selectionID, controlGeneration, newExpiry)
	stopped := awaitControl(t, stopResults)
	if stopped.err != nil || stopped.status.State != computerControlStateStopped {
		t.Fatalf("the stop lost to the renewal: %+v", stopped)
	}
	if canceled := awaitControl(t, secondResults); canceled.err == nil {
		t.Fatalf("the canceled renewal reported success: %+v", canceled)
	}
	sendControlAck(t, harness.socket, secondFrame["id"].(string), computerControlStateActive,
		controlSession, selectionID, controlGeneration, time.Now().Add(4*time.Minute))
	time.Sleep(120 * time.Millisecond)
	if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateStopped {
		t.Fatalf("a delayed renewal ack resurrected the stopped selection: %+v", status)
	}
	executor.awaitClosed(t)

	// A fresh selection starts from idle/stopped and is unrelated to the late ack.
	next := &controlTestExecutor{}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return next, nil
	}
	if fresh := selectActiveTarget(t, harness, platform); fresh == "" {
		t.Fatal("a fresh select after the canceled renewal did not activate")
	}
}

// TestComputerControlRenewFailsClosedOnLinkEnd proves a renewal crossing a
// socket generation end never activates, never replays on the reconnect, and
// the old executor is retired before a fresh picker can open.
func TestComputerControlRenewFailsClosedOnLinkEnd(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	executor := &controlTestExecutor{closedDone: make(chan struct{})}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return executor, nil
	}
	selectActiveTarget(t, harness, platform)

	_, results := startComputerRenew(t, harness)
	harness.socket.close()
	result := awaitControl(t, results)
	if result.err == nil {
		t.Fatalf("a renewal crossed the socket end: %+v", result)
	}
	executor.awaitClosed(t)

	var second *controlFixtureSocket
	select {
	case second = <-harness.sockets:
	case <-time.After(5 * time.Second):
		t.Fatal("the fixture did not accept the reconnect")
	}
	waitControlStatus(t, harness.connection, func(status DeviceConnectionStatus) bool {
		return status.State == DeviceOnline && status.ComputerReady
	})
	expectNoControlFrame(t, second, 120*time.Millisecond)
	if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateIdle {
		t.Fatalf("a reconnect restored the renewed selection: %+v", status)
	}

	installed := &controlTestExecutor{}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return installed, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	nextResults := controlAsync(ctx, harness.desktop, "select")
	nextFrame := nextControlFrame(t, second, computerControlRequestType)
	sendControlAck(t, second, nextFrame["id"].(string), computerControlStateActive,
		controlSession, controlFrameBody(t, nextFrame)["selection_id"].(string), controlGeneration,
		time.Now().Add(time.Minute))
	if fresh := awaitControl(t, nextResults); fresh.err != nil || fresh.status.State != computerControlStateActive {
		t.Fatalf("a fresh select after the failed renewal failed: %+v", fresh)
	}
}

// TestComputerControlRenewRebindFailureRetiresTheExactGrant proves a verified
// active renewal acknowledgement that cannot be applied locally (the executor
// rebind refuses as busy) never leaves the old grant current. The server may
// have advanced its epoch, so input must close, the exact executor/selection
// must retire, no active status may be reported, and no new act or observation
// may enter under the old binding.
func TestComputerControlRenewRebindFailureRetiresTheExactGrant(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	executor := &controlTestExecutor{closedDone: make(chan struct{})}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return executor, nil
	}
	selectionID := selectActiveTarget(t, harness, platform)
	oldExpiry := harness.grantExpiry
	previous := executor.selection()
	picks := platform.picks.Load()

	// The fake rebind itself refuses as busy before changing the exact binding:
	// the deterministic post-ack apply cut (in production an act can be admitted
	// between the gate's busy guard and this rebind).
	executor.mu.Lock()
	executor.selectErr = errComputerBusy
	executor.mu.Unlock()
	frame, results := startComputerRenew(t, harness)
	sendControlAck(t, harness.socket, frame["id"].(string), computerControlStateActive,
		controlSession, selectionID, controlGeneration, time.Now().Add(3*time.Minute))
	result := awaitControl(t, results)
	if result.err != errComputerUnavailable {
		t.Fatalf("an unapplied renewal acknowledgement reported %v, want %v: %+v",
			result.err, errComputerUnavailable, result)
	}
	if result.status.State == computerControlStateActive || result.status.ExpiresAt != "" {
		t.Fatalf("the old grant stayed active after an unapplied renewal: %+v", result.status)
	}
	if harness.control.gate.open() {
		t.Fatal("an unapplied renewal left input open")
	}

	executor.awaitClosed(t)
	waitComputerStatus(t, harness.control, harness.desktop, controlConversation, controlTurn, computerControlStateIdle)
	expectNoControlFrame(t, harness.socket, 100*time.Millisecond)
	if platform.picks.Load() != picks {
		t.Fatalf("an unapplied renewal opened a picker: %d -> %d", picks, platform.picks.Load())
	}
	if executor.selectCount() != 1 {
		t.Fatalf("a refused rebind changed the executor binding: %d", executor.selectCount())
	}
	if bound := executor.selection(); !bound.ExpiresAt.Equal(oldExpiry) || bound.SelectionID != selectionID {
		t.Fatalf("a refused rebind changed the executor grant: %+v", bound)
	}

	// After the terminal, the exact old selection can neither observe nor act,
	// and the clearing is limited to that exact executor/binding.
	observes := executor.observeCount()
	_, authorizations, _ := executor.snapshot()
	if observed := harness.control.gate.observe(context.Background(), previous); observed.failure != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("the unapplied selection observed again: %+v", observed)
	}
	acted := harness.control.gate.act(context.Background(), previous, "call-renew-rebind", m1bComputerAct{
		Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
	})
	if acted.act.OK || acted.act.Error != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("the unapplied selection acted again: %+v", acted.act)
	}
	if _, afterAuthorizations, _ := executor.snapshot(); afterAuthorizations != authorizations {
		t.Fatalf("the refused renewal authorized another act: %d -> %d", authorizations, afterAuthorizations)
	}
	if executor.observeCount() != observes {
		t.Fatal("the refused renewal reached the retired executor")
	}
	harness.control.mu.Lock()
	executorField, selectionField, terminalField := harness.control.executor, harness.control.selection, harness.control.terminal
	harness.control.mu.Unlock()
	if executorField != nil || selectionField.SelectionID != "" || terminalField.ConversationID != "" {
		t.Fatalf("the failed apply did not clear exactly its binding: %+v %+v", executorField, selectionField)
	}
	if retained := harness.control.gate.selection(); retained.SelectionID != selectionID || !retained.ExpiresAt.Equal(oldExpiry) {
		t.Fatalf("the terminal did not retain exactly the retired binding: %+v", retained)
	}
}

// TestComputerControlRenewActAdmissionRetiresAfterTheExactTerminal proves a
// verified renewal acknowledgement that lost the local gate (an act was
// admitted while the reply was in flight) closes input immediately and retires
// only after that exact act terminal. The old grant never returns to active and
// no second act or observation enters.
func TestComputerControlRenewActAdmissionRetiresAfterTheExactTerminal(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	executor := &controlTestExecutor{
		actStarted: make(chan struct{}, 1), actRelease: make(chan struct{}), closedDone: make(chan struct{}),
	}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return executor, nil
	}
	selectionID := selectActiveTarget(t, harness, platform)
	previous := executor.selection()
	picks := platform.picks.Load()

	frame, results := startComputerRenew(t, harness)

	// An act is admitted under the old grant while the renewal reply is still
	// in flight. This is the exact local gate the renewal cannot rebind.
	actDone := make(chan m1bComputerResult, 1)
	go func() {
		actDone <- harness.control.gate.act(context.Background(), previous, "call-renew-terminal", m1bComputerAct{
			Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
		})
	}()
	select {
	case <-executor.actStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture act did not start")
	}
	sendControlAck(t, harness.socket, frame["id"].(string), computerControlStateActive,
		controlSession, selectionID, controlGeneration, time.Now().Add(3*time.Minute))
	result := awaitControl(t, results)

	// Snapshot the cut before releasing the act so a failing run cannot leave
	// the fixture blocked.
	statusAtCut := harness.control.status(harness.desktop, controlConversation, controlTurn)
	openAtCut := harness.control.gate.open()
	closedAtCut, authorizationsAtCut, _ := executor.snapshot()
	duringObserve := harness.control.gate.observe(context.Background(), previous)

	executor.releaseOnce.Do(func() { close(executor.actRelease) })
	select {
	case acted := <-actDone:
		if !acted.act.OK {
			t.Fatalf("the admitted act was not allowed to finish: %+v", acted.act)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture act did not return")
	}

	if result.err == nil {
		t.Fatalf("an unapplied renewal acknowledgement reported success: %+v", result)
	}
	if statusAtCut.State != computerControlStateRetiring || statusAtCut.ExpiresAt != "" {
		t.Fatalf("an unapplied renewal did not report the exact retirement: %+v", statusAtCut)
	}
	if openAtCut {
		t.Fatal("an unapplied renewal left input open")
	}
	if closedAtCut {
		t.Fatal("the exact act terminal was bypassed by closing the executor")
	}
	if duringObserve.failure != "COMPUTER_ACCESS_DENIED" {
		t.Fatalf("the closed boundary admitted an observation: %+v", duringObserve)
	}

	executor.awaitClosed(t)
	waitComputerStatus(t, harness.control, harness.desktop, controlConversation, controlTurn, computerControlStateIdle)
	expectNoControlFrame(t, harness.socket, 100*time.Millisecond)
	if platform.picks.Load() != picks {
		t.Fatalf("an unapplied renewal opened a picker: %d -> %d", picks, platform.picks.Load())
	}

	observes := executor.observeCount()
	if observed := harness.control.gate.observe(context.Background(), previous); observed.failure != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("the retired grant observed again: %+v", observed)
	}
	acted := harness.control.gate.act(context.Background(), previous, "call-renew-terminal-2", m1bComputerAct{
		Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
	})
	if acted.act.OK || acted.act.Error != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("the retired grant acted again: %+v", acted.act)
	}
	if _, afterAuthorizations, _ := executor.snapshot(); afterAuthorizations != authorizationsAtCut {
		t.Fatalf("the retired grant authorized another act: %d -> %d", authorizationsAtCut, afterAuthorizations)
	}
	if executor.observeCount() != observes {
		t.Fatal("the retired grant reached the executor")
	}
	if retained := harness.control.gate.selection(); retained.SelectionID != selectionID {
		t.Fatalf("the terminal did not retain exactly the retired binding: %+v", retained)
	}
}

// TestComputerControlEmergencyPauseCancelsPendingRenew proves the native
// emergency gesture is never blocked by a renewal wait: it cancels the renewal,
// closes input and records paused, and the canceled renewal cannot install a
// later expiry.
func TestComputerControlEmergencyPauseCancelsPendingRenew(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	executor := &controlTestExecutor{}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return executor, nil
	}
	selectionID := selectActiveTarget(t, harness, platform)

	renewFrame, renewResults := startComputerRenew(t, harness)
	pauseDone := make(chan struct{})
	go func() {
		harness.control.emergencyPause(harness.desktop)
		close(pauseDone)
	}()
	pauseFrame := nextControlFrame(t, harness.socket, computerControlRequestType)
	if controlFrameBody(t, pauseFrame)["action"] != "pause" ||
		controlFrameBody(t, pauseFrame)["selection_id"] != selectionID {
		t.Fatalf("the emergency pause was not bound to the renewed selection: %+v", pauseFrame)
	}
	if canceled := awaitControl(t, renewResults); canceled.err == nil {
		t.Fatalf("the canceled renewal reported success: %+v", canceled)
	}
	sendControlAck(t, harness.socket, pauseFrame["id"].(string), computerControlStatePaused,
		controlSession, selectionID, controlGeneration, harness.grantExpiry)
	select {
	case <-pauseDone:
	case <-time.After(3 * time.Second):
		t.Fatal("the emergency pause did not finish")
	}
	// A late renewal ack must not reopen the paused selection.
	sendControlAck(t, harness.socket, renewFrame["id"].(string), computerControlStateActive,
		controlSession, selectionID, controlGeneration, time.Now().Add(4*time.Minute))
	time.Sleep(100 * time.Millisecond)
	if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStatePaused {
		t.Fatalf("a late renewal ack reopened the paused selection: %+v", status)
	}
	if harness.control.gate.open() {
		t.Fatal("a late renewal ack reopened the paused boundary")
	}
	expectNoControlFrame(t, harness.socket, 100*time.Millisecond)
}

// TestComputerControlMisScopedPauseCannotCancelRenewal proves a renderer pause
// for another scope or a stale link/owner is rejected before any mutation, so
// it can never cancel the live selection's pending renewal or close its input.
func TestComputerControlMisScopedPauseCannotCancelRenewal(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	executor := &controlTestExecutor{}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return executor, nil
	}
	selectionID := selectActiveTarget(t, harness, platform)
	frame, results := startComputerRenew(t, harness)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	misScoped := awaitControl(t, controlAsyncIDs(ctx, harness.desktop,
		"40000000-0000-4000-8000-000000000993", controlTurn, "pause"))
	if misScoped.err != errComputerInvalid {
		t.Fatalf("a mis-scoped pause returned %+v", misScoped)
	}
	if !harness.control.gate.open() {
		t.Fatal("a mis-scoped pause closed the live input")
	}
	expectNoControlFrame(t, harness.socket, 80*time.Millisecond)

	// The renewal is still the owner and installs its exact later expiry.
	newExpiry := time.Now().Add(3 * time.Minute)
	sendControlAck(t, harness.socket, frame["id"].(string), computerControlStateActive,
		controlSession, selectionID, controlGeneration, newExpiry)
	renewed := awaitControl(t, results)
	if renewed.err != nil || renewed.status.State != computerControlStateActive {
		t.Fatalf("a mis-scoped pause canceled the renewal: %+v", renewed)
	}
	if bound := executor.selection(); !bound.ExpiresAt.Equal(newExpiry) {
		t.Fatalf("the renewal did not install: %+v", bound)
	}
	if !harness.control.gate.open() {
		t.Fatal("the renewal left input closed")
	}
}

// TestComputerControlStaleOwnerOrLinkPauseCannotCancelRenewal proves the
// renderer-scope check also compares the exact live owner and socket link
// before any mutation, so a stale pause leaves the pending renewal untouched.
func TestComputerControlStaleOwnerOrLinkPauseCannotCancelRenewal(t *testing.T) {
	for name, mutate := range map[string]func(*computerControl){
		"stale link": func(control *computerControl) {
			control.selection.LinkID = "30000000-0000-4000-8000-000000009901"
		},
		"stale owner": func(control *computerControl) {
			control.selection.OwnerID = "10000000-0000-4000-8000-000000009902"
		},
	} {
		t.Run(name, func(t *testing.T) {
			platform := &controlTestPlatform{
				eligible: true,
				pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
			}
			harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
			executor := &controlTestExecutor{}
			platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
				return executor, nil
			}
			selectActiveTarget(t, harness, platform)
			startComputerRenew(t, harness)

			harness.control.mu.Lock()
			mutate(harness.control)
			harness.control.mu.Unlock()

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			paused := awaitControl(t, controlAsync(ctx, harness.desktop, "pause"))
			if paused.err != errComputerInvalid {
				t.Fatalf("a stale pause returned %+v", paused)
			}
			harness.control.mu.Lock()
			renewing := harness.control.renewing
			harness.control.mu.Unlock()
			if !renewing {
				t.Fatal("a stale owner/link pause canceled the pending renewal")
			}
			if !harness.control.gate.open() {
				t.Fatal("a stale owner/link pause closed the live input")
			}
			expectNoControlFrame(t, harness.socket, 80*time.Millisecond)
		})
	}
}

// TestComputerControlPauseDuringRenewalClosesInputWithoutFalseSuccess proves a
// same-scope pause safely closes local input while the renewal is pending, but
// never reports a successful paused state when the overlapping control is
// refused or names a later expiry. A delayed renewal ack cannot reopen it.
func TestComputerControlPauseDuringRenewalClosesInputWithoutFalseSuccess(t *testing.T) {
	for name, refuse := range map[string]func(t *testing.T, harness *controlHarness, pauseID, selectionID string){
		"server refusal": func(t *testing.T, harness *controlHarness, pauseID, _ string) {
			sendControlFailure(t, harness.socket, pauseID, "COMPUTER_UNAVAILABLE")
		},
		"later paused expiry": func(t *testing.T, harness *controlHarness, pauseID, selectionID string) {
			sendControlAck(t, harness.socket, pauseID, computerControlStatePaused,
				controlSession, selectionID, controlGeneration, time.Now().Add(3*time.Minute))
		},
	} {
		t.Run(name, func(t *testing.T) {
			platform := &controlTestPlatform{
				eligible: true,
				pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
			}
			harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
			executor := &controlTestExecutor{}
			platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
				return executor, nil
			}
			selectionID := selectActiveTarget(t, harness, platform)
			renewFrame, renewResults := startComputerRenew(t, harness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			pauseResults := controlAsync(ctx, harness.desktop, "pause")
			pauseFrame := nextControlFrame(t, harness.socket, computerControlRequestType)
			if body := controlFrameBody(t, pauseFrame); body["action"] != "pause" || body["selection_id"] != selectionID {
				t.Fatalf("the pause was not bound to the live selection: %+v", pauseFrame)
			}
			if canceled := awaitControl(t, renewResults); canceled.err == nil {
				t.Fatalf("the pause did not cancel the renewal: %+v", canceled)
			}
			refuse(t, harness, pauseFrame["id"].(string), selectionID)
			result := awaitControl(t, pauseResults)
			if result.err == nil {
				t.Fatalf("a refused overlapping pause reported success: %+v", result)
			}
			if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State == computerControlStatePaused {
				t.Fatalf("a refused overlapping pause installed paused: %+v", status)
			}
			if harness.control.gate.open() {
				t.Fatal("a refused overlapping pause left input open")
			}
			// A late renewal success must not reopen the closed boundary or
			// install its later expiry.
			sendControlAck(t, harness.socket, renewFrame["id"].(string), computerControlStateActive,
				controlSession, selectionID, controlGeneration, time.Now().Add(4*time.Minute))
			time.Sleep(100 * time.Millisecond)
			if harness.control.gate.open() {
				t.Fatal("a late renewal ack reopened the paused selection")
			}
			if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State == computerControlStatePaused {
				t.Fatalf("a late renewal ack installed a false paused state: %+v", status)
			}
		})
	}
}

// TestComputerControlRenewCannotReviveAfterTerminal proves a local run
// terminal supersedes the renewal wait; a delayed success ack cannot reinstall
// the selection, and the retirement finishes stopped.
func TestComputerControlRenewCannotReviveAfterTerminal(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	executor := &controlTestExecutor{closedDone: make(chan struct{})}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return executor, nil
	}
	selectionID := selectActiveTarget(t, harness, platform)

	renewFrame, renewResults := startComputerRenew(t, harness)
	injectRuntimeLinkFrame(t, harness, controlTerminalEventsFrame(
		controlConversation, controlTurn, controlGeneration, "completed"))
	// With no act in flight the terminal retirement completes immediately;
	// the delayed renewal ack must still not revive the stopped scope.
	waitComputerStatus(t, harness.control, harness.desktop, controlConversation, controlTurn, computerControlStateStopped)
	executor.awaitClosed(t)
	sendControlAck(t, harness.socket, renewFrame["id"].(string), computerControlStateActive,
		controlSession, selectionID, controlGeneration, time.Now().Add(4*time.Minute))
	result := awaitControl(t, renewResults)
	if result.err == nil {
		t.Fatalf("a terminal was revived by a delayed renewal ack: %+v", result)
	}
	if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateStopped {
		t.Fatalf("a delayed renewal ack changed the stopped scope: %+v", status)
	}
	expectNoControlFrame(t, harness.socket, 100*time.Millisecond)
}

// TestComputerControlExpiryRetiresAfterExactTerminal proves an elapsed grant
// closes input immediately but cannot report stopped, release the executor or
// admit a fresh selection until the exact act is terminal; the retirement then
// releases by itself without a server retry.
func TestComputerControlExpiryRetiresAfterExactTerminal(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	executor := &controlTestExecutor{
		actStarted: make(chan struct{}, 1), actRelease: make(chan struct{}), closedDone: make(chan struct{}),
	}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return executor, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	results := controlAsync(ctx, harness.desktop, "select")
	frame := nextControlFrame(t, harness.socket, computerControlRequestType)
	selectionID := controlFrameBody(t, frame)["selection_id"].(string)
	sendControlAck(t, harness.socket, frame["id"].(string), computerControlStateActive,
		controlSession, selectionID, controlGeneration, time.Now().Add(150*time.Millisecond))
	if result := awaitControl(t, results); result.err != nil {
		t.Fatal(result.err)
	}
	selection := executor.selection()

	actDone := make(chan m1bComputerResult, 1)
	go func() {
		actDone <- harness.control.gate.act(context.Background(), selection, "call-expiry", m1bComputerAct{
			Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
		})
	}()
	select {
	case <-executor.actStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture act did not start")
	}

	waitControlRetiring(t, harness.control)
	if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateRetiring || status.ExpiresAt != "" {
		t.Fatalf("expiry claimed a completed stop before terminal: %+v", status)
	}
	if harness.control.gate.open() {
		t.Fatal("expiry left input open before the act terminal")
	}
	if closed, _, _ := executor.snapshot(); closed {
		t.Fatal("expiry closed the executor before the act terminal")
	}
	picks := platform.picks.Load()
	busy := awaitControl(t, controlAsync(ctx, harness.desktop, "select"))
	if busy.err != errComputerBusy || platform.picks.Load() != picks {
		t.Fatalf("expiry admitted a fresh picker before terminal: %+v picks=%d", busy, platform.picks.Load())
	}

	executor.releaseOnce.Do(func() { close(executor.actRelease) })
	select {
	case <-actDone:
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture act did not return")
	}
	waitComputerStatus(t, harness.control, harness.desktop, controlConversation, controlTurn, computerControlStateStopped)
	executor.awaitClosed(t)
	expectNoControlFrame(t, harness.socket, 100*time.Millisecond)

	installed := &controlTestExecutor{}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return installed, nil
	}
	selectActiveTarget(t, harness, platform)
}

// TestComputerControlResetRetiresBeforeFreshSelect proves a reset/connection
// loss cannot publish idle or admit a new picker while the prior driver act is
// still running; the retirement releases automatically at its terminal.
func TestComputerControlResetRetiresBeforeFreshSelect(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	executor := &controlTestExecutor{
		actStarted: make(chan struct{}, 1), actRelease: make(chan struct{}), closedDone: make(chan struct{}),
	}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return executor, nil
	}
	selectActiveTarget(t, harness, platform)
	selection := executor.selection()

	actDone := make(chan m1bComputerResult, 1)
	go func() {
		actDone <- harness.control.gate.act(context.Background(), selection, "call-reset", m1bComputerAct{
			Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
		})
	}()
	select {
	case <-executor.actStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture act did not start")
	}

	harness.control.reset()
	waitControlRetiring(t, harness.control)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	picks := platform.picks.Load()
	busy := awaitControl(t, controlAsync(ctx, harness.desktop, "select"))
	cancel()
	if busy.err != errComputerBusy || platform.picks.Load() != picks {
		t.Fatalf("reset admitted a fresh picker before terminal: %+v picks=%d", busy, platform.picks.Load())
	}
	if closed, _, _ := executor.snapshot(); closed {
		t.Fatal("reset closed the executor before the act terminal")
	}

	executor.releaseOnce.Do(func() { close(executor.actRelease) })
	select {
	case <-actDone:
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture act did not return")
	}
	waitComputerStatus(t, harness.control, harness.desktop, controlConversation, controlTurn, computerControlStateIdle)
	executor.awaitClosed(t)
	expectNoControlFrame(t, harness.socket, 100*time.Millisecond)

	installed := &controlTestExecutor{}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return installed, nil
	}
	selectActiveTarget(t, harness, platform)
}

// TestComputerControlStatusReportsRetiringForElapsedGrant proves an elapsed
// grant is never reported as an active/paused grant without a live expiry, nor
// as a completed stop until the retirement proves the exact act terminal and
// driver close.
func TestComputerControlStatusReportsRetiringForElapsedGrant(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	executor := &controlTestExecutor{closedDone: make(chan struct{})}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return executor, nil
	}
	selectionID := selectActiveTarget(t, harness, platform)

	past := time.Now().Add(-time.Second)
	harness.control.mu.Lock()
	if harness.control.timer != nil {
		harness.control.timer.Stop()
		harness.control.timer = nil
	}
	harness.control.selection.ExpiresAt = past
	harness.control.mu.Unlock()

	status := harness.control.status(harness.desktop, controlConversation, controlTurn)
	if status.State != computerControlStateRetiring || status.ExpiresAt != "" {
		t.Fatalf("an elapsed grant was not reported as retiring: %+v", status)
	}
	other := harness.control.status(harness.desktop, "40000000-0000-4000-8000-000000000991", controlTurn)
	if other.State != computerControlStateIdle || other.ExpiresAt != "" {
		t.Fatalf("another scope saw the retiring selection: %+v", other)
	}
	if closed, _, _ := executor.snapshot(); closed {
		t.Fatal("an elapsed grant alone closed the executor")
	}

	// The bounded timer remains the owner and retires at the exact grant.
	harness.control.expire(selectionID, past)
	waitComputerStatus(t, harness.control, harness.desktop, controlConversation, controlTurn, computerControlStateStopped)
	executor.awaitClosed(t)
	expectNoControlFrame(t, harness.socket, 100*time.Millisecond)
}

// TestComputerControlRetiringStatusIsExactAndNeverAnAck proves the IPC
// contract the Web page reads: the exact live scope reports "retiring" with no
// expiry while the old act/driver is not terminal, other scopes stay idle, and
// no mutation treats that status as a successful acknowledgement.
func TestComputerControlRetiringStatusIsExactAndNeverAnAck(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	executor := &controlTestExecutor{
		actStarted: make(chan struct{}, 1), actRelease: make(chan struct{}), closedDone: make(chan struct{}),
	}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return executor, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	results := controlAsync(ctx, harness.desktop, "select")
	frame := nextControlFrame(t, harness.socket, computerControlRequestType)
	selectionID := controlFrameBody(t, frame)["selection_id"].(string)
	sendControlAck(t, harness.socket, frame["id"].(string), computerControlStateActive,
		controlSession, selectionID, controlGeneration, time.Now().Add(150*time.Millisecond))
	if result := awaitControl(t, results); result.err != nil {
		t.Fatal(result.err)
	}
	selection := executor.selection()
	actDone := make(chan m1bComputerResult, 1)
	go func() {
		actDone <- harness.control.gate.act(context.Background(), selection, "call-retiring", m1bComputerAct{
			Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
		})
	}()
	select {
	case <-executor.actStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture act did not start")
	}
	waitControlRetiring(t, harness.control)

	status := harness.control.status(harness.desktop, controlConversation, controlTurn)
	if status.State != "retiring" || status.ExpiresAt != "" {
		t.Fatalf("the exact retiring status was not expiry-free: %+v", status)
	}
	raw, err := json.Marshal(status)
	if err != nil || strings.Contains(string(raw), "expiresAt") {
		t.Fatalf("retiring leaked an expiry to the page: %s (%v)", raw, err)
	}
	if other := harness.control.status(harness.desktop,
		"40000000-0000-4000-8000-000000000991", controlTurn); other.State != computerControlStateIdle {
		t.Fatalf("another scope saw the retiring selection: %+v", other)
	}

	for _, action := range []string{"select", "pause", "resume", "renew"} {
		result := awaitControl(t, controlAsync(ctx, harness.desktop, action))
		if result.err == nil {
			t.Fatalf("%s acknowledged a retiring status as success: %+v", action, result)
		}
	}
	stopContext, stopCancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	stop := awaitControl(t, controlAsync(stopContext, harness.desktop, "stop"))
	stopCancel()
	if stop.err == nil || stop.status.State != computerControlStateRetiring || stop.status.ExpiresAt != "" {
		t.Fatalf("stop claimed a completed stop during retirement: %+v", stop)
	}

	executor.releaseOnce.Do(func() { close(executor.actRelease) })
	select {
	case <-actDone:
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture act did not return")
	}
	waitComputerStatus(t, harness.control, harness.desktop, controlConversation, controlTurn, computerControlStateStopped)
	executor.awaitClosed(t)
	expectNoControlFrame(t, harness.socket, 100*time.Millisecond)
}

// TestComputerControlConnectionEndedRequiresTheExactLiveSession proves a stale
// socket-generation callback cannot retire a newer selection: the check runs
// under the same state lock that installs selections.
func TestComputerControlConnectionEndedRequiresTheExactLiveSession(t *testing.T) {
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	executor := &controlTestExecutor{closedDone: make(chan struct{})}
	platform.executor = func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
		return executor, nil
	}
	selectActiveTarget(t, harness, platform)
	session := harness.connection.currentControlSession()
	if session == nil {
		t.Fatal("the fixture control session is not live")
	}

	// A differing live socket across the callback boundary owns the state.
	harness.control.connectionEnded(harness.connection, &deviceControlSession{
		socket: session.socket, linkID: "30000000-0000-4000-8000-000000009999",
	})
	if status := harness.control.status(harness.desktop, controlConversation, controlTurn); status.State != computerControlStateActive {
		t.Fatalf("a stale socket callback retired the live selection: %+v", status)
	}
	if closed, _, _ := executor.snapshot(); closed {
		t.Fatal("a stale socket callback closed the live executor")
	}

	// The exact live generation still resets, and retirement publishes idle
	// only after the executor is closed.
	harness.control.connectionEnded(harness.connection, session)
	waitComputerStatus(t, harness.control, harness.desktop, controlConversation, controlTurn, computerControlStateIdle)
	executor.awaitClosed(t)
}

// TestComputerGateRetainsOnlyTheExactRetiredBinding proves the detached
// executor's binding stays visible, bounded by the existing tombstone deadline,
// for one correlated quiesce while no input can re-enter and a newer executor
// is never detached or invalidated by the stale retirement.
func TestComputerGateRetainsOnlyTheExactRetiredBinding(t *testing.T) {
	first := fixtureComputerSelection(deviceFixtureCredential())
	firstExecutor := &controlTestExecutor{binding: first}
	gate := &computerExecutorGate{}
	gate.install(firstExecutor)
	gate.retireBinding(firstExecutor, first)

	if current := gate.selection(); current.SelectionID != first.SelectionID || !current.ExpiresAt.Equal(first.ExpiresAt) {
		t.Fatalf("the exact retired binding was not retained: %+v", current)
	}
	gate.mu.Lock()
	until := gate.retiredUntil
	gate.mu.Unlock()
	if want := m1bComputerTombstoneDeadline(first, time.Now()); !until.Equal(want) {
		t.Fatalf("retired binding deadline = %s, want %s", until, want)
	}
	for name, result := range map[string]m1bComputerResult{
		"observe": gate.observe(context.Background(), first),
		"act": gate.act(context.Background(), first, "call-retired", m1bComputerAct{
			Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
		}),
	} {
		code := result.failure
		if result.kind == "act" {
			code = result.act.Error
		}
		if code != "COMPUTER_TARGET_CHANGED" {
			t.Fatalf("a detached binding re-admitted %s: %+v", name, result)
		}
	}
	if firstExecutor.observeCount() != 0 {
		t.Fatal("a detached binding reached the retired executor")
	}

	second := first
	second.SelectionID = "80000000-0000-4000-8000-000000000906"
	second.ExpiresAt = first.ExpiresAt.Add(time.Minute)
	secondExecutor := &controlTestExecutor{binding: second}
	gate.install(secondExecutor)
	// A stale retirement (or quiesce) for the old executor must not detach,
	// close or invalidate the newer one.
	gate.retireBinding(firstExecutor, first)
	if current := gate.selection(); current.SelectionID != second.SelectionID {
		t.Fatalf("a stale retirement replaced the newer binding: %+v", current)
	}
	if !gate.open() {
		t.Fatal("a stale retirement closed the newer input")
	}
	if quiesced := <-gate.quiesce(context.Background(), firstExecutor, first); !quiesced {
		t.Fatal("a stale quiesce did not release its wait")
	}
	if !gate.open() {
		t.Fatal("a stale quiesce closed the newer input")
	}
	if _, _, invalidations := secondExecutor.snapshot(); invalidations != 0 {
		t.Fatalf("a stale quiesce invalidated the newer executor: %d", invalidations)
	}
	if result := gate.observe(context.Background(), second); result.kind != "observe" {
		t.Fatalf("the newer exact binding could not observe: %+v", result)
	}
}

// TestComputerGateRejectsAStaleObservationAfterRenewal proves an observation
// admitted for the pre-renewal expiry cannot enter the executor after the
// same-id grant was extended, while the renewed exact binding still can.
func TestComputerGateRejectsAStaleObservationAfterRenewal(t *testing.T) {
	selection := fixtureComputerSelection(deviceFixtureCredential())
	executor := &controlTestExecutor{binding: selection}
	gate := &computerExecutorGate{}
	gate.install(executor)
	renewed := selection
	renewed.ExpiresAt = selection.ExpiresAt.Add(time.Minute)
	if err := gate.renew(executor, renewed); err != nil {
		t.Fatal(err)
	}

	if result := gate.observe(context.Background(), selection); result.failure != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("a pre-renewal observation entered: %+v", result)
	}
	if result := gate.act(context.Background(), selection, "call-stale", m1bComputerAct{
		Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
	}); result.act.Error != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("a pre-renewal act entered: %+v", result.act)
	}
	if _, authorizations, _ := executor.snapshot(); authorizations != 0 {
		t.Fatal("a pre-renewal act authorized input")
	}
	if executor.observeCount() != 0 {
		t.Fatal("a pre-renewal observation reached the executor")
	}
	if result := gate.observe(context.Background(), renewed); result.kind != "observe" {
		t.Fatalf("the renewed exact observation was rejected: %+v", result)
	}
}

// TestComputerGateRenewRequiresExactIdleOpenInput proves the gate-level half of
// renewal: the exact installed executor, open input and idle act slot, and no
// reopening after a closed boundary.
func TestComputerGateRenewRequiresExactIdleOpenInput(t *testing.T) {
	selection := fixtureComputerSelection(deviceFixtureCredential())
	executor := &controlTestExecutor{binding: selection, actStarted: make(chan struct{}, 1), actRelease: make(chan struct{})}
	gate := &computerExecutorGate{}
	gate.install(executor)

	next := selection
	next.ExpiresAt = selection.ExpiresAt.Add(time.Minute)
	if err := gate.renew(executor, next); err != nil {
		t.Fatal(err)
	}
	if bound := gate.selection(); !bound.ExpiresAt.Equal(next.ExpiresAt) {
		t.Fatalf("the gate did not rebind the exact renewal: %+v", bound)
	}
	if !gate.open() {
		t.Fatal("renewal closed the input boundary")
	}

	actDone := make(chan m1bComputerResult, 1)
	go func() {
		actDone <- gate.act(context.Background(), next, "call-renew-gate", m1bComputerAct{
			Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
		})
	}()
	select {
	case <-executor.actStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture act did not start")
	}
	later := next
	later.ExpiresAt = next.ExpiresAt.Add(time.Minute)
	if err := gate.renew(executor, later); !errors.Is(err, errComputerBusy) {
		t.Fatalf("a busy gate renewed: %v", err)
	}
	if bound := gate.selection(); !bound.ExpiresAt.Equal(next.ExpiresAt) {
		t.Fatalf("a busy refusal changed the binding: %+v", bound)
	}
	executor.releaseOnce.Do(func() { close(executor.actRelease) })
	select {
	case <-actDone:
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture act did not return")
	}

	gate.closeInputIf(executor)
	if err := gate.renew(executor, later); !errors.Is(err, errComputerUnavailable) {
		t.Fatalf("a closed gate renewed: %v", err)
	}
	if gate.open() {
		t.Fatal("a refused renewal reopened the closed boundary")
	}
	if err := gate.renew(&controlTestExecutor{binding: next}, later); !errors.Is(err, errComputerUnavailable) {
		t.Fatalf("a different executor renewed: %v", err)
	}
}

// TestComputerShortcutDerivesFromTheLiveSelectionState proves a delayed
// arming or disarming decision from an older transition cannot override the
// live selection: the binding follows input-open state under the state lock.
func TestComputerShortcutDerivesFromTheLiveSelectionState(t *testing.T) {
	fixture := newShortcutFixture()
	shortcut := newShortcutUnderTest(fixture, func() {})
	shortcut.setEligible(true)
	shortcut.setForeground(false)
	executor := &controlTestExecutor{actStarted: make(chan struct{}, 1), actRelease: make(chan struct{})}
	platform := &controlTestPlatform{
		eligible: true,
		pick:     func(context.Context, *Desktop) (computerSelectedTarget, error) { return controlFixtureTarget(), nil },
		executor: func(context.Context, *Desktop, computerSelectedTarget, m1bComputerSelection) (computerProductExecutor, error) {
			return executor, nil
		},
	}
	harness := startControlHarness(t, []string{m1bComputerOperation}, platform)
	harness.desktop.computerShortcut = shortcut
	selectionID := selectActiveTarget(t, harness, platform)
	if !fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("an active background selection did not arm the shortcut")
	}

	selection := executor.selection()
	actDone := make(chan m1bComputerResult, 1)
	go func() {
		actDone <- harness.control.gate.act(context.Background(), selection, "call-shortcut", m1bComputerAct{
			Action: "click", ObservationID: controlObservation, Ref: "@obs1:e1", TimeoutMS: 8000,
		})
	}()
	select {
	case <-executor.actStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture act did not start")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pauseResults := controlAsync(ctx, harness.desktop, "pause")
	pauseFrame := nextControlFrame(t, harness.socket, computerControlRequestType)
	// The pause closed input before its network wait. Replaying the earlier
	// selection's arming decision must not bind the shortcut now.
	harness.control.syncEmergencyShortcut()
	if fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("a delayed arm bound the shortcut with input closed")
	}
	sendControlAck(t, harness.socket, pauseFrame["id"].(string), computerControlStatePaused,
		controlSession, selectionID, controlGeneration, harness.grantExpiry)
	executor.releaseOnce.Do(func() { close(executor.actRelease) })
	select {
	case <-actDone:
	case <-time.After(2 * time.Second):
		t.Fatal("the fixture act did not return")
	}
	if result := awaitControl(t, pauseResults); result.err != nil || result.status.State != computerControlStatePaused {
		t.Fatalf("pause did not finish: %+v", result)
	}
	if fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("a paused selection kept the shortcut bound")
	}

	resumeResults := controlAsync(ctx, harness.desktop, "resume")
	resumeFrame := nextControlFrame(t, harness.socket, computerControlRequestType)
	sendControlAck(t, harness.socket, resumeFrame["id"].(string), computerControlStateActive,
		controlSession, controlFrameBody(t, resumeFrame)["new_selection_id"].(string),
		controlGeneration, harness.grantExpiry)
	if result := awaitControl(t, resumeResults); result.err != nil || result.status.State != computerControlStateActive {
		t.Fatalf("resume did not reactivate: %+v", result)
	}
	if !fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("a resumed active selection did not rebind the shortcut")
	}
	// A repeated stale decision still derives true from the live selection.
	harness.control.syncEmergencyShortcut()
	if !fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("a stale disarm released the live selection's shortcut")
	}

	stopResults := controlAsync(ctx, harness.desktop, "stop")
	stopFrame := nextControlFrame(t, harness.socket, computerControlRequestType)
	sendControlAck(t, harness.socket, stopFrame["id"].(string), computerControlStateStopped,
		controlSession, controlFrameBody(t, stopFrame)["selection_id"].(string), controlGeneration, harness.grantExpiry)
	if result := awaitControl(t, stopResults); result.err != nil {
		t.Fatal(result.err)
	}
	if fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("a stopped selection kept the shortcut bound")
	}
	// A delayed arm from the ended selection must not bind again.
	harness.control.syncEmergencyShortcut()
	if fixture.isBound(computerEmergencyAccelerator) {
		t.Fatal("a stale arm rebound the shortcut after stop")
	}
}
