package main

import (
	"context"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"
)

type permissionCountingEngine struct {
	fakeDesktopEngine
	checks atomic.Int32
}

func (e *permissionCountingEngine) Permissions(context.Context) permissionState {
	e.checks.Add(1)
	return permissionState{"granted", "granted"}
}

func TestPermissionRefreshSchedulerSkipsActiveCommandsAndStopsOnShutdown(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		engine := &permissionCountingEngine{}
		app := newDesktopApp(false, "Test computer")
		app.bridge = &desktopBridge{engine: engine}
		app.startPermissionRefresh()
		app.startPermissionRefresh()
		time.Sleep(permissionRefreshInterval)
		synctest.Wait()
		if engine.checks.Load() != 1 {
			t.Fatal("permission refresh did not run exactly once")
		}
		app.bridge.mu.Lock()
		app.bridge.activeID = "command"
		app.bridge.mu.Unlock()
		time.Sleep(permissionRefreshInterval)
		synctest.Wait()
		if engine.checks.Load() != 1 {
			t.Fatal("permission refresh overlapped an active desktop command")
		}
		app.bridge.mu.Lock()
		app.bridge.activeID = ""
		app.bridge.mu.Unlock()
		time.Sleep(permissionRefreshInterval)
		synctest.Wait()
		if engine.checks.Load() != 2 {
			t.Fatal("permission refresh did not resume after the command")
		}
		app.stopPermissionRefresh()
		time.Sleep(permissionRefreshInterval)
		synctest.Wait()
		if engine.checks.Load() != 2 {
			t.Fatal("permission refresh continued after shutdown")
		}
	})
}

func TestAppBundlePathRequiresPackagedResources(t *testing.T) {
	root := t.TempDir()
	bundle := filepath.Join(root, "LinkSense helper.app")
	resources := filepath.Join(bundle, "Contents", "Resources")
	if err := os.MkdirAll(resources, 0o755); err != nil {
		t.Fatal(err)
	}
	if got, ok := appBundlePath(resources); !ok || got != bundle {
		t.Fatalf("packaged resources did not resolve the app bundle: %q %v", got, ok)
	}
	plain := filepath.Join(root, "plain", "Contents", "Resources")
	if err := os.MkdirAll(plain, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, ok := appBundlePath(plain); ok {
		t.Fatal("a non-app resources directory became a draggable app")
	}
}

func TestAutomaticPermissionRefreshUpdatesWithoutBlockingAndKeepsPairingErrors(t *testing.T) {
	engine := &fakeDesktopEngine{}
	app := newDesktopApp(false, "Test computer")
	app.message = "pairFailed"
	bridge := &desktopBridge{engine: engine, generation: 1}
	updated := make(chan struct{}, 1)
	bridge.onPermission = func(permissions permissionState) {
		app.applyPermissions(permissions)
		updated <- struct{}{}
	}
	app.bridge = bridge
	app.refreshPermissions()
	select {
	case <-updated:
	case <-time.After(time.Second):
		t.Fatal("automatic permission refresh did not update")
	}
	if app.permissions.Accessibility != "granted" || app.busy {
		t.Fatal("automatic refresh did not update permissions without blocking controls")
	}
	if app.message != "pairFailed" {
		t.Fatal("automatic permission refresh cleared an unrelated error")
	}
	app.message = "connectionFailed"
	app.applyBridgeStatus(bridge, bridgeStatus{
		Generation: 1, Connected: true, Control: "ready",
		Permissions: permissionState{"granted", "granted"},
	})
	if app.message != "" {
		t.Fatal("a restored connection kept its old error")
	}
}
