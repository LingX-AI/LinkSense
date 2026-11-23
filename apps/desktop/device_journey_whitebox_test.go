//go:build desktop_whitebox

package main

// Whitebox of the P1-10 settings -> pair -> execution-ready -> local/cloud task
// journey. The real shared Web UI runs in the main-window WKWebView, the
// production bridge performs pairing/resume over a real WebSocket, and a
// test-only supervised pipe stands in for the local runtime process.
//
// It compiles against this archive's baseline production code. The assertions
// that depend on the P1-10 device/target/execution-ready slices only pass once
// those production changes are overlaid; none of them is stubbed here.
//
// The only hook outside this file is one inert call at the top of whiteboxAPI
// in native_whitebox_test.go:
//
//	if serveDeviceJourneyWhitebox(w, r) { return }
//
// The fixture is installed only for the duration of this test, so every other
// whitebox test keeps the legacy fixture server unchanged.

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/egoist/mygo"
)

const (
	deviceJourneyPairingCode           = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	deviceJourneyConnectionID          = "30000000-0000-4000-8000-0000000000a1"
	deviceJourneyPrewarmConversationID = "90000000-0000-4000-8000-000000000001"
	deviceJourneyTurnID                = "c0000000-0000-4000-8000-000000000001"
	deviceJourneyAccessToken           = "browser-test-access-token-0000000000000000"
	deviceJourneyPairName              = "Work laptop"
	deviceJourneyFixtureTime           = "2026-07-11T08:00:00Z"
)

// deviceJourneyWhitebox is the narrow dispatch hook shared with whiteboxAPI.
var deviceJourneyWhitebox atomic.Pointer[deviceJourneyFixture]

func serveDeviceJourneyWhitebox(w http.ResponseWriter, r *http.Request) bool {
	fixture := deviceJourneyWhitebox.Load()
	return fixture != nil && fixture.serve(w, r)
}

type deviceJourneyPairingCall struct {
	method string
	body   string
}

type deviceJourneyPairCall struct {
	code         string
	name         string
	platform     string
	arch         string
	appVersion   string
	capabilities map[string]any
}

type deviceJourneyCreateCall struct {
	id   string
	raw  string
	body map[string]any
}

type deviceJourneyHello struct {
	token     string
	execution string
}

type deviceJourneyFixture struct {
	mu        sync.Mutex
	closed    bool
	done      chan struct{}
	sockets   map[*websocket.Conn]struct{}
	pairings  []deviceJourneyPairingCall
	pairs     []deviceJourneyPairCall
	creates   []deviceJourneyCreateCall
	prewarms  []map[string]any
	hellos    []deviceJourneyHello
	conversa  map[string]map[string]any
	pairState struct {
		name, platform, arch, appVersion string
	}

	// execution makes the fake API negotiate execution protocol v2. reject and
	// revoked model a lost socket and a server-side credential revocation.
	execution atomic.Bool
	reject    atomic.Bool
	revoked   atomic.Bool
}

func newDeviceJourneyFixture() *deviceJourneyFixture {
	return &deviceJourneyFixture{
		done:     make(chan struct{}),
		sockets:  map[*websocket.Conn]struct{}{},
		conversa: map[string]map[string]any{},
	}
}

func (f *deviceJourneyFixture) serve(w http.ResponseWriter, r *http.Request) bool {
	switch {
	case r.URL.Path == "/api/v1/desktop/devices/socket":
		f.serveSocket(w, r)
		return true
	case r.URL.Path == "/api/v1/desktop/devices/pairing":
		f.servePairing(w, r)
		return true
	case r.URL.Path == "/api/v1/desktop/devices/pair":
		f.servePair(w, r)
		return true
	case r.URL.Path == "/api/v1/desktop/devices":
		f.serveDeviceList(w, r)
		return true
	case r.URL.Path == "/api/v1/me/model-preference":
		f.serveModelPreference(w, r)
		return true
	case r.URL.Path == "/api/v1/conversations" || strings.HasPrefix(r.URL.Path, "/api/v1/conversations/"):
		f.serveConversations(w, r)
		return true
	}
	return false
}

func (f *deviceJourneyFixture) writeHeaders(w http.ResponseWriter, r *http.Request) bool {
	protocol := fmt.Sprint(nativeWhitebox.protocol.Load())
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("x-linksense-build", strings.Repeat("b", 64))
	w.Header().Set("x-linksense-desktop-protocol", protocol)
	requestProtocol := r.Header.Get("x-linksense-desktop-protocol")
	if requestProtocol == "" {
		w.Header().Set("x-linksense-build", r.Header.Get("x-linksense-client-build"))
		return true
	}
	if requestProtocol != protocol || r.Header.Get("x-linksense-client-build") != strings.Repeat("0", 64) {
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]any{"success": false, "error_code": "DESKTOP_UPDATE_REQUIRED"})
		return false
	}
	return true
}

func (f *deviceJourneyFixture) writeData(w http.ResponseWriter, r *http.Request, data any) {
	if !f.writeHeaders(w, r) {
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": data})
}

func (f *deviceJourneyFixture) writeError(w http.ResponseWriter, r *http.Request, status int, code string) {
	if !f.writeHeaders(w, r) {
		return
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"success": false, "error_code": code})
}

