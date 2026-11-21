//go:build darwin && desktop_runtime_package

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// The ordinary TestPackagedDesktopDeviceTurn covers the ordered
// supervisor.close path. This variant covers the other M1 case: raw SIGKILL of
// the enclosing host while native Codex holds a real shell child and a
// background child of that shell. It re-executes the existing gateway host
// fixture and shares the packaged fixture framing, websocket authentication,
// model relay validation, and callback acknowledgement.
//
// Scope: the strict assertion requires the shell, its background child, the
// supervised runtime ancestry, and every other recorded descendant to be gone
// before fallback cleanup. The task app-server's plugin sync is a task-tree
// descendant; the runner reclaims the supervisor's own process group after the
// Go owner departs, so that sync must also be gone. Task-tree and sibling-tree
// orphans are labelled separately.

const (
	forcedQuitConversation = "40000000-0000-4000-8000-0000000000f1"
	forcedQuitGeneration   = "50000000-0000-4000-8000-0000000000f1"
	forcedQuitTurn         = "60000000-0000-4000-8000-0000000000f1"
	forcedQuitConnection   = "70000000-0000-4000-8000-0000000000f1"
	forcedQuitStart        = "80000000-0000-4000-8000-0000000000f1"
	forcedQuitFile         = "forced-quit.txt"
	forcedQuitMarker       = "M1_FORCED_QUIT_SHELL_READY"
	forcedQuitShellPID     = "forced-quit-shell.pid"
	forcedQuitBackground   = "sleep 997"
	forcedQuitBackgroundID = "forced-quit-background.pid"
	forcedQuitScript       = "echo $$ > " + forcedQuitShellPID + "; " + forcedQuitBackground +
		" & echo $! > " + forcedQuitBackgroundID + "; exec tail -f " + forcedQuitFile
	forcedQuitCommand     = "sh -c '" + forcedQuitScript + "'"
	forcedQuitHostPattern = "^TestPackagedDesktopGateway$"
	forcedQuitReclaimWait = 15 * time.Second
	forcedQuitExitWait    = 10 * time.Second
)

// BSD process states use SZOMB for an exited but not yet reaped process. A
// zombie is not a live process; the observation below reports it as such.
const fixtureZombieState = 5

type fixtureProcess struct {
	PID    int
	PPID   int
	PGID   int
	Start  string
	Zombie bool
}

type fixtureProcessTable map[int]fixtureProcess

func fixtureProcesses() (fixtureProcessTable, error) {
	all, err := unix.SysctlKinfoProcSlice("kern.proc.all")
	if err != nil {
		return nil, err
	}
	table := make(fixtureProcessTable, len(all))
	for _, info := range all {
		pid := int(info.Proc.P_pid)
		table[pid] = fixtureProcess{
			PID: pid, PPID: int(info.Eproc.Ppid), PGID: int(info.Eproc.Pgid),
			Start:  fmt.Sprintf("%d.%06d", info.Proc.P_starttime.Sec, info.Proc.P_starttime.Usec),
			Zombie: info.Proc.P_stat == fixtureZombieState,
		}
	}
	return table, nil
}

func fixtureDescendants(table fixtureProcessTable, root int) []fixtureProcess {
	children := map[int][]int{}
	for pid, entry := range table {
		children[entry.PPID] = append(children[entry.PPID], pid)
	}
	seen := map[int]bool{root: true}
	queue := []int{root}
	var result []fixtureProcess
	for len(queue) > 0 {
		pid := queue[0]
		queue = queue[1:]
		for _, child := range children[pid] {
			if seen[child] {
				continue
			}
			seen[child] = true
			result = append(result, table[child])
			queue = append(queue, child)
		}
	}
	return result
}

// fixtureAncestry returns the shell-to-host chain, excluding the host itself,
// and whether the chain actually terminates at that host.
func fixtureAncestry(table fixtureProcessTable, pid, host int) ([]fixtureProcess, bool) {
	var chain []fixtureProcess
	seen := map[int]bool{}
	current := pid
	for current != 0 && current != host && len(chain) < 32 {
		entry, ok := table[current]
		if !ok || seen[current] {
			return chain, false
		}
		seen[current] = true
		chain = append(chain, entry)
		current = entry.PPID
	}
	return chain, len(chain) > 0 && chain[len(chain)-1].PPID == host
}

