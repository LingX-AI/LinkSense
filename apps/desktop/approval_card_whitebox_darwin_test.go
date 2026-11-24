//go:build desktop_whitebox

package main

// P1-13a Gap A: the shared Web UI's pending native desktop-approval card,
// rendered in the real macOS WKWebView and served by a disposable loopback
// fixture. One visible Allow once click must produce one exact approval POST,
// stay disabled while the fixture holds that request, and become the retained
// read-only approved card after the successful response refreshes the
// conversation projection.
//
// An answered approval is not removed from the running turn's timeline: the
// shared display contract maps answered+accept to data-request-status="approved"
// and renders no decision buttons for a non-pending request.
//
// The approval has no runtime effect here: the fixture only writes one
// harmless success envelope. No shell command, file change, account, or
// approval delivery is executed.
//
// Contracts followed by the fixture:
//   - apps/web/src/pages/conversation-pages.tsx respondDesktopApprovalMutation
//   - apps/web/src/features/conversations/conversation-detail-query.ts
//   - packages/shared/src/conversation-forms.ts desktopApprovalResponseSchema
//   - packages/shared/src/events.ts desktopApprovalRequestSchema

import (
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

const (
	approvalCardConversation   = "d1000000-0000-4000-8000-000000000001"
	approvalCardTurn           = "d1000000-0000-4000-8000-000000000002"
	approvalCardRequest        = "d1000000-0000-4000-8000-000000000003"
	approvalCardItem           = "native-approval-fixture"
	approvalCardCommand        = "printf hello"
	approvalCardCwd            = "$WORKSPACE"
	approvalCardFixtureTime    = "2026-11-20T10:00:00.000Z"
	approvalCardResolvedAt     = "2026-11-20T10:01:00.000Z"
	approvalCardAutoResolveAt  = "2026-11-20T10:03:00.000Z"
	approvalCardCommandMethod  = "item/commandExecution/requestApproval"
	approvalCardConversationID = "/api/v1/conversations/" + approvalCardConversation
	approvalCardDecisionPath   = approvalCardConversationID + "/approvals/" + approvalCardRequest
	approvalCardCardSelector   = `document.querySelector('[data-testid="conversation-user-input-request"][data-request-kind="desktop_approval"]')`
	approvalCardAllowSelector  = `Array.from((` + approvalCardCardSelector + `)?.querySelectorAll("button") ?? []).find(button => button.textContent.trim() === "Allow once")`
)

type approvalCardMutation struct {
	method, path, query, body, contentType string
	authorized, forceQuery                 bool
}

type approvalCardWhitebox struct {
	mu           sync.Mutex
	mutations    []approvalCardMutation
	detailGets   atomic.Int32
	answeredGets atomic.Int32
	eventStreams atomic.Int32
	answered     atomic.Bool
	decisionSeen chan struct{}
	release      chan struct{}
	done         chan struct{}
	seenOnce     sync.Once
	releaseOnce  sync.Once
	doneOnce     sync.Once
}

func newApprovalCardWhitebox() *approvalCardWhitebox {
	return &approvalCardWhitebox{
		decisionSeen: make(chan struct{}),
		release:      make(chan struct{}),
		done:         make(chan struct{}),
	}
}

func (f *approvalCardWhitebox) stop() {
	f.doneOnce.Do(func() { close(f.done) })
}

func (f *approvalCardWhitebox) releaseResponse() {
	f.releaseOnce.Do(func() { close(f.release) })
}

func (f *approvalCardWhitebox) record(mutation approvalCardMutation) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.mutations = append(f.mutations, mutation)
}

func (f *approvalCardWhitebox) snapshot() []approvalCardMutation {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]approvalCardMutation(nil), f.mutations...)
}

