package main

import (
	"net/url"
	"strings"
)

const (
	desktopPairingDeepLinkPrefix = "linksense-desktop://pair?server="
	desktopPairingSettingsPath   = "/settings/general#desktop-devices-heading"
	maxPairingDeepLinkBytes      = 1024
)

func pairingDeepLinkOrigin(raw string) *url.URL {
	if len(raw) > maxPairingDeepLinkBytes {
		return nil
	}
	// There is exactly one encoded value. Do not ignore an extra parameter
	// (especially the legacy code) or accept it as part of the outer URL.
	encoded, ok := strings.CutPrefix(raw, desktopPairingDeepLinkPrefix)
	if !ok || strings.ContainsAny(encoded, "&#;:/[]") {
		return nil
	}
	decoded, err := url.QueryUnescape(encoded)
	if err != nil || decoded != strings.TrimSpace(decoded) {
		return nil
	}
	origin, err := parseServerURL(decoded)
	if err != nil || origin.Hostname() == "" || strings.HasSuffix(origin.Host, ":") {
		return nil
	}
	return origin
}

func pairingDeepLinkMatchesServer(origin, server *url.URL) bool {
	return origin != nil && server != nil &&
		origin.Scheme == server.Scheme &&
		strings.EqualFold(origin.Hostname(), server.Hostname()) &&
		effectivePort(origin) == effectivePort(server)
}
