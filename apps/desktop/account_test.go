package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const (
	accountFixture      = "50000000-0000-4000-8000-000000000001"
	otherAccountFixture = "50000000-0000-4000-8000-000000000002"
)

func refreshSessionBody(id string, expiresAt time.Time) string {
	return fmt.Sprintf(`{"success":true,"data":{"user":{"id":%q},"access_token":"ignored",`+
		`"access_token_expires_at":%q,"refresh_session_expires_at":%q}}`,
		id, time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano), expiresAt.UTC().Format(time.RFC3339Nano))
}

func accountFixtureTransport(t *testing.T, handler http.HandlerFunc) (*sessionTransport, *workspaceAccount) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	origin, _ := url.Parse(server.URL)
	account := &workspaceAccount{}
	transport := &sessionTransport{
		server: origin, store: &memoryCredentialStore{}, base: http.DefaultTransport, account: account,
	}
	// A refresh is trusted only when the native transport sends its own stored
	// cookie and stores the rotation it receives.
	seedRefreshSession(t, transport, strings.Repeat("a", 64), time.Now().Add(time.Hour))
	return transport, account
}

func seedRefreshSession(t *testing.T, transport *sessionTransport, token string, expiresAt time.Time) {
	t.Helper()
	raw, err := json.Marshal(storedRefreshSession{Token: token, ExpiresAt: expiresAt})
	if err != nil {
		t.Fatal(err)
	}
	if err := transport.store.Set(transport.secretKey(), raw); err != nil {
		t.Fatal(err)
	}
}

func rotationCookie(token string, maxAge int) string {
	return (&http.Cookie{
		Name: refreshCookieName, Value: token, Path: "/api/v1/auth",
		HttpOnly: true, MaxAge: maxAge,
	}).String()
}

func refreshRequest(t *testing.T, serverURL string) *http.Request {
	t.Helper()
	request, err := http.NewRequest(http.MethodPost, serverURL+"/api/v1/auth/refresh", nil)
	if err != nil {
		t.Fatal(err)
	}
	return request
}

func TestSuccessfulRefreshCapturesTheAccountAndReplaysTheExactBody(t *testing.T) {
	expiresAt := time.Now().Add(24 * time.Hour).Truncate(time.Second)
	body := refreshSessionBody(accountFixture, expiresAt)
	var serverURL string
	transport, account := accountFixtureTransport(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Cookie") != refreshCookieName+"="+strings.Repeat("a", 64) || r.Header.Get("Origin") != "" {
			t.Error("the native refresh did not use only its own cookie")
		}
		http.SetCookie(w, &http.Cookie{
			Name: refreshCookieName, Value: strings.Repeat("b", 64),
			Path: "/api/v1/auth", HttpOnly: true, MaxAge: 3600,
		})
		_, _ = io.WriteString(w, body)
	})
	serverURL = transport.server.String()
	response, err := transport.RoundTrip(refreshRequest(t, serverURL))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	replayed, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(replayed) != body {
		t.Fatalf("the WebView response changed: %q", replayed)
	}
	if response.ContentLength != int64(len(body)) {
		t.Fatal("the replayed response did not keep its length")
	}
	current, ok := account.current()
	if !ok || current != accountFixture {
		t.Fatalf("the refresh account was not captured: %q, %v", current, ok)
	}
	if account.expiresAt.After(time.Now().Add(time.Hour + time.Minute)) {
		t.Fatalf("the account expiry outlived the rotated credential: %v", account.expiresAt)
	}

	other := refreshSessionBody(otherAccountFixture, time.Now().Add(48*time.Hour))
	transport.base = roundTripperFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header: http.Header{
				"Content-Type": {"application/json"},
				"Set-Cookie":   {rotationCookie(strings.Repeat("c", 64), 3600)},
			},
			Body: io.NopCloser(strings.NewReader(other)),
		}, nil
	})
	response, err = transport.RoundTrip(refreshRequest(t, serverURL))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if current, _ := account.current(); current != otherAccountFixture {
		t.Fatalf("an account switch kept the previous account: %q", current)
	}
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

