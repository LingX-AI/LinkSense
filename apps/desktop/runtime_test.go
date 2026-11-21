//go:build darwin || linux

package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"
)

// Reuse the test binary as a child fixture so these tests need no host Node.
func init() {
	if len(os.Args) != 2 {
		return
	}
	switch filepath.Base(os.Args[1]) {
	case "linksense-runtime-test-descendant":
		time.Sleep(time.Minute)
		os.Exit(1)
	case "desktop-supervised.js":
		scanner := bufio.NewScanner(os.Stdin)
		if !scanner.Scan() || !containsRuntimeStartupFrame(scanner.Bytes()) {
			os.Exit(1)
		}
		if _, err := os.Stat("hang"); err == nil {
			binary, err := os.Executable()
			if err != nil {
				os.Exit(1)
			}
			descendant := exec.Command(binary, "linksense-runtime-test-descendant")
			if err := descendant.Start(); err != nil {
				os.Exit(1)
			}
			if err := os.WriteFile("descendant", []byte(strconv.Itoa(descendant.Process.Pid)), 0o600); err != nil {
				_ = descendant.Process.Kill()
				os.Exit(1)
			}
		}
		if err := os.WriteFile("pid", []byte(strconv.Itoa(os.Getpid())), 0o600); err != nil {
			os.Exit(1)
		}
		fmt.Println(`{"type":"ready","version":1}`)
		controls := bufio.NewScanner(os.Stdin)
		controls.Buffer(make([]byte, 256), runtimeFrameLimit)
		for controls.Scan() {
			var message struct {
				Type      string `json:"type"`
				RequestID string `json:"request_id"`
			}
			if json.Unmarshal(controls.Bytes(), &message) != nil {
				os.Exit(1)
			}
			switch message.Type {
			case updateAcquireRequestType:
				if _, err := os.Stat("update-silent"); err == nil {
					continue
				}
				if _, err := os.Stat("update-delay"); err == nil {
					time.Sleep(150 * time.Millisecond)
				}
				result := map[string]any{"type": updateAcquireResultType, "request_id": message.RequestID, "ok": true}
				if _, err := os.Stat("update-busy"); err == nil {
					result["ok"] = false
					result["error_code"] = "DESKTOP_UPDATE_BUSY"
				}
				raw, _ := json.Marshal(result)
				fmt.Println(string(raw))
			case updateReleaseRequestType:
				_ = os.WriteFile("released", []byte(message.RequestID), 0o600)
			}
		}
		if _, err := os.Stat("hang"); err == nil {
			time.Sleep(time.Minute)
		}
		_ = os.WriteFile("exited", []byte("true"), 0o600)
		os.Exit(0)
	}
}

func containsRuntimeStartupFrame(line []byte) bool {
	return len(line) < 4096 && len(line) > 0 && line[0] == '{'
}

func runtimeFixture(t *testing.T) (data string, runtime string) {
	t.Helper()
	root := t.TempDir()
	data, runtime = filepath.Join(root, "data"), filepath.Join(root, "runtime")
	if err := os.Mkdir(filepath.Join(root, "data"), 0o700); err != nil {
		t.Fatal(err)
	}
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(runtime, "bin")
	if err := os.MkdirAll(bin, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(binary, filepath.Join(bin, "node")); err != nil {
		t.Fatal(err)
	}
	return data, runtime
}

func runtimeEventually(t *testing.T, reason string, check func() bool) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if check() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal(reason)
}

func runtimeFixturePID(t *testing.T, path string) int {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	pid, err := strconv.Atoi(string(data))
	if err != nil || pid <= 1 {
		t.Fatal("invalid fixture process ID")
	}
	return pid
}

