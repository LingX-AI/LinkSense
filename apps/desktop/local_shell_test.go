package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func shellTestStore(t *testing.T, mode string) (*localFileRoots, string) {
	t.Helper()
	root := t.TempDir()
	store := fileTestStore(t, root)
	store.state.PermissionModes[fileTestOwner][fileTestConversation] = mode
	return store, root
}

func shellTestInput(t *testing.T, command string, timeoutMS int, cwd string) json.RawMessage {
	t.Helper()
	values := map[string]any{"root_id": fileTestRoot, "command": command}
	if timeoutMS > 0 {
		values["timeout_ms"] = timeoutMS
	}
	if cwd != "" {
		values["cwd"] = cwd
	}
	data, err := json.Marshal(values)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func approveWith(answers ...string) *cloudApprovalCenter {
	center := newCloudApprovalCenter()
	center.setEmitter(func(view cloudApprovalRequest) error {
		if len(answers) == 0 {
			return nil
		}
		answer := answers[0]
		answers = answers[1:]
		go func() { _ = center.answer(view.ID, answer) }()
		return nil
	}, nil)
	return center
}

func TestShellBypassRunsInTheGrantedFolder(t *testing.T) {
	store, root := shellTestStore(t, permissionModeBypass)
	if err := os.Mkdir(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	result, err := executeLocalShellTool(context.Background(), store, nil, fileTestOwner,
		fileTestConversation, "", shellTestInput(t, "printf hello", 5_000, ""))
	if err != nil {
		t.Fatal(err)
	}
	shell := result.(localShellExecResult)
	if shell.Stdout != "hello" || shell.ExitCode == nil || *shell.ExitCode != 0 ||
		shell.TimedOut || shell.Cwd != "" {
		t.Fatalf("shell result = %+v", shell)
	}

	result, err = executeLocalShellTool(context.Background(), store, nil, fileTestOwner,
		fileTestConversation, "", shellTestInput(t, "pwd", 5_000, "src"))
	if err != nil {
		t.Fatal(err)
	}
	shell = result.(localShellExecResult)
	canonical, _ := filepath.EvalSymlinks(filepath.Join(root, "src"))
	if strings.TrimSpace(shell.Stdout) != canonical || shell.Cwd != "src" {
		t.Fatalf("shell cwd = %q, %q; want %q", shell.Cwd, shell.Stdout, canonical)
	}
}

func TestShellManualApprovalDeniesWithoutRunning(t *testing.T) {
	store, root := shellTestStore(t, permissionModeManual)
	center := approveWith(cloudApprovalDeny)
	_, err := executeLocalShellTool(context.Background(), store, center, fileTestOwner,
		fileTestConversation, "", shellTestInput(t, "touch marker", 5_000, ""))
	if code := localShellErrorCode(err); code != "DESKTOP_APPROVAL_DENIED" {
		t.Fatalf("denied shell error = %v (%s)", err, code)
	}
	if _, err := os.Stat(filepath.Join(root, "marker")); !os.IsNotExist(err) {
		t.Fatal("a denied command must not run")
	}

	center = approveWith(cloudApprovalAllow)
	result, err := executeLocalShellTool(context.Background(), store, center, fileTestOwner,
		fileTestConversation, "", shellTestInput(t, "printf ok > out.txt", 5_000, ""))
	if err != nil {
		t.Fatal(err)
	}
	if result.(localShellExecResult).ExitCode == nil {
		t.Fatal("allowed command did not report an exit code")
	}
	data, err := os.ReadFile(filepath.Join(root, "out.txt"))
	if err != nil || string(data) != "ok" {
		t.Fatalf("allowed command file = %q, %v", data, err)
	}
}

func TestShellAutoOnlySkipsThePromptForPlainReads(t *testing.T) {
	store, _ := shellTestStore(t, permissionModeAuto)
	prompts := make(chan cloudApprovalRequest, 2)
	center := newCloudApprovalCenter()
	center.setEmitter(func(view cloudApprovalRequest) error {
		prompts <- view
		go func() { _ = center.answer(view.ID, cloudApprovalDeny) }()
		return nil
	}, nil)
	if _, err := executeLocalShellTool(context.Background(), store, center, fileTestOwner,
		fileTestConversation, "", shellTestInput(t, "ls", 5_000, "")); err != nil {
		t.Fatalf("auto read = %v", err)
	}
	select {
	case view := <-prompts:
		t.Fatalf("auto read asked for approval: %+v", view)
	default:
	}

	_, err := executeLocalShellTool(context.Background(), store, center, fileTestOwner,
		fileTestConversation, "", shellTestInput(t, "touch marker", 5_000, ""))
	if code := localShellErrorCode(err); code != "DESKTOP_APPROVAL_DENIED" {
		t.Fatalf("auto mutation error = %v (%s)", err, code)
	}
	select {
	case view := <-prompts:
		if view.Kind != cloudApprovalKindCommand || view.Command != "touch marker" || view.RootName != "root" {
			t.Fatalf("approval view = %+v", view)
		}
	default:
		t.Fatal("auto mutation must ask")
	}
}

func TestShellTimesOutTruncatesAndRejectsEscapes(t *testing.T) {
	store, _ := shellTestStore(t, permissionModeBypass)
	started := time.Now()
	result, err := executeLocalShellTool(context.Background(), store, nil, fileTestOwner,
		fileTestConversation, "", shellTestInput(t, "sleep 5", 1_000, ""))
	if err != nil {
		t.Fatal(err)
	}
	shell := result.(localShellExecResult)
	if !shell.TimedOut || shell.ExitCode != nil || time.Since(started) > 4*time.Second {
		t.Fatalf("timed out shell = %+v after %s", shell, time.Since(started))
	}

	result, err = executeLocalShellTool(context.Background(), store, nil, fileTestOwner,
		fileTestConversation, "", shellTestInput(t, "yes x | head -c 70000", 5_000, ""))
	if err != nil {
		t.Fatal(err)
	}
	shell = result.(localShellExecResult)
	if !shell.StdoutTruncated || len(shell.Stdout) > localShellOutputMaxBytes {
		t.Fatalf("truncated shell = %d bytes, truncated=%t", len(shell.Stdout), shell.StdoutTruncated)
	}

	for _, cwd := range []string{"../outside", "/etc", "missing/../../x"} {
		_, err := executeLocalShellTool(context.Background(), store, nil, fileTestOwner,
			fileTestConversation, "", shellTestInput(t, "pwd", 5_000, cwd))
		if code := localShellErrorCode(err); code != "DESKTOP_SHELL_INVALID_PATH" {
			t.Fatalf("cwd %q error = %v (%s)", cwd, err, code)
		}
	}
	_, err = executeLocalShellTool(context.Background(), store, nil, fileTestOwner,
		fileTestConversation, "", json.RawMessage(`{"root_id":"50000000-0000-4000-8000-000000000099","command":"pwd"}`))
	if code := localShellErrorCode(err); code != "DESKTOP_SHELL_ACCESS_DENIED" {
		t.Fatalf("foreign root error = %v (%s)", err, code)
	}
}

func TestShellApprovalFailsClosedWhenTheLaneGoesAway(t *testing.T) {
	store, root := shellTestStore(t, permissionModeManual)
	center := newCloudApprovalCenter()
	prompted := make(chan struct{}, 1)
	center.setEmitter(func(cloudApprovalRequest) error {
		prompted <- struct{}{}
		return nil
	}, nil)
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, err := executeLocalShellTool(ctx, store, center, fileTestOwner, fileTestConversation,
			"", shellTestInput(t, "touch marker", 30_000, ""))
		result <- err
	}()
	select {
	case <-prompted:
	case <-time.After(5 * time.Second):
		t.Fatal("the approval was never requested")
	}
	cancel()
	select {
	case err := <-result:
		if code := localShellErrorCode(err); code != "CANCELLED" {
			t.Fatalf("cancelled shell error = %v (%s)", err, code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the cancelled shell did not return")
	}
	if _, err := os.Stat(filepath.Join(root, "marker")); !os.IsNotExist(err) {
		t.Fatal("a cancelled approval must not run the command")
	}
}

func TestMutatingFileToolsFollowThePermissionMode(t *testing.T) {
	root := t.TempDir()
	store := fileTestStore(t, root)
	store.state.PermissionModes[fileTestOwner][fileTestConversation] = permissionModeManual
	write := fileTestInput(t, map[string]any{
		"path": "manual.txt", "content": "hello",
	})

	denied := approveWith(cloudApprovalDeny)
	_, err := executeLocalFileTool(context.Background(), store, denied, fileTestOwner,
		fileTestConversation, "", "local_files.write", write)
	if code := localFileErrorCode(err); code != "DESKTOP_APPROVAL_DENIED" {
		t.Fatalf("denied write error = %v (%s)", err, code)
	}
	if _, err := os.Stat(filepath.Join(root, "manual.txt")); !os.IsNotExist(err) {
		t.Fatal("a denied write must not touch the folder")
	}

	allowed := approveWith(cloudApprovalAllow)
	if _, err := executeLocalFileTool(context.Background(), store, allowed, fileTestOwner,
		fileTestConversation, "", "local_files.write", write); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(filepath.Join(root, "manual.txt")); err != nil || string(data) != "hello" {
		t.Fatalf("allowed write = %q, %v", data, err)
	}

	// Accept edits skips the prompt entirely.
	store.state.PermissionModes[fileTestOwner][fileTestConversation] = permissionModeAcceptEdits
	unexpected := newCloudApprovalCenter()
	unexpected.setEmitter(func(cloudApprovalRequest) error {
		t.Error("accept_edits must not ask before a write")
		return nil
	}, nil)
	if _, err := executeLocalFileTool(context.Background(), store, unexpected, fileTestOwner,
		fileTestConversation, "", "local_files.create",
		fileTestInput(t, map[string]any{"path": "created", "kind": "directory"})); err != nil {
		t.Fatal(err)
	}
}
