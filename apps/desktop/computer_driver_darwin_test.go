//go:build darwin

package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	goruntime "runtime"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// The test executable is copied to <runtimeRoot>/bin/agent-desktop. init runs
// before testing.Main, so a copied executable answers as a deterministic fake
// engine without a shell, script, or extra build step.
func init() {
	if filepath.Base(os.Args[0]) != "agent-desktop" {
		return
	}
	base := filepath.Dir(os.Args[0])
	if _, err := os.Stat(filepath.Join(base, "fake-scenario.json")); err != nil {
		return
	}
	os.Exit(runFakeAgentDesktop(base))
}

const (
	fakeScenarioFile    = "fake-scenario.json"
	fakeCallsFile       = "fake-calls.jsonl"
	fakeSnapshotCounter = "fake-snapshot-counter"
	fakeWindowCounter   = "fake-window-counter"
)

type fakeScenario struct {
	StatusData      json.RawMessage            `json:"status_data,omitempty"`
	PermissionsData json.RawMessage            `json:"permissions_data,omitempty"`
	Windows         json.RawMessage            `json:"windows,omitempty"`
	WindowsCalls    []json.RawMessage          `json:"windows_calls,omitempty"`
	Snapshots       []json.RawMessage          `json:"snapshots,omitempty"`
	ActionData      map[string]json.RawMessage `json:"action_data,omitempty"`
	ActionError     map[string]json.RawMessage `json:"action_error,omitempty"`
	DelayMS         int                        `json:"delay_ms,omitempty"`
	DelayCommand    string                     `json:"delay_command,omitempty"`
	RawStdout       string                     `json:"raw_stdout,omitempty"`
	ExitCode        int                        `json:"exit_code,omitempty"`
}

type fakeCall struct {
	Argv      []string `json:"argv"`
	Stdin     string   `json:"stdin,omitempty"`
	Env       []string `json:"env"`
	Cwd       string   `json:"cwd"`
	PID       int      `json:"pid"`
	Sandboxed bool     `json:"sandboxed"`
}

func runFakeAgentDesktop(base string) int {
	scenarioBytes, err := os.ReadFile(filepath.Join(base, fakeScenarioFile))
	if err != nil {
		return 2
	}
	var scenario fakeScenario
	if err := json.Unmarshal(scenarioBytes, &scenario); err != nil {
		return 2
	}
	command, _ := fakeCommand(os.Args[1:])
	stdin := ""
	if command == "type" {
		var input []byte
		input, err = io.ReadAll(io.LimitReader(os.Stdin, 128*1024))
		if err != nil {
			return 2
		}
		stdin = string(input)
	}
	environment := os.Environ()
	directory, _ := os.Getwd()
	// The fixed profile denies signals to another process, including signal 0.
	// Self-signals stay allowed, so check the parent; an unsandboxed fallback
	// would make this succeed and fail the tests. Signal 0 delivers nothing.
	sandboxed := errors.Is(syscall.Kill(os.Getppid(), 0), syscall.EPERM)
	call, _ := json.Marshal(fakeCall{Argv: os.Args[1:], Stdin: stdin, Env: environment, Cwd: directory, PID: os.Getpid(), Sandboxed: sandboxed})
	logFile, err := os.OpenFile(filepath.Join(base, fakeCallsFile), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return 2
	}
	if _, err := logFile.Write(append(call, '\n')); err != nil {
		_ = logFile.Close()
		return 2
	}
	if err := logFile.Close(); err != nil {
		return 2
	}

	if scenario.RawStdout != "" {
		_, _ = os.Stdout.WriteString(scenario.RawStdout)
		return scenario.ExitCode
	}
	if scenario.DelayMS > 0 && (scenario.DelayCommand == "" || scenario.DelayCommand == command) {
		time.Sleep(time.Duration(scenario.DelayMS) * time.Millisecond)
	}

	switch command {
	case "status":
		if len(scenario.StatusData) == 0 {
			return fakeWriteError("status", "INTERNAL")
		}
		return fakeWriteSuccess("status", scenario.StatusData)
	case "permissions":
		data := scenario.PermissionsData
		if len(data) == 0 {
			data = json.RawMessage(`{"accessibility":{"state":"granted"},"automation":{"state":"not_required"},"screen_recording":{"state":"not_required"}}`)
		}
		return fakeWriteSuccess("permissions", data)
	case "list-windows":
		data := scenario.Windows
		if len(scenario.WindowsCalls) > 0 {
			index := fakeCounter(base, fakeWindowCounter)
			if index >= len(scenario.WindowsCalls) {
				index = len(scenario.WindowsCalls) - 1
			}
			data = scenario.WindowsCalls[index]
			fakeAdvanceCounter(base, fakeWindowCounter)
		}
		if len(data) == 0 {
			data = json.RawMessage(`[]`)
		}
		return fakeWriteSuccess("list-windows", data)
	case "snapshot":
		if len(scenario.Snapshots) == 0 {
			return fakeWriteError("snapshot", "INTERNAL")
		}
		index := fakeCounter(base, fakeSnapshotCounter)
		if index >= len(scenario.Snapshots) {
			index = len(scenario.Snapshots) - 1
		}
		fakeAdvanceCounter(base, fakeSnapshotCounter)
		return fakeWriteSuccess("snapshot", scenario.Snapshots[index])
	case "click", "type":
		if raw, ok := scenario.ActionError[command]; ok {
			return fakeWriteRawError(command, raw)
		}
		data, ok := scenario.ActionData[command]
		if !ok {
			data, _ = json.Marshal(map[string]any{
				"action":      command,
				"disposition": map[string]any{"delivery": "delivered_unverified", "retry": "unsafe"},
			})
		}
		return fakeWriteSuccess(command, data)
	default:
		return fakeWriteError(command, "INVALID_ARGS")
	}
}

func fakeCommand(args []string) (string, []string) {
	for index := 0; index < len(args); index++ {
		value := args[index]
		if value == "--session" {
			index++
			continue
		}
		if strings.HasPrefix(value, "--") {
			continue
		}
		return value, args[index+1:]
	}
	return "", nil
}

func fakeCounter(base, name string) int {
	path := filepath.Join(base, name)
	data, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	value, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil || value < 0 {
		return 0
	}
	return value
}

func fakeAdvanceCounter(base, name string) {
	value := fakeCounter(base, name) + 1
	_ = os.WriteFile(filepath.Join(base, name), []byte(strconv.Itoa(value)+"\n"), 0o600)
}

func fakeWriteSuccess(command string, data json.RawMessage) int {
	if len(data) == 0 {
		data = json.RawMessage(`{}`)
	}
	payload := make([]byte, 0, len(data)+96)
	payload = append(payload, `{"version":"2.6","ok":true,"command":`...)
	commandJSON, _ := json.Marshal(command)
	payload = append(payload, commandJSON...)
	payload = append(payload, `,"data":`...)
	payload = append(payload, data...)
	payload = append(payload, '}', '\n')
	_, _ = os.Stdout.Write(payload)
	return 0
}

func fakeWriteError(command string, code string) int {
	errorJSON, _ := json.Marshal(map[string]any{
		"code":        code,
		"message":     "fake error",
		"disposition": map[string]any{"delivery": "not_delivered", "retry": "safe"},
	})
	return fakeWriteRawError(command, errorJSON)
}

func fakeWriteRawError(command string, errorJSON json.RawMessage) int {
	payload := make([]byte, 0, len(errorJSON)+96)
	payload = append(payload, `{"version":"2.6","ok":false,"command":`...)
	commandJSON, _ := json.Marshal(command)
	payload = append(payload, commandJSON...)
	payload = append(payload, `,"error":`...)
	payload = append(payload, errorJSON...)
	payload = append(payload, '}', '\n')
	_, _ = os.Stdout.Write(payload)
	return 1
}

