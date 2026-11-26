//go:build darwin

package main

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/egoist/mygo/plugins/permissionflow"
)

func grantedComputerPermission(t *testing.T) {
	t.Helper()
	system := fakeComputerPermission()
	system.check = func(permissionflow.Permission) (permissionflow.Status, error) {
		return permissionflow.Granted, nil
	}
	stubComputerPermission(t, system)
}

func cloudComputerFixture(t *testing.T) (*cloudComputer, *controlTestExecutor) {
	t.Helper()
	grantedComputerPermission(t)
	executor := &controlTestExecutor{}
	platform := &controlTestPlatform{
		eligible: true,
		pick: func(context.Context, *Desktop) (computerSelectedTarget, error) {
			return computerSelectedTarget{
				BundleID: "com.example.app", WindowID: "window-1", PID: 42,
				ProcessInstance: "instance-1",
			}, nil
		},
		executor: func(_ context.Context, _ *Desktop, _ computerSelectedTarget, selection m1bComputerSelection) (computerProductExecutor, error) {
			executor.mu.Lock()
			executor.binding = selection
			executor.mu.Unlock()
			return executor, nil
		},
	}
	return &cloudComputer{
		desktop: &Desktop{}, platform: platform,
		gate: &computerExecutorGate{}, state: computerControlStateIdle,
	}, executor
}

func cloudComputerJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestCloudComputerSelectionObservationActAndLifecycle(t *testing.T) {
	computer, executor := cloudComputerFixture(t)
	ctx := context.Background()
	owner := "10000000-0000-4000-8000-000000000001"
	device := "20000000-0000-4000-8000-000000000001"

	status, code := computer.handle(ctx, "status", owner, device, cloudComputerStatusOperation, cloudComputerJSON(t, map[string]any{}))
	statusData := status.(map[string]any)
	if code != "" || statusData["permissions"].(map[string]any)["accessibility"] != "granted" {
		t.Fatalf("status = %v %s", status, code)
	}
	selected, code := computer.handle(ctx, "select", owner, device, cloudComputerSelectOperation, cloudComputerJSON(t, map[string]any{}))
	if code != "" {
		t.Fatalf("select code = %s", code)
	}
	selectionID := selected.(map[string]any)["selection_id"].(string)
	if !validUUID(selectionID) {
		t.Fatalf("selection id = %q", selectionID)
	}

	observed, code := computer.handle(ctx, "observe", owner, device, cloudComputerObserveOperation,
		cloudComputerJSON(t, map[string]any{"selection_id": selectionID}))
	if code != "" {
		t.Fatalf("observe code = %s", code)
	}
	observation := observed.(m1bComputerObservation)
	if observation.ObservationID == "" {
		t.Fatalf("observation = %+v", observation)
	}
	if !computer.gate.open() {
		t.Fatal("gate input closed after select")
	}
	acted, code := computer.handle(ctx, "act", owner, device, cloudComputerActOperation,
		cloudComputerJSON(t, map[string]any{
			"selection_id": selectionID, "action": "click",
			"observation_id": controlObservation, "ref": "@obs123:e1",
		}))
	if code != "" || !acted.(m1bComputerActResult).OK {
		t.Fatalf("act = %+v %s", acted, code)
	}

	if _, code := computer.handle(ctx, "pause", owner, device, cloudComputerPauseOperation,
		cloudComputerJSON(t, map[string]any{"selection_id": selectionID})); code != "" {
		t.Fatalf("pause code = %s", code)
	}
	if _, code := computer.handle(ctx, "observe", owner, device, cloudComputerObserveOperation,
		cloudComputerJSON(t, map[string]any{"selection_id": selectionID})); code != "COMPUTER_ACCESS_DENIED" {
		t.Fatalf("paused observe code = %s", code)
	}
	if _, code := computer.handle(ctx, "resume", owner, device, cloudComputerResumeOperation,
		cloudComputerJSON(t, map[string]any{"selection_id": selectionID})); code != "" {
		t.Fatalf("resume code = %s", code)
	}
	if _, code := computer.handle(ctx, "stop", owner, device, cloudComputerStopOperation,
		cloudComputerJSON(t, map[string]any{"selection_id": selectionID})); code != "" {
		t.Fatalf("stop code = %s", code)
	}
	if !executor.closed {
		t.Fatal("executor was not closed by stop")
	}
	if _, code := computer.handle(ctx, "observe", owner, device, cloudComputerObserveOperation,
		cloudComputerJSON(t, map[string]any{"selection_id": selectionID})); code != "COMPUTER_TARGET_CHANGED" {
		t.Fatalf("stopped observe code = %s", code)
	}
}

func TestCloudComputerFailsClosedWithoutAccessibility(t *testing.T) {
	computer, _ := cloudComputerFixture(t)
	denied := fakeComputerPermission()
	denied.check = func(permissionflow.Permission) (permissionflow.Status, error) {
		return permissionflow.Denied, nil
	}
	stubComputerPermission(t, denied)
	if _, code := computer.handle(context.Background(), "select",
		"10000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000001",
		cloudComputerSelectOperation, cloudComputerJSON(t, map[string]any{})); code != "COMPUTER_ACCESS_DENIED" {
		t.Fatalf("select code = %s", code)
	}
}
