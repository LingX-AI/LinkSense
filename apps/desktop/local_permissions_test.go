package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPermissionModesDecideWhenTheMacAsks(t *testing.T) {
	if !writeApprovalRequired(permissionModeManual) {
		t.Fatal("manual must ask before a file change")
	}
	for _, mode := range []string{permissionModeAuto, permissionModeAcceptEdits, permissionModeBypass} {
		if writeApprovalRequired(mode) {
			t.Fatalf("%s must auto-approve a file change inside the grant", mode)
		}
	}
	root := t.TempDir()
	for _, mode := range []string{permissionModeManual, permissionModeAcceptEdits} {
		if !shellApprovalRequired(mode, "ls", root) {
			t.Fatalf("%s must ask before a shell command", mode)
		}
	}
	if shellApprovalRequired(permissionModeBypass, "rm -rf .", root) {
		t.Fatal("bypass must not ask")
	}
	if !shellApprovalRequired(permissionModeAuto, "rm -rf .", root) {
		t.Fatal("auto must still ask before a mutating command")
	}
	if shellApprovalRequired(permissionModeAuto, "ls -la", root) {
		t.Fatal("auto must not ask for a plain read")
	}
}

func TestAutoBoundaryIsOnePlainAllowlistedReadInsideTheGrant(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "notes.txt"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}

	approved := []string{
		"ls -la",
		"pwd",
		"cat notes.txt",
		"cat src/missing.txt",
		"rg TODO src",
		"grep -n notes .",
		"git status",
		"git log --oneline",
		"git branch --show-current",
		"git diff --stat=80",
		"wc -l notes.txt",
		"date +%Y-%m-%d",
	}
	for _, command := range approved {
		if !autoApprovedShellCommand(command, root) {
			t.Fatalf("auto should allow %q", command)
		}
	}

	asked := []string{
		"",
		" rm notes.txt",
		"rm -rf .",
		"ls; rm -rf .",
		"ls && rm -rf .",
		"ls | cat",
		"cat notes.txt > copy.txt",
		"cat $(whoami)",
		"cat `whoami`",
		"cat /etc/passwd",
		"cat ../secret",
		"cat ~/.ssh/id_rsa",
		"cat escape/file",
		"cat *.txt",
		"ls [ab]",
		"cat \"notes.txt\"",
		"find . -delete",
		"grep x --output=out.txt",
		"git -C /tmp status",
		"git branch -D main",
		"git commit -m msg",
		"git remote add origin url",
		"./script.sh",
		"env FOO=1 ls",
		"curl https://example.com",
		"python3 -c print(1)",
		"npm install",
	}
	for _, command := range asked {
		if autoApprovedShellCommand(command, root) {
			t.Fatalf("auto must ask before %q", command)
		}
	}
}

func TestPermissionModeIsPerConversationAndDefaultsToManual(t *testing.T) {
	root := t.TempDir()
	store := fileTestStore(t, root)
	if mode := store.permissionModeForOwner(fileTestOwner, "60000000-0000-4000-8000-000000000099"); mode != permissionModeManual {
		t.Fatalf("unknown conversation mode = %q, want manual", mode)
	}
	if mode := store.permissionModeForOwner(fileTestOwner, fileTestConversation); mode != permissionModeAcceptEdits {
		t.Fatalf("saved conversation mode = %q, want accept_edits", mode)
	}
	if _, err := store.setPermissionModeForConversation(
		fileTestOwner, fileTestConversation, permissionModeBypass); err != nil {
		t.Fatal(err)
	}
	reloaded := newLocalFileRoots("")
	reloaded.path = store.path
	reloaded.loaded = false
	if mode := reloaded.permissionModeForOwner(fileTestOwner, fileTestConversation); mode != permissionModeBypass {
		t.Fatalf("persisted mode = %q, want bypass", mode)
	}
}

func TestPermissionModeDefaultsOnOlderOrInvalidStoredState(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, fileRootsPreferenceFile)
	if err := os.WriteFile(path, []byte(`{"owners":{},"metadata":{},"conversations":{}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	roots := newLocalFileRoots(directory)
	if mode := roots.permissionModeForOwner(fileTestOwner, fileTestConversation); mode != permissionModeManual {
		t.Fatalf("older state mode = %q, want manual", mode)
	}
	if err := os.WriteFile(path, []byte(`{"permission_modes":{"`+fileTestOwner+`":{"`+
		fileTestConversation+`":"plan"}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	roots = newLocalFileRoots(directory)
	if mode := roots.permissionModeForOwner(fileTestOwner, fileTestConversation); mode != permissionModeManual {
		t.Fatalf("invalid stored mode = %q, want manual", mode)
	}
}

func TestApprovalCenterAllowsDeniesTimesOutAndFailsClosed(t *testing.T) {
	center := newCloudApprovalCenter()
	center.setEmitter(
		func(view cloudApprovalRequest) error {
			go func() {
				time.Sleep(10 * time.Millisecond)
				_ = center.answer(view.ID, cloudApprovalAllow)
			}()
			return nil
		},
		nil,
	)
	if err := requestApproval(context.Background(), center, cloudApprovalRequest{
		ConversationID: fileTestConversation, Kind: cloudApprovalKindCommand,
		Operation: localShellOperationConstant, Command: "ls", RootName: "root",
	}); err != nil {
		t.Fatalf("allowed approval = %v", err)
	}

	center.setEmitter(func(view cloudApprovalRequest) error {
		go func() { _ = center.answer(view.ID, cloudApprovalDeny) }()
		return nil
	}, nil)
	if err := requestApproval(context.Background(), center, cloudApprovalRequest{
		ConversationID: fileTestConversation, Kind: cloudApprovalKindCommand,
		Operation: localShellOperationConstant, Command: "ls", RootName: "root",
	}); err != errApprovalDenied {
		t.Fatalf("denied approval = %v, want %v", err, errApprovalDenied)
	}

	settled := make(chan string, 1)
	center.setEmitter(func(cloudApprovalRequest) error { return nil }, func(id string) error {
		select {
		case settled <- id:
		default:
		}
		return nil
	})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := requestApproval(ctx, center, cloudApprovalRequest{
		ConversationID: fileTestConversation, Kind: cloudApprovalKindCommand,
		Operation: localShellOperationConstant, Command: "ls", RootName: "root",
	}); err != errApprovalTimedOut {
		t.Fatalf("timed out approval = %v, want %v", err, errApprovalTimedOut)
	}
	if len(center.list()) != 0 {
		t.Fatal("a settled approval must not stay pending")
	}
	select {
	case <-settled:
	default:
		t.Fatal("the page must be told to drop a settled approval")
	}

	center.setEmitter(func(cloudApprovalRequest) error { return errApprovalUnavailable }, nil)
	if err := requestApproval(context.Background(), center, cloudApprovalRequest{
		ConversationID: fileTestConversation, Kind: cloudApprovalKindCommand,
		Operation: localShellOperationConstant, Command: "ls", RootName: "root",
	}); err != errApprovalUnavailable {
		t.Fatalf("missing page approval = %v, want %v", err, errApprovalUnavailable)
	}

	if err := center.answer(fileTestConversation, cloudApprovalAllow); err != errApprovalUnknown {
		t.Fatalf("stale answer = %v, want %v", err, errApprovalUnknown)
	}
}
