//go:build desktop_runtime_package && desktop_update_admission

package main

import (
	"context"
	"errors"
	"testing"
	"time"
)

// probeUpdateAdmissionDuringTurn is called from the packaged device-turn
// fixture while a native Codex turn is waiting for its model response. The
// native gate must ask the packaged runner, which sees turns.isBusy() and
// refuses; taking the gate here would strand the active turn.
func probeUpdateAdmissionDuringTurn(t *testing.T) {
	t.Helper()
	runtime := updateAdmissionProbeRuntime.Load()
	if runtime == nil {
		t.Error("the admission probe ran before the supervisor was published")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	guard, err := runtime.acquireUpdateAdmission(ctx)
	if guard != nil {
		guard.release()
	}
	if !errors.Is(err, errUpdateAdmissionBusy) {
		t.Errorf("update admission during a real local turn returned %v, want DESKTOP_UPDATE_BUSY", err)
		return
	}
	t.Logf("update admission during a real local turn: %v", err)
}
