//go:build desktop_whitebox

package main

// Synthetic device-lane server used by whitebox tests that need a signed-in
// Mac with an authenticated socket, device registration and task persistence.
// It no longer models the retired pairing/run-location journey; the remaining
// tests use its foreground helpers and cloud conversation fixtures.
//
// The only hook outside this file is one inert call at the top of whiteboxAPI
// in native_whitebox_test.go:
//
//	if serveDeviceJourneyWhitebox(w, r) { return }
//
// The fixture is installed only while a test holds the pointer, so every other
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
	"slices"
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
	deviceJourneyCloudTaskID           = "91000000-0000-4000-8000-000000000001"
	deviceJourneyCloudTaskTitle        = "Cloud fixture task"
	deviceJourneySourceDraft           = "Source draft stays on the cloud task"
	deviceJourneyContinuationPrompt    = "Continue the Mac leg"
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

type deviceJourneyTurnCall struct {
	conversationID string
	inputText      string
}

type deviceJourneyHello struct {
	token     string
	execution string
	tools     string
}

// deviceJourneyContinuationCall is one POST to the continuation route, kept
// even when it is rejected so an extra or malformed request fails the test.
type deviceJourneyContinuationCall struct {
	method        string
	sourceID      string
	raw           string
	body          map[string]any
	authorized    bool
	status        int
	destinationID string
}

type deviceJourneyFixture struct {
	mu         sync.Mutex
	closed     bool
	done       chan struct{}
	sockets    map[*websocket.Conn]struct{}
	pairings   []deviceJourneyPairingCall
	pairs      []deviceJourneyPairCall
	creates    []deviceJourneyCreateCall
	prewarms   []map[string]any
	turns      []deviceJourneyTurnCall
	turnBodies []map[string]any
	hellos     []deviceJourneyHello
	conversa   map[string]map[string]any

	continuationAttempts int
	continuations        []deviceJourneyContinuationCall
	unexpected           []string
	pairState            struct {
		name, platform, arch, appVersion string
	}

	// execution makes the fake API negotiate execution protocol v2. tools makes
	// it additionally negotiate the exact conversation-reference read operation
	// offered by this Mac. reject and revoked model a lost socket and a
	// server-side credential revocation.
	execution atomic.Bool
	tools     atomic.Bool
	reject    atomic.Bool
	revoked   atomic.Bool

	cloudEntryClosed atomic.Bool
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
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/system/bootstrap" && f.cloudEntryClosed.Load():
		w.Header().Set("Cache-Control", "no-store")
		f.writeData(w, r, map[string]any{
			"initialized":               true,
			"organization_display_name": "LinkSense",
			"default_locale":            "en-US",
			"desktop":                   map[string]bool{"local_computer": true, "cloud_target": false},
		})
		return true
	case r.URL.Path == "/api/v1/desktop/devices/socket":
		f.serveSocket(w, r)
		return true
	case r.URL.Path == "/api/v1/desktop/devices/pairing":
		f.servePairing(w, r)
		return true
	case r.URL.Path == "/api/v1/desktop/devices/pair":
		f.servePair(w, r)
		return true
	case r.URL.Path == "/api/v1/desktop/devices/register":
		f.serveRegister(w, r)
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
	f.writeDataStatus(w, r, http.StatusOK, data)
}

