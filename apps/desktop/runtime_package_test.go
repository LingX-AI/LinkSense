//go:build desktop_runtime_package

package main

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// updateAdmissionProbeRuntime publishes the supervisor to the opt-in update
// admission whitebox while this real device turn runs. It is nil in a plain
// packaged smoke, whose probe is a no-op.
var updateAdmissionProbeRuntime atomic.Pointer[runtimeSupervisor]

func TestPackagedRuntimeSupervisor(t *testing.T) {
	runtimeRoot := os.Getenv("LINKSENSE_DESKTOP_RUNTIME_DIST")
	if !filepath.IsAbs(runtimeRoot) {
		t.Fatal("LINKSENSE_DESKTOP_RUNTIME_DIST must select a packaged runtime")
	}
	runtime := superviseRuntime(filepath.Join(t.TempDir(), "local-runtime"), runtimeRoot, "")
	t.Cleanup(runtime.close)
	deadline := time.Now().Add(25 * time.Second)
	for !runtime.ready.Load() && time.Now().Before(deadline) {
		select {
		case <-runtime.done:
			t.Fatal("packaged runtime did not start")
		case <-time.After(50 * time.Millisecond):
		}
	}
	if !runtime.ready.Load() {
		t.Fatal("packaged runtime readiness timed out")
	}
	select {
	case <-runtime.done:
		t.Fatal("packaged runtime stopped after readiness")
	case <-time.After(runtimeHealthTimeout + time.Second):
		if !runtime.ready.Load() {
			t.Fatal("packaged runtime did not remain healthy through a heartbeat timeout window")
		}
	}
	runtime.close()
	if runtime.ready.Load() {
		t.Fatal("runtime remained ready after quitting")
	}
}

