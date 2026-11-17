package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

type memoryCredentialStore struct {
	mu     sync.Mutex
	values map[string][]byte
	fail   bool
}

func (s *memoryCredentialStore) Get(key string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fail {
		return nil, errors.New("test store is locked")
	}
	value, ok := s.values[key]
	if !ok {
		return nil, mygo.ErrSecretNotFound
	}
	return value, nil
}
func (s *memoryCredentialStore) Set(key string, value []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fail {
		return errors.New("test store is locked")
	}
	if s.values == nil {
		s.values = map[string][]byte{}
	}
	s.values[key] = value
	return nil
}
func (s *memoryCredentialStore) Delete(key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fail {
		return errors.New("test store is locked")
	}
	delete(s.values, key)
	return nil
}

func TestNativeHTTPWhitelistRejectsOtherServersAndInternalPaths(t *testing.T) {
	server, _ := parseServerURL("https://example.com")
	for _, raw := range []string{
		"https://other.example/api/v1/me", "http://example.com/api/v1/me",
		"https://example.com/internal/events", "https://example.com/api/v1/../internal",
		"https://example.com/api/v1/%2f..%2finternal", "https://example.com/api/v1/%5cinternal",
		"https://example.com/api/v1//me", "https://user@example.com/api/v1/me",
	} {
		request, _ := http.NewRequest(http.MethodGet, raw, nil)
		if allowsAPIRequest(server, request) {
			t.Fatalf("accepted a forbidden native request: %q", raw)
		}
	}
	request, _ := http.NewRequest(http.MethodGet, "https://example.com/api/v1/me", nil)
	if !allowsAPIRequest(server, request) {
		t.Fatal("rejected an ordinary authenticated API request")
	}
	request.Host = "other.example"
	if allowsAPIRequest(server, request) {
		t.Fatal("allowed overriding the API host")
	}
}

func TestDefaultPortNormalizationKeepsNativeAdmissionAndExistingCredentialKeys(t *testing.T) {
	for _, origin := range []string{"https://example.com:443", "http://localhost:80"} {
		server, err := parseServerURL(origin)
		if err != nil {
			t.Fatal(err)
		}
		canonical := *server
		canonical.Host = canonical.Hostname()
		request, _ := http.NewRequest(http.MethodGet, canonical.String()+"/api/v1/system/bootstrap", nil)
		if !allowsAPIRequest(server, request) {
			t.Fatal("the packaged default port rejected a URL normalized by the Web frontend")
		}
		if serverCredentialKey(server, "refresh") == serverCredentialKey(&canonical, "refresh") ||
			serverCredentialKey(server, "device") == serverCredentialKey(&canonical, "device") {
			t.Fatal("pre-change credential identities were silently normalized")
		}
		request.URL.Host += ":444"
		request.Host = request.URL.Host
		if allowsAPIRequest(server, request) {
			t.Fatal("effective-port admission allowed a different service")
		}
	}
}

func TestRefreshSessionRotatesInNativeStoreAndNeverReachesOtherRoutes(t *testing.T) {
	token := strings.Repeat("a", 64)
	var received string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received = r.Header.Get("Cookie")
		if r.Header.Get("Origin") != "" || r.Header.Get("Referer") != "" {
			t.Error("webview origin reached the API")
		}
		if r.URL.Path == "/api/v1/auth/login" {
			http.SetCookie(w, &http.Cookie{
				Name: refreshCookieName, Value: token, Path: "/api/v1/auth",
				HttpOnly: true, MaxAge: 3600,
			})
		}
		if r.URL.Path == "/api/v1/auth/logout" {
			http.SetCookie(w, &http.Cookie{Name: refreshCookieName, Path: "/api/v1/auth", MaxAge: -1})
		}
		_, _ = io.WriteString(w, "{}")
	}))
	defer server.Close()
	origin, _ := url.Parse(server.URL)
	store := &memoryCredentialStore{}
	client := newDesktopHTTPClient(origin, store)
	for _, route := range []string{"login", "refresh", "../me", "logout", "refresh"} {
		target := "/api/v1/auth/" + route
		if route == "../me" {
			target = "/api/v1/me"
		}
		request, _ := http.NewRequest(http.MethodPost, server.URL+target, nil)
		request.Header.Set("Cookie", "linksense_refresh=page-supplied")
		request.Header.Set("Origin", "mygo://localhost")
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.Header.Get("Set-Cookie") != "" {
			t.Fatal("refresh cookie was exposed to the WebView")
		}
		if route == "logout" || route == "refresh" && storeHasSession(store) {
			if received != refreshCookieName+"="+token {
				t.Fatal("native refresh credential was not restored")
			}
		} else if received != "" {
			t.Fatal("a refresh credential escaped its authentication scope")
		}
	}
}

