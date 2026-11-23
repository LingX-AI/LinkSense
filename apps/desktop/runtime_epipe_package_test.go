//go:build darwin && desktop_runtime_package

package main

import (
	"bufio"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// This regression proves that losing the private supervisor stdout pipe after
// the Go owner departs must not strand a same-group child. A helper owns the
// real compiled supervisor through production startRuntimeProcess (Setpgid) and
// the owner marker. The outer test keeps the stdin writer and stdout reader; a
// test-only preload creates one inert child in the supervisor's group.
const (
	epipeOwnerEnv    = "LINKSENSE_TEST_DESKTOP_EPIPE_OWNER"
	epipeRuntimeEnv  = "LINKSENSE_TEST_DESKTOP_EPIPE_RUNTIME_ROOT"
	epipeDataEnv     = "LINKSENSE_TEST_DESKTOP_EPIPE_DATA_ROOT"
	epipeFixtureEnv  = "LINKSENSE_DESKTOP_EPIPE_FIXTURE"
	epipePreloadName = "epipe-preload.cjs"
	epipeSupervisor  = "supervisor.pid"
	epipeChild       = "child.pid"
	epipeWriteMarker = "stdout-epipe"
	epipeInertSleep  = "120"

	epipeOwnerExitWait = 10 * time.Second
	epipeReparentWait  = 10 * time.Second
	epipeReclaimWait   = 25 * time.Second
)

// The preload creates the same-group child, publishes its PID, and passively
// observes EPIPE through errorMonitor without absorbing the real event.
const epipePreload = `"use strict"
const fs = require("node:fs")
const path = require("node:path")
const { spawn } = require("node:child_process")
const { errorMonitor } = require("node:events")
const root = process.env.LINKSENSE_DESKTOP_EPIPE_FIXTURE
if (root && path.isAbsolute(root)) {
  const child = spawn("/bin/sleep", ["120"], { stdio: "ignore" })
  fs.writeFileSync(path.join(root, "child.pid"), String(child.pid), { mode: 0o600 })
  child.unref()
  process.stdout.on(errorMonitor, error => {
    if (error?.code === "EPIPE") {
      try { fs.writeFileSync(path.join(root, "stdout-epipe"), "1", { mode: 0o600 }) } catch {}
    }
  })
}
`

// TestRuntimeEpipeOwnerHelper is only used by TestPackagedDesktopEpipeReclaim.
func TestRuntimeEpipeOwnerHelper(t *testing.T) {
	if os.Getenv(epipeOwnerEnv) != "1" {
		t.Skip("owner helper is only used by TestPackagedDesktopEpipeReclaim")
	}
	if err := runEpipeOwnerHelper(); err != nil {
		t.Fatal(err)
	}
}

func runEpipeOwnerHelper() error {
	runtimeRoot := os.Getenv(epipeRuntimeEnv)
	dataRoot := os.Getenv(epipeDataEnv)
	fixture := os.Getenv(epipeFixtureEnv)
	if !filepath.IsAbs(runtimeRoot) || !filepath.IsAbs(dataRoot) || !filepath.IsAbs(fixture) {
		return errors.New("incomplete EPIPE owner fixture")
	}
	stdin := os.NewFile(3, "epipe-supervisor-stdin")
	stdout := os.NewFile(4, "epipe-supervisor-stdout")
	if stdin == nil || stdout == nil {
		return errors.New("EPIPE fixture descriptors are unavailable")
	}
	environment := desktopLauncherOwnerEnvironment(desktopRuntimeEnvironment(os.Environ()), os.Getpid())
	environment = append(environment, epipeFixtureEnv+"="+fixture)
	command := exec.Command(
		filepath.Join(runtimeRoot, "bin", "node"), "--require",
		filepath.Join(fixture, epipePreloadName),
		filepath.Join(runtimeRoot, "runner", "dist", "desktop-supervised.js"),
	)
	command.Dir = dataRoot
	command.Env = environment
	command.Stdin = stdin
	command.Stdout = stdout
	stop, err := startRuntimeProcess(command)
	if err != nil {
		return fmt.Errorf("start supervisor: %w", err)
	}
	// If the outer test fails before recording the verified supervisor and
	// child, closing the teardown pipe lets this production stop() handle
	// reclaim what the helper started.
	defer stop()
	_ = stdin.Close()
	_ = stdout.Close()
	if err := os.WriteFile(filepath.Join(fixture, epipeSupervisor),
		[]byte(strconv.Itoa(command.Process.Pid)), 0o600); err != nil {
		return err
	}
	_, err = io.Copy(io.Discard, os.Stdin)
	return err
}

func epipeProcess(path string, pid int, timeout time.Duration) (fixtureProcess, error) {
	deadline := time.Now().Add(timeout)
	for {
		if path != "" {
			if data, err := os.ReadFile(path); err == nil {
				if parsed, parseErr := strconv.Atoi(strings.TrimSpace(string(data))); parseErr == nil && parsed > 1 {
					pid = parsed
				}
			}
		}
		if pid > 1 {
			if table, err := fixtureProcesses(); err == nil {
				if entry, ok := table[pid]; ok && !entry.Zombie {
					return entry, nil
				}
			}
		}
		if time.Now().After(deadline) {
			return fixtureProcess{}, errors.New("fixture process did not appear")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// TestPackagedDesktopEpipeReclaim is opt-in via LINKSENSE_DESKTOP_RUNTIME_DIST.
// It fails if the same-group child survives stdout loss, if the supervisor
// remains live beyond the existing fail-safe window, if the fixture-owned
// distinct group is disturbed, or if the failing write was not exercised.
func TestPackagedDesktopEpipeReclaim(t *testing.T) {
	runtimeRoot := os.Getenv("LINKSENSE_DESKTOP_RUNTIME_DIST")
	if !filepath.IsAbs(runtimeRoot) {
		t.Fatal("LINKSENSE_DESKTOP_RUNTIME_DIST must select a packaged runtime")
	}
	for _, relative := range []string{"bin/node", "bin/codex", "runner/dist/desktop-supervised.js"} {
		if _, err := os.Stat(filepath.Join(runtimeRoot, filepath.FromSlash(relative))); err != nil {
			t.Fatalf("packaged runtime is missing %s: %v", relative, err)
		}
	}
	fixture := t.TempDir()
	dataRoot := filepath.Join(fixture, "data")
	if err := os.Mkdir(dataRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(fixture, epipePreloadName), []byte(epipePreload), 0o600); err != nil {
		t.Fatal(err)
	}

	// The fixture owns the independent group directly, so teardown reaps it
	// through its Go-owned Process handle instead of the signal fallback.
	distinct := exec.Command("/bin/sleep", epipeInertSleep)
	distinct.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := distinct.Start(); err != nil {
		t.Fatal(err)
	}
	distinctExit := newFixtureHostExit(distinct)
	t.Cleanup(func() {
		if !distinctExit.exited() {
			_ = distinct.Process.Kill()
		}
		if _, exited := distinctExit.wait(epipeOwnerExitWait); !exited {
			t.Errorf("could not reap the distinct-group child")
		}
	})
	distinctEntry, err := epipeProcess("", distinct.Process.Pid, epipeOwnerExitWait)
	if err != nil {
		t.Fatalf("distinct-group child: %v", err)
	}

	var recorded []fixtureProcess
	var stdinRead, stdinWrite, stdoutRead, stdoutWrite, teardownRead, teardownWrite *os.File
	var helper *exec.Cmd
	var helperExit *fixtureHostExit
	t.Cleanup(func() {
		if teardownWrite != nil {
			_ = teardownWrite.Close()
		}
		if helper != nil && helperExit != nil {
			if _, exited := helperExit.wait(epipeOwnerExitWait); !exited {
				_ = helper.Process.Kill()
				if _, reaped := helperExit.wait(epipeOwnerExitWait); !reaped {
					t.Errorf("could not reap the EPIPE owner helper after kill")
				}
			}
		}
		for _, file := range []**os.File{&stdinWrite, &stdoutRead, &stdinRead, &stdoutWrite, &teardownRead} {
			if *file != nil {
				_ = (*file).Close()
			}
		}
		fixtureCleanup(t, recorded)
	})
	if stdinRead, stdinWrite, err = os.Pipe(); err != nil {
		t.Fatal(err)
	}
	if stdoutRead, stdoutWrite, err = os.Pipe(); err != nil {
		t.Fatal(err)
	}
	if teardownRead, teardownWrite, err = os.Pipe(); err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	helper = exec.Command(executable, "-test.run=^TestRuntimeEpipeOwnerHelper$", "-test.timeout=60s")
	helper.Env = append(os.Environ(), epipeOwnerEnv+"=1", epipeRuntimeEnv+"="+runtimeRoot,
		epipeDataEnv+"="+dataRoot, epipeFixtureEnv+"="+fixture)
	helper.Stdin = teardownRead
	helper.Stdout, helper.Stderr = io.Discard, io.Discard
	helper.ExtraFiles = []*os.File{stdinRead, stdoutWrite}
	if err := helper.Start(); err != nil {
		t.Fatalf("could not start EPIPE owner helper: %v", err)
	}
	helperPID := helper.Process.Pid
	helperExit = newFixtureHostExit(helper)
	_ = stdinRead.Close()
	_ = stdoutWrite.Close()
	_ = teardownRead.Close()
	stdinRead, stdoutWrite, teardownRead = nil, nil, nil

	startup, err := json.Marshal(map[string]string{
		"data_root": dataRoot, "runtime_root": runtimeRoot,
		"control_token": hex.EncodeToString(randomLoginBytes()),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := stdinWrite.Write(append(startup, '\n')); err != nil {
		t.Fatalf("could not send the startup frame: %v", err)
	}
	if err := stdoutRead.SetReadDeadline(time.Now().Add(runtimeStartupTimeout)); err != nil {
		t.Fatalf("could not bound the supervisor startup read: %v", err)
	}
	frame, err := bufio.NewReader(stdoutRead).ReadString('\n')
	if err != nil || strings.TrimSuffix(frame, "\n") != `{"type":"ready","version":1}` {
		t.Fatalf("supervisor did not become ready: %v", err)
	}
	supervisorEntry, err := epipeProcess(filepath.Join(fixture, epipeSupervisor), 0, epipeOwnerExitWait)
	if err != nil {
		t.Fatalf("supervisor: %v", err)
	}
	childEntry, err := epipeProcess(filepath.Join(fixture, epipeChild), 0, epipeOwnerExitWait)
	if err != nil {
		t.Fatalf("held child: %v", err)
	}
	supervisorPID, childPID := supervisorEntry.PID, childEntry.PID
	table, err := fixtureProcesses()
	if err != nil {
		t.Fatalf("could not observe the fixture process table: %v", err)
	}
	helperEntry, ok := table[helperPID]
	if !ok || !fixtureOwnedHost(table, helperEntry) || helperEntry.PPID != os.Getpid() || helperExit.exited() {
		t.Fatal("owner helper was not live before the force signal")
	}
	supervisorCurrent, supervisorOK := table[supervisorPID]
	childCurrent, childOK := table[childPID]
	distinctCurrent, distinctOK := table[distinctEntry.PID]
	if !supervisorOK || supervisorCurrent.Start != supervisorEntry.Start ||
		supervisorCurrent.PPID != helperPID || supervisorCurrent.PGID != supervisorPID ||
		supervisorCurrent.PGID == helperEntry.PGID || supervisorCurrent.Zombie {
		t.Fatal("supervisor is not a live own-group leader directly owned by the helper")
	}
	if !childOK || childCurrent.Start != childEntry.Start ||
		childCurrent.PPID != supervisorPID || childCurrent.PGID != supervisorPID || childCurrent.Zombie {
		t.Fatal("held child is not in the supervisor's own process group")
	}
	// The helper and distinct group leader are reaped through their Go-owned
	// Process handles. Only the supervisor and held child need the signal
	// fallback, and only after this snapshot certifies their ancestry and start
	// identity.
	recorded = append(recorded, supervisorEntry, childEntry)
	if !distinctOK || distinctCurrent.Start != distinctEntry.Start ||
		distinctCurrent.PPID != os.Getpid() || distinctCurrent.PGID != distinctEntry.PID ||
		distinctCurrent.PGID == supervisorPID || distinctCurrent.PGID == helperEntry.PGID ||
		distinctCurrent.Zombie {
		t.Fatal("distinct-group child is not its own separate group leader")
	}
	if err := helper.Process.Kill(); err != nil {
		t.Fatalf("could not force-kill the verified fixture owner: %v", err)
	}
	waitErr, exited := helperExit.wait(epipeOwnerExitWait)
	if !exited {
		t.Fatal("the owner helper did not exit after SIGKILL")
	}
	var exitErr *exec.ExitError
	if !errors.As(waitErr, &exitErr) {
		t.Fatalf("owner helper wait result: %v", waitErr)
	}
	status, ok := exitErr.Sys().(syscall.WaitStatus)
	if !ok || !status.Signaled() || status.Signal() != syscall.SIGKILL {
		t.Fatalf("the owner helper did not terminate from SIGKILL: %v", waitErr)
	}

	reparentDeadline := time.Now().Add(epipeReparentWait)
	for {
		table, err = fixtureProcesses()
		if err != nil {
			t.Fatalf("could not observe reparenting: %v", err)
		}
		current, ok := table[supervisorPID]
		if ok && current.Start == supervisorEntry.Start && !current.Zombie && current.PPID == 1 {
			break
		}
		if time.Now().After(reparentDeadline) {
			t.Fatal("the supervisor was not reparented to launchd after the owner departed")
		}
		time.Sleep(20 * time.Millisecond)
	}

	// Keep stdin open: only stdout is lost. The natural heartbeat provides the
	// failing write; the fixture never signals the supervisor.
	if err := stdoutRead.Close(); err != nil {
		t.Fatalf("could not break the supervisor stdout reader: %v", err)
	}
	stdoutRead = nil
	brokenAt := time.Now()
	table, err = joinedProbePoll([]fixtureProcess{supervisorEntry, childEntry},
		int(epipeReclaimWait/time.Millisecond))
	if err != nil {
		t.Fatalf("could not observe recovery after stdout loss: %v", err)
	}
	supervisorState := fixtureLiveOf(table, supervisorEntry)
	childState := fixtureLiveOf(table, childEntry)
	distinctState := fixtureLiveOf(table, distinctEntry)
	_, writeErr := os.Stat(filepath.Join(fixture, epipeWriteMarker))
	writeExercised := writeErr == nil
	t.Logf("EPIPE_RESULT supervisor=%s same_group_child=%s distinct_group=%s reclaim_ms=%d write_exercised=%t",
		fixtureStateName(supervisorState), fixtureStateName(childState),
		fixtureStateName(distinctState), time.Since(brokenAt).Milliseconds(), writeExercised)

	if supervisorState == fixtureLive {
		t.Errorf("supervisor live after stdout loss")
	}
	if childState == fixtureLive {
		t.Errorf("same-group child live after stdout loss")
	}
	if distinctState != fixtureLive {
		t.Errorf("distinct group %s after stdout loss", fixtureStateName(distinctState))
	}
	if !writeExercised {
		t.Errorf("failing stdout write was not observed")
	}
}