// The model is the only fixture in the native execution path. The Go WebSocket,
// control pipe, worker, sandbox, outbox and Codex are production implementations.
func TestPackagedDesktopDeviceTurn(t *testing.T) {
	runtimeRoot := os.Getenv("LINKSENSE_DESKTOP_RUNTIME_DIST")
	if !filepath.IsAbs(runtimeRoot) {
		t.Fatal("LINKSENSE_DESKTOP_RUNTIME_DIST must select a packaged runtime")
	}
	credential := deviceFixtureCredential()
	const (
		conversationID = "40000000-0000-4000-8000-000000000001"
		generation     = "50000000-0000-4000-8000-000000000001"
		turnID         = "60000000-0000-4000-8000-000000000001"
		connectionID   = "70000000-0000-4000-8000-000000000001"
		startID        = "80000000-0000-4000-8000-000000000001"
		inspectID      = "80000000-0000-4000-8000-000000000002"
		interruptID    = "80000000-0000-4000-8000-000000000003"
		deniedID       = "80000000-0000-4000-8000-000000000004"
		reconnectID    = "70000000-0000-4000-8000-000000000002"
		reinspectID    = "80000000-0000-4000-8000-000000000005"
		duplicateID    = "80000000-0000-4000-8000-000000000006"
		drainID        = "80000000-0000-4000-8000-000000000007"
		emptyDrainID   = "80000000-0000-4000-8000-000000000008"
		siblingID      = "40000000-0000-4000-8000-000000000003"
	)
	modelToken := "lsdm_" + strings.Repeat("a", 43)
	runToken := "lsdr_" + strings.Repeat("b", 43)
	dataRoot := filepath.Join(t.TempDir(), "local-runtime")
	sessionRoot := filepath.Join(dataRoot, credential.OwnerID, "services", conversationID)
	workspace := filepath.Join(sessionRoot, "home", "workspace")
	if err := os.MkdirAll(workspace, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "fixture.txt"), []byte("MAC_DEVICE_READ_OK\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	control := filepath.Join(sessionRoot, "control")
	if err := os.MkdirAll(control, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(control, "fixture.txt"), []byte("MAC_DEVICE_PRIVATE_FIXTURE\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	sibling := filepath.Join(filepath.Dir(sessionRoot), siblingID, "home", "workspace")
	if err := os.MkdirAll(sibling, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sibling, "fixture.txt"), []byte("MAC_DEVICE_OTHER_WORKSPACE\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	networkFixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("sandboxed shell reached the network fixture")
		w.WriteHeader(http.StatusNoContent)
	}))
	defer networkFixture.Close()
	_, port, err := net.SplitHostPort(strings.TrimPrefix(networkFixture.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	siblingFile := "../../../" + siblingID + "/home/workspace/fixture.txt"
	automationScript := `tell application "System Events" to get name`
	// Exercise upgrading the old empty capability layout in place.
	for _, name := range []string{"skills", "plugins", "plugin-sources"} {
		if err := os.MkdirAll(filepath.Join(sessionRoot, "managed", "agents", name), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	// Exact fixture rules exercise both the normal sandbox and its denied paths.
	rules := filepath.Join(filepath.Dir(workspace), ".codex", "rules")
	if err := os.MkdirAll(rules, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rules, "default.rules"),
		[]byte("prefix_rule(pattern=[\"cat\", \"fixture.txt\"], decision=\"allow\")\n"+
			"prefix_rule(pattern=[\"touch\", \"../sandbox-denied.txt\"], decision=\"allow\")\n"+
			"prefix_rule(pattern=[\"cat\", \"../../control/fixture.txt\"], decision=\"allow\")\n"+
			"prefix_rule(pattern=[\"cat\", "+strconv.Quote(siblingFile)+"], decision=\"allow\")\n"+
			"prefix_rule(pattern=[\"/usr/bin/curl\", \"--max-time\", \"2\", "+strconv.Quote(networkFixture.URL)+"], decision=\"allow\")\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	type callback struct {
		Type         string `json:"type"`
		ID           string `json:"id"`
		Operation    string `json:"operation"`
		TurnID       string `json:"turn_id"`
		Conversation string `json:"conversation_id"`
		Generation   string `json:"runtime_generation"`
		RunToken     string `json:"run_token"`
		DrainID      string `json:"drain_id"`
		Body         struct {
			Events []struct {
				DeliveryID string `json:"deliveryId"`
				Event      struct {
					Method string `json:"method"`
					Params struct {
						Turn struct {
							Status string `json:"status"`
						} `json:"turn"`
					} `json:"params"`
				} `json:"event"`
			} `json:"events"`
		} `json:"body"`
	}
	modelWaiting := make(chan struct{})
	modelAborted := make(chan struct{})
	done := make(chan struct{})
	var connections atomic.Int32
	var modelCalls atomic.Int32
	modelRejected := make(chan struct{}, 1)
	rejectModel := func(w http.ResponseWriter, message string, code int) {
		t.Error(message)
		select {
		case modelRejected <- struct{}{}:
		default:
		}
		w.WriteHeader(code)
	}
	var state struct {
		sync.Mutex
		terminalDelivery string
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/desktop/models/"+turnID+"/primary/responses" {
			serveFixtureModel(t, w, r, modelToken, turnID, &modelCalls, func(call int, input string) fixtureModelDirective {
				switch call {
				case 1:
					return fixtureModelDirective{command: "cat fixture.txt"}
				case 2:
					if !strings.Contains(input, "MAC_DEVICE_READ_OK") {
						return fixtureModelDirective{reject: "native Codex did not read the workspace file"}
					}
					return fixtureModelDirective{command: "touch unapproved.txt"}
				case 3:
					if !strings.Contains(input, "approval request failed") {
						return fixtureModelDirective{reject: "native Codex did not reject the unapproved command"}
					}
					return fixtureModelDirective{command: "touch ../sandbox-denied.txt"}
				case 4:
					if !strings.Contains(input, "Operation not permitted") {
						return fixtureModelDirective{reject: "native sandbox did not deny a preapproved out-of-workspace write"}
					}
					return fixtureModelDirective{command: "cat ../../control/fixture.txt"}
				case 5:
					if !strings.Contains(input, "Operation not permitted") ||
						strings.Contains(input, "MAC_DEVICE_PRIVATE_FIXTURE") {
						return fixtureModelDirective{reject: "private control data reached inference"}
					}
					return fixtureModelDirective{command: "cat " + siblingFile}
				case 6:
					if !strings.Contains(input, "Operation not permitted") ||
						strings.Contains(input, "MAC_DEVICE_OTHER_WORKSPACE") {
						return fixtureModelDirective{reject: "the sibling workspace was not denied"}
					}
					return fixtureModelDirective{command: "/usr/bin/curl --max-time 2 " + networkFixture.URL}
				case 7:
					if !strings.Contains(input, "curl: (7)") || !strings.Contains(input, port) {
						t.Errorf("network probe diagnostics: curl=%t denied=%t approval=%t",
							strings.Contains(input, "curl:"), strings.Contains(input, "Operation not permitted"),
							strings.Contains(input, "approval request failed"))
						return fixtureModelDirective{reject: "the sandboxed network probe did not report a connection failure"}
					}
					return fixtureModelDirective{command: "/usr/bin/osascript -e '" + automationScript + "'"}
				case 8:
					if !strings.Contains(input, "approval request failed") {
						return fixtureModelDirective{reject: "direct system automation was not denied"}
					}
					return fixtureModelDirective{hold: func(ctx context.Context) {
						// The turn is in flight here; the opt-in whitebox asks the
						// native gate and the packaged runner for admission.
						probeUpdateAdmissionDuringTurn(t)
						close(modelWaiting)
						select {
						case <-ctx.Done():
							close(modelAborted)
						case <-done:
						case <-time.After(8 * time.Second):
							t.Error("native interruption did not cancel inference")
						}
					}}
				default:
					return fixtureModelDirective{reject: "the device replayed input after interruption"}
				}
			}, func(message string, status int) {
				rejectModel(w, message, status)
			})
			return
		}
		if r.URL.Path != "/api/v1/desktop/devices/socket" || r.Header.Get(desktopExecutionHeader) != strconv.Itoa(desktopExecutionVersion) {
			t.Error("desktop did not negotiate the device channel")
			w.WriteHeader(404)
			return
		}
		connection := connections.Add(1)
		if connection == 2 {
			defer close(done)
		} else if connection != 1 {
			rejectModel(w, "unexpected extra device connection", http.StatusBadRequest)
			return
		}
		linkID := connectionID
		if connection == 2 {
			linkID = reconnectID
		}
		socket, ok := acceptFixtureDeviceSocket(t, w, r, credential, linkID, 25*time.Second)
		if !ok {
			return
		}
		defer socket.close()
		send := func(value any) bool {
			if !socket.send(value) {
				t.Error("test device frame was not sent")
				return false
			}
			return true
		}
		command := func(id, operation string) map[string]any {
			return map[string]any{"type": "command", "operation": operation, "id": id, "owner_id": credential.OwnerID,
				"conversation_id": conversationID, "runtime_generation": generation, "turn_id": turnID,
				"expires_at": time.Now().Add(45 * time.Second).UTC().Format(time.RFC3339Nano)}
		}
		start := command(startID, "turn.start")
		start["body"] = map[string]any{
			"native_thread_id": nil, "input": "Read the sample file using the workspace.", "reasoning_effort": "low",
			"credentials": map[string]any{"turn_id": turnID, "run_token": runToken,
				"expires_at": time.Now().Add(2 * time.Minute).UTC().Format(time.RFC3339Nano),
				"primary":    map[string]any{"purpose": "primary", "model": "gpt-5.4", "revision": 1, "protocol_mode": "native_responses", "token": modelToken}},
		}
		if connection == 1 {
			denied := command(deniedID, "turn.inspect")
			denied["owner_id"] = "40000000-0000-4000-8000-000000000002"
			if !send(denied) || !send(start) {
				return
			}
			go func() {
				select {
				case <-socket.done():
				case <-modelWaiting:
					send(command(inspectID, "turn.inspect"))
					send(command(interruptID, "turn.interrupt"))
				}
			}()
		} else {
			start["id"] = duplicateID
			if !send(command(reinspectID, "turn.inspect")) {
				return
			}
		}
		var startSeen, inspectSeen, interruptSeen, interrupted, commandSeen, foreignDenied, drainSent, drained, recovered, emptyDrainSent bool
		for {
			response, ok := socket.receive()
			if !ok {
				t.Errorf("execution channel ended before its full result: start=%t inspect=%t interrupt=%t terminal=%t command=%t",
					startSeen, inspectSeen, interruptSeen, interrupted, commandSeen)
				return
			}
			switch response.Type {
			case "command.result":
				if response.ID == deniedID {
					foreignDenied = !response.OK && response.ErrorCode == "FORBIDDEN"
					if !foreignDenied {
						t.Error("the device accepted a command for a different owner")
						return
					}
					continue
				}
				if !response.OK {
					t.Errorf("command %s failed: %s", response.ID, response.ErrorCode)
					return
				}
				switch response.ID {
				case startID, duplicateID:
					startSeen = response.Result.Status == "starting" || response.Result.Status == "succeeded"
				case inspectID:
					inspectSeen = response.Result.Status == "succeeded" || response.Result.Status == "starting"
				case reinspectID:
					inspectSeen = response.Result.Status == "succeeded"
					if !inspectSeen {
						t.Error("read-only recovery did not settle the accepted native turn")
						return
					}
					if !send(start) {
						return
					}
				case interruptID:
					interruptSeen = response.Result.Code == "TURN_INTERRUPT_REQUESTED"
				case drainID:
					drained = response.Result.Drained
				case emptyDrainID:
					if !response.Result.Drained || !validUUID(response.Result.Terminal.CodexThreadID) ||
						!validUUID(response.Result.Terminal.Turn.ID) || response.Result.Terminal.Turn.Status != "interrupted" {
						t.Error("empty outbox did not return the proven native terminal outcome")
					}
					return
				}
			case "execution.callback", "execution.recovery":
				reported := response
				if reported.Conversation != conversationID ||
					reported.Generation != generation || reported.TurnID != turnID ||
					(connection == 1 && (reported.Type != "execution.callback" || reported.RunToken != runToken)) ||
					(connection == 2 && (reported.Type != "execution.recovery" || reported.RunToken != "" || reported.DrainID != drainID)) {
					t.Error("callback did not carry its scoped lease")
					return
				}
				if reported.Operation == "events" {
					for _, entry := range reported.Body.Events {
						if entry.Event.Method == "turn/completed" && entry.Event.Params.Turn.Status == "interrupted" {
							interrupted = true
							state.Lock()
							if connection == 1 {
								state.terminalDelivery = entry.DeliveryID
							} else {
								recovered = entry.DeliveryID == state.terminalDelivery
							}
							state.Unlock()
						}
					}
					commandSeen = commandSeen || (strings.Contains(string(reported.Raw), `"type":"commandExecution"`) && strings.Contains(string(reported.Raw), "fixture.txt"))
					if connection == 1 && interrupted {
						break // Deliberately lose the terminal ACK.
					}
					send(map[string]any{"type": "execution.ack", "id": reported.ID, "operation": reported.Operation, "ok": true,
						"data": reported.acknowledgement()})
				} else if reported.Operation == "start.settled" {
					send(map[string]any{"type": "execution.ack", "id": reported.ID, "operation": reported.Operation, "ok": true,
						"data": reported.acknowledgement()})
				} else {
					t.Error("device used an unapproved callback operation")
					return
				}
			default:
				t.Error("device sent an unapproved frame")
				return
			}
			if connection == 1 && startSeen && inspectSeen && interruptSeen && interrupted && commandSeen && foreignDenied {
				// Leave the durable native correlation and outbox, but simulate
				// losing the API-facing start receipt before its publication.
				journal := filepath.Join(control, "workspaces", conversationID, "start-operations", turnID+".json")
				raw, err := os.ReadFile(journal)
				var persisted map[string]json.RawMessage
				if err != nil || json.Unmarshal(raw, &persisted) != nil ||
					string(persisted["status"]) != `"succeeded"` || len(persisted["correlation"]) == 0 {
					t.Error("could not stage the interrupted start receipt fixture")
					return
				}
				persisted["status"] = json.RawMessage(`"starting"`)
				delete(persisted, "result")
				raw, err = json.Marshal(persisted)
				if err != nil || os.WriteFile(journal+".fixture.tmp", raw, 0o600) != nil || os.Rename(journal+".fixture.tmp", journal) != nil {
					t.Error("could not publish the interrupted start receipt fixture")
				}
				return
			}
			if connection == 2 && startSeen && inspectSeen && !drainSent {
				drainSent = send(command(drainID, "turn.drain"))
				if !drainSent {
					return
				}
			}
			if connection == 2 && drained && recovered && !emptyDrainSent {
				// The same on-disk state results when a writer exits before its terminal append.
				emptyDrainSent = send(command(emptyDrainID, "turn.drain"))
				if !emptyDrainSent {
					return
				}
			}
		}
	}))
	defer server.Close()
	origin, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	runtime := superviseRuntime(dataRoot, runtimeRoot, origin.String())
	updateAdmissionProbeRuntime.Store(runtime)
	defer runtime.close()
	readiness := time.Now().Add(30 * time.Second)
	for !runtime.ready.Load() && time.Now().Before(readiness) {
		time.Sleep(50 * time.Millisecond)
	}
	if !runtime.ready.Load() {
		t.Fatal("bundled runtime did not become ready")
	}
	device := newFixtureDeviceConnection(t, origin, credential)
	device.runtime = runtime
	go device.run()
	defer func() { device.cancel(); waitDeviceDone(t, device) }()
	// The negotiated current connection must expose execution readiness; a turn
	// below runs exactly on this link.
	ready := time.Now().Add(10 * time.Second)
	for !device.Status().ExecutionReady && time.Now().Before(ready) {
		select {
		case <-device.done:
			t.Fatalf("device bridge stopped before execution readiness: %s", device.Status().ErrorCode)
		case <-time.After(20 * time.Millisecond):
		}
	}
	if !device.Status().ExecutionReady {
		t.Fatal("the negotiated runtime link was not reported as execution ready")
	}
	select {
	case <-done:
	case <-modelRejected:
		t.Fatal("model fixture rejected a request")
	case <-time.After(50 * time.Second):
		t.Fatal("native device channel fixture timed out")
	}
	select {
	case <-modelAborted:
	case <-time.After(2 * time.Second):
		t.Fatal("native interruption did not close the model request")
	}
	for _, denied := range []string{filepath.Join(workspace, "unapproved.txt"), filepath.Join(workspace, "..", "sandbox-denied.txt")} {
		if _, err := os.Lstat(denied); !os.IsNotExist(err) {
			t.Fatal("a denied write reached the filesystem")
		}
	}
}

func streamFixtureResponses(w http.ResponseWriter, item map[string]any) {
	w.Header().Set("Content-Type", "text/event-stream")
	id := "resp-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	for _, frame := range []map[string]any{
		{"type": "response.created", "response": map[string]any{"id": id, "status": "in_progress", "output": []any{}}},
		{"type": "response.output_item.added", "output_index": 0, "item": item},
		{"type": "response.output_item.done", "output_index": 0, "item": item},
		{"type": "response.completed", "response": map[string]any{"id": id, "status": "completed", "output": []any{item},
			"usage": map[string]int{"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}}},
	} {
		raw, _ := json.Marshal(frame)
		_, _ = w.Write(append(append([]byte("data: "), raw...), '\n', '\n'))
	}
}
