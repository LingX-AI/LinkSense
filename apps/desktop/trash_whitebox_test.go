//go:build desktop_whitebox

package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/egoist/mygo"
)

// TestNativeTrashMovesAndCanRestoreATemporaryFile exercises the actual macOS
// Trash API used by local_files.delete, then puts the file back so the test
// leaves no user-visible residue.
func TestNativeTrashMovesAndCanRestoreATemporaryFile(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "linksense-trash-test.txt")
	if err := os.WriteFile(source, []byte("trash me"), 0o600); err != nil {
		t.Fatal(err)
	}
	trashed, err := mygo.Shell.TrashItemResult(source)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if trashed != "" {
			_ = os.Rename(trashed, source)
		}
	}()
	if _, err := os.Stat(source); !os.IsNotExist(err) {
		t.Fatalf("source still exists after trash: %v", err)
	}
	if trashed == "" {
		t.Fatal("trash did not report the moved path")
	}
	if info, err := os.Stat(trashed); err != nil || info.IsDir() {
		t.Fatalf("trashed file is not readable: %v", err)
	}
}
