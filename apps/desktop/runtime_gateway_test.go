//go:build darwin && desktop_runtime_package

package main

import (
	"bufio"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPackagedDesktopGateway(t *testing.T) {
	input := bufio.NewScanner(os.Stdin)
	var fixture struct {
		Origin     string           `json:"origin"`
		DataRoot   string           `json:"dataRoot"`
		Credential deviceCredential `json:"credential"`
	}
	if !input.Scan() || json.Unmarshal(input.Bytes(), &fixture) != nil {
		t.Fatal("expected a disposable gateway fixture on stdin")
	}
	origin, err := url.Parse(fixture.Origin)
	if err != nil || origin.Scheme != "http" || origin.Hostname() != "127.0.0.1" ||
		origin.Port() == "" || origin.User != nil || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" {
		t.Fatal("gateway fixture must use a local HTTP listener")
	}
	runtimeRoot := os.Getenv("LINKSENSE_DESKTOP_RUNTIME_DIST")
	if !filepath.IsAbs(runtimeRoot) || !filepath.IsAbs(fixture.DataRoot) || !fixture.Credential.valid() {
		t.Fatal("invalid packaged runtime test fixture")
	}
	runtime := superviseRuntime(fixture.DataRoot, runtimeRoot, origin.String())
	t.Cleanup(runtime.close)
	deadline := time.Now().Add(30 * time.Second)
	for !runtime.ready.Load() && time.Now().Before(deadline) {
		select {
		case <-runtime.done:
			t.Fatal("packaged runtime stopped before readiness")
		case <-time.After(50 * time.Millisecond):
		}
	}
	if !runtime.ready.Load() {
		t.Fatal("packaged runtime readiness timed out")
	}
	device := newFixtureDeviceConnection(t, origin, fixture.Credential)
	device.runtime = runtime
	go device.run()
	t.Cleanup(func() {
		device.cancel()
		waitDeviceDone(t, device)
	})
	stop := make(chan struct{})
	go func() {
		input.Scan()
		close(stop)
	}()
	select {
	case <-stop:
	case <-device.done:
		t.Fatalf("device bridge stopped: %s", device.Status().ErrorCode)
	case <-runtime.done:
		t.Fatal("packaged runtime stopped")
	case <-time.After(145 * time.Second):
		t.Fatal("gateway fixture did not close")
	}
}
