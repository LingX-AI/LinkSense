package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestBrowserSignInBindsStateAndPKCEAndKeepsTheRefreshCookieNative(t *testing.T) {
	var challenge string
	var exchanges atomic.Int32
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Code        string `json:"code"`
			Verifier    string `json:"code_verifier"`
			RedirectURI string `json:"redirect_uri"`
		}
		if r.URL.Path != desktopLoginExchangePath || r.Method != http.MethodPost ||
			r.Header.Get("X-Linksense-Desktop-Protocol") != "1" ||
			json.NewDecoder(r.Body).Decode(&input) != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		hash := sha256.Sum256([]byte(input.Verifier))
		if base64.RawURLEncoding.EncodeToString(hash[:]) != challenge ||
			input.RedirectURI != desktopLoginRedirectURI || input.Code != strings.Repeat("c", 43) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		exchanges.Add(1)
		http.SetCookie(w, &http.Cookie{
			Name: refreshCookieName, Value: "native-refresh-token",
			HttpOnly: true, Path: "/api/v1/auth", MaxAge: 3600,
		})
		w.Header().Set("X-Linksense-Desktop-Protocol", "1")
		w.WriteHeader(http.StatusNoContent)
	}))
	defer api.Close()
	server, _ := url.Parse(api.URL)
	store := &memoryCredentialStore{}
	transport := newDesktopHTTPClient(server, store).Transport
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	state := strings.Repeat("s", 43)
	codes := make(chan string, 1)
	desktop := &Desktop{login: &browserLoginAttempt{state: state, code: codes, cancel: cancel}}
	err := browserSignIn(ctx, server, transport, func(raw string) error {
		authorization, err := url.Parse(raw)
		if err != nil || authorization.Path != "/desktop/authorize" || authorization.Host != server.Host {
			return errors.New("unexpected browser destination")
		}
		query := authorization.Query()
		challenge = query.Get("code_challenge")
		if query.Get("redirect_uri") != desktopLoginRedirectURI || query.Get("state") != state ||
			query.Get("code_challenge_method") != "S256" || !loginProof.MatchString(challenge) ||
			query.Has("code_verifier") || query.Has("access_token") || query.Has("refresh_token") {
			return errors.New("browser URL exposed private credentials")
		}
		valid := desktopLoginRedirectURI + "?state=" + state + "&code=" + strings.Repeat("c", 43)
		for _, forged := range []string{
			strings.Replace(valid, state, strings.Repeat("x", 43), 1),
			valid + "#",
			valid + "&state=" + state,
			valid + "&refresh_token=test",
			strings.Replace(valid, "auth/callback", "auth/other", 1),
		} {
			desktop.handleOpenURL(forged)
			if len(codes) != 0 {
				return errors.New("a forged login callback reached code exchange")
			}
		}
		desktop.handleOpenURL(valid)
		desktop.handleOpenURL(valid)
		return nil
	}, state, codes)
	if err != nil {
		t.Fatal(err)
	}
	if exchanges.Load() != 1 || !storeHasSession(store) {
		t.Fatal("native login did not create exactly one stored session")
	}
}

func TestBrowserSignInFailsOnCancelTimeoutOrBrowserFailure(t *testing.T) {
	server, _ := url.Parse("https://example.com")
	for _, mode := range []string{"cancel", "expired", "browser"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if mode == "expired" {
				ctx, cancel = context.WithDeadline(ctx, time.Now().Add(-time.Second))
				defer cancel()
			}
			err := browserSignIn(ctx, server, http.DefaultTransport, func(raw string) error {
				if mode == "browser" {
					return errors.New("OS browser failed")
				}
				cancel()
				return nil
			}, strings.Repeat("s", 43), make(chan string))
			expected := map[string]string{
				"cancel": "DESKTOP_LOGIN_CANCELLED", "expired": "DESKTOP_LOGIN_EXPIRED",
				"browser": "DESKTOP_LOGIN_BROWSER_UNAVAILABLE",
			}[mode]
			if err == nil || err.Error() != expected {
				t.Fatalf("unexpected termination: %v", err)
			}
		})
	}
}

type cancellingCredentialStore struct {
	*memoryCredentialStore
	cancel context.CancelFunc
}

func (store cancellingCredentialStore) Set(key string, value []byte) error {
	store.cancel()
	return store.memoryCredentialStore.Set(key, value)
}

func TestBrowserSignInCancellationDuringPersistenceFencesTheNewSession(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != desktopLoginExchangePath {
			t.Error("cancelled session reached another auth route")
		}
		w.Header().Set("X-Linksense-Desktop-Protocol", "1")
		http.SetCookie(w, &http.Cookie{
			Name: refreshCookieName, Value: strings.Repeat("r", 48),
			HttpOnly: true, Path: "/api/v1/auth", MaxAge: 3600,
		})
		w.WriteHeader(http.StatusNoContent)
	}))
	defer api.Close()
	server, _ := url.Parse(api.URL)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store := cancellingCredentialStore{memoryCredentialStore: &memoryCredentialStore{}, cancel: cancel}
	root := t.TempDir()
	before := &Desktop{}
	before.configure(server, store, root)
	if err := exchangeDesktopCode(ctx, server, before.session, strings.Repeat("c", 43), strings.Repeat("v", 43)); err == nil {
		t.Fatal("exchange reported success after cancellation during OS credential persistence")
	}
	after := &Desktop{}
	after.configure(server, store, root)
	if blocked, err := after.session.sessionBlocked(); err != nil || !blocked || storeHasSession(store.memoryCredentialStore) {
		t.Fatal("a new native instance could restore a session from a canceled sign-in")
	}
}
