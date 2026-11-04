package main

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

type fakeDesktopEngine struct {
	executions, stops atomic.Int32
	block             atomic.Bool
}

func (e *fakeDesktopEngine) Execute(ctx context.Context, _ desktopRequest, _ string) toolResult {
	e.executions.Add(1)
	if e.block.Load() {
		<-ctx.Done()
		return failure("COMPUTER_USE_CANCELLED", "unknown")
	}
	return toolResult{OK: true, Data: &toolData{Text: "native wire contract"}}
}
func (e *fakeDesktopEngine) Stop() { e.stops.Add(1) }
func (e *fakeDesktopEngine) Permissions(context.Context) permissionState {
	return permissionState{"granted", "granted"}
}

func TestPairingNeverFollowsRedirectsOrAcceptsInvalidCredentials(t *testing.T) {
	var reached atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached.Add(1) }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer redirect.Close()
	if _, err := pairDevice(context.Background(), redirect.URL, string(make([]byte, 43)), "Test"); err == nil {
		t.Fatal("redirected pairing was accepted")
	}
	if reached.Load() != 0 {
		t.Fatal("pairing code followed a redirect")
	}
}

func TestCommandBoundaryRejectsForgedTargetsPlanWritesAndExpiredMessages(t *testing.T) {
	now := time.Now()
	device := "10000000-0000-4000-8000-000000000001"
	readOnly := true
	command := desktopCommand{
		Type: "command", ID: device, ConnectionID: device, DeviceID: device,
		ConversationID: device, TurnID: device, ReadOnly: &readOnly,
		ExpiresAt: now.Add(time.Minute).UnixMilli(),
		Request:   json.RawMessage(`{"action":"apps","device_id":"` + device + `"}`),
	}
	if _, err := validateCommand(command, device, now); err != nil {
		t.Fatal(err)
	}
	for _, input := range []string{
		`{"action":"click","device_id":"` + device + `","ref":"@s:e1"}`,
		`{"action":"apps","device_id":"` + device + `","text":"extra"}`,
		`{"action":"shell","device_id":"` + device + `"}`,
	} {
		command.Request = json.RawMessage(input)
		if _, err := validateCommand(command, device, now); err == nil {
			t.Fatal("unsafe command accepted")
		}
	}
	command.Request = json.RawMessage(`{"action":"apps","device_id":"` + device + `"}`)
	command.ExpiresAt = now.Add(-time.Second).UnixMilli()
	if _, err := validateCommand(command, device, now); err == nil {
		t.Fatal("expired command accepted")
	}
}

func TestSupersededDispatchCannotRequestApprovalOrChangeNewConnection(t *testing.T) {
	device := "10000000-0000-4000-8000-000000000001"
	readOnly := true
	command := desktopCommand{
		Type: "command", ID: device, ConnectionID: device, DeviceID: device,
		ConversationID: device, TurnID: device, ReadOnly: &readOnly,
		ExpiresAt: time.Now().Add(time.Minute).UnixMilli(),
		Request:   json.RawMessage(`{"action":"apps","device_id":"` + device + `"}`),
	}
	engine := &fakeDesktopEngine{}
	approvals := make(chan struct{}, 1)
	bridge := &desktopBridge{
		engine: engine, generation: 1, connectionID: device,
		onApprove: func(_ context.Context, _ desktopCommand, answer func(bool)) {
			approvals <- struct{}{}
			answer(true)
		},
	}
	bridge.onStatus = func(state bridgeStatus) {
		if state.Generation != 1 || state.Control != "running" {
			return
		}
		// Reconnect after reserving the command, before its worker starts.
		bridge.Disconnect()
		bridge.mu.Lock()
		bridge.connectionID, bridge.activeID = "new-connection", "new-command"
		bridge.paused = false
		bridge.mu.Unlock()
	}
	bridge.dispatch(context.Background(), nil, deviceCredentials{Device: pairedDevice{ID: device}}, 1, command)
	select {
	case <-approvals:
		t.Fatal("superseded command requested approval on the new connection")
	case <-time.After(100 * time.Millisecond):
	}
	bridge.mu.Lock()
	defer bridge.mu.Unlock()
	if bridge.awaiting || bridge.activeID != "new-command" || bridge.connectionID != "new-connection" || engine.executions.Load() != 0 {
		t.Fatal("superseded worker changed the new connection or executed an action")
	}
}

func TestSupersededControlMessagesCannotPauseOrStopNewConnection(t *testing.T) {
	for _, message := range []string{"pause", "cancel"} {
		t.Run(message, func(t *testing.T) {
			engine := &fakeDesktopEngine{}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			bridge := &desktopBridge{
				engine: engine, generation: 2, connectionID: "new-connection",
				active: cancel, activeID: "new-command", grant: taskGrant{contextID: "new-task"},
			}
			if message == "pause" {
				bridge.pauseConnection(1, nil)
			} else {
				bridge.cancelCommand(1, nil, "new-command")
			}
			if bridge.paused || bridge.grant.contextID != "new-task" || ctx.Err() != nil || engine.stops.Load() != 0 {
				t.Fatal("superseded control message paused, cancelled, or stopped the new task")
			}
		})
	}
}