func newFakeRuntime(t *testing.T) (runtimeRoot, stateRoot string) {
	t.Helper()
	root := t.TempDir()
	runtimeRoot = filepath.Join(root, "runtime")
	populateFakeRuntime(t, runtimeRoot)
	return runtimeRoot, root
}

func populateFakeRuntime(t *testing.T, runtimeRoot string) {
	t.Helper()
	bin := filepath.Join(runtimeRoot, "bin")
	if err := os.MkdirAll(bin, 0o700); err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	fakeBinary := filepath.Join(bin, "agent-desktop")
	copyExecutable(t, executable, fakeBinary)
	// The helper is never executed by this slice; a hardlink keeps the fixture
	// cheap while still presenting a real, checksum-matching executable file.
	if err := os.Link(fakeBinary, filepath.Join(bin, "agent-desktop-macos-helper")); err != nil {
		copyExecutable(t, executable, filepath.Join(bin, "agent-desktop-macos-helper"))
	}
	writeFakeManifest(t, runtimeRoot, "1.3.1", true)
}

func copyExecutable(t *testing.T, source, destination string) {
	t.Helper()
	input, err := os.Open(source)
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o700)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(output, input); err != nil {
		_ = output.Close()
		t.Fatal(err)
	}
	if err := output.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(destination, 0o700); err != nil {
		t.Fatal(err)
	}
}

func fileSHA256(t *testing.T, path string) string {
	t.Helper()
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func writeFakeManifest(t *testing.T, runtimeRoot, version string, includeHelper bool) {
	t.Helper()
	files := []map[string]string{{
		"path":   "bin/agent-desktop",
		"sha256": fileSHA256(t, filepath.Join(runtimeRoot, "bin", "agent-desktop")),
	}}
	if includeHelper {
		files = append(files, map[string]string{
			"path":   "bin/agent-desktop-macos-helper",
			"sha256": fileSHA256(t, filepath.Join(runtimeRoot, "bin", "agent-desktop-macos-helper")),
		})
	}
	manifest := map[string]any{
		"schema_version": 1,
		"application":    "org.linksense.desktop",
		"target":         "darwin/" + goruntime.GOARCH,
		"runtime_arch":   goruntime.GOARCH,
		"versions":       map[string]string{"agent_desktop": version},
		"files":          files,
	}
	data, _ := json.Marshal(manifest)
	if err := os.WriteFile(filepath.Join(runtimeRoot, "manifest.json"), data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func writeFakeScenario(t *testing.T, runtimeRoot string, scenario fakeScenario) {
	t.Helper()
	data, err := json.Marshal(scenario)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runtimeRoot, "bin", fakeScenarioFile), data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func preparedProof() computerRuntimeProof {
	return computerRuntimeProof{Kind: computerRuntimeProofPrepared}
}

func newPreparedDriver(t *testing.T, runtimeRoot, stateParent string) *computerDriver {
	t.Helper()
	driver, err := newComputerDriverDarwin(runtimeRoot, stateParent, preparedProof())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = driver.Close() })
	return driver
}

func resetFakeCalls(t *testing.T, runtimeRoot string) {
	t.Helper()
	if err := os.Remove(filepath.Join(runtimeRoot, "bin", fakeCallsFile)); err != nil && !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
}

func readFakeCalls(t *testing.T, runtimeRoot string) []fakeCall {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(runtimeRoot, "bin", fakeCallsFile))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	var calls []fakeCall
	for _, line := range bytes.Split(bytes.TrimSpace(data), []byte{'\n'}) {
		if len(line) == 0 {
			continue
		}
		var call fakeCall
		if err := json.Unmarshal(line, &call); err != nil {
			t.Fatalf("invalid fake call record: %v", err)
		}
		if !call.Sandboxed {
			t.Fatalf("unsandboxed invocation: %q", call.Argv)
		}
		calls = append(calls, call)
	}
	return calls
}

func callsFor(calls []fakeCall, command string) []fakeCall {
	var result []fakeCall
	for _, call := range calls {
		if len(call.Argv) >= 3 && call.Argv[2] == command {
			result = append(result, call)
		}
	}
	return result
}

func assertExactArgs(t *testing.T, call fakeCall, sessionID, command string, rest ...string) {
	t.Helper()
	want := append([]string{"--session", sessionID, command}, rest...)
	if !slices.Equal(call.Argv, want) {
		t.Fatalf("unexpected args\n got: %q\nwant: %q", call.Argv, want)
	}
}

func assertNoForbiddenArgs(t *testing.T, calls []fakeCall) {
	t.Helper()
	forbidden := map[string]bool{
		"--headed": true, "--trace": true, "--trace-strict": true, "--debug": true,
		"--screenshot": true, "--force": true, "--arg": true, "--env": true,
		"--cwd": true, "--cdp": true, "--guide": true, "--request": true,
		"--surface": true, "batch": true, "mcp": true, "sandbox": true,
		"launch": true, "close-app": true, "clipboard-get": true, "clipboard-set": true,
		"clipboard-clear": true, "press": true, "key-down": true, "key-up": true,
		"mouse-down": true, "mouse-up": true, "mouse-move": true, "mouse-click": true,
		"mouse-wheel": true, "screenshot": true, "skills": true, "trace": true,
		"session": true, "focus-window": true, "resize-window": true, "move-window": true,
		"minimize": true, "maximize": true, "restore": true, "open-system-surface": true,
		"list-notifications": true, "dismiss-notification": true, "dismiss-all-notifications": true,
		"notification-action": true, "find": true, "get": true, "is": true,
		"set-value": true, "clear": true, "focus": true, "select": true, "toggle": true,
		"check": true, "uncheck": true, "expand": true, "collapse": true, "scroll": true,
		"scroll-to": true, "hover": true, "drag": true, "double-click": true,
		"triple-click": true, "right-click": true, "version": true,
	}
	for _, call := range calls {
		for _, arg := range call.Argv {
			if forbidden[arg] {
				t.Fatalf("forbidden argument %q in %q", arg, call.Argv)
			}
		}
		for _, entry := range call.Env {
			switch {
			case strings.HasPrefix(entry, "PATH="),
				strings.HasPrefix(entry, "AGENT_DESKTOP_SESSION="),
				strings.HasPrefix(entry, "AGENT_DESKTOP_AGENT_ID="),
				strings.HasPrefix(entry, "AGENT_DESKTOP_INTERNAL_COMMAND_HOST="),
				strings.HasPrefix(entry, "RUST_LOG="):
				t.Fatalf("unexpected environment entry %q", entry)
			}
		}
	}
}

func fakePermissions(accessibility string) json.RawMessage {
	data, _ := json.Marshal(map[string]any{
		"accessibility":    map[string]any{"state": accessibility},
		"automation":       map[string]any{"state": "not_required"},
		"screen_recording": map[string]any{"state": "not_required"},
	})
	return data
}

func fakeStatusData(sessionID, stateRoot, accessibility string) json.RawMessage {
	data, _ := json.Marshal(map[string]any{
		"platform":           "macos",
		"version":            "1.3.1",
		"permissions":        map[string]any{"accessibility": map[string]any{"state": accessibility}, "automation": map[string]any{"state": "not_required"}, "screen_recording": map[string]any{"state": "not_required"}},
		"snapshot_id":        nil,
		"ref_count":          nil,
		"session_id":         sessionID,
		"tracing":            false,
		"supported_surfaces": []string{"window", "focused"},
		"state_root":         stateRoot,
	})
	return data
}

