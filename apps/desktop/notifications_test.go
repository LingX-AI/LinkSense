package main

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"testing"

	"github.com/egoist/mygo"
)

const (
	notificationUserID         = "10000000-0000-4000-8000-000000000001"
	notificationConversationID = "20000000-0000-4000-8000-000000000001"
	notificationTurnID         = "30000000-0000-4000-8000-000000000001"
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
