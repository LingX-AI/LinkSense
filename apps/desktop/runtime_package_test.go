//go:build desktop_runtime_package

package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPackagedRuntimeSupervisor(t *testing.T) {
	runtimeRoot := os.Getenv("LINKSENSE_DESKTOP_RUNTIME_DIST")
	if !filepath.IsAbs(runtimeRoot) {
		t.Fatal("LINKSENSE_DESKTOP_RUNTIME_DIST must select a packaged runtime")
	}
	runtime := superviseRuntime(filepath.Join(t.TempDir(), "local-runtime"), runtimeRoot)
	t.Cleanup(runtime.close)
	deadline := time.Now().Add(25 * time.Second)
	for !runtime.ready.Load() && time.Now().Before(deadline) {
		select {
		case <-runtime.done:
			t.Fatal("packaged runtime did not start")
		case <-time.After(50 * time.Millisecond):
		}
	}
	if !runtime.ready.Load() {
		t.Fatal("packaged runtime readiness timed out")
	}
	select {
	case <-runtime.done:
		t.Fatal("packaged runtime stopped after readiness")
	case <-time.After(runtimeHealthTimeout + time.Second):
		if !runtime.ready.Load() {
			t.Fatal("packaged runtime did not remain healthy through a heartbeat timeout window")
		}
	}
	runtime.close()
	if runtime.ready.Load() {
		t.Fatal("runtime remained ready after quitting")
	}
}