func storeHasSession(store *memoryCredentialStore) bool {
	store.mu.Lock()
	defer store.mu.Unlock()
	return len(store.values) > 0
}

func TestLockedCredentialStorePreventsAuthenticationRequest(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
	defer server.Close()
	origin, _ := url.Parse(server.URL)
	client := newDesktopHTTPClient(origin, &memoryCredentialStore{fail: true})
	if _, err := client.Post(server.URL+"/api/v1/auth/refresh", "application/json", nil); err == nil {
		t.Fatal("authentication proceeded without secure credential storage")
	}
	if called {
		t.Fatal("authentication request escaped before checking the credential store")
	}
}

func TestNativeHTTPDoesNotFollowRedirectsAndCancelsStreams(t *testing.T) {
	redirectCalls := 0
	streamClosed := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/redirect":
			http.Redirect(w, r, "/api/v1/destination", http.StatusFound)
		case "/api/v1/destination":
			redirectCalls++
		case "/api/v1/events":
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "data: ready\n\n")
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			close(streamClosed)
		}
	}))
	defer server.Close()
	origin, _ := url.Parse(server.URL)
	client := newDesktopHTTPClient(origin, &memoryCredentialStore{})
	response, err := client.Get(server.URL + "/api/v1/redirect")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusFound || redirectCalls != 0 {
		t.Fatal("native API client followed a redirect")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/api/v1/events", nil)
	response, err = client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	data := make([]byte, len("data: ready\n\n"))
	if _, err := io.ReadFull(response.Body, data); err != nil || string(data) != "data: ready\n\n" {
		t.Fatal("SSE response did not stream before the connection closed")
	}
	cancel()
	response.Body.Close()
	select {
	case <-streamClosed:
	case <-time.After(5 * time.Second):
		t.Fatal("canceling the client did not close the API stream")
	}
}

