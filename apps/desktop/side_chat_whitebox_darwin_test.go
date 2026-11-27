//go:build desktop_whitebox

package main

// Whitebox regression for the local side-chat quote fix (21b14881).
//
// The real shared Web UI runs in the main-window WKWebView. The parent row, its
// projected local child, the side-chat link and the child turn/completed
// projection come from this test's loopback fixture, installed through the
// generic nativeWhitebox.api hook after the authentic protocol/build gate.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const (
	sideChatParentID       = "f1000000-0000-4000-8000-000000000001"
	sideChatChildID        = "f1000000-0000-4000-8000-000000000002"
	sideChatSourceID       = "f2000000-0000-4000-8000-000000000001"
	sideChatAnswerID       = "f2000000-0000-4000-8000-000000000002"
	sideChatReferenceID    = "f3000000-0000-4000-8000-000000000001"
	sideChatRunningTurnID  = "f4000000-0000-4000-8000-000000000001"
	sideChatAcceptedTurnID = "f4000000-0000-4000-8000-000000000002"
	sideChatFixtureTime    = "2026-11-01T09:00:00.000Z"
	sideChatCompactDraft   = "/compact"
	sideChatQuoteDraft     = "Continue with this quoted passage."
	sideChatTerminalReply  = "Previous side chat turn completed."
	sideChatBlockedNote    = "You can send a quote when this local side chat is idle and in Default mode."
	sideChatParentTitle    = "Side chat parent fixture"
	sideChatChildTitle     = "Side chat fixture"
	sideChatSelectionText  = "Quoted parent passage."

	sideChatAPIConversations = "/api/v1/conversations"
	sideChatParentPath       = sideChatAPIConversations + "/" + sideChatParentID
	sideChatChildPath        = sideChatAPIConversations + "/" + sideChatChildID
	sideChatTurnsPath        = sideChatChildPath + "/turns"
	sideChatInterruptPath    = sideChatTurnsPath + "/" + sideChatRunningTurnID + "/interrupt"
	sideChatDraftKey         = "linksense.conversation-draft.v1:10000000-0000-4000-8000-000000000001:" + sideChatChildID
	sideChatCursorKey        = "linksense.sse." + sideChatChildID + ".lastEventId"
	sideChatAsideJS          = `Array.from(document.querySelectorAll("aside")).find(candidate => candidate.querySelector("h2")?.textContent.trim() === "Side chat")`
	sideChatComposerJS       = sideChatAsideJS + `?.querySelector('textarea[aria-label="Task composer"]')`
)

type sideChatMutation struct {
	method, path, query, body string
	authorized                bool
}

func (m sideChatMutation) String() string { return m.method + " " + m.path }

type sideChatFixture struct {
	mu           sync.Mutex
	mutations    []sideChatMutation
	completed    atomic.Bool
	idle         chan struct{}
	completeOnce sync.Once
	done         chan struct{}
	closeOnce    sync.Once
}

func newSideChatFixture() *sideChatFixture {
	return &sideChatFixture{idle: make(chan struct{}), done: make(chan struct{})}
}

func (f *sideChatFixture) close() { f.closeOnce.Do(func() { close(f.done) }) }
func (f *sideChatFixture) complete() {
	f.completed.Store(true)
	f.completeOnce.Do(func() { close(f.idle) })
}

func (f *sideChatFixture) record(mutation sideChatMutation) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.mutations = append(f.mutations, mutation)
}

func (f *sideChatFixture) snapshot() []sideChatMutation {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]sideChatMutation(nil), f.mutations...)
}