func deviceJourneyAuthorized(r *http.Request) bool {
	return r.Header.Get("Authorization") == "Bearer "+deviceJourneyAccessToken
}

func (f *deviceJourneyFixture) servePairing(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		f.writeError(w, r, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED")
		return
	}
	if !deviceJourneyAuthorized(r) {
		f.writeError(w, r, http.StatusUnauthorized, "AUTH_REQUIRED")
		return
	}
	raw, _ := io.ReadAll(io.LimitReader(r.Body, 4096))
	var body map[string]any
	_ = json.Unmarshal(raw, &body)
	f.mu.Lock()
	f.pairings = append(f.pairings, deviceJourneyPairingCall{method: r.Method, body: string(raw)})
	f.mu.Unlock()
	if len(body) != 0 {
		f.writeError(w, r, http.StatusUnprocessableEntity, "VALIDATION_ERROR")
		return
	}
	f.writeData(w, r, map[string]any{
		"code":       deviceJourneyPairingCode,
		"expires_at": time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339),
	})
}

func (f *deviceJourneyFixture) servePair(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		f.writeError(w, r, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED")
		return
	}
	raw, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	var input struct {
		Code         string         `json:"code"`
		Name         string         `json:"name"`
		Platform     string         `json:"platform"`
		Arch         string         `json:"arch"`
		AppVersion   string         `json:"app_version"`
		Capabilities map[string]any `json:"capabilities"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil {
		f.writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR")
		return
	}
	f.mu.Lock()
	f.pairs = append(f.pairs, deviceJourneyPairCall{
		code: input.Code, name: input.Name, platform: input.Platform, arch: input.Arch,
		appVersion: input.AppVersion, capabilities: input.Capabilities,
	})
	if input.Code == deviceJourneyPairingCode {
		f.pairState.name = input.Name
		f.pairState.platform = input.Platform
		f.pairState.arch = input.Arch
		f.pairState.appVersion = input.AppVersion
	}
	f.mu.Unlock()
	if input.Code != deviceJourneyPairingCode {
		f.writeError(w, r, http.StatusUnauthorized, "AUTH_REQUIRED")
		return
	}
	credential := deviceFixtureCredential()
	f.writeData(w, r, map[string]any{
		"token":    credential.Token,
		"owner_id": credential.OwnerID,
		"device": map[string]any{
			"id":           credential.DeviceID,
			"name":         input.Name,
			"platform":     input.Platform,
			"arch":         input.Arch,
			"app_version":  input.AppVersion,
			"capabilities": map[string]any{"local_execution": false, "browser_extension": false, "computer_use": false},
			"online":       true,
			"last_seen_at": deviceJourneyFixtureTime,
			"revoked_at":   nil,
			"created_at":   deviceJourneyFixtureTime,
			"updated_at":   deviceJourneyFixtureTime,
		},
	})
}

func (f *deviceJourneyFixture) serveDeviceList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		f.writeError(w, r, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED")
		return
	}
	if !deviceJourneyAuthorized(r) {
		f.writeError(w, r, http.StatusUnauthorized, "AUTH_REQUIRED")
		return
	}
	f.mu.Lock()
	name, platform, arch, version := f.pairState.name, f.pairState.platform, f.pairState.arch, f.pairState.appVersion
	online := len(f.sockets) > 0 && !f.revoked.Load() && !f.reject.Load()
	f.mu.Unlock()
	items := []any{}
	if name != "" {
		lastSeen := any(nil)
		if online {
			lastSeen = deviceJourneyFixtureTime
		}
		credential := deviceFixtureCredential()
		items = append(items, map[string]any{
			"id":           credential.DeviceID,
			"name":         name,
			"platform":     platform,
			"arch":         arch,
			"app_version":  version,
			"capabilities": map[string]any{"local_execution": false, "browser_extension": false, "computer_use": false},
			"online":       online,
			"last_seen_at": lastSeen,
			"revoked_at":   nil,
			"created_at":   deviceJourneyFixtureTime,
			"updated_at":   deviceJourneyFixtureTime,
		})
	}
	f.writeData(w, r, map[string]any{"items": items})
}

// serveModelPreference keeps the composer's send control enabled: a real Mac
// session has a configured model, and without it the shared UI disables every
// submission before the target logic runs.
func (f *deviceJourneyFixture) serveModelPreference(w http.ResponseWriter, r *http.Request) {
	if !deviceJourneyAuthorized(r) {
		f.writeError(w, r, http.StatusUnauthorized, "AUTH_REQUIRED")
		return
	}
	f.writeData(w, r, map[string]any{
		"configured": true,
		"models": []any{map[string]any{
			"id": "fixture-model", "display_name": "Fixture Model", "enabled": true,
			"context_window":              nil,
			"supported_reasoning_efforts": []any{"medium", "high"},
			"default_reasoning_effort":    "medium",
		}},
		"default_model":             "fixture-model",
		"selected_model":            "fixture-model",
		"selected_reasoning_effort": "medium",
	})
}

func (f *deviceJourneyFixture) serveConversations(w http.ResponseWriter, r *http.Request) {
	if !deviceJourneyAuthorized(r) {
		f.writeError(w, r, http.StatusUnauthorized, "AUTH_REQUIRED")
		return
	}
	switch {
	case r.URL.Path == "/api/v1/conversations/prewarm":
		if r.Method != http.MethodPost {
			f.writeError(w, r, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED")
			return
		}
		raw, _ := io.ReadAll(io.LimitReader(r.Body, 16<<10))
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		f.mu.Lock()
		f.prewarms = append(f.prewarms, body)
		f.mu.Unlock()
		f.writeData(w, r, map[string]any{
			"accepted":        true,
			"conversation_id": deviceJourneyPrewarmConversationID,
		})
		return
	case r.URL.Path == "/api/v1/conversations":
		if r.Method == http.MethodGet {
			f.writeData(w, r, map[string]any{"items": []any{}, "next_cursor": nil})
			return
		}
		if r.Method != http.MethodPost {
			f.writeError(w, r, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED")
			return
		}
		f.serveConversationCreate(w, r)
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/api/v1/conversations/")
	parts := strings.Split(rest, "/")
	if len(parts) == 2 && parts[1] == "model-preference" {
		f.serveModelPreference(w, r)
		return
	}
	if len(parts) == 2 && parts[1] == "turns" && r.Method == http.MethodPost {
		_, _ = io.Copy(io.Discard, io.LimitReader(r.Body, 64<<10))
		f.writeData(w, r, map[string]any{
			"turn_id":  deviceJourneyTurnID,
			"accepted": true,
			"status":   "starting",
		})
		return
	}
	if len(parts) == 2 && parts[1] == "events" && r.Method == http.MethodGet {
		f.serveEvents(w, r)
		return
	}
	if len(parts) == 1 && r.Method == http.MethodGet {
		f.mu.Lock()
		conversation := f.conversa[parts[0]]
		f.mu.Unlock()
		if conversation == nil {
			f.writeError(w, r, http.StatusNotFound, "CONVERSATION_NOT_FOUND")
			return
		}
		f.writeData(w, r, conversation)
		return
	}
	f.writeError(w, r, http.StatusNotFound, "NOT_FOUND")
}

func (f *deviceJourneyFixture) serveConversationCreate(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	var body map[string]any
	if len(raw) > 0 && json.Unmarshal(raw, &body) != nil {
		f.writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR")
		return
	}
	f.mu.Lock()
	index := len(f.creates) + 1
	id := fmt.Sprintf("a0000000-0000-4000-8000-%012d", index)
	target := "cloud"
	if value, ok := body["execution_target"].(string); ok {
		target = value
	}
	desktopDeviceID := any(nil)
	if value, ok := body["desktop_device_id"]; ok {
		desktopDeviceID = value
	}
	mode := "default"
	if value, ok := body["collaboration_mode"].(string); ok {
		mode = value
	}
	conversation := map[string]any{
		"id": id, "owner_id": deviceFixtureCredential().OwnerID,
		"title": fmt.Sprintf("Fixture task %d", index), "title_source": "fallback",
		"archive_status": "active", "archived_at": nil, "pinned_at": nil,
		"project_id": nil, "sort_order": nil, "codex_thread_id": nil,
		"agents_template_version": nil, "collaboration_mode": mode,
		"last_turn_status": nil, "execution_status": "idle", "last_run_at": nil,
		"has_unread_completion": false, "has_automation": false,
		"selected_knowledge_base_ids": []any{}, "application": nil,
		"created_at": deviceJourneyFixtureTime, "updated_at": deviceJourneyFixtureTime,
		"execution_target": target, "desktop_device_id": desktopDeviceID,
	}
	f.creates = append(f.creates, deviceJourneyCreateCall{id: id, raw: string(raw), body: body})
	f.conversa[id] = conversation
	f.mu.Unlock()
	f.writeData(w, r, conversation)
}

func (f *deviceJourneyFixture) serveEvents(w http.ResponseWriter, r *http.Request) {
	protocol := fmt.Sprint(nativeWhitebox.protocol.Load())
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("x-linksense-build", strings.Repeat("b", 64))
	w.Header().Set("x-linksense-desktop-protocol", protocol)
	if !deviceJourneyAuthorized(r) {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if flush, ok := w.(http.Flusher); ok {
		_, _ = io.WriteString(w, ": device journey fixture\n\n")
		flush.Flush()
	}
	select {
	case <-r.Context().Done():
	case <-f.done:
	case <-time.After(30 * time.Second):
	}
}

func (f *deviceJourneyFixture) serveSocket(w http.ResponseWriter, r *http.Request) {
	socket, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	if !f.addSocket(socket) {
		_ = socket.CloseNow()
		return
	}
	defer func() {
		f.removeSocket(socket)
		_ = socket.CloseNow()
	}()
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	credential := deviceFixtureCredential()
	_, data, err := socket.Read(ctx)
	var hello struct {
		Type            string `json:"type"`
		Token           string `json:"token"`
		ProtocolVersion int    `json:"protocol_version"`
	}
	if err != nil || json.Unmarshal(data, &hello) != nil || hello.Type != "hello" ||
		hello.Token != credential.Token || hello.ProtocolVersion != 1 {
		_ = socket.Close(websocket.StatusCode(4401), "")
		return
	}
	f.mu.Lock()
	f.hellos = append(f.hellos, deviceJourneyHello{
		token:     hello.Token,
		execution: r.Header.Get(desktopExecutionHeader),
	})
	f.mu.Unlock()
	if f.revoked.Load() {
		_ = socket.Close(websocket.StatusCode(4403), "")
		return
	}
	if f.reject.Load() {
		_ = socket.Close(websocket.StatusCode(4500), "")
		return
	}
	ready := map[string]any{
		"type": "ready", "device_id": credential.DeviceID,
		"connection_id": deviceJourneyConnectionID, "protocol_version": 1,
		"heartbeat_interval_ms": 15_000,
	}
	if f.execution.Load() && r.Header.Get(desktopExecutionHeader) == strconv.Itoa(desktopExecutionVersion) {
		ready["execution_protocol_version"] = desktopExecutionVersion
		ready["attachment_protocol_version"] = desktopAttachmentVersion
	}
	encoded, _ := json.Marshal(ready)
	if socket.Write(ctx, websocket.MessageText, encoded) != nil {
		return
	}
	for {
		_, data, err = socket.Read(ctx)
		if err != nil {
			return
		}
		if string(data) != `{"type":"ping"}` {
			return
		}
		if socket.Write(ctx, websocket.MessageText, []byte(`{"type":"pong"}`)) != nil {
			return
		}
	}
}

func (f *deviceJourneyFixture) addSocket(socket *websocket.Conn) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return false
	}
	f.sockets[socket] = struct{}{}
	return true
}

func (f *deviceJourneyFixture) removeSocket(socket *websocket.Conn) {
	f.mu.Lock()
	delete(f.sockets, socket)
	f.mu.Unlock()
}

func (f *deviceJourneyFixture) disconnect(code websocket.StatusCode) {
	f.mu.Lock()
	sockets := make([]*websocket.Conn, 0, len(f.sockets))
	for socket := range f.sockets {
		sockets = append(sockets, socket)
	}
	f.mu.Unlock()
	for _, socket := range sockets {
		_ = socket.Close(code, "")
	}
}

func (f *deviceJourneyFixture) close() {
	f.mu.Lock()
	if f.closed {
		f.mu.Unlock()
		return
	}
	f.closed = true
	close(f.done)
	sockets := make([]*websocket.Conn, 0, len(f.sockets))
	for socket := range f.sockets {
		sockets = append(sockets, socket)
	}
	f.sockets = map[*websocket.Conn]struct{}{}
	f.mu.Unlock()
	for _, socket := range sockets {
		_ = socket.CloseNow()
	}
}

func (f *deviceJourneyFixture) counts() (pairings, pairs, creates, prewarms, hellos int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.pairings), len(f.pairs), len(f.creates), len(f.prewarms), len(f.hellos)
}

func (f *deviceJourneyFixture) pairingAt(index int) deviceJourneyPairingCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.pairings[index]
}

func (f *deviceJourneyFixture) pairAt(index int) deviceJourneyPairCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.pairs[index]
}

func (f *deviceJourneyFixture) createAt(index int) deviceJourneyCreateCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.creates[index]
}

func (f *deviceJourneyFixture) prewarmCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.prewarms)
}

func (f *deviceJourneyFixture) helloAt(index int) deviceJourneyHello {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.hellos[index]
}

// deviceJourneyRuntime is the test-only counterpart of the supervised runner:
// a published, ready runtime pipe whose messages the test can inspect. The
// production bridge performs the real WebSocket negotiation and attach.
type deviceJourneyRuntime struct {
	supervisor *runtimeSupervisor
	pipe       *runtimePipe
	reader     *os.File
	writer     *os.File
	messages   chan runtimePipeMessage
	closeOnce  sync.Once
}

func newDeviceJourneyRuntime(t *testing.T) *deviceJourneyRuntime {
	t.Helper()
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	pipe := &runtimePipe{input: writer, done: make(chan struct{})}
	supervisor := &runtimeSupervisor{}
	supervisor.pipe.Store(pipe)
	supervisor.ready.Store(true)
	messages := make(chan runtimePipeMessage, 32)
	go func() {
		defer close(messages)
		scanner := bufio.NewScanner(reader)
		scanner.Buffer(make([]byte, 256), runtimeFrameLimit)
		for scanner.Scan() {
			var message runtimePipeMessage
			if json.Unmarshal(scanner.Bytes(), &message) != nil {
				continue
			}
			select {
			case messages <- message:
			default:
			}
		}
	}()
	return &deviceJourneyRuntime{
		supervisor: supervisor, pipe: pipe, reader: reader, writer: writer, messages: messages,
	}
}

func (r *deviceJourneyRuntime) waitMessage(t *testing.T, kind string) runtimePipeMessage {
	t.Helper()
	deadline := time.After(10 * time.Second)
	for {
		select {
		case message, ok := <-r.messages:
			if !ok {
				t.Fatalf("runtime pipe closed before %q", kind)
			}
			if message.Type == kind {
				return message
			}
		case <-deadline:
			t.Fatalf("runtime pipe did not receive %q", kind)
		}
	}
}

func (r *deviceJourneyRuntime) close() {
	r.closeOnce.Do(func() {
		r.supervisor.ready.Store(false)
		r.supervisor.pipe.Store(nil)
		_ = r.writer.Close()
		_ = r.reader.Close()
		close(r.pipe.done)
	})
}

func deviceJourneyWaitFor(t *testing.T, timeout time.Duration, description string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", description)
}

func deviceJourneyJSString(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func deviceJourneyForeground(t *testing.T, page *mygo.Page) {
	t.Helper()
	if _, err := page.Eval(`(() => {
		if (document.visibilityState === "hidden") {
			Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
			document.dispatchEvent(new Event("visibilitychange"));
		}
		window.dispatchEvent(new Event("focus"));
	})()`); err != nil {
		t.Fatal(err)
	}
}

// deviceJourneyTargetTriggerJS finds the composer's run-location trigger by
// its visible target label instead of an aria-label whose wording is local to
// the picker implementation. Cloud is the default and local is the P1-10
// target; no other composer popover carries either label.
const deviceJourneyTargetTriggerJS = `Array.from(document.querySelectorAll('[data-slot="popover-trigger"]')).find((candidate) => {
	const text = (candidate.textContent || "").trim();
	return text === "Cloud computer" || text === "This Mac";
})`

// The session rail keeps its own popover in the DOM, so the run-location
// popover is identified by the execution radios it contains.
const deviceJourneyTargetPopoverJS = `Array.from(document.querySelectorAll('[data-slot="popover-content"]')).find((candidate) => candidate.querySelector('[role="radio"]'))`

func deviceJourneyOpenTargetPicker(t *testing.T, page *mygo.Page) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		open, err := page.Eval(`(` + deviceJourneyTargetPopoverJS + `) !== undefined`)
		if err == nil && open == true {
			return
		}
		// A route transition can briefly replace the document; the trigger is
		// absent then, so keep waiting instead of failing the journey.
		if _, err := page.Eval(`(() => {
			const trigger = ` + deviceJourneyTargetTriggerJS + `;
			if (!trigger) return false;
			trigger.click();
			return true;
		})()`); err != nil {
			t.Fatal(err)
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatal("the run location picker did not open")
}

func deviceJourneyCloseTargetPicker(t *testing.T, page *mygo.Page) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		open, err := page.Eval(`(` + deviceJourneyTargetPopoverJS + `) !== undefined`)
		if err != nil {
			t.Fatal(err)
		}
		if open != true {
			return
		}
		if _, err := page.Eval(`(() => {
			const trigger = ` + deviceJourneyTargetTriggerJS + `;
			if (!trigger) return false;
			trigger.click();
			return true;
		})()`); err != nil {
			t.Fatal(err)
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatal("the run location picker did not close")
}

// deviceJourneyLocalRadioExpression resolves the local option by its visible
// label and appends a predicate on the Base UI radio element.
func deviceJourneyLocalRadioExpression(predicate string) string {
	return `(() => {
		const options = Array.from(document.querySelectorAll('[data-slot="radio-group-option"]'));
		const option = options.find((candidate) => candidate.textContent.includes("This Mac")) || options[1];
		if (!option) throw new Error("local execution option missing");
		const radio = option.querySelector('[role="radio"]');
		if (!radio) throw new Error("local execution radio missing");
		return ` + predicate + `;
	})()`
}

func deviceJourneySelectLocal(t *testing.T, page *mygo.Page) {
	t.Helper()
	deviceJourneyOpenTargetPicker(t, page)
	whiteboxWait(t, page, deviceJourneyLocalRadioExpression(
		`radio.disabled !== true && radio.getAttribute("aria-disabled") !== "true"`,
	))
	if _, err := page.Eval(`(() => {
		const options = Array.from(document.querySelectorAll('[data-slot="radio-group-option"]'));
		const option = options.find((candidate) => candidate.textContent.includes("This Mac")) || options[1];
		const radio = option.querySelector('[role="radio"]');
		radio.click();
	})()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `(`+deviceJourneyTargetPopoverJS+`) === undefined &&
		(`+deviceJourneyTargetTriggerJS+`)?.textContent.includes("This Mac")`)
}

