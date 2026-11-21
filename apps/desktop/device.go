package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"runtime"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/egoist/mygo"
)

type deviceCapabilities struct {
	LocalExecution   bool `json:"local_execution"`
	BrowserExtension bool `json:"browser_extension"`
	ComputerUse      bool `json:"computer_use"`
}

type publicDevice struct {
	ID           string             `json:"id"`
	Name         string             `json:"name"`
	Platform     string             `json:"platform"`
	Arch         string             `json:"arch"`
	AppVersion   string             `json:"app_version"`
	Capabilities deviceCapabilities `json:"capabilities"`
	Online       bool               `json:"online"`
	LastSeenAt   *time.Time         `json:"last_seen_at"`
	RevokedAt    *time.Time         `json:"revoked_at"`
	CreatedAt    time.Time          `json:"created_at"`
	UpdatedAt    time.Time          `json:"updated_at"`
}

type deviceCredential struct {
	Token    string `json:"token"`
	OwnerID  string `json:"ownerId"`
	DeviceID string `json:"deviceId"`
	Name     string `json:"name"`
}

func validHex(value string, length int) bool {
	if len(value) != length || strings.ToLower(value) != value {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func (credential deviceCredential) valid() bool {
	return validHex(credential.Token, 64) && validUUID(credential.OwnerID) &&
		validUUID(credential.DeviceID) && credential.Name != ""
}

func (d *Desktop) PairDevice(ctx context.Context, code, name string) (DeviceConnectionStatus, error) {
	d.deviceSetup.Lock()
	defer d.deviceSetup.Unlock()
	if err := d.checkCaller(ctx); err != nil {
		return DeviceConnectionStatus{}, err
	}
	if blocked, err := d.session.sessionBlocked(); err != nil || blocked {
		return DeviceConnectionStatus{}, errors.New("AUTH_REQUIRED")
	}
	name = strings.TrimSpace(name)
	if !validHex(code, 32) || name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > 120 ||
		strings.ContainsFunc(name, unicode.IsControl) {
		return DeviceConnectionStatus{}, errors.New("VALIDATION_ERROR")
	}
	// Pairing registers a device for the account proven by the rotated refresh.
	// The renderer cannot pair into, or revive, another account's pairing.
	lease, err := requireAccount(&d.account)
	if err != nil {
		return DeviceConnectionStatus{}, err
	}
	info, err := d.Info(ctx)
	if err != nil {
		return DeviceConnectionStatus{}, err
	}
	// Registration capabilities stay false: execution is negotiated per socket
	// after runtime readiness, not stored as a device capability.
	body, err := json.Marshal(struct {
		Code         string             `json:"code"`
		Name         string             `json:"name"`
		Platform     string             `json:"platform"`
		Arch         string             `json:"arch"`
		AppVersion   string             `json:"app_version"`
		Capabilities deviceCapabilities `json:"capabilities"`
	}{code, name, info.Platform, runtime.GOARCH, info.Version, deviceCapabilities{}})
	if err != nil {
		return DeviceConnectionStatus{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, d.server.String()+"/api/v1/desktop/devices/pair", bytes.NewReader(body))
	if err != nil {
		return DeviceConnectionStatus{}, errors.New("DESKTOP_REQUEST_INVALID")
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("x-linksense-desktop-protocol", "1")
	request.Header.Set("x-linksense-client-build", strings.Repeat("0", 64))
	client := &http.Client{
		Transport: d.session, Timeout: 30 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	response, err := client.Do(request)
	if err != nil {
		return DeviceConnectionStatus{}, errors.New("NETWORK_UNAVAILABLE")
	}
	defer response.Body.Close()
	if response.Header.Get("x-linksense-desktop-protocol") != "1" {
		return DeviceConnectionStatus{}, errors.New("DESKTOP_UPDATE_REQUIRED")
	}
	if response.StatusCode != http.StatusOK {
		return DeviceConnectionStatus{}, errors.New("AUTH_SESSION_EXPIRED")
	}
	var result struct {
		Success   bool   `json:"success"`
		RequestID string `json:"request_id"`
		Data      struct {
			Token   string       `json:"token"`
			OwnerID string       `json:"owner_id"`
			Device  publicDevice `json:"device"`
		} `json:"data"`
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, (64<<10)+1))
	if err != nil || len(payload) > 64<<10 || !json.Valid(payload) {
		return DeviceConnectionStatus{}, errors.New("API_RESPONSE_INVALID")
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil || !result.Success {
		return DeviceConnectionStatus{}, errors.New("API_RESPONSE_INVALID")
	}
	credential := deviceCredential{
		Token: result.Data.Token, OwnerID: result.Data.OwnerID,
		DeviceID: result.Data.Device.ID, Name: result.Data.Device.Name,
	}
	if !credential.valid() || result.Data.Device.RevokedAt != nil {
		return DeviceConnectionStatus{}, errors.New("API_RESPONSE_INVALID")
	}
	// The paired response belongs to the native session, not to the renderer.
	// A different owner means the in-memory principal changed mid-request; do
	// not replace or revive any stored pairing on that ambiguity.
	if !strings.EqualFold(credential.OwnerID, lease.id) {
		return DeviceConnectionStatus{}, errors.New("FORBIDDEN")
	}
	rollback, err := d.storePairedDevice(credential, lease)
	if err != nil {
		return DeviceConnectionStatus{}, err
	}
	return d.completePairing(credential, lease, rollback)
}

// completePairing replaces the live device after the credential commit. The
// previous bridge close can wait for its socket to unwind; if the account
// changes during that wait, the committed bytes are rolled back. A failed
// pairing therefore never replaces a valid credential, and the connection
// created for the stale lease is closed before returning. Rollback runs under
// deviceSetup only: no auth mutex, no onClear wait.
func (d *Desktop) completePairing(credential deviceCredential, lease accountLease, rollback func() error) (DeviceConnectionStatus, error) {
	rollbackFailure := func() (DeviceConnectionStatus, error) {
		d.closeDevice()
		if err := rollback(); err != nil {
			return DeviceConnectionStatus{}, errors.New("DESKTOP_CREDENTIAL_STORE_UNAVAILABLE")
		}
		return DeviceConnectionStatus{}, errAccountRequired
	}
	// Never create a connection for a lease that was already lost after the
	// commit.
	if !d.pairingAuthorized(lease) {
		return rollbackFailure()
	}
	status := d.connectDevice(credential, lease)
	if d.pairingAuthorized(lease) {
		return status, nil
	}
	return rollbackFailure()
}

// pairingAuthorized reports whether the pairing lease still belongs to the
// current native principal and no sign-out intent is pending. Every read is
// nonblocking; no auth or account lock is held across a network or credential
// store wait.
func (d *Desktop) pairingAuthorized(lease accountLease) bool {
	return d.session != nil && !d.session.signOutPending.Load() && d.account.matches(lease)
}

// storePairedDevice commits a pairing response only while the native lease
// that authorized the pairing is still current. The response can arrive after
// the same account signed in again, the session expired, or the account
// switched; then PairDevice fails and the previous credential bytes survive. A
// blocked credential-store write is covered the same way: the previous bytes
// are restored if the lease is lost while the write is in flight. On success it
// returns a rollback that restores those previous bytes, used if the account
// changes during the bridge replacement that follows. deviceSetup serializes
// every device-credential write, so no other pairing or ClearSession delete can
// interleave with the read, write, restore, and later rollback.
func (d *Desktop) storePairedDevice(credential deviceCredential, lease accountLease) (func() error, error) {
	// Fail before touching the store when the response already arrived stale.
	if !d.pairingAuthorized(lease) {
		return nil, errAccountRequired
	}
	key := serverCredentialKey(d.server, "device")
	previous, previousErr := d.session.store.Get(key)
	if previousErr != nil && !errors.Is(previousErr, mygo.ErrSecretNotFound) {
		return nil, errors.New("DESKTOP_CREDENTIAL_STORE_UNAVAILABLE")
	}
	rollback := func() error {
		if previousErr == nil {
			return d.session.store.Set(key, previous)
		}
		return d.session.store.Delete(key)
	}
	// The credential read can block; do not write for a lease that ended while
	// it was in flight.
	if !d.pairingAuthorized(lease) {
		return nil, errAccountRequired
	}
	data, err := json.Marshal(credential)
	if err != nil {
		return nil, err
	}
	if err := d.session.store.Set(key, data); err != nil {
		return nil, errors.New("DESKTOP_CREDENTIAL_STORE_UNAVAILABLE")
	}
	if d.pairingAuthorized(lease) {
		return rollback, nil
	}
	// The lease was lost while the write was in flight. Restore exactly what
	// was there before, so a failed pairing cannot destroy a valid pairing.
	if err := rollback(); err != nil {
		return nil, errors.New("DESKTOP_CREDENTIAL_STORE_UNAVAILABLE")
	}
	return nil, errAccountRequired
}

func (d *Desktop) ResumeDevice(ctx context.Context, ownerID string) (DeviceConnectionStatus, error) {
	d.deviceSetup.Lock()
	defer d.deviceSetup.Unlock()
	if err := d.checkCaller(ctx); err != nil {
		return DeviceConnectionStatus{}, err
	}
	if blocked, err := d.session.sessionBlocked(); err != nil || blocked {
		d.closeDevice()
		return DeviceConnectionStatus{State: DeviceUnpaired}, err
	}
	if !validUUID(ownerID) {
		return DeviceConnectionStatus{}, errors.New("VALIDATION_ERROR")
	}
	// The renderer's ownerID selects a pairing; only the native principal proven
	// by the rotated refresh may restore it. No verified account means no
	// resume, and a different account cannot borrow the stored credential.
	lease, err := requireAccount(&d.account)
	if err != nil {
		d.closeDevice()
		return DeviceConnectionStatus{}, err
	}
	if !strings.EqualFold(lease.id, ownerID) {
		d.closeDevice()
		return DeviceConnectionStatus{}, errors.New("FORBIDDEN")
	}
	data, err := d.session.store.Get(serverCredentialKey(d.server, "device"))
	if errors.Is(err, mygo.ErrSecretNotFound) {
		return DeviceConnectionStatus{State: DeviceUnpaired}, nil
	}
	if err != nil {
		return DeviceConnectionStatus{}, errors.New("DESKTOP_CREDENTIAL_STORE_UNAVAILABLE")
	}
	var credential deviceCredential
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if !json.Valid(data) {
		return DeviceConnectionStatus{}, errors.New("FORBIDDEN")
	}
	if err := decoder.Decode(&credential); err != nil || !credential.valid() {
		return DeviceConnectionStatus{}, errors.New("FORBIDDEN")
	}
	// Preserve the stored pairing for a later valid sign-in, but never attach
	// it while the proven account is someone else.
	if !strings.EqualFold(credential.OwnerID, lease.id) {
		d.closeDevice()
		return DeviceConnectionStatus{}, errors.New("FORBIDDEN")
	}
	d.mu.RLock()
	current := d.device
	d.mu.RUnlock()
	if current != nil && current.credential == credential && current.authorized() {
		select {
		case <-current.done:
		default:
			return current.Status(), nil
		}
	}
	status := d.connectDevice(credential, lease)
	if !d.account.matches(lease) {
		d.closeDevice()
		return DeviceConnectionStatus{}, errAccountRequired
	}
	return status, nil
}

func (d *Desktop) DeviceStatus(ctx context.Context) (DeviceConnectionStatus, error) {
	if err := d.checkCaller(ctx); err != nil {
		return DeviceConnectionStatus{}, err
	}
	d.mu.RLock()
	device := d.device
	d.mu.RUnlock()
	if device == nil {
		return DeviceConnectionStatus{State: DeviceUnpaired}, nil
	}
	// Never publish a connection created for a signed-out, switched, or expired
	// native session, even if its device credential is still valid. The stored
	// credential is untouched so the same account can resume later.
	if !device.authorized() {
		device.cancel()
		return DeviceConnectionStatus{State: DeviceUnpaired}, nil
	}
	return device.Status(), nil
}

func (d *Desktop) connectDevice(credential deviceCredential, lease accountLease) DeviceConnectionStatus {
	d.closeDevice()
	connection := newDeviceConnection(d.server, credential, &d.account, lease)
	if d.session != nil {
		connection.signOut = &d.session.signOutPending
	}
	if runtime.GOOS == "darwin" {
		connection.runtime = d.localRuntime
	}
	d.mu.Lock()
	d.device = connection
	d.mu.Unlock()
	go connection.run()
	return connection.Status()
}

// clearInvalidatedDevice cancels the current connection only when the account
// lease it was created for is invalid. The callback runs after the account lock
// is dropped, so a resume for a newer generation may already have replaced
// d.device; a valid new connection must survive the older invalidation.
func (d *Desktop) clearInvalidatedDevice() {
	d.mu.RLock()
	device := d.device
	d.mu.RUnlock()
	if device != nil && !device.authorized() {
		device.cancel()
	}
}

func (d *Desktop) closeDevice() {
	d.mu.Lock()
	device := d.device
	d.device = nil
	d.mu.Unlock()
	if device != nil {
		device.cancel()
		<-device.done
	}
}
