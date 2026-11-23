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
	StatusData      json.RawMessage   `json:"status_data,omitempty"`
	PermissionsData json.RawMessage   `json:"permissions_data,omitempty"`
	Apps            json.RawMessage   `json:"apps,omitempty"`
	Windows         json.RawMessage   `json:"windows,omitempty"`
	WindowsCalls    []json.RawMessage `json:"windows_calls,omitempty"`
	Snapshots       []json.RawMessage `json:"snapshots,omitempty"`
	// InteractiveSnapshots optionally emulates v1.3.1's filtered projection
	// for a fixture whose static labels must be absent with --interactive-only.
	InteractiveSnapshots  []json.RawMessage `json:"interactive_snapshots,omitempty"`
	OversizeFullSnapshots []int             `json:"oversize_full_snapshots,omitempty"`
	// Refmaps overrides the saved refmap for one snapshot id; RefmapSkips
	// suppresses it. Otherwise the fixture writes the exact saved evidence an
	// unmodified v1.3.1 capture would write. Values are raw text, not
	// json.RawMessage, so a test can present genuinely malformed evidence.
	Refmaps      map[string]string          `json:"refmaps,omitempty"`
	RefmapSkips  []string                   `json:"refmap_skips,omitempty"`
	ActionData   map[string]json.RawMessage `json:"action_data,omitempty"`
	ActionError  map[string]json.RawMessage `json:"action_error,omitempty"`
	DelayMS      int                        `json:"delay_ms,omitempty"`
	DelayCommand string                     `json:"delay_command,omitempty"`
	RawStdout    string                     `json:"raw_stdout,omitempty"`
	ExitCode     int                        `json:"exit_code,omitempty"`
}

const fakeFixtureBundleID = "com.example.fixture"

// defaultFakeApps keeps older fixtures compatible: their windows all use the
// fixture pid/process_instance, so a scoped list-apps call can still prove the
// same pinned identity without every test restating the app record.
var defaultFakeApps = json.RawMessage(`{"apps":[{"name":"Fixture App","pid":4242,"bundle_id":"com.example.fixture","process_instance":"inst-1"}]}`)

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
	command, args := fakeCommand(os.Args[1:])
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
	case "list-apps":
		data := scenario.Apps
		if len(data) == 0 {
			data = defaultFakeApps
		}
		return fakeWriteSuccess("list-apps", data)
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
		index := fakeCounter(base, fakeSnapshotCounter)
		fakeAdvanceCounter(base, fakeSnapshotCounter)
		interactiveOnly := slices.Contains(args, "--interactive-only")
		if !interactiveOnly && slices.Contains(scenario.OversizeFullSnapshots, index) {
			_, _ = os.Stdout.WriteString(strings.Repeat("x", computerMaxStdoutBytes+1))
			return 0
		}
		snapshots := scenario.Snapshots
		if len(scenario.InteractiveSnapshots) != 0 && interactiveOnly {
			snapshots = scenario.InteractiveSnapshots
		}
		if len(snapshots) == 0 {
			return fakeWriteError("snapshot", "INTERNAL")
		}
		if index >= len(snapshots) {
			index = len(snapshots) - 1
		}
		// v1.3.1 saves the session refmap before it emits the snapshot envelope
		// (snapshot/mod.rs:28-33,174-186); the driver then proves the capture
		// source from that exact file.
		if !fakePersistRefmap(scenario, snapshots[index]) {
			return 2
		}
		return fakeWriteSuccess("snapshot", snapshots[index])
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
	case "wait":
		if raw, ok := scenario.ActionError["wait"]; ok {
			return fakeWriteRawError("wait", raw)
		}
		if data, ok := scenario.ActionData["wait"]; ok {
			return fakeWriteSuccess("wait", data)
		}
		// A minimal v1.3.1 element-success envelope. The fake echoes only the
		// element ref and predicate it was given; observed content is empty.
		ref, _ := fakeFlagValue(os.Args[1:], "--element")
		predicate, _ := fakeFlagValue(os.Args[1:], "--predicate")
		data, _ := json.Marshal(map[string]any{
			"found": true, "ref": ref, "predicate": predicate,
			"observed": map[string]any{"actionable": true}, "elapsed_ms": 0,
		})
		return fakeWriteSuccess("wait", data)
	default:
		return fakeWriteError(command, "INVALID_ARGS")
	}
}