func (f *deviceJourneyFixture) writeDataStatus(w http.ResponseWriter, r *http.Request, status int, data any) {
	if !f.writeHeaders(w, r) {
		return
	}
	w.WriteHeader(status)
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

func (f *deviceJourneyFixture) serveRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || !deviceJourneyAuthorized(r) {
		f.writeError(w, r, http.StatusUnauthorized, "AUTH_REQUIRED")
		return
	}
	var input struct {
		Name         string         `json:"name"`
		Platform     string         `json:"platform"`
		Arch         string         `json:"arch"`
		AppVersion   string         `json:"app_version"`
		Capabilities map[string]any `json:"capabilities"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&input) != nil {
		f.writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR")
		return
	}
	f.mu.Lock()
	f.pairState.name = input.Name
	f.pairState.platform = input.Platform
	f.pairState.arch = input.Arch
	f.pairState.appVersion = input.AppVersion
	f.mu.Unlock()
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
		raw, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
		var body map[string]any
		if len(raw) == 0 || json.Unmarshal(raw, &body) != nil {
			f.writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR")
			return
		}
		inputText, _ := body["input_text"].(string)
		f.mu.Lock()
		f.turns = append(f.turns, deviceJourneyTurnCall{conversationID: parts[0], inputText: inputText})
		f.turnBodies = append(f.turnBodies, body)
		f.mu.Unlock()
		f.writeData(w, r, map[string]any{
			"turn_id":  deviceJourneyTurnID,
			"accepted": true,
			"status":   "starting",
		})
		return
	}
	if len(parts) == 2 && parts[1] == "continuations" {
		f.serveContinuation(w, r, parts[0])
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
	// A mutating request this fixture did not serve is an unexpected write, not
	// a legacy-fixture success. Record it so the continuation test fails loudly.
	if r.Method != http.MethodGet {
		f.recordUnexpectedWrite(r)
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

// serveContinuation serves the frozen continuation contract. It records every
// attempt, including rejected ones, so the test can prove exactly one
// authenticated POST reached each continuation and no extra write slipped in.
func (f *deviceJourneyFixture) serveContinuation(w http.ResponseWriter, r *http.Request, sourceID string) {
	authorized := deviceJourneyAuthorized(r)
	f.mu.Lock()
	f.continuationAttempts++
	f.mu.Unlock()
	call := deviceJourneyContinuationCall{method: r.Method, sourceID: sourceID, authorized: authorized}
	fail := func(status int, code string) {
		call.status = status
		f.mu.Lock()
		f.continuations = append(f.continuations, call)
		f.mu.Unlock()
		f.writeError(w, r, status, code)
	}
	if r.Method != http.MethodPost {
		fail(http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED")
		return
	}
	if !authorized {
		fail(http.StatusUnauthorized, "AUTH_REQUIRED")
		return
	}
	raw, _ := io.ReadAll(io.LimitReader(r.Body, 16<<10))
	call.raw = string(raw)
	var input struct {
		ExecutionTarget string  `json:"execution_target"`
		DesktopDeviceID *string `json:"desktop_device_id"`
		RequestID       string  `json:"request_id"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var body map[string]any
	if err := decoder.Decode(&input); err != nil || json.Unmarshal(raw, &body) != nil ||
		len(body) != 3 || !validUUID(input.RequestID) {
		fail(http.StatusUnprocessableEntity, "VALIDATION_ERROR")
		return
	}
	call.body = body
	credential := deviceFixtureCredential()
	switch input.ExecutionTarget {
	case "local":
		if input.DesktopDeviceID == nil || *input.DesktopDeviceID != credential.DeviceID {
			fail(http.StatusUnprocessableEntity, "VALIDATION_ERROR")
			return
		}
	case "cloud":
		if input.DesktopDeviceID != nil {
			fail(http.StatusUnprocessableEntity, "VALIDATION_ERROR")
			return
		}
	default:
		fail(http.StatusUnprocessableEntity, "VALIDATION_ERROR")
		return
	}
	f.mu.Lock()
	source := f.conversa[sourceID]
	sourceTitle, sourceTarget := "", "cloud"
	if source != nil {
		sourceTitle, _ = source["title"].(string)
		if target, ok := source["execution_target"].(string); ok {
			sourceTarget = target
		}
	}
	f.mu.Unlock()
	if source == nil || sourceTitle == "" {
		fail(http.StatusNotFound, "CONVERSATION_NOT_FOUND")
		return
	}
	// The entry always moves the task to the other run location.
	if sourceTarget == input.ExecutionTarget {
		fail(http.StatusUnprocessableEntity, "VALIDATION_ERROR")
		return
	}
	var destinationDevice any
	if input.DesktopDeviceID != nil {
		destinationDevice = *input.DesktopDeviceID
	}
	f.mu.Lock()
	index := len(f.continuations) + 1
	destinationID := fmt.Sprintf("a1000000-0000-4000-8000-%012d", index)
	destination := deviceJourneyConversation(
		destinationID, fmt.Sprintf("Fixture continuation %d", index),
		input.ExecutionTarget, destinationDevice,
	)
	f.conversa[destinationID] = destination
	call.status = http.StatusCreated
	call.destinationID = destinationID
	f.continuations = append(f.continuations, call)
	f.mu.Unlock()
	f.writeDataStatus(w, r, http.StatusCreated, map[string]any{
		"conversation": destination,
		"source":       map[string]any{"id": sourceID, "title": sourceTitle},
	})
}

func deviceJourneyConversation(id, title, target string, desktopDeviceID any) map[string]any {
	return map[string]any{
		"id": id, "owner_id": deviceFixtureCredential().OwnerID,
		"title": title, "title_source": "fallback",
		"archive_status": "active", "archived_at": nil, "pinned_at": nil,
		"project_id": nil, "sort_order": nil, "codex_thread_id": nil,
		"agents_template_version": nil, "collaboration_mode": "default",
		"last_turn_status": nil, "execution_status": "idle", "last_run_at": nil,
		"has_unread_completion": false, "has_automation": false,
		"selected_knowledge_base_ids": []any{}, "application": nil,
		"created_at": deviceJourneyFixtureTime, "updated_at": deviceJourneyFixtureTime,
		"execution_target": target, "desktop_device_id": desktopDeviceID,
	}
}

func (f *deviceJourneyFixture) seedConversation(conversation map[string]any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if id, ok := conversation["id"].(string); ok {
		f.conversa[id] = conversation
	}
}

func (f *deviceJourneyFixture) recordUnexpectedWrite(r *http.Request) {
	f.mu.Lock()
	f.unexpected = append(f.unexpected, r.Method+" "+r.URL.Path)
	f.mu.Unlock()
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
		tools:     r.Header.Get(desktopToolOperationsHeader),
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
		// Model the real API's supported-operation intersection: this fixture
		// supports exactly the reference read the continuation leg needs, and
		// only when the Mac offered it on this socket.
		if f.tools.Load() && slices.Contains(strings.Split(r.Header.Get(desktopToolOperationsHeader), ","), desktopConversationReferenceReadOperation) {
			ready["tool_protocol_version"] = desktopToolVersion
			ready["tool_operations"] = []string{desktopConversationReferenceReadOperation}
		}
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

func (f *deviceJourneyFixture) taskWrites() (creates, prewarms, turns int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.creates), len(f.prewarms), len(f.turns)
}

func (f *deviceJourneyFixture) turnAt(index int) deviceJourneyTurnCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.turns[index]
}