func fixtureWindow() map[string]any {
	return fakeWindow("w-4242", 4242, "inst-1", "Fixture", "Fixture App")
}

func fixtureTarget() computerTarget {
	return computerTarget{App: "Fixture App", WindowID: "w-4242"}
}

func basicTree(ref string) map[string]any {
	return fakeNode("window", "Fixture", "", nil, fakeNode("button", "Apply", ref, nil))
}

func basicScenario(t *testing.T, snapshotID, ref string) fakeScenario {
	return fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Windows:         mustWindows(t, fixtureWindow()),
		Snapshots: []json.RawMessage{
			fakeSnapshotData(snapshotID, "w-4242", "Fixture", "Fixture App", basicTree(ref)),
		},
	}
}

func fakeWindow(id string, pid int, instance, title, app string) map[string]any {
	return map[string]any{
		"id": id, "pid": pid, "process_instance": instance,
		"title": title, "app_name": app, "accessible": true, "visible": true,
	}
}

func mustJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func mustWindows(t *testing.T, windows ...map[string]any) json.RawMessage {
	return mustJSON(t, windows)
}

func fakeNode(role, name, ref string, value any, children ...map[string]any) map[string]any {
	node := map[string]any{"role": role}
	if name != "" {
		node["name"] = name
	}
	if ref != "" {
		node["ref_id"] = ref
	}
	if value != nil {
		node["value"] = value
	}
	if len(children) > 0 {
		node["children"] = children
	}
	return node
}

func fakeSnapshotData(snapshotID, windowID, title, app string, tree map[string]any) json.RawMessage {
	data, _ := json.Marshal(map[string]any{
		"app": app, "snapshot_id": snapshotID, "ref_count": 2,
		"complete": true, "tree": tree,
		"window": map[string]any{"id": windowID, "title": title},
	})
	return data
}

func fakeUnprovenSnapshotData(snapshotID, windowID, title, app string, tree map[string]any) json.RawMessage {
	var value map[string]any
	_ = json.Unmarshal(fakeSnapshotData(snapshotID, windowID, title, app, tree), &value)
	value["identity_unproven"] = true
	data, _ := json.Marshal(value)
	return data
}

func fakeIncompleteSnapshotData(snapshotID, windowID, title, app string, tree map[string]any) json.RawMessage {
	var value map[string]any
	_ = json.Unmarshal(fakeSnapshotData(snapshotID, windowID, title, app, tree), &value)
	value["complete"] = false
	value["truncated"] = true
	data, _ := json.Marshal(value)
	return data
}

func TestComputerDriverStatusPinsRuntimeAndReportsPermissions(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, t.TempDir())
	scenario := fakeScenario{StatusData: fakeStatusData(driver.sessionID, driver.stateRoot, "granted")}
	writeFakeScenario(t, runtimeRoot, scenario)

	status, err := driver.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !status.PermissionsReady || status.AgentDesktopVersion != "1.3.1" ||
		status.Accessibility != "granted" || status.SessionID != driver.sessionID ||
		status.RuntimeProof != computerRuntimeProofPreparedLabel {
		t.Fatalf("unexpected status: %+v", status)
	}
	calls := readFakeCalls(t, runtimeRoot)
	if len(calls) != 1 {
		t.Fatalf("expected one status call, got %d", len(calls))
	}
	assertExactArgs(t, calls[0], driver.sessionID, "status")
	assertNoForbiddenArgs(t, calls)
	if len(calls[0].Env) != 3 ||
		!slices.Contains(calls[0].Env, "AGENT_DESKTOP_HOME="+driver.stateRoot) ||
		!slices.Contains(calls[0].Env, "AGENT_DESKTOP_MACOS_HELPER_PATH="+filepath.Join(runtimeRoot, "bin", "agent-desktop-macos-helper")) ||
		!slices.Contains(calls[0].Env, "HOME="+driver.stateRoot) {
		t.Fatalf("unexpected environment: %q", calls[0].Env)
	}
}

func TestComputerDriverStatusDeniedIsReported(t *testing.T) {
	runtimeRoot, _ := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, t.TempDir())
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		StatusData: fakeStatusData(driver.sessionID, driver.stateRoot, "denied"),
	})
	status, err := driver.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if status.PermissionsReady || status.Accessibility != "denied" {
		t.Fatalf("unexpected status: %+v", status)
	}
}

func TestComputerDriverObserveUsesExactPinnedArgsAndBoundsContent(t *testing.T) {
	runtimeRoot, stateRoot := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, stateRoot)

	deep := fakeNode("statictext", "deep", "", nil)
	for index := 0; index < 12; index++ {
		deep = fakeNode("group", "", "", nil, deep)
	}
	children := []map[string]any{
		fakeNode("textfield", "Input 白盒 🙂", "@sprei:e1", ""),
		fakeNode("button", "Apply", "@sprei:e2", nil),
		fakeNode("statictext", "line\u0000with control", "", nil),
		deep,
	}
	for index := 0; index < 450; index++ {
		children = append(children, fakeNode("button", "Bulk", "", nil))
	}
	tree := fakeNode("window", "Fixture", "", nil, fakeNode("group", "", "", nil, children...))
	snapshot := fakeSnapshotData("sprei", "w-4242", "Fixture", "Fixture App", tree)
	windows := mustWindows(t, fixtureWindow())
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Windows:         windows,
		Snapshots:       []json.RawMessage{snapshot},
	})

	observation, err := driver.Observe(context.Background(), fixtureTarget())
	if err != nil {
		t.Fatal(err)
	}
	if observation.Window.ID != "w-4242" || observation.Window.PID != 4242 ||
		observation.Window.ProcessInstance != "inst-1" || observation.SnapshotID != "sprei" {
		t.Fatalf("unexpected observation identity: %+v", observation)
	}
	if !observation.Truncated || observation.TreeQuality != computerTreeQualityPartial {
		t.Fatalf("expected bounded/partial observation: truncated=%v quality=%s", observation.Truncated, observation.TreeQuality)
	}
	if len(observation.Elements) > computerMaxObservationElements {
		t.Fatalf("element cap exceeded: %d", len(observation.Elements))
	}
	maxDepth := 0
	var input string
	for _, element := range observation.Elements {
		if element.Depth > maxDepth {
			maxDepth = element.Depth
		}
		if element.Role == "textfield" {
			input = element.Name
		}
		if strings.ContainsRune(element.Name, 0) || strings.ContainsRune(element.Value, 0) {
			t.Fatal("control characters must be sanitized")
		}
	}
	if maxDepth > computerMaxObservationDepth {
		t.Fatalf("depth cap exceeded: %d", maxDepth)
	}
	if input != "Input 白盒 🙂" {
		t.Fatalf("unicode name was not preserved: %q", input)
	}
	if len(observation.refs) != 0 {
		t.Fatal("public observation must not expose the ref set")
	}

	calls := readFakeCalls(t, runtimeRoot)
	if len(calls) != 3 {
		t.Fatalf("expected list-windows, snapshot, list-windows; got %d", len(calls))
	}
	assertExactArgs(t, calls[0], driver.sessionID, "list-windows", "--app=Fixture App", "--timeout-ms=5000")
	assertExactArgs(t, calls[1], driver.sessionID, "snapshot",
		"--app=Fixture App", "--window-id=w-4242", "--interactive-only", "--compact",
		"--max-depth=10", "--timeout-ms=5000")
	assertExactArgs(t, calls[2], driver.sessionID, "list-windows", "--app=Fixture App", "--timeout-ms=5000")
	assertNoForbiddenArgs(t, calls)
}