func fakeFlagValue(args []string, name string) (string, bool) {
	for index := 0; index+1 < len(args); index++ {
		if args[index] == name {
			return args[index+1], true
		}
	}
	return "", false
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
	driver, err := newComputerDriverDarwin(context.Background(), runtimeRoot, stateParent, preparedProof())
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

func assertNoWaitSpecificArgs(t *testing.T, calls []fakeCall) {
	t.Helper()
	forbidden := []string{
		"--app", "--app=", "--window", "--window-id", "--text", "--value",
		"--action", "--count", "--event", "--menu", "--menu-closed",
		"--notification", "--timeout-ms", "--force", "--headed", "--trace",
		"--screenshot", "--debug", "--surface", "--request", "--guide",
		"--arg", "--env", "--cwd", "--cdp",
	}
	for _, call := range calls {
		if len(call.Argv) < 3 || call.Argv[2] != "wait" {
			continue
		}
		for _, arg := range call.Argv {
			for _, forbiddenArg := range forbidden {
				if arg == forbiddenArg || strings.HasPrefix(arg, forbiddenArg+"=") {
					t.Fatalf("wait must not carry %q in %q", forbiddenArg, call.Argv)
				}
			}
		}
	}
}

func assertWaitExactArgs(t *testing.T, call fakeCall, sessionID, ref string, timeoutMS int) {
	t.Helper()
	assertExactArgs(t, call, sessionID, "wait",
		"--element", ref, "--predicate", "actionable", "--timeout", strconv.Itoa(timeoutMS))
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
	return computerTarget{
		BundleID:        fakeFixtureBundleID,
		WindowID:        "w-4242",
		PID:             4242,
		ProcessInstance: "inst-1",
	}
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

func fakeApp(name string, pid int, bundleID, instance string) map[string]any {
	app := map[string]any{"name": name, "pid": pid}
	if bundleID != "" {
		app["bundle_id"] = bundleID
	}
	if instance != "" {
		app["process_instance"] = instance
	}
	return app
}

func fakeApps(t *testing.T, apps ...map[string]any) json.RawMessage {
	t.Helper()
	return mustJSON(t, map[string]any{"apps": apps})
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
	refCount := 0
	walkFakeRefs(tree, func(string) { refCount++ })
	data, _ := json.Marshal(map[string]any{
		"app": app, "snapshot_id": snapshotID, "ref_count": refCount,
		"complete": true, "tree": tree,
		"window": map[string]any{"id": windowID, "title": title},
	})
	return data
}

// fakePersistRefmap writes the saved evidence an unmodified v1.3.1 window
// capture leaves at
// <AGENT_DESKTOP_HOME>/sessions/<session>/snapshots/<id>/refmap.json
// (refs/refs_store.rs:31-37,220-229). Each entry carries the identity of the
// window that supplied it, exactly like RefEntry's flattened
// pid/process_instance/source_window_id fields (refs/ref_alloc.rs:22-56). A
// snapshot id in Refmaps is written verbatim so tests can present malformed or
// successor evidence; RefmapSkips reproduces a missing file.
func fakePersistRefmap(scenario fakeScenario, raw json.RawMessage) bool {
	var snapshot struct {
		SnapshotID string `json:"snapshot_id"`
		Window     *struct {
			ID string `json:"id"`
		} `json:"window"`
		Tree map[string]any `json:"tree"`
	}
	if json.Unmarshal(raw, &snapshot) != nil || snapshot.SnapshotID == "" || snapshot.Window == nil {
		return false
	}
	for _, skipped := range scenario.RefmapSkips {
		if skipped == snapshot.SnapshotID {
			return true
		}
	}
	home := os.Getenv("AGENT_DESKTOP_HOME")
	session := ""
	for index := 0; index+1 < len(os.Args); index++ {
		if os.Args[index] == "--session" {
			session = os.Args[index+1]
		}
	}
	if home == "" || session == "" {
		return false
	}
	payload, overridden := scenario.Refmaps[snapshot.SnapshotID]
	if !overridden {
		pid, instance, found := fakeWindowIdentity(scenario, snapshot.Window.ID)
		if !found {
			return false
		}
		inner := make(map[string]any)
		counter := 0
		walkFakeRefs(snapshot.Tree, func(ref string) {
			local := ref
			if prefix := "@" + snapshot.SnapshotID + ":"; strings.HasPrefix(ref, prefix) {
				local = "@" + strings.TrimPrefix(ref, prefix)
			}
			inner[local] = map[string]any{
				"pid": pid, "process_instance": instance, "source_window_id": snapshot.Window.ID,
			}
			if parsed, err := strconv.Atoi(strings.TrimPrefix(local, "@e")); err == nil && parsed > counter {
				counter = parsed
			}
		})
		encoded, _ := json.Marshal(map[string]any{"inner": inner, "counter": counter})
		payload = string(encoded)
	}
	directory := filepath.Join(home, "sessions", session, "snapshots", snapshot.SnapshotID)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return false
	}
	return os.WriteFile(filepath.Join(directory, "refmap.json"), []byte(payload), 0o600) == nil
}

// fakeWindowIdentity finds the pinned identity the scenario advertises for a
// snapshot's window, preferring the single Windows inventory.
func fakeWindowIdentity(scenario fakeScenario, windowID string) (int, string, bool) {
	raws := make([]json.RawMessage, 0, 1+len(scenario.WindowsCalls))
	if len(scenario.Windows) > 0 {
		raws = append(raws, scenario.Windows)
	}
	raws = append(raws, scenario.WindowsCalls...)
	for _, raw := range raws {
		var windows []struct {
			ID              string  `json:"id"`
			PID             int     `json:"pid"`
			ProcessInstance *string `json:"process_instance"`
		}
		if json.Unmarshal(raw, &windows) != nil {
			continue
		}
		for _, window := range windows {
			if window.ID == windowID && window.PID > 0 &&
				window.ProcessInstance != nil && *window.ProcessInstance != "" {
				return window.PID, *window.ProcessInstance, true
			}
		}
	}
	return 0, "", false
}

func walkFakeRefs(node map[string]any, visit func(string)) {
	if node == nil {
		return
	}
	if ref, ok := node["ref_id"].(string); ok && ref != "" {
		visit(ref)
	}
	switch children := node["children"].(type) {
	case []map[string]any:
		for _, child := range children {
			walkFakeRefs(child, visit)
		}
	case []any:
		for _, raw := range children {
			if child, ok := raw.(map[string]any); ok {
				walkFakeRefs(child, visit)
			}
		}
	}
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
	if len(calls) != 5 {
		t.Fatalf("expected list-apps, list-windows, snapshot, list-apps, list-windows; got %d", len(calls))
	}
	assertExactArgs(t, calls[0], driver.sessionID, "list-apps", "--app="+fakeFixtureBundleID, "--timeout-ms=5000")
	assertExactArgs(t, calls[1], driver.sessionID, "list-windows", "--app="+fakeFixtureBundleID, "--timeout-ms=5000")
	assertExactArgs(t, calls[2], driver.sessionID, "snapshot",
		"--app="+fakeFixtureBundleID, "--window-id=w-4242", "--compact",
		"--max-depth=10", "--timeout-ms=5000")
	assertExactArgs(t, calls[3], driver.sessionID, "list-apps", "--app="+fakeFixtureBundleID, "--timeout-ms=5000")
	assertExactArgs(t, calls[4], driver.sessionID, "list-windows", "--app="+fakeFixtureBundleID, "--timeout-ms=5000")
	assertNoForbiddenArgs(t, calls)
}

func TestComputerDriverInventoryJoinsExactPinnedIdentity(t *testing.T) {
	runtimeRoot, stateRoot := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, stateRoot)

	inaccessible := fakeWindow("w-inaccessible", 4242, "inst-1", "Inaccessible", "Fixture App")
	inaccessible["accessible"] = false
	hidden := fakeWindow("w-hidden", 4242, "inst-1", "Hidden", "Fixture App")
	hidden["visible"] = false
	bothFalse := fakeWindow("w-both-false", 4242, "inst-1", "Both false", "Fixture App")
	bothFalse["visible"] = false
	bothFalse["minimized"] = false
	visibleNotMinimized := fakeWindow("w-visible", 4242, "inst-1", "Visible", "Fixture App")
	visibleNotMinimized["minimized"] = false
	longTitle := strings.Repeat("T", computerMaxNameBytes+20)
	longApp := strings.Repeat("A", computerMaxAppBytes+20)
	minimized := fakeWindow("w-minimized", 4242, "inst-1", longTitle, longApp)
	minimized["visible"] = false
	minimized["minimized"] = true
	windows := mustWindows(t,
		fakeWindow("w-1", 4242, "inst-1", "Fixture", "Fixture App"),
		visibleNotMinimized,
		inaccessible,
		hidden,
		bothFalse,
		minimized,
		fakeWindow("w-other", 777, "inst-7", "Other", "Other App"),
		fakeWindow("w-no-bundle", 888, "inst-8", "No bundle", "No Bundle"),
		fakeWindow("w-no-instance", 999, "inst-9", "No instance", "No Instance"),
		fakeWindow("w-unknown", 1234, "inst-x", "Unknown", "Unknown"),
	)
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Apps: fakeApps(t,
			fakeApp("Fixture App", 4242, fakeFixtureBundleID, "inst-1"),
			fakeApp("Other App", 777, "com.example.other", "inst-7"),
			fakeApp("No Bundle", 888, "", "inst-8"),
			fakeApp("No Instance", 999, "com.example.noinstance", ""),
		),
		Windows: windows,
	})

	inventory, err := driver.Inventory(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !inventory.Complete || inventory.Truncated {
		t.Fatalf("unexpected inventory flags: %+v", inventory)
	}
	if len(inventory.Candidates) != 4 {
		t.Fatalf("expected four proven accessible windows, got %d: %+v", len(inventory.Candidates), inventory.Candidates)
	}
	first := inventory.Candidates[0]
	if first.BundleID != fakeFixtureBundleID || first.WindowID != "w-1" ||
		first.PID != 4242 || first.ProcessInstance != "inst-1" ||
		first.AppName != "Fixture App" || first.Title != "Fixture" {
		t.Fatalf("unexpected first candidate: %+v", first)
	}
	if second := inventory.Candidates[1]; second.WindowID != "w-visible" {
		t.Fatalf("explicit visible=true must be admitted despite minimized=false: %+v", second)
	}
	if third := inventory.Candidates[2]; third.WindowID != "w-minimized" ||
		len(third.Title) != computerMaxNameBytes || len(third.AppName) != computerMaxAppBytes {
		t.Fatalf("minimized candidate or display bounds are wrong: %+v", third)
	}
	if fourth := inventory.Candidates[3]; fourth.WindowID != "w-other" ||
		fourth.BundleID != "com.example.other" || fourth.PID != 777 || fourth.ProcessInstance != "inst-7" {
		t.Fatalf("unexpected fourth candidate: %+v", fourth)
	}

	calls := readFakeCalls(t, runtimeRoot)
	if len(calls) != 2 {
		t.Fatalf("expected one list-apps and one list-windows, got %d", len(calls))
	}
	assertExactArgs(t, calls[0], driver.sessionID, "list-apps", "--timeout-ms=5000")
	assertExactArgs(t, calls[1], driver.sessionID, "list-windows", "--timeout-ms=5000")
	assertNoForbiddenArgs(t, calls)
}

func TestComputerDriverInventoryReportsIncompleteAppInventory(t *testing.T) {
	runtimeRoot, stateRoot := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, stateRoot)
	apps := map[string]any{
		"apps":     []any{fakeApp("Fixture App", 4242, fakeFixtureBundleID, "inst-1")},
		"complete": false,
		"skipped":  []any{map[string]any{"reason": "fixture"}},
	}
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Apps:            mustJSON(t, apps),
		Windows:         mustWindows(t, fixtureWindow()),
	})
	inventory, err := driver.Inventory(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if inventory.Complete {
		t.Fatal("a skipped app record must report an incomplete inventory")
	}
	if len(inventory.Candidates) != 1 || inventory.Candidates[0].WindowID != "w-4242" {
		t.Fatalf("proven candidates must survive an incomplete inventory: %+v", inventory)
	}
}

func TestComputerDriverInventoryRejectsAmbiguousProcessIdentity(t *testing.T) {
	t.Run("one pid with two launch instances", func(t *testing.T) {
		runtimeRoot, stateRoot := newFakeRuntime(t)
		driver := newPreparedDriver(t, runtimeRoot, stateRoot)
		writeFakeScenario(t, runtimeRoot, fakeScenario{
			PermissionsData: fakePermissions("granted"),
			Apps: fakeApps(t,
				fakeApp("Fixture App", 4242, fakeFixtureBundleID, "inst-1"),
				fakeApp("Fixture App", 4242, fakeFixtureBundleID, "inst-2"),
			),
			Windows: mustWindows(t, fixtureWindow()),
		})
		_, err := driver.Inventory(context.Background())
		assertDriverCode(t, err, computerErrorProtocol)
		if len(callsFor(readFakeCalls(t, runtimeRoot), "list-windows")) != 0 {
			t.Fatal("ambiguous app identity must fail before windows are read")
		}
	})

	t.Run("one process identity with two bundles", func(t *testing.T) {
		runtimeRoot, stateRoot := newFakeRuntime(t)
		driver := newPreparedDriver(t, runtimeRoot, stateRoot)
		writeFakeScenario(t, runtimeRoot, fakeScenario{
			PermissionsData: fakePermissions("granted"),
			Apps: fakeApps(t,
				fakeApp("Fixture App", 4242, fakeFixtureBundleID, "inst-1"),
				fakeApp("Fixture App", 4242, "com.example.other", "inst-1"),
			),
			Windows: mustWindows(t, fixtureWindow()),
		})
		_, err := driver.Inventory(context.Background())
		assertDriverCode(t, err, computerErrorProtocol)
	})

	t.Run("duplicate window id", func(t *testing.T) {
		runtimeRoot, stateRoot := newFakeRuntime(t)
		driver := newPreparedDriver(t, runtimeRoot, stateRoot)
		writeFakeScenario(t, runtimeRoot, fakeScenario{
			PermissionsData: fakePermissions("granted"),
			Apps: fakeApps(t,
				fakeApp("Fixture App", 4242, fakeFixtureBundleID, "inst-1"),
				fakeApp("Other App", 777, "com.example.other", "inst-7"),
			),
			Windows: mustWindows(t,
				fakeWindow("w-dup", 4242, "inst-1", "Fixture", "Fixture App"),
				fakeWindow("w-dup", 777, "inst-7", "Other", "Other App"),
			),
		})
		_, err := driver.Inventory(context.Background())
		assertDriverCode(t, err, computerErrorProtocol)
	})
}

func TestComputerDriverFirstObserveRejectsSuccessorWindow(t *testing.T) {
	runtimeRoot, stateRoot := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, stateRoot)
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Windows:         mustWindows(t, fakeWindow("w-4242", 9999, "inst-2", "Fixture", "Fixture App")),
		Snapshots: []json.RawMessage{
			fakeSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", basicTree("@spre1:e1")),
		},
	})
	_, err := driver.Observe(context.Background(), fixtureTarget())
	assertDriverCode(t, err, computerErrorTargetChanged)
	if driver.latest != nil {
		t.Fatal("a successor window must not become actable")
	}
	if len(callsFor(readFakeCalls(t, runtimeRoot), "snapshot")) != 0 {
		t.Fatal("a successor window must be rejected before any snapshot")
	}
}

