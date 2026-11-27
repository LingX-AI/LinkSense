package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// The session payload is tiny; never buffer an unbounded API response.
	maxRefreshCaptureBytes = 64 << 10
	// The refresh cookie is issued for 90 days. A server-supplied session
	// expiry beyond this must not extend native trust past the credential.
	maxAccountSessionLifetime = 90 * 24 * time.Hour
)

// workspaceAccount is the signed-in account learned from a successful native
// refresh. It holds only an account id and its session expiry in process
// memory: no token, JWT claim, cookie, or profile data is retained. The
// WebView cannot supply or override it.
type workspaceAccount struct {
	mu        sync.RWMutex
	id        string
	expiresAt time.Time
	// generation changes on every invalidation and every new sign-in. A relay
	// started under one generation cannot complete under another, even when the
	// server returns the same account id after a sign-out.
	generation uint64
	// sessionCtx ends when this exact account generation is invalidated or
	// replaced. A same-generation refresh keeps it, so native notification
	// delivery can wait on the session without canceling on every refresh.
	sessionCtx    context.Context
	cancelSession context.CancelFunc
	// accessToken is the short-lived token from the same native refresh that
	// proved this account. It stays in memory and is used only for the
	// authenticated local-tools registration call.
	accessToken   string
	accessExpires time.Time
	// onClear releases relays that must not outlive this account, such as a
	// pending workspace cleanup. It is installed once during startup.
	onClear func()
}

// accountLease pins one relay to the account generation it started under.
// expiresAt lets a relay stop at the same instant the in-memory session ends.
type accountLease struct {
	id         string
	generation uint64
	expiresAt  time.Time
	// sessionCtx is canceled when the exact account generation ends. Only
	// approval notification delivery depends on it.
	sessionCtx context.Context
}

func (a *workspaceAccount) set(id string, expiresAt time.Time) {
	a.setForRefresh(id, expiresAt, time.Time{})
}

// setForRefresh records an identity proven by an authenticated native refresh.
// The server-reported session expiry can never outlive the rotated refresh
// credential itself.
func (a *workspaceAccount) setForRefresh(id string, expiresAt, credentialExpiresAt time.Time) {
	a.setForRefreshIf(id, expiresAt, credentialExpiresAt, nil)
}

// setForRefreshIf publishes a refresh proof only if guard still holds under the
// same lifetime write lock that clear() takes. A sign-out that was requested
// while the response body or credential store was blocked therefore cannot be
// repopulated by a late publication: either the guard sees the invalidation, or
// the publication happens first and clear() removes it afterwards. guard runs
// under the account lock and must only read already-synchronized state.
func (a *workspaceAccount) setForRefreshIf(
	id string, expiresAt, credentialExpiresAt time.Time, guard func() bool,
) bool {
	now := time.Now()
	if !validUUID(id) || !expiresAt.After(now) {
		a.clear()
		return false
	}
	if !credentialExpiresAt.IsZero() && credentialExpiresAt.Before(expiresAt) {
		expiresAt = credentialExpiresAt
	}
	if limit := now.Add(maxAccountSessionLifetime); expiresAt.After(limit) {
		expiresAt = limit
	}
	if !expiresAt.After(now) {
		a.clear()
		return false
	}
	// Normalize the identity once so every consumer (runtime paths, markers)
	// compares and scopes the same value.
	id = strings.ToLower(id)
	a.mu.Lock()
	if guard != nil && !guard() {
		a.mu.Unlock()
		return false
	}
	// A switch to another account, or a refresh that follows a lifetime that
	// already expired in memory, starts a new session. Relays started under the
	// previous lifetime must be released and cancelled, exactly like sign-out.
	previous := a.id
	expired := previous != "" && !now.Before(a.expiresAt)
	replaced := previous != "" && (previous != id || expired)
	if previous != id || expired {
		// A new account generation must never reuse the previous session's
		// short-lived access token.
		a.accessToken, a.accessExpires = "", time.Time{}
		a.generation++
		if a.cancelSession != nil {
			a.cancelSession()
		}
		a.sessionCtx, a.cancelSession = context.WithCancel(context.Background())
	}
	a.id, a.expiresAt = id, expiresAt
	onClear := a.onClear
	a.mu.Unlock()
	if replaced && onClear != nil {
		onClear()
	}
	return true
}

func (a *workspaceAccount) setOnClear(callback func()) {
	a.mu.Lock()
	a.onClear = callback
	a.mu.Unlock()
}

func (a *workspaceAccount) clear() {
	a.mu.Lock()
	a.id, a.expiresAt = "", time.Time{}
	a.accessToken, a.accessExpires = "", time.Time{}
	// Invalidate every lease issued to the previous session, including a later
	// sign-in that happens to receive the same account id.
	a.generation++
	if a.cancelSession != nil {
		a.cancelSession()
		a.cancelSession = nil
	}
	a.sessionCtx = nil
	onClear := a.onClear
	a.mu.Unlock()
	if onClear != nil {
		onClear()
	}
}

func (a *workspaceAccount) current() (string, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.id == "" || !time.Now().Before(a.expiresAt) {
		return "", false
	}
	return a.id, true
}

func (a *workspaceAccount) lease() (accountLease, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.id == "" || !time.Now().Before(a.expiresAt) {
		return accountLease{}, false
	}
	return accountLease{
		id: a.id, generation: a.generation, expiresAt: a.expiresAt, sessionCtx: a.sessionCtx,
	}, true
}

func (a *workspaceAccount) matches(lease accountLease) bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return lease.id != "" && a.id == lease.id && a.generation == lease.generation &&
		time.Now().Before(a.expiresAt)
}

