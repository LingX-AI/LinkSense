package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestServerURLRequiresAnOriginWithoutCredentials(t *testing.T) {
	for _, raw := range []string{
		"", "file:///tmp/app", "https://user:password@example.com",
		"http://example.com", "https://example.com/path", "https://example.com/?token=value",
		"https://example.com/#fragment", "javascript:alert(1)",
	} {
		if _, err := parseServerURL(raw); err == nil {
			t.Fatalf("accepted an invalid server origin: %q", raw)
		}
	}
	for _, raw := range []string{"https://example.com/", "http://localhost:4000", "http://127.0.0.1:4000", "http://[::1]:4000"} {
		if _, err := parseServerURL(raw); err != nil {
			t.Fatalf("rejected valid server origin %q: %v", raw, err)
		}
	}
}

func TestServerConfigurationRoundTripAndCorruption(t *testing.T) {
	file := filepath.Join(t.TempDir(), "settings", "config.json")
	config, err := loadDesktopConfig(file)
	if err != nil || config.ServerURL != "" {
		t.Fatal("a new install should require server setup")
	}
	server, _ := parseServerURL("https://example.com/")
	if err := saveDesktopConfig(file, server); err != nil {
		t.Fatal(err)
	}
	config, err = loadDesktopConfig(file)
	if err != nil || config.ServerURL != "https://example.com" {
		t.Fatalf("configuration did not survive restart: %+v %v", config, err)
	}
	if err := os.WriteFile(file, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadDesktopConfig(file); err == nil {
		t.Fatal("corrupt configuration was accepted")
	}
}