func TestComputerDriverInventoryCapsCandidates(t *testing.T) {
	runtimeRoot, stateRoot := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, stateRoot)
	windows := make([]map[string]any, 0, computerMaxInventoryWindows+1)
	for index := 0; index <= computerMaxInventoryWindows; index++ {
		windows = append(windows, fakeWindow("w-"+strconv.Itoa(index), 4242, "inst-1", "Fixture", "Fixture App"))
	}
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Windows:         mustWindows(t, windows...),
	})
	inventory, err := driver.Inventory(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(inventory.Candidates) != computerMaxInventoryWindows || !inventory.Truncated {
		t.Fatalf("candidate cap not applied: candidates=%d truncated=%v", len(inventory.Candidates), inventory.Truncated)
	}
}

func TestComputerDriverInventoryCancellationKillsTheProcessGroupWithoutRetry(t *testing.T) {
	runtimeRoot, stateRoot := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, stateRoot)
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Windows:         mustWindows(t, fixtureWindow()),
		DelayMS:         30000,
		DelayCommand:    "list-apps",
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	type outcome struct {
		inventory computerInventory
		err       error
	}
	finished := make(chan outcome, 1)
	go func() {
		inventory, err := driver.Inventory(ctx)
		finished <- outcome{inventory: inventory, err: err}
	}()
	waitForFakeCommand(t, runtimeRoot, "list-apps")
	cancel()
	var got outcome
	select {
	case got = <-finished:
	case <-time.After(10 * time.Second):
		t.Fatal("cancelled inventory did not return")
	}
	if !errors.Is(got.err, context.Canceled) {
		t.Fatalf("expected context canceled, got %v", got.err)
	}
	if got.inventory.Candidates != nil {
		t.Fatalf("cancellation must not return candidates: %+v", got.inventory)
	}
	calls := readFakeCalls(t, runtimeRoot)
	appCalls := callsFor(calls, "list-apps")
	if len(appCalls) != 1 {
		t.Fatalf("expected exactly one cancelled list-apps, got %d", len(appCalls))
	}
	if len(callsFor(calls, "list-windows")) != 0 {
		t.Fatal("cancellation must not continue to list-windows")
	}
	pid := appCalls[0].PID
	deadline := time.Now().Add(5 * time.Second)
	for {
		err := syscall.Kill(pid, 0)
		if errors.Is(err, syscall.ESRCH) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("cancelled inventory process %d still exists", pid)
		}
		time.Sleep(20 * time.Millisecond)
	}
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

func TestComputerDriverStaticReadbackPreservesActionableRefsAndPrivacy(t *testing.T) {
	for _, test := range []struct {
		name      string
		prefix    int
		unchanged bool
		effect    string
	}{
		{name: "static feedback changes", effect: computerEffectSmallChange},
		{name: "complete unchanged", unchanged: true, effect: computerEffectNoEffect},
		{name: "static feedback precedes action beyond cap", prefix: 420, effect: computerEffectSmallChange},
		{name: "partial unchanged", prefix: 420, unchanged: true, effect: computerEffectUnknown},
	} {
		t.Run(test.name, func(t *testing.T) {
			runtimeRoot, stateRoot := newFakeRuntime(t)
			driver := newPreparedDriver(t, runtimeRoot, stateRoot)
			const privateLabel = "private static result"
			build := func(id, status string) json.RawMessage {
				label := fakeNode("statictext", privateLabel+" "+status, "", "private label value")
				label["description"] = "private label description"
				children := []map[string]any{label}
				for index := 0; index < test.prefix; index++ {
					children = append(children, fakeNode("statictext", "dense fixture", "", nil))
				}
				children = append(children, fakeNode("button", "Apply", "@"+id+":e1", "private button value"))
				return fakeSnapshotData(id, "w-4242", "Fixture", "Fixture App", fakeNode("window", "Fixture", "", nil, children...))
			}
			status := "applied"
			if test.unchanged {
				status = "waiting"
			}
			writeFakeScenario(t, runtimeRoot, fakeScenario{
				Windows:   mustWindows(t, fixtureWindow()),
				Snapshots: []json.RawMessage{build("sreadpre", "waiting"), build("sreadpost", status)},
				InteractiveSnapshots: []json.RawMessage{
					fakeSnapshotData("sreadpre", "w-4242", "Fixture", "Fixture App", basicTree("@sreadpre:e1")),
					fakeSnapshotData("sreadpost", "w-4242", "Fixture", "Fixture App", basicTree("@sreadpost:e1")),
				},
			})
			observation, err := driver.Observe(context.Background(), fixtureTarget())
			if err != nil {
				t.Fatal(err)
			}
			projected := computerExecutorObservation(observation)
			if len(projected.Nodes) != 1 || projected.Nodes[0].Ref != "@sreadpre:e1" ||
				projected.Nodes[0].Role != "button" || projected.Nodes[0].Name == nil || *projected.Nodes[0].Name != "Apply" {
				t.Fatal("only the existing actionable button must reach the executor projection")
			}
			if strings.Contains(string(mustJSON(t, projected)), "private") {
				t.Fatal("static feedback and AX values must stay out of the wire observation")
			}
			if len(observation.Elements) > computerMaxObservationElements {
				t.Fatalf("observation exceeds the established element cap: %d", len(observation.Elements))
			}
			result, err := driver.Act(context.Background(), computerAction{
				ObservationID: observation.ID, Kind: computerActionClick, Ref: projected.Nodes[0].Ref,
			})
			if err != nil {
				t.Fatal(err)
			}
			if !result.Accepted || result.Effect != test.effect || result.Retry != computerRetryUnsafe || driver.latest != nil {
				t.Errorf("expected %s, unsafe retry and fresh refs after one click; got %+v", test.effect, result)
			}
			calls := readFakeCalls(t, runtimeRoot)
			snapshots := callsFor(calls, "snapshot")
			if len(snapshots) != 2 || len(callsFor(calls, "click")) != 1 {
				t.Fatal("expected one observe, one click and one readback")
			}
			for _, call := range snapshots {
				assertExactArgs(t, call, driver.sessionID, "snapshot",
					"--app="+fakeFixtureBundleID, "--window-id=w-4242", "--compact", "--max-depth=10", "--timeout-ms=5000")
			}
			assertNoForbiddenArgs(t, calls)
		})
	}
}

func TestComputerDriverFullSnapshotOutputLimit(t *testing.T) {
	for _, test := range []struct {
		name        string
		overflow    int
		modes       []bool
		effectError string
	}{
		{name: "observe keeps usable interactive refs", modes: []bool{false, true, true}},
		{name: "readback never adds another capture", overflow: 1, modes: []bool{false, false}, effectError: computerErrorOutputLimit},
	} {
		t.Run(test.name, func(t *testing.T) {
			runtimeRoot, parent := newFakeRuntime(t)
			driver := newPreparedDriver(t, runtimeRoot, parent)
			const preRef = "@spre1:e1"
			pre := fakeSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", basicTree(preRef))
			post := fakeSnapshotData("spost1", "w-4242", "Fixture", "Fixture App", basicTree("@spost1:e1"))
			writeFakeScenario(t, runtimeRoot, fakeScenario{
				Windows:               mustWindows(t, fixtureWindow()),
				Snapshots:             []json.RawMessage{pre, post},
				InteractiveSnapshots:  []json.RawMessage{pre, pre, post},
				OversizeFullSnapshots: []int{test.overflow},
			})
			observation, err := driver.Observe(context.Background(), fixtureTarget())
			if err != nil {
				t.Fatalf("observe must preserve the previous usable projection: %v", err)
			}
			wire := computerExecutorObservation(observation)
			fellBack := test.overflow == 0
			wantQuality := computerTreeQualityGood
			if fellBack {
				wantQuality = computerTreeQualityPartial
			}
			if wire.TreeQuality != wantQuality || wire.Truncated != fellBack || len(wire.Nodes) != 1 || wire.Nodes[0].Ref != preRef {
				t.Fatal("expected proven actionable ref and accurate capture quality")
			}
			result, err := driver.Act(context.Background(), computerAction{
				ObservationID: observation.ID, Kind: computerActionClick, Ref: preRef,
			})
			if err != nil {
				t.Fatal(err)
			}
			if !result.Accepted || result.Effect != computerEffectUnknown || result.EffectError != test.effectError ||
				result.Retry != computerRetryUnsafe || driver.latest != nil {
				t.Fatalf("incomplete comparison must not claim no_effect or authorize replay: %+v", result)
			}
			calls := readFakeCalls(t, runtimeRoot)
			snapshots := callsFor(calls, "snapshot")
			if len(snapshots) != len(test.modes) || len(callsFor(calls, "click")) != 1 {
				t.Fatal("expected one input and at most one post-input readback")
			}
			for index, interactiveOnly := range test.modes {
				args := []string{"--app=" + fakeFixtureBundleID, "--window-id=w-4242"}
				if interactiveOnly {
					args = append(args, "--interactive-only")
				}
				args = append(args, "--compact", "--max-depth=10", "--timeout-ms=5000")
				assertExactArgs(t, snapshots[index], driver.sessionID, "snapshot", args...)
			}
			assertNoForbiddenArgs(t, calls)
		})
	}
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

const unprovenSentinel = "SENTINEL-CAPTURED-CONTENT"

// sentinelSnapshotTree puts a distinguishable value in every captured field so
// a regression that returns any AX content or metadata is visible.
func sentinelSnapshotTree(ref string) map[string]any {
	button := map[string]any{
		"role":        unprovenSentinel + "-ROLE",
		"name":        unprovenSentinel + "-NAME",
		"value":       unprovenSentinel + "-VALUE",
		"description": unprovenSentinel + "-DESC",
	}
	if ref != "" {
		button["ref_id"] = ref
	}
	return map[string]any{
		"role":     "window",
		"name":     unprovenSentinel + "-WINDOW",
		"children": []map[string]any{button},
	}
}

func assertUnprovenObservationIsSanitized(t *testing.T, observation computerObservation) {
	t.Helper()
	if observation.ID == "" {
		t.Fatal("a safe synthetic observation id must remain")
	}
	if observation.Actable || observation.TreeQuality != computerTreeQualityUnusable ||
		observation.Truncated || observation.SnapshotID != "" ||
		observation.Window.Title != "" || len(observation.Elements) != 0 {
		t.Fatalf("identity_unproven leaked captured content or metadata: %+v", observation)
	}
	encoded, err := json.Marshal(observation)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), unprovenSentinel) {
		t.Fatalf("captured sentinel survived into the observation: %s", encoded)
	}
}

