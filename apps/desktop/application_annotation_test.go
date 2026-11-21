package main

import (
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDesktopServerOriginMatchesWebViewOriginSerialization(t *testing.T) {
	for _, test := range []struct {
		raw  string
		want string
	}{
		{"https://Example.COM:443/", "https://example.com"},
		{"https://example.com:8443", "https://example.com:8443"},
		{"http://localhost:80", "http://localhost"},
		{"http://127.0.0.1:80", "http://127.0.0.1"},
		{"http://127.0.0.2:4000", "http://127.0.0.2:4000"},
		{"http://[::1]:8080", "http://[::1]:8080"},
		{"https://[::1]:443", "https://[::1]"},
	} {
		server, err := url.Parse(test.raw)
		if err != nil {
			t.Fatalf("parse %q: %v", test.raw, err)
		}
		origin, err := desktopServerOrigin(server)
		if err != nil || origin != test.want {
			t.Fatalf("%q: origin %q, error %v; want %q", test.raw, origin, err, test.want)
		}
	}
	for _, raw := range []string{
		"", "https://", "mygo://localhost", "http://example.com",
		"https://user:password@example.com", "https://example.com/path",
		"https://example.com?token=value",
	} {
		server, err := url.Parse(raw)
		if err != nil {
			continue
		}
		if origin, err := desktopServerOrigin(server); err == nil {
			t.Fatalf("%q: accepted an invalid origin %q", raw, origin)
		}
	}
}

func TestDesktopApplicationAnnotationPreloadIsDarwinOnlyFirstParty(t *testing.T) {
	resources := t.TempDir()
	platform := filepath.Join(resources, "darwin")
	if err := os.MkdirAll(platform, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(platform, desktopApplicationAnnotationPreloadFile),
		[]byte("/* first-party controller */"), 0o644,
	); err != nil {
		t.Fatal(err)
	}
	server, err := url.Parse("https://Example.com:443/")
	if err != nil {
		t.Fatal(err)
	}
	preload := desktopApplicationAnnotationPreload("darwin", resources, server)
	for _, want := range []string{
		`{"version":1,"serverOrigin":"https://example.com","parentOrigin":"mygo://localhost"}`,
		`location.origin !== config.serverOrigin`,
		"/* first-party controller */",
	} {
		if !strings.Contains(preload, want) {
			t.Fatalf("preload is missing %q: %q", want, preload)
		}
	}
	if got := desktopApplicationAnnotationPreload("windows", resources, server); got != "" {
		t.Fatalf("Windows received a Mac preload: %q", got)
	}
	if got := desktopApplicationAnnotationPreload("darwin", resources, nil); got != "" {
		t.Fatalf("a missing server produced a preload: %q", got)
	}
	if got := desktopApplicationAnnotationPreload("darwin", resources, mustURL(t, "http://example.com")); got != "" {
		t.Fatalf("a non-loopback HTTP server produced a preload: %q", got)
	}

	// Packaged apps merge platform resources into Contents/Resources.
	if err := os.Remove(filepath.Join(platform, desktopApplicationAnnotationPreloadFile)); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(resources, desktopApplicationAnnotationPreloadFile),
		[]byte("/* packaged controller */"), 0o644,
	); err != nil {
		t.Fatal(err)
	}
	preload = desktopApplicationAnnotationPreload("darwin", resources, server)
	if !strings.Contains(preload, "/* packaged controller */") {
		t.Fatalf("packaged resource was not read: %q", preload)
	}

	if err := os.Remove(filepath.Join(resources, desktopApplicationAnnotationPreloadFile)); err != nil {
		t.Fatal(err)
	}
	if got := desktopApplicationAnnotationPreload("darwin", resources, server); got != "" {
		t.Fatalf("a missing controller produced a preload: %q", got)
	}
}

func mustURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}
