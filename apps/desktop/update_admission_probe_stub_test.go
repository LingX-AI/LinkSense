//go:build !desktop_update_admission

package main

import "testing"

// probeUpdateAdmissionDuringTurn is empty unless the admission whitebox build
// tag is set, so the packaged device-turn smoke is unchanged.
func probeUpdateAdmissionDuringTurn(*testing.T) {}
