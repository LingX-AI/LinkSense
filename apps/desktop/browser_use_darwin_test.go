//go:build desktop_whitebox

package main

import "testing"

func TestNativeBrowserUseSettingsOpensSetupAndRefreshesConnection(t *testing.T) {
	verifyNativeBrowserUseSettings(t)
}
