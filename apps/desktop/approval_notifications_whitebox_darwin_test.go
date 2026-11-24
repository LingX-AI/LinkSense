//go:build desktop_whitebox

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

const (
	approvalWhiteboxRequest    = "41000000-0000-4000-8000-000000000001"
	approvalWhiteboxRoute      = "/api/v1/conversations/desktop-approval-notifications"
	approvalWhiteboxOtherOwner = "10000000-0000-4000-8000-000000000002"

	// Each direct admission probe uses its own request so a refusal cannot be
	// confused with the allowed React reminder or with another probe.
	approvalWhiteboxForegroundRequest = "41000000-0000-4000-8000-000000000002"
	approvalWhiteboxDirectRequest     = "41000000-0000-4000-8000-000000000003"
	approvalWhiteboxOtherOwnerRequest = "41000000-0000-4000-8000-000000000004"
	approvalWhiteboxMalformedRequest  = "not-a-uuid"
	approvalWhiteboxExpiredRequest    = "41000000-0000-4000-8000-000000000006"
	approvalWhiteboxOverlongRequest   = "41000000-0000-4000-8000-000000000007"
)

// installApprovalWhitebox serves only the point-in-time approval snapshot.
// "pending" flips the exact pair between notification and click without
// changing any other fixture route.
func installApprovalWhitebox(t *testing.T) (*atomic.Bool, *atomic.Int32, *atomic.Int32) {
	t.Helper()
	pending := &atomic.Bool{}
	pending.Store(true)
	snapshots := &atomic.Int32{}
	exactChecks := &atomic.Int32{}
	// Stable across every poll of this pending snapshot, so foreground and
	// hidden reads compare the same request rather than a fresh deadline.
	expiresAt := time.Now().Add(2 * time.Minute).UTC().Format(time.RFC3339Nano)
	api := nativeWhiteboxAPI(func(w http.ResponseWriter, r *http.Request) bool {
		if r.URL.Path != approvalWhiteboxRoute || r.Method != http.MethodGet {
			return false
		}
		if !cloudAuthorized(w, r) {
			return true
		}
		conversationID := r.URL.Query().Get("conversation_id")
		requestID := r.URL.Query().Get("request_id")
		if (conversationID == "") != (requestID == "") {
			w.WriteHeader(http.StatusBadRequest)
			return true
		}
		if conversationID == "" {
			snapshots.Add(1)
		} else {
			exactChecks.Add(1)
		}
		items := []any{}
		if pending.Load() &&
			(conversationID == "" ||
				(conversationID == cloudConversation && requestID == approvalWhiteboxRequest)) {
			items = append(items, map[string]any{
				"conversation_id": cloudConversation,
				"request_id":      approvalWhiteboxRequest,
				"expires_at":      expiresAt,
			})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true,
			"data":    map[string]any{"items": items},
		})
		return true
	})
	nativeWhitebox.api.Store(&api)
	t.Cleanup(func() {
		nativeWhitebox.api.Store(nil)
	})
	return pending, snapshots, exactChecks
}

func whiteboxWaitApprovalChecks(t *testing.T, checks *atomic.Int32, want int32) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	for ctx.Err() == nil {
		if checks.Load() >= want {
			return
		}
		select {
		case <-ctx.Done():
		case <-time.After(50 * time.Millisecond):
		}
	}
	t.Fatalf("approval exact checks = %d, want at least %d", checks.Load(), want)
}

func waitApprovalWhiteboxAccount(t *testing.T, desktop *Desktop) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	for ctx.Err() == nil {
		if lease, err := requireAccount(&desktop.account); err == nil && lease.id == notificationUserID {
			return
		}
		select {
		case <-ctx.Done():
		case <-time.After(50 * time.Millisecond):
		}
	}
	t.Fatal("the authenticated page did not establish the native account from its refresh")
}

func approvalWhiteboxNotificationID(desktop *Desktop, userID string) string {
	return approvalNotificationID(
		desktop.approvalNotificationPrefix(),
		userID,
		cloudConversation,
		approvalWhiteboxRequest,
	)
}