func TestExpiredRefreshSessionIsRemovedBeforeRequest(t *testing.T) {
	var received string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received = r.Header.Get("Cookie")
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()
	origin, _ := url.Parse(server.URL)
	store := &memoryCredentialStore{}
	transport := &sessionTransport{server: origin, store: store, base: http.DefaultTransport}
	data, _ := json.Marshal(storedRefreshSession{Token: "expired", ExpiresAt: time.Now().Add(-time.Hour)})
	_ = store.Set(transport.secretKey(), data)
	request, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/auth/refresh", nil)
	response, err := transport.RoundTrip(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if received != "" || storeHasSession(store) {
		t.Fatal("an expired native refresh session was reused")
	}
}

func TestAuthHeaderTimeoutReleasesTheCredentialLock(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/refresh" {
			<-r.Context().Done()
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	origin, _ := url.Parse(server.URL)
	client := newDesktopHTTPClient(origin, &memoryCredentialStore{})
	transport := client.Transport.(*sessionTransport)
	transport.base.(*http.Transport).ResponseHeaderTimeout = 20 * time.Millisecond
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/api/v1/auth/refresh", nil)
	if _, err := client.Do(request); err == nil {
		t.Fatal("an authentication request without headers did not time out")
	}
	request, _ = http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/api/v1/auth/logout", nil)
	response, err := client.Do(request)
	if err != nil {
		t.Fatal("a timed-out refresh blocked a later authentication request")
	}
	response.Body.Close()
}

func TestLocalSignOutErasesCredentialsAfterNetworkFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	origin, _ := url.Parse(server.URL)
	server.Close()
	store := &memoryCredentialStore{}
	client := newDesktopHTTPClient(origin, store)
	transport := client.Transport.(*sessionTransport)
	data, _ := json.Marshal(storedRefreshSession{
		Token: strings.Repeat("a", 64), ExpiresAt: time.Now().Add(time.Hour),
	})
	_ = store.Set(transport.secretKey(), data)
	if _, err := client.Post(server.URL+"/api/v1/auth/logout", "application/json", nil); err == nil {
		t.Fatal("the isolated API should be unreachable")
	}
	if err := transport.clearSession(); err != nil {
		t.Fatal(err)
	}
	if storeHasSession(store) {
		t.Fatal("offline sign-out left a refresh credential to restore next launch")
	}
}

func TestSignOutIntentPreventsRestoringASecretThatTheOSCouldNotDelete(t *testing.T) {
	var cookie string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie = r.Header.Get("Cookie")
		if r.URL.Path == "/api/v1/auth/login" {
			http.SetCookie(w, &http.Cookie{
				Name: refreshCookieName, Value: strings.Repeat("b", 64),
				Path: "/api/v1/auth", HttpOnly: true, MaxAge: 3600,
			})
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	origin, _ := url.Parse(server.URL)
	store := &memoryCredentialStore{}
	client := newDesktopHTTPClient(origin, store)
	transport := client.Transport.(*sessionTransport)
	transport.signedOutPath = filepath.Join(t.TempDir(), "signed-out")
	data, _ := json.Marshal(storedRefreshSession{
		Token: strings.Repeat("a", 64), ExpiresAt: time.Now().Add(time.Hour),
	})
	_ = store.Set(transport.secretKey(), data)
	store.fail = true
	if transport.clearSession() == nil {
		t.Fatal("failed OS credential deletion was hidden")
	}
	store.fail = false
	restarted := newDesktopHTTPClient(origin, store)
	restarted.Transport.(*sessionTransport).signedOutPath = transport.signedOutPath
	response, err := restarted.Post(server.URL+"/api/v1/auth/refresh", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if cookie != "" {
		t.Fatal("a signed-out native session silently restored a leftover credential")
	}
	response, err = restarted.Post(server.URL+"/api/v1/auth/login", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if _, err := os.Stat(transport.signedOutPath); !os.IsNotExist(err) {
		t.Fatal("a fresh explicit sign-in did not clear the sign-out marker")
	}
	response, err = restarted.Post(server.URL+"/api/v1/auth/refresh", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if cookie != refreshCookieName+"="+strings.Repeat("b", 64) {
		t.Fatal("a fresh explicit sign-in could not restore its new credential")
	}
}

func TestSignOutReportsMarkerFailureAndStillErasesTheCredential(t *testing.T) {
	origin, _ := url.Parse("https://example.test")
	store := &memoryCredentialStore{}
	transport := newDesktopHTTPClient(origin, store).Transport.(*sessionTransport)
	blocker := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blocker, []byte("occupied"), 0o600); err != nil {
		t.Fatal(err)
	}
	transport.signedOutPath = filepath.Join(blocker, "signed-out")
	_ = store.Set(transport.secretKey(), []byte("existing"))
	if transport.clearSession() == nil {
		t.Fatal("sign-out marker failure was hidden")
	}
	if storeHasSession(store) || !transport.signedOut {
		t.Fatal("marker failure prevented clearing the in-memory and stored session")
	}
}
