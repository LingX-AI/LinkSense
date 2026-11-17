package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/egoist/mygo"
)

const desktopLoginRedirectURI = "linksense-desktop://auth/callback"
const desktopLoginExchangePath = "/api/v1/auth/desktop/exchange"

var loginProof = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

type browserLoginAttempt struct {
	state  string
	code   chan string
	cancel context.CancelFunc
}

func (d *Desktop) SignIn(ctx context.Context) error {
	if err := d.checkCaller(ctx); err != nil {
		return err
	}
	d.mu.Lock()
	if d.login != nil {
		d.mu.Unlock()
		return errors.New("DESKTOP_LOGIN_IN_PROGRESS")
	}
	loginContext, cancel := context.WithTimeout(ctx, 5*time.Minute)
	attempt := &browserLoginAttempt{
		state: base64.RawURLEncoding.EncodeToString(randomLoginBytes()),
		code:  make(chan string, 1), cancel: cancel,
	}
	callback := attempt.code
	d.login = attempt
	d.mu.Unlock()
	defer func() {
		cancel()
		d.mu.Lock()
		d.login = nil
		d.mu.Unlock()
	}()
	open := d.openBrowser
	if open == nil {
		open = mygo.Shell.OpenExternal
	}
	err := browserSignIn(loginContext, d.server, d.session, open, attempt.state, callback)
	if err == nil {
		if win := d.mainWindow(); win != nil {
			win.Show()
			win.Focus()
		}
	}
	return err
}

func (d *Desktop) CancelSignIn(ctx context.Context) error {
	if err := d.checkCaller(ctx); err != nil {
		return err
	}
	d.cancelSignIn()
	return nil
}

func (d *Desktop) cancelSignIn() {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if d.login != nil {
		d.login.cancel()
	}
}

func (d *Desktop) handleOpenURL(raw string) {
	if strings.HasPrefix(raw, desktopLoginRedirectURI) {
		d.acceptLoginCallback(raw)
		return
	}
	if route, err := conversationDeepLink(raw); err == nil {
		if win := d.mainWindow(); win != nil {
			win.Show()
			win.Focus()
			_ = win.Page().LoadURL(route)
		}
	}
}

func (d *Desktop) acceptLoginCallback(raw string) {
	if len(raw) > 512 || !strings.HasPrefix(raw, desktopLoginRedirectURI+"?") || strings.Contains(raw, "#") {
		return
	}
	query, err := url.ParseQuery(strings.TrimPrefix(raw, desktopLoginRedirectURI+"?"))
	if err != nil || len(query) != 2 || len(query["state"]) != 1 || len(query["code"]) != 1 ||
		!loginProof.MatchString(query.Get("code")) {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	attempt := d.login
	if attempt == nil || attempt.code == nil ||
		subtle.ConstantTimeCompare([]byte(query.Get("state")), []byte(attempt.state)) != 1 {
		return
	}
	attempt.code <- query.Get("code")
	attempt.code = nil
}

func browserSignIn(ctx context.Context, server *url.URL, transport http.RoundTripper, open func(string) error, state string, callback <-chan string) error {
	verifier := base64.RawURLEncoding.EncodeToString(randomLoginBytes())
	hash := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(hash[:])
	authorization := *server
	authorization.Path = "/desktop/authorize"
	authorization.RawQuery = url.Values{
		"redirect_uri": {desktopLoginRedirectURI}, "state": {state},
		"code_challenge": {challenge}, "code_challenge_method": {"S256"},
	}.Encode()
	if ctx.Err() == nil {
		if err := open(authorization.String()); err != nil {
			return errors.New("DESKTOP_LOGIN_BROWSER_UNAVAILABLE")
		}
	}
	select {
	case code := <-callback:
		if ctx.Err() == nil {
			err := exchangeDesktopCode(ctx, server, transport, code, verifier)
			if err == nil || ctx.Err() == nil {
				return err
			}
		}
	case <-ctx.Done():
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return errors.New("DESKTOP_LOGIN_EXPIRED")
	}
	return errors.New("DESKTOP_LOGIN_CANCELLED")
}

func randomLoginBytes() []byte {
	value := make([]byte, 32)
	// crypto/rand.Read terminates the process if the system entropy source fails.
	_, _ = rand.Read(value)
	return value
}

func exchangeDesktopCode(ctx context.Context, server *url.URL, transport http.RoundTripper, code, verifier string) error {
	endpoint := *server
	endpoint.Path = desktopLoginExchangePath
	body, err := json.Marshal(struct {
		Code        string `json:"code"`
		Verifier    string `json:"code_verifier"`
		RedirectURI string `json:"redirect_uri"`
	}{code, verifier, desktopLoginRedirectURI})
	if err != nil {
		return errors.New("DESKTOP_LOGIN_FAILED")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return errors.New("DESKTOP_LOGIN_FAILED")
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Linksense-Desktop-Protocol", "1")
	request.Header.Set("X-Linksense-Client-Build", strings.Repeat("0", 64))
	response, err := transport.RoundTrip(request)
	if err != nil {
		return errors.New("DESKTOP_LOGIN_FAILED")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent || response.Header.Get("X-Linksense-Desktop-Protocol") != "1" {
		return errors.New("DESKTOP_LOGIN_FAILED")
	}
	return nil
}
