package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

const (
	fixtureConversation = "40000000-0000-4000-8000-000000000101"
	fixtureGeneration   = "50000000-0000-4000-8000-000000000101"
	fixtureTurn         = "60000000-0000-4000-8000-000000000101"
	fixtureSession      = "70000000-0000-4000-8000-000000000101"
	fixtureSelection    = "80000000-0000-4000-8000-000000000101"
	fixtureHolder       = "90000000-0000-4000-8000-000000000101"
	fixtureHolderTwo    = "90000000-0000-4000-8000-000000000102"
	fixtureLink         = "30000000-0000-4000-8000-000000000101"
	fixtureLinkTwo      = "30000000-0000-4000-8000-000000000102"
)

var fixtureReadyOperations = []string{"web.search", m1bComputerOperation}

func fixtureComputerSelection(credential deviceCredential) m1bComputerSelection {
	return m1bComputerSelection{
		OwnerID: credential.OwnerID, LinkID: fixtureLink,
		ConversationID: fixtureConversation, RuntimeGeneration: fixtureGeneration,
		TurnID: fixtureTurn, SessionID: fixtureSession, SelectionID: fixtureSelection,
		ExpiresAt: time.Now().Add(time.Hour),
	}
}

// fixtureComputerExecutor is the only executor in this slice. Its target is
// host-picked; refs come from the last observe and are cleared by invalidate.
type fixtureComputerExecutor struct {
	mu              sync.Mutex
	target          m1bComputerSelection
	statusResult    m1bComputerStatus
	observation     m1bComputerObservation
	actResult       m1bComputerActResult
	latest          *m1bComputerObservation
	latestSelection string
	hold            chan struct{}
	cancelWait      <-chan struct{}
	started         chan string
	canceled        chan struct{}
	cancelOnce      sync.Once
	calls           int
	actCalls        int
	invalidations   int
	lastTimeout     int
}

func newFixtureComputerExecutor(target m1bComputerSelection) *fixtureComputerExecutor {
	proceed, name := "Continue", "Name"
	return &fixtureComputerExecutor{
		target: target,
		statusResult: m1bComputerStatus{
			Available: true, Permissions: m1bComputerPermissions{Accessibility: "granted"}, ActiveGrant: true,
		},
		observation: m1bComputerObservation{
			ObservationID: "obs-1", TreeQuality: "good",
			Nodes: []m1bComputerNode{
				{Ref: "e1", Role: "AXButton", Name: &proceed},
				{Ref: "e2", Role: "AXTextField", Name: &name},
			},
		},
		actResult: m1bComputerActResult{OK: true, Effect: "done", WaitedMS: 1},
		started:   make(chan string, 16),
		canceled:  make(chan struct{}),
	}
}

func (f *fixtureComputerExecutor) selection() m1bComputerSelection {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.target
}

// selectTarget is host policy for a new selection. It deliberately does not
// clear refs; only the quiesce terminal calls invalidate.
func (f *fixtureComputerExecutor) selectTarget(target m1bComputerSelection) {
	f.mu.Lock()
	f.target = target
	f.mu.Unlock()
}

func (f *fixtureComputerExecutor) setLink(linkID string) {
	f.mu.Lock()
	f.target.LinkID = linkID
	f.mu.Unlock()
}

func (f *fixtureComputerExecutor) holdNextAction(hold chan struct{}) {
	f.mu.Lock()
	f.hold = hold
	f.cancelWait = nil
	f.mu.Unlock()
}

func (f *fixtureComputerExecutor) waitForCancellation(terminal <-chan struct{}) {
	f.mu.Lock()
	f.hold = nil
	f.cancelWait = terminal
	f.mu.Unlock()
}

func (f *fixtureComputerExecutor) invalidate(selection m1bComputerSelection) {
	f.mu.Lock()
	if f.latestSelection == selection.bindingKey() {
		f.latest = nil
		f.latestSelection = ""
		f.invalidations++
	}
	f.mu.Unlock()
}

func (f *fixtureComputerExecutor) snapshot() (calls, actCalls, invalidations int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls, f.actCalls, f.invalidations
}

func (f *fixtureComputerExecutor) actTimeout() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.lastTimeout
}

func (f *fixtureComputerExecutor) status(ctx context.Context, selection m1bComputerSelection) m1bComputerResult {
	f.record()
	if ctx.Err() != nil {
		return m1bComputerFailure("COMPUTER_TIMEOUT")
	}
	f.mu.Lock()
	result := f.statusResult
	f.mu.Unlock()
	return m1bComputerStatusResult(result)
}

func (f *fixtureComputerExecutor) observe(ctx context.Context, selection m1bComputerSelection) m1bComputerResult {
	f.record()
	if ctx.Err() != nil {
		return m1bComputerFailure("COMPUTER_TIMEOUT")
	}
	f.mu.Lock()
	observation := f.observation
	f.latest = &observation
	f.latestSelection = selection.bindingKey()
	f.mu.Unlock()
	return m1bComputerObservationResult(observation)
}

func (f *fixtureComputerExecutor) act(ctx context.Context, selection m1bComputerSelection, nativeCallID string, input m1bComputerAct) m1bComputerResult {
	f.mu.Lock()
	f.actCalls++
	f.calls++
	f.lastTimeout = input.TimeoutMS
	f.mu.Unlock()
	select {
	case f.started <- nativeCallID:
	default:
	}
	f.mu.Lock()
	latest, hold, cancelWait, result := f.latest, f.hold, f.cancelWait, f.actResult
	f.mu.Unlock()
	if latest == nil || latest.ObservationID != input.ObservationID {
		return m1bComputerActOutcome(m1bComputerActResult{OK: false, Error: "COMPUTER_STALE_OBSERVATION"})
	}
	found := false
	for _, node := range latest.Nodes {
		if node.Ref == input.Ref {
			found = true
			break
		}
	}
	if !found {
		return m1bComputerActOutcome(m1bComputerActResult{OK: false, Error: "COMPUTER_STALE_REF"})
	}
	if hold != nil {
		// The test controls the exact terminal. This models an executor that
		// has been asked to stop but has not returned yet.
		<-hold
		return m1bComputerActOutcome(result)
	}
	if cancelWait != nil {
		<-ctx.Done()
		f.cancelOnce.Do(func() { close(f.canceled) })
		<-cancelWait
		return m1bComputerFailure("COMPUTER_TIMEOUT")
	}
	if ctx.Err() != nil {
		return m1bComputerFailure("COMPUTER_TIMEOUT")
	}
	return m1bComputerActOutcome(result)
}

func (f *fixtureComputerExecutor) record() {
	f.mu.Lock()
	f.calls++
	f.mu.Unlock()
}

type fixtureComputerSocket struct {
	connectionID string
	offer        string
	incoming     chan string
	closed       chan struct{}
	send         func([]byte) error
	close        func()
}

func sendComputerReady(ctx context.Context, socket *websocket.Conn, deviceID, connectionID string, operations []string) error {
	execution, tool := desktopExecutionVersion, desktopToolVersion
	data, err := json.Marshal(deviceReady{
		Type: "ready", DeviceID: deviceID, ConnectionID: connectionID,
		ProtocolVersion: 1, HeartbeatIntervalMS: 15_000,
		ExecutionVersion: &execution, ToolVersion: &tool, ToolOperations: operations,
	})
	if err != nil {
		return err
	}
	return socket.Write(ctx, websocket.MessageText, data)
}