// blockingResponseBody lets a test drive sign-out after the response checks
// passed but while the refresh body is being read.
type blockingResponseBody struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
	reader  io.Reader
}

func (b *blockingResponseBody) Read(p []byte) (int, error) {
	b.once.Do(func() { close(b.started) })
	<-b.release
	return b.reader.Read(p)
}

func (b *blockingResponseBody) Close() error { return nil }

// blockingCredentialStore blocks the rotation write so sign-out can land after
// the network response but before the proof is published.
type blockingCredentialStore struct {
	*memoryCredentialStore
	mu      sync.Mutex
	armed   bool
	once    sync.Once
	started chan struct{}
	release chan struct{}
}

func (s *blockingCredentialStore) arm() {
	s.mu.Lock()
	s.armed = true
	s.mu.Unlock()
}

func (s *blockingCredentialStore) Set(key string, value []byte) error {
	s.mu.Lock()
	armed := s.armed
	s.mu.Unlock()
	if armed {
		s.once.Do(func() { close(s.started) })
		<-s.release
	}
	return s.memoryCredentialStore.Set(key, value)
}

func TestRefreshWithoutNativeAuthenticationNeverCapturesAnAccount(t *testing.T) {
	body := refreshSessionBody(accountFixture, time.Now().Add(24*time.Hour))
	readBody := func(t *testing.T, transport *sessionTransport, account *workspaceAccount) string {
		t.Helper()
		response, err := transport.RoundTrip(refreshRequest(t, transport.server.String()))
		if err != nil {
			t.Fatal(err)
		}
		replayed, readErr := io.ReadAll(response.Body)
		response.Body.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		if _, ok := account.current(); ok {
			t.Fatal("an unauthenticated native refresh captured an account")
		}
		return string(replayed)
	}

	t.Run("signed-out marker blocked the cookie", func(t *testing.T) {
		transport, account := accountFixtureTransport(t, func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Cookie") != "" {
				t.Error("a signed-out native refresh sent a stored cookie")
			}
			http.SetCookie(w, &http.Cookie{
				Name: refreshCookieName, Value: strings.Repeat("b", 64),
				Path: "/api/v1/auth", HttpOnly: true, MaxAge: 3600,
			})
			_, _ = io.WriteString(w, body)
		})
		// Simulate a stale identity that predates the signed-out marker.
		account.set(accountFixture, time.Now().Add(time.Hour))
		transport.signedOut = true
		if replayed := readBody(t, transport, account); replayed != body {
			t.Fatal("the WebView response changed")
		}
	})

	t.Run("an expired stored cookie is omitted", func(t *testing.T) {
		transport, account := accountFixtureTransport(t, func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = io.WriteString(w, `{"success":false,"error_code":"AUTH_SESSION_EXPIRED"}`)
		})
		seedRefreshSession(t, transport, strings.Repeat("a", 64), time.Now().Add(-time.Hour))
		account.set(accountFixture, time.Now().Add(time.Hour))
		readBody(t, transport, account)
	})

	t.Run("a successful body without a stored rotation", func(t *testing.T) {
		transport, account := accountFixtureTransport(t, func(w http.ResponseWriter, _ *http.Request) {
			_, _ = io.WriteString(w, body)
		})
		account.set(accountFixture, time.Now().Add(time.Hour))
		if replayed := readBody(t, transport, account); replayed != body {
			t.Fatal("the WebView response changed")
		}
	})
}