// setAccessToken binds a short-lived native token to the exact account
// generation the refresh proved. A stale response cannot replace a newer
// session's token.
func (a *workspaceAccount) setAccessToken(lease accountLease, token string, expiresAt time.Time) bool {
	if token == "" || !expiresAt.After(time.Now()) {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if lease.id == "" || a.id != lease.id || a.generation != lease.generation ||
		!time.Now().Before(a.expiresAt) {
		return false
	}
	a.accessToken, a.accessExpires = token, expiresAt
	return true
}

func (a *workspaceAccount) currentAccessToken() (string, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.accessToken == "" || !time.Now().Before(a.accessExpires) || a.id == "" {
		return "", false
	}
	return a.accessToken, true
}

func (a *workspaceAccount) currentAccessTokenIdentity() (string, string, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.accessToken == "" || !time.Now().Before(a.accessExpires) || a.id == "" {
		return "", "", false
	}
	return a.id, a.accessToken, true
}

// withLease runs fn only while this exact account session is still current and
// holds the read lease until fn returns. It is used at the private pipe's
// admission point so a cleanup frame is written only under a valid lease; the
// callback must stay bounded and must not wait for a reply. Invalidation takes
// the account write lock before releasing relays, so admission and clear/change
// are ordered without holding the account lock across a relay.
func (a *workspaceAccount) withLease(lease accountLease, fn func() error) error {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if lease.id == "" || a.id != lease.id || a.generation != lease.generation ||
		!time.Now().Before(a.expiresAt) {
		return errAccountRequired
	}
	return fn()
}

type refreshSessionEnvelope struct {
	Success bool `json:"success"`
	Data    struct {
		User struct {
			ID string `json:"id"`
		} `json:"user"`
		AccessToken             string `json:"access_token"`
		AccessTokenExpiresAt    string `json:"access_token_expires_at"`
		RefreshSessionExpiresAt string `json:"refresh_session_expires_at"`
	} `json:"data"`
}

// refreshAccountProof records what the native transport actually did for a
// refresh. Trusting the response body alone would admit an account after a
// signed-out marker blocked the cookie, an expired credential was omitted, or
// the rotated token could not be stored.
type refreshAccountProof struct {
	trusted          bool
	credentialExpiry time.Time
	epoch            uint64
}

// captureRefreshAccount reads the same response the WebView receives. The
// bytes are replayed unchanged, and any unreadable or malformed payload clears
// the account rather than falling back to a previous account. A 2xx response
// is trusted only for a refresh the native transport authenticated itself and
// whose rotated credential it stored. It returns stale when sign-out or an
// account/session change landed after the response arrived; the caller must
// then reject the response instead of reporting a refresh success the native
// host no longer honors.
func (t *sessionTransport) captureRefreshAccount(response *http.Response, proof refreshAccountProof) bool {
	account := t.account
	if account == nil || response.Body == nil {
		return false
	}
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		account.clear()
		return false
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return false
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxRefreshCaptureBytes+1))
	if err != nil || len(body) > maxRefreshCaptureBytes {
		response.Body = &replayedResponseBody{
			Reader: io.MultiReader(bytes.NewReader(body), response.Body),
			closer: response.Body,
		}
		account.clear()
		return false
	}
	_ = response.Body.Close()
	response.Body = io.NopCloser(bytes.NewReader(body))
	response.ContentLength = int64(len(body))
	response.Header.Set("Content-Length", strconv.Itoa(len(body)))
	var envelope refreshSessionEnvelope
	if !json.Valid(body) || json.Unmarshal(body, &envelope) != nil || !envelope.Success {
		account.clear()
		return false
	}
	// A successful-looking body is not proof by itself. The request must have
	// carried the native Keychain cookie and the rotated credential must have
	// been stored, or this response cannot define the signed-in account.
	if !proof.trusted {
		account.clear()
		return false
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, envelope.Data.RefreshSessionExpiresAt)
	if err != nil {
		account.clear()
		return false
	}
	if !validUUID(envelope.Data.User.ID) {
		account.clear()
		return false
	}
	// The body read and credential store may have blocked for a long time. The
	// proof is published only if no sign-out/account change landed meanwhile,
	// checked and recorded atomically against the same lifetime lock clear()
	// takes. False means the guard rejected publication.
	published := account.setForRefreshIf(envelope.Data.User.ID, expiresAt, proof.credentialExpiry, func() bool {
		return !t.signOutPending.Load() && t.authEpoch.Load() == proof.epoch
	})
	if published {
		if lease, ok := account.lease(); ok {
			if accessExpires, parseErr := time.Parse(time.RFC3339Nano, envelope.Data.AccessTokenExpiresAt); parseErr == nil {
				account.setAccessToken(lease, envelope.Data.AccessToken, accessExpires)
			}
		}
	}
	return !published
}

type replayedResponseBody struct {
	io.Reader
	closer io.Closer
}

func (body *replayedResponseBody) Close() error {
	return body.closer.Close()
}

// errAccountRequired is returned when no verified account is available. It is
// deliberately the same code the device and login bridges already use.
var errAccountRequired = errors.New("AUTH_REQUIRED")

// A refresh without a verifiable, successful native response leaves no
// account to act on. The returned lease must still match after every relay so
// a switch, expiry, or same-id sign-in cannot carry a result across sessions.
func requireAccount(account *workspaceAccount) (accountLease, error) {
	if account == nil {
		return accountLease{}, errAccountRequired
	}
	lease, ok := account.lease()
	if !ok || !validUUID(lease.id) {
		return accountLease{}, errAccountRequired
	}
	return lease, nil
}