func TestComputerDriverActionsUseLatestRefsAndReadEffect(t *testing.T) {
	runtimeRoot, stateRoot := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, stateRoot)

	preTree := fakeNode("window", "Fixture", "", nil,
		fakeNode("group", "", "", nil,
			fakeNode("textfield", "Input", "@spre1:e1", ""),
			fakeNode("button", "Apply", "@spre1:e2", nil)))
	clickTree := fakeNode("window", "Fixture", "", nil,
		fakeNode("group", "", "", nil,
			fakeNode("textfield", "Input", "@sclick1:e1", "Applied"),
			fakeNode("button", "Apply", "@sclick1:e2", nil)))
	observedTree := fakeNode("window", "Fixture", "", nil,
		fakeNode("group", "", "", nil,
			fakeNode("textfield", "Input", "@sobserve2:e1", "Applied"),
			fakeNode("button", "Apply", "@sobserve2:e2", nil)))
	text := "LinkSense 白盒 123 🙂 é"
	typeTree := fakeNode("window", "Fixture", "", nil,
		fakeNode("group", "", "", nil,
			fakeNode("textfield", "Input", "@stype1:e1", text),
			fakeNode("button", "Apply", "@stype1:e2", nil)))
	scenario := fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Windows:         mustWindows(t, fixtureWindow()),
		Snapshots: []json.RawMessage{
			fakeSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", preTree),
			fakeSnapshotData("sclick1", "w-4242", "Fixture", "Fixture App", clickTree),
			fakeSnapshotData("sobserve2", "w-4242", "Fixture", "Fixture App", observedTree),
			fakeSnapshotData("stype1", "w-4242", "Fixture", "Fixture App", typeTree),
		},
	}
	writeFakeScenario(t, runtimeRoot, scenario)
	observation, err := driver.Observe(context.Background(), fixtureTarget())
	if err != nil {
		t.Fatal(err)
	}
	var clickRef string
	for _, element := range observation.Elements {
		if element.Role == "button" {
			clickRef = element.Ref
		}
	}
	if clickRef != "@spre1:e2" {
		t.Fatalf("unexpected click ref: %q", clickRef)
	}

	// Source v1.3.1 type/ordinary AXPress click normally end delivered_unverified.
	clickResult, err := driver.Act(context.Background(), computerAction{
		ObservationID: observation.ID, Kind: computerActionClick, Ref: clickRef,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !clickResult.Sent || !clickResult.Accepted || clickResult.Delivery != computerDeliveryUnverified ||
		clickResult.Retry != computerRetryUnsafe || clickResult.Effect != computerEffectSmallChange {
		t.Fatalf("unexpected click result: %+v", clickResult)
	}
	if driver.latest != nil {
		t.Fatal("unverified click must not leave actable refs")
	}
	clickCalls := callsFor(readFakeCalls(t, runtimeRoot), "click")
	if len(clickCalls) != 1 {
		t.Fatalf("expected exactly one click, got %d", len(clickCalls))
	}
	assertExactArgs(t, clickCalls[0], driver.sessionID, "click", clickRef, "--timeout-ms=15000")
	if count := len(callsFor(readFakeCalls(t, runtimeRoot), "snapshot")); count != 2 {
		t.Fatalf("expected one click readback, snapshots=%d", count)
	}
	_, err = driver.Act(context.Background(), computerAction{
		ObservationID: observation.ID, Kind: computerActionClick, Ref: clickRef,
	})
	var driverErr *computerDriverError
	if !errors.As(err, &driverErr) || driverErr.Code != computerErrorNoObservation {
		t.Fatalf("unverified click must not authorize reuse: %v", err)
	}

	// Future input requires a fresh explicit observe.
	observation, err = driver.Observe(context.Background(), fixtureTarget())
	if err != nil {
		t.Fatal(err)
	}
	if !observation.Actable || driver.latest == nil {
		t.Fatal("explicit observe must restore an actable observation")
	}
	var typeRef string
	for _, element := range observation.Elements {
		if element.Role == "textfield" {
			typeRef = element.Ref
		}
	}
	if typeRef != "@sobserve2:e1" {
		t.Fatalf("unexpected type ref: %q", typeRef)
	}
	resetFakeCalls(t, runtimeRoot)
	typeResult, err := driver.Act(context.Background(), computerAction{
		ObservationID: observation.ID, Kind: computerActionType, Ref: typeRef, Text: text,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !typeResult.Sent || !typeResult.Accepted || typeResult.Delivery != computerDeliveryUnverified ||
		typeResult.Retry != computerRetryUnsafe || typeResult.Effect != computerEffectDone {
		t.Fatalf("unexpected type result: %+v", typeResult)
	}
	if driver.latest != nil {
		t.Fatal("unverified type must not leave actable refs")
	}
	typeCalls := callsFor(readFakeCalls(t, runtimeRoot), "type")
	if len(typeCalls) != 1 {
		t.Fatalf("expected exactly one type, got %d", len(typeCalls))
	}
	assertExactArgs(t, typeCalls[0], driver.sessionID, "type", typeRef, "--stdin", "--timeout-ms=15000")
	if typeCalls[0].Stdin != text {
		t.Fatalf("stdin mismatch: got %q want %q", typeCalls[0].Stdin, text)
	}
	if strings.Contains(strings.Join(typeCalls[0].Argv, " "), text) {
		t.Fatal("text must never travel in argv")
	}
	if count := len(callsFor(readFakeCalls(t, runtimeRoot), "snapshot")); count != 1 {
		t.Fatalf("expected one type readback, snapshots=%d", count)
	}
	_, err = driver.Act(context.Background(), computerAction{
		ObservationID: observation.ID, Kind: computerActionType, Ref: typeRef, Text: text,
	})
	if !errors.As(err, &driverErr) || driverErr.Code != computerErrorNoObservation {
		t.Fatalf("unverified type must not authorize reuse: %v", err)
	}
	assertNoForbiddenArgs(t, readFakeCalls(t, runtimeRoot))
}

func TestComputerDriverRejectsChangedTargetAndStaleInputs(t *testing.T) {
	t.Run("changed process before act", func(t *testing.T) {
		runtimeRoot, stateRoot := newFakeRuntime(t)
		driver := newPreparedDriver(t, runtimeRoot, stateRoot)
		target := fixtureWindow()
		changed := fakeWindow("w-4242", 9999, "inst-2", "Fixture", "Fixture App")
		tree := basicTree("@spre1:e1")
		snapshot := fakeSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", tree)
		windows := mustWindows(t, target)
		writeFakeScenario(t, runtimeRoot, fakeScenario{
			PermissionsData: fakePermissions("granted"),
			WindowsCalls:    []json.RawMessage{windows, windows, mustWindows(t, changed)},
			Snapshots:       []json.RawMessage{snapshot},
		})
		observation, err := driver.Observe(context.Background(), fixtureTarget())
		if err != nil {
			t.Fatal(err)
		}
		_, err = driver.Act(context.Background(), computerAction{
			ObservationID: observation.ID, Kind: computerActionClick, Ref: "@spre1:e1",
		})
		var driverErr *computerDriverError
		if !errors.As(err, &driverErr) || driverErr.Code != computerErrorTargetChanged {
			t.Fatalf("expected target changed, got %v", err)
		}
		if len(callsFor(readFakeCalls(t, runtimeRoot), "click")) != 0 {
			t.Fatal("no action may be sent to a changed target")
		}
		if driver.latest != nil {
			t.Fatal("changed target must invalidate the observation")
		}
	})

	t.Run("stale observation and ref", func(t *testing.T) {
		runtimeRoot, stateRoot := newFakeRuntime(t)
		driver := newPreparedDriver(t, runtimeRoot, stateRoot)
		writeFakeScenario(t, runtimeRoot, basicScenario(t, "spre1", "@spre1:e1"))
		observation, err := driver.Observe(context.Background(), fixtureTarget())
		if err != nil {
			t.Fatal(err)
		}
		cases := []struct {
			name   string
			action computerAction
			code   string
		}{
			{"foreign ref", computerAction{ObservationID: observation.ID, Kind: computerActionClick, Ref: "@sother:e1"}, computerErrorStaleRef},
		}
		for _, item := range cases {
			t.Run(item.name, func(t *testing.T) {
				_, err := driver.Act(context.Background(), item.action)
				var driverErr *computerDriverError
				if !errors.As(err, &driverErr) || driverErr.Code != item.code {
					t.Fatalf("expected %s, got %v", item.code, err)
				}
			})
		}
		if len(callsFor(readFakeCalls(t, runtimeRoot), "click")) != 0 {
			t.Fatal("invalid input must never reach the action")
		}
	})

	t.Run("accessibility revoked before act", func(t *testing.T) {
		runtimeRoot, stateRoot := newFakeRuntime(t)
		driver := newPreparedDriver(t, runtimeRoot, stateRoot)
		scenario := basicScenario(t, "spre1", "@spre1:e1")
		writeFakeScenario(t, runtimeRoot, scenario)
		observation, err := driver.Observe(context.Background(), fixtureTarget())
		if err != nil {
			t.Fatal(err)
		}
		scenario.PermissionsData = fakePermissions("denied")
		writeFakeScenario(t, runtimeRoot, scenario)
		_, err = driver.Act(context.Background(), computerAction{
			ObservationID: observation.ID, Kind: computerActionClick, Ref: "@spre1:e1",
		})
		var driverErr *computerDriverError
		if !errors.As(err, &driverErr) || driverErr.Code != computerErrorAccessDenied {
			t.Fatalf("expected access denied, got %v", err)
		}
		if len(callsFor(readFakeCalls(t, runtimeRoot), "click")) != 0 {
			t.Fatal("no action may be sent without Accessibility")
		}
		if driver.latest != nil {
			t.Fatal("denied act must invalidate the observation")
		}
	})
}

func TestComputerDriverActionReportedOverlayBlocksWindowRefs(t *testing.T) {
	setup := func(t *testing.T, data json.RawMessage) (*computerDriver, string, computerObservation) {
		t.Helper()
		runtimeRoot, stateRoot := newFakeRuntime(t)
		driver := newPreparedDriver(t, runtimeRoot, stateRoot)
		preTree := fakeNode("window", "Fixture", "", nil, fakeNode("button", "Menu", "@spre1:e1", nil))
		postTree := fakeNode("window", "Fixture", "", nil, fakeNode("button", "Menu", "@spost1:e1", nil))
		writeFakeScenario(t, runtimeRoot, fakeScenario{
			PermissionsData: fakePermissions("granted"),
			Windows:         mustWindows(t, fixtureWindow()),
			Snapshots:       []json.RawMessage{fakeSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", preTree), fakeSnapshotData("spost1", "w-4242", "Fixture", "Fixture App", postTree)},
			ActionData:      map[string]json.RawMessage{"click": data},
		})
		observation, err := driver.Observe(context.Background(), fixtureTarget())
		if err != nil {
			t.Fatal(err)
		}
		return driver, runtimeRoot, observation
	}

	t.Run("overlay is place_changed and not actable", func(t *testing.T) {
		data := mustJSON(t, map[string]any{
			"action":      "click",
			"disposition": map[string]any{"delivery": "delivered_verified", "retry": "unsafe"},
			"surfaces":    []map[string]any{{"type": "sheet", "id": "w-9", "item_count": 0}},
		})
		driver, runtimeRoot, observation := setup(t, data)
		result, err := driver.Act(context.Background(), computerAction{
			ObservationID: observation.ID, Kind: computerActionClick, Ref: "@spre1:e1",
		})
		if err != nil {
			t.Fatal(err)
		}
		if result.Effect != computerEffectPlaceChanged || !slices.Equal(result.Surfaces, []string{"sheet"}) ||
			!result.Sent || result.Delivery != computerDeliveryVerified {
			t.Fatalf("unexpected overlay result: %+v", result)
		}
		if count := len(callsFor(readFakeCalls(t, runtimeRoot), "snapshot")); count != 1 {
			t.Fatalf("overlay must stop the window post-read; snapshots=%d", count)
		}
		if driver.latest != nil {
			t.Fatal("overlay must leave no actable observation")
		}
		_, err = driver.Act(context.Background(), computerAction{
			ObservationID: observation.ID, Kind: computerActionClick, Ref: "@spre1:e1",
		})
		var driverErr *computerDriverError
		if !errors.As(err, &driverErr) || driverErr.Code != computerErrorNoObservation {
			t.Fatalf("expected no observation after overlay, got %v", err)
		}
	})

}

func TestComputerDriverIdentityUnprovenIsReadOnly(t *testing.T) {
	runtimeRoot, parent := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, parent)
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Windows:         mustWindows(t, fixtureWindow()),
		Snapshots: []json.RawMessage{
			fakeUnprovenSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", basicTree("@spre1:e1")),
		},
	})
	observation, err := driver.Observe(context.Background(), fixtureTarget())
	if err != nil {
		t.Fatal(err)
	}
	if observation.Actable || observation.TreeQuality != computerTreeQualityUnusable || driver.latest != nil {
		t.Fatalf("identity_unproven must be read-only: %+v latest=%v", observation, driver.latest)
	}
	for _, element := range observation.Elements {
		if element.Ref != "" {
			t.Fatal("identity_unproven must not return refs")
		}
	}
	_, err = driver.Act(context.Background(), computerAction{
		ObservationID: observation.ID, Kind: computerActionClick, Ref: "@spre1:e1",
	})
	var driverErr *computerDriverError
	if !errors.As(err, &driverErr) || driverErr.Code != computerErrorNoObservation {
		t.Fatalf("expected no observation, got %v", err)
	}
	if len(callsFor(readFakeCalls(t, runtimeRoot), "click")) != 0 {
		t.Fatal("read-only observation must not authorize an action")
	}
}

func TestComputerDriverPostActionReplacementIsDiscarded(t *testing.T) {
	runtimeRoot, parent := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, parent)
	target := fixtureWindow()
	replacement := fakeWindow("w-4242", 9999, "inst-2", "Fixture", "Fixture App")
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		WindowsCalls:    []json.RawMessage{mustWindows(t, target), mustWindows(t, target), mustWindows(t, target), mustWindows(t, replacement)},
		Snapshots: []json.RawMessage{
			fakeSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", basicTree("@spre1:e1")),
			fakeSnapshotData("spost1", "w-4242", "Fixture", "Fixture App", basicTree("@spost1:e1")),
		},
	})
	observation, err := driver.Observe(context.Background(), fixtureTarget())
	if err != nil {
		t.Fatal(err)
	}
	result, err := driver.Act(context.Background(), computerAction{
		ObservationID: observation.ID, Kind: computerActionClick, Ref: "@spre1:e1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Effect != computerEffectPlaceChanged || driver.latest != nil {
		t.Fatalf("replacement must be discarded: %+v latest=%v", result, driver.latest)
	}
	if result.EffectError != computerErrorTargetChanged {
		t.Fatalf("expected target changed, got %q", result.EffectError)
	}
	if count := len(callsFor(readFakeCalls(t, runtimeRoot), "snapshot")); count != 1 {
		t.Fatalf("replacement must be rejected before a post snapshot; snapshots=%d", count)
	}
}

