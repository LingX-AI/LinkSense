package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
	"github.com/egoist/mygo"
)

const (
	notificationUserID         = "10000000-0000-4000-8000-000000000001"
	notificationConversationID = "20000000-0000-4000-8000-000000000001"
	notificationTurnID         = "30000000-0000-4000-8000-000000000001"
	notificationRequestID      = "40000000-0000-4000-8000-000000000001"
)

func TestCompletionNotificationIDsRoundTrip(t *testing.T) {
	desktop := &Desktop{server: &url.URL{Scheme: "https", Host: "one.example.test"}}
	prefix := desktop.completionNotificationPrefix()
	id := prefix + notificationUserID + ":" +
		notificationConversationID + ":" + notificationTurnID
	target, ok := parseCompletionNotificationID(id, prefix)
	if !ok || target.UserID != notificationUserID || target.ConversationID != notificationConversationID {
		t.Fatalf("parse %q = %+v, %t", id, target, ok)
	}
	other := &Desktop{server: &url.URL{Scheme: "https", Host: "two.example.test"}}
	if _, ok := parseCompletionNotificationID(id, other.completionNotificationPrefix()); ok {
		t.Fatal("opened a notification from another server")
	}
}

func TestCompletionNotificationIDsAcceptOnlyAppWrittenUUIDs(t *testing.T) {
	desktop := &Desktop{server: &url.URL{Scheme: "https", Host: "one.example.test"}}
	prefix := desktop.completionNotificationPrefix()
	for _, id := range []string{
		"",
		"https://example.com/conversations/" + notificationConversationID,
		"linksense:notification-test",
		updateNotificationID,
		prefix + notificationUserID + ":" + notificationConversationID,
		prefix + notificationUserID + ":" + notificationConversationID + ":" +
			notificationTurnID + ":extra",
		prefix + notificationUserID + ":../../etc/passwd:" + notificationTurnID,
		prefix + "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz:" +
			notificationConversationID + ":" + notificationTurnID,
	} {
		if target, ok := parseCompletionNotificationID(id, prefix); ok {
			t.Fatalf("accepted %q as %+v", id, target)
		}
	}
}

func TestNotificationTextRejectsEmptyControlAndOversizedValues(t *testing.T) {
	for _, tc := range []struct {
		value string
		ok    bool
	}{
		{"処理が中断されました", true},
		{"Processing interrupted", true},
		{"", false},
		{"line\nbreak", false},
		{"tab\tvalue", false},
		{strings.Repeat("a", notificationBodyMaxBytes+1), false},
		{string([]byte{0xff}), false},
	} {
		if got := validNotificationText(tc.value); got != tc.ok {
			t.Fatalf("validNotificationText(%q) = %t, want %t", tc.value, got, tc.ok)
		}
	}
}

