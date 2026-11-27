package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const (
	localToolsPreferenceFile = "local-tools.json"
	installationIDFile       = "installation-id"
)

type localToolsPreference struct {
	Enabled bool `json:"enabled"`
}

// localToolsEnabled reads the installation-local preference. A missing file
// means enabled: auto-enrollment is the default after login. An unreadable or
// corrupt file fails closed so damage cannot silently override an opt-out.
func (d *Desktop) localToolsEnabled() bool {
	if d.dataRoot == "" {
		return true
	}
	data, err := os.ReadFile(filepath.Join(d.dataRoot, localToolsPreferenceFile))
	if errors.Is(err, os.ErrNotExist) {
		return true
	}
	if err != nil {
		return false
	}
	var preference localToolsPreference
	if json.Unmarshal(data, &preference) != nil {
		return false
	}
	return preference.Enabled
}

// installationID is the durable local identity for this installation. It is
// deliberately not stored in the device credential: signing out or revoking
// the device must not let the next login enroll as a fresh installation.
func (d *Desktop) installationID() string {
	if d.dataRoot == "" {
		return newInstallationID()
	}
	path := filepath.Join(d.dataRoot, installationIDFile)
	if data, err := os.ReadFile(path); err == nil {
		if id := strings.TrimSpace(string(data)); validUUID(id) {
			return id
		}
	}
	id := newInstallationID()
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, []byte(id+"\n"), 0o600); err != nil {
		return id
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
	}
	return id
}

func newInstallationID() string {
	value := make([]byte, 16)
	// crypto/rand.Read terminates the process if the system entropy source fails.
	_, _ = rand.Read(value)
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(value)
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" +
		encoded[16:20] + "-" + encoded[20:32]
}

func (d *Desktop) setLocalToolsPreference(enabled bool) error {
	if d.dataRoot == "" {
		return errors.New("DESKTOP_DATA_DIRECTORY_UNAVAILABLE")
	}
	data, err := json.Marshal(localToolsPreference{Enabled: enabled})
	if err != nil {
		return err
	}
	path := filepath.Join(d.dataRoot, localToolsPreferenceFile)
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return errors.New("DESKTOP_CREDENTIAL_STORE_UNAVAILABLE")
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return errors.New("DESKTOP_CREDENTIAL_STORE_UNAVAILABLE")
	}
	return nil
}
