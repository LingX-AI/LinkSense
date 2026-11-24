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

	"github.com/egoist/mygo"
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

// TestNativeLocalSideChatRunningCompactDraftStopsThenQuotesDirectly covers the
// 21b14881 composition rule: while the projected local child is running, an
// existing /compact draft offers Stop only, Enter/form submission cannot turn
// it into any mutation, and the explicit Stop interrupts only the child's known
// turn while keeping the draft. After the fixture projects turn/completed over
// the child SSE stream, a normal edit sends exactly one direct
// conversation_reference turn on the same child, never the parent or a queue.
func TestNativeLocalSideChatRunningCompactDraftStopsThenQuotesDirectly(t *testing.T) {
	nativeWhiteboxSession(t, true)
	fixture := newSideChatFixture()
	serve := nativeWhiteboxAPI(fixture.serve)
	nativeWhitebox.api.Store(&serve)
	t.Cleanup(func() { nativeWhitebox.api.Store(nil); fixture.close() })
	desktop := nativeWhitebox.desktop
	// A real WKWebView runs on the main thread; the ephemeral session keeps the
	// shared UI's storage out of the developer store.
	desktop.openMainWindowInSession(mygo.NewEphemeralSession())
	win := desktop.mainWindow()
	if win == nil {
		t.Fatal("the native main window was not created")
	}
	page := win.Page()
	t.Cleanup(func() {
		_, _ = page.Eval(`localStorage.removeItem(` + strconv.Quote(sideChatDraftKey) +
			`); sessionStorage.removeItem(` + strconv.Quote(sideChatCursorKey) + `)`)
		win.Destroy()
	})
	// Go straight to the existing parent. The signed-in root can briefly hold
	// the new-task route, whose legitimate project-free cloud prewarm POST is
	// unrelated to this journey and stays with the shared fixture; any other
	// prewarm body is still caught.
	if err := page.LoadURL("/conversations/" + sideChatParentID); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `document.querySelector('button[aria-label="Open side chat"]') !== null && document.body.innerText.includes(`+
		strconv.Quote(sideChatParentTitle)+`)`)
	// A CLI-launched WKWebView may stay hidden; the shared UI opens its event
	// streams only while the document is visible (cloud_whitebox_test.go).
	if _, err := page.Eval(`
		if (document.visibilityState === "hidden") {
			Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
			document.dispatchEvent(new Event("visibilitychange"));
		}
	`); err != nil {
		t.Fatal(err)
	}
	// The draft exists before the child is opened: this is the restored draft
	// the user returns to, not text typed in this run.
	if _, err := page.Eval(`localStorage.setItem(` + strconv.Quote(sideChatDraftKey) +
		`, JSON.stringify({version: 1, input: ` + strconv.Quote(sideChatCompactDraft) +
		`, capability_ids: [], knowledge_base_ids: []}))`); err != nil {
		t.Fatal(err)
	}
	if _, err := page.Eval(`document.querySelector('button[aria-label="Open side chat"]').click()`); err != nil {
		t.Fatal(err)
	}
	// Gate on the restored text and persisted draft before reading the action,
	// so an old Web build fails on the absent Stop only.
	whiteboxWait(t, page, sideChatDraftWait(sideChatCompactDraft))
	whiteboxWait(t, page, `(() => { const aside = `+sideChatAsideJS+`; return !!aside?.querySelector('button[aria-label="Stop"]') || !!aside?.querySelector('button[aria-label="Send"]'); })()`)
	actions, err := page.Eval(`(() => { const aside = ` + sideChatAsideJS + `; if (!aside) return ""; return (aside.querySelector('button[aria-label="Stop"]') ? "stop" : "") + (aside.querySelector('button[aria-label="Send"]') ? "send" : ""); })()`)
	if err != nil {
		t.Fatal(err)
	}
	if actions != "stop" {
		t.Fatalf("running local child with a restored %q draft shows action=%q, want stop only", sideChatCompactDraft, actions)
	}
	whiteboxWait(t, page, `(() => { const field = `+sideChatComposerJS+`; const note = document.getElementById(field?.getAttribute("aria-describedby") || ""); return note?.textContent.trim() === `+strconv.Quote(sideChatBlockedNote)+`; })()`)
	if mutations := fixture.snapshot(); len(mutations) != 0 {
		t.Fatalf("unexpected pre-journey conversation mutations: %v", mutations)
	}

	// Enter and the form's own submit path are both no-ops while the quote is
	// blocked. The bounded quiet window is this negative boundary.
	if _, err := page.Eval(`(() => { const aside = ` + sideChatAsideJS + `; const field = aside.querySelector('textarea[aria-label="Task composer"]'); if (!field.form) throw new Error("composer form missing"); field.focus(); field.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true})); field.form.requestSubmit(); })()`); err != nil {
		t.Fatal(err)
	}
	time.Sleep(300 * time.Millisecond)
	if mutations := fixture.snapshot(); len(mutations) != 0 {
		t.Fatalf("a blocked send attempt reached the API: %v", mutations)
	}

	// The explicit Stop click must interrupt the projected child turn by its
	// exact id and produce nothing else.
	if _, err := page.Eval(`(() => { const aside = ` + sideChatAsideJS + `; aside.querySelector('button[aria-label="Stop"]').click(); })()`); err != nil {
		t.Fatal(err)
	}
	stopped := sideChatWaitMutation(t, fixture, 0)
	if stopped.method != http.MethodPost || stopped.path != sideChatInterruptPath || !stopped.authorized || stopped.query != "" {
		t.Fatalf("Stop produced %s %s authorized=%v query=%q, want one authenticated POST %s", stopped.method, stopped.path, stopped.authorized, stopped.query, sideChatInterruptPath)
	}
	whiteboxWait(t, page, sideChatDraftWait(sideChatCompactDraft))
	t.Logf("explicit Stop POST %s (authenticated=%v); restored draft retained", stopped.path, stopped.authorized)

	// Release the schema-valid child terminal event and require the real
	// WebView to consume it: the session cursor advances to the event id while
	// the detail projection flips the child to idle.
	fixture.complete()
	whiteboxWait(t, page, `sessionStorage.getItem(`+strconv.Quote(sideChatCursorKey)+`) === `+strconv.Quote(sideChatChildID+":1"))
	whiteboxWait(t, page, `document.body.innerText.includes(`+strconv.Quote(sideChatTerminalReply)+`)`)
	whiteboxWait(t, page, `(() => { const aside = `+sideChatAsideJS+`; if (!aside) return false; const field = aside.querySelector('textarea[aria-label="Task composer"]'); const send = aside.querySelector('button[aria-label="Send"]'); return !!send && send.disabled === false && !aside.querySelector('button[aria-label="Stop"]') && field?.getAttribute("aria-describedby") === null && !aside.textContent.includes(`+strconv.Quote(sideChatBlockedNote)+`); })()`)
	whiteboxWait(t, page, sideChatDraftWait(sideChatCompactDraft))

	// Edit the now-idle default-mode child draft normally and send it.
	edited := sideChatQuoteDraft
	if _, err := page.Eval(`(() => { const field = ` + sideChatComposerJS + `; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, ` + strconv.Quote(edited) + `); field.dispatchEvent(new Event("input", {bubbles: true})); })()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, sideChatDraftWait(edited))
	if _, err := page.Eval(`(() => { const send = ` + sideChatAsideJS + `?.querySelector('button[aria-label="Send"]'); if (!send || send.disabled) throw new Error("Send is not available after the projection"); send.click(); })()`); err != nil {
		t.Fatal(err)
	}
	quote := sideChatWaitMutation(t, fixture, 1)
	// One bounded quiet window asserts the quote produced no extra mutation.
	time.Sleep(300 * time.Millisecond)
	mutations := fixture.snapshot()
	if len(mutations) != 2 {
		t.Fatalf("the side-chat journey made %v, want the child interrupt and one direct quote", mutations)
	}
	if quote.method != http.MethodPost || quote.path != sideChatTurnsPath || !quote.authorized || quote.query != "" {
		t.Fatalf("direct quote = %s %s authorized=%v query=%q, want one authenticated POST %s", quote.method, quote.path, quote.authorized, quote.query, sideChatTurnsPath)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(quote.body), &fields); err != nil {
		t.Fatalf("direct quote body is not JSON: %v", err)
	}
	// turnSubmissionBodySchema's structured branch is strict. Only its keys are
	// allowed, so the input_text branch, file_ids, message_source, aliases, and
	// typos cannot pass as a direct quote.
	structuredFields := map[string]struct{}{
		"message_display": {}, "collaboration_mode": {},
		"priority_capability_ids": {}, "knowledge_base_ids": {},
		"idempotency_key": {}, "submit_mode": {},
	}
	for field := range fields {
		if _, allowed := structuredFields[field]; !allowed {
			t.Fatalf("direct quote body carries %q outside the structured turn contract", field)
		}
	}
	var mode string
	if err := json.Unmarshal(fields["collaboration_mode"], &mode); err != nil || mode != "default" {
		t.Fatalf("direct quote collaboration_mode=%q (%v), want %q", mode, err, "default")
	}
	var display map[string]string
	if err := json.Unmarshal(fields["message_display"], &display); err != nil {
		t.Fatalf("direct quote message_display is not the strict kind/reference_id/request object: %v", err)
	}
	wantDisplay := map[string]string{
		"kind": "conversation_reference", "reference_id": sideChatReferenceID, "request": edited,
	}
	if !maps.Equal(display, wantDisplay) {
		t.Fatal("direct quote message_display keys or values do not match the strict conversation_reference object")
	}
	if strings.Contains(quote.body, sideChatParentID) {
		t.Fatal("the direct quote body named the parent conversation")
	}
	t.Logf("direct quote POST %s with collaboration_mode=%q and strict conversation_reference %s; %s consumed; no parent/queue/steer/compact calls",
		quote.path, mode, sideChatReferenceID, sideChatCursorKey)
}