func (f *deviceJourneyFixture) helloAt(index int) deviceJourneyHello {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.hellos[index]
}

func (f *deviceJourneyFixture) turnBodyAt(index int) map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.turnBodies[index]
}

func (f *deviceJourneyFixture) continuationAttemptCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.continuationAttempts
}

func (f *deviceJourneyFixture) continuationCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.continuations)
}

func (f *deviceJourneyFixture) continuationAt(index int) deviceJourneyContinuationCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.continuations[index]
}

func (f *deviceJourneyFixture) unexpectedWrites() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.unexpected...)
}

// reservationPrewarmCount counts cloud reservations, which a continuation must
// never create. Refreshes of an already open cloud task are ordinary page
// behavior and are allowed.
func (f *deviceJourneyFixture) reservationPrewarmCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	count := 0
	for _, body := range f.prewarms {
		if _, ok := body["conversation_id"]; !ok {
			count++
		}
	}
	return count
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

// waitLinkOpen skips an earlier generation so a reconnect after enabling tool
// negotiation is inspected instead of the link that preceded it.
func (r *deviceJourneyRuntime) waitLinkOpen(t *testing.T, match func(runtimePipeMessage) bool) runtimePipeMessage {
	t.Helper()
	deadline := time.After(10 * time.Second)
	for {
		select {
		case message, ok := <-r.messages:
			if !ok {
				t.Fatal("runtime pipe closed before the negotiated link.open")
			}
			if message.Type == "link.open" && match(message) {
				return message
			}
		case <-deadline:
			t.Fatal("runtime link.open never carried the negotiated conversation-reference read")
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

func deviceJourneyVerifyCloudEntryClosed(t *testing.T, page *mygo.Page, fixture *deviceJourneyFixture, deviceID string) (expectedCreates, expectedTurns int) {
	t.Helper()
	createsBefore, prewarmsBefore, turnsBefore := fixture.taskWrites()
	assertWrites := func(stage string, createDelta, turnDelta int) {
		t.Helper()
		creates, prewarms, turns := fixture.taskWrites()
		if creates != createsBefore+createDelta || prewarms != prewarmsBefore || turns != turnsBefore+turnDelta {
			t.Fatalf("%s wrote to the API: create=%d prewarm=%d turn=%d; want %d, 0, %d",
				stage, creates-createsBefore, prewarms-prewarmsBefore, turns-turnsBefore, createDelta, turnDelta)
		}
	}

	fixture.cloudEntryClosed.Store(true)
	defer fixture.cloudEntryClosed.Store(false)
	if err := page.LoadURL("/conversations/new"); err != nil {
		t.Fatal(err)
	}
	const notice = "Cloud computers aren’t available right now, so new cloud tasks can’t be started"
	cloudUnavailable := `document.querySelector('[aria-label="Run location: Cloud computer"]')?.getAttribute("aria-description") === ` +
		deviceJourneyJSString(notice+".")
	whiteboxWait(t, page, `location.pathname === "/conversations/new" && `+cloudUnavailable)
	deviceJourneyForeground(t, page)
	deviceJourneyOpenTargetPicker(t, page)
	whiteboxWait(t, page, `(() => {
		const radio = (`+deviceJourneyTargetPopoverJS+`)?.querySelector('[role="radio"][aria-checked="true"]');
		return radio?.closest('[data-slot="radio-group-option"]')?.innerText.includes("Cloud computer") === true &&
			(radio.disabled === true || radio.getAttribute("aria-disabled") === "true");
	})()`)
	deviceJourneyCloseTargetPicker(t, page)

	const draft = "Keep this draft when the cloud entry is closed"
	deviceJourneySetPrompt(t, page, draft)
	cloudToast := `Array.from(document.querySelectorAll('[data-sonner-toast]:not([data-removed="true"])'))
		.find(toast => toast.querySelector('[data-title]')?.textContent.trim() === ` + deviceJourneyJSString(notice) + `)`
	if absent, err := page.Eval(`(` + cloudToast + `) === undefined`); err != nil || absent != true {
		t.Fatalf("cloud entry notification was not absent before Send: absent=%v err=%v", absent, err)
	}
	assertWrites("disabled cloud draft before submit", 0, 0)
	deviceJourneySubmit(t, page)
	whiteboxWait(t, page, `location.pathname === "/conversations/new" && `+cloudUnavailable+` &&
		(`+cloudToast+`)?.matches('[data-type="error"][data-mounted="true"][data-visible="true"]') === true`)
	if deviceJourneyPrompt(t, page) != draft {
		t.Fatal("blocked cloud submission changed the draft")
	}
	assertWrites("blocked cloud submit", 0, 0)

	deviceJourneySelectLocal(t, page)
	assertWrites("selecting local", 0, 0)
	deviceJourneySubmit(t, page)
	deviceJourneyWaitFor(t, 15*time.Second, "turn after explicitly switching to This Mac", func() bool {
		creates, _, turns := fixture.taskWrites()
		return creates > createsBefore && turns > turnsBefore
	})
	local := fixture.createAt(createsBefore)
	if local.body["execution_target"] != "local" || local.body["desktop_device_id"] != deviceID {
		t.Fatal("explicit local create did not use the paired Mac")
	}
	if _, ok := local.body["prewarmed_conversation_id"]; ok {
		t.Fatal("explicit local create used a cloud prewarm")
	}
	if fixture.turnAt(turnsBefore) != (deviceJourneyTurnCall{conversationID: local.id, inputText: draft}) {
		t.Fatal("the preserved draft did not reach the new local task")
	}
	whiteboxWait(t, page, `location.pathname === "/conversations/`+local.id+`"`)
	assertWrites("explicit local submit", 1, 1)
	if err := page.LoadURL("/settings/general"); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `location.pathname === "/settings/general" && document.body.innerText.includes("Local tasks are ready on this Mac.")`)
	assertWrites("leaving the rollout task", 1, 1)
	return createsBefore + 1, turnsBefore + 1
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
