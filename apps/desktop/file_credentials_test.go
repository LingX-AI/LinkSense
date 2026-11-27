package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/egoist/mygo"
)

func TestFileCredentialStorePersistsWithoutTheKeychain(t *testing.T) {
	root := t.TempDir()
	store := newFileCredentialStore(root)
	if err := store.Set("refresh.example", []byte("token")); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(root, credentialsFileName))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("credentials mode = %o", info.Mode().Perm())
	}
	reloaded := newFileCredentialStore(root)
	value, err := reloaded.Get("refresh.example")
	if err != nil || string(value) != "token" {
		t.Fatalf("credential = %q, %v", value, err)
	}
	if err := reloaded.Delete("refresh.example"); err != nil {
		t.Fatal(err)
	}
	if _, err := reloaded.Get("refresh.example"); !errors.Is(err, mygo.ErrSecretNotFound) {
		t.Fatalf("deleted credential error = %v", err)
	}
}