func (f *sideChatFixture) serve(w http.ResponseWriter, r *http.Request) bool {
	path := r.URL.Path
	owned := path == sideChatParentPath || strings.HasPrefix(path, sideChatParentPath+"/") ||
		path == sideChatChildPath || strings.HasPrefix(path, sideChatChildPath+"/")
	mutating := r.Method == http.MethodPost || r.Method == http.MethodPut ||
		r.Method == http.MethodPatch || r.Method == http.MethodDelete
	conversationPath := path == sideChatAPIConversations ||
		strings.HasPrefix(path, sideChatAPIConversations+"/")
	if !owned && !(mutating && conversationPath) {
		return false
	}
	var body []byte
	if mutating {
		body, _ = io.ReadAll(io.LimitReader(r.Body, 64<<10))
	}
	authorized := cloudAuthorized(w, r)
	// A signed-in new task legitimately reserves a cloud runner before the user
	// types. Only that authenticated, project-free startup POST stays with the
	// shared fixture. Warming an existing row names its id or project, and the
	// startup call is never PUT/PATCH/DELETE, so everything else is recorded and
	// fails the journey whenever it arrives.
	if !owned && sideChatStartupPrewarm(r, body, authorized) {
		// The shared device-journey fixture reads this startup body.
		r.Body = io.NopCloser(bytes.NewReader(body))
		return false
	}
	// Record every conversation mutation, including an account conversation
	// create, before its path is validated. GET and HEAD have no side effects.
	if mutating && conversationPath {
		f.record(sideChatMutation{
			method: r.Method, path: path, query: r.URL.RawQuery,
			body: string(body), authorized: authorized,
		})
	}
	if !authorized {
		return true
	}
	if !owned {
		// An unexpected conversation create or another row's mutation is already
		// recorded, and the legacy fixtures never receive it.
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, `{"success":false,"error_code":"FIXTURE_PATH_UNSUPPORTED"}`)
		return true
	}
	switch {
	case path == sideChatParentPath && r.Method == http.MethodGet:
		writeSideChatData(w, http.StatusOK, sideChatParentDetail())
	case path == sideChatChildPath && r.Method == http.MethodGet:
		writeSideChatData(w, http.StatusOK, sideChatChildDetail(f.completed.Load()))
	case path == sideChatParentPath+"/side-chat" && r.Method == http.MethodGet:
		writeSideChatData(w, http.StatusOK, sideChatLink())
	case (path == sideChatParentPath+"/model-preference" || path == sideChatChildPath+"/model-preference") &&
		r.Method == http.MethodGet:
		writeSideChatData(w, http.StatusOK, sideChatModelPreference())
	case path == sideChatChildPath+"/events" && r.Method == http.MethodGet:
		f.serveEvents(w, r)
	case path == sideChatTurnsPath && r.Method == http.MethodPost:
		writeSideChatData(w, http.StatusAccepted, map[string]any{
			"accepted": true, "status": "starting", "turn_id": sideChatAcceptedTurnID,
		})
	case path == sideChatInterruptPath && r.Method == http.MethodPost:
		writeSideChatData(w, http.StatusAccepted, map[string]string{"code": "TURN_INTERRUPT_REQUESTED"})
	default:
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, `{"success":false,"error_code":"FIXTURE_PATH_UNSUPPORTED"}`)
	}
	return true
}

// sideChatStartupPrewarm reports the only benign conversation write: the
// authenticated, project-free new-task reservation POST. The pinned
// useConversationPrewarm caller sends collaboration_mode "default" at startup
// and omits both conversation_id and project_id unless it has a reservation or
// a selected project, so the exempt body is exactly that one key and value;
// project_id null, conversation_id, aliases, or extra fields are mutations.
// Existing local tasks never prewarm, so a prewarm naming either fixture row is
// always an unexpected mutation, no matter when it starts or lands. The shared
// device-journey fixture reads the body, which the caller restores on this
// exact branch.
func sideChatStartupPrewarm(r *http.Request, body []byte, authorized bool) bool {
	if !authorized || r.Method != http.MethodPost ||
		r.URL.Path != sideChatAPIConversations+"/prewarm" ||
		r.URL.RawQuery != "" || r.URL.ForceQuery {
		return false
	}
	var fields map[string]string
	if json.Unmarshal(body, &fields) != nil {
		return false
	}
	return maps.Equal(fields, map[string]string{"collaboration_mode": "default"})
}

// writeSideChatData reuses the shared fixture envelope after the authentic
// protocol/build gate has already written its headers.
func writeSideChatData(w http.ResponseWriter, status int, data any) {
	if status != http.StatusOK {
		w.WriteHeader(status)
	}
	writeCloudData(w, data)
}

func (f *sideChatFixture) serveEvents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	flush := func() {
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
	}
	_, _ = io.WriteString(w, ": side-chat fixture\n\n")
	flush()
	select {
	case <-f.idle:
	case <-f.done:
		return
	case <-r.Context().Done():
		return
	case <-time.After(30 * time.Second):
		return
	}
	writeSideChatTerminalEvent(w)
	select {
	case <-f.done:
	case <-r.Context().Done():
	}
}