// newComputerFixtureServer accepts device sockets and publishes each ready
// generation. It is a unit-test seam only; the integration harness dials the
// real gateway instead.
func newComputerFixtureServer(t *testing.T, credential deviceCredential, operations []string, connectionIDs []string) (*httptest.Server, <-chan *fixtureComputerSocket) {
	t.Helper()
	sockets := make(chan *fixtureComputerSocket, 4)
	var accepted atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		socket, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer socket.CloseNow()
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
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
		slot := int(accepted.Add(1)) - 1
		connectionID := fmt.Sprintf("30000000-0000-4000-8000-%012d", 200+slot)
		if slot < len(connectionIDs) {
			connectionID = connectionIDs[slot]
		}
		if err := sendComputerReady(ctx, socket, credential.DeviceID, connectionID, operations); err != nil {
			return
		}
		fixture := &fixtureComputerSocket{
			connectionID: connectionID,
			offer:        r.Header.Get(desktopToolOperationsHeader),
			incoming:     make(chan string, 64),
			closed:       make(chan struct{}),
		}
		fixture.send = func(frame []byte) error {
			writeCtx, writeCancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer writeCancel()
			return socket.Write(writeCtx, websocket.MessageText, frame)
		}
		fixture.close = func() { _ = socket.Close(websocket.StatusNormalClosure, "fixture disconnect") }
		defer close(fixture.closed)
		select {
		case sockets <- fixture:
		case <-ctx.Done():
			return
		}
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

type computerFixtureRun struct {
	connection *deviceConnection
	socket     *fixtureComputerSocket
	runtime    *runtimeSupervisor
	messages   <-chan runtimePipeMessage
}

func startComputerFixture(t *testing.T, server *httptest.Server, sockets <-chan *fixtureComputerSocket,
	credential deviceCredential, host *m1bComputerHost) *computerFixtureRun {
	t.Helper()
	runtime, _, messages := newFixtureRuntime(t)
	origin, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	connection := newFixtureDeviceConnection(t, origin, credential)
	connection.runtime = runtime
	connection.computer = host
	go connection.run()
	t.Cleanup(func() {
		connection.cancel()
		waitDeviceDone(t, connection)
	})
	var socket *fixtureComputerSocket
	select {
	case socket = <-sockets:
	case <-time.After(5 * time.Second):
		t.Fatal("the fixture server did not accept the device socket")
	}
	waitDeviceStatus(t, connection, func(status DeviceConnectionStatus) bool {
		return status.State == DeviceOnline && status.ExecutionReady
	})
	select {
	case opened := <-messages:
		if opened.Type != "link.open" {
			t.Fatalf("unexpected runtime write: %+v", opened)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the runtime link was not opened")
	}
	return &computerFixtureRun{connection: connection, socket: socket, runtime: runtime, messages: messages}
}

func computerCommandJSON(id string, selection m1bComputerSelection, holder string, holderNull bool, expiresAt, request string) string {
	holderJSON := "null"
	if !holderNull {
		holderJSON = fmt.Sprintf("%q", holder)
	}
	return fmt.Sprintf(`{"type":"command","id":%q,"owner_id":%q,"conversation_id":%q,"runtime_generation":%q,"turn_id":%q,"expires_at":%q,"operation":"computer.execute","body":{"session_id":%q,"selection_id":%q,"holder_id":%s,"request":%s}}`,
		id, selection.OwnerID, selection.ConversationID, selection.RuntimeGeneration, selection.TurnID,
		expiresAt, selection.SessionID, selection.SelectionID, holderJSON, request)
}

func nextComputerFrame(t *testing.T, fixture *fixtureComputerSocket, match func(map[string]any) bool) map[string]any {
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
			if match(frame) {
				return frame
			}
		case <-fixture.closed:
			t.Fatal("the fixture socket closed before the expected frame")
		case <-deadline.C:
			t.Fatal("the expected device frame did not arrive")
		}
	}
}

func awaitComputerResult(t *testing.T, fixture *fixtureComputerSocket, id string) map[string]any {
	t.Helper()
	return nextComputerFrame(t, fixture, func(frame map[string]any) bool {
		return frame["type"] == "command.result" && frame["id"] == id
	})
}

func awaitComputerResultWithout(t *testing.T, fixture *fixtureComputerSocket, want string, forbidden []string) map[string]any {
	t.Helper()
	blocked := make(map[string]bool, len(forbidden))
	for _, id := range forbidden {
		blocked[id] = true
	}
	return nextComputerFrame(t, fixture, func(frame map[string]any) bool {
		if frame["type"] != "command.result" {
			return false
		}
		id, _ := frame["id"].(string)
		if blocked[id] {
			t.Fatalf("a suppressed result was published before %s: %+v", want, frame)
		}
		return id == want
	})
}

func expectNoComputerResults(t *testing.T, fixture *fixtureComputerSocket, ids []string, wait time.Duration) {
	t.Helper()
	forbidden := make(map[string]bool, len(ids))
	for _, id := range ids {
		forbidden[id] = true
	}
	deadline := time.NewTimer(wait)
	defer deadline.Stop()
	for {
		select {
		case raw := <-fixture.incoming:
			var frame map[string]any
			if json.Unmarshal([]byte(raw), &frame) != nil {
				continue
			}
			if id, _ := frame["id"].(string); forbidden[id] && frame["type"] == "command.result" {
				t.Fatalf("a suppressed result was published: %s", raw)
			}
		case <-deadline.C:
			return
		}
	}
}

func typedComputerFrame(t *testing.T, frame map[string]any) (string, map[string]any) {
	t.Helper()
	result, ok := frame["result"].(map[string]any)
	if !ok {
		t.Fatalf("the result envelope was missing: %+v", frame)
	}
	kind, _ := result["kind"].(string)
	nested, _ := result["result"].(map[string]any)
	return kind, nested
}

func awaitRuntimeInput(t *testing.T, messages <-chan runtimePipeMessage, match func(runtimePipeMessage) bool) runtimePipeMessage {
	t.Helper()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	for {
		select {
		case message := <-messages:
			if match(message) {
				return message
			}
		case <-deadline.C:
			t.Fatal("the expected runtime input did not arrive")
		}
	}
}

func expectNoRuntimeFrame(t *testing.T, messages <-chan runtimePipeMessage, forbidden string, wait time.Duration) {
	t.Helper()
	deadline := time.NewTimer(wait)
	defer deadline.Stop()
	for {
		select {
		case message := <-messages:
			if message.Type == "link.frame" && strings.Contains(string(message.Frame), forbidden) {
				t.Fatalf("a computer frame reached the runtime pipe: %+v", message)
			}
		case <-deadline.C:
			return
		}
	}
}

func fixtureClaim(t *testing.T, host *m1bComputerHost, id string) *m1bComputerDispatch {
	t.Helper()
	work, duplicate, overflow := host.claimReceipt(id, time.Now().Add(time.Hour))
	if duplicate || overflow || work == nil {
		t.Fatalf("the receipt was not claimable: duplicate=%v overflow=%v", duplicate, overflow)
	}
	return work
}

func waitComputerIdle(t *testing.T, host *m1bComputerHost) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		host.mu.Lock()
		idle := host.active == nil
		host.mu.Unlock()
		if idle {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the fixture executor did not reach terminal")
}

func waitComputerControlsFree(t *testing.T, host *m1bComputerHost) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		host.mu.Lock()
		free := host.controls == 0
		host.mu.Unlock()
		if free {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the quiesce control slot was not released")
}

func waitComputerStopped(t *testing.T, host *m1bComputerHost) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		host.mu.Lock()
		stopped := host.controls > 0 || host.selectionClosed
		host.mu.Unlock()
		if stopped {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the quiesce barrier was not registered")
}

func sendComputerCommand(t *testing.T, run *computerFixtureRun, id string, selection m1bComputerSelection, holder string, holderNull bool, request string) map[string]any {
	t.Helper()
	if err := run.socket.send([]byte(computerCommandJSON(id, selection, holder, holderNull, "2030-01-01T00:00:00Z", request))); err != nil {
		t.Fatal(err)
	}
	return awaitComputerResult(t, run.socket, id)
}

func fixtureCommandError(frame map[string]any) string {
	result, _ := frame["result"].(map[string]any)
	code, _ := result["error"].(string)
	return code
}