func TestNotificationShowErrorsKeepDenialDistinct(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		want error
	}{
		{"shown", nil, nil},
		{"denied", mygo.ErrNotificationsDenied, errNotificationsDenied},
		{"canceled", context.Canceled, errNotificationsCanceled},
		{"deadline", context.DeadlineExceeded, errNotificationsCanceled},
		{"unsupported", errors.ErrUnsupported, errNotificationsUnsupported},
		{"failed", errors.New("system failure"), errNotificationsFailed},
	} {
		if got := notificationShowError(tc.err); !errors.Is(got, tc.want) && !(got == nil && tc.want == nil) {
			t.Fatalf("%s: notificationShowError = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestNotificationMethodsRejectUntrustedCallers(t *testing.T) {
	desktop := &Desktop{}
	if _, err := desktop.NotificationsSupported(context.Background()); err == nil {
		t.Fatal("an unbound caller read notification support")
	}
	if err := desktop.ShowCompletionNotification(context.Background(), CompletionNotificationInput{
		UserID: notificationUserID, ConversationID: notificationConversationID,
		TurnID: notificationTurnID, Body: "Processed successfully",
	}); err == nil {
		t.Fatal("an unbound caller showed a completion notification")
	}
	if err := desktop.ShowTestNotification(context.Background(), "Test"); err == nil {
		t.Fatal("an unbound caller showed a test notification")
	}
	desktop.handleNotificationClick("https://example.com")
}

func TestApprovalNotificationIDsRoundTripInTheirOwnServerNamespace(t *testing.T) {
	desktop := &Desktop{server: &url.URL{Scheme: "https", Host: "one.example.test"}}
	prefix := desktop.approvalNotificationPrefix()
	id := approvalNotificationID(prefix, notificationUserID, notificationConversationID, notificationRequestID)
	target, ok := parseApprovalNotificationID(id, prefix)
	if !ok || target.UserID != notificationUserID || target.ConversationID != notificationConversationID ||
		target.RequestID != notificationRequestID {
		t.Fatalf("parse %q = %+v, %t", id, target, ok)
	}
	// An approval id is not a completion id, and another server cannot open it.
	completionPrefix := desktop.completionNotificationPrefix()
	if _, ok := parseCompletionNotificationID(id, completionPrefix); ok {
		t.Fatal("an approval notification parsed as a completion notification")
	}
	if _, ok := parseApprovalNotificationID(id, (&Desktop{server: &url.URL{
		Scheme: "https", Host: "two.example.test",
	}}).approvalNotificationPrefix()); ok {
		t.Fatal("opened an approval notification from another server")
	}
}

func TestApprovalNotificationIDsAcceptOnlyAppWrittenUUIDs(t *testing.T) {
	desktop := &Desktop{server: &url.URL{Scheme: "https", Host: "one.example.test"}}
	prefix := desktop.approvalNotificationPrefix()
	for _, id := range []string{
		"",
		prefix + notificationUserID + ":" + notificationConversationID,
		prefix + notificationUserID + ":" + notificationConversationID + ":" + notificationRequestID + ":extra",
		prefix + notificationUserID + ":../../etc/passwd:" + notificationRequestID,
		prefix + notificationUserID + ":" + notificationConversationID + ":zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
		completionNotificationIDPrefix + notificationUserID + ":" + notificationConversationID + ":" + notificationTurnID,
		updateNotificationID,
	} {
		if target, ok := parseApprovalNotificationID(id, prefix); ok {
			t.Fatalf("accepted %q as %+v", id, target)
		}
	}
}

func TestApprovalNotificationClickPreservesLegacyCompletionJSON(t *testing.T) {
	legacy, err := json.Marshal(DesktopNotificationClick{
		UserID: notificationUserID, ConversationID: notificationConversationID,
	})
	if err != nil || strings.Contains(string(legacy), "requestId") {
		t.Fatalf("legacy click carried an approval field: %s, %v", legacy, err)
	}
	approval, err := json.Marshal(DesktopNotificationClick{
		UserID: notificationUserID, ConversationID: notificationConversationID,
		RequestID: notificationRequestID,
	})
	if err != nil || !strings.Contains(string(approval), `"requestId":"`+notificationRequestID+`"`) {
		t.Fatalf("approval click lost its request id: %s, %v", approval, err)
	}
}

func TestNativeApprovalNotificationIsLocalized(t *testing.T) {
	for locale, want := range map[string]string{
		"zh-CN": "有一项任务正在等待你的审批。",
		"en-US": "A task is waiting for your approval.",
		"es-ES": "Una tarea está esperando tu aprobación.",
		"pt-BR": "Uma tarefa está aguardando sua aprovação.",
		"fr-FR": "Une tâche attend votre approbation.",
		"ja-JP": "承認待ちのタスクがあります。",
		// MyGo falls back to the catalog's source language, zh-CN, when the
		// app does not ship the requested language.
		"de-DE": "有一项任务正在等待你的审批。",
	} {
		if got := locales.In(locale).ApprovalRequestNotice(); got != want {
			t.Fatalf("%s approval notification body = %q, want %q", locale, got, want)
		}
	}
}

func TestApprovalNotificationDeadlineStaysWithinTheServerTTL(t *testing.T) {
	now := time.Date(2026, 11, 24, 12, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name      string
		expiresAt time.Time
		ok        bool
	}{
		{"live", now.Add(2 * time.Minute), true},
		{"latest boundary", now.Add(approvalNotificationMaxLifetime), true},
		{"expired", now, false},
		{"past", now.Add(-time.Second), false},
		{"beyond ttl", now.Add(approvalNotificationMaxLifetime + time.Second), false},
	} {
		if got := approvalDeadlineValid(tc.expiresAt, now); got != tc.ok {
			t.Fatalf("%s: approvalDeadlineValid = %t, want %t", tc.name, got, tc.ok)
		}
	}
}

func TestApprovalNotificationRejectsUntrustedCallers(t *testing.T) {
	desktop := &Desktop{}
	err := desktop.ShowApprovalNotification(context.Background(), DesktopApprovalNotificationInput{
		UserID: notificationUserID, ConversationID: notificationConversationID,
		RequestID: notificationRequestID, ExpiresAt: time.Now().Add(time.Minute),
	})
	if err == nil {
		t.Fatal("an unbound caller showed an approval notification")
	}
}

func approvalNotificationInput(expiresAt time.Time) DesktopApprovalNotificationInput {
	return DesktopApprovalNotificationInput{
		UserID: notificationUserID, ConversationID: notificationConversationID,
		RequestID: notificationRequestID, ExpiresAt: expiresAt,
	}
}

func useSyntheticNativeNotifications(t *testing.T, show func(context.Context, mygo.NotificationOptions) error) {
	t.Helper()
	supported, previousShow := desktopNativeNotifications, showSystemNotification
	desktopNativeNotifications = func() bool { return true }
	showSystemNotification = show
	t.Cleanup(func() {
		desktopNativeNotifications, showSystemNotification = supported, previousShow
	})
}

func TestApprovalNotificationCancelsWhenTheAccountGenerationEnds(t *testing.T) {
	desktop := &Desktop{server: &url.URL{Scheme: "https", Host: "one.example.test"}}
	desktop.account.set(notificationUserID, time.Now().Add(time.Hour))
	lease, err := requireAccount(&desktop.account)
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	canceled := make(chan struct{})
	release := make(chan struct{})
	calls := 0
	useSyntheticNativeNotifications(t, func(ctx context.Context, _ mygo.NotificationOptions) error {
		calls++
		if calls > 1 {
			return nil
		}
		close(started)
		select {
		case <-ctx.Done():
			close(canceled)
			// A mock that ignores cancellation must not turn a canceled native
			// wait into a delivered receipt.
			return nil
		case <-release:
			return nil
		}
	})
	t.Cleanup(func() { close(release) })

	input := approvalNotificationInput(time.Now().Add(2 * time.Minute))
	done := make(chan error, 1)
	go func() { done <- desktop.deliverApprovalNotification(context.Background(), input, lease) }()
	<-started

	// A real sign-out or same-id replacement begins a new account generation.
	// The pending delivery must observe that cancellation instead of waiting for
	// the pinned deadline.
	desktop.account.clear()
	desktop.account.set(notificationUserID, time.Now().Add(time.Hour))
	select {
	case <-canceled:
	case <-time.After(2 * time.Second):
		t.Fatal("an invalidated account did not cancel the pending native delivery")
	}
	select {
	case err := <-done:
		if !errors.Is(err, errDesktopApprovalNotificationStale) {
			t.Fatalf("a canceled delivery returned %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("an invalidated account left the native delivery waiting")
	}

	// The replacement may show the same request id again; no native slot or
	// cleanup may suppress it.
	nextLease, err := requireAccount(&desktop.account)
	if err != nil {
		t.Fatal(err)
	}
	next := approvalNotificationInput(time.Now().Add(2 * time.Minute))
	if err := desktop.deliverApprovalNotification(context.Background(), next, nextLease); err != nil {
		t.Fatalf("the replacement account could not show the same request: %v", err)
	}
	if calls != 2 {
		t.Fatalf("native delivery calls = %d, want 2", calls)
	}
}

func TestApprovalNotificationSameGenerationRefreshKeepsPinnedDelivery(t *testing.T) {
	desktop := &Desktop{server: &url.URL{Scheme: "https", Host: "one.example.test"}}
	desktop.account.set(notificationUserID, time.Now().Add(2*time.Minute))
	lease, err := requireAccount(&desktop.account)
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	release := make(chan struct{})
	var deliveryCtx context.Context
	var deadline time.Time
	useSyntheticNativeNotifications(t, func(ctx context.Context, _ mygo.NotificationOptions) error {
		deliveryCtx = ctx
		deadline, _ = ctx.Deadline()
		close(started)
		<-release
		return nil
	})
	input := approvalNotificationInput(time.Now().Add(2 * time.Minute))
	done := make(chan error, 1)
	go func() { done <- desktop.deliverApprovalNotification(context.Background(), input, lease) }()
	<-started

	// A refresh for the same account generation extends the session for later
	// requests but must neither cancel nor revive this delivery.
	refreshedExpiry := time.Now().Add(time.Hour)
	desktop.account.set(notificationUserID, refreshedExpiry)
	select {
	case <-deliveryCtx.Done():
		t.Fatal("a same-generation refresh canceled the pending delivery")
	case <-time.After(100 * time.Millisecond):
	}
	if deadline.IsZero() || !deadline.Before(refreshedExpiry) || deadline.After(input.ExpiresAt.Add(time.Second)) {
		t.Fatalf("delivery deadline = %v, want the pinned request deadline %v", deadline, input.ExpiresAt)
	}
	close(release)
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("a same-generation refresh failed delivery: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("a same-generation refresh deadlocked delivery")
	}
}

func TestApprovalNotificationRejectsLateSuccessWhenRequestContextEnds(t *testing.T) {
	for _, tc := range []struct {
		name string
		ctx  func() (context.Context, context.CancelFunc)
	}{
		{"canceled", func() (context.Context, context.CancelFunc) {
			return context.WithCancel(context.Background())
		}},
		{"expired", func() (context.Context, context.CancelFunc) {
			return context.WithTimeout(context.Background(), 20*time.Millisecond)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			desktop := &Desktop{server: &url.URL{Scheme: "https", Host: "one.example.test"}}
			desktop.account.set(notificationUserID, time.Now().Add(time.Hour))
			lease, err := requireAccount(&desktop.account)
			if err != nil {
				t.Fatal(err)
			}
			started := make(chan struct{})
			useSyntheticNativeNotifications(t, func(ctx context.Context, _ mygo.NotificationOptions) error {
				close(started)
				<-ctx.Done()
				// Late nil after the IPC/request context ended.
				return nil
			})
			ctx, cancel := tc.ctx()
			defer cancel()
			done := make(chan error, 1)
			go func() {
				done <- desktop.deliverApprovalNotification(
					ctx, approvalNotificationInput(time.Now().Add(2*time.Minute)), lease,
				)
			}()
			<-started
			cancel()
			select {
			case err := <-done:
				if !errors.Is(err, errNotificationsCanceled) {
					t.Fatalf("a late success returned %v", err)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("an ended request context left delivery waiting")
			}
		})
	}
}
