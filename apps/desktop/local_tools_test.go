package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLocalToolsPreferenceDefaultsEnabledAndPersistsOptOut(t *testing.T) {
	desktop := &Desktop{dataRoot: t.TempDir()}
	if !desktop.localToolsEnabled() {
		t.Fatal("local tools must default to enabled")
	}
	if err := desktop.setLocalToolsPreference(false); err != nil {
		t.Fatal(err)
	}
	if desktop.localToolsEnabled() {
		t.Fatal("the persisted opt-out was ignored")
	}
	if err := desktop.setLocalToolsPreference(true); err != nil {
		t.Fatal(err)
	}
	if !desktop.localToolsEnabled() {
		t.Fatal("re-enabling did not persist")
	}
	if err := os.WriteFile(filepath.Join(desktop.dataRoot, localToolsPreferenceFile), []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if desktop.localToolsEnabled() {
		t.Fatal("a corrupt preference must fail closed to disabled")
	}
}

func TestDeviceEnrollmentRefreshesTheAccountAndStoresTheRotatedCredential(t *testing.T) {
	const ownerID = "50000000-0000-4000-8000-000000000001"
	const deviceID = "60000000-0000-4000-8000-000000000001"
	const accessToken = "native-access-token-000000000000000000000"
	refreshCalls := 0
	registerCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/auth/refresh":
			refreshCalls++
			http.SetCookie(w, &http.Cookie{
				Name: refreshCookieName, Value: strings.Repeat("c", 64),
				Path: "/api/v1/auth", HttpOnly: true, MaxAge: 3600,
			})
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": true,
				"data": map[string]any{
					"user":                       map[string]any{"id": ownerID},
					"access_token":               accessToken,
					"access_token_expires_at":    time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano),
					"refresh_session_expires_at": time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339Nano),
				},
			})
		case "/api/v1/desktop/devices/register":
			registerCalls++
			if r.Header.Get("Authorization") != "Bearer "+accessToken {
				t.Errorf("registration did not use the native access token: %q", r.Header.Get("Authorization"))
			}
			var input struct {
				Name       string `json:"name"`
				Platform   string `json:"platform"`
				AppVersion string `json:"app_version"`
			}
			if json.NewDecoder(r.Body).Decode(&input) != nil || input.Name == "" || input.Platform == "" {
				t.Errorf("registration body was invalid")
			}
			w.Header().Set("x-linksense-desktop-protocol", "1")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"success": true,
				"data": map[string]any{
					"token": strings.Repeat("d", 64), "owner_id": ownerID,
					"device": publicDevice{
						ID: deviceID, Name: "Mac", Platform: "darwin", Arch: "arm64",
						AppVersion: "development", CreatedAt: time.Now(), UpdatedAt: time.Now(),
					},
				},
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	origin, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	store := &memoryCredentialStore{}
	desktop := &Desktop{server: origin, dataRoot: t.TempDir()}
	client := newDesktopHTTPClient(origin, store)
	desktop.session = client.Transport.(*sessionTransport)
	desktop.session.account = &desktop.account
	desktop.session.signedOutPath = filepath.Join(desktop.dataRoot, "sessions", serverCredentialKey(origin, "refresh")+".signed-out")
	seedRefreshSession(t, desktop.session, strings.Repeat("a", 64), time.Now().Add(time.Hour))
	if err := desktop.refreshNativeAccount(context.Background()); err != nil {
		t.Fatal(err)
	}
	lease, err := requireAccount(&desktop.account)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := desktop.registerDevice(context.Background(), lease, deviceCredential{}, false, false); err != nil {
		t.Fatal(err)
	}
	defer desktop.closeDevice()
	if refreshCalls != 1 || registerCalls != 1 {
		t.Fatalf("unexpected enrollment calls: refresh=%d register=%d", refreshCalls, registerCalls)
	}
	credential, err := desktop.readStoredDevice()
	if err != nil {
		t.Fatal(err)
	}
	if credential.DeviceID != deviceID || credential.OwnerID != ownerID || credential.Token != strings.Repeat("d", 64) {
		t.Fatalf("stored credential did not match the registration response: %+v", credential)
	}
}

func TestInstallationIDIsStableAndSeparateFromTheDeviceCredential(t *testing.T) {
	desktop := &Desktop{dataRoot: t.TempDir()}
	first := desktop.installationID()
	if !validUUID(first) {
		t.Fatalf("installation id is not a UUID: %q", first)
	}
	if second := desktop.installationID(); second != first {
		t.Fatalf("installation id changed: %q != %q", first, second)
	}
	info, err := os.Stat(filepath.Join(desktop.dataRoot, installationIDFile))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("installation id file mode = %v, %v", info, err)
	}
}