func TestComputerInterceptionAndForwarding(t *testing.T) {
	credential := deviceFixtureCredential()
	selection := fixtureComputerSelection(credential)
	fake := newFixtureComputerExecutor(selection)
	host := newM1BComputerHost(fake)
	server, sockets := newComputerFixtureServer(t, credential, fixtureReadyOperations, []string{fixtureLink})
	run := startComputerFixture(t, server, sockets, credential, host)
	if !strings.Contains(run.socket.offer, m1bComputerOperation) {
		t.Fatalf("the fixture executor was not offered: %q", run.socket.offer)
	}

	const inspectID = "90000000-0000-4000-8000-000000000201"
	inspect := `{"type":"command","id":"` + inspectID + `","owner_id":"` + credential.OwnerID +
		`","conversation_id":"` + fixtureConversation + `","runtime_generation":"` + fixtureGeneration +
		`","turn_id":"` + fixtureTurn + `","expires_at":"2030-01-01T00:00:00Z","operation":"turn.inspect"}`
	if err := run.socket.send([]byte(inspect)); err != nil {
		t.Fatal(err)
	}
	forwarded := awaitRuntimeInput(t, run.messages, func(message runtimePipeMessage) bool {
		return message.Type == "link.frame" && string(message.Frame) == inspect
	})
	if forwarded.LinkID != fixtureLink {
		t.Fatalf("the command changed links: %+v", forwarded)
	}

	const statusID = "90000000-0000-4000-8000-000000000202"
	status := sendComputerCommand(t, run, statusID, selection, "", true, `{"kind":"status"}`)
	kind, nested := typedComputerFrame(t, status)
	if kind != "status" || nested == nil || nested["available"] != true {
		t.Fatalf("unexpected status result: %+v", status)
	}
	expectNoRuntimeFrame(t, run.messages, statusID, 150*time.Millisecond)

	const foreignCancel = "90000000-0000-4000-8000-000000000203"
	cancel := `{"type":"command.cancel","id":"` + foreignCancel + `"}`
	if err := run.socket.send([]byte(cancel)); err != nil {
		t.Fatal(err)
	}
	awaitRuntimeInput(t, run.messages, func(message runtimePipeMessage) bool {
		return message.Type == "link.frame" && string(message.Frame) == cancel
	})
}

func TestComputerNeverForwardsUnknownOrUnnegotiatedComputerCommands(t *testing.T) {
	credential := deviceFixtureCredential()
	selection := fixtureComputerSelection(credential)
	for _, test := range []struct {
		name       string
		host       *m1bComputerHost
		operations []string
		operation  string
	}{
		{"executor absent", nil, fixtureReadyOperations, m1bComputerOperation},
		{"operation not negotiated", newM1BComputerHost(newFixtureComputerExecutor(selection)), []string{"web.search"}, m1bComputerOperation},
		{"unknown computer operation", newM1BComputerHost(newFixtureComputerExecutor(selection)), fixtureReadyOperations, "computer.other"},
	} {
		t.Run(test.name, func(t *testing.T) {
			server, sockets := newComputerFixtureServer(t, credential, test.operations, []string{fixtureLink})
			run := startComputerFixture(t, server, sockets, credential, test.host)
			const commandID = "90000000-0000-4000-8000-000000000211"
			command := `{"type":"command","id":"` + commandID + `","owner_id":"` + credential.OwnerID +
				`","conversation_id":"` + fixtureConversation + `","runtime_generation":"` + fixtureGeneration +
				`","turn_id":"` + fixtureTurn + `","expires_at":"2030-01-01T00:00:00Z","operation":"` + test.operation +
				`","body":{"session_id":"` + fixtureSession + `","selection_id":"` + fixtureSelection +
				`","holder_id":null,"request":{"kind":"status"}}}`
			if err := run.socket.send([]byte(command)); err != nil {
				t.Fatal(err)
			}
			frame := awaitComputerResult(t, run.socket, commandID)
			if fixtureCommandError(frame) != "COMPUTER_UNAVAILABLE" {
				t.Fatalf("an unsupported computer command was not rejected: %+v", frame)
			}
			expectNoRuntimeFrame(t, run.messages, commandID, 150*time.Millisecond)
		})
	}
}

func TestComputerHolderAdoptionAndQuiesceClosure(t *testing.T) {
	credential := deviceFixtureCredential()
	selection := fixtureComputerSelection(credential)
	fake := newFixtureComputerExecutor(selection)
	host := newM1BComputerHost(fake)
	server, sockets := newComputerFixtureServer(t, credential, fixtureReadyOperations, []string{fixtureLink})
	run := startComputerFixture(t, server, sockets, credential, host)

	// status is read-only and may use an explicit null holder.
	status := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000220", selection, "", true, `{"kind":"status"}`)
	if kind, _ := typedComputerFrame(t, status); kind != "status" {
		t.Fatalf("status with a null holder was rejected: %+v", status)
	}
	// act cannot acquire a holder.
	actBefore := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000221", selection, fixtureHolder, false,
		`{"kind":"act","native_call_id":"call-0","input":{"action":"click","observation_id":"obs-1","ref":"e1"}}`)
	if fixtureCommandError(actBefore) != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("act acquired a holder before observe: %+v", actBefore)
	}
	// First matching observe adopts the API-issued holder.
	observe := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000222", selection, fixtureHolder, false, `{"kind":"observe"}`)
	if kind, nested := typedComputerFrame(t, observe); kind != "observe" || nested["observation_id"] != "obs-1" {
		t.Fatalf("unexpected observation: %+v", observe)
	}
	// Later observe on the same selection must match the adopted holder.
	otherObserve := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000223", selection, fixtureHolderTwo, false, `{"kind":"observe"}`)
	if fixtureCommandError(otherObserve) != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("a second holder was adopted: %+v", otherObserve)
	}
	sameObserve := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000224", selection, fixtureHolder, false, `{"kind":"observe"}`)
	if kind, _ := typedComputerFrame(t, sameObserve); kind != "observe" {
		t.Fatalf("the adopted holder could not observe again: %+v", sameObserve)
	}
	otherAct := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000225", selection, fixtureHolderTwo, false,
		`{"kind":"act","native_call_id":"call-1","input":{"action":"click","observation_id":"obs-1","ref":"e1"}}`)
	if fixtureCommandError(otherAct) != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("act used a different holder: %+v", otherAct)
	}
	act := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000226", selection, fixtureHolder, false,
		`{"kind":"act","native_call_id":"call-2","input":{"action":"click","observation_id":"obs-1","ref":"e1"}}`)
	if kind, nested := typedComputerFrame(t, act); kind != "act" || nested["ok"] != true {
		t.Fatalf("the adopted holder could not act: %+v", act)
	}

	// An expired control never acks and never closes the selection.
	expired := time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano)
	const expiredQuiesceID = "90000000-0000-4000-8000-000000000235"
	if err := run.socket.send([]byte(computerCommandJSON(expiredQuiesceID, selection, fixtureHolder, false, expired, `{"kind":"quiesce"}`))); err != nil {
		t.Fatal(err)
	}
	expiredQuiesce := awaitComputerResult(t, run.socket, expiredQuiesceID)
	if fixtureCommandError(expiredQuiesce) != "COMPUTER_TIMEOUT" {
		t.Fatalf("an expired quiesce was not rejected: %+v", expiredQuiesce)
	}
	afterExpired := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000236", selection, "", true, `{"kind":"status"}`)
	if kind, _ := typedComputerFrame(t, afterExpired); kind != "status" {
		t.Fatalf("an expired quiesce closed the selection: %+v", afterExpired)
	}

	// A mismatched quiesce does not close the selection.
	wrongQuiesce := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000227", selection, fixtureHolderTwo, false, `{"kind":"quiesce"}`)
	if fixtureCommandError(wrongQuiesce) != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("a mismatched quiesce was accepted: %+v", wrongQuiesce)
	}
	quiesce := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000228", selection, fixtureHolder, false, `{"kind":"quiesce"}`)
	if kind, nested := typedComputerFrame(t, quiesce); kind != "quiesce" || nested["quiesced"] != true {
		t.Fatalf("the quiesce barrier was not acknowledged: %+v", quiesce)
	}
	if _, _, invalidations := fake.snapshot(); invalidations == 0 {
		t.Fatal("the quiesce did not invalidate the bound refs")
	}

	// A closed selection accepts only a live quiesce.
	closedStatus := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000229", selection, "", true, `{"kind":"status"}`)
	if fixtureCommandError(closedStatus) != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("a closed selection accepted status: %+v", closedStatus)
	}
	closedObserve := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000230", selection, fixtureHolder, false, `{"kind":"observe"}`)
	if fixtureCommandError(closedObserve) != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("a closed selection accepted observe: %+v", closedObserve)
	}
	closedAct := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000231", selection, fixtureHolder, false,
		`{"kind":"act","native_call_id":"call-3","input":{"action":"click","observation_id":"obs-1","ref":"e1"}}`)
	if fixtureCommandError(closedAct) != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("a closed selection accepted act: %+v", closedAct)
	}
	waitComputerControlsFree(t, host)
	repeatQuiesce := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000232", selection, fixtureHolder, false, `{"kind":"quiesce"}`)
	if kind, _ := typedComputerFrame(t, repeatQuiesce); kind != "quiesce" {
		t.Fatalf("a live quiesce on a closed selection was rejected: %+v", repeatQuiesce)
	}

	// Only an explicitly new host-picked selection plus a fresh observe
	// resumes input.
	fresh := selection
	fresh.SelectionID = "80000000-0000-4000-8000-000000000102"
	fake.selectTarget(fresh)
	freshObserve := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000233", fresh, fixtureHolderTwo, false, `{"kind":"observe"}`)
	if kind, _ := typedComputerFrame(t, freshObserve); kind != "observe" {
		t.Fatalf("a fresh selection could not observe: %+v", freshObserve)
	}
	freshAct := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000234", fresh, fixtureHolderTwo, false,
		`{"kind":"act","native_call_id":"call-4","input":{"action":"click","observation_id":"obs-1","ref":"e1"}}`)
	if kind, nested := typedComputerFrame(t, freshAct); kind != "act" || nested["ok"] != true {
		t.Fatalf("a fresh selection could not act: %+v", freshAct)
	}
}