func TestSupervisorRestartsAfterRuntimeCrashAndClosesItsPipeOnExit(t *testing.T) {
	data, runtime := runtimeFixture(t)
	supervisor := superviseRuntime(data, runtime, "")
	t.Cleanup(supervisor.close)
	runtimeEventually(t, "fixture did not become ready", supervisor.ready.Load)
	oldPID := runtimeFixturePID(t, filepath.Join(data, "pid"))
	if err := syscall.Kill(oldPID, syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	runtimeEventually(t, "runtime did not restart after crash", func() bool {
		return supervisor.ready.Load() && runtimeFixturePID(t, filepath.Join(data, "pid")) != oldPID
	})
	supervisor.close()
	if supervisor.ready.Load() {
		t.Fatal("runtime remained ready after closing")
	}
	if _, err := os.Stat(filepath.Join(data, "exited")); err != nil {
		t.Fatal("runtime did not observe its supervisor pipe closing")
	}
}

func TestSupervisorKillsItsProcessGroupWhenRuntimeIgnoresShutdown(t *testing.T) {
	data, runtime := runtimeFixture(t)
	if err := os.WriteFile(filepath.Join(data, "hang"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	supervisor := superviseRuntime(data, runtime, "")
	t.Cleanup(supervisor.close)
	runtimeEventually(t, "fixture did not become ready", supervisor.ready.Load)
	descendant := runtimeFixturePID(t, filepath.Join(data, "descendant"))
	supervisor.close()
	runtimeEventually(t, "the desktop runtime left a live descendant", func() bool {
		return syscall.Kill(descendant, 0) == syscall.ESRCH
	})
}

func TestSupervisorRestartsAfterTheRuntimeStopsSendingHeartbeats(t *testing.T) {
	data, runtime := runtimeFixture(t)
	supervisor := superviseRuntime(data, runtime, "")
	t.Cleanup(supervisor.close)
	runtimeEventually(t, "fixture did not become ready", supervisor.ready.Load)
	oldPID := runtimeFixturePID(t, filepath.Join(data, "pid"))
	deadline := time.Now().Add(runtimeHealthTimeout + runtimeExitGrace + 5*time.Second)
	for time.Now().Before(deadline) {
		if supervisor.ready.Load() && runtimeFixturePID(t, filepath.Join(data, "pid")) != oldPID {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("the runtime was not restarted after it stopped sending heartbeats")
}

func TestRuntimeDirectoryDoesNotFollowLinksAndEnvironmentOmitsSecrets(t *testing.T) {
	root := t.TempDir()
	link := filepath.Join(root, "local-runtime")
	if err := os.Symlink(t.TempDir(), link); err != nil {
		t.Fatal(err)
	}
	if err := secureRuntimeDirectory(link); err == nil {
		t.Fatal("the runtime accepted a redirected data directory")
	}
	env := desktopRuntimeEnvironment([]string{
		"Path=/fixture/bin", "SystemRoot=/fixture/system", "NODE_OPTIONS=--require bad",
		"OPENAI_API_KEY=fixture", "LINKSENSE_RUNNER_SHARED_SECRET=fixture",
	})
	if len(env) != 3 || env[0] != "NODE_ENV=production" || env[1] != "Path=/fixture/bin" || env[2] != "SystemRoot=/fixture/system" {
		t.Fatal("the runtime environment did not use the fixed allowlist")
	}
}

const (
	updateOwnerFixture = "10000000-0000-4000-8000-000000000001"
	updateLinkFixture  = "70000000-0000-4000-8000-000000000001"
	updateLinkReplaced = "70000000-0000-4000-8000-000000000002"
	updateRequestOne   = "80000000-0000-4000-8000-000000000001"
	updateRequestTwo   = "80000000-0000-4000-8000-000000000002"
)

func waitUpdateRelease(t *testing.T, path string) string {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		raw, err := os.ReadFile(path)
		if err == nil && validUUID(string(raw)) {
			return string(raw)
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("the runtime did not receive the request-id-bound release")
	return ""
}

func TestUpdateAdmissionSurvivesRuntimeDeathAndReleaseRestarts(t *testing.T) {
	data, runtimeRoot := runtimeFixture(t)
	supervisor := superviseRuntime(data, runtimeRoot, "")
	t.Cleanup(supervisor.close)
	runtimeEventually(t, "fixture did not become ready", supervisor.ready.Load)
	guard, err := supervisor.acquireUpdateAdmission(context.Background())
	if err != nil || guard == nil {
		t.Fatalf("update admission failed: %v", err)
	}
	t.Cleanup(guard.release)
	if _, err := supervisor.acquireUpdateAdmission(context.Background()); !errors.Is(err, errUpdateAdmissionBusy) {
		t.Fatal("the acknowledged update admission was not held")
	}
	// A device reconnect replaces the socket link, not the gate.
	first, err := supervisor.attach(updateLinkFixture, updateOwnerFixture, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	first.close()
	second, err := supervisor.attach(updateLinkReplaced, updateOwnerFixture, nil, nil, nil)
	if err != nil {
		t.Fatal("update admission blocked an ordinary link reconnect")
	}
	second.close()
	oldPID := runtimeFixturePID(t, filepath.Join(data, "pid"))
	if err := syscall.Kill(oldPID, syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	runtimeEventually(t, "runtime did not stop after the crash", func() bool { return !supervisor.ready.Load() })
	// The supervisor retries after one second. A held guard must suppress that
	// replacement generation, including its execution link.
	time.Sleep(1500 * time.Millisecond)
	if supervisor.ready.Load() {
		t.Fatal("a replacement runtime became ready while the update guard was held")
	}
	if pid := runtimeFixturePID(t, filepath.Join(data, "pid")); pid != oldPID {
		t.Fatal("a replacement runtime started while the update guard was held")
	}
	if _, err := supervisor.attach(updateLinkReplaced, updateOwnerFixture, nil, nil, nil); err == nil {
		t.Fatal("a replacement runtime generation accepted a link during the update hold")
	}
	guard.release()
	runtimeEventually(t, "runtime did not restart after the release", supervisor.ready.Load)
}

func TestUpdateAdmissionReportsBusyAndUnavailable(t *testing.T) {
	data, runtimeRoot := runtimeFixture(t)
	supervisor := superviseRuntime(data, runtimeRoot, "")
	t.Cleanup(supervisor.close)
	runtimeEventually(t, "fixture did not become ready", supervisor.ready.Load)

	busy := filepath.Join(data, "update-busy")
	if err := os.WriteFile(busy, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := supervisor.acquireUpdateAdmission(context.Background()); !errors.Is(err, errUpdateAdmissionBusy) {
		t.Fatalf("a busy runner admitted an update: %v", err)
	}
	if err := os.Remove(busy); err != nil {
		t.Fatal(err)
	}
	guard, err := supervisor.acquireUpdateAdmission(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := supervisor.acquireUpdateAdmission(context.Background()); !errors.Is(err, errUpdateAdmissionBusy) {
		t.Fatalf("a held update admitted a second update: %v", err)
	}
	if _, err := (&runtimeSupervisor{}).acquireUpdateAdmission(context.Background()); !errors.Is(err, errUpdateAdmissionUnavailable) {
		t.Fatalf("a missing runtime reported %v instead of unavailable", err)
	}
	guard.release()
	if !supervisor.waitForUpdateAdmission(context.Background()) {
		t.Fatal("release did not reopen update admission")
	}
}

func TestUpdateAdmissionCancellationReleasesAndLateAckIsIgnored(t *testing.T) {
	data, runtimeRoot := runtimeFixture(t)
	if err := os.WriteFile(filepath.Join(data, "update-delay"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	supervisor := superviseRuntime(data, runtimeRoot, "")
	t.Cleanup(supervisor.close)
	runtimeEventually(t, "fixture did not become ready", supervisor.ready.Load)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := supervisor.acquireUpdateAdmission(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expired update admission returned %v", err)
	}
	// The runner acknowledges after the deadline and then consumes the release.
	// That late acknowledgement must not leave a gate or resolve a later hold.
	if released := waitUpdateRelease(t, filepath.Join(data, "released")); released == "" {
		t.Fatal("release frame was empty")
	}
	if err := os.Remove(filepath.Join(data, "update-delay")); err != nil {
		t.Fatal(err)
	}
	guard, err := supervisor.acquireUpdateAdmission(context.Background())
	if err != nil {
		t.Fatalf("late acknowledgement disturbed the next admission: %v", err)
	}
	guard.release()
}

func TestUpdateAdmissionCanceledBeforeSendWritesNoFrame(t *testing.T) {
	t.Run("pre-canceled", func(t *testing.T) {
		pipe, frames := pipeFixture(t)
		supervisor := &runtimeSupervisor{}
		supervisor.ready.Store(true)
		supervisor.pipe.Store(pipe)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if _, err := supervisor.acquireUpdateAdmission(ctx); !errors.Is(err, context.Canceled) {
			t.Fatalf("pre-canceled admission returned %v", err)
		}
		assertNoRuntimeFrame(t, frames)
		assertUpdateAdmissionOpen(t, supervisor)
	})
	t.Run("canceled while queued for the writer", func(t *testing.T) {
		pipe, frames := pipeFixture(t)
		supervisor := &runtimeSupervisor{}
		supervisor.ready.Store(true)
		supervisor.pipe.Store(pipe)
		ctx, cancel := context.WithCancel(context.Background())
		pipe.mu.Lock()
		result := make(chan error, 1)
		go func() {
			_, err := supervisor.acquireUpdateAdmission(ctx)
			result <- err
		}()
		runtimeEventually(t, "update reservation did not install", func() bool {
			supervisor.update.mu.Lock()
			defer supervisor.update.mu.Unlock()
			return supervisor.update.reservation != nil
		})
		cancel()
		pipe.mu.Unlock()
		select {
		case err := <-result:
			if !errors.Is(err, context.Canceled) {
				t.Fatalf("queued canceled admission returned %v", err)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("queued canceled admission did not return")
		}
		assertNoRuntimeFrame(t, frames)
		assertUpdateAdmissionOpen(t, supervisor)
	})
	t.Run("ended pipe", func(t *testing.T) {
		pipe, frames := pipeFixture(t)
		supervisor := &runtimeSupervisor{}
		supervisor.ready.Store(true)
		supervisor.pipe.Store(pipe)
		close(pipe.done)
		if _, err := supervisor.acquireUpdateAdmission(context.Background()); !errors.Is(err, errUpdateAdmissionUnavailable) {
			t.Fatalf("ended pipe admission returned %v", err)
		}
		assertNoRuntimeFrame(t, frames)
		assertUpdateAdmissionOpen(t, supervisor)
	})
}

func assertNoRuntimeFrame(t *testing.T, frames <-chan string) {
	t.Helper()
	select {
	case frame, ok := <-frames:
		if ok {
			t.Fatalf("canceled update admission emitted %s", frame)
		}
	case <-time.After(200 * time.Millisecond):
	}
}

func assertUpdateAdmissionOpen(t *testing.T, supervisor *runtimeSupervisor) {
	t.Helper()
	supervisor.update.mu.Lock()
	defer supervisor.update.mu.Unlock()
	if supervisor.update.reservation != nil {
		t.Fatal("canceled update admission kept its reservation")
	}
}

func TestUpdateAdmissionResultsAreStrictAndStaleResultsIgnored(t *testing.T) {
	pipe := &runtimePipe{done: make(chan struct{})}
	reply := make(chan updateAdmissionResult, 1)
	pipe.update = &pendingUpdateRequest{requestID: updateRequestOne, reply: reply}
	stale := fmt.Sprintf(`{"type":"update.acquire.result","request_id":"%s","ok":true}`, updateRequestTwo)
	if !pipe.deliver(stale) {
		t.Fatal("a stale well-formed update result was treated as a protocol error")
	}
	if pipe.update == nil {
		t.Fatal("a stale update result cleared the pending admission")
	}
	for _, invalid := range []string{
		// ok is required and must be a boolean, matching the shared schema.
		fmt.Sprintf(`{"type":"update.acquire.result","request_id":"%s","error_code":"DESKTOP_UPDATE_BUSY"}`, updateRequestOne),
		fmt.Sprintf(`{"type":"update.acquire.result","request_id":"%s","ok":null,"error_code":"DESKTOP_UPDATE_BUSY"}`, updateRequestOne),
		fmt.Sprintf(`{"type":"update.acquire.result","request_id":"%s","ok":"true"}`, updateRequestOne),
		// Success has no error_code member at all; an empty or null value is
		// still a different wire shape.
		fmt.Sprintf(`{"type":"update.acquire.result","request_id":"%s","ok":true,"error_code":""}`, updateRequestOne),
		fmt.Sprintf(`{"type":"update.acquire.result","request_id":"%s","ok":true,"error_code":null}`, updateRequestOne),
		fmt.Sprintf(`{"type":"update.acquire.result","request_id":"%s","ok":true,"error_code":"DESKTOP_UPDATE_BUSY"}`, updateRequestOne),
		// Rejection requires the exact enum string.
		fmt.Sprintf(`{"type":"update.acquire.result","request_id":"%s","ok":false}`, updateRequestOne),
		fmt.Sprintf(`{"type":"update.acquire.result","request_id":"%s","ok":false,"error_code":null}`, updateRequestOne),
		fmt.Sprintf(`{"type":"update.acquire.result","request_id":"%s","ok":false,"error_code":"FORBIDDEN"}`, updateRequestOne),
		fmt.Sprintf(`{"type":"update.acquire.result","request_id":"%s","ok":true,"path":"/Applications"}`, updateRequestOne),
		fmt.Sprintf(`{"type":"update.acquire.result","request_id":"%s","ok":true}{}`, updateRequestOne),
	} {
		if pipe.deliver(invalid) {
			t.Fatalf("accepted an invalid update admission result: %s", invalid)
		}
	}
	valid := fmt.Sprintf(`{"type":"update.acquire.result","request_id":"%s","ok":true}`, updateRequestOne)
	if !pipe.deliver(valid) {
		t.Fatal("a matching update result was rejected")
	}
	select {
	case result := <-reply:
		if result != (updateAdmissionResult{Type: updateAcquireResultType, RequestID: updateRequestOne, OK: true}) {
			t.Fatalf("update result did not round-trip: %#v", result)
		}
	default:
		t.Fatal("update result did not reach its pending admission")
	}
	if pipe.update != nil {
		t.Fatal("a delivered update admission stayed pending")
	}
	if !pipe.deliver(valid) {
		t.Fatal("a late duplicate update result was treated as a protocol error")
	}
	// A rejected acknowledgement is delivered as a typed result, not raw JSON.
	pipe.update = &pendingUpdateRequest{requestID: updateRequestOne, reply: reply}
	busy := fmt.Sprintf(`{"type":"update.acquire.result","request_id":"%s","ok":false,"error_code":"DESKTOP_UPDATE_BUSY"}`, updateRequestOne)
	if !pipe.deliver(busy) {
		t.Fatal("a valid rejected update result was rejected")
	}
	select {
	case result := <-reply:
		if result.OK || result.ErrorCode != "DESKTOP_UPDATE_BUSY" {
			t.Fatalf("rejected update result did not round-trip: %#v", result)
		}
	default:
		t.Fatal("rejected update result did not reach its pending admission")
	}
}