func TestSuccessfulRefreshCapsTheAccountExpiryAtTheStoredCredential(t *testing.T) {
	upstreamExpiry := time.Now().Add(48 * time.Hour)
	body := refreshSessionBody(accountFixture, upstreamExpiry)
	transport, account := accountFixtureTransport(t, func(w http.ResponseWriter, _ *http.Request) {
		http.SetCookie(w, &http.Cookie{
			Name: refreshCookieName, Value: strings.Repeat("b", 64),
			Path: "/api/v1/auth", HttpOnly: true, MaxAge: 3600,
		})
		_, _ = io.WriteString(w, body)
	})
	response, err := transport.RoundTrip(refreshRequest(t, transport.server.String()))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if current, ok := account.current(); !ok || current != accountFixture {
		t.Fatalf("the authenticated refresh account was not captured: %q, %v", current, ok)
	}
	if account.expiresAt.After(time.Now().Add(time.Hour + 5*time.Second)) {
		t.Fatalf("the account outlived its stored refresh credential: %v", account.expiresAt)
	}
	if account.expiresAt.Before(time.Now().Add(50 * time.Minute)) {
		t.Fatalf("the account expiry was shortened below the stored credential: %v", account.expiresAt)
	}
}

func TestRefreshAuthFailureAndMalformedPayloadClearTheAccount(t *testing.T) {
	cases := map[string]struct {
		status  int
		body    string
		cleared bool
	}{
		"unauthorized": {http.StatusUnauthorized, `{"success":false,"error_code":"AUTH_SESSION_EXPIRED"}`, true},
		"forbidden":    {http.StatusForbidden, `{"success":false,"error_code":"FORBIDDEN"}`, true},
		"malformed":    {http.StatusOK, `{"success":true,"data":`, true},
		"unsuccessful": {http.StatusOK, `{"success":false,"data":{"user":{"id":"` + accountFixture + `"}}}`, true},
		// A server or proxy failure is not a definitive auth outcome.
		"server error": {http.StatusBadGateway, `{"success":false}`, false},
	}
	for name, testCase := range cases {
		t.Run(name, func(t *testing.T) {
			transport, account := accountFixtureTransport(t, func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(testCase.status)
				_, _ = io.WriteString(w, testCase.body)
			})
			account.set(accountFixture, time.Now().Add(time.Hour))
			response, err := transport.RoundTrip(refreshRequest(t, transport.server.String()))
			if err != nil {
				t.Fatal(err)
			}
			payload, readErr := io.ReadAll(response.Body)
			response.Body.Close()
			if readErr != nil {
				t.Fatal(readErr)
			}
			if string(payload) != testCase.body {
				t.Fatalf("the native refresh response was not preserved: %q", payload)
			}
			_, ok := account.current()
			if testCase.cleared && ok {
				t.Fatalf("a definitive failure kept the account: %s", name)
			}
			if !testCase.cleared && !ok {
				t.Fatalf("a non-definitive failure cleared the account: %s", name)
			}
		})
	}
}

func TestOversizedRefreshPayloadIsReplayedWithoutTrustingIt(t *testing.T) {
	oversized := `{"success":true,"data":{"user":{"id":"` + accountFixture + `"},"padding":"` +
		strings.Repeat("a", maxRefreshCaptureBytes) + `"}}`
	transport, account := accountFixtureTransport(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, oversized)
	})
	account.set(accountFixture, time.Now().Add(time.Hour))
	response, err := transport.RoundTrip(refreshRequest(t, transport.server.String()))
	if err != nil {
		t.Fatal(err)
	}
	replayed, readErr := io.ReadAll(response.Body)
	response.Body.Close()
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(replayed) != oversized {
		t.Fatal("an oversized refresh response was truncated for the WebView")
	}
	if _, ok := account.current(); ok {
		t.Fatal("an unbounded refresh response was trusted")
	}
}

