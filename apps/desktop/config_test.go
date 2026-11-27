package main

import (
	"testing"
)

func TestServerURLRequiresAnOriginWithoutCredentials(t *testing.T) {
	for _, raw := range []string{
		"", "file:///tmp/app", "https://user:password@example.com",
		"https://example.com/path", "https://example.com/?token=value",
		"https://example.com/#fragment", "javascript:alert(1)",
	} {
		if _, err := parseServerURL(raw); err == nil {
			t.Fatalf("accepted an invalid server origin: %q", raw)
		}
	}
	for _, raw := range []string{
		"https://example.com/", "http://example.com", "http://192.168.2.210:19090",
		"http://localhost:4000", "http://127.0.0.1:4000", "http://[::1]:4000",
	} {
		if _, err := parseServerURL(raw); err != nil {
			t.Fatalf("rejected valid server origin %q: %v", raw, err)
		}
	}
}

func TestPackagedServerCannotBeOverriddenByRuntimeConfiguration(t *testing.T) {
	previous := desktopServerURL
	defer func() { desktopServerURL = previous }()
	desktopServerURL = "https://example.com"
	t.Setenv("LINKSENSE_DESKTOP_SERVER_URL", "https://attacker.example")
	t.Setenv("LINKSENSE_DESKTOP_DEV_SERVER_URL", "http://localhost:4000")
	for _, development := range []bool{true, false} {
		server, err := configuredServerURL(development)
		if err != nil || server.String() != "https://example.com" {
			t.Fatal("runtime environment overrode the packaged origin")
		}
	}
	desktopServerURL = ""
	if _, err := configuredServerURL(false); err == nil {
		t.Fatal("an unconfigured release accepted a runtime origin")
	}
	server, err := configuredServerURL(true)
	if err != nil || server.String() != "http://localhost:4000" {
		t.Fatal("development launcher could not select its fixture server")
	}
}
