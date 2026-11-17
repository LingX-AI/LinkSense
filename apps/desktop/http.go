package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/netproxy"
)

const refreshCookieName = "linksense_refresh"

type credentialStore interface {
	Get(string) ([]byte, error)
	Set(string, []byte) error
	Delete(string) error
}

type storedRefreshSession struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// The refresh cookie belongs to the native client; the WebView never persists it.
type sessionTransport struct {
	server        *url.URL
	store         credentialStore
	base          http.RoundTripper
	mu            sync.Mutex
	signedOut     bool
	signedOutPath string
}

func allowsAPIRequest(server *url.URL, request *http.Request) bool {
	u := request.URL
	if u.Scheme != server.Scheme || !strings.EqualFold(u.Hostname(), server.Hostname()) ||
		effectivePort(u) != effectivePort(server) ||
		u.User != nil || u.Fragment != "" || request.Host != u.Host ||
		!strings.HasPrefix(u.Path, "/api/v1/") || path.Clean(u.Path) != u.Path {
		return false
	}
	escaped := strings.ToLower(u.EscapedPath())
	if strings.Contains(escaped, "%2f") || strings.Contains(escaped, "%5c") ||
		strings.Contains(u.Path, "\\") || strings.ContainsRune(u.Path, 0) {
		return false
	}
	switch request.Method {
	case http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func effectivePort(u *url.URL) string {
	if port := u.Port(); port != "" {
		return port
	}
	if u.Scheme == "https" {
		return "443"
	}
	return "80"
}

func (t *sessionTransport) secretKey() string {
	return serverCredentialKey(t.server, "refresh")
}

func serverCredentialKey(server *url.URL, purpose string) string {
	hash := sha256.Sum256([]byte(server.String()))
	return purpose + "." + hex.EncodeToString(hash[:])
}

func (t *sessionTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if !allowsAPIRequest(t.server, request) {
		return nil, errors.New("DESKTOP_REQUEST_FORBIDDEN")
	}
	authRequest := strings.HasPrefix(request.URL.Path, "/api/v1/auth/")
	if authRequest {
		// Refresh rotation and logout must not race in the native cookie store.
		t.mu.Lock()
		defer t.mu.Unlock()
	}
	out := request.Clone(request.Context())
	cancel := context.CancelFunc(func() {})
	if authRequest {
		ctx, stop := context.WithTimeout(out.Context(), 30*time.Second)
		cancel = stop
		out = out.Clone(ctx)
	}
	succeeded := false
	defer func() {
		if !succeeded {
			cancel()
		}
	}()
	out.Header.Del("Cookie")
	out.Header.Del("Origin")
	out.Header.Del("Referer")
	blocked := false
	if authRequest {
		var err error
		blocked, err = t.refreshBlocked()
		if err != nil {
			return nil, errors.New("DESKTOP_CREDENTIAL_STORE_UNAVAILABLE")
		}
		var data []byte
		if !blocked {
			data, err = t.store.Get(t.secretKey())
		} else {
			err = mygo.ErrSecretNotFound
		}
		if err != nil && !errors.Is(err, mygo.ErrSecretNotFound) {
			return nil, errors.New("DESKTOP_CREDENTIAL_STORE_UNAVAILABLE")
		}
		if err == nil {
			var session storedRefreshSession
			if json.Unmarshal(data, &session) != nil || !session.ExpiresAt.After(time.Now()) {
				if err := t.store.Delete(t.secretKey()); err != nil {
					return nil, errors.New("DESKTOP_CREDENTIAL_STORE_UNAVAILABLE")
				}
			} else {
				out.AddCookie(&http.Cookie{Name: refreshCookieName, Value: session.Token})
			}
		}
	}
	response, err := t.base.RoundTrip(out)
	if err != nil {
		return nil, errors.New("DESKTOP_API_UNAVAILABLE")
	}
	loginExchange := request.URL.Path == desktopLoginExchangePath
	if loginExchange && (response.StatusCode != http.StatusNoContent ||
		response.Header.Get("X-Linksense-Desktop-Protocol") != "1" || out.Context().Err() != nil) {
		response.Body.Close()
		return nil, errors.New("DESKTOP_LOGIN_FAILED")
	}
	storedSession := false
	for _, cookie := range response.Cookies() {
		if !authRequest || cookie.Name != refreshCookieName {
			continue
		}
		if cookie.MaxAge < 0 || (!cookie.Expires.IsZero() && cookie.Expires.Before(time.Now())) {
			err = t.store.Delete(t.secretKey())
		} else if cookie.HttpOnly && cookie.Path == "/api/v1/auth" &&
			(cookie.Secure || t.server.Scheme == "http") &&
			(cookie.Domain == "" || strings.EqualFold(cookie.Domain, t.server.Hostname())) {
			if blocked && request.URL.Path == "/api/v1/auth/refresh" {
				continue
			}
			expiry := cookie.Expires
			if cookie.MaxAge > 0 {
				expiry = time.Now().Add(time.Duration(cookie.MaxAge) * time.Second)
			}
			if expiry.IsZero() || !expiry.After(time.Now()) {
				continue
			}
			var data []byte
			data, err = json.Marshal(storedRefreshSession{Token: cookie.Value, ExpiresAt: expiry})
			if err == nil {
				err = t.store.Set(t.secretKey(), data)
			}
			if err == nil && response.StatusCode >= 200 && response.StatusCode < 300 &&
				request.URL.Path != "/api/v1/auth/refresh" {
				err = t.allowNewSession()
			}
			if loginExchange && out.Context().Err() != nil {
				response.Body.Close()
				if clearErr := t.clearSessionLocked(); clearErr != nil {
					return nil, clearErr
				}
				return nil, errors.New("DESKTOP_LOGIN_CANCELLED")
			}
			storedSession = err == nil
		}
		if err != nil {
			response.Body.Close()
			return nil, errors.New("DESKTOP_CREDENTIAL_STORE_UNAVAILABLE")
		}
	}
	if loginExchange && !storedSession {
		response.Body.Close()
		return nil, errors.New("DESKTOP_LOGIN_FAILED")
	}
	response.Header.Del("Set-Cookie")
	response.Body = &sessionResponseBody{ReadCloser: response.Body, cancel: cancel}
	succeeded = true
	return response, nil
}

type sessionResponseBody struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (body *sessionResponseBody) Close() error {
	defer body.cancel()
	return body.ReadCloser.Close()
}

func newDesktopHTTPClient(server *url.URL, store credentialStore) *http.Client {
	base := netproxy.Transport().Clone()
	base.ResponseHeaderTimeout = 30 * time.Second
	base.TLSHandshakeTimeout = 10 * time.Second
	return &http.Client{
		Transport: &sessionTransport{server: server, store: store, base: base},
		// API redirects are returned to the UI, never followed with credentials.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

func (t *sessionTransport) clearSession() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.clearSessionLocked()
}

func (t *sessionTransport) clearSessionLocked() error {
	t.signedOut = true
	var markerErr error
	if t.signedOutPath != "" {
		markerErr = os.MkdirAll(filepath.Dir(t.signedOutPath), 0o700)
		if markerErr == nil {
			// This non-secret marker prevents restoring a credential that the OS store could not delete.
			markerErr = os.WriteFile(t.signedOutPath, []byte("signed-out\n"), 0o600)
		}
	}
	deleteErr := t.store.Delete(t.secretKey())
	if markerErr != nil || deleteErr != nil {
		return errors.New("DESKTOP_CREDENTIAL_STORE_UNAVAILABLE")
	}
	return nil
}

// Caller holds mu; unlike the credential, the logout intent is safe to keep on disk.
func (t *sessionTransport) refreshBlocked() (bool, error) {
	if t.signedOut || t.signedOutPath == "" {
		return t.signedOut, nil
	}
	_, err := os.Stat(t.signedOutPath)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return true, err
	}
	t.signedOut = true
	return true, nil
}

func (t *sessionTransport) sessionBlocked() (bool, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.refreshBlocked()
}

func (t *sessionTransport) allowNewSession() error {
	if t.signedOutPath != "" {
		if err := os.Remove(t.signedOutPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	t.signedOut = false
	return nil
}