func TestNativeClientAgainstRealFastifyPairingAndWebSocket(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	apiDir, err := filepath.Abs("../api")
	if err != nil {
		t.Fatal(err)
	}
	process := exec.CommandContext(ctx, "node", "--conditions=development", "--import", "tsx", "test/fixtures/computer-use-native.ts")
	process.Dir = apiDir
	process.Env = append(os.Environ(), "NODE_ENV=test", "I18NEXT_NO_SUPPORT_NOTICE=1")
	stdin, err := process.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := process.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := process.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = stdin.Close(); cancel(); _ = process.Wait() }()
	scanner := bufio.NewScanner(stdout)
	next := func(value any) {
		t.Helper()
		if !scanner.Scan() {
			t.Fatal("API fixture stopped")
		}
		if err := json.Unmarshal(scanner.Bytes(), value); err != nil {
			t.Fatal(err)
		}
	}
	var ready struct{ Origin, Code string }
	next(&ready)
	origin, err := url.Parse(ready.Origin)
	if err != nil {
		t.Fatal(err)
	}
	// Exercise a host outside the old allowlist while keeping traffic on loopback.
	origin.Host = net.JoinHostPort("::ffff:127.0.0.1", origin.Port())
	ready.Origin = origin.String()
	credential, err := pairDevice(ctx, ready.Origin, ready.Code, "Native whitebox")
	if err != nil {
		t.Fatal(err)
	}
	engine := &fakeDesktopEngine{}
	statuses := make(chan bridgeStatus, 30)
	var approvals atomic.Int32
	bridge := &desktopBridge{
		engine:    engine,
		onStatus:  func(state bridgeStatus) { statuses <- state },
		onApprove: func(_ context.Context, _ desktopCommand, answer func(bool)) { approvals.Add(1); answer(true) },
	}
	defer bridge.Disconnect()
	if err := bridge.Connect(ctx, credential); err != nil {
		t.Fatal(err)
	}
	for {
		select {
		case state := <-statuses:
			if state.Connected {
				goto connected
			}
		case <-ctx.Done():
			t.Fatal("client did not authenticate")
		}
	}
connected:
	rpc := func(command any, result any) {
		t.Helper()
		if err := json.NewEncoder(stdin).Encode(command); err != nil {
			t.Fatal(err)
		}
		next(result)
	}
	request := map[string]string{"action": "apps", "device_id": credential.Device.ID}
	waitControl := func(want string) {
		t.Helper()
		deadline := time.NewTimer(2 * time.Second)
		defer deadline.Stop()
		for {
			var state struct{ Control string }
			rpc(map[string]string{"type": "state"}, &state)
			if state.Control == want {
				return
			}
			select {
			case <-deadline.C:
				t.Fatalf("device did not enter %s", want)
			case <-time.After(10 * time.Millisecond):
			}
		}
	}
	var reply struct {
		Status int
		Result toolResult
	}
	rpc(map[string]any{"type": "execute", "input": request}, &reply)
	if reply.Status != 200 || !reply.Result.OK || engine.executions.Load() != 1 || approvals.Load() != 1 {
		t.Fatalf("wire contract did not execute: status=%d code=%s executions=%d approvals=%d",
			reply.Status, reply.Result.Code, engine.executions.Load(), approvals.Load())
	}
	// A completed command must not produce a stale cancel that revokes the task.
	time.Sleep(350 * time.Millisecond)
	rpc(map[string]any{"type": "execute", "input": request}, &reply)
	if !reply.Result.OK || engine.executions.Load() != 2 || approvals.Load() != 1 {
		t.Fatal("sequential successful commands did not retain the task grant")
	}
	engine.block.Store(true)
	bridge.mu.Lock()
	bridge.grant.expiresAt = time.Now().Add(2 * time.Second)
	bridge.mu.Unlock()
	start := time.Now()
	rpc(map[string]any{"type": "execute", "input": request}, &reply)
	engine.block.Store(false)
	if reply.Result.Code != "COMPUTER_USE_CANCELLED" || time.Since(start) > 4*time.Second {
		t.Fatal("an action continued past the local task consent expiry")
	}
	bridge.Pause()
	waitControl("paused")
	rpc(map[string]any{"type": "execute", "input": request}, &reply)
	if reply.Result.Code != "COMPUTER_USE_PAUSED" || engine.executions.Load() != 3 {
		t.Fatal("paused device executed a new action")
	}
	bridge.Resume()
	waitControl("ready")
	rpc(map[string]any{"type": "execute", "input": request}, &reply)
	if !reply.Result.OK || engine.executions.Load() != 4 || approvals.Load() != 2 {
		t.Fatal("resume reused an old task grant")
	}
	rpc(map[string]string{"type": "archive"}, &map[string]any{})
	rpc(map[string]any{"type": "execute", "input": request}, &reply)
	if reply.Status != 403 || engine.executions.Load() != 4 {
		t.Fatal("archived task retained control")
	}
	rpc(map[string]string{"type": "revoke"}, &map[string]any{})
	for {
		select {
		case state := <-statuses:
			if !state.Connected && state.Error != "" {
				if engine.stops.Load() == 0 {
					t.Fatal("revocation did not stop the engine")
				}
				return
			}
		case <-ctx.Done():
			t.Fatal("revocation did not disconnect")
		}
	}
}
