package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
	"github.com/egoist/mygo"
)

const fileRootsPreferenceFile = "file-roots.json"

type fileRootsState struct {
	Owners map[string]map[string]string `json:"owners"`
}

// localFileRoots maps server-issued root IDs to absolute folders. The paths
// never leave this Mac; the server stores only the alias and mode.
type localFileRoots struct {
	mu     sync.RWMutex
	path   string
	loaded bool
	state  fileRootsState
}

func newLocalFileRoots(dataRoot string) *localFileRoots {
	path := ""
	if dataRoot != "" {
		path = filepath.Join(dataRoot, fileRootsPreferenceFile)
	}
	return &localFileRoots{path: path}
}

func (f *localFileRoots) load() error {
	if f.loaded {
		return nil
	}
	f.loaded = true
	f.state = fileRootsState{Owners: map[string]map[string]string{}}
	if f.path == "" {
		return nil
	}
	data, err := os.ReadFile(f.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return errors.New("DESKTOP_FILE_UNAVAILABLE")
	}
	var stored fileRootsState
	if json.Unmarshal(data, &stored) != nil {
		return errors.New("DESKTOP_FILE_UNAVAILABLE")
	}
	if stored.Owners == nil {
		stored.Owners = map[string]map[string]string{}
	}
	f.state = stored
	return nil
}

func (f *localFileRoots) persist() error {
	if f.path == "" {
		return errors.New("DESKTOP_FILE_UNAVAILABLE")
	}
	data, err := json.Marshal(f.state)
	if err != nil {
		return errors.New("DESKTOP_FILE_UNAVAILABLE")
	}
	temporary := f.path + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return errors.New("DESKTOP_FILE_UNAVAILABLE")
	}
	if err := os.Rename(temporary, f.path); err != nil {
		_ = os.Remove(temporary)
		return errors.New("DESKTOP_FILE_UNAVAILABLE")
	}
	return nil
}

func (f *localFileRoots) set(ownerID, rootID, path string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.load(); err != nil {
		return err
	}
	if f.state.Owners[ownerID] == nil {
		f.state.Owners[ownerID] = map[string]string{}
	}
	f.state.Owners[ownerID][rootID] = path
	return f.persist()
}

func (f *localFileRoots) remove(ownerID, rootID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.load(); err != nil {
		return err
	}
	delete(f.state.Owners[ownerID], rootID)
	return f.persist()
}

func (f *localFileRoots) rootPath(ownerID, rootID string) (string, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.load(); err != nil {
		return "", false
	}
	path, ok := f.state.Owners[ownerID][rootID]
	return path, ok
}

// AddFileRoot opens the native folder picker, registers the alias and mode
// with the API, then stores the absolute path locally under the returned ID.
func (d *Desktop) AddFileRoot(ctx context.Context, deviceID, mode string) (string, error) {
	if err := d.checkCaller(ctx); err != nil {
		return "", err
	}
	if !validUUID(deviceID) || (mode != "read" && mode != "write") {
		return "", errors.New("VALIDATION_ERROR")
	}
	ownerID, token, ok := d.account.currentAccessTokenIdentity()
	if !ok {
		return "", errors.New("AUTH_REQUIRED")
	}
	if d.server == nil || d.session == nil {
		return "", errors.New("DESKTOP_API_UNAVAILABLE")
	}
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent:            d.mainWindow(),
		Title:             locales.FileRootPickerTitle(),
		Message:           locales.FileRootPickerMessage(),
		Directory:         true,
		CreateDirectories: true,
	})
	if err != nil || len(paths) == 0 {
		return "", errors.New("DESKTOP_FILE_PICKER_CANCELLED")
	}
	currentOwner, currentToken, stillCurrent := d.account.currentAccessTokenIdentity()
	if !stillCurrent || currentOwner != ownerID {
		return "", errors.New("AUTH_REQUIRED")
	}
	ownerID, token = currentOwner, currentToken
	selected, err := filepath.Abs(paths[0])
	if err != nil {
		return "", errors.New("DESKTOP_FILE_INVALID_PATH")
	}
	selected, err = filepath.EvalSymlinks(selected)
	if err != nil {
		return "", errors.New("DESKTOP_FILE_INVALID_PATH")
	}
	info, err := os.Stat(selected)
	if err != nil || !info.IsDir() {
		return "", errors.New("DESKTOP_FILE_INVALID_PATH")
	}
	name := filepath.Base(selected)
	if name == "" || name == "." || name == string(filepath.Separator) {
		return "", errors.New("DESKTOP_FILE_INVALID_PATH")
	}
	body, err := json.Marshal(struct {
		DeviceID string `json:"device_id"`
		Name     string `json:"name"`
		Mode     string `json:"mode"`
	}{deviceID, name, mode})
	if err != nil {
		return "", errors.New("DESKTOP_REQUEST_INVALID")
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, d.server.String()+"/api/v1/desktop/file-roots", bytes.NewReader(body),
	)
	if err != nil {
		return "", errors.New("DESKTOP_REQUEST_INVALID")
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	client := &http.Client{
		Transport:     d.session,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	response, err := client.Do(request)
	if err != nil {
		return "", errors.New("DESKTOP_API_UNAVAILABLE")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated && response.StatusCode != http.StatusOK {
		code := readAPIErrorCode(response.Body)
		if code == "" {
			code = "DESKTOP_REQUEST_FAILED"
		}
		return "", errors.New(code)
	}
	var envelope struct {
		Success bool `json:"success"`
		Data    struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, 64*1024))
	if err != nil || json.Unmarshal(payload, &envelope) != nil || !envelope.Success ||
		!validUUID(envelope.Data.ID) {
		return "", errors.New("API_RESPONSE_INVALID")
	}
	if d.fileRoots == nil {
		return "", errors.New("DESKTOP_FILE_UNAVAILABLE")
	}
	if err := d.fileRoots.set(ownerID, envelope.Data.ID, selected); err != nil {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = d.deleteFileRoot(cleanupCtx, envelope.Data.ID, token)
		cancel()
		return "", err
	}
	return envelope.Data.ID, nil
}

// RemoveFileRoot revokes the server grant first, then forgets the local path.
func (d *Desktop) RemoveFileRoot(ctx context.Context, rootID string) error {
	if err := d.checkCaller(ctx); err != nil {
		return err
	}
	if !validUUID(rootID) {
		return errors.New("VALIDATION_ERROR")
	}
	ownerID, token, ok := d.account.currentAccessTokenIdentity()
	if !ok {
		return errors.New("AUTH_REQUIRED")
	}
	if err := d.deleteFileRoot(ctx, rootID, token); err != nil {
		return err
	}
	if d.fileRoots != nil {
		return d.fileRoots.remove(ownerID, rootID)
	}
	return nil
}

func (d *Desktop) deleteFileRoot(ctx context.Context, rootID, token string) error {
	if d.server == nil || d.session == nil {
		return errors.New("DESKTOP_API_UNAVAILABLE")
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodDelete, d.server.String()+"/api/v1/desktop/file-roots/"+rootID, nil,
	)
	if err != nil {
		return errors.New("DESKTOP_REQUEST_INVALID")
	}
	request.Header.Set("Authorization", "Bearer "+token)
	client := &http.Client{
		Transport:     d.session,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	response, err := client.Do(request)
	if err != nil {
		return errors.New("DESKTOP_API_UNAVAILABLE")
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusOK || response.StatusCode == http.StatusNotFound {
		return nil
	}
	code := readAPIErrorCode(response.Body)
	if code == "" {
		code = "DESKTOP_REQUEST_FAILED"
	}
	return errors.New(code)
}