func deviceJourneySetPrompt(t *testing.T, page *mygo.Page, text string) {
	t.Helper()
	if _, err := page.Eval(`(() => {
		const field = document.querySelector('textarea[aria-label="Task composer"]');
		if (!field) throw new Error("task composer missing");
		Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, ` + deviceJourneyJSString(text) + `);
		field.dispatchEvent(new Event("input", { bubbles: true }));
	})()`); err != nil {
		t.Fatal(err)
	}
}

func deviceJourneyPrompt(t *testing.T, page *mygo.Page) string {
	t.Helper()
	value, err := page.Eval(`document.querySelector('textarea[aria-label="Task composer"]')?.value ?? ""`)
	if err != nil {
		t.Fatal(err)
	}
	text, _ := value.(string)
	return text
}

func deviceJourneySubmit(t *testing.T, page *mygo.Page) {
	t.Helper()
	whiteboxWait(t, page, `document.querySelector('button[aria-label="Send"]')?.disabled === false`)
	if _, err := page.Eval(`document.querySelector('button[aria-label="Send"]').click()`); err != nil {
		t.Fatal(err)
	}
}

func deviceJourneyCancelConnection(t *testing.T, desktop *Desktop) {
	t.Helper()
	desktop.mu.RLock()
	connection := desktop.device
	desktop.mu.RUnlock()
	if connection == nil {
		t.Fatal("no native device connection to restart")
	}
	connection.cancel()
	select {
	case <-connection.done:
	case <-time.After(5 * time.Second):
		t.Fatal("native device connection did not stop")
	}
}

