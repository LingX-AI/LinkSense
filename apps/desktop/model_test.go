package main

import (
	"net/url"
	"strings"
	"testing"
)

func TestWorkspaceURLRejectsUnsafeAndAmbiguousOrigins(t *testing.T) {
	for _, input := range []string{
		"", "file:///tmp/file", "javascript:alert(1)", "ws://example.test",
		"wss://example.test", "ftp://example.test",
		"http://", "http://:19090", "https://:19090",
		"http://user@example.test", "http://example.test/private",
		"http://example.test?query=value", "http://example.test#fragment",
		"https://user:secret@example.test", "https://example.test/private",
		"https://example.test?token=secret", "https://example.test#token",
		"https://", "https://example.test\n.invalid",
	} {
		t.Run(input, func(t *testing.T) {
			if _, err := workspaceURL(input); err == nil {
				t.Fatal("unsafe workspace origin accepted")
			}
		})
	}
	for _, input := range []string{
		"https://example.test", "https://example.test/",
		"http://localhost:18173", "http://127.0.0.1:18173", "http://[::1]:18173",
	} {
		t.Run(input, func(t *testing.T) {
			if _, err := workspaceURL(input); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestWorkspaceURLAcceptsHTTPAndHTTPSForDomainsAndIPAddresses(t *testing.T) {
	for _, input := range []string{
		"http://example.test", "http://example.test:19090",
		"http://192.0.2.10:19090", "http://[2001:db8::10]:19090",
		"https://example.test", "https://192.0.2.10:19090",
	} {
		t.Run(input, func(t *testing.T) {
			for _, raw := range []string{input, input + "/", " " + input + " "} {
				if actual, err := workspaceURL(raw); err != nil || actual != input+"/" {
					t.Fatalf("valid workspace origin was rejected or changed: %q %v", actual, err)
				}
			}
		})
	}
}

func TestHTTPWorkspaceOpensBrowserAndPairConfirmationWithoutGrantingAccess(t *testing.T) {
	a := newDesktopApp(false, "Test computer")
	a.server = "http://192.0.2.10:19090"
	opened := ""
	a.openWorkspace = func(value string) error {
		opened = value
		return nil
	}
	a.open()
	if opened != "http://192.0.2.10:19090/settings/general#computer-use" || a.message != "" {
		t.Fatal("HTTP workspace did not open its settings page")
	}
	code := strings.Repeat("p", 43)
	query := url.Values{"server": {a.server}, "code": {code}}
	a.handlePairURL("linksense-desktop://pair?" + query.Encode())
	if !a.pairing || a.server != "http://192.0.2.10:19090/" || a.pairingCode != code ||
		a.credential != nil || a.state != disconnected {
		t.Fatal("HTTP deep link must require explicit local pairing and task approval")
	}
}

func TestOpeningWorkspaceDoesNotPretendToPairOrControl(t *testing.T) {
	a := newDesktopApp(false, "Test computer")
	calls := 0
	a.openWorkspace = func(value string) error {
		calls++
		if value != "https://example.test/settings/general#computer-use" {
			t.Fatalf("unexpected destination %q", value)
		}
		return nil
	}
	a.server = "file:///tmp/file"
	a.open()
	if calls != 0 || a.message != "invalidURL" {
		t.Fatal("invalid origin reached the browser")
	}
	a.server = "https://example.test"
	a.open()
	if calls != 1 || a.message != "" || a.state != disconnected {
		t.Fatal("opening the browser must not grant desktop access")
	}
}

func TestDisconnectAndCancelInvalidatePendingConnectionAttempts(t *testing.T) {
	a := newDesktopApp(false, "Test computer")
	ctx, first := a.beginAttempt()
	a.cancelPairing()
	if ctx.Err() == nil || a.attemptID == first || a.busy {
		t.Fatal("cancel retained an active pairing operation")
	}
	second, generation := a.beginAttempt()
	a.disconnect()
	if second.Err() == nil || a.attemptID == generation || a.credential != nil || a.busy {
		t.Fatal("disconnect retained a reconnect operation")
	}
}

func TestPairDeepLinkOnlyPopulatesAnExplicitLocalConfirmation(t *testing.T) {
	a := newDesktopApp(false, "Test computer")
	a.handlePairURL("linksense-desktop://pair?server=https%3A%2F%2Fexample.test&code=ppppppppppppppppppppppppppppppppppppppppppp")
	if !a.pairing || a.server != "https://example.test/" || a.pairingCode == "" || a.credential != nil || a.state != disconnected {
		t.Fatal("deep link must open confirmation without pairing or controlling the computer")
	}
	a.pairing = false
	for _, raw := range []string{
		"linksense-desktop://pair?server=file%3A%2F%2F%2Ftmp&code=ppppppppppppppppppppppppppppppppppppppppppp",
		"linksense-desktop://shell?server=https%3A%2F%2Fexample.test&code=ppppppppppppppppppppppppppppppppppppppppppp",
		"linksense-desktop://pair?server=https%3A%2F%2Fexample.test&code=short",
	} {
		a.handlePairURL(raw)
		if a.pairing {
			t.Fatal("unsafe deep link accepted")
		}
	}
}