func approvalWhiteboxInputID(desktop *Desktop, input DesktopApprovalNotificationInput) string {
	return approvalNotificationID(
		desktop.approvalNotificationPrefix(),
		input.UserID,
		input.ConversationID,
		input.RequestID,
	)
}

// whiteboxApprovalCall invokes the real approval binding from the trusted main
// page and returns its bridge error text, "" when the call succeeded.
func whiteboxApprovalCall(t *testing.T, page *mygo.Page, input DesktopApprovalNotificationInput) string {
	t.Helper()
	payload, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	value, err := page.EvalContext(ctx, fmt.Sprintf(
		`mygo.call("Desktop.ShowApprovalNotification", %s).then(() => "", error => String(error))`,
		payload,
	))
	if err != nil {
		t.Fatal(err)
	}
	message, ok := value.(string)
	if !ok {
		t.Fatalf("approval binding returned %T, want a string result", value)
	}
	return message
}

// whiteboxFocusMainWindow gives AppKit a bounded chance to make the real
// window visible and focused, the precondition of the foreground-refusal
// branch. A runner that keeps focus elsewhere makes only that branch
// unavailable; it never changes the platform seam or the hidden case.
func whiteboxFocusMainWindow(win *mygo.Window) bool {
	deadline := time.Now().Add(5 * time.Second)
	for {
		win.Show()
		win.Focus()
		if win.IsVisible() && win.IsFocused() {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// TestNativeApprovalNotificationBackgroundAndGuardedClick exercises the real
// WKWebView path: an opt-in approval reminder, a hidden delivery, a cold-start
// click, the existing unsaved-draft blocker, a request resolved before the
// click, and an owner mismatch. Only MyGo's system delivery is synthetic.
func TestNativeApprovalNotificationBackgroundAndGuardedClick(t *testing.T) {
	nativeWhiteboxSession(t, true)
	d := nativeWhitebox.desktop
	pending, snapshots, exactChecks := installApprovalWhitebox(t)
	supported, show := desktopNativeNotifications, showSystemNotification
	var shownMu sync.Mutex
	var shown []mygo.NotificationOptions
	delivered := make(chan mygo.NotificationOptions, 4)
	desktopNativeNotifications = func() bool { return true }
	showSystemNotification = func(ctx context.Context, options mygo.NotificationOptions) error {
		shownMu.Lock()
		shown = append(shown, options)
		shownMu.Unlock()
		select {
		case delivered <- options:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	defer func() {
		desktopNativeNotifications, showSystemNotification = supported, show
	}()
	shownFor := func(id string) []mygo.NotificationOptions {
		shownMu.Lock()
		defer shownMu.Unlock()
		var matches []mygo.NotificationOptions
		for _, options := range shown {
			if options.ID == id {
				matches = append(matches, options)
			}
		}
		return matches
	}
	shownCount := func() int {
		shownMu.Lock()
		defer shownMu.Unlock()
		return len(shown)
	}

	d.openMainWindow()
	win := d.mainWindow()
	page := win.Page()
	whiteboxWait(t, page, `location.pathname === "/conversations/new" && document.body.innerText.includes("Eli")`)
	waitApprovalWhiteboxAccount(t, d)
	mygo.RunOnMain(func() { d.navigateMainWindow("/settings/general") })
	masterToggle := `document.querySelector('[role="switch"][aria-label="Enable macOS notifications"]')`
	whiteboxWait(t, page, masterToggle+` !== null`)
	// Use the same isolated opt-in path as the completion and update fixtures:
	// clear only this account's notification keys and reload so the switches are
	// default-off and the page's in-memory delivery history is discarded.
	nativeClearNotificationPreferences(t, page)
	whiteboxReload(t, page)
	whiteboxWait(t, page, `location.pathname === "/settings/general" && document.querySelector("#browser-notifications-heading") !== null`)
	whiteboxWait(t, page, masterToggle+`?.getAttribute("aria-checked") === "false"`)
	if _, err := page.Eval(masterToggle + `.click()`); err != nil {
		t.Fatal(err)
	}
	select {
	case notification := <-delivered:
		if notification.ID != testNotificationID {
			t.Fatalf("opt-in delivered %q before the approval reminder", notification.ID)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("enabling notifications did not show its test notification")
	}
	whiteboxWait(t, page, masterToggle+`?.getAttribute("aria-checked") === "true"`)

	approvalToggle := `document.querySelector('[role="switch"][aria-label="Approval reminders"]')`
	whiteboxWait(t, page, approvalToggle+` !== null`)
	whiteboxWait(t, page, approvalToggle+`?.getAttribute("aria-checked") === "false"`)
	if _, err := page.Eval(approvalToggle + `.click()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, approvalToggle+`?.getAttribute("aria-checked") === "true"`)

	// The real AppKit window is the bounded precondition for the foreground
	// refusal: the guard runs only when this host reports both visible and
	// focused. The runner can own focus, so an unavailable focus skips only
	// this environment-dependent case, never the hidden positive below.
	if whiteboxFocusMainWindow(win) {
		foreground := DesktopApprovalNotificationInput{
			UserID: notificationUserID, ConversationID: cloudConversation,
			RequestID: approvalWhiteboxForegroundRequest, ExpiresAt: time.Now().Add(time.Minute),
		}
		focused := win.IsFocused()
		before := shownCount()
		message := whiteboxApprovalCall(t, page, foreground)
		if !focused || !win.IsFocused() {
			t.Log("the AppKit window lost focus during the foreground approval call")
		} else {
			if !strings.Contains(message, errDesktopApprovalNotificationStale.Error()) {
				t.Fatalf("a focused window accepted the approval reminder: %q", message)
			}
			if got := shownCount(); got != before {
				t.Fatalf("a focused window reached system delivery: %d -> %d", before, got)
			}
		}
	} else {
		t.Log("the AppKit window never took focus; foreground approval denial was not exercised")
	}

	win.Hide()
	whiteboxWait(t, page, `document.visibilityState === "hidden" || document.hasFocus() === false`)
	var notification mygo.NotificationOptions
	select {
	case notification = <-delivered:
	case <-time.After(15 * time.Second):
		t.Fatal("the hidden WKWebView did not deliver the approval reminder")
	}
	wantID := approvalWhiteboxNotificationID(d, notificationUserID)
	if notification.ID != wantID || notification.Title != mygo.App.Name() ||
		notification.Body != "A task is waiting for your approval." || !notification.Silent {
		t.Fatalf("unexpected approval notification: %+v", notification)
	}

	// The same trusted main page, now genuinely hidden, calls the real public
	// approval binding. Each row has its own IDs, so a denied call cannot be
	// confused with the allowed React reminder above; the expected error code
	// proves which admission check refused it, and the native recorder proves
	// no row reached system delivery.
	now := time.Now()
	for _, tc := range []struct {
		name  string
		input DesktopApprovalNotificationInput
		want  error
	}{
		{"wrong owner", DesktopApprovalNotificationInput{
			UserID: approvalWhiteboxOtherOwner, ConversationID: cloudConversation,
			RequestID: approvalWhiteboxOtherOwnerRequest, ExpiresAt: now.Add(time.Minute),
		}, errDesktopApprovalNotificationStale},
		{"malformed UUID", DesktopApprovalNotificationInput{
			UserID: notificationUserID, ConversationID: cloudConversation,
			RequestID: approvalWhiteboxMalformedRequest, ExpiresAt: now.Add(time.Minute),
		}, errDesktopApprovalNotificationInvalid},
		{"expired deadline", DesktopApprovalNotificationInput{
			UserID: notificationUserID, ConversationID: cloudConversation,
			RequestID: approvalWhiteboxExpiredRequest, ExpiresAt: now.Add(-time.Second),
		}, errDesktopApprovalNotificationStale},
		{"deadline beyond ttl", DesktopApprovalNotificationInput{
			UserID: notificationUserID, ConversationID: cloudConversation,
			RequestID: approvalWhiteboxOverlongRequest,
			ExpiresAt: now.Add(approvalNotificationMaxLifetime + time.Second),
		}, errDesktopApprovalNotificationStale},
	} {
		before := shownCount()
		message := whiteboxApprovalCall(t, page, tc.input)
		if !strings.Contains(message, tc.want.Error()) {
			t.Fatalf("%s approval call = %q, want %s", tc.name, message, tc.want)
		}
		if got := shownCount(); got != before {
			t.Fatalf("%s reached system delivery: %d -> %d", tc.name, before, got)
		}
		if got := len(shownFor(approvalWhiteboxInputID(d, tc.input))); got != 0 {
			t.Fatalf("%s was delivered with its input IDs %d times", tc.name, got)
		}
	}

	// The same hidden trusted page must still pass every admission check for
	// the current owner and a live deadline.
	direct := DesktopApprovalNotificationInput{
		UserID: notificationUserID, ConversationID: cloudConversation,
		RequestID: approvalWhiteboxDirectRequest, ExpiresAt: time.Now().Add(time.Minute),
	}
	if message := whiteboxApprovalCall(t, page, direct); message != "" {
		t.Fatalf("a hidden trusted page could not show an approval reminder: %q", message)
	}
	directShown := shownFor(approvalWhiteboxInputID(d, direct))
	if len(directShown) != 1 {
		t.Fatalf("hidden trusted approval delivery calls = %d, want 1", len(directShown))
	}
	if got := directShown[0]; got.Title != mygo.App.Name() ||
		got.Body != "A task is waiting for your approval." || !got.Silent {
		t.Fatalf("unexpected direct approval notification: %+v", got)
	}

	// A cold start still queues the click for the matching origin and owner.
	win.Destroy()
	d.openMainWindow()
	launchWin := d.mainWindow()
	defer launchWin.Destroy()
	page = launchWin.Page()
	d.handleNotificationClick(notification.ID)
	whiteboxWait(t, page, fmt.Sprintf(`location.pathname === %q`, "/conversations/"+cloudConversation))

	// The same benign destination goes through the existing unsaved draft
	// blocker. Declining keeps the draft; confirming opens the task.
	nativePersonalizationDraft(t, page, "Unsaved approval fixture")
	d.handleNotificationClick(notification.ID)
	whiteboxWait(t, page, `location.pathname === "/settings/personalization" && !!document.querySelector("[role=alertdialog]") && document.querySelector("#custom-instructions").value === "Unsaved approval fixture"`)
	if _, err := page.Eval(`Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(button => button.textContent.trim() === "Stay on Page")?.click()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, `!document.querySelector("[role=alertdialog]") && location.pathname === "/settings/personalization"`)
	d.handleNotificationClick(notification.ID)
	whiteboxWait(t, page, `!!document.querySelector("[role=alertdialog]")`)
	if _, err := page.Eval(`Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(button => button.textContent.trim() === "Discard Changes")?.click()`); err != nil {
		t.Fatal(err)
	}
	whiteboxWait(t, page, fmt.Sprintf(`location.pathname === %q`, "/conversations/"+cloudConversation))

	// The request is resolved between the banner and the click. The exact-pair
	// recheck returns nothing, so the app stays where it is.
	mygo.RunOnMain(func() { d.navigateMainWindow("/settings/general") })
	whiteboxWait(t, page, `location.pathname === "/settings/general"`)
	pending.Store(false)
	beforeExact := exactChecks.Load()
	d.handleNotificationClick(notification.ID)
	whiteboxWaitApprovalChecks(t, exactChecks, beforeExact+1)
	whiteboxWait(t, page, `new Promise(resolve => setTimeout(() => resolve(location.pathname === "/settings/general"), 500))`)

	// A notification written for another account never verifies. It must not
	// even issue the exact-pair read for the current owner.
	pending.Store(true)
	beforeExact = exactChecks.Load()
	d.handleNotificationClick(approvalWhiteboxNotificationID(d, approvalWhiteboxOtherOwner))
	whiteboxWait(t, page, `new Promise(resolve => setTimeout(() => resolve(location.pathname === "/settings/general"), 500))`)
	if got := exactChecks.Load(); got != beforeExact {
		t.Fatalf("a foreign owner reached the exact-pair read: %d -> %d", beforeExact, got)
	}
	if snapshots.Load() == 0 {
		t.Fatal("the WebView did not exercise the approval snapshot read")
	}
}
