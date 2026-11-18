//go:build darwin || linux

package main

import (
	"bufio"
	"fmt"
	"io"
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
		_, _ = io.Copy(io.Discard, os.Stdin)
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