func TestSessionEstablishingResponsesAndSignOutClearTheAccount(t *testing.T) {
	transport, account := accountFixtureTransport(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/login" {
			http.SetCookie(w, &http.Cookie{
				Name: refreshCookieName, Value: strings.Repeat("a", 64),
				Path: "/api/v1/auth", HttpOnly: true, MaxAge: 3600,
			})
		}
		_, _ = io.WriteString(w, `{}`)
	})
	account.set(accountFixture, time.Now().Add(time.Hour))
	request, _ := http.NewRequest(http.MethodPost, transport.server.String()+"/api/v1/auth/login", nil)
	response, err := transport.RoundTrip(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if _, ok := account.current(); ok {
		t.Fatal("a session-establishing response reused the previous account")
	}
	account.set(accountFixture, time.Now().Add(time.Hour))
	if err := transport.clearSession(); err != nil {
		t.Fatal(err)
	}
	if _, ok := account.current(); ok {
		t.Fatal("sign-out kept the account")
	}
}

func TestSignOutDuringRefreshCannotReviveTheAccountOrStoreItsRotation(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	transport, account := accountFixtureTransport(t, func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		<-release
		http.SetCookie(w, &http.Cookie{
			Name: refreshCookieName, Value: strings.Repeat("b", 64),
			Path: "/api/v1/auth", HttpOnly: true, MaxAge: 3600,
		})
		_, _ = io.WriteString(w, refreshSessionBody(accountFixture, time.Now().Add(24*time.Hour)))
	})
	account.set(accountFixture, time.Now().Add(time.Hour))
	request := refreshRequest(t, transport.server.String())
	response := make(chan error, 1)
	go func() {
		reply, err := transport.RoundTrip(request)
		if err == nil {
			reply.Body.Close()
		}
		response <- err
	}()
	<-started
	transport.requestSignOut()
	close(release)
	if err := <-response; err == nil {
		t.Fatal("an in-flight refresh survived sign-out")
	}
	if _, ok := account.current(); ok {
		t.Fatal("sign-out was revived by an in-flight refresh")
	}
	raw, err := transport.store.Get(transport.secretKey())
	if err != nil || !strings.Contains(string(raw), strings.Repeat("a", 64)) {
		t.Fatalf("the rotated credential replaced the signed-out session: %q, %v", raw, err)
	}
	if blocked, err := transport.sessionBlocked(); err != nil || !blocked {
		t.Fatal("sign-out was not visible to the transport")
	}
	if err := transport.clearSession(); err != nil {
		t.Fatal(err)
	}
	if _, err := transport.store.Get(transport.secretKey()); err == nil {
		t.Fatal("sign-out retained the refresh credential")
	}
}