func TestComputerQuiesceWaitsForTerminalAndSuppressesLateSuccess(t *testing.T) {
	credential := deviceFixtureCredential()
	selection := fixtureComputerSelection(credential)
	fake := newFixtureComputerExecutor(selection)
	hold := make(chan struct{})
	fake.holdNextAction(hold)
	host := newM1BComputerHost(fake)
	server, sockets := newComputerFixtureServer(t, credential, fixtureReadyOperations, []string{fixtureLink})
	run := startComputerFixture(t, server, sockets, credential, host)

	sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000240", selection, fixtureHolder, false, `{"kind":"observe"}`)
	const actID = "90000000-0000-4000-8000-000000000241"
	if err := run.socket.send([]byte(computerCommandJSON(actID, selection, fixtureHolder, false, "2030-01-01T00:00:00Z",
		`{"kind":"act","native_call_id":"call-1","input":{"action":"click","observation_id":"obs-1","ref":"e1"}}`))); err != nil {
		t.Fatal(err)
	}
	select {
	case <-fake.started:
	case <-time.After(5 * time.Second):
		t.Fatal("the fixture action did not start")
	}
	const quiesceID = "90000000-0000-4000-8000-000000000242"
	if err := run.socket.send([]byte(computerCommandJSON(quiesceID, selection, fixtureHolder, false, "2030-01-01T00:00:00Z", `{"kind":"quiesce"}`))); err != nil {
		t.Fatal(err)
	}
	waitComputerStopped(t, host)
	// Neither the action nor the ack may be published before the terminal.
	expectNoComputerResults(t, run.socket, []string{quiesceID, actID}, 150*time.Millisecond)

	close(hold)
	frame := awaitComputerResultWithout(t, run.socket, quiesceID, []string{actID})
	if kind, nested := typedComputerFrame(t, frame); kind != "quiesce" || nested["quiesced"] != true {
		t.Fatalf("the quiesce barrier was not acknowledged: %+v", frame)
	}
	expectNoComputerResults(t, run.socket, []string{actID}, 200*time.Millisecond)
	if _, _, invalidations := fake.snapshot(); invalidations == 0 {
		t.Fatal("the quiesce did not invalidate the bound refs after terminal")
	}
}

func TestComputerCancelAndLateSuccess(t *testing.T) {
	credential := deviceFixtureCredential()
	selection := fixtureComputerSelection(credential)
	fake := newFixtureComputerExecutor(selection)
	terminal := make(chan struct{})
	fake.waitForCancellation(terminal)
	host := newM1BComputerHost(fake)
	server, sockets := newComputerFixtureServer(t, credential, fixtureReadyOperations, []string{fixtureLink})
	run := startComputerFixture(t, server, sockets, credential, host)

	sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000250", selection, fixtureHolder, false, `{"kind":"observe"}`)
	const actID = "90000000-0000-4000-8000-000000000251"
	if err := run.socket.send([]byte(computerCommandJSON(actID, selection, fixtureHolder, false, "2030-01-01T00:00:00Z",
		`{"kind":"act","native_call_id":"call-1","input":{"action":"click","observation_id":"obs-1","ref":"e1"}}`))); err != nil {
		t.Fatal(err)
	}
	select {
	case <-fake.started:
	case <-time.After(5 * time.Second):
		t.Fatal("the fixture action did not start")
	}
	// The read loop stays live while work is active.
	const busyID = "90000000-0000-4000-8000-000000000252"
	busy := sendComputerCommand(t, run, busyID, selection, "", true, `{"kind":"status"}`)
	if fixtureCommandError(busy) != "DEVICE_BUSY" {
		t.Fatalf("a second action was not rejected as busy: %+v", busy)
	}
	if err := run.socket.send([]byte(`{"type":"command.cancel","id":"` + actID + `"}`)); err != nil {
		t.Fatal(err)
	}
	select {
	case <-fake.canceled:
	case <-time.After(5 * time.Second):
		t.Fatal("command.cancel did not reach the in-flight action")
	}
	expectNoRuntimeFrame(t, run.messages, actID, 100*time.Millisecond)
	close(terminal)
	expectNoComputerResults(t, run.socket, []string{actID}, 200*time.Millisecond)

	next := sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000253", selection, fixtureHolder, false, `{"kind":"observe"}`)
	if kind, _ := typedComputerFrame(t, next); kind != "observe" {
		t.Fatalf("the slot was not released after cancellation: %+v", next)
	}
}

func TestComputerPostEntryTimeoutIsUncertain(t *testing.T) {
	credential := deviceFixtureCredential()
	selection := fixtureComputerSelection(credential)
	selection.ExpiresAt = time.Now().Add(1 * time.Second)
	fake := newFixtureComputerExecutor(selection)
	terminal := make(chan struct{})
	fake.waitForCancellation(terminal)
	host := newM1BComputerHost(fake)
	server, sockets := newComputerFixtureServer(t, credential, fixtureReadyOperations, []string{fixtureLink})
	run := startComputerFixture(t, server, sockets, credential, host)

	sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000260", selection, fixtureHolder, false, `{"kind":"observe"}`)
	const actID = "90000000-0000-4000-8000-000000000261"
	if err := run.socket.send([]byte(computerCommandJSON(actID, selection, fixtureHolder, false, "2030-01-01T00:00:00Z",
		`{"kind":"act","native_call_id":"call-1","input":{"action":"click","observation_id":"obs-1","ref":"e1","timeout_ms":20000}}`))); err != nil {
		t.Fatal(err)
	}
	select {
	case <-fake.canceled:
	case <-time.After(5 * time.Second):
		t.Fatal("the native selection deadline did not cancel the action")
	}
	if timeout := fake.actTimeout(); timeout >= 20000 || timeout < 0 {
		t.Fatalf("the per-act timeout was not clamped: %d", timeout)
	}
	close(terminal)
	frame := awaitComputerResult(t, run.socket, actID)
	if fixtureCommandError(frame) != "RUNNER_OPERATION_UNCERTAIN" {
		t.Fatalf("a post-entry timeout was not classified as uncertain: %+v", frame)
	}
}

func TestComputerPreEntryExpiryIsATimeout(t *testing.T) {
	credential := deviceFixtureCredential()
	selection := fixtureComputerSelection(credential)
	fake := newFixtureComputerExecutor(selection)
	host := newM1BComputerHost(fake)
	server, sockets := newComputerFixtureServer(t, credential, fixtureReadyOperations, []string{fixtureLink})
	run := startComputerFixture(t, server, sockets, credential, host)

	const statusID = "90000000-0000-4000-8000-000000000265"
	expired := time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano)
	if err := run.socket.send([]byte(computerCommandJSON(statusID, selection, "", true, expired, `{"kind":"status"}`))); err != nil {
		t.Fatal(err)
	}
	frame := awaitComputerResult(t, run.socket, statusID)
	if fixtureCommandError(frame) != "COMPUTER_TIMEOUT" {
		t.Fatalf("an expired command was not rejected pre-entry: %+v", frame)
	}
	if calls, _, _ := fake.snapshot(); calls != 0 {
		t.Fatalf("an expired command reached the executor: %d calls", calls)
	}
}