func TestComputerDriverTypedTextAlreadyPresentIsNotDone(t *testing.T) {
	runtimeRoot, parent := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, parent)
	text := "already here"
	preTree := fakeNode("window", "Fixture", "", nil,
		fakeNode("group", "", "", nil,
			fakeNode("textfield", "Target", "@spre1:e1", ""),
			fakeNode("textfield", "Other", "@spre1:e2", text)))
	postTree := fakeNode("window", "Fixture", "", nil,
		fakeNode("group", "", "", nil,
			fakeNode("textfield", "Target", "@spost1:e1", ""),
			fakeNode("textfield", "Other", "@spost1:e2", text)))
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Windows:         mustWindows(t, fixtureWindow()),
		Snapshots: []json.RawMessage{
			fakeSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", preTree),
			fakeSnapshotData("spost1", "w-4242", "Fixture", "Fixture App", postTree),
		},
	})
	observation, err := driver.Observe(context.Background(), fixtureTarget())
	if err != nil {
		t.Fatal(err)
	}
	var targetRef string
	for _, element := range observation.Elements {
		if element.Name == "Target" {
			targetRef = element.Ref
		}
	}
	if targetRef == "" {
		t.Fatal("target ref missing")
	}
	result, err := driver.Act(context.Background(), computerAction{
		ObservationID: observation.ID, Kind: computerActionType, Ref: targetRef, Text: text,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Effect == computerEffectDone {
		t.Fatalf("pre-existing text must not claim done: %+v", result)
	}
	if result.Effect != computerEffectNoEffect {
		t.Fatalf("expected no_effect, got %q", result.Effect)
	}
	if result.Delivery != computerDeliveryUnverified || result.Retry != computerRetryUnsafe {
		t.Fatalf("original disposition must be preserved: %+v", result)
	}
	if driver.latest != nil {
		t.Fatal("unverified type must not leave actable refs")
	}
	if count := len(callsFor(readFakeCalls(t, runtimeRoot), "snapshot")); count != 2 {
		t.Fatalf("expected one type readback, snapshots=%d", count)
	}
}

func TestComputerDriverTypedEffectRequiresCompleteUniqueEvidence(t *testing.T) {
	t.Run("identical twins", func(t *testing.T) {
		runtimeRoot, parent := newFakeRuntime(t)
		driver := newPreparedDriver(t, runtimeRoot, parent)
		text := "typed"
		preTree := fakeNode("window", "Fixture", "", nil,
			fakeNode("group", "", "", nil,
				fakeNode("textfield", "Input", "@spre1:e1", ""),
				fakeNode("textfield", "Input", "@spre1:e2", "")))
		postTree := fakeNode("window", "Fixture", "", nil,
			fakeNode("group", "", "", nil,
				fakeNode("textfield", "Input", "@spost1:e1", text)))
		writeFakeScenario(t, runtimeRoot, fakeScenario{
			PermissionsData: fakePermissions("granted"),
			Windows:         mustWindows(t, fixtureWindow()),
			Snapshots: []json.RawMessage{
				fakeSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", preTree),
				fakeSnapshotData("spost1", "w-4242", "Fixture", "Fixture App", postTree),
			},
		})
		observation, err := driver.Observe(context.Background(), fixtureTarget())
		if err != nil {
			t.Fatal(err)
		}
		result, err := driver.Act(context.Background(), computerAction{
			ObservationID: observation.ID, Kind: computerActionType, Ref: "@spre1:e1", Text: text,
		})
		if err != nil {
			t.Fatal(err)
		}
		if result.Effect == computerEffectDone {
			t.Fatalf("twin identity must not claim done: %+v", result)
		}
		if result.Effect != computerEffectSmallChange || driver.latest != nil {
			t.Fatalf("twin evidence must degrade conservatively: %+v latest=%v", result, driver.latest)
		}
	})

	t.Run("truncated readback", func(t *testing.T) {
		runtimeRoot, parent := newFakeRuntime(t)
		driver := newPreparedDriver(t, runtimeRoot, parent)
		text := "typed"
		preTree := fakeNode("window", "Fixture", "", nil,
			fakeNode("group", "", "", nil,
				fakeNode("textfield", "Input", "@spre1:e1", "")))
		postTree := fakeNode("window", "Fixture", "", nil,
			fakeNode("group", "", "", nil,
				fakeNode("textfield", "Input", "@spost1:e1", text)))
		writeFakeScenario(t, runtimeRoot, fakeScenario{
			PermissionsData: fakePermissions("granted"),
			Windows:         mustWindows(t, fixtureWindow()),
			Snapshots: []json.RawMessage{
				fakeSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", preTree),
				fakeIncompleteSnapshotData("spost1", "w-4242", "Fixture", "Fixture App", postTree),
			},
		})
		observation, err := driver.Observe(context.Background(), fixtureTarget())
		if err != nil {
			t.Fatal(err)
		}
		result, err := driver.Act(context.Background(), computerAction{
			ObservationID: observation.ID, Kind: computerActionType, Ref: "@spre1:e1", Text: text,
		})
		if err != nil {
			t.Fatal(err)
		}
		if result.Effect == computerEffectDone {
			t.Fatalf("truncated evidence must not claim done: %+v", result)
		}
		if result.Effect != computerEffectSmallChange || driver.latest != nil {
			t.Fatalf("truncated evidence must degrade conservatively: %+v latest=%v", result, driver.latest)
		}
	})
}

func TestComputerDriverPostActionDispositionBoundaries(t *testing.T) {
	t.Run("verified success performs transient readback", func(t *testing.T) {
		runtimeRoot, parent := newFakeRuntime(t)
		driver := newPreparedDriver(t, runtimeRoot, parent)
		preTree := basicTree("@spre1:e1")
		postTree := fakeNode("window", "Fixture", "", nil, fakeNode("button", "Applied", "@spost1:e1", nil))
		data := mustJSON(t, map[string]any{
			"action":      "click",
			"disposition": map[string]any{"delivery": "delivered_verified", "retry": "unsafe"},
		})
		writeFakeScenario(t, runtimeRoot, fakeScenario{
			PermissionsData: fakePermissions("granted"),
			Windows:         mustWindows(t, fixtureWindow()),
			Snapshots: []json.RawMessage{
				fakeSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", preTree),
				fakeSnapshotData("spost1", "w-4242", "Fixture", "Fixture App", postTree),
			},
			ActionData: map[string]json.RawMessage{"click": data},
		})
		observation, err := driver.Observe(context.Background(), fixtureTarget())
		if err != nil {
			t.Fatal(err)
		}
		result, err := driver.Act(context.Background(), computerAction{
			ObservationID: observation.ID, Kind: computerActionClick, Ref: "@spre1:e1",
		})
		if err != nil {
			t.Fatal(err)
		}
		if !result.Accepted || result.Delivery != computerDeliveryVerified ||
			result.Effect != computerEffectSmallChange || driver.latest != nil {
			t.Fatalf("verified success must perform one transient readback: %+v latest=%v", result, driver.latest)
		}
		if count := len(callsFor(readFakeCalls(t, runtimeRoot), "snapshot")); count != 2 {
			t.Fatalf("expected one verified readback, snapshots=%d", count)
		}
		_, err = driver.Act(context.Background(), computerAction{
			ObservationID: observation.ID, Kind: computerActionClick, Ref: "@spre1:e1",
		})
		var driverErr *computerDriverError
		if !errors.As(err, &driverErr) || driverErr.Code != computerErrorNoObservation {
			t.Fatalf("verified readback must require a fresh observe: %v", err)
		}
	})

	t.Run("non-delivered exposes no refs", func(t *testing.T) {
		runtimeRoot, parent := newFakeRuntime(t)
		driver := newPreparedDriver(t, runtimeRoot, parent)
		data := mustJSON(t, map[string]any{
			"action":      "click",
			"disposition": map[string]any{"delivery": "not_delivered", "retry": "safe"},
		})
		writeFakeScenario(t, runtimeRoot, fakeScenario{
			PermissionsData: fakePermissions("granted"),
			Windows:         mustWindows(t, fixtureWindow()),
			Snapshots:       []json.RawMessage{fakeSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", basicTree("@spre1:e1"))},
			ActionData:      map[string]json.RawMessage{"click": data},
		})
		observation, err := driver.Observe(context.Background(), fixtureTarget())
		if err != nil {
			t.Fatal(err)
		}
		result, err := driver.Act(context.Background(), computerAction{
			ObservationID: observation.ID, Kind: computerActionClick, Ref: "@spre1:e1",
		})
		if err != nil {
			t.Fatal(err)
		}
		if !result.Accepted || result.Delivery != computerDeliveryNotDelivered || result.Retry != computerRetrySafe ||
			driver.latest != nil {
			t.Fatalf("non-delivered must not expose refs: %+v latest=%v", result, driver.latest)
		}
		if count := len(callsFor(readFakeCalls(t, runtimeRoot), "snapshot")); count != 1 {
			t.Fatalf("non-delivered must not read back; snapshots=%d", count)
		}
	})
}

func TestComputerDriverRejectsInvalidSuccessReport(t *testing.T) {
	cases := []struct {
		name string
		data map[string]any
	}{
		{"wrong action name", map[string]any{
			"action":      "type",
			"disposition": map[string]any{"delivery": "delivered_unverified", "retry": "unsafe"},
		}},
		{"impossible success disposition", map[string]any{
			"action":      "click",
			"disposition": map[string]any{"delivery": "delivery_uncertain", "retry": "unsafe"},
		}},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			runtimeRoot, parent := newFakeRuntime(t)
			driver := newPreparedDriver(t, runtimeRoot, parent)
			writeFakeScenario(t, runtimeRoot, fakeScenario{
				PermissionsData: fakePermissions("granted"),
				Windows:         mustWindows(t, fixtureWindow()),
				Snapshots:       []json.RawMessage{fakeSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", basicTree("@spre1:e1"))},
				ActionData:      map[string]json.RawMessage{"click": mustJSON(t, item.data)},
			})
			observation, err := driver.Observe(context.Background(), fixtureTarget())
			if err != nil {
				t.Fatal(err)
			}
			result, err := driver.Act(context.Background(), computerAction{
				ObservationID: observation.ID, Kind: computerActionClick, Ref: "@spre1:e1",
			})
			var driverErr *computerDriverError
			if !errors.As(err, &driverErr) || driverErr.Code != computerErrorProtocol || !driverErr.Sent {
				t.Fatalf("expected sent protocol error, got %v", err)
			}
			if result.Accepted || driver.latest != nil {
				t.Fatalf("invalid success must not expose refs: %+v latest=%v", result, driver.latest)
			}
			if count := len(callsFor(readFakeCalls(t, runtimeRoot), "snapshot")); count != 1 {
				t.Fatalf("invalid success must not read back; snapshots=%d", count)
			}
		})
	}
}

func TestComputerDriverActionFailuresAreNeverRetried(t *testing.T) {
	setup := func(t *testing.T, errorJSON json.RawMessage) (*computerDriver, string, computerObservation) {
		t.Helper()
		runtimeRoot, stateRoot := newFakeRuntime(t)
		driver := newPreparedDriver(t, runtimeRoot, stateRoot)
		preTree := basicTree("@spre1:e1")
		postTree := fakeNode("window", "Fixture", "", nil, fakeNode("button", "Apply", "@spost1:e1", nil))
		writeFakeScenario(t, runtimeRoot, fakeScenario{
			PermissionsData: fakePermissions("granted"),
			Windows:         mustWindows(t, fixtureWindow()),
			Snapshots:       []json.RawMessage{fakeSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", preTree), fakeSnapshotData("spost1", "w-4242", "Fixture", "Fixture App", postTree)},
			ActionError:     map[string]json.RawMessage{"click": errorJSON},
		})
		observation, err := driver.Observe(context.Background(), fixtureTarget())
		if err != nil {
			t.Fatal(err)
		}
		return driver, runtimeRoot, observation
	}

	t.Run("uncertain delivery", func(t *testing.T) {
		errorJSON := mustJSON(t, map[string]any{
			"code": "TIMEOUT", "message": "SECRET",
			"disposition": map[string]any{"delivery": "delivery_uncertain", "retry": "unsafe"},
		})
		driver, runtimeRoot, observation := setup(t, errorJSON)
		result, err := driver.Act(context.Background(), computerAction{
			ObservationID: observation.ID, Kind: computerActionClick, Ref: "@spre1:e1",
		})
		var driverErr *computerDriverError
		if !errors.As(err, &driverErr) || driverErr.Code != computerErrorCommandFailed {
			t.Fatalf("unexpected error: %v", err)
		}
		if !result.Sent || result.Delivery != computerDeliveryUncertain || result.Retry != computerRetryUnsafe {
			t.Fatalf("unexpected result: %+v", result)
		}
		if driver.latest != nil {
			t.Fatal("uncertain delivery must not expose new actable refs")
		}
		if count := len(callsFor(readFakeCalls(t, runtimeRoot), "click")); count != 1 {
			t.Fatalf("uncertain action must not be retried; got %d clicks", count)
		}
		if count := len(callsFor(readFakeCalls(t, runtimeRoot), "snapshot")); count != 1 {
			t.Fatalf("uncertain delivery must not post-observe; snapshots=%d", count)
		}
	})

	t.Run("missing disposition is a protocol error", func(t *testing.T) {
		errorJSON := mustJSON(t, map[string]any{"code": "ACTION_FAILED"})
		driver, runtimeRoot, observation := setup(t, errorJSON)
		result, err := driver.Act(context.Background(), computerAction{
			ObservationID: observation.ID, Kind: computerActionClick, Ref: "@spre1:e1",
		})
		var driverErr *computerDriverError
		if !errors.As(err, &driverErr) || driverErr.Code != computerErrorProtocol {
			t.Fatalf("expected protocol error, got %v", err)
		}
		if !result.Sent || result.Delivery != computerDeliveryUnknown || result.Retry != computerRetryUnknown {
			t.Fatalf("unexpected result: %+v", result)
		}
		var protocolErr *computerDriverError
		if !errors.As(err, &protocolErr) || !protocolErr.Sent {
			t.Fatalf("protocol error must be marked sent: %+v", protocolErr)
		}
		if driver.latest != nil {
			t.Fatal("malformed delivery must not expose new actable refs")
		}
		if count := len(callsFor(readFakeCalls(t, runtimeRoot), "click")); count != 1 {
			t.Fatalf("malformed action result must not be retried; got %d clicks", count)
		}
		if count := len(callsFor(readFakeCalls(t, runtimeRoot), "snapshot")); count != 1 {
			t.Fatalf("malformed delivery must not post-observe; snapshots=%d", count)
		}
	})
}

func TestComputerDriverCancellationKillsTheActionGroupWithoutRetry(t *testing.T) {
	runtimeRoot, stateRoot := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, stateRoot)
	scenario := basicScenario(t, "spre1", "@spre1:e1")
	scenario.DelayMS = 30000
	scenario.DelayCommand = "click"
	writeFakeScenario(t, runtimeRoot, scenario)
	observation, err := driver.Observe(context.Background(), fixtureTarget())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	type outcome struct {
		result computerActionResult
		err    error
	}
	finished := make(chan outcome, 1)
	go func() {
		result, err := driver.Act(ctx, computerAction{
			ObservationID: observation.ID, Kind: computerActionClick, Ref: "@spre1:e1",
		})
		finished <- outcome{result: result, err: err}
	}()
	waitForFakeCommand(t, runtimeRoot, "click")
	cancel()
	var act outcome
	select {
	case act = <-finished:
	case <-time.After(10 * time.Second):
		t.Fatal("cancelled action did not return")
	}
	if !errors.Is(act.err, context.Canceled) {
		t.Fatalf("expected context canceled, got %v", act.err)
	}
	if !act.result.Sent || act.result.Delivery != computerDeliveryUnknown || act.result.Retry != computerRetryUnknown {
		t.Fatalf("unexpected cancellation result: %+v", act.result)
	}
	if driver.latest != nil {
		t.Fatal("cancellation must not expose new actable refs")
	}
	var canceledErr *computerDriverError
	if !errors.As(act.err, &canceledErr) || !canceledErr.Sent ||
		canceledErr.Delivery != computerDeliveryUnknown || canceledErr.Retry != computerRetryUnknown {
		t.Fatalf("cancellation error must be marked sent/unknown: %+v", canceledErr)
	}
	clickCalls := callsFor(readFakeCalls(t, runtimeRoot), "click")
	if len(clickCalls) != 1 {
		t.Fatalf("expected exactly one cancelled click, got %d", len(clickCalls))
	}
	if len(callsFor(readFakeCalls(t, runtimeRoot), "type")) != 0 {
		t.Fatal("cancellation must not substitute another action")
	}
	pid := clickCalls[0].PID
	deadline := time.Now().Add(5 * time.Second)
	for {
		err := syscall.Kill(pid, 0)
		if errors.Is(err, syscall.ESRCH) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("cancelled action process %d still exists", pid)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func waitForFakeCommand(t *testing.T, runtimeRoot, command string) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(filepath.Join(runtimeRoot, "bin", fakeCallsFile))
		if err == nil {
			for _, line := range bytes.Split(data, []byte{'\n'}) {
				if len(line) == 0 {
					continue
				}
				var call fakeCall
				if json.Unmarshal(line, &call) == nil && len(call.Argv) >= 3 && call.Argv[2] == command {
					return
				}
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("fake never received %s", command)
}

func TestComputerDriverRejectsMalformedAndOversizedOutput(t *testing.T) {
	t.Run("oversized output", func(t *testing.T) {
		runtimeRoot, stateRoot := newFakeRuntime(t)
		driver := newPreparedDriver(t, runtimeRoot, stateRoot)
		writeFakeScenario(t, runtimeRoot, fakeScenario{
			RawStdout: strings.Repeat("A", computerMaxStdoutBytes+1024),
		})
		_, err := driver.Status(context.Background())
		var driverErr *computerDriverError
		if !errors.As(err, &driverErr) || driverErr.Code != computerErrorOutputLimit {
			t.Fatalf("expected output limit, got %v", err)
		}
		if strings.Contains(err.Error(), "AAAA") {
			t.Fatal("raw output leaked into the driver error")
		}
	})
}

func TestComputerDriverSandboxWrapperIsFixed(t *testing.T) {
	if computerSandboxExec != "/usr/bin/sandbox-exec" {
		t.Fatalf("unexpected sandbox binary: %q", computerSandboxExec)
	}
	got := sandboxExecArgs("/runtime/bin/agent-desktop", []string{"--session", "s", "status"})
	want := []string{
		"-p", "(version 1) (allow default) (deny signal)",
		"--", "/runtime/bin/agent-desktop", "--session", "s", "status",
	}
	if !slices.Equal(got, want) {
		t.Fatalf("unexpected sandbox args\n got: %q\nwant: %q", got, want)
	}
}

func TestComputerDriverRuntimeProofGate(t *testing.T) {
	t.Run("missing proof", func(t *testing.T) {
		runtimeRoot, parent := newFakeRuntime(t)
		_, err := newComputerDriverDarwin(runtimeRoot, parent, computerRuntimeProof{})
		assertDriverCode(t, err, computerErrorRuntimeProofMissing)
	})
	t.Run("signed proof is unwired", func(t *testing.T) {
		runtimeRoot, parent := newFakeRuntime(t)
		_, err := newComputerDriverDarwin(runtimeRoot, parent, computerRuntimeProof{Kind: computerRuntimeProofSigned})
		assertDriverCode(t, err, computerErrorRuntimeProofUnwired)
	})
}

func TestComputerDriverPreparedRuntimeTamper(t *testing.T) {
	runtimeRoot, parent := newFakeRuntime(t)
	file, err := os.OpenFile(filepath.Join(runtimeRoot, "bin", "agent-desktop"), os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte("tamper")); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	_, err = newComputerDriverDarwin(runtimeRoot, parent, preparedProof())
	assertDriverCode(t, err, computerErrorRuntimeUntrusted)
}

func assertDriverCode(t *testing.T, err error, code string) {
	t.Helper()
	var driverErr *computerDriverError
	if !errors.As(err, &driverErr) || driverErr.Code != code {
		t.Fatalf("expected %s, got %v", code, err)
	}
}

func TestComputerDriverClosesOnlyFreshStateChild(t *testing.T) {
	runtimeRoot, parent := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, parent)
	child := driver.stateRoot
	if !strings.HasPrefix(filepath.Base(child), "computer-use-") {
		t.Fatalf("state root is not a fresh child: %q", child)
	}
	sentinel := filepath.Join(parent, "host-state")
	if err := os.WriteFile(sentinel, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(child, "session-marker"), []byte("remove"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := driver.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(child); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("created state child must be removed, got %v", err)
	}
	if _, err := os.Lstat(parent); err != nil {
		t.Fatalf("host parent must remain: %v", err)
	}
	if data, err := os.ReadFile(sentinel); err != nil || string(data) != "keep" {
		t.Fatalf("driver removed unrelated host state: %q %v", data, err)
	}
	if _, err := os.Lstat(runtimeRoot); err != nil {
		t.Fatalf("runtime must remain: %v", err)
	}
	if err := driver.Close(); err != nil {
		t.Fatalf("second Close must be idempotent: %v", err)
	}
	assertDriverCode(t, func() error {
		_, err := driver.Status(context.Background())
		return err
	}(), computerErrorClosed)
}

func TestComputerDriverCloseRefusesReplacedStateDirectory(t *testing.T) {
	runtimeRoot, parent := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, parent)
	created := driver.stateRoot
	moved := created + ".moved"
	if err := os.Rename(created, moved); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(created, 0o700); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(created, "keep")
	if err := os.WriteFile(sentinel, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	assertDriverCode(t, driver.Close(), computerErrorStateUnavailable)
	if data, err := os.ReadFile(sentinel); err != nil || string(data) != "keep" {
		t.Fatalf("replacement directory was modified: %q %v", data, err)
	}
	if _, err := os.Lstat(moved); err != nil {
		t.Fatalf("original created directory was removed: %v", err)
	}
}
