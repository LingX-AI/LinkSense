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
	info, err := d.Info(ctx)
	if err != nil {
		return DeviceConnectionStatus{}, err
	}
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
	data, err := json.Marshal(credential)
	if err != nil {
		return DeviceConnectionStatus{}, err
	}
	if err := d.session.store.Set(serverCredentialKey(d.server, "device"), data); err != nil {
		return DeviceConnectionStatus{}, errors.New("DESKTOP_CREDENTIAL_STORE_UNAVAILABLE")
	}
	return d.connectDevice(credential), nil
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
	if credential.OwnerID != ownerID {
		d.closeDevice()
		return DeviceConnectionStatus{}, errors.New("FORBIDDEN")
	}
	d.mu.RLock()
	current := d.device
	d.mu.RUnlock()
	if current != nil && current.credential == credential {
		select {
		case <-current.done:
		default:
			return current.Status(), nil
		}
	}
	return d.connectDevice(credential), nil
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
	return device.Status(), nil
}

func (d *Desktop) connectDevice(credential deviceCredential) DeviceConnectionStatus {
	d.closeDevice()
	connection := newDeviceConnection(d.server, credential)
	d.mu.Lock()
	d.device = connection
	d.mu.Unlock()
	go connection.run()
	return connection.Status()
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
