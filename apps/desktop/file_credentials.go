package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"

	"github.com/egoist/mygo"
)

const credentialsFileName = "credentials.json"

// fileCredentialStore keeps the native refresh and device credentials in the
// app's user-data directory instead of the login Keychain. The file is mode
// 0600 and is rewritten atomically; a corrupt file fails closed.
type fileCredentialStore struct {
	mu     sync.Mutex
	path   string
	loaded bool
	values map[string][]byte
}

func newFileCredentialStore(dataRoot string) *fileCredentialStore {
	return &fileCredentialStore{
		path: filepath.Join(dataRoot, credentialsFileName),
	}
}

func (s *fileCredentialStore) load() error {
	if s.loaded {
		return nil
	}
	s.loaded = true
	s.values = map[string][]byte{}
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return errors.New("DESKTOP_CREDENTIAL_STORE_UNAVAILABLE")
	}
	if json.Unmarshal(data, &s.values) != nil {
		return errors.New("DESKTOP_CREDENTIAL_STORE_UNAVAILABLE")
	}
	if s.values == nil {
		s.values = map[string][]byte{}
	}
	return nil
}

func (s *fileCredentialStore) persist() error {
	data, err := json.Marshal(s.values)
	if err != nil {
		return errors.New("DESKTOP_CREDENTIAL_STORE_UNAVAILABLE")
	}
	temporary := s.path + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return errors.New("DESKTOP_CREDENTIAL_STORE_UNAVAILABLE")
	}
	if err := os.Rename(temporary, s.path); err != nil {
		_ = os.Remove(temporary)
		return errors.New("DESKTOP_CREDENTIAL_STORE_UNAVAILABLE")
	}
	return nil
}

func (s *fileCredentialStore) Get(key string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.load(); err != nil {
		return nil, err
	}
	value, ok := s.values[key]
	if !ok {
		return nil, mygo.ErrSecretNotFound
	}
	return append([]byte(nil), value...), nil
}

func (s *fileCredentialStore) Set(key string, value []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.load(); err != nil {
		return err
	}
	s.values[key] = append([]byte(nil), value...)
	return s.persist()
}

func (s *fileCredentialStore) Delete(key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.load(); err != nil {
		return err
	}
	delete(s.values, key)
	return s.persist()
}