func (f *approvalCardWhitebox) serve(w http.ResponseWriter, r *http.Request) bool {
	path := r.URL.Path
	mutating := r.Method == http.MethodPost || r.Method == http.MethodPut ||
		r.Method == http.MethodPatch || r.Method == http.MethodDelete
	switch {
	case path == approvalCardConversationID && r.Method == http.MethodGet:
		f.detailGets.Add(1)
		if f.answered.Load() {
			f.answeredGets.Add(1)
		}
		writeCloudData(w, approvalCardDetail(f.answered.Load()))
		return true
	case path == approvalCardConversationID+"/events" && r.Method == http.MethodGet:
		f.eventStreams.Add(1)
		writeApprovalCardEvents(w, r, f.done)
		return true
	case mutating && strings.HasPrefix(path, approvalCardConversationID+"/"):
		body, _ := io.ReadAll(io.LimitReader(r.Body, 8<<10))
		authorized := cloudAuthorized(w, r)
		f.record(approvalCardMutation{
			method: r.Method, path: path, query: r.URL.RawQuery,
			body: string(body), contentType: r.Header.Get("Content-Type"),
			authorized: authorized, forceQuery: r.URL.ForceQuery,
		})
		if !authorized {
			return true
		}
		if r.Method != http.MethodPost || path != approvalCardDecisionPath {
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"success":false,"error_code":"FIXTURE_PATH_UNSUPPORTED"}`)
			return true
		}
		f.seenOnce.Do(func() { close(f.decisionSeen) })
		select {
		case <-f.release:
		case <-f.done:
		case <-r.Context().Done():
			return true
		case <-time.After(30 * time.Second):
			return true
		}
		f.answered.Store(true)
		writeCloudData(w, approvalCardRequestFixture("answered"))
		return true
	}
	return false
}

func (f *approvalCardWhitebox) assertOnlyApprovalDecision(t *testing.T) approvalCardMutation {
	t.Helper()
	mutations := f.snapshot()
	if len(mutations) != 1 {
		t.Fatalf("the one-time approval produced %d conversation mutation(s): %+v", len(mutations), mutations)
	}
	decision := mutations[0]
	if decision.method != http.MethodPost || decision.path != approvalCardDecisionPath ||
		decision.query != "" || decision.forceQuery {
		t.Fatalf("approval reached the wrong request: %s %s?%s (forceQuery=%t)",
			decision.method, decision.path, decision.query, decision.forceQuery)
	}
	if !decision.authorized {
		t.Fatal("the approval POST was not authenticated")
	}
	if !strings.HasPrefix(decision.contentType, "application/json") {
		t.Fatalf("approval content type = %q, want application/json", decision.contentType)
	}
	var body map[string]string
	if err := json.Unmarshal([]byte(decision.body), &body); err != nil {
		t.Fatalf("approval body is not the shared two-field JSON object: %v (%q)", err, decision.body)
	}
	want := map[string]string{"method": approvalCardCommandMethod, "decision": "accept"}
	if !maps.Equal(body, want) {
		t.Fatalf("approval body = %s, want exactly %s", decision.body, `{"method":"`+approvalCardCommandMethod+`","decision":"accept"}`)
	}
	return decision
}

func TestNativeDesktopApprovalAllowOncePostsOnceAndLeavesPending(t *testing.T) {
	nativeWhiteboxSession(t, true)
	fixture := newApprovalCardWhitebox()
	serve := nativeWhiteboxAPI(fixture.serve)
	nativeWhitebox.api.Store(&serve)
	t.Cleanup(func() {
		fixture.releaseResponse()
		fixture.stop()
		nativeWhitebox.api.Store(nil)
	})

	desktop := nativeWhitebox.desktop
	// The real AppKit/WKWebView host is the subject; an ephemeral WebView
	// session keeps the fixture out of the developer store.
	desktop.openMainWindowInSession(mygo.NewEphemeralSession())
	win := desktop.mainWindow()
	if win == nil {
		t.Fatal("the native main window was not created")
	}
	t.Cleanup(win.Destroy)
	// Release any still-held fixture response before window teardown can wait
	// on the WebView's in-flight fetch. This is a no-op after the normal test.
	t.Cleanup(fixture.releaseResponse)
	page := win.Page()
	if err := page.LoadURL("/conversations/" + approvalCardConversation); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `(() => {
		const card = `+approvalCardCardSelector+`;
		return card?.getAttribute("data-request-status") === "pending" &&
			card.innerText.includes("Allow this command to run?") &&
			card.innerText.includes(`+fmt.Sprintf("%q", approvalCardCommand)+`) &&
			card.innerText.includes("Allow once");
	})()`)
	whiteboxWait(t, page, `(`+approvalCardAllowSelector+`) !== undefined`)
	if disabled, err := page.Eval(`(` + approvalCardAllowSelector + `)?.disabled === true`); err != nil || disabled != false {
		t.Fatalf("the pending Allow once action was not enabled: disabled=%v err=%v", disabled, err)
	}
	if mutations := fixture.snapshot(); len(mutations) != 0 {
		t.Fatalf("the pending approval was answered before the click: %+v", mutations)
	}

	if _, err := page.Eval(`(` + approvalCardAllowSelector + `).click()`); err != nil {
		t.Fatal(err)
	}
	select {
	case <-fixture.decisionSeen:
	case <-time.After(10 * time.Second):
		t.Fatal("the visible Allow once action did not reach the approval endpoint")
	}

	// The fixture holds the response: the card must show its own in-flight
	// state and the same control must be disabled before the server answers.
	whiteboxWait(t, page, `(`+approvalCardCardSelector+`)?.getAttribute("data-request-status") === "submitting"`)
	whiteboxWait(t, page, `(`+approvalCardAllowSelector+`) !== undefined`)
	if disabled, err := page.Eval(`(` + approvalCardAllowSelector + `)?.disabled === true`); err != nil || disabled != true {
		t.Fatalf("the Allow once action was not disabled while answering: disabled=%v err=%v", disabled, err)
	}
	if _, err := page.Eval(`(` + approvalCardAllowSelector + `).click()`); err != nil {
		t.Fatal(err)
	}
	time.Sleep(350 * time.Millisecond)
	if status, err := page.Eval(`(` + approvalCardCardSelector + `)?.getAttribute("data-request-status")`); err != nil || status != "submitting" {
		t.Fatalf("the card left its in-flight state before the fixture answered: status=%v err=%v", status, err)
	}
	decision := fixture.assertOnlyApprovalDecision(t)

	detailGetsBeforeAnswer := fixture.detailGets.Load()
	fixture.releaseResponse()
	// The answered approval stays in the running turn's timeline as a
	// read-only card. getConversationUserInputDisplayStatus maps
	// answered+accept to "approved", and DesktopApprovalDetails offers
	// decisions only while the request is pending.
	whiteboxWait(t, page, `(() => {
		const cards = Array.from(document.querySelectorAll('[data-testid="conversation-user-input-request"][data-request-kind="desktop_approval"]'));
		const card = cards[0];
		return cards.length === 1 &&
			card.getAttribute("data-request-status") === "approved" &&
			card.querySelector('[role="status"]')?.textContent.trim() === "Approved" &&
			card.querySelectorAll("button").length === 0;
	})()`)
	if fixture.detailGets.Load() <= detailGetsBeforeAnswer || fixture.answeredGets.Load() == 0 {
		t.Fatalf("the card reported approved without a conversation projection refresh: detail GETs %d -> %d, answered GETs=%d",
			detailGetsBeforeAnswer, fixture.detailGets.Load(), fixture.answeredGets.Load())
	}
	if !fixture.answered.Load() {
		t.Fatal("the fixture never released a successful approval response")
	}
	// The mutation's onError path also refreshes the projection, so require
	// the shared error toast to stay absent: the fixture response must have
	// been accepted as a successful desktop-approval projection. The bounded
	// settle window lets the mutation's state render before the toast check.
	time.Sleep(200 * time.Millisecond)
	if errorToasts, err := page.Eval(`Array.from(document.querySelectorAll('[data-sonner-toast][data-type="error"]'))
		.filter(toast => toast.getAttribute("data-removed") !== "true" && toast.getAttribute("data-visible") !== "false")
		.length === 0`); err != nil || errorToasts != true {
		t.Fatalf("the approval response produced an error toast: absent=%v err=%v", errorToasts, err)
	}
	fixture.assertOnlyApprovalDecision(t)

	t.Logf("visible click: Allow once; POST %s body=%s authorized=%t",
		decision.path, decision.body, decision.authorized)
	t.Logf("detail GETs: %d before answer -> %d after; answered projections: %d; SSE streams: %d",
		detailGetsBeforeAnswer, fixture.detailGets.Load(), fixture.answeredGets.Load(), fixture.eventStreams.Load())
}

func approvalCardDetail(answered bool) map[string]any {
	status := "pending"
	if answered {
		status = "answered"
	}
	return map[string]any{
		"conversation": map[string]any{
			"id": approvalCardConversation, "title": "Native approval fixture",
			"project_id": nil, "updated_at": approvalCardFixtureTime,
			"created_at": approvalCardFixtureTime, "archive_status": "active",
			"execution_target": "local", "execution_status": "running",
		},
		"turns": []any{map[string]any{
			"id": approvalCardTurn, "status": "running",
			"task_kind": "turn", "started_at": approvalCardFixtureTime,
		}},
		"messages":                  []any{},
		"desktop_approval_requests": []any{approvalCardRequestFixture(status)},
	}
}

func approvalCardRequestFixture(status string) map[string]any {
	var resolvedAt any
	var resolvedAction any
	updatedAt := approvalCardFixtureTime
	if status == "answered" {
		resolvedAt, resolvedAction, updatedAt = approvalCardResolvedAt, "accept", approvalCardResolvedAt
	}
	return map[string]any{
		"id": approvalCardRequest, "conversation_id": approvalCardConversation,
		"turn_id": approvalCardTurn, "item_id": approvalCardItem,
		"kind": "desktop_approval",
		"approval": map[string]any{
			"method": approvalCardCommandMethod,
			"decisions": []string{
				"accept", "decline", "cancel",
			},
			"command": approvalCardCommand,
			"cwd":     approvalCardCwd,
		},
		"status": status, "auto_resolve_at": approvalCardAutoResolveAt,
		"resolved_at": resolvedAt, "resolved_action": resolvedAction,
		"created_at": approvalCardFixtureTime, "updated_at": updatedAt,
	}
}

func writeApprovalCardEvents(w http.ResponseWriter, r *http.Request, done <-chan struct{}) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	if flush, ok := w.(http.Flusher); ok {
		flush.Flush()
	}
	select {
	case <-done:
	case <-r.Context().Done():
	case <-time.After(30 * time.Second):
	}
}
