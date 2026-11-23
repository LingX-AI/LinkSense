package main

import (
	"net/url"
	"strings"
	"testing"
)

func TestPairingDeepLinkMatchesOnlyThePackagedOrigin(t *testing.T) {
	const link = "linksense-desktop://pair?server="
	for _, tc := range []struct {
		name   string
		server string
		raw    string
		want   bool
	}{
		{"same origin", "https://example.test", link + "https%3A%2F%2Fexample.test", true},
		{"case and default port", "https://example.test", link + "https%3a%2f%2fEXAMPLE.test%3a443%2f", true},
		{"packaged explicit default port", "https://example.test:443", link + "https%3A%2F%2Fexample.test", true},
		{"same nondefault port", "https://example.test:1443", link + "https%3A%2F%2Fexample.test%3A1443", true},
		{"loopback default port", "http://localhost", link + "http%3A%2F%2FLOCALHOST%3A80", true},
		{"matching IPv6 fixture", "http://[::1]:18173", link + url.QueryEscape("http://[::1]:18173"), true},
		{"different host", "https://example.test", link + "https%3A%2F%2Fother.example.test", false},
		{"different scheme", "https://localhost", link + "http%3A%2F%2Flocalhost%3A443", false},
		{"different port", "https://example.test:1443", link + "https%3A%2F%2Fexample.test", false},
		{"different loopback host", "http://localhost", link + "http%3A%2F%2F127.0.0.1", false},
		{"no packaged origin", "", link + "https%3A%2F%2Fexample.test", false},
		{"incorrect outer scheme", "https://example.test", "https://pair?server=https%3A%2F%2Fexample.test", false},
		{"outer credentials", "https://example.test", "linksense-desktop://someone@pair?server=https%3A%2F%2Fexample.test", false},
		{"outer port", "https://example.test", "linksense-desktop://pair:443?server=https%3A%2F%2Fexample.test", false},
		{"outer path", "https://example.test", "linksense-desktop://pair/?server=https%3A%2F%2Fexample.test", false},
		{"opaque URL", "https://example.test", "linksense-desktop:pair?server=https%3A%2F%2Fexample.test", false},
		{"outer fragment", "https://example.test", link + "https%3A%2F%2Fexample.test#", false},
		{"missing server", "https://example.test", "linksense-desktop://pair?", false},
		{"empty server", "https://example.test", link, false},
		{"two servers", "https://example.test", link + "https%3A%2F%2Fexample.test&server=https%3A%2F%2Fexample.test", false},
		{"legacy code", "https://example.test", link + "https%3A%2F%2Fexample.test&code=fixture", false},
		{"unrecognized field", "https://example.test", link + "https%3A%2F%2Fexample.test&extra=1", false},
		{"trailing separator", "https://example.test", link + "https%3A%2F%2Fexample.test&", false},
		{"unescaped origin", "https://example.test", link + "https://example.test", false},
		{"invalid escape", "https://example.test", link + "https%3A%2F%2Fexample.test%XY", false},
		{"nested delimiter", "https://example.test", link + "https%3A%2F%2Fexample.test%3F", false},
		{"nested fragment", "https://example.test", link + "https%3A%2F%2Fexample.test%23", false},
		{"nested path", "https://example.test", link + "https%3A%2F%2Fexample.test%2Fdesktop", false},
		{"nested credentials", "https://example.test", link + "https%3A%2F%2Fsomeone%3Afixture%40example.test", false},
		{"nested empty port", "https://example.test", link + "https%3A%2F%2Fexample.test%3A", false},
		{"nested padding", "https://example.test", link + "https%3A%2F%2Fexample.test%20", false},
		{"oversized input", "https://example.test", link + strings.Repeat("x", 1024), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var server *url.URL
			if tc.server != "" {
				var err error
				server, err = parseServerURL(tc.server)
				if err != nil {
					t.Fatal("invalid fixture origin")
				}
			}
			if got := pairingDeepLinkMatchesServer(pairingDeepLinkOrigin(tc.raw), server); got != tc.want {
				t.Errorf("pairing link accepted = %v, want %v", got, tc.want)
			}
			if server != nil && server.String() != tc.server {
				t.Fatal("link validation changed the packaged origin and credential key")
			}
		})
	}
}
