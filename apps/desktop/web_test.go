package main

import (
	"context"
	"testing"
)

func TestOnlyApplicationFrontendCanStayInTheMainWindow(t *testing.T) {
	for _, raw := range []string{"mygo://localhost/", "mygo://localhost/conversations/new", "http://mygo.localhost/"} {
		if !frontendNavigation(raw) {
			t.Fatalf("rejected frontend navigation: %s", raw)
		}
	}
	for _, raw := range []string{
		"https://example.com/", "file:///tmp/index.html", "data:text/html,example",
		"mygo://other/", "mygo://localhost:4000/", "http://localhost:18173/",
	} {
		if frontendNavigation(raw) {
			t.Fatalf("trusted an external frontend: %s", raw)
		}
	}
	desktop := &Desktop{}
	if _, err := desktop.Info(context.Background()); err == nil {
		t.Fatal("an unbound caller read native host information")
	}
	if err := desktop.OpenExternal(context.Background(), "https://example.com"); err == nil {
		t.Fatal("an unbound caller opened a system URL")
	}
}

func TestDeepLinksAcceptOnlyConversationIdentifiers(t *testing.T) {
	const id = "11111111-1111-4111-8111-111111111111"
	route, err := conversationDeepLink("linksense-desktop://conversation/" + id)
	if err != nil || route != "/conversations/"+id {
		t.Fatalf("valid conversation deep link failed: %s %v", route, err)
	}
	for _, raw := range []string{
		"linksense-desktop://conversation/../../etc/passwd",
		"linksense-desktop://conversation/" + id + "?token=value",
		"linksense-desktop://conversation/" + id + "#token=value",
		"linksense-desktop://conversation/zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
		"https://example.com/conversation/" + id,
		"linksense-desktop://login/" + id,
	} {
		if _, err := conversationDeepLink(raw); err == nil {
			t.Fatalf("accepted an invalid deep link: %s", raw)
		}
	}
}

func TestSystemBrowserOnlyAcceptsWebURLs(t *testing.T) {
	for _, raw := range []string{"file:///tmp/file", "javascript:alert(1)", "https://user:password@example.com"} {
		if _, err := externalURL(raw); err == nil {
			t.Fatalf("accepted an unsafe external URL: %s", raw)
		}
	}
}