func TestComputerReplayRetentionBeyondFifoSpan(t *testing.T) {
	credential := deviceFixtureCredential()
	selection := fixtureComputerSelection(credential)
	fake := newFixtureComputerExecutor(selection)
	host := newM1BComputerHost(fake)
	server, sockets := newComputerFixtureServer(t, credential, fixtureReadyOperations, []string{fixtureLink})
	run := startComputerFixture(t, server, sockets, credential, host)

	before, _, _ := fake.snapshot()
	first := "90000000-0000-4000-8000-000000000400"
	for index := 0; index < 40; index++ {
		id := fmt.Sprintf("90000000-0000-4000-8000-%012d", 400+index)
		sendComputerCommand(t, run, id, selection, "", true, `{"kind":"status"}`)
	}
	after, _, _ := fake.snapshot()
	if after-before != 40 {
		t.Fatalf("unexpected status executions: %d", after-before)
	}
	// The first unexpired id is still retained after more than the old FIFO
	// span; a replay is dropped instead of executed again.
	if err := run.socket.send([]byte(computerCommandJSON(first, selection, "", true, "2030-01-01T00:00:00Z", `{"kind":"status"}`))); err != nil {
		t.Fatal(err)
	}
	expectNoComputerResults(t, run.socket, []string{first}, 200*time.Millisecond)
	if calls, _, _ := fake.snapshot(); calls != after {
		t.Fatalf("a replayed command was executed again: %d", calls)
	}
}

func TestComputerReplacementDoesNotOverlapOrLeakOldReply(t *testing.T) {
	credential := deviceFixtureCredential()
	first := fixtureComputerSelection(credential)
	fake := newFixtureComputerExecutor(first)
	hold := make(chan struct{})
	fake.holdNextAction(hold)
	host := newM1BComputerHost(fake)
	server, sockets := newComputerFixtureServer(t, credential, fixtureReadyOperations,
		[]string{fixtureLink, fixtureLinkTwo})
	runA := startComputerFixture(t, server, sockets, credential, host)

	sendComputerCommand(t, runA, "90000000-0000-4000-8000-000000000285", first, fixtureHolder, false, `{"kind":"observe"}`)
	const actID = "90000000-0000-4000-8000-000000000286"
	if err := runA.socket.send([]byte(computerCommandJSON(actID, first, fixtureHolder, false, "2030-01-01T00:00:00Z",
		`{"kind":"act","native_call_id":"call-1","input":{"action":"click","observation_id":"obs-1","ref":"e1"}}`))); err != nil {
		t.Fatal(err)
	}
	select {
	case <-fake.started:
	case <-time.After(5 * time.Second):
		t.Fatal("the first action did not start")
	}

	runB := startComputerFixture(t, server, sockets, credential, host)
	second := first
	second.LinkID = fixtureLinkTwo
	second.SelectionID = "80000000-0000-4000-8000-000000000103"
	fake.selectTarget(second)
	// The old input has not reached terminal, so the new connection cannot
	// overlap it even though open() already asked the old work to stop.
	busy := sendComputerCommand(t, runB, "90000000-0000-4000-8000-000000000287", second, fixtureHolderTwo, false, `{"kind":"observe"}`)
	if fixtureCommandError(busy) != "DEVICE_BUSY" {
		t.Fatalf("a new selection overlapped old input: %+v", busy)
	}
	if _, actCalls, _ := fake.snapshot(); actCalls != 1 {
		t.Fatalf("the new connection reached the executor early: %d calls", actCalls)
	}

	close(hold)
	waitComputerIdle(t, host)
	// The old action returns success, but its link is superseded. Neither
	// socket may receive it, and it must not be delivered to the new one.
	expectNoComputerResults(t, runA.socket, []string{actID}, 200*time.Millisecond)
	expectNoComputerResults(t, runB.socket, []string{actID}, 150*time.Millisecond)

	observeB := sendComputerCommand(t, runB, "90000000-0000-4000-8000-000000000288", second, fixtureHolderTwo, false, `{"kind":"observe"}`)
	if kind, _ := typedComputerFrame(t, observeB); kind != "observe" {
		t.Fatalf("the new connection could not observe after terminal: %+v", observeB)
	}
	actB := sendComputerCommand(t, runB, "90000000-0000-4000-8000-000000000289", second, fixtureHolderTwo, false,
		`{"kind":"act","native_call_id":"call-2","input":{"action":"click","observation_id":"obs-1","ref":"e1"}}`)
	if kind, nested := typedComputerFrame(t, actB); kind != "act" || nested["ok"] != true {
		t.Fatalf("the new selection could not act after terminal: %+v", actB)
	}
}

func TestComputerCancelBindsSocketGeneration(t *testing.T) {
	credential := deviceFixtureCredential()
	host := newM1BComputerHost(newFixtureComputerExecutor(fixtureComputerSelection(credential)))
	first := host.open()
	second := host.open()
	selection := fixtureComputerSelection(credential)
	connection := &deviceConnection{ctx: context.Background()}
	link := &m1bComputerLink{connection: connection, host: host, token: second, ctx: context.Background()}
	command := m1bComputerCommand{
		ID: "90000000-0000-4000-8000-00000000027A", ExpiresAt: time.Now().Add(time.Hour),
		SessionID: selection.SessionID, SelectionID: selection.SelectionID,
		Request: m1bComputerRequest{Kind: "status"},
	}
	ctx, cancel := context.WithCancel(context.Background())
	begin := host.beginInput(link, selection, command, time.Now().Add(time.Minute), ctx, cancel, fixtureClaim(t, host, command.ID))
	if begin.work == nil {
		t.Fatalf("the control command was not admitted: %+v", begin)
	}
	if !host.cancel(strings.ToLower(command.ID), first) || begin.work.canceled || ctx.Err() != nil {
		t.Fatal("a cancel from an older socket generation affected the new one")
	}
	if !host.cancel(strings.ToLower(command.ID), second) || !begin.work.canceled || ctx.Err() == nil {
		t.Fatal("a cancel from the issuing socket generation was not applied")
	}
	if host.cancel("90000000-0000-4000-8000-000000000271", second) {
		t.Fatal("an unknown cancel was consumed")
	}
	host.finishInput(link, begin.work)
}

func TestComputerQuiesceWaitsForPendingResultPublication(t *testing.T) {
	credential := deviceFixtureCredential()
	selection := fixtureComputerSelection(credential)
	host := newM1BComputerHost(newFixtureComputerExecutor(selection))
	token := host.open()
	connection := &deviceConnection{ctx: context.Background()}
	link := &m1bComputerLink{connection: connection, host: host, token: token, ctx: context.Background()}
	host.mu.Lock()
	host.selectionBinding = selection.bindingKey()
	host.selectionHolder = fixtureHolder
	host.selectionHasHolder = true
	host.mu.Unlock()

	input := m1bComputerCommand{
		ID: "90000000-0000-4000-8000-000000000290", ExpiresAt: time.Now().Add(time.Hour),
		SessionID: selection.SessionID, SelectionID: selection.SelectionID, HolderID: fixtureHolder,
		Request: m1bComputerRequest{Kind: "act"},
	}
	inputCtx, inputCancel := context.WithCancel(context.Background())
	begin := host.beginInput(link, selection, input, time.Now().Add(time.Minute), inputCtx, inputCancel, fixtureClaim(t, host, input.ID))
	if begin.work == nil {
		t.Fatalf("the input was not admitted: %+v", begin)
	}
	if !host.finishInput(link, begin.work) {
		t.Fatal("the input was not current at terminal")
	}
	// The executor is terminal but the result publication gate is still open.
	busy := m1bComputerCommand{
		ID: "90000000-0000-4000-8000-000000000291", ExpiresAt: time.Now().Add(time.Hour),
		SessionID: selection.SessionID, SelectionID: selection.SelectionID,
		Request: m1bComputerRequest{Kind: "status"},
	}
	if next := host.beginInput(link, selection, busy, time.Now().Add(time.Minute), context.Background(), func() {}, fixtureClaim(t, host, busy.ID)); next.failure != "DEVICE_BUSY" {
		t.Fatalf("new input overlapped a pending publication: %+v", next)
	}
	quiesce := m1bComputerCommand{
		ID: "90000000-0000-4000-8000-000000000292", ExpiresAt: time.Now().Add(time.Hour),
		SessionID: selection.SessionID, SelectionID: selection.SelectionID, HolderID: fixtureHolder,
		Request: m1bComputerRequest{Kind: "quiesce"},
	}
	quiesceCtx, quiesceCancel := context.WithCancel(context.Background())
	quiesceBegin := host.beginQuiesce(link, selection, quiesce, time.Now().Add(time.Minute), quiesceCtx, quiesceCancel, fixtureClaim(t, host, quiesce.ID))
	if quiesceBegin.work == nil {
		t.Fatalf("the quiesce was not admitted: %+v", quiesceBegin)
	}
	if m1bClosed(quiesceBegin.oldDone) {
		t.Fatal("the quiesce did not wait for the pending publication")
	}
	host.finishPublication(begin.work)
	if !m1bClosed(quiesceBegin.oldDone) {
		t.Fatal("the publication gate did not close")
	}
	host.finishQuiesce(quiesceBegin.work)
}