func assertNoStoredSentinel(t *testing.T, stateRoot string) {
	t.Helper()
	err := filepath.Walk(stateRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if strings.Contains(string(data), unprovenSentinel) {
			t.Fatalf("captured sentinel was stored at %s", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestComputerDriverExplicitUnprovenCarriesNoCapturedContent(t *testing.T) {
	runtimeRoot, parent := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, parent)
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Windows:         mustWindows(t, fixtureWindow()),
		Snapshots: []json.RawMessage{
			fakeUnprovenSnapshotData("sidentity1", "w-4242",
				unprovenSentinel+"-TITLE", unprovenSentinel+"-APP", sentinelSnapshotTree("@sidentity1:e1")),
		},
	})
	observation, err := driver.Observe(context.Background(), fixtureTarget())
	if err != nil {
		t.Fatal(err)
	}
	assertUnprovenObservationIsSanitized(t, observation)
	if driver.latest != nil {
		t.Fatal("identity_unproven must not store an actable observation")
	}
	assertNoStoredSentinel(t, driver.stateRoot)
	_, err = driver.Act(context.Background(), computerAction{
		ObservationID: observation.ID, Kind: computerActionClick, Ref: "@sidentity1:e1",
	})
	assertDriverCode(t, err, computerErrorNoObservation)
	calls := readFakeCalls(t, runtimeRoot)
	if len(callsFor(calls, "click")) != 0 || len(callsFor(calls, "type")) != 0 {
		t.Fatal("read-only observation must not authorize an action")
	}
	if count := len(callsFor(calls, "snapshot")); count != 1 {
		t.Fatalf("identity_unproven must not retry the snapshot: %d", count)
	}
}

// TestComputerDriverObserveRequiresPinnedCaptureEvidence covers the v1.3.1
// snapshot identity gap: the envelope carries no process generation
// (commands/snapshot.rs:135-150), so Observe must prove the capture source
// from the saved session refmap before any ref can be dispatched.
func TestComputerDriverObserveRequiresPinnedCaptureEvidence(t *testing.T) {
	validEntry := map[string]any{
		"pid": 4242, "process_instance": "inst-1", "source_window_id": "w-4242",
	}
	refmap := func(counter int, entries map[string]any) string {
		return string(mustJSON(t, map[string]any{"inner": entries, "counter": counter}))
	}
	one := basicTree("@spre1:e1")
	two := fakeNode("window", "Fixture", "", nil,
		fakeNode("group", "", "", nil,
			fakeNode("button", "One", "@spre1:e1", nil),
			fakeNode("button", "Two", "@spre1:e2", nil)))
	tests := []struct {
		name     string
		tree     map[string]any
		unproven bool
		refmaps  map[string]string
		skips    []string
		code     string
	}{
		{
			name: "successor pid",
			tree: one,
			refmaps: map[string]string{"spre1": refmap(1, map[string]any{
				"@e1": map[string]any{"pid": 9999, "process_instance": "inst-1", "source_window_id": "w-4242"},
			})},
			code: computerErrorTargetChanged,
		},
		{
			name: "successor process instance",
			tree: one,
			refmaps: map[string]string{"spre1": refmap(1, map[string]any{
				"@e1": map[string]any{"pid": 4242, "process_instance": "inst-2", "source_window_id": "w-4242"},
			})},
			code: computerErrorTargetChanged,
		},
		{
			name: "different source window",
			tree: one,
			refmaps: map[string]string{"spre1": refmap(1, map[string]any{
				"@e1": map[string]any{"pid": 4242, "process_instance": "inst-1", "source_window_id": "w-9999"},
			})},
			code: computerErrorTargetChanged,
		},
		{
			name:     "unproven flag does not bypass successor evidence",
			tree:     one,
			unproven: true,
			refmaps: map[string]string{"spre1": refmap(1, map[string]any{
				"@e1": map[string]any{"pid": 9999, "process_instance": "inst-2", "source_window_id": "w-4242"},
			})},
			code: computerErrorTargetChanged,
		},
		{
			name:  "missing evidence",
			tree:  one,
			skips: []string{"spre1"},
			code:  computerErrorProtocol,
		},
		{
			name:    "malformed evidence",
			tree:    one,
			refmaps: map[string]string{"spre1": `{"inner":`},
			code:    computerErrorProtocol,
		},
		{
			name: "ref count mismatch",
			tree: two,
			refmaps: map[string]string{"spre1": refmap(1, map[string]any{
				"@e1": validEntry,
			})},
			code: computerErrorProtocol,
		},
		{
			name: "entry without process instance",
			tree: one,
			refmaps: map[string]string{"spre1": refmap(1, map[string]any{
				"@e1": map[string]any{"pid": 4242, "source_window_id": "w-4242"},
			})},
			code: computerErrorProtocol,
		},
		{
			name: "entry without source window",
			tree: one,
			refmaps: map[string]string{"spre1": refmap(1, map[string]any{
				"@e1": map[string]any{"pid": 4242, "process_instance": "inst-1"},
			})},
			code: computerErrorProtocol,
		},
		{
			name: "tree ref absent from saved map",
			tree: one,
			refmaps: map[string]string{"spre1": refmap(2, map[string]any{
				"@e2": validEntry,
			})},
			code: computerErrorProtocol,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			runtimeRoot, stateRoot := newFakeRuntime(t)
			driver := newPreparedDriver(t, runtimeRoot, stateRoot)
			snapshot := fakeSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", test.tree)
			if test.unproven {
				snapshot = fakeUnprovenSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", test.tree)
			}
			writeFakeScenario(t, runtimeRoot, fakeScenario{
				PermissionsData: fakePermissions("granted"),
				Windows:         mustWindows(t, fixtureWindow()),
				Snapshots:       []json.RawMessage{snapshot},
				Refmaps:         test.refmaps,
				RefmapSkips:     test.skips,
			})
			observation, err := driver.Observe(context.Background(), fixtureTarget())
			assertDriverCode(t, err, test.code)
			if observation.ID != "" || observation.SnapshotID != "" || observation.Elements != nil {
				t.Fatalf("failed capture proof must not return an observation: %+v", observation)
			}
			if driver.latest != nil {
				t.Fatal("failed capture proof must not leave actable refs")
			}
			_, err = driver.Act(context.Background(), computerAction{
				ObservationID: strings.Repeat("a", 32),
				Kind:          computerActionClick,
				Ref:           "@spre1:e1",
			})
			assertDriverCode(t, err, computerErrorNoObservation)
			calls := readFakeCalls(t, runtimeRoot)
			if len(callsFor(calls, "click")) != 0 || len(callsFor(calls, "type")) != 0 {
				t.Fatal("failed capture proof must dispatch no action")
			}
			if count := len(callsFor(calls, "snapshot")); count != 1 {
				t.Fatalf("failed capture proof must not retry the snapshot: %d", count)
			}
		})
	}
}

func TestComputerDriverZeroRefEvidenceIsReadOnly(t *testing.T) {
	runtimeRoot, parent := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, parent)
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Windows:         mustWindows(t, fixtureWindow()),
		Snapshots: []json.RawMessage{
			fakeSnapshotData("szeroref1", "w-4242",
				unprovenSentinel+"-TITLE", unprovenSentinel+"-APP", sentinelSnapshotTree("")),
		},
	})
	observation, err := driver.Observe(context.Background(), fixtureTarget())
	if err != nil {
		t.Fatal(err)
	}
	// Zero saved refs cannot prove any capture source. Like an explicit
	// identity_unproven flag it exposes no captured tree or metadata.
	assertUnprovenObservationIsSanitized(t, observation)
	if driver.latest != nil {
		t.Fatal("zero-ref evidence must not store an actable observation")
	}
	assertNoStoredSentinel(t, driver.stateRoot)
	_, err = driver.Act(context.Background(), computerAction{
		ObservationID: observation.ID, Kind: computerActionClick, Ref: "@szeroref1:e1",
	})
	assertDriverCode(t, err, computerErrorNoObservation)
	calls := readFakeCalls(t, runtimeRoot)
	if len(callsFor(calls, "click")) != 0 || len(callsFor(calls, "type")) != 0 {
		t.Fatal("read-only observation must not authorize an action")
	}
	if count := len(callsFor(calls, "snapshot")); count != 1 {
		t.Fatalf("zero-ref evidence must not retry the snapshot: %d", count)
	}
}

// An identity_unproven post-action readback is comparison evidence only when it
// is attributable. Its tree must never become an effect claim.
func TestComputerDriverUnprovenReadbackIsNotEffectEvidence(t *testing.T) {
	runtimeRoot, parent := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, parent)
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Windows:         mustWindows(t, fixtureWindow()),
		Snapshots: []json.RawMessage{
			fakeSnapshotData("seffect1", "w-4242", "Fixture", "Fixture App", basicTree("@seffect1:e1")),
			fakeUnprovenSnapshotData("seffect2", "w-4242",
				unprovenSentinel+"-TITLE", unprovenSentinel+"-APP", sentinelSnapshotTree("@seffect2:e1")),
		},
	})
	observation, err := driver.Observe(context.Background(), fixtureTarget())
	if err != nil {
		t.Fatal(err)
	}
	if !observation.Actable {
		t.Fatalf("the proven capture must stay actable: %+v", observation)
	}
	result, err := driver.Act(context.Background(), computerAction{
		ObservationID: observation.ID, Kind: computerActionClick, Ref: "@seffect1:e1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Effect != computerEffectUnknown || result.EffectError != "" {
		t.Fatalf("an unproven readback produced an effect: %+v", result)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), unprovenSentinel) {
		t.Fatalf("captured sentinel survived into the action result: %s", encoded)
	}
	if driver.latest != nil {
		t.Fatal("the readback must not be stored")
	}
	calls := readFakeCalls(t, runtimeRoot)
	if count := len(callsFor(calls, "click")); count != 1 {
		t.Fatalf("the action was retried: %d clicks", count)
	}
	if count := len(callsFor(calls, "snapshot")); count != 2 {
		t.Fatalf("expected the observe plus one readback, snapshots=%d", count)
	}
}

