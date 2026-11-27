package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestFileRootListingStaysInsideTheGrantedFolder(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "notes.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "src", "main.ts"), []byte("export {}"), 0o600); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	store := fileTestStore(t, root)
	ctx := context.Background()

	listing, err := listConversationFileRoot(ctx, store, fileTestOwner, fileTestConversation, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if listing.RootName != "root" || listing.Mode != "write" || listing.Path != "" {
		t.Fatalf("listing header = %+v", listing)
	}
	kinds := map[string]string{}
	for _, entry := range listing.Entries {
		kinds[entry.Name] = entry.Kind
	}
	if kinds["notes.txt"] != "file" || kinds["src"] != "directory" {
		t.Fatalf("entries = %+v", listing.Entries)
	}
	if _, ok := kinds["escape"]; ok {
		t.Fatalf("symlink entry reached the picker: %+v", listing.Entries)
	}

	nested, err := listConversationFileRoot(ctx, store, fileTestOwner, fileTestConversation, "", "src")
	if err != nil || len(nested.Entries) != 1 || nested.Entries[0].Path != "src/main.ts" {
		t.Fatalf("nested listing = %+v, %v", nested, err)
	}

	for _, escape := range []string{"..", "../", "escape", "/etc"} {
		if _, err := listConversationFileRoot(ctx, store, fileTestOwner, fileTestConversation, "", escape); err == nil {
			t.Fatalf("listing %q escaped the granted folder", escape)
		}
	}
}