type fixtureLiveness int

const (
	fixtureGone fixtureLiveness = iota
	fixtureZombie
	fixtureReused
	fixtureLive
)

// fixtureLiveOf requires a successful table observation and a matching native
// start identifier; a missing entry, a zombie, or a reused PID is not live.
func fixtureLiveOf(table fixtureProcessTable, entry fixtureProcess) fixtureLiveness {
	current, ok := table[entry.PID]
	if !ok {
		return fixtureGone
	}
	if current.Start != entry.Start {
		return fixtureReused
	}
	if current.Zombie {
		return fixtureZombie
	}
	return fixtureLive
}

func fixtureStateName(state fixtureLiveness) string {
	switch state {
	case fixtureGone:
		return "gone"
	case fixtureZombie:
		return "zombie"
	case fixtureReused:
		return "reused"
	default:
		return "live"
	}
}

func fixtureSomeLive(table fixtureProcessTable, entries []fixtureProcess) bool {
	for _, entry := range entries {
		if fixtureLiveOf(table, entry) == fixtureLive {
			return true
		}
	}
	return false
}

func fixtureLivePIDs(table fixtureProcessTable, entries []fixtureProcess) []string {
	var pids []string
	for _, entry := range entries {
		if fixtureLiveOf(table, entry) == fixtureLive {
			pids = append(pids, strconv.Itoa(entry.PID))
		}
	}
	return pids
}

func fixtureStart(entry fixtureProcess) string {
	return fmt.Sprintf("%d(start=%s)", entry.PID, entry.Start)
}