func TestComputerBlockedWriteNeverPublishesAfterCancelOrDeadline(t *testing.T) {
	credential := deviceFixtureCredential()
	selection := fixtureComputerSelection(credential)
	for _, test := range []struct {
		name     string
		deadline bool
	}{
		{"cancel", false},
		{"deadline", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			fake := newFixtureComputerExecutor(selection)
			fake.observe(context.Background(), selection)
			host := newM1BComputerHost(fake)
			token := host.open()
			account, lease := deviceFixtureAccount(credential)
			connection := newDeviceConnection(nil, credential, account, lease)
			link := &m1bComputerLink{
				connection: connection, host: host, token: token, linkID: selection.LinkID, ctx: connection.ctx,
			}
			host.mu.Lock()
			host.selectionBinding = selection.bindingKey()
			host.selectionHolder = fixtureHolder
			host.selectionHasHolder = true
			host.mu.Unlock()

			started := make(chan struct{})
			var once sync.Once
			link.write = func(ctx context.Context, frame []byte) error {
				once.Do(func() { close(started) })
				select {
				case <-ctx.Done():
					return ctx.Err()
				default:
				}
				// A fresh socket-only timeout would keep this blocked long past
				// the work deadline; the work context must cancel it.
				<-ctx.Done()
				return ctx.Err()
			}
			workCtx, workCancel := context.WithCancel(context.Background())
			deadline := time.Now().Add(time.Minute)
			if test.deadline {
				workCtx, workCancel = context.WithTimeout(context.Background(), 500*time.Millisecond)
				deadline = time.Now().Add(500 * time.Millisecond)
			}
			command := m1bComputerCommand{
				ID: "90000000-0000-4000-8000-000000000295", ExpiresAt: time.Now().Add(time.Hour),
				SessionID: selection.SessionID, SelectionID: selection.SelectionID, HolderID: fixtureHolder,
				Request: m1bComputerRequest{Kind: "act"},
			}
			begin := host.beginInput(link, selection, command, deadline, workCtx, workCancel, fixtureClaim(t, host, command.ID))
			if begin.work == nil {
				t.Fatalf("the action was not admitted: %+v", begin)
			}
			request := m1bComputerRequest{Kind: "act", NativeCallID: "call-1", Act: &m1bComputerAct{
				Action: "click", ObservationID: "obs-1", Ref: "e1", TimeoutMS: 8000,
			}}
			go link.runInput(workCtx, workCancel, begin.work, selection, request)
			select {
			case <-started:
			case <-time.After(2 * time.Second):
				t.Fatal("the result write did not start")
			}
			start := time.Now()
			if !test.deadline {
				workCancel()
			}
			select {
			case <-begin.work.done:
			case <-time.After(3 * time.Second):
				t.Fatal("the blocked write outlived the work context")
			}
			if elapsed := time.Since(start); elapsed > 2*time.Second {
				t.Fatalf("the write was not bounded by the work context: %s", elapsed)
			}
		})
	}
}

func TestComputerQuiesceDoesNotAffectAnotherSelection(t *testing.T) {
	credential := deviceFixtureCredential()
	old := fixtureComputerSelection(credential)
	next := old
	next.SelectionID = "80000000-0000-4000-8000-000000000104"
	fake := newFixtureComputerExecutor(old)
	fake.observe(context.Background(), old)
	host := newM1BComputerHost(fake)
	token := host.open()
	account, lease := deviceFixtureAccount(credential)
	connection := newDeviceConnection(nil, credential, account, lease)
	link := &m1bComputerLink{
		connection: connection, host: host, token: token, linkID: old.LinkID, ctx: connection.ctx,
	}

	oldCommand := m1bComputerCommand{
		ID: "90000000-0000-4000-8000-000000000296", ExpiresAt: time.Now().Add(time.Hour),
		SessionID: old.SessionID, SelectionID: old.SelectionID, Request: m1bComputerRequest{Kind: "status"},
	}
	oldWork := host.beginInput(link, old, oldCommand, time.Now().Add(time.Minute), context.Background(), func() {}, fixtureClaim(t, host, oldCommand.ID))
	if oldWork.work == nil {
		t.Fatalf("the old selection's work was not admitted: %+v", oldWork)
	}

	// The host moves to a new selection while the old work is still active.
	fake.selectTarget(next)
	host.mu.Lock()
	host.selectionBinding = next.bindingKey()
	host.selectionHolder = fixtureHolder
	host.selectionHasHolder = true
	host.selectionClosed = false
	host.mu.Unlock()

	ackStarted := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	link.write = func(ctx context.Context, frame []byte) error {
		once.Do(func() { close(ackStarted) })
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	controlCtx, controlCancel := context.WithTimeout(context.Background(), 2*time.Second)
	quiesce := m1bComputerCommand{
		ID: "90000000-0000-4000-8000-000000000297", ExpiresAt: time.Now().Add(time.Hour),
		SessionID: next.SessionID, SelectionID: next.SelectionID, HolderID: fixtureHolder,
		Request: m1bComputerRequest{Kind: "quiesce"},
	}
	begin := host.beginQuiesce(link, next, quiesce, time.Now().Add(time.Minute), controlCtx, controlCancel, fixtureClaim(t, host, quiesce.ID))
	if begin.work == nil {
		t.Fatalf("the quiesce was not admitted: %+v", begin)
	}
	if !m1bClosed(begin.oldDone) {
		t.Fatal("the quiesce waited on a different selection's work")
	}
	host.mu.Lock()
	oldCanceled := oldWork.work.canceled
	host.mu.Unlock()
	if oldCanceled {
		t.Fatal("the quiesce canceled a different selection's work")
	}
	go link.runQuiesce(controlCtx, controlCancel, quiesce.ID, begin.oldTerminal, begin.oldDone, begin.work, next)
	select {
	case <-ackStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("the quiesce ack did not reach the write path")
	}
	// No new input enters while the control runs.
	busyCommand := m1bComputerCommand{
		ID: "90000000-0000-4000-8000-000000000298", ExpiresAt: time.Now().Add(time.Hour),
		SessionID: old.SessionID, SelectionID: old.SelectionID, Request: m1bComputerRequest{Kind: "status"},
	}
	if busy := host.beginInput(link, old, busyCommand, time.Now().Add(time.Minute), context.Background(), func() {}, fixtureClaim(t, host, busyCommand.ID)); busy.failure != "DEVICE_BUSY" {
		t.Fatalf("new input entered while control was running: %+v", busy)
	}
	close(release)
	select {
	case <-begin.work.done:
	case <-time.After(2 * time.Second):
		t.Fatal("the quiesce did not finish")
	}
	if _, _, invalidations := fake.snapshot(); invalidations != 0 {
		t.Fatalf("the quiesce invalidated a different selection's refs: %d", invalidations)
	}
	fake.mu.Lock()
	latestSelection := fake.latestSelection
	fake.mu.Unlock()
	if latestSelection != old.bindingKey() {
		t.Fatal("the other selection's latest refs were cleared")
	}
	host.finishInput(link, oldWork.work)
	host.finishPublication(oldWork.work)
}

func TestComputerQuiescedSelectionStaysClosedAcrossSelectionSwitch(t *testing.T) {
	credential := deviceFixtureCredential()
	first := fixtureComputerSelection(credential)
	second := first
	second.SelectionID = "80000000-0000-4000-8000-000000000105"
	firstNewLink := first
	firstNewLink.LinkID = fixtureLinkTwo
	fake := newFixtureComputerExecutor(first)
	host := newM1BComputerHost(fake)
	account, lease := deviceFixtureAccount(credential)
	connection := newDeviceConnection(nil, credential, account, lease)
	linkOne := &m1bComputerLink{connection: connection, host: host, token: host.open(), linkID: first.LinkID, ctx: connection.ctx}
	ctx := context.Background()

	observe := m1bComputerCommand{
		ID: "90000000-0000-4000-8000-000000000301", ExpiresAt: time.Now().Add(time.Hour),
		SessionID: first.SessionID, SelectionID: first.SelectionID, HolderID: fixtureHolder,
		Request: m1bComputerRequest{Kind: "observe"},
	}
	beginObserve := host.beginInput(linkOne, first, observe, time.Now().Add(time.Minute), ctx, func() {}, fixtureClaim(t, host, observe.ID))
	if beginObserve.work == nil {
		t.Fatalf("the first holder was not adopted: %+v", beginObserve)
	}
	host.finishInput(linkOne, beginObserve.work)
	host.finishPublication(beginObserve.work)

	quiesce := m1bComputerCommand{
		ID: "90000000-0000-4000-8000-000000000302", ExpiresAt: time.Now().Add(time.Hour),
		SessionID: first.SessionID, SelectionID: first.SelectionID, HolderID: fixtureHolder,
		Request: m1bComputerRequest{Kind: "quiesce"},
	}
	beginQuiesce := host.beginQuiesce(linkOne, first, quiesce, time.Now().Add(time.Minute), ctx, func() {}, fixtureClaim(t, host, quiesce.ID))
	if beginQuiesce.work == nil {
		t.Fatalf("the first selection was not quiesced: %+v", beginQuiesce)
	}
	host.finishQuiesce(beginQuiesce.work)

	fake.selectTarget(second)
	observeSecond := m1bComputerCommand{
		ID: "90000000-0000-4000-8000-000000000303", ExpiresAt: time.Now().Add(time.Hour),
		SessionID: second.SessionID, SelectionID: second.SelectionID, HolderID: fixtureHolderTwo,
		Request: m1bComputerRequest{Kind: "observe"},
	}
	beginSecond := host.beginInput(linkOne, second, observeSecond, time.Now().Add(time.Minute), ctx, func() {}, fixtureClaim(t, host, observeSecond.ID))
	if beginSecond.work == nil {
		t.Fatalf("the fresh selection was rejected: %+v", beginSecond)
	}
	host.finishInput(linkOne, beginSecond.work)
	host.finishPublication(beginSecond.work)

	// A -> B -> A with the same selection id stays closed.
	fake.selectTarget(first)
	reopen := m1bComputerCommand{
		ID: "90000000-0000-4000-8000-000000000304", ExpiresAt: time.Now().Add(time.Hour),
		SessionID: first.SessionID, SelectionID: first.SelectionID, HolderID: fixtureHolder,
		Request: m1bComputerRequest{Kind: "observe"},
	}
	if got := host.beginInput(linkOne, first, reopen, time.Now().Add(time.Minute), ctx, func() {}, fixtureClaim(t, host, reopen.ID)); got.failure != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("a quiesced selection reopened after A->B->A: %+v", got)
	}

	// The same owner+selection on a new link stays closed too.
	linkTwo := &m1bComputerLink{connection: connection, host: host, token: host.open(), linkID: firstNewLink.LinkID, ctx: connection.ctx}
	reopenNewLink := m1bComputerCommand{
		ID: "90000000-0000-4000-8000-000000000305", ExpiresAt: time.Now().Add(time.Hour),
		SessionID: firstNewLink.SessionID, SelectionID: firstNewLink.SelectionID, HolderID: fixtureHolder,
		Request: m1bComputerRequest{Kind: "observe"},
	}
	if got := host.beginInput(linkTwo, firstNewLink, reopenNewLink, time.Now().Add(time.Minute), ctx, func() {}, fixtureClaim(t, host, reopenNewLink.ID)); got.failure != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("a quiesced selection reopened on a new link: %+v", got)
	}

	// A current matching control can still quiesce the stopped binding.
	current := m1bComputerCommand{
		ID: "90000000-0000-4000-8000-000000000306", ExpiresAt: time.Now().Add(time.Hour),
		SessionID: first.SessionID, SelectionID: first.SelectionID, HolderID: fixtureHolder,
		Request: m1bComputerRequest{Kind: "quiesce"},
	}
	currentBegin := host.beginQuiesce(linkTwo, first, current, time.Now().Add(time.Minute), ctx, func() {}, fixtureClaim(t, host, current.ID))
	if currentBegin.work == nil {
		t.Fatalf("a current matching control could not quiesce the stopped binding: %+v", currentBegin)
	}
	host.finishQuiesce(currentBegin.work)

	wrongHolder := m1bComputerCommand{
		ID: "90000000-0000-4000-8000-000000000307", ExpiresAt: time.Now().Add(time.Hour),
		SessionID: first.SessionID, SelectionID: first.SelectionID, HolderID: fixtureHolderTwo,
		Request: m1bComputerRequest{Kind: "quiesce"},
	}
	if got := host.beginQuiesce(linkTwo, first, wrongHolder, time.Now().Add(time.Minute), ctx, func() {}, fixtureClaim(t, host, wrongHolder.ID)); got.failure != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("a wrong holder quiesced the stopped binding: %+v", got)
	}
}

