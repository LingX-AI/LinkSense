package main

import (
	"errors"
	"net/url"
	"os"
	"strings"
)

// Set by the release build; installed apps never select a server at runtime.
var desktopServerURL string

func configuredServerURL(development bool) (*url.URL, error) {
	raw := desktopServerURL
	if raw == "" && development {
		raw = os.Getenv("LINKSENSE_DESKTOP_DEV_SERVER_URL")
	}
	return parseServerURL(raw)
}

func parseServerURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" ||
		(u.Path != "" && u.Path != "/") || u.Opaque != "" || strings.ContainsAny(raw, "?#\r\n\x00") {
		return nil, errors.New("DESKTOP_SERVER_URL_INVALID")
	}
	// Self-hosted deployments commonly run on an intranet without TLS; the
	// signed desktop build trusts the origin it was packaged with, not the
	// transport. HTTPS is still recommended where it is available.
	if u.Scheme != "https" && u.Scheme != "http" {
		return nil, errors.New("DESKTOP_SERVER_URL_INVALID")
	}
	u.Host = strings.ToLower(u.Host)
	u.Path, u.RawPath = "", ""
	return u, nil
}