// fixtureCleanup signals recorded PIDs that are still the exact process the
// fixture observed. It never adopts new descendants and never signals a reused
// PID or an unverified process group.
func fixtureCleanup(t *testing.T, recorded []fixtureProcess) {
	t.Helper()
	signaled := 0
	for _, entry := range recorded {
		// Re-observe immediately before this exact signal. A missing entry, a
		// zombie, a changed start identifier, or an observation error means the
		// fixture no longer owns this PID and it is not signalled.
		table, err := fixtureProcesses()
		if err != nil {
			t.Errorf("M1_FORCED_QUIT_CLEANUP=unobservable error=%v", err)
			return
		}
		if fixtureLiveOf(table, entry) != fixtureLive {
			continue
		}
		if syscall.Kill(entry.PID, syscall.SIGKILL) == nil {
			signaled++
		}
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		table, err := fixtureProcesses()
		if err != nil {
			t.Errorf("M1_FORCED_QUIT_CLEANUP=unobservable error=%v", err)
			return
		}
		if !fixtureSomeLive(table, recorded) {
			t.Logf("M1_FORCED_QUIT_CLEANUP=clean signaled=%d", signaled)
			return
		}
		if time.Now().After(deadline) {
			t.Errorf("M1_FORCED_QUIT_CLEANUP=leftovers pids=%v", fixtureLivePIDs(table, recorded))
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
}

type fixtureHostExit struct {
	done chan struct{}
	mu   sync.Mutex
	err  error
}

// newFixtureHostExit exposes one reusable completion for Wait. Repeated waits
// see the same result, so an early failure observation cannot consume it and
// leave teardown waiting on a drained channel.
func newFixtureHostExit(command *exec.Cmd) *fixtureHostExit {
	exit := &fixtureHostExit{done: make(chan struct{})}
	go func() {
		waitErr := command.Wait()
		exit.mu.Lock()
		exit.err = waitErr
		exit.mu.Unlock()
		close(exit.done)
	}()
	return exit
}

func (exit *fixtureHostExit) result() error {
	exit.mu.Lock()
	defer exit.mu.Unlock()
	return exit.err
}

func (exit *fixtureHostExit) exited() bool {
	select {
	case <-exit.done:
		return true
	default:
		return false
	}
}

func (exit *fixtureHostExit) wait(timeout time.Duration) (error, bool) {
	select {
	case <-exit.done:
		return exit.result(), true
	case <-time.After(timeout):
		return nil, false
	}
}

func fixtureOwnedHost(table fixtureProcessTable, host fixtureProcess) bool {
	current, ok := table[host.PID]
	return ok && current.Start == host.Start && !current.Zombie
}

// fixtureExecutable resolves only the executable path, never the argv payload.
func fixtureExecutable(pid int) (string, error) {
	command := exec.Command("/bin/ps", "-p", strconv.Itoa(pid), "-ww", "-o", "command=")
	output, err := command.Output()
	if err != nil {
		return "", err
	}
	fields := strings.Fields(string(output))
	if len(fields) == 0 {
		return "", errors.New("process has no executable path")
	}
	return fields[0], nil
}

// fixtureAncestryPIDs returns the child-to-host PID chain and whether it
// contains the given ancestor. It never reads or stores argv.
func fixtureAncestryPIDs(table fixtureProcessTable, pid, ancestor int) ([]int, bool) {
	var pids []int
	seen := map[int]bool{}
	current := pid
	for index := 0; current != 0 && !seen[current] && index < 32; index++ {
		pids = append(pids, current)
		seen[current] = true
		if current == ancestor {
			return pids, true
		}
		entry, ok := table[current]
		if !ok {
			break
		}
		current = entry.PPID
	}
	return pids, false
}

func fixturePIDFile(t *testing.T, path string) int {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		data, err := os.ReadFile(path)
		if err == nil {
			pid, parseErr := strconv.Atoi(strings.TrimSpace(string(data)))
			if parseErr != nil || pid <= 1 {
				t.Fatalf("invalid fixture PID file")
			}
			return pid
		}
		if !os.IsNotExist(err) {
			t.Fatalf("could not read fixture PID file: %v", err)
		}
		if time.Now().After(deadline) {
			t.Fatalf("the shell did not publish its PID file")
		}
		time.Sleep(25 * time.Millisecond)
	}
}

// TestPackagedDesktopForcedQuitReclaimsCodexChild starts the existing gateway
// host, runs a synthetic native turn that holds a real shell child and its
// background child, SIGKILLs the host, and requires the shell, background, and
// supervised runtime ancestry to be gone without a replay.
func TestPackagedDesktopForcedQuitReclaimsCodexChild(t *testing.T) {
	runtimeRoot := os.Getenv("LINKSENSE_DESKTOP_RUNTIME_DIST")
	if !filepath.IsAbs(runtimeRoot) {
		t.Fatal("LINKSENSE_DESKTOP_RUNTIME_DIST must select a packaged runtime")
	}
	credential := deviceFixtureCredential()
	modelToken := "lsdm_" + strings.Repeat("a", 43)
	runToken := "lsdr_" + strings.Repeat("b", 43)
	dataRoot := filepath.Join(t.TempDir(), "local-runtime")
	sessionRoot := filepath.Join(dataRoot, credential.OwnerID, "services", forcedQuitConversation)
	workspace := filepath.Join(sessionRoot, "home", "workspace")
	if err := os.MkdirAll(workspace, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "fixture.txt"), []byte("MAC_DEVICE_READ_OK\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, forcedQuitFile), []byte(forcedQuitMarker+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	rules := filepath.Join(filepath.Dir(workspace), ".codex", "rules")
	if err := os.MkdirAll(rules, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rules, "default.rules"),
		[]byte("prefix_rule(pattern=[\"cat\", \"fixture.txt\"], decision=\"allow\")\n"+
			"prefix_rule(pattern=[\"sh\", \"-c\", "+strconv.Quote(forcedQuitScript)+"], decision=\"allow\")\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	var modelCalls atomic.Int32
	var connections atomic.Int32
	hostKilled := atomic.Bool{}
	modelHeld := make(chan struct{})
	modelAborted := make(chan struct{})
	var heldOnce, abortOnce sync.Once
	rejected := make(chan struct{}, 1)
	script := func(call int, input string) fixtureModelDirective {
		switch call {
		case 1:
			return fixtureModelDirective{command: "cat fixture.txt"}
		case 2:
			if !strings.Contains(input, "MAC_DEVICE_READ_OK") {
				return fixtureModelDirective{reject: "native Codex did not read the workspace file"}
			}
			return fixtureModelDirective{command: forcedQuitCommand}
		case 3:
			if !strings.Contains(input, forcedQuitMarker) {
				return fixtureModelDirective{reject: "the native shell child did not produce its marker"}
			}
			return fixtureModelDirective{hold: func(ctx context.Context) {
				heldOnce.Do(func() { close(modelHeld) })
				select {
				case <-ctx.Done():
					abortOnce.Do(func() { close(modelAborted) })
				case <-time.After(45 * time.Second):
					t.Error("the held native model request did not end after the host was force killed")
				}
			}}
		default:
			return fixtureModelDirective{reject: "the forced-quit fixture observed a replayed model request"}
		}
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/desktop/models/"+forcedQuitTurn+"/primary/responses" {
			serveFixtureModel(t, w, r, modelToken, forcedQuitTurn, &modelCalls, script,
				func(message string, status int) {
					t.Error(message)
					select {
					case rejected <- struct{}{}:
					default:
					}
					w.WriteHeader(status)
				})
			return
		}
		if r.URL.Path != "/api/v1/desktop/devices/socket" ||
			r.Header.Get(desktopExecutionHeader) != strconv.Itoa(desktopExecutionVersion) {
			t.Error("desktop did not negotiate the forced-quit device channel")
			w.WriteHeader(404)
			return
		}
		if connections.Add(1) != 1 {
			t.Error("the forced-quit fixture opened an extra device connection")
			w.WriteHeader(409)
			return
		}
		socket, ok := acceptFixtureDeviceSocket(t, w, r, credential, forcedQuitConnection, 60*time.Second)
		if !ok {
			return
		}
		defer socket.close()
		send := func(value any) bool {
			if !socket.send(value) {
				if !hostKilled.Load() {
					t.Error("forced-quit test frame was not sent")
				}
				return false
			}
			return true
		}
		start := map[string]any{"type": "command", "operation": "turn.start", "id": forcedQuitStart,
			"owner_id": credential.OwnerID, "conversation_id": forcedQuitConversation,
			"runtime_generation": forcedQuitGeneration, "turn_id": forcedQuitTurn,
			"expires_at": time.Now().Add(45 * time.Second).UTC().Format(time.RFC3339Nano)}
		start["body"] = map[string]any{
			"native_thread_id": nil, "input": "Hold a local shell child open for the forced-quit fixture.", "reasoning_effort": "low",
			"credentials": map[string]any{"turn_id": forcedQuitTurn, "run_token": runToken,
				"expires_at": time.Now().Add(2 * time.Minute).UTC().Format(time.RFC3339Nano),
				"primary":    map[string]any{"purpose": "primary", "model": "gpt-5.4", "revision": 1, "protocol_mode": "native_responses", "token": modelToken}},
		}
		if !send(start) {
			return
		}
		for {
			frame, ok := socket.receive()
			if !ok {
				if !hostKilled.Load() {
					t.Errorf("forced-quit device channel ended before the kill")
				}
				return
			}
			switch frame.Type {
			case "command.result":
				if frame.ID == forcedQuitStart && !frame.OK {
					t.Errorf("forced-quit turn start failed: %s", frame.ErrorCode)
					return
				}
			case "execution.callback", "execution.recovery":
				send(map[string]any{"type": "execution.ack", "id": frame.ID, "operation": frame.Operation,
					"ok": true, "data": frame.acknowledgement()})
			default:
				t.Error("forced-quit device sent an unapproved frame")
				return
			}
		}
	}))
	t.Cleanup(server.Close)
	origin, originErr := url.Parse(server.URL)
	if originErr != nil {
		t.Fatal(originErr)
	}

	// Reuse the existing packaged gateway host: it owns the real supervisor and
	// device connection and performs its normal supervisor.close when stdin
	// ends, which is the pre-SIGKILL failure path below.
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	host := exec.Command(executable, "-test.run="+forcedQuitHostPattern, "-test.v", "-test.timeout=150s")
	host.Env = append(os.Environ(), "LINKSENSE_DESKTOP_RUNTIME_DIST="+runtimeRoot)
	hostStdin, err := host.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	hostOutput := &lockedBuffer{}
	host.Stdout, host.Stderr = hostOutput, hostOutput
	if err := host.Start(); err != nil {
		t.Fatalf("could not start the packaged gateway host: %v", err)
	}
	hostPID := host.Process.Pid
	hostExit := newFixtureHostExit(host)
	hostTable, tableErr := fixtureProcesses()
	if tableErr != nil {
		t.Fatalf("could not observe the started gateway host: %v", tableErr)
	}
	hostEntry, ok := hostTable[hostPID]
	if !ok || hostEntry.Zombie {
		t.Fatalf("the started gateway host was not observable: %v", hostExit.result())
	}
	var hostSignaled atomic.Bool
	var recorded []fixtureProcess
	var shellEntry, backgroundEntry fixtureProcess
	var runtimeChain []fixtureProcess
	t.Cleanup(func() {
		if !hostSignaled.Load() {
			// The force path was never reached: ask the gateway host to run its
			// ordinary supervisor.close, bounded. A consumed early completion
			// stays readable, so this never waits on a drained channel or treats
			// a re-used host PID as an ancestry root.
			hostKilled.Store(true)
			if hostExit.exited() {
				t.Logf("M1_FORCED_QUIT_CLEANUP=orderly host_exit=%v", hostExit.result())
			} else {
				_ = hostStdin.Close()
				waitErr, exited := hostExit.wait(20 * time.Second)
				if exited {
					t.Logf("M1_FORCED_QUIT_CLEANUP=orderly host_exit=%v", waitErr)
				} else {
					table, snapshotErr := fixtureProcesses()
					if snapshotErr != nil {
						t.Errorf("could not observe the host before fallback cleanup: %v", snapshotErr)
					} else if !fixtureOwnedHost(table, hostEntry) {
						t.Logf("M1_FORCED_QUIT_CLEANUP=host_not_owned pid=%d", hostPID)
					} else {
						recorded = append(recorded, fixtureDescendants(table, hostPID)...)
						hostSignaled.Store(true)
						_ = host.Process.Kill()
						waitErr, _ = hostExit.wait(forcedQuitExitWait)
						t.Logf("M1_FORCED_QUIT_CLEANUP=fallback host_exit=%v", waitErr)
					}
				}
			}
		}
		if len(recorded) > 0 {
			fixtureCleanup(t, recorded)
		}
		if t.Failed() {
			t.Logf("forced-quit host output:\n%s", hostOutput.String())
		}
	})
	fixture, err := json.Marshal(map[string]any{"origin": origin.String(), "dataRoot": dataRoot, "credential": credential})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := hostStdin.Write(append(fixture, '\n')); err != nil {
		t.Fatalf("could not hand the forced-quit fixture to the gateway: %v", err)
	}

	select {
	case <-modelHeld:
	case <-rejected:
		t.Fatal("forced-quit model fixture rejected a request")
	case <-hostExit.done:
		t.Fatalf("forced-quit gateway exited before the shell child was held: %v", hostExit.result())
	case <-time.After(45 * time.Second):
		t.Fatal("forced-quit fixture did not reach the held shell child")
	}
	shellPID := fixturePIDFile(t, filepath.Join(workspace, forcedQuitShellPID))
	backgroundPID := fixturePIDFile(t, filepath.Join(workspace, forcedQuitBackgroundID))
	deadline := time.Now().Add(15 * time.Second)
	for {
		table, tableErr := fixtureProcesses()
		if tableErr != nil {
			t.Fatalf("could not observe the host process tree: %v", tableErr)
		}
		shell, shellOK := table[shellPID]
		background, backgroundOK := table[backgroundPID]
		if shellOK && backgroundOK && !shell.Zombie && !background.Zombie && background.PPID == shellPID {
			chain, reached := fixtureAncestry(table, shellPID, hostPID)
			if reached && len(chain) >= 2 {
				shellEntry = shell
				backgroundEntry = background
				runtimeChain = chain
				t.Logf("M1_FORCED_QUIT_CHAIN host=%d shell=%s background=%s chain=%v",
					hostPID, fixtureStart(shell), fixtureStart(background), fixturePIDs(chain))
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("the shell/background pair was not proven under the gateway host")
		}
		time.Sleep(50 * time.Millisecond)
	}
	beforeCalls := int(modelCalls.Load())
	beforeConnections := int(connections.Load())
	packagedCodex := filepath.Join(runtimeRoot, "bin", "codex")
	taskCodexPID := 0
	for _, entry := range runtimeChain {
		executablePath, execErr := fixtureExecutable(entry.PID)
		if execErr != nil {
			t.Fatalf("could not prove shell ancestry contains packaged Codex: %v", execErr)
		}
		if executablePath == packagedCodex {
			taskCodexPID = entry.PID
			break
		}
	}
	if taskCodexPID == 0 {
		t.Fatal("shell ancestry does not contain the packaged Codex executable")
	}
	supervisorEntry := runtimeChain[len(runtimeChain)-1]
	if supervisorEntry.PGID != supervisorEntry.PID {
		t.Fatal("the Go launcher did not create the supervisor's own process group")
	}
	if supervisorEntry.PGID == hostEntry.PGID {
		t.Fatal("the supervisor shares the Go host's process group")
	}
	t.Logf("M1_FORCED_QUIT_TOPOLOGY host=%d host_pgid=%d chain=%v codex=%d supervisor=%d supervisor_pgid=%d shell=%s shell_pgid=%d background=%s background_pgid=%d",
		hostPID, hostEntry.PGID, fixturePIDs(runtimeChain), taskCodexPID, supervisorEntry.PID,
		supervisorEntry.PGID, fixtureStart(shellEntry), shellEntry.PGID, fixtureStart(backgroundEntry), backgroundEntry.PGID)
	// Capture the exact owned descendants again immediately before the signal.
	// This is the last proven-ancestry snapshot; late natives are included.
	preKillTable, err := fixtureProcesses()
	if err != nil {
		t.Fatalf("could not capture the host descendants before SIGKILL: %v", err)
	}
	if !fixtureOwnedHost(preKillTable, hostEntry) {
		t.Fatal("the gateway host PID no longer belongs to the started process")
	}
	finalShell, ok := preKillTable[shellPID]
	if !ok || finalShell.Start != shellEntry.Start || finalShell.Zombie {
		t.Fatal("the shell child was not the same live process before SIGKILL")
	}
	finalBackground, ok := preKillTable[backgroundPID]
	if !ok || finalBackground.Start != backgroundEntry.Start || finalBackground.Zombie ||
		finalBackground.PPID != shellPID {
		t.Fatal("the background child was not the same live process before SIGKILL")
	}
	recorded = fixtureDescendants(preKillTable, hostPID)

	if hostExit.exited() {
		t.Fatalf("the gateway host exited before the force signal: %v", hostExit.result())
	}
	hostSignaled.Store(true)
	hostKilled.Store(true)
	killAt := time.Now()
	if err := host.Process.Kill(); err != nil {
		t.Fatalf("could not force kill the enclosing host: %v", err)
	}
	waitErr, exited := hostExit.wait(forcedQuitExitWait)
	if !exited {
		t.Fatalf("the enclosing host did not exit within %s after SIGKILL", forcedQuitExitWait)
	}
	if waitErr == nil {
		t.Fatal("the enclosing host exited without a signal instead of being force killed")
	}
	var exit *exec.ExitError
	if !errors.As(waitErr, &exit) || !exit.Sys().(syscall.WaitStatus).Signaled() ||
		exit.Sys().(syscall.WaitStatus).Signal() != syscall.SIGKILL {
		t.Fatalf("the enclosing host did not die by SIGKILL: %v", waitErr)
	}
	t.Logf("M1_FORCED_QUIT_MODE=SIGKILL_HOST host=%d signal=SIGKILL", hostPID)

	select {
	case <-modelAborted:
	case <-time.After(forcedQuitReclaimWait):
		t.Errorf("the held native model request did not end within %s", forcedQuitReclaimWait)
	}
	reclaimDeadline := time.Now().Add(forcedQuitReclaimWait)
	m1Set := append([]fixtureProcess{shellEntry, backgroundEntry}, runtimeChain...)
	var final fixtureProcessTable
	for {
		table, tableErr := fixtureProcesses()
		if tableErr != nil {
			t.Fatalf("could not observe the process table after SIGKILL: %v", tableErr)
		}
		final = table
		if !fixtureSomeLive(final, m1Set) || time.Now().After(reclaimDeadline) {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	m1Reclaim := time.Since(killAt)
	// Give any non-M1 descendant a short, bounded exit window before the strict
	// assertion; this does not extend the measured shell/runtime reclaim time.
	tailDeadline := time.Now().Add(2 * time.Second)
	for fixtureSomeLive(final, recorded) && time.Now().Before(tailDeadline) {
		table, tableErr := fixtureProcesses()
		if tableErr != nil {
			t.Fatalf("could not observe the process table after SIGKILL: %v", tableErr)
		}
		final = table
		time.Sleep(50 * time.Millisecond)
	}
	afterCalls := int(modelCalls.Load())
	afterConnections := int(connections.Load())
	if afterCalls != beforeCalls {
		t.Errorf("the forced-quit fixture replayed %d model request(s) after SIGKILL", afterCalls-beforeCalls)
	}
	if afterConnections != beforeConnections {
		t.Errorf("the forced-quit fixture reconnected %d time(s) after SIGKILL", afterConnections-beforeConnections)
	}
	t.Logf("M1_FORCED_QUIT_MODEL calls_before=%d calls_after=%d connections_before=%d connections_after=%d",
		beforeCalls, afterCalls, beforeConnections, afterConnections)

	chain := runtimeChain
	shellState := fixtureLiveOf(final, shellEntry)
	backgroundState := fixtureLiveOf(final, backgroundEntry)
	if shellState == fixtureLive {
		t.Errorf("M1_FORCED_QUIT_SHELL=orphaned pid=%d", shellEntry.PID)
	}
	if backgroundState == fixtureLive {
		t.Errorf("M1_FORCED_QUIT_BACKGROUND=orphaned pid=%d", backgroundEntry.PID)
	}
	if len(chain) > 0 && fixtureSomeLive(final, chain) {
		t.Errorf("M1_FORCED_QUIT_RUNTIME=orphaned pids=%v", fixtureLivePIDs(final, chain))
	}
	owned := map[int]bool{shellEntry.PID: true, backgroundEntry.PID: true}
	for _, entry := range chain {
		owned[entry.PID] = true
	}
	var other []fixtureProcess
	for _, entry := range recorded {
		if !owned[entry.PID] {
			other = append(other, entry)
		}
	}
	type fixtureOrphan struct {
		PID  int
		PGID int
	}
	var otherLiveTask, otherLiveSibling []fixtureOrphan
	groupMatch := true
	for _, entry := range other {
		if fixtureLiveOf(final, entry) != fixtureLive {
			continue
		}
		orphan := fixtureOrphan{PID: entry.PID, PGID: entry.PGID}
		if entry.PGID != supervisorEntry.PID {
			groupMatch = false
		}
		if _, underTask := fixtureAncestryPIDs(preKillTable, entry.PID, taskCodexPID); underTask {
			otherLiveTask = append(otherLiveTask, orphan)
		} else {
			otherLiveSibling = append(otherLiveSibling, orphan)
		}
	}
	if len(otherLiveTask)+len(otherLiveSibling) > 0 {
		t.Errorf("M1_FORCED_QUIT_OTHER=orphaned task=%v sibling=%v group_match=%t supervisor_pgid=%d",
			otherLiveTask, otherLiveSibling, groupMatch, supervisorEntry.PID)
	}
	if fixtureSomeLive(final, recorded) {
		t.Errorf("M1_FORCED_QUIT_RESULT=orphaned pids=%v", fixtureLivePIDs(final, recorded))
		return
	}
	t.Logf("M1_FORCED_QUIT_RESULT=reclaimed scope=shell,background,runtime,other host=%d shell=%s shell_state=%s background=%s background_state=%s runtime=%v other=%v reclaim_ms=%d",
		hostPID, fixtureStart(shellEntry), fixtureStateName(shellState), fixtureStart(backgroundEntry),
		fixtureStateName(backgroundState), fixturePIDs(chain), fixturePIDs(other), m1Reclaim.Milliseconds())
}

func fixturePIDs(entries []fixtureProcess) []int {
	pids := make([]int, 0, len(entries))
	for _, entry := range entries {
		pids = append(pids, entry.PID)
	}
	return pids
}

// lockedBuffer serializes the host output copied by exec.Wait with failure logs.
type lockedBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (b *lockedBuffer) Write(data []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.Write(data)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.String()
}