func TestComputerCommandReceiptClaimedBeforeAuthorization(t *testing.T) {
	credential := deviceFixtureCredential()
	first := fixtureComputerSelection(credential)
	second := first
	second.SelectionID = "80000000-0000-4000-8000-000000000106"
	fake := newFixtureComputerExecutor(first)
	host := newM1BComputerHost(fake)
	server, sockets := newComputerFixtureServer(t, credential, fixtureReadyOperations, []string{fixtureLink})
	run := startComputerFixture(t, server, sockets, credential, host)

	sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000311", first, fixtureHolder, false, `{"kind":"observe"}`)

	// A correlated wrong-holder rejection spends the id.
	const wrongHolderID = "90000000-0000-4000-8000-000000000312"
	wrong := sendComputerCommand(t, run, wrongHolderID, first, fixtureHolderTwo, false,
		`{"kind":"act","native_call_id":"call-1","input":{"action":"click","observation_id":"obs-1","ref":"e1"}}`)
	if fixtureCommandError(wrong) != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("the wrong holder was not rejected: %+v", wrong)
	}
	before, actBefore, _ := fake.snapshot()
	if err := run.socket.send([]byte(computerCommandJSON(wrongHolderID, first, fixtureHolder, false, "2030-01-01T00:00:00Z",
		`{"kind":"act","native_call_id":"call-1","input":{"action":"click","observation_id":"obs-1","ref":"e1"}}`))); err != nil {
		t.Fatal(err)
	}
	expectNoComputerResults(t, run.socket, []string{wrongHolderID}, 200*time.Millisecond)
	if calls, acts, _ := fake.snapshot(); calls != before || acts != actBefore {
		t.Fatal("a rejected command id re-entered after authorization changed")
	}

	// A succeeded id is spent too, even under a new selection.
	const succeededID = "90000000-0000-4000-8000-000000000313"
	sendComputerCommand(t, run, succeededID, first, "", true, `{"kind":"status"}`)
	before, _, _ = fake.snapshot()
	fake.selectTarget(second)
	if err := run.socket.send([]byte(computerCommandJSON(succeededID, second, "", true, "2030-01-01T00:00:00Z", `{"kind":"status"}`))); err != nil {
		t.Fatal(err)
	}
	expectNoComputerResults(t, run.socket, []string{succeededID}, 200*time.Millisecond)
	if calls, _, _ := fake.snapshot(); calls != before {
		t.Fatal("a succeeded command id re-entered after the selection changed")
	}

	// A correlated wrong-binding rejection is spent after the binding matches.
	const wrongBindingID = "90000000-0000-4000-8000-000000000314"
	wrongBinding := sendComputerCommand(t, run, wrongBindingID, first, "", true, `{"kind":"status"}`)
	if fixtureCommandError(wrongBinding) != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("the wrong binding was not rejected: %+v", wrongBinding)
	}
	before, _, _ = fake.snapshot()
	fake.selectTarget(first)
	if err := run.socket.send([]byte(computerCommandJSON(wrongBindingID, first, "", true, "2030-01-01T00:00:00Z", `{"kind":"status"}`))); err != nil {
		t.Fatal(err)
	}
	expectNoComputerResults(t, run.socket, []string{wrongBindingID}, 200*time.Millisecond)
	if calls, _, _ := fake.snapshot(); calls != before {
		t.Fatal("a wrong-binding rejection re-entered after the selection changed")
	}

	// Receipt case is normalized; the result still echoes the accepted id.
	upper := "90000000-0000-4000-8000-00000000031A"
	sendComputerCommand(t, run, upper, first, "", true, `{"kind":"status"}`)
	before, _, _ = fake.snapshot()
	if err := run.socket.send([]byte(computerCommandJSON(strings.ToLower(upper), first, "", true, "2030-01-01T00:00:00Z", `{"kind":"status"}`))); err != nil {
		t.Fatal(err)
	}
	expectNoComputerResults(t, run.socket, []string{strings.ToLower(upper), upper}, 200*time.Millisecond)
	if calls, _, _ := fake.snapshot(); calls != before {
		t.Fatal("a case-variant replay was treated as a new receipt")
	}
}

