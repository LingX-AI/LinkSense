package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	fileTestOwner        = "10000000-0000-4000-8000-000000000001"
	fileTestRoot         = "50000000-0000-4000-8000-000000000001"
	fileTestConversation = "60000000-0000-4000-8000-000000000001"
)

func fileTestStore(t *testing.T, root string) *localFileRoots {
	t.Helper()
	store := newLocalFileRoots(t.TempDir())
	now := "2026-01-01T00:00:00Z"
	store.loaded = true
	store.state = fileRootsState{
		Owners:        map[string]map[string]string{fileTestOwner: {fileTestRoot: root}},
		Metadata:      map[string]map[string]localRootMeta{fileTestOwner: {fileTestRoot: {Path: root, Name: "root", Mode: "write", CreatedAt: now, UpdatedAt: now}}},
		Conversations: map[string]map[string]string{fileTestOwner: {fileTestConversation: fileTestRoot}},
	}
	return store
}

func fileTestInput(t *testing.T, values map[string]any) json.RawMessage {
	t.Helper()
	values["root_id"] = fileTestRoot
	data, err := json.Marshal(values)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func fileTestFailure(t *testing.T, err error, code string) {
	t.Helper()
	var failure *localFileToolError
	if !errors.As(err, &failure) || failure.code != code {
		t.Fatalf("error = %v, want %s", err, code)
	}
}

func TestLocalFileToolsStayInsideTheGrantedRoot(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "notes.txt"), []byte("first line\nsecond line\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "folder"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	store := fileTestStore(t, root)
	ctx := context.Background()

	list, err := executeLocalFileTool(ctx, store, fileTestOwner, fileTestConversation, "", "local_files.list",
		fileTestInput(t, map[string]any{"path": "", "limit": 10}))
	if err != nil {
		t.Fatal(err)
	}
	entries := list.(localFilesListResult).Entries
	if len(entries) < 2 {
		t.Fatalf("entries = %v", entries)
	}
	var symlinkKind string
	for _, entry := range entries {
		if entry.Name == "escape" {
			symlinkKind = entry.Kind
		}
	}
	if symlinkKind != "symlink" {
		t.Fatalf("symlink entry kind = %q", symlinkKind)
	}

	for _, input := range []map[string]any{
		{"path": "../outside.txt"},
		{"path": "/etc/passwd"},
		{"path": "folder/../../outside.txt"},
		{"path": "folder/../notes.txt"},
		{"path": "./notes.txt"},
		{"path": "folder//notes.txt"},
		{"path": "escape/secret.txt"},
	} {
		_, err := executeLocalFileTool(ctx, store, fileTestOwner, fileTestConversation, "", "local_files.read",
			fileTestInput(t, input))
		if err == nil {
			t.Fatalf("read accepted %v", input)
		}
		var failure *localFileToolError
		if !errors.As(err, &failure) ||
			(failure.code != "DESKTOP_FILE_INVALID_PATH" && failure.code != "DESKTOP_FILE_ACCESS_DENIED") {
			t.Fatalf("read error for %v = %v", input, err)
		}
	}

	for _, operation := range []string{"local_files.write", "local_files.create", "local_files.delete"} {
		input := map[string]any{"path": "escape/secret.txt"}
		if operation == "local_files.write" {
			input["content"] = "x"
		}
		if operation == "local_files.create" {
			input["kind"] = "file"
		}
		_, err := executeLocalFileTool(ctx, store, fileTestOwner, fileTestConversation, "", operation, fileTestInput(t, input))
		fileTestFailure(t, err, "DESKTOP_FILE_ACCESS_DENIED")
	}
	if err := os.WriteFile(filepath.Join(root, "binary.bin"), []byte{0, 1, 2}, 0o600); err != nil {
		t.Fatal(err)
	}
	binary, err := executeLocalFileTool(ctx, store, fileTestOwner, fileTestConversation, "", "local_files.read",
		fileTestInput(t, map[string]any{"path": "binary.bin"}))
	if err != nil {
		t.Fatal(err)
	}
	binaryRead := binary.(localFilesReadResult)
	if binaryRead.Kind != "binary" || binaryRead.Content != nil || binaryRead.Digest != nil {
		t.Fatalf("binary read = %+v", binaryRead)
	}

	read, err := executeLocalFileTool(ctx, store, fileTestOwner, fileTestConversation, "", "local_files.read",
		fileTestInput(t, map[string]any{"path": "notes.txt"}))
	if err != nil {
		t.Fatal(err)
	}
	text := read.(localFilesReadResult)
	if text.Kind != "text" || text.Content == nil || *text.Content != "first line\nsecond line\n" ||
		text.Digest == nil || len(*text.Digest) != 64 || text.Truncated {
		t.Fatalf("read = %+v", text)
	}
	partial, err := executeLocalFileTool(ctx, store, fileTestOwner, fileTestConversation, "", "local_files.read",
		fileTestInput(t, map[string]any{"path": "notes.txt", "max_bytes": 4}))
	if err != nil {
		t.Fatal(err)
	}
	truncated := partial.(localFilesReadResult)
	if !truncated.Truncated || truncated.Digest != nil || truncated.Content == nil ||
		*truncated.Content != "firs" || truncated.Size != int64(len("first line\nsecond line\n")) {
		t.Fatalf("truncated read = %+v", truncated)
	}
}

func TestLocalFileWritesDetectConflictsAndCreateAndTrash(t *testing.T) {
	root := t.TempDir()
	store := fileTestStore(t, root)
	ctx := context.Background()

	created, err := executeLocalFileTool(ctx, store, fileTestOwner, fileTestConversation, "", "local_files.create",
		fileTestInput(t, map[string]any{"path": "docs", "kind": "directory"}))
	if err != nil {
		t.Fatal(err)
	}
	if created.(localFilesCreateResult).Kind != "directory" {
		t.Fatalf("create = %+v", created)
	}
	if _, err := executeLocalFileTool(ctx, store, fileTestOwner, fileTestConversation, "", "local_files.create",
		fileTestInput(t, map[string]any{"path": "docs", "kind": "directory"})); err == nil {
		t.Fatal("duplicate create was accepted")
	} else {
		fileTestFailure(t, err, "DESKTOP_FILE_CONFLICT")
	}

	written, err := executeLocalFileTool(ctx, store, fileTestOwner, fileTestConversation, "", "local_files.write",
		fileTestInput(t, map[string]any{"path": "docs/plan.md", "content": "one"}))
	if err != nil {
		t.Fatal(err)
	}
	write := written.(localFilesWriteResult)
	if !write.Created || write.Digest == "" {
		t.Fatalf("write = %+v", write)
	}
	_, err = executeLocalFileTool(ctx, store, fileTestOwner, fileTestConversation, "", "local_files.write",
		fileTestInput(t, map[string]any{
			"path": "docs/plan.md", "content": "two", "expected_digest": strings.Repeat("0", 64),
		}))
	fileTestFailure(t, err, "DESKTOP_FILE_CONFLICT")
	onDisk, err := os.ReadFile(filepath.Join(root, "docs", "plan.md"))
	if err != nil || string(onDisk) != "one" {
		t.Fatalf("conflict overwrote content: %q %v", onDisk, err)
	}
	if _, err := executeLocalFileTool(ctx, store, fileTestOwner, fileTestConversation, "", "local_files.write",
		fileTestInput(t, map[string]any{
			"path": "docs/plan.md", "content": "two", "expected_digest": write.Digest,
		})); err != nil {
		t.Fatal(err)
	}
	onDisk, _ = os.ReadFile(filepath.Join(root, "docs", "plan.md"))
	if string(onDisk) != "two" {
		t.Fatalf("write content = %q", onDisk)
	}

	if _, err := executeLocalFileTool(ctx, store, fileTestOwner, fileTestConversation, "", "local_files.write",
		fileTestInput(t, map[string]any{"path": "nested/deep/file.txt", "content": "x"})); err == nil {
		t.Fatal("write created missing parents without permission")
	}
	if _, err := executeLocalFileTool(ctx, store, fileTestOwner, fileTestConversation, "", "local_files.write",
		fileTestInput(t, map[string]any{
			"path": "nested/deep/file.txt", "content": "x", "create_parents": true,
		})); err != nil {
		t.Fatal(err)
	}

	trashed := ""
	originalTrash := localFileTrashItem
	localFileTrashItem = func(path string) error {
		trashed = path
		return os.RemoveAll(path)
	}
	t.Cleanup(func() { localFileTrashItem = originalTrash })
	_, err = executeLocalFileTool(ctx, store, fileTestOwner, fileTestConversation, "", "local_files.delete",
		fileTestInput(t, map[string]any{
			"path": "docs/plan.md", "expected_digest": strings.Repeat("0", 64),
		}))
	fileTestFailure(t, err, "DESKTOP_FILE_CONFLICT")
	if _, err := executeLocalFileTool(ctx, store, fileTestOwner, fileTestConversation, "", "local_files.delete",
		fileTestInput(t, map[string]any{"path": "docs/plan.md"})); err != nil {
		t.Fatal(err)
	}
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	if trashed != filepath.Join(canonicalRoot, "docs", "plan.md") {
		t.Fatalf("trashed = %q", trashed)
	}
	if _, err := os.Stat(filepath.Join(root, "docs", "plan.md")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("trashed file still exists: %v", err)
	}
}

func TestLocalFileSearchSkipsDependenciesAndReportsLines(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "node_modules", "pkg"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "src", "app.ts"), []byte("const answer = 42\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "node_modules", "pkg", "index.js"), []byte("answer 42\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := fileTestStore(t, root)
	result, err := executeLocalFileTool(context.Background(), store, fileTestOwner, fileTestConversation, "", "local_files.search",
		fileTestInput(t, map[string]any{"path": "", "query": "ANSWER", "max_results": 10}))
	if err != nil {
		t.Fatal(err)
	}
	search := result.(localFilesSearchResult)
	if len(search.Matches) != 1 || search.Matches[0].Path != "src/app.ts" ||
		search.Matches[0].Line != 1 || search.Matches[0].Column != 7 {
		t.Fatalf("matches = %+v", search.Matches)
	}
	if err := os.WriteFile(filepath.Join(root, "src", "b.ts"), []byte("answer 42\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	limited, err := executeLocalFileTool(context.Background(), store, fileTestOwner, fileTestConversation, "", "local_files.search",
		fileTestInput(t, map[string]any{"path": "", "query": "answer", "max_results": 1}))
	if err != nil {
		t.Fatal(err)
	}
	if !limited.(localFilesSearchResult).Truncated ||
		len(limited.(localFilesSearchResult).Matches) != 1 {
		t.Fatalf("limited search = %+v", limited)
	}
}

func TestLocalFileRootStorePersistsOnlyTheOwnerMapping(t *testing.T) {
	dataRoot := t.TempDir()
	root := t.TempDir()
	store := newLocalFileRoots(dataRoot)
	now := "2026-01-01T00:00:00Z"
	store.loaded = true
	store.state = fileRootsState{
		Owners:        map[string]map[string]string{fileTestOwner: {fileTestRoot: root}},
		Metadata:      map[string]map[string]localRootMeta{fileTestOwner: {fileTestRoot: {Path: root, Name: "root", Mode: "write", CreatedAt: now, UpdatedAt: now}}},
		Conversations: map[string]map[string]string{fileTestOwner: {fileTestConversation: fileTestRoot}},
	}
	if err := store.persist(); err != nil {
		t.Fatal(err)
	}
	reloaded := newLocalFileRoots(dataRoot)
	meta, err := reloaded.rootForConversation(fileTestOwner, fileTestConversation, "", fileTestRoot)
	if err != nil || meta.Path != root {
		t.Fatalf("reloaded root = %q %v", meta.Path, err)
	}
	otherOwner := "10000000-0000-4000-8000-000000000002"
	if _, err := reloaded.rootForConversation(otherOwner, fileTestConversation, "", fileTestRoot); err == nil {
		t.Fatal("another owner read the first mapping")
	}
	if err := os.WriteFile(filepath.Join(dataRoot, fileRootsPreferenceFile), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := newLocalFileRoots(dataRoot).rootForConversation(fileTestOwner, fileTestConversation, "", fileTestRoot); err == nil {
		t.Fatal("corrupt store returned a root")
	}
}

func TestConversationUsesHomeUntilAnotherFolderIsGranted(t *testing.T) {
	dataRoot := t.TempDir()
	store := newLocalFileRoots(dataRoot)
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	roots, err := store.rootsForConversation(fileTestOwner, fileTestConversation, "20000000-0000-4000-8000-000000000001")
	if err != nil || len(roots) != 1 {
		t.Fatalf("roots = %v, %v", roots, err)
	}
	if roots[0].Name != "Home" || roots[0].Mode != "write" {
		t.Fatalf("default root = %+v", roots[0])
	}
	meta, err := store.rootForConversation(fileTestOwner, fileTestConversation, "", roots[0].ID)
	if err != nil || meta.Path != home {
		t.Fatalf("default path = %q, %v", meta.Path, err)
	}
	otherConversation := "60000000-0000-4000-8000-000000000002"
	otherRoots, err := store.rootsForConversation(fileTestOwner, otherConversation, "")
	if err != nil || len(otherRoots) != 1 || otherRoots[0].ID != roots[0].ID {
		t.Fatalf("home grant was not reused: %v, %v", otherRoots, err)
	}
}

func TestFolderModeIsScopedToEachConversation(t *testing.T) {
	store := newLocalFileRoots(t.TempDir())
	first, err := store.rootsForConversation(fileTestOwner, fileTestConversation, "")
	if err != nil {
		t.Fatal(err)
	}
	otherConversation := "60000000-0000-4000-8000-000000000003"
	if _, err := store.rootsForConversation(fileTestOwner, otherConversation, ""); err != nil {
		t.Fatal(err)
	}
	store.mu.Lock()
	store.ownerConversationModes(fileTestOwner)[fileTestConversation] = "read"
	store.mu.Unlock()

	firstRoots, err := store.rootsForConversation(fileTestOwner, fileTestConversation, "")
	if err != nil || len(firstRoots) != 1 || firstRoots[0].Mode != "read" {
		t.Fatalf("first conversation mode = %+v, %v", firstRoots, err)
	}
	otherRoots, err := store.rootsForConversation(fileTestOwner, otherConversation, "")
	if err != nil || len(otherRoots) != 1 || otherRoots[0].Mode != "write" {
		t.Fatalf("other conversation mode = %+v, %v", otherRoots, err)
	}
	meta, err := store.rootForConversation(fileTestOwner, otherConversation, "", otherRoots[0].ID)
	if err != nil || meta.Mode != "write" || first[0].ID != otherRoots[0].ID {
		t.Fatalf("other conversation root = %+v, %v", meta, err)
	}
}

func TestLocalFileRootsStayScopedToTheSignedInOwner(t *testing.T) {
	root := t.TempDir()
	store := fileTestStore(t, root)
	other := "10000000-0000-4000-8000-000000000002"
	if _, err := store.rootForConversation(other, fileTestConversation, "", fileTestRoot); err == nil {
		t.Fatal("another owner resolved this root")
	}
	_, err := executeLocalFileTool(context.Background(), store, other, fileTestConversation, "", "local_files.list",
		fileTestInput(t, map[string]any{"path": ""}))
	fileTestFailure(t, err, "DESKTOP_FILE_ACCESS_DENIED")
}