func TestNativeDeviceJourneySettingsPairExecutionReadyAndTaskTargets(t *testing.T) {
	nativeWhiteboxSession(t, true)
	desktop := nativeWhitebox.desktop
	credential := deviceFixtureCredential()

	// Start without a stored pairing so the journey proves the settings form is
	// the explicit opt-in; only the refresh session is seeded.
	desktop.closeDevice()
	if err := desktop.session.store.Delete(serverCredentialKey(desktop.server, "device")); err != nil {
		t.Fatal(err)
	}

	journeyRuntime := newDeviceJourneyRuntime(t)
	desktop.localRuntime = journeyRuntime.supervisor
	fixture := newDeviceJourneyFixture()
	deviceJourneyWhitebox.Store(fixture)
	t.Cleanup(func() {
		desktop.closeDevice()
		deviceJourneyWhitebox.Store(nil)
		fixture.close()
		_ = nativeWhitebox.store.Delete(serverCredentialKey(desktop.server, "device"))
		desktop.localRuntime = nil
		journeyRuntime.close()
	})

	// The temporary PathUserData does not isolate WebKit's default store.
	// Give the page a disposable store before it loads or reads any draft.
	desktop.openMainWindowInSession(mygo.NewEphemeralSession())
	win := desktop.mainWindow()
	defer win.Destroy()
	page := win.Page()
	whiteboxWait(t, page, `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli")`)
	const storageSentinelKey = `"linksense.whitebox.device-journey.unrelated"`
	if seeded, err := page.Eval(`(() => {
		const key = ` + storageSentinelKey + `;
		if (localStorage.getItem(key) !== null || sessionStorage.getItem(key) !== null) return false;
		localStorage.setItem(key, "keep");
		sessionStorage.setItem(key, "keep");
		return true;
	})()`); err != nil || seeded != true {
		t.Fatalf("could not seed unrelated sentinels in the fresh test store: seeded=%v err=%v", seeded, err)
	}
	whiteboxWait(t, page, `(`+deviceJourneyTargetTriggerJS+`) !== undefined &&
		document.querySelector('textarea[aria-label="Task composer"]') !== null`)
	deviceJourneyForeground(t, page)

	// Unpaired Mac: the local option exists but is unavailable, and logging in
	// did not pair or connect anything behind the user's back.
	deviceJourneyOpenTargetPicker(t, page)
	whiteboxWait(t, page, deviceJourneyLocalRadioExpression(
		`radio.disabled === true || radio.getAttribute("aria-disabled") === "true"`,
	))
	deviceJourneyCloseTargetPicker(t, page)
	if pairings, pairs, _, _, hellos := fixture.counts(); pairings != 0 || pairs != 0 || hellos != 0 {
		t.Fatalf("logging in paired without the settings form: pairings=%d pairs=%d hellos=%d", pairings, pairs, hellos)
	}

	// Settings -> explicit form opt-in -> native pairing against the synthetic
	// API. The API stays presence-only, so the production bridge reports online
	// without execution readiness.
	if err := page.LoadURL("/settings/general"); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.querySelector('input[name="deviceName"]') !== null`)
	if _, err := page.Eval(`(() => {
		const field = document.querySelector('input[name="deviceName"]');
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, ` + deviceJourneyJSString(deviceJourneyPairName) + `);
		field.dispatchEvent(new Event("input", { bubbles: true }));
	})()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.querySelector('input[name="deviceName"]').form.querySelector('button[type="submit"]').disabled === false`)
	if _, err := page.Eval(`document.querySelector('input[name="deviceName"]').form.querySelector('button[type="submit"]').click()`); err != nil {
		t.Fatal(err)
	}
	deviceJourneyWaitFor(t, 15*time.Second, "one-time pairing code", func() bool {
		pairings, _, _, _, _ := fixture.counts()
		return pairings == 1
	})
	deviceJourneyWaitFor(t, 15*time.Second, "native device registration", func() bool {
		_, pairs, _, _, _ := fixture.counts()
		return pairs == 1
	})
	pairing := fixture.pairingAt(0)
	if pairing.method != http.MethodPost || pairing.body != "{}" {
		t.Fatalf("pairing endpoint request = %s %q", pairing.method, pairing.body)
	}
	pair := fixture.pairAt(0)
	if pair.code != deviceJourneyPairingCode || pair.name != deviceJourneyPairName {
		t.Fatalf("pair body code/name = %q/%q", pair.code, pair.name)
	}
	if pair.platform != "darwin" || pair.arch != runtime.GOARCH {
		t.Fatalf("pair body platform/arch = %q/%q", pair.platform, pair.arch)
	}
	if pair.appVersion == "" || len(pair.appVersion) > 40 {
		t.Fatalf("pair body app_version = %q", pair.appVersion)
	}
	for _, capability := range []string{"local_execution", "browser_extension", "computer_use"} {
		value, ok := pair.capabilities[capability].(bool)
		if !ok || value {
			t.Fatalf("pair body capability %s = %v", capability, pair.capabilities[capability])
		}
	}
	deviceJourneyWaitFor(t, 15*time.Second, "presence-only device socket", func() bool {
		_, _, _, _, hellos := fixture.counts()
		return hellos >= 1
	})
	if hello := fixture.helloAt(0); hello.execution != strconv.Itoa(desktopExecutionVersion) {
		t.Fatalf("the Mac did not offer execution negotiation: %q", hello.execution)
	}
	whiteboxWait(t, page, `mygo.call("Desktop.DeviceStatus").then(status => status.state === "online" && status.executionReady !== true)`)
	whiteboxWait(t, page, `document.body.innerText.includes("Local task execution is not ready yet.")`)
	whiteboxWait(t, page, `document.querySelector('input[name="deviceName"]') === null && document.body.innerText.includes("Work laptop")`)

	// The same paired Mac reconnects after the fake runtime link becomes
	// available. Presence-only must turn into an actual execution link, and the
	// production bridge must open it on the fixture's runtime pipe.
	fixture.execution.Store(true)
	deviceJourneyCancelConnection(t, desktop)
	if _, err := page.Eval(`mygo.call("Desktop.ResumeDevice", ` + deviceJourneyJSString(credential.OwnerID) + `)`); err != nil {
		t.Fatal(err)
	}
	deviceJourneyWaitFor(t, 15*time.Second, "execution-ready device socket", func() bool {
		_, _, _, _, hellos := fixture.counts()
		return hellos >= 2
	})
	whiteboxWait(t, page, `mygo.call("Desktop.DeviceStatus").then(status =>
		status.state === "online" && status.executionReady === true && status.deviceId === `+deviceJourneyJSString(credential.DeviceID)+`)`)
	link := journeyRuntime.waitMessage(t, "link.open")
	if link.LinkID != deviceJourneyConnectionID || link.OwnerID != credential.OwnerID {
		t.Fatalf("runtime link.open = link %q owner %q", link.LinkID, link.OwnerID)
	}
	whiteboxWait(t, page, `document.body.innerText.includes("Local tasks are ready on this Mac.")`)

	// New task still defaults to cloud. A cloud create must never carry the
	// ready local device id, even now that one exists.
	if err := page.LoadURL("/conversations/new"); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `(`+deviceJourneyTargetTriggerJS+`) !== undefined`)
	deviceJourneyForeground(t, page)
	deviceJourneyWaitFor(t, 15*time.Second, "cloud prewarm before the cloud task", func() bool {
		return fixture.prewarmCount() >= 1
	})
	deviceJourneySetPrompt(t, page, "Cloud fixture task")
	deviceJourneySubmit(t, page)
	deviceJourneyWaitFor(t, 15*time.Second, "cloud conversation create", func() bool {
		_, _, creates, _, _ := fixture.counts()
		return creates == 1
	})
	cloud := fixture.createAt(0)
	if target, ok := cloud.body["execution_target"].(string); ok && target != "cloud" {
		t.Fatalf("cloud create execution_target = %q", target)
	}
	if value, ok := cloud.body["desktop_device_id"]; ok && value != nil {
		t.Fatalf("cloud create carried a local device id: %v", value)
	}
	if strings.Contains(cloud.raw, credential.DeviceID) {
		t.Fatalf("cloud create body named a local device: %s", cloud.raw)
	}
	if value, ok := cloud.body["prewarmed_conversation_id"].(string); ok && value != deviceJourneyPrewarmConversationID {
		t.Fatalf("cloud create used an unexpected prewarm id: %q", value)
	}
	whiteboxWait(t, page, `location.pathname === "/conversations/`+cloud.id+`"`)

	// A local create carries the exact current device id and never the cloud
	// prewarm reservation.
	if err := page.LoadURL("/conversations/new"); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `(`+deviceJourneyTargetTriggerJS+`) !== undefined`)
	deviceJourneyForeground(t, page)
	deviceJourneyWaitFor(t, 15*time.Second, "cloud prewarm before switching to local", func() bool {
		return fixture.prewarmCount() >= 2
	})
	deviceJourneySelectLocal(t, page)
	deviceJourneySetPrompt(t, page, "Local fixture task")
	deviceJourneySubmit(t, page)
	deviceJourneyWaitFor(t, 15*time.Second, "local conversation create", func() bool {
		_, _, creates, _, _ := fixture.counts()
		return creates == 2
	})
	local := fixture.createAt(1)
	if target, _ := local.body["execution_target"].(string); target != "local" {
		t.Fatalf("local create execution_target = %v", local.body["execution_target"])
	}
	if deviceID, _ := local.body["desktop_device_id"].(string); deviceID != credential.DeviceID {
		t.Fatalf("local create desktop_device_id = %v, want %s", local.body["desktop_device_id"], credential.DeviceID)
	}
	if _, ok := local.body["prewarmed_conversation_id"]; ok {
		t.Fatalf("local create used the cloud prewarm: %s", local.raw)
	}
	if strings.Contains(local.raw, deviceJourneyPrewarmConversationID) {
		t.Fatalf("local create body named the cloud prewarm id: %s", local.raw)
	}
	if statusDevice, err := page.Eval(`mygo.call("Desktop.DeviceStatus").then(status => status.deviceId ?? "")`); err != nil || statusDevice != credential.DeviceID {
		t.Fatalf("native current device id = %v (err %v)", statusDevice, err)
	}
	whiteboxWait(t, page, `location.pathname === "/conversations/`+local.id+`"`)
	whiteboxWait(t, page, `document.querySelector('[aria-label="Run location: This Mac"]') !== null`)

	// Losing the socket must stop local creation without switching to cloud and
	// without dropping the composed prompt or the selected target.
	if err := page.LoadURL("/conversations/new"); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `(`+deviceJourneyTargetTriggerJS+`) !== undefined`)
	deviceJourneyForeground(t, page)
	deviceJourneySelectLocal(t, page)
	const blockedPrompt = "Blocked local fixture task"
	deviceJourneySetPrompt(t, page, blockedPrompt)
	_, _, createsBefore, _, _ := fixture.counts()
	fixture.reject.Store(true)
	fixture.disconnect(websocket.StatusCode(4500))
	whiteboxWait(t, page, `mygo.call("Desktop.DeviceStatus").then(status => status.executionReady !== true)`)
	deviceJourneyOpenTargetPicker(t, page)
	whiteboxWait(t, page, deviceJourneyLocalRadioExpression(
		`radio.disabled === true || radio.getAttribute("aria-disabled") === "true"`,
	))
	whiteboxWait(t, page, deviceJourneyLocalRadioExpression(`radio.getAttribute("aria-checked") === "true"`))
	deviceJourneyCloseTargetPicker(t, page)
	deviceJourneySubmit(t, page)
	whiteboxWait(t, page, `document.body.innerText.includes("run local tasks")`)
	if _, _, createsAfterLoss, _, _ := fixture.counts(); createsAfterLoss != createsBefore {
		t.Fatalf("a lost connection created another conversation: before=%d after=%d", createsBefore, createsAfterLoss)
	}
	if prompt := deviceJourneyPrompt(t, page); prompt != blockedPrompt {
		t.Fatalf("the draft was lost after a blocked submit: %q", prompt)
	}
	whiteboxWait(t, page, `(`+deviceJourneyTargetTriggerJS+`)?.textContent.includes("This Mac")`)

	// A revoked device credential is another fail-closed state: local stays
	// selected and disabled, and submit neither falls back to cloud nor clears
	// the draft.
	fixture.reject.Store(false)
	fixture.revoked.Store(true)
	deviceJourneyCancelConnection(t, desktop)
	if _, err := page.Eval(`mygo.call("Desktop.ResumeDevice", ` + deviceJourneyJSString(credential.OwnerID) + `)`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `mygo.call("Desktop.DeviceStatus").then(status => status.state === "revoked" && status.executionReady !== true)`)
	deviceJourneyOpenTargetPicker(t, page)
	whiteboxWait(t, page, deviceJourneyLocalRadioExpression(
		`radio.disabled === true || radio.getAttribute("aria-disabled") === "true"`,
	))
	whiteboxWait(t, page, deviceJourneyLocalRadioExpression(`radio.getAttribute("aria-checked") === "true"`))
	deviceJourneyCloseTargetPicker(t, page)
	deviceJourneySubmit(t, page)
	time.Sleep(750 * time.Millisecond)
	if _, _, createsAfterRevocation, _, _ := fixture.counts(); createsAfterRevocation != createsBefore {
		t.Fatalf("a revoked device created another conversation: before=%d after=%d", createsBefore, createsAfterRevocation)
	}
	if prompt := deviceJourneyPrompt(t, page); prompt != blockedPrompt {
		t.Fatalf("the draft was lost after revocation: %q", prompt)
	}
	whiteboxWait(t, page, `(`+deviceJourneyTargetTriggerJS+`)?.textContent.includes("This Mac")`)
	if preserved, err := page.Eval(`localStorage.getItem(` + storageSentinelKey + `) === "keep" &&
		sessionStorage.getItem(` + storageSentinelKey + `) === "keep"`); err != nil || preserved != true {
		t.Fatalf("the journey changed unrelated test storage: preserved=%v err=%v", preserved, err)
	}
}