func TestComputerDriverRefmapTextIsNeverDecoded(t *testing.T) {
	const sentinel = "REFMAP-ONLY-TEXT"
	runtimeRoot, parent := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, parent)
	payload := string(mustJSON(t, map[string]any{
		"inner": map[string]any{"@e1": map[string]any{
			"pid": 4242, "process_instance": "inst-1", "source_window_id": "w-4242",
			"source_app": sentinel, "source_window_title": sentinel,
			"name": sentinel, "value": sentinel, "description": sentinel,
		}},
		"counter": 1,
	}))
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Windows:         mustWindows(t, fixtureWindow()),
		Snapshots: []json.RawMessage{
			fakeSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", basicTree("@spre1:e1")),
		},
		Refmaps: map[string]string{"spre1": payload},
	})
	observation, err := driver.Observe(context.Background(), fixtureTarget())
	if err != nil {
		t.Fatal(err)
	}
	if !observation.Actable || observation.TreeQuality != computerTreeQualityGood {
		t.Fatalf("matching identity evidence must remain actable: %+v", observation)
	}
	if observation.Window.Title == sentinel {
		t.Fatal("saved ref text must not replace the pinned window title")
	}
	for _, element := range observation.Elements {
		if element.Role == sentinel || element.Name == sentinel ||
			element.Value == sentinel || element.Description == sentinel {
			t.Fatalf("saved ref text leaked into the observation: %+v", element)
		}
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
	// A consumed observation must never authorize a replay and the one
	// comparison readback must not hand back reusable post refs.
	assertConsumed := func(t *testing.T, driver *computerDriver, runtimeRoot string, observation computerObservation, ref string) {
		t.Helper()
		if driver.latest != nil {
			t.Fatal("post readback must not leave actable refs")
		}
		if count := len(callsFor(readFakeCalls(t, runtimeRoot), "type")); count != 1 {
			t.Fatalf("exactly one type must be sent, got %d", count)
		}
		_, err := driver.Act(context.Background(), computerAction{
			ObservationID: observation.ID, Kind: computerActionType, Ref: ref, Text: "typed",
		})
		var driverErr *computerDriverError
		if !errors.As(err, &driverErr) || driverErr.Code != computerErrorNoObservation {
			t.Fatalf("consumed observation must not authorize a replay: %v", err)
		}
	}

	for _, test := range []struct {
		name     string
		twinRef  string
		padding  int
		postTwin bool
	}{
		{name: "identical twins", twinRef: "@spre1:e2"},
		{name: "a ref-free twin is still ambiguous"},
		{name: "a ref-free post twin is still ambiguous", postTwin: true},
		{name: "clipped context may hide a ref-free twin", padding: computerMaxObservationElements},
	} {
		t.Run(test.name, func(t *testing.T) {
			runtimeRoot, parent := newFakeRuntime(t)
			driver := newPreparedDriver(t, runtimeRoot, parent)
			text := "typed"
			preChildren := []map[string]any{fakeNode("textfield", "Input", "@spre1:e1", "")}
			postChildren := []map[string]any{fakeNode("textfield", "Input", "@spost1:e1", text)}
			if test.postTwin {
				postChildren = append(postChildren, fakeNode("textfield", "Input", "", ""))
			} else {
				for index := 0; index < test.padding; index++ {
					preChildren = append(preChildren, fakeNode("statictext", "inert", "", nil))
				}
				preChildren = append(preChildren, fakeNode("textfield", "Input", test.twinRef, ""))
			}
			preTree := fakeNode("window", "Fixture", "", nil, fakeNode("group", "", "", nil, preChildren...))
			postTree := fakeNode("window", "Fixture", "", nil, fakeNode("group", "", "", nil, postChildren...))
			writeFakeScenario(t, runtimeRoot, fakeScenario{
				Windows: mustWindows(t, fixtureWindow()),
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
			if result.Effect != computerEffectSmallChange {
				t.Fatalf("twin evidence must degrade conservatively: %+v", result)
			}
			assertConsumed(t, driver, runtimeRoot, observation, "@spre1:e1")
		})
	}

	t.Run("clipped identity may hide a ref-free twin", func(t *testing.T) {
		runtimeRoot, parent := newFakeRuntime(t)
		driver := newPreparedDriver(t, runtimeRoot, parent)
		text := "typed"
		children := []map[string]any{fakeNode("textfield", "Input", "@spre1:e1", "")}
		// 130 labels of 600 bytes exhaust the shared 64 KiB text budget, so the
		// trailing ref-free textfield keeps only a clipped/empty identity.
		for index := 0; index < 130; index++ {
			children = append(children, fakeNode("statictext", strings.Repeat("x", 600), "", nil))
		}
		children = append(children, fakeNode("textfield", "Input", "", ""))
		preTree := fakeNode("window", "Fixture", "", nil, fakeNode("group", "", "", nil, children...))
		postTree := fakeNode("window", "Fixture", "", nil,
			fakeNode("group", "", "", nil, fakeNode("textfield", "Input", "@spost1:e1", text)))
		writeFakeScenario(t, runtimeRoot, fakeScenario{
			Windows: mustWindows(t, fixtureWindow()),
			Snapshots: []json.RawMessage{
				fakeSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", preTree),
				fakeSnapshotData("spost1", "w-4242", "Fixture", "Fixture App", postTree),
			},
		})
		observation, err := driver.Observe(context.Background(), fixtureTarget())
		if err != nil {
			t.Fatal(err)
		}
		if !observation.Truncated || observation.actionableIncomplete {
			t.Fatalf("fixture must clip ref-free text without losing actionable evidence: truncated=%t incomplete=%t",
				observation.Truncated, observation.actionableIncomplete)
		}
		result, err := driver.Act(context.Background(), computerAction{
			ObservationID: observation.ID, Kind: computerActionType, Ref: "@spre1:e1", Text: text,
		})
		if err != nil {
			t.Fatal(err)
		}
		if result.Effect != computerEffectSmallChange {
			t.Fatalf("a clipped ref-free identity must withhold done: %+v", result)
		}
		assertConsumed(t, driver, runtimeRoot, observation, "@spre1:e1")
	})

	t.Run("children below an omitted ref-free parent still count", func(t *testing.T) {
		runtimeRoot, parent := newFakeRuntime(t)
		driver := newPreparedDriver(t, runtimeRoot, parent)
		text := "typed"
		padding := make([]map[string]any, 0, computerMaxObservationElements-3)
		for index := 0; index < computerMaxObservationElements-3; index++ {
			padding = append(padding, fakeNode("statictext", "inert", "", nil))
		}
		// The window, both earlier groups and 397 labels fill the 400-element
		// budget, so the candidate group is omitted; its decoded child must still
		// be inspected and mark the target's role/depth key.
		preTree := fakeNode("window", "Fixture", "", nil,
			fakeNode("group", "", "", nil, fakeNode("textfield", "Input", "@spre1:e1", "")),
			fakeNode("group", "", "", nil, padding...),
			fakeNode("group", "", "", nil, fakeNode("textfield", "Input", "", "")))
		postTree := fakeNode("window", "Fixture", "", nil,
			fakeNode("group", "", "", nil, fakeNode("textfield", "Input", "@spost1:e1", text)))
		writeFakeScenario(t, runtimeRoot, fakeScenario{
			Windows: mustWindows(t, fixtureWindow()),
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
		if result.Effect != computerEffectSmallChange {
			t.Fatalf("a twin below an omitted ref-free parent must withhold done: %+v", result)
		}
		assertConsumed(t, driver, runtimeRoot, observation, "@spre1:e1")
	})

	t.Run("missing post candidate ref is not done", func(t *testing.T) {
		runtimeRoot, parent := newFakeRuntime(t)
		driver := newPreparedDriver(t, runtimeRoot, parent)
		text := "typed"
		preTree := fakeNode("window", "Fixture", "", nil,
			fakeNode("group", "", "", nil,
				fakeNode("textfield", "Input", "@spre1:e1", ""),
				fakeNode("button", "Apply", "@spre1:e2", nil)))
		// The field that carries the typed text has no allocated ref, so it sits
		// in the ref-free suffix even though it is the only identity match.
		postTree := fakeNode("window", "Fixture", "", nil,
			fakeNode("group", "", "", nil,
				fakeNode("button", "Apply", "@spost1:e1", nil),
				fakeNode("textfield", "Input", "", text)))
		writeFakeScenario(t, runtimeRoot, fakeScenario{
			Windows: mustWindows(t, fixtureWindow()),
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
		if result.Effect != computerEffectSmallChange {
			t.Fatalf("a ref-free post candidate must not prove done: %+v", result)
		}
		assertConsumed(t, driver, runtimeRoot, observation, "@spre1:e1")
	})

	t.Run("dense inert context still proves done", func(t *testing.T) {
		runtimeRoot, parent := newFakeRuntime(t)
		driver := newPreparedDriver(t, runtimeRoot, parent)
		text := "typed"
		labels := make([]map[string]any, 0, 420)
		for index := 0; index < 420; index++ {
			labels = append(labels, fakeNode("statictext", "inert label", "", nil))
		}
		preTree := fakeNode("window", "Fixture", "", nil,
			fakeNode("group", "", "", nil,
				append([]map[string]any{fakeNode("textfield", "Input", "@sdensepre:e1", "")}, labels...)...))
		postTree := fakeNode("window", "Fixture", "", nil,
			fakeNode("group", "", "", nil,
				append([]map[string]any{fakeNode("textfield", "Input", "@sdensepost:e1", text)}, labels...)...))
		writeFakeScenario(t, runtimeRoot, fakeScenario{
			Windows: mustWindows(t, fixtureWindow()),
			Snapshots: []json.RawMessage{
				fakeSnapshotData("sdensepre", "w-4242", "Fixture", "Fixture App", preTree),
				fakeSnapshotData("sdensepost", "w-4242", "Fixture", "Fixture App", postTree),
			},
		})
		observation, err := driver.Observe(context.Background(), fixtureTarget())
		if err != nil {
			t.Fatal(err)
		}
		if !observation.Truncated || observation.actionableIncomplete {
			t.Fatalf("fixture must omit only inert context: truncated=%t incomplete=%t",
				observation.Truncated, observation.actionableIncomplete)
		}
		if len(driver.latest.ambiguousRefKeys) != 0 {
			t.Fatal("omitted inert labels must not look like possible twins")
		}
		result, err := driver.Act(context.Background(), computerAction{
			ObservationID: observation.ID, Kind: computerActionType, Ref: "@sdensepre:e1", Text: text,
		})
		if err != nil {
			t.Fatal(err)
		}
		if !result.Accepted || result.Effect != computerEffectDone {
			t.Fatalf("complete actionable evidence must still prove done: %+v", result)
		}
		if count := len(callsFor(readFakeCalls(t, runtimeRoot), "snapshot")); count != 2 {
			t.Fatalf("expected one observe and one readback, snapshots=%d", count)
		}
		assertConsumed(t, driver, runtimeRoot, observation, "@sdensepre:e1")
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

	t.Run("native unknown subtree is not done", func(t *testing.T) {
		runtimeRoot, parent := newFakeRuntime(t)
		driver := newPreparedDriver(t, runtimeRoot, parent)
		text := "typed"
		hidden := fakeNode("statictext", "hidden", "", nil)
		hidden["subtree_truncated"] = true
		preTree := fakeNode("window", "Fixture", "", nil,
			fakeNode("group", "", "", nil,
				fakeNode("textfield", "Input", "@spre1:e1", "")))
		// The native capture truncated a subtree that could hide another
		// ref-able identity even though the visible refs are complete.
		postTree := fakeNode("window", "Fixture", "", nil,
			fakeNode("group", "", "", nil,
				fakeNode("textfield", "Input", "@spost1:e1", text),
				hidden))
		writeFakeScenario(t, runtimeRoot, fakeScenario{
			Windows: mustWindows(t, fixtureWindow()),
			Snapshots: []json.RawMessage{
				fakeSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", preTree),
				fakeSnapshotData("spost1", "w-4242", "Fixture", "Fixture App", postTree),
			},
		})
		observation, err := driver.Observe(context.Background(), fixtureTarget())
		if err != nil {
			t.Fatal(err)
		}
		if observation.actionableIncomplete {
			t.Fatal("pre-action capture must be complete for this regression")
		}
		result, err := driver.Act(context.Background(), computerAction{
			ObservationID: observation.ID, Kind: computerActionType, Ref: "@spre1:e1", Text: text,
		})
		if err != nil {
			t.Fatal(err)
		}
		if result.Effect != computerEffectSmallChange {
			t.Fatalf("an unknown native subtree must withhold done: %+v", result)
		}
		assertConsumed(t, driver, runtimeRoot, observation, "@spre1:e1")
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

func assertProcessGone(t *testing.T, pid int, what string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		err := syscall.Kill(pid, 0)
		if errors.Is(err, syscall.ESRCH) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("%s process %d still exists", what, pid)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestComputerDriverWaitUsesExactBoundedArgsAndKeepsObservation(t *testing.T) {
	runtimeRoot, stateRoot := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, stateRoot)
	writeFakeScenario(t, runtimeRoot, basicScenario(t, "spre1", "@spre1:e1"))
	observation, err := driver.Observe(context.Background(), fixtureTarget())
	if err != nil {
		t.Fatal(err)
	}
	resetFakeCalls(t, runtimeRoot)

	first, err := driver.Wait(context.Background(), computerWaitRequest{
		ObservationID: observation.ID, Ref: "@spre1:e1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.Result != computerWaitMet || first.WaitedMS != 0 {
		t.Fatalf("unexpected wait result: %+v", first)
	}
	if driver.latest == nil || driver.latest.ID != observation.ID {
		t.Fatal("a read-only wait must keep the observation actable")
	}

	second, err := driver.Wait(context.Background(), computerWaitRequest{
		ObservationID: observation.ID, Ref: "@spre1:e1", TimeoutMS: 5000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if second.Result != computerWaitMet {
		t.Fatalf("second wait must reuse the observation: %+v", second)
	}

	before := len(readFakeCalls(t, runtimeRoot))
	for _, timeout := range []int{-1, 99, computerWaitMaxTimeoutMS + 1} {
		_, err := driver.Wait(context.Background(), computerWaitRequest{
			ObservationID: observation.ID, Ref: "@spre1:e1", TimeoutMS: timeout,
		})
		assertDriverCode(t, err, computerErrorInvalidArgument)
	}
	if len(readFakeCalls(t, runtimeRoot)) != before {
		t.Fatal("an out-of-range timeout must never dispatch")
	}

	calls := readFakeCalls(t, runtimeRoot)
	waitCalls := callsFor(calls, "wait")
	if len(waitCalls) != 2 {
		t.Fatalf("expected two waits, got %d", len(waitCalls))
	}
	assertWaitExactArgs(t, waitCalls[0], driver.sessionID, "@spre1:e1", computerWaitDefaultTimeoutMS)
	assertWaitExactArgs(t, waitCalls[1], driver.sessionID, "@spre1:e1", 5000)
	if len(callsFor(calls, "snapshot")) != 0 ||
		len(callsFor(calls, "click")) != 0 || len(callsFor(calls, "type")) != 0 {
		t.Fatal("a wait must never capture, click, or type")
	}
	assertNoForbiddenArgs(t, calls)
	assertNoWaitSpecificArgs(t, calls)
}

func TestComputerDriverWaitRejectsStaleAndCrossObservationRefs(t *testing.T) {
	runtimeRoot, stateRoot := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, stateRoot)
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		Windows:         mustWindows(t, fixtureWindow()),
		Snapshots: []json.RawMessage{
			fakeSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", basicTree("@spre1:e1")),
			fakeSnapshotData("spre2", "w-4242", "Fixture", "Fixture App", basicTree("@spre2:e1")),
		},
	})
	observation, err := driver.Observe(context.Background(), fixtureTarget())
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name   string
		action computerWaitRequest
		code   string
	}{
		{"bare ref", computerWaitRequest{ObservationID: observation.ID, Ref: "@e1"}, computerErrorInvalidArgument},
		{"foreign snapshot", computerWaitRequest{ObservationID: observation.ID, Ref: "@sother:e1"}, computerErrorStaleRef},
		{"unknown element in the observation", computerWaitRequest{ObservationID: observation.ID, Ref: "@spre1:e9"}, computerErrorStaleRef},
		{"foreign observation", computerWaitRequest{ObservationID: strings.Repeat("a", 32), Ref: "@spre1:e1"}, computerErrorStaleObservation},
	}
	resetFakeCalls(t, runtimeRoot)
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			_, err := driver.Wait(context.Background(), item.action)
			assertDriverCode(t, err, item.code)
		})
	}
	if len(callsFor(readFakeCalls(t, runtimeRoot), "wait")) != 0 {
		t.Fatal("invalid refs must be rejected before any wait process")
	}

	// A fresh observe advances the current observation; the previous
	// observation's id and refs must not authorize a wait.
	second, err := driver.Observe(context.Background(), fixtureTarget())
	if err != nil {
		t.Fatal(err)
	}
	resetFakeCalls(t, runtimeRoot)
	_, err = driver.Wait(context.Background(), computerWaitRequest{
		ObservationID: observation.ID, Ref: "@spre1:e1",
	})
	assertDriverCode(t, err, computerErrorStaleObservation)
	_, err = driver.Wait(context.Background(), computerWaitRequest{
		ObservationID: second.ID, Ref: "@spre1:e1",
	})
	assertDriverCode(t, err, computerErrorStaleRef)
	if len(callsFor(readFakeCalls(t, runtimeRoot), "wait")) != 0 {
		t.Fatal("cross-observation refs must never dispatch")
	}
	if _, err := driver.Wait(context.Background(), computerWaitRequest{
		ObservationID: second.ID, Ref: "@spre2:e1",
	}); err != nil {
		t.Fatal(err)
	}
	if calls := callsFor(readFakeCalls(t, runtimeRoot), "wait"); len(calls) != 1 {
		t.Fatalf("the current observation must authorize one wait, got %d", len(calls))
	}
}

func TestComputerDriverWaitDiscardsResultWhenProcessGenerationChanges(t *testing.T) {
	runtimeRoot, stateRoot := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, stateRoot)
	original := mustWindows(t, fixtureWindow())
	successor := mustWindows(t, fakeWindow("w-4242", 9999, "inst-2", "Fixture", "Fixture App"))
	writeFakeScenario(t, runtimeRoot, fakeScenario{
		PermissionsData: fakePermissions("granted"),
		// Observe resolves twice, then Wait resolves once before and once after
		// the native read. The post-read resolution sees a successor process.
		WindowsCalls: []json.RawMessage{original, original, original, successor},
		Snapshots: []json.RawMessage{
			fakeSnapshotData("spre1", "w-4242", "Fixture", "Fixture App", basicTree("@spre1:e1")),
		},
	})
	observation, err := driver.Observe(context.Background(), fixtureTarget())
	if err != nil {
		t.Fatal(err)
	}
	resetFakeCalls(t, runtimeRoot)
	result, err := driver.Wait(context.Background(), computerWaitRequest{
		ObservationID: observation.ID, Ref: "@spre1:e1",
	})
	assertDriverCode(t, err, computerErrorTargetChanged)
	if result.Result != "" {
		t.Fatalf("a replaced process must suppress the native result: %+v", result)
	}
	if driver.latest != nil {
		t.Fatal("a replaced process must invalidate the observation")
	}
	calls := readFakeCalls(t, runtimeRoot)
	if waitCalls := callsFor(calls, "wait"); len(waitCalls) != 1 {
		t.Fatalf("expected exactly one wait, got %d", len(waitCalls))
	}
	if len(callsFor(calls, "snapshot")) != 0 {
		t.Fatal("a wait must not capture or replay")
	}
}

func TestComputerDriverWaitClassifiesNativeOutcomes(t *testing.T) {
	setup := func(t *testing.T, data, errorJSON json.RawMessage) (*computerDriver, string, computerObservation) {
		t.Helper()
		runtimeRoot, stateRoot := newFakeRuntime(t)
		driver := newPreparedDriver(t, runtimeRoot, stateRoot)
		scenario := basicScenario(t, "spre1", "@spre1:e1")
		if data != nil {
			scenario.ActionData = map[string]json.RawMessage{"wait": data}
		}
		if errorJSON != nil {
			scenario.ActionError = map[string]json.RawMessage{"wait": errorJSON}
		}
		writeFakeScenario(t, runtimeRoot, scenario)
		observation, err := driver.Observe(context.Background(), fixtureTarget())
		if err != nil {
			t.Fatal(err)
		}
		resetFakeCalls(t, runtimeRoot)
		return driver, runtimeRoot, observation
	}

	t.Run("native predicate expiry is timed_out", func(t *testing.T) {
		errorJSON := mustJSON(t, map[string]any{
			"code": "TIMEOUT", "message": "SECRET wait text",
			"details": map[string]any{
				"kind": "wait_timeout", "ref": "@spre1:e1", "predicate": "actionable",
				"timeout_ms":    computerWaitDefaultTimeoutMS,
				"last_observed": map[string]any{"actionable": false},
			},
			"disposition": map[string]any{"delivery": "not_delivered", "retry": "safe"},
		})
		driver, runtimeRoot, observation := setup(t, nil, errorJSON)
		result, err := driver.Wait(context.Background(), computerWaitRequest{
			ObservationID: observation.ID, Ref: "@spre1:e1",
		})
		if err != nil {
			t.Fatal(err)
		}
		if result.Result != computerWaitTimedOut || result.WaitedMS != computerWaitDefaultTimeoutMS {
			t.Fatalf("unexpected timeout result: %+v", result)
		}
		if driver.latest == nil {
			t.Fatal("a bounded predicate expiry must keep the observation")
		}
		calls := readFakeCalls(t, runtimeRoot)
		if len(callsFor(calls, "snapshot")) != 0 ||
			len(callsFor(calls, "click")) != 0 || len(callsFor(calls, "type")) != 0 {
			t.Fatal("a timeout must not capture or mutate")
		}
	})

	t.Run("a different native deadline is not timed_out", func(t *testing.T) {
		errorJSON := mustJSON(t, map[string]any{
			"code": "TIMEOUT", "message": "SECRET deadline text",
			"details":     map[string]any{"kind": "deadline", "timeout_ms": 5000},
			"disposition": map[string]any{"delivery": "not_delivered", "retry": "safe"},
		})
		driver, _, observation := setup(t, nil, errorJSON)
		result, err := driver.Wait(context.Background(), computerWaitRequest{
			ObservationID: observation.ID, Ref: "@spre1:e1",
		})
		var driverErr *computerDriverError
		if !errors.As(err, &driverErr) || driverErr.Code != computerErrorTimeout ||
			driverErr.AgentCode != "TIMEOUT" || driverErr.AgentKind != "deadline" {
			t.Fatalf("expected a native deadline error, got %v", err)
		}
		if result.Result != "" || strings.Contains(err.Error(), "SECRET") {
			t.Fatalf("native text or a result leaked: %+v %v", result, err)
		}
	})

	t.Run("stale ref invalidates the observation", func(t *testing.T) {
		errorJSON := mustJSON(t, map[string]any{
			"code": "STALE_REF", "message": "SECRET stale text",
			"disposition": map[string]any{"delivery": "not_delivered", "retry": "safe"},
		})
		driver, runtimeRoot, observation := setup(t, nil, errorJSON)
		result, err := driver.Wait(context.Background(), computerWaitRequest{
			ObservationID: observation.ID, Ref: "@spre1:e1",
		})
		assertDriverCode(t, err, computerErrorStaleRef)
		if result.Result != "" || driver.latest != nil {
			t.Fatalf("a stale native ref must invalidate: %+v latest=%v", result, driver.latest)
		}
		_, err = driver.Wait(context.Background(), computerWaitRequest{
			ObservationID: observation.ID, Ref: "@spre1:e1",
		})
		assertDriverCode(t, err, computerErrorNoObservation)
		if len(callsFor(readFakeCalls(t, runtimeRoot), "wait")) != 1 {
			t.Fatal("a stale native ref must not be retried")
		}
	})

	t.Run("ambiguous target invalidates the observation", func(t *testing.T) {
		errorJSON := mustJSON(t, map[string]any{
			"code": "AMBIGUOUS_TARGET", "message": "SECRET ambiguous text",
			"disposition": map[string]any{"delivery": "not_delivered", "retry": "safe"},
		})
		driver, _, observation := setup(t, nil, errorJSON)
		result, err := driver.Wait(context.Background(), computerWaitRequest{
			ObservationID: observation.ID, Ref: "@spre1:e1",
		})
		assertDriverCode(t, err, computerErrorTargetChanged)
		if result.Result != "" || driver.latest != nil {
			t.Fatalf("an ambiguous native target must invalidate: %+v latest=%v", result, driver.latest)
		}
	})

	t.Run("malformed success is a protocol error", func(t *testing.T) {
		cases := []struct {
			name string
			data map[string]any
		}{
			{"not found", map[string]any{"found": false, "ref": "@spre1:e1", "predicate": "actionable", "elapsed_ms": 0}},
			{"wrong ref", map[string]any{"found": true, "ref": "@spre1:e2", "predicate": "actionable", "elapsed_ms": 0}},
			{"wrong predicate", map[string]any{"found": true, "ref": "@spre1:e1", "predicate": "enabled", "elapsed_ms": 0}},
			{"elapsed beyond the bound", map[string]any{"found": true, "ref": "@spre1:e1", "predicate": "actionable", "elapsed_ms": 8001}},
		}
		for _, item := range cases {
			t.Run(item.name, func(t *testing.T) {
				driver, _, observation := setup(t, mustJSON(t, item.data), nil)
				_, err := driver.Wait(context.Background(), computerWaitRequest{
					ObservationID: observation.ID, Ref: "@spre1:e1",
				})
				assertDriverCode(t, err, computerErrorProtocol)
			})
		}
	})
}

func TestComputerDriverWaitProcessBoundKillsTheChildWithoutResult(t *testing.T) {
	runtimeRoot, stateRoot := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, stateRoot)
	scenario := basicScenario(t, "spre1", "@spre1:e1")
	scenario.DelayMS = 30000
	scenario.DelayCommand = "wait"
	writeFakeScenario(t, runtimeRoot, scenario)
	observation, err := driver.Observe(context.Background(), fixtureTarget())
	if err != nil {
		t.Fatal(err)
	}
	resetFakeCalls(t, runtimeRoot)
	started := time.Now()
	result, err := driver.Wait(context.Background(), computerWaitRequest{
		ObservationID: observation.ID, Ref: "@spre1:e1", TimeoutMS: computerWaitMinTimeoutMS,
	})
	if elapsed := time.Since(started); elapsed < 100*time.Millisecond || elapsed > 10*time.Second {
		t.Fatalf("driver bound did not terminate promptly: %v", elapsed)
	}
	var driverErr *computerDriverError
	if !errors.As(err, &driverErr) || driverErr.Code != computerErrorTimeout || driverErr.AgentKind != "" {
		t.Fatalf("expected the driver process bound, got %v", err)
	}
	if result.Result != "" {
		t.Fatalf("a killed process must not report a native result: %+v", result)
	}
	calls := readFakeCalls(t, runtimeRoot)
	waitCalls := callsFor(calls, "wait")
	if len(waitCalls) != 1 {
		t.Fatalf("expected exactly one bounded wait, got %d", len(waitCalls))
	}
	assertWaitExactArgs(t, waitCalls[0], driver.sessionID, "@spre1:e1", computerWaitMinTimeoutMS)
	assertProcessGone(t, waitCalls[0].PID, "bounded wait")
	if len(callsFor(calls, "snapshot")) != 0 ||
		len(callsFor(calls, "click")) != 0 || len(callsFor(calls, "type")) != 0 {
		t.Fatal("a bounded process kill must not capture, mutate, or replay")
	}
}

func TestComputerDriverWaitCancellationKillsTheChildWithoutResult(t *testing.T) {
	runtimeRoot, stateRoot := newFakeRuntime(t)
	driver := newPreparedDriver(t, runtimeRoot, stateRoot)
	scenario := basicScenario(t, "spre1", "@spre1:e1")
	scenario.DelayMS = 30000
	scenario.DelayCommand = "wait"
	writeFakeScenario(t, runtimeRoot, scenario)
	observation, err := driver.Observe(context.Background(), fixtureTarget())
	if err != nil {
		t.Fatal(err)
	}
	resetFakeCalls(t, runtimeRoot)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	type outcome struct {
		result computerWaitResult
		err    error
	}
	finished := make(chan outcome, 1)
	go func() {
		result, err := driver.Wait(ctx, computerWaitRequest{
			ObservationID: observation.ID, Ref: "@spre1:e1",
		})
		finished <- outcome{result: result, err: err}
	}()
	waitForFakeCommand(t, runtimeRoot, "wait")
	cancel()
	var got outcome
	select {
	case got = <-finished:
	case <-time.After(10 * time.Second):
		t.Fatal("cancelled wait did not return")
	}
	if !errors.Is(got.err, context.Canceled) {
		t.Fatalf("expected context canceled, got %v", got.err)
	}
	if got.result.Result != "" {
		t.Fatalf("cancellation must not report a native result: %+v", got.result)
	}
	calls := readFakeCalls(t, runtimeRoot)
	waitCalls := callsFor(calls, "wait")
	if len(waitCalls) != 1 {
		t.Fatalf("expected exactly one cancelled wait, got %d", len(waitCalls))
	}
	assertProcessGone(t, waitCalls[0].PID, "cancelled wait")
	if len(callsFor(calls, "snapshot")) != 0 ||
		len(callsFor(calls, "click")) != 0 || len(callsFor(calls, "type")) != 0 {
		t.Fatal("cancellation must not capture, mutate, or replay")
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
		_, err := newComputerDriverDarwin(context.Background(), runtimeRoot, parent, computerRuntimeProof{})
		assertDriverCode(t, err, computerErrorRuntimeProofMissing)
	})
	t.Run("unknown proof kind", func(t *testing.T) {
		runtimeRoot, parent := newFakeRuntime(t)
		_, err := newComputerDriverDarwin(context.Background(), runtimeRoot, parent,
			computerRuntimeProof{Kind: computerRuntimeProofKind(99)})
		assertDriverCode(t, err, computerErrorRuntimeProofInvalid)
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
	_, err = newComputerDriverDarwin(context.Background(), runtimeRoot, parent, preparedProof())
	assertDriverCode(t, err, computerErrorRuntimeUntrusted)
}

func signedProof() computerRuntimeProof {
	return computerRuntimeProof{Kind: computerRuntimeProofSigned}
}

// writeSignedFakeManifest mirrors the release manifest shape with hashes that
// deliberately do not match the fixture bytes, as Developer ID signing rewrites
// executables after preparation.
func writeSignedFakeManifest(t *testing.T, runtimeRoot string) {
	t.Helper()
	stale := strings.Repeat("0", sha256.Size*2)
	manifest := map[string]any{
		"schema_version": 1,
		"application":    "org.linksense.desktop",
		"target":         "darwin/" + goruntime.GOARCH,
		"runtime_arch":   goruntime.GOARCH,
		"versions":       map[string]string{"agent_desktop": "1.3.1"},
		"files": []map[string]string{
			{"path": computerBinaryRel, "sha256": stale},
			{"path": computerHelperRel, "sha256": stale},
		},
	}
	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runtimeRoot, "manifest.json"), data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func assertNoComputerDriverState(t *testing.T, parent string) {
	t.Helper()
	entries, err := os.ReadDir(parent)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "computer-use-") {
			t.Fatalf("driver created state despite a rejected proof: %q", entry.Name())
		}
	}
}

func TestComputerDriverSignedRuntimeProofAcceptsTheRunningApp(t *testing.T) {
	app, runtimeRoot, binary, helper := desktopMacosFakeTree(t)
	writeSignedFakeManifest(t, runtimeRoot)
	codesign, log := writeDesktopMacosFakeCodesign(t, desktopMacosFakeCodesignSucceeds)
	setDesktopMacosSigningTestSeam(t, desktopMacosTestToken(t, nil), codesign, app)
	parent := t.TempDir()

	driver, err := newComputerDriverDarwin(context.Background(), runtimeRoot, parent, signedProof())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = driver.Close() })
	if driver.runtimeProof != computerRuntimeProofSignedLabel {
		t.Fatalf("proof label = %q, want %q", driver.runtimeProof, computerRuntimeProofSignedLabel)
	}
	if driver.binaryPath != binary {
		t.Fatalf("binary = %q, want %q", driver.binaryPath, binary)
	}
	if info, err := os.Lstat(driver.stateRoot); err != nil || !info.IsDir() || info.Mode().Perm() != 0o700 {
		t.Fatalf("private state root was not created: %v", err)
	}
	if !slices.Contains(driver.environment, "AGENT_DESKTOP_MACOS_HELPER_PATH="+helper) {
		t.Fatalf("unexpected environment: %q", driver.environment)
	}
	wantCalls := []string{
		"--verify", "--deep", "--strict", app,
		"--verify", "--strict", "-R", "=" + testDesktopMacosAppReq, app,
		"--verify", "--strict", "-R", "=" + testDesktopMacosRuntimeReq, binary,
		"--verify", "--strict", "-R", "=" + testDesktopMacosRuntimeReq, helper,
	}
	if calls := desktopMacosCalls(t, log); !slices.Equal(calls, wantCalls) {
		t.Fatalf("codesign calls = %q, want %q", calls, wantCalls)
	}

	// The manifest hashes predate signing, so prepared proof rejects this
	// fixture. Signed proof must use signatures and never fall back to it.
	_, err = newComputerDriverDarwin(context.Background(), runtimeRoot, t.TempDir(), preparedProof())
	assertDriverCode(t, err, computerErrorRuntimeUntrusted)
}

func TestComputerDriverSignedRuntimeProofRejectsUnboundRuntimeRoots(t *testing.T) {
	currentApp, currentRoot, _, _ := desktopMacosFakeTree(t)
	writeSignedFakeManifest(t, currentRoot)
	codesign, _ := writeDesktopMacosFakeCodesign(t, desktopMacosFakeCodesignSucceeds)
	setDesktopMacosSigningTestSeam(t, desktopMacosTestToken(t, nil), codesign, currentApp)

	t.Run("prior install", func(t *testing.T) {
		_, priorRoot, _, _ := desktopMacosFakeTree(t)
		writeSignedFakeManifest(t, priorRoot)
		parent := t.TempDir()
		_, err := newComputerDriverDarwin(context.Background(), priorRoot, parent, signedProof())
		assertDriverCode(t, err, computerErrorRuntimeUntrusted)
		assertNoComputerDriverState(t, parent)
	})
	t.Run("aliased runtime root", func(t *testing.T) {
		_, priorRoot, _, _ := desktopMacosFakeTree(t)
		writeSignedFakeManifest(t, priorRoot)
		alias := filepath.Join(t.TempDir(), "runtime")
		if err := os.Symlink(priorRoot, alias); err != nil {
			t.Fatal(err)
		}
		parent := t.TempDir()
		_, err := newComputerDriverDarwin(context.Background(), alias, parent, signedProof())
		assertDriverCode(t, err, computerErrorRuntimeUntrusted)
		assertNoComputerDriverState(t, parent)
	})
}

func TestComputerDriverSignedRuntimeProofFailsClosed(t *testing.T) {
	app, runtimeRoot, _, _ := desktopMacosFakeTree(t)
	writeSignedFakeManifest(t, runtimeRoot)

	t.Run("missing signer token", func(t *testing.T) {
		codesign, log := writeDesktopMacosFakeCodesign(t, desktopMacosFakeCodesignSucceeds)
		setDesktopMacosSigningTestSeam(t, "", codesign, app)
		parent := t.TempDir()
		_, err := newComputerDriverDarwin(context.Background(), runtimeRoot, parent, signedProof())
		assertDriverCode(t, err, computerErrorRuntimeProofMissing)
		desktopMacosNoCalls(t, log)
		assertNoComputerDriverState(t, parent)
	})
	t.Run("malformed signer token", func(t *testing.T) {
		codesign, log := writeDesktopMacosFakeCodesign(t, desktopMacosFakeCodesignSucceeds)
		setDesktopMacosSigningTestSeam(t, "not-base64!", codesign, app)
		parent := t.TempDir()
		_, err := newComputerDriverDarwin(context.Background(), runtimeRoot, parent, signedProof())
		assertDriverCode(t, err, computerErrorRuntimeProofInvalid)
		desktopMacosNoCalls(t, log)
		assertNoComputerDriverState(t, parent)
	})
	t.Run("invalid signature", func(t *testing.T) {
		codesign, _ := writeDesktopMacosFakeCodesign(t, desktopMacosFakeCodesignFails)
		setDesktopMacosSigningTestSeam(t, desktopMacosTestToken(t, nil), codesign, app)
		parent := t.TempDir()
		_, err := newComputerDriverDarwin(context.Background(), runtimeRoot, parent, signedProof())
		assertDriverCode(t, err, computerErrorRuntimeProofInvalid)
		assertNoComputerDriverState(t, parent)
	})
	t.Run("running app is unavailable", func(t *testing.T) {
		codesign, log := writeDesktopMacosFakeCodesign(t, desktopMacosFakeCodesignSucceeds)
		setDesktopMacosSigningTestSeam(t, desktopMacosTestToken(t, nil), codesign, "")
		parent := t.TempDir()
		_, err := newComputerDriverDarwin(context.Background(), runtimeRoot, parent, signedProof())
		assertDriverCode(t, err, computerErrorRuntimeUntrusted)
		desktopMacosNoCalls(t, log)
		assertNoComputerDriverState(t, parent)
	})
	t.Run("canceled before proof", func(t *testing.T) {
		codesign, log := writeDesktopMacosFakeCodesign(t, desktopMacosFakeCodesignSucceeds)
		setDesktopMacosSigningTestSeam(t, desktopMacosTestToken(t, nil), codesign, app)
		parent := t.TempDir()
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := newComputerDriverDarwin(ctx, runtimeRoot, parent, signedProof())
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("error = %v, want %v", err, context.Canceled)
		}
		desktopMacosNoCalls(t, log)
		assertNoComputerDriverState(t, parent)
	})
	t.Run("deadline stops proof", func(t *testing.T) {
		codesign, _ := writeDesktopMacosFakeCodesign(t, desktopMacosFakeCodesignSleeps)
		setDesktopMacosSigningTestSeam(t, desktopMacosTestToken(t, nil), codesign, app)
		parent := t.TempDir()
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		_, err := newComputerDriverDarwin(ctx, runtimeRoot, parent, signedProof())
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("error = %v, want %v", err, context.DeadlineExceeded)
		}
		assertNoComputerDriverState(t, parent)
	})
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
