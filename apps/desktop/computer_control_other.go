//go:build !darwin

package main

// The M1b product host is macOS-only. Other platforms keep no computer
// service, so the binding reports unavailable and no device capability is
// negotiated. This preserves the existing no-Windows-rollout behavior.

func newDesktopComputerControl(*Desktop) computerControlService {
	return nil
}

func desktopComputerShortcutEligible(*Desktop) bool {
	return false
}