func TestQueuedRefreshAfterSignOutIsRejectedWithoutSendingACookie(t *testing.T) {
	var requests atomic.Int32
	transport, account := accountFixtureTransport(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Header.Get("Cookie") != "" {
			t.Error("a refresh during sign-out sent the stored cookie")
		}
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"success":false,"error_code":"AUTH_SESSION_EXPIRED"}`)
	})
	account.set(accountFixture, time.Now().Add(time.Hour))
	transport.requestSignOut()
	if _, ok := account.current(); ok {
		t.Fatal("sign-out did not invalidate the account before transport shutdown")
	}
	if reply, err := transport.RoundTrip(refreshRequest(t, transport.server.String())); err == nil {
		reply.Body.Close()
		t.Fatal("a queued refresh during sign-out was admitted")
	}
	if requests.Load() != 0 {
		t.Fatal("a queued refresh during sign-out reached the server")
	}
}

func TestNewLoginAfterCompletedSignOutIsAdmitted(t *testing.T) {
	transport, _ := accountFixtureTransport(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/login" {
			http.SetCookie(w, &http.Cookie{
				Name: refreshCookieName, Value: strings.Repeat("c", 64),
				Path: "/api/v1/auth", HttpOnly: true, MaxAge: 3600,
			})
		}
		_, _ = io.WriteString(w, `{}`)
	})
	transport.requestSignOut()
	if err := transport.clearSession(); err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodPost, transport.server.String()+"/api/v1/auth/login", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := transport.RoundTrip(request)
	if err != nil {
		t.Fatalf("a new login after sign-out was rejected: %v", err)
	}
	response.Body.Close()
	if blocked, err := transport.sessionBlocked(); err != nil || blocked {
		t.Fatal("a completed sign-out blocked the next login")
	}
	raw, err := transport.store.Get(transport.secretKey())
	if err != nil || !strings.Contains(string(raw), strings.Repeat("c", 64)) {
		t.Fatalf("the new login did not store its rotation: %q, %v", raw, err)
	}
}

func assertNoCleanupFrame(t *testing.T, frames <-chan string) {
	t.Helper()
	select {
	case frame, ok := <-frames:
		if ok {
			t.Fatalf("a cleanup frame was admitted after sign-out: %s", frame)
		}
	case <-time.After(200 * time.Millisecond):
	}
}

func syntheticRefreshRoundTripper(body io.ReadCloser) roundTripperFunc {
	return roundTripperFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header: http.Header{
				"Content-Type": {"application/json"},
				"Set-Cookie":   {rotationCookie(strings.Repeat("b", 64), 3600)},
			},
			Body: body,
		}, nil
	})
}

func TestSignOutWhileRefreshBodyIsBlockedPublishesNothing(t *testing.T) {
	body := &blockingResponseBody{
		started: make(chan struct{}), release: make(chan struct{}),
		reader: strings.NewReader(refreshSessionBody(accountFixture, time.Now().Add(24*time.Hour))),
	}
	transport, account := accountFixtureTransport(t, func(http.ResponseWriter, *http.Request) {
		t.Error("the synthetic refresh must not reach the network")
	})
	// The first pending/epoch check has already passed when the body is read.
	transport.base = syntheticRefreshRoundTripper(body)
	account.set(accountFixture, time.Now().Add(time.Hour))
	lease, err := requireAccount(account)
	if err != nil {
		t.Fatal(err)
	}
	pipe, frames := pipeFixture(t)
	supervisor := &runtimeSupervisor{}
	supervisor.ready.Store(true)
	supervisor.pipe.Store(pipe)

	request := refreshRequest(t, transport.server.String())
	result := make(chan error, 1)
	go func() {
		response, err := transport.RoundTrip(request)
		if err == nil {
			response.Body.Close()
		}
		result <- err
	}()
	<-body.started
	transport.requestSignOut()
	close(body.release)
	if err := <-result; err == nil {
		t.Fatal("a refresh that was sign-out raced still reported success")
	}
	if _, ok := account.current(); ok {
		t.Fatal("the blocked refresh republished the account")
	}
	if account.matches(lease) {
		t.Fatal("the pre-sign-out lease survived")
	}
	if _, err := supervisor.workspaceRequest(context.Background(), workspaceCleanupRequestType, account, lease); !errors.Is(err, errAccountRequired) {
		t.Fatalf("a stale lease admitted cleanup: %v", err)
	}
	assertNoCleanupFrame(t, frames)
	if err := transport.clearSession(); err != nil {
		t.Fatal(err)
	}
	if _, err := transport.store.Get(transport.secretKey()); err == nil {
		t.Fatal("sign-out retained the refresh credential")
	}
}

func TestSignOutWhileRotationStorageIsBlockedPublishesNothing(t *testing.T) {
	transport, account := accountFixtureTransport(t, func(http.ResponseWriter, *http.Request) {
		t.Error("the synthetic refresh must not reach the network")
	})
	store := &blockingCredentialStore{
		memoryCredentialStore: transport.store.(*memoryCredentialStore),
		started:               make(chan struct{}),
		release:               make(chan struct{}),
	}
	transport.store = store
	// The first pending/epoch check has already passed when the rotation is
	// written; sign-out lands after that unavoidable I/O begins.
	transport.base = syntheticRefreshRoundTripper(io.NopCloser(
		strings.NewReader(refreshSessionBody(accountFixture, time.Now().Add(24*time.Hour))),
	))
	account.set(accountFixture, time.Now().Add(time.Hour))
	lease, err := requireAccount(account)
	if err != nil {
		t.Fatal(err)
	}
	pipe, frames := pipeFixture(t)
	supervisor := &runtimeSupervisor{}
	supervisor.ready.Store(true)
	supervisor.pipe.Store(pipe)
	store.arm()

	request := refreshRequest(t, transport.server.String())
	result := make(chan error, 1)
	go func() {
		response, err := transport.RoundTrip(request)
		if err == nil {
			response.Body.Close()
		}
		result <- err
	}()
	<-store.started
	transport.requestSignOut()
	close(store.release)
	if err := <-result; err == nil {
		t.Fatal("a refresh whose rotation write was sign-out raced reported success")
	}
	if _, ok := account.current(); ok {
		t.Fatal("the stalled refresh republished the account")
	}
	if _, err := supervisor.workspaceRequest(context.Background(), workspaceCleanupRequestType, account, lease); !errors.Is(err, errAccountRequired) {
		t.Fatalf("a stale lease admitted cleanup: %v", err)
	}
	assertNoCleanupFrame(t, frames)
	// The rotation may have been written before sign-out; the existing locked
	// clearSession deletion removes whatever the in-flight write stored.
	if err := transport.clearSession(); err != nil {
		t.Fatal(err)
	}
	if _, err := transport.store.Get(transport.secretKey()); err == nil {
		t.Fatal("sign-out retained the rotation written by the stalled refresh")
	}
}

func TestCapturedAccountIdentityIsNormalized(t *testing.T) {
	account := &workspaceAccount{}
	account.set(strings.ToUpper(accountFixture), time.Now().Add(time.Hour))
	if current, ok := account.current(); !ok || current != accountFixture {
		t.Fatalf("the captured account was not normalized: %q, %v", current, ok)
	}
	lease, err := requireAccount(account)
	if err != nil || lease.id != accountFixture {
		t.Fatalf("the normalized account was not usable: %q, %v", lease.id, err)
	}
}

func TestAccountExpiryAndImpossibleLifetimesAreBounded(t *testing.T) {
	account := &workspaceAccount{}
	account.set(accountFixture, time.Now().Add(time.Minute))
	if _, ok := account.current(); !ok {
		t.Fatal("a fresh account was rejected")
	}
	account.set(accountFixture, time.Now().Add(-time.Second))
	if _, ok := account.current(); ok {
		t.Fatal("an expired account was accepted")
	}
	account.set(accountFixture, time.Now().Add(365*24*time.Hour))
	if !account.expiresAt.Before(time.Now().Add(maxAccountSessionLifetime + time.Minute)) {
		t.Fatal("a server lifetime exceeded the native credential bound")
	}
	account.clear()
	if _, ok := account.current(); ok {
		t.Fatal("a cleared account was still usable")
	}
}

func TestWorkspaceAccountAccessTokenNeverCrossesAnAccountGeneration(t *testing.T) {
	account := &workspaceAccount{}
	expiresAt := time.Now().Add(time.Hour)
	account.setForRefresh(accountFixture, expiresAt, time.Time{})
	lease, ok := account.lease()
	if !ok {
		t.Fatal("missing lease")
	}
	if !account.setAccessToken(lease, "session-access-token", expiresAt) {
		t.Fatal("access token was not bound")
	}
	if token, ok := account.currentAccessToken(); !ok || token != "session-access-token" {
		t.Fatalf("unexpected access token: %q (%v)", token, ok)
	}
	account.setForRefresh(otherAccountFixture, expiresAt, time.Time{})
	if token, ok := account.currentAccessToken(); ok {
		t.Fatalf("a switched account reused the previous token: %q", token)
	}
}
