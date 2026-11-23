package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo"
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
	if err := desktop.SignIn(context.Background()); err == nil {
		t.Fatal("an unbound caller started native sign-in")
	}
	if err := desktop.CancelSignIn(context.Background()); err == nil {
		t.Fatal("an unbound caller cancelled native sign-in")
	}
	if err := desktop.ClearMacSession(context.Background(), MacSignOutOptions{}); err == nil || err.Error() != "DESKTOP_CALLER_FORBIDDEN" {
		t.Fatal("an unbound caller entered Mac sign-out")
	}
}

func TestOrdinaryMacSignOutPreservesPreUpgradePairingForItsVerifiedOwner(t *testing.T) {
	credential := deviceFixtureCredential()
	refreshToken := strings.Repeat("b", 64)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/auth/refresh" {
			// Resume does not need the device to be online to reattach its pairing.
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		cookie, err := r.Cookie(refreshCookieName)
		if err != nil || cookie.Value != refreshToken {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Set-Cookie", rotationCookie(refreshToken, 3_600))
		_, _ = io.WriteString(w, refreshSessionBody(r.Header.Get("X-Fixture-Owner"), time.Now().Add(time.Hour)))
	}))
	t.Cleanup(server.Close)
	origin, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	d, store, pairing := signOutFixture(t, origin, credential)
	t.Cleanup(d.closeDevice)
	resume := func(owner string) (DeviceConnectionStatus, error) {
		d.deviceSetup.Lock()
		defer d.deviceSetup.Unlock()
		return d.resumeDevice(owner)
	}
	login := func(owner string) {
		t.Helper()
		seedRefreshSession(t, d.session, refreshToken, time.Now().Add(time.Hour))
		if err := d.session.allowNewSession(); err != nil {
			t.Fatal(err)
		}
		request := refreshRequest(t, origin.String())
		request.Header.Set("X-Fixture-Owner", owner)
		response, err := d.session.RoundTrip(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if actual, ok := d.account.current(); !ok || actual != owner {
			t.Fatal("the fixture did not establish a native account through refresh")
		}
	}

	login(credential.OwnerID)
	if _, err := resume(credential.OwnerID); err != nil {
		t.Fatal(err)
	}
	if err := d.clearSession(false, nil); err != nil {
		t.Fatal(err)
	}
	if _, ok := d.account.current(); ok || d.currentDevice() != nil {
		t.Fatal("ordinary sign-out left native auth or the live device active")
	}
	if _, err := store.Get(d.session.secretKey()); !errors.Is(err, mygo.ErrSecretNotFound) {
		t.Fatal("ordinary sign-out retained the refresh credential")
	}
	deviceKey := serverCredentialKey(origin, "device")
	if stored, err := store.Get(deviceKey); err != nil || !bytes.Equal(stored, pairing) {
		t.Fatal("ordinary sign-out did not preserve the exact pre-upgrade pairing bytes")
	}
	if status, err := resume(credential.OwnerID); err != nil || status.State != DeviceUnpaired {
		t.Fatal("the preserved pairing was offered without a new sign-in")
	}
	login(otherAccountFixture)
	if _, err := resume(otherAccountFixture); err == nil || err.Error() != "FORBIDDEN" || d.currentDevice() != nil {
		t.Fatal("a verified different account could access the stored pairing")
	}
	if stored, err := store.Get(deviceKey); err != nil || !bytes.Equal(stored, pairing) {
		t.Fatal("refusing another verified account changed the stored pairing")
	}
	login(credential.OwnerID)
	if status, err := resume(credential.OwnerID); err != nil || status.DeviceID != credential.DeviceID {
		t.Fatalf("the verified matching owner did not resume the pre-upgrade pairing: %v", err)
	}
}

func TestSignOutCleansUpOnlyTheAcknowledgedMacPairing(t *testing.T) {
	credential := deviceFixtureCredential()
	origin, err := url.Parse("https://example.test")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name    string
		revoke  RevokedMacDevice
		legacy  bool
		deleted bool
	}{
		{"exact match without a live account", RevokedMacDevice{credential.OwnerID, credential.DeviceID}, false, true},
		{"other owner with the same device ID", RevokedMacDevice{otherAccountFixture, credential.DeviceID}, false, false},
		{"replacement pairing for the same owner", RevokedMacDevice{credential.OwnerID, "20000000-0000-4000-8000-000000000002"}, false, false},
		{"legacy cleanup still deletes the pairing", RevokedMacDevice{}, true, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			d, store, pairing := signOutFixture(t, origin, credential)
			if err := d.clearSession(test.legacy, &test.revoke); err != nil {
				t.Fatal(err)
			}
			stored, err := store.Get(serverCredentialKey(origin, "device"))
			if test.deleted {
				if !errors.Is(err, mygo.ErrSecretNotFound) {
					t.Fatal("the acknowledged credential was not removed")
				}
			} else if err != nil || !bytes.Equal(stored, pairing) {
				t.Fatal("sign-out changed a pairing that did not match the acknowledgment")
			}
		})
	}
}

func signOutFixture(t *testing.T, origin *url.URL, credential deviceCredential) (*Desktop, *memoryCredentialStore, []byte) {
	t.Helper()
	store := &memoryCredentialStore{}
	d := &Desktop{}
	d.configure(origin, store, t.TempDir())
	pairing, err := json.MarshalIndent(credential, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Set(serverCredentialKey(origin, "device"), pairing); err != nil {
		t.Fatal(err)
	}
	return d, store, pairing
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