// writeSideChatTerminalEvent mirrors writeCloudEvent and the API's SSE mapping:
// `id: <sse_event_id>`, `event: <event_type>`, then the shared
// conversationEventSchema record. The native codex_app_server turn/completed
// projection is the one the shared Vitest stages for a local child.
func writeSideChatTerminalEvent(w http.ResponseWriter) {
	id := sideChatChildID + ":1"
	data, _ := json.Marshal(map[string]any{
		"id": "f5000000-0000-4000-8000-000000000001", "conversation_id": sideChatChildID,
		"turn_id": sideChatRunningTurnID, "sequence_no": 1, "event_type": "turn/completed",
		"visibility": "user_visible", "sse_event_id": id, "created_at": sideChatFixtureTime,
		"payload": map[string]any{
			"schema_version": 2, "source": "codex_app_server", "method": "turn/completed",
			"params": map[string]any{
				"threadId": "side-chat-fixture-thread",
				"turn":     map[string]any{"id": "side-chat-native-turn", "status": "completed"},
			},
		},
	})
	_, _ = fmt.Fprintf(w, "id: %s\nevent: turn/completed\ndata: %s\n\n", id, data)
	if flush, ok := w.(http.Flusher); ok {
		flush.Flush()
	}
}

func sideChatConversation(id, title, status string) map[string]any {
	return map[string]any{
		"id": id, "title": title, "project_id": nil, "updated_at": sideChatFixtureTime,
		"execution_target": "local", "execution_status": status, "collaboration_mode": "default",
	}
}

// sideChatDetail matches the shared conversation-detail union; the schema
// defaults the top-level collections this journey leaves empty.
func sideChatDetail(conversation map[string]any, turns, messages []any) map[string]any {
	return map[string]any{"conversation": conversation, "turns": turns, "messages": messages}
}

func sideChatParentDetail() map[string]any {
	return sideChatDetail(sideChatConversation(sideChatParentID, sideChatParentTitle, "completed"), []any{}, []any{})
}

func sideChatChildDetail(completed bool) map[string]any {
	status, messages := "running", []any{}
	if completed {
		status, messages = "completed", []any{map[string]any{
			"id": sideChatAnswerID, "role": "assistant", "content": sideChatTerminalReply,
			"turn_id": sideChatRunningTurnID, "sequence_no": 1, "created_at": sideChatFixtureTime,
		}}
	}
	turns := []any{map[string]any{"id": sideChatRunningTurnID, "status": status, "task_kind": "turn"}}
	return sideChatDetail(sideChatConversation(sideChatChildID, sideChatChildTitle, status), turns, messages)
}

func sideChatLink() map[string]any {
	return map[string]any{
		"conversation_id": sideChatChildID, "parent_conversation_id": sideChatParentID,
		"reference": map[string]any{
			"id": sideChatReferenceID, "source_conversation_id": sideChatParentID,
			"source_title": sideChatParentTitle, "source_message_id": sideChatSourceID,
			"selection_text": sideChatSelectionText, "include_recent_messages": true, "recent_messages": []any{},
		},
	}
}

func sideChatModelPreference() map[string]any {
	return map[string]any{
		"configured": true, "default_model": "fixture-model", "selected_model": "fixture-model",
		"selected_reasoning_effort": "medium",
		"models": []any{map[string]any{
			"id": "fixture-model", "display_name": "Fixture Model", "enabled": true, "context_window": nil,
			"supported_reasoning_efforts": []any{"medium", "high"}, "default_reasoning_effort": "medium",
		}},
	}
}

// sideChatDraftWait gates on both the visible composer value and the version-1
// local draft shape the child restores and writes.
func sideChatDraftWait(value string) string {
	quoted := strconv.Quote(value)
	return `(() => { const field = ` + sideChatComposerJS + `; let draft = null; try { draft = JSON.parse(localStorage.getItem(` +
		strconv.Quote(sideChatDraftKey) + `) || "null"); } catch {} return field instanceof HTMLTextAreaElement && field.value === ` +
		quoted + ` && draft?.version === 1 && draft?.input === ` + quoted + `; })()`
}

func sideChatWaitMutation(t *testing.T, fixture *sideChatFixture, index int) sideChatMutation {
	t.Helper()
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); time.Sleep(10 * time.Millisecond) {
		if mutations := fixture.snapshot(); len(mutations) > index {
			return mutations[index]
		}
	}
	t.Fatalf("timed out waiting for side-chat mutation %d; got %v", index+1, fixture.snapshot())
	return sideChatMutation{}
}