func TestComputerHostGateNeverReleasesANewerConnection(t *testing.T) {
	credential := deviceFixtureCredential()
	host := newM1BComputerHost(newFixtureComputerExecutor(fixtureComputerSelection(credential)))
	first := host.open()
	second := host.open()
	host.release(first)
	host.mu.Lock()
	holder := host.holder
	host.mu.Unlock()
	if holder != second || host.current(first) {
		t.Fatalf("an old connection released the new holder: holder=%d first=%d second=%d", holder, first, second)
	}
	host.release(second)
	if host.current(second) {
		t.Fatal("the current holder was not released by its own token")
	}
}

func TestComputerSocketLossCancelsInFlightInput(t *testing.T) {
	credential := deviceFixtureCredential()
	selection := fixtureComputerSelection(credential)
	fake := newFixtureComputerExecutor(selection)
	terminal := make(chan struct{})
	fake.waitForCancellation(terminal)
	host := newM1BComputerHost(fake)
	server, sockets := newComputerFixtureServer(t, credential, fixtureReadyOperations, []string{fixtureLink})
	run := startComputerFixture(t, server, sockets, credential, host)

	sendComputerCommand(t, run, "90000000-0000-4000-8000-000000000280", selection, fixtureHolder, false, `{"kind":"observe"}`)
	const actID = "90000000-0000-4000-8000-000000000281"
	if err := run.socket.send([]byte(computerCommandJSON(actID, selection, fixtureHolder, false, "2030-01-01T00:00:00Z",
		`{"kind":"act","native_call_id":"call-1","input":{"action":"click","observation_id":"obs-1","ref":"e1"}}`))); err != nil {
		t.Fatal(err)
	}
	select {
	case <-fake.started:
	case <-time.After(5 * time.Second):
		t.Fatal("the action did not start")
	}
	run.socket.close()
	select {
	case <-fake.canceled:
	case <-time.After(5 * time.Second):
		t.Fatal("socket loss did not cancel the in-flight action")
	}
	close(terminal)
}

func TestComputerCommandShapeCapsUTF16AndNullTimeout(t *testing.T) {
	credential := deviceFixtureCredential()
	selection := fixtureComputerSelection(credential)
	payload := func(holder string, holderNull bool, request string) []byte {
		return []byte(computerCommandJSON("90000000-0000-4000-8000-000000000999", selection, holder, holderNull, "2030-01-01T00:00:00Z", request))
	}
	click := func(extra string) string {
		return `{"kind":"act","native_call_id":"call-1","input":{"action":"click","observation_id":"obs-1","ref":"e1"` + extra + `}}`
	}
	emoji := strings.Repeat("😀", 1)
	for _, test := range []struct {
		name  string
		raw   []byte
		valid bool
	}{
		{"status null holder", payload("", true, `{"kind":"status"}`), true},
		{"status uuid holder", payload(fixtureHolder, false, `{"kind":"status"}`), false},
		{"status missing holder", []byte(`{"type":"command","id":"90000000-0000-4000-8000-000000000999","owner_id":"` + selection.OwnerID + `","conversation_id":"` + selection.ConversationID + `","runtime_generation":"` + selection.RuntimeGeneration + `","turn_id":"` + selection.TurnID + `","expires_at":"2030-01-01T00:00:00Z","operation":"computer.execute","body":{"session_id":"` + selection.SessionID + `","selection_id":"` + selection.SelectionID + `","request":{"kind":"status"}}}`), false},
		{"observe null holder", payload("", true, `{"kind":"observe"}`), false},
		{"act null holder", payload("", true, click("")), false},
		{"quiesce null holder", payload("", true, `{"kind":"quiesce"}`), false},
		{"absent timeout default", payload(fixtureHolder, false, click("")), true},
		{"null timeout", payload(fixtureHolder, false, click(`,"timeout_ms":null`)), false},
		{"timeout below", payload(fixtureHolder, false, click(`,"timeout_ms":99`)), false},
		{"timeout above", payload(fixtureHolder, false, click(`,"timeout_ms":20001`)), false},
		{"timeout at limits", payload(fixtureHolder, false, click(`,"timeout_ms":20000`)), true},
		{"native id 240 units", payload(fixtureHolder, false, `{"kind":"act","native_call_id":"`+strings.Repeat(emoji, 120)+`","input":{"action":"click","observation_id":"obs-1","ref":"e1"}}`), true},
		{"native id 242 units", payload(fixtureHolder, false, `{"kind":"act","native_call_id":"`+strings.Repeat(emoji, 121)+`","input":{"action":"click","observation_id":"obs-1","ref":"e1"}}`), false},
		{"observation 120 units", payload(fixtureHolder, false, `{"kind":"act","native_call_id":"call-1","input":{"action":"click","observation_id":"`+strings.Repeat(emoji, 60)+`","ref":"e1"}}`), true},
		{"observation 122 units", payload(fixtureHolder, false, `{"kind":"act","native_call_id":"call-1","input":{"action":"click","observation_id":"`+strings.Repeat(emoji, 61)+`","ref":"e1"}}`), false},
		{"ref 200 units", payload(fixtureHolder, false, `{"kind":"act","native_call_id":"call-1","input":{"action":"click","observation_id":"obs-1","ref":"`+strings.Repeat(emoji, 100)+`"}}`), true},
		{"ref 202 units", payload(fixtureHolder, false, `{"kind":"act","native_call_id":"call-1","input":{"action":"click","observation_id":"obs-1","ref":"`+strings.Repeat(emoji, 101)+`"}}`), false},
		{"text 8000 units", payload(fixtureHolder, false, `{"kind":"act","native_call_id":"call-1","input":{"action":"type","observation_id":"obs-1","ref":"e1","text":"`+strings.Repeat("a", 8000)+`"}}`), true},
		{"text 8001 units", payload(fixtureHolder, false, `{"kind":"act","native_call_id":"call-1","input":{"action":"type","observation_id":"obs-1","ref":"e1","text":"`+strings.Repeat("a", 8001)+`"}}`), false},
		{"text 8192 bytes", payload(fixtureHolder, false, `{"kind":"act","native_call_id":"call-1","input":{"action":"type","observation_id":"obs-1","ref":"e1","text":"`+strings.Repeat("é", 4096)+`"}}`), true},
		{"text over 8192 bytes", payload(fixtureHolder, false, `{"kind":"act","native_call_id":"call-1","input":{"action":"type","observation_id":"obs-1","ref":"e1","text":"`+strings.Repeat("é", 4097)+`"}}`), false},
		{"app selector", payload(fixtureHolder, false, `{"kind":"act","native_call_id":"call-1","input":{"action":"click","observation_id":"obs-1","ref":"e1","app":"Finder"}}`), false},
		{"pid selector", payload(fixtureHolder, false, `{"kind":"act","native_call_id":"call-1","input":{"action":"click","observation_id":"obs-1","ref":"e1","pid":42}}`), false},
		{"unknown request field", payload(fixtureHolder, false, `{"kind":"status","args":{}}`), false},
		{"trailing document", append(payload("", true, `{"kind":"status"}`), []byte(`{}`)...), false},
		{"mixed case operation", []byte(strings.Replace(string(payload("", true, `{"kind":"status"}`)), `"operation":"computer.execute"`, `"operation":"COMPUTER.EXECUTE"`, 1)), false},
	} {
		t.Run(test.name, func(t *testing.T) {
			command, _, err := m1bComputerParseCommand(test.raw)
			if test.valid {
				if err != nil {
					t.Fatalf("a valid command was rejected: %v", err)
				}
				if command.Request.Kind == "act" && command.Request.Act != nil && command.Request.Act.TimeoutMS != m1bComputerDefaultTimeout && !strings.Contains(string(test.raw), "20000") {
					t.Fatalf("the default timeout was not applied: %d", command.Request.Act.TimeoutMS)
				}
			} else if err == nil {
				t.Fatal("an invalid command was accepted")
			}
		})
	}
}
