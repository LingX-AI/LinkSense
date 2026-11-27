package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
	"github.com/egoist/mygo"
)

const fileRootsPreferenceFile = "file-roots.json"

type localRootMeta struct {
	Path      string `json:"path"`
	Name      string `json:"name"`
	Mode      string `json:"mode"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type fileRootsState struct {
	// Owners keeps the original root ID to path mapping for files written by
	// earlier builds. Metadata is the current source of truth.
	Owners            map[string]map[string]string        `json:"owners,omitempty"`
	Metadata          map[string]map[string]localRootMeta `json:"metadata,omitempty"`
	Conversations     map[string]map[string]string        `json:"conversations,omitempty"`
	ConversationModes map[string]map[string]string        `json:"conversation_modes,omitempty"`
	// PermissionModes stores the per-conversation Claude-style permission
	// mode. A conversation without an entry is Manual.
	PermissionModes map[string]map[string]string `json:"permission_modes,omitempty"`
}

// localFileRoots maps conversation-scoped folder grants to absolute folders.
// The paths never leave this Mac. A conversation without an explicit grant
// uses the user's home directory, shown in the UI as "This Mac".
type localFileRoots struct {
	mu     sync.RWMutex
	path   string
	loaded bool
	state  fileRootsState
}

type localFileRootView struct {
	ID        string `json:"id"`
	DeviceID  string `json:"device_id"`
	Name      string `json:"name"`
	Mode      string `json:"mode"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type localFilesRootsResult struct {
	Roots []localFileRootView `json:"roots"`
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
	f.state = fileRootsState{
		Owners:            map[string]map[string]string{},
		Metadata:          map[string]map[string]localRootMeta{},
		Conversations:     map[string]map[string]string{},
		ConversationModes: map[string]map[string]string{},
		PermissionModes:   map[string]map[string]string{},
	}
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
	if stored.Metadata == nil {
		stored.Metadata = map[string]map[string]localRootMeta{}
	}
	if stored.Conversations == nil {
		stored.Conversations = map[string]map[string]string{}
	}
	if stored.ConversationModes == nil {
		stored.ConversationModes = map[string]map[string]string{}
	}
	if stored.PermissionModes == nil {
		stored.PermissionModes = map[string]map[string]string{}
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

func newLocalRootID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return ""
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return hex.EncodeToString(value[:4]) + "-" + hex.EncodeToString(value[4:6]) + "-" +
		hex.EncodeToString(value[6:8]) + "-" + hex.EncodeToString(value[8:10]) + "-" +
		hex.EncodeToString(value[10:16])
}

func (f *localFileRoots) ownerMetadata(ownerID string) map[string]localRootMeta {
	if f.state.Metadata[ownerID] == nil {
		f.state.Metadata[ownerID] = map[string]localRootMeta{}
	}
	return f.state.Metadata[ownerID]
}

func (f *localFileRoots) ownerConversations(ownerID string) map[string]string {
	if f.state.Conversations[ownerID] == nil {
		f.state.Conversations[ownerID] = map[string]string{}
	}
	return f.state.Conversations[ownerID]
}

func (f *localFileRoots) ownerConversationModes(ownerID string) map[string]string {
	if f.state.ConversationModes == nil {
		f.state.ConversationModes = map[string]map[string]string{}
	}
	if f.state.ConversationModes[ownerID] == nil {
		f.state.ConversationModes[ownerID] = map[string]string{}
	}
	return f.state.ConversationModes[ownerID]
}

func (f *localFileRoots) conversationMode(ownerID, conversationID string) string {
	if f.state.ConversationModes[ownerID][conversationID] == "read" {
		return "read"
	}
	return "write"
}

func (f *localFileRoots) permissionMode(ownerID, conversationID string) string {
	mode := f.state.PermissionModes[ownerID][conversationID]
	if !validPermissionMode(mode) {
		return permissionModeDefault
	}
	return mode
}

func (f *localFileRoots) permissionModeForOwner(ownerID, conversationID string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	_ = f.load()
	return f.permissionMode(ownerID, conversationID)
}

func (f *localFileRoots) setPermissionModeForConversation(ownerID, conversationID, mode string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.load(); err != nil {
		return "", err
	}
	if f.state.PermissionModes == nil {
		f.state.PermissionModes = map[string]map[string]string{}
	}
	if f.state.PermissionModes[ownerID] == nil {
		f.state.PermissionModes[ownerID] = map[string]string{}
	}
	f.state.PermissionModes[ownerID][conversationID] = mode
	if err := f.persist(); err != nil {
		return "", err
	}
	return mode, nil
}

func (f *localFileRoots) normalizeOwner(ownerID string) map[string]localRootMeta {
	metadata := f.ownerMetadata(ownerID)
	if f.state.Owners[ownerID] == nil {
		f.state.Owners[ownerID] = map[string]string{}
	}
	for rootID, path := range f.state.Owners[ownerID] {
		if _, ok := metadata[rootID]; ok {
			continue
		}
		name := filepath.Base(path)
		if name == "" || name == "." || name == string(filepath.Separator) {
			name = path
		}
		now := time.Now().UTC().Format(time.RFC3339)
		metadata[rootID] = localRootMeta{Path: path, Name: name, Mode: "write", CreatedAt: now, UpdatedAt: now}
	}
	return metadata
}

func (f *localFileRoots) findByPath(ownerID, path string) (string, localRootMeta, bool) {
	for rootID, meta := range f.normalizeOwner(ownerID) {
		if meta.Path == path {
			return rootID, meta, true
		}
	}
	return "", localRootMeta{}, false
}

func (f *localFileRoots) setRoot(ownerID, rootID string, meta localRootMeta) {
	if f.state.Owners[ownerID] == nil {
		f.state.Owners[ownerID] = map[string]string{}
	}
	f.state.Owners[ownerID][rootID] = meta.Path
	f.ownerMetadata(ownerID)[rootID] = meta
}

func (f *localFileRoots) view(ownerID, conversationID, rootID, deviceID string) (localFileRootView, bool) {
	meta, ok := f.normalizeOwner(ownerID)[rootID]
	if !ok {
		return localFileRootView{}, false
	}
	return localFileRootView{
		ID: rootID, DeviceID: deviceID, Name: meta.Name, Mode: f.conversationMode(ownerID, conversationID),
		CreatedAt: meta.CreatedAt, UpdatedAt: meta.UpdatedAt,
	}, true
}

// defaultRoot returns the home-folder grant a conversation uses until the
// user explicitly selects another folder.
func (f *localFileRoots) defaultRoot(ownerID, conversationID, deviceID string) (localFileRootView, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return localFileRootView{}, errors.New("DESKTOP_FILE_UNAVAILABLE")
	}
	rootID, meta, ok := f.findByPath(ownerID, home)
	now := time.Now().UTC().Format(time.RFC3339)
	if !ok {
		rootID = newLocalRootID()
		if rootID == "" {
			return localFileRootView{}, errors.New("DESKTOP_FILE_UNAVAILABLE")
		}
		meta = localRootMeta{Path: home, Name: "Home", Mode: "write", CreatedAt: now, UpdatedAt: now}
	}
	meta.UpdatedAt = now
	f.setRoot(ownerID, rootID, meta)
	f.ownerConversations(ownerID)[conversationID] = rootID
	if _, explicit := f.ownerConversationModes(ownerID)[conversationID]; !explicit {
		f.ownerConversationModes(ownerID)[conversationID] = "write"
	}
	if err := f.persist(); err != nil {
		return localFileRootView{}, err
	}
	view, ok := f.view(ownerID, conversationID, rootID, deviceID)
	if !ok {
		return localFileRootView{}, errors.New("DESKTOP_FILE_UNAVAILABLE")
	}
	return view, nil
}

func (f *localFileRoots) rootsForConversation(ownerID, conversationID, deviceID string) ([]localFileRootView, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.load(); err != nil {
		return nil, err
	}
	rootID := f.ownerConversations(ownerID)[conversationID]
	if rootID != "" {
		if view, ok := f.view(ownerID, conversationID, rootID, deviceID); ok {
			return []localFileRootView{view}, nil
		}
	}
	view, err := f.defaultRoot(ownerID, conversationID, deviceID)
	if err != nil {
		return nil, err
	}
	return []localFileRootView{view}, nil
}

func (f *localFileRoots) rootForConversation(ownerID, conversationID, deviceID, requestedRootID string) (localRootMeta, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.load(); err != nil {
		return localRootMeta{}, err
	}
	rootID := f.ownerConversations(ownerID)[conversationID]
	if rootID == "" {
		view, err := f.defaultRoot(ownerID, conversationID, deviceID)
		if err != nil {
			return localRootMeta{}, err
		}
		rootID = view.ID
	}
	if requestedRootID != "" && requestedRootID != rootID {
		return localRootMeta{}, errors.New("DESKTOP_FILE_ACCESS_DENIED")
	}
	meta, ok := f.normalizeOwner(ownerID)[rootID]
	if !ok {
		return localRootMeta{}, errors.New("DESKTOP_FILE_ACCESS_DENIED")
	}
	meta.Mode = f.conversationMode(ownerID, conversationID)
	return meta, nil
}

// SetFileRootMode changes the access mode of the conversation's current
// folder, including the default Home grant, without reopening the picker.
func (d *Desktop) SetFileRootMode(ctx context.Context, conversationID, mode string) (localFileRootView, error) {
	if err := d.checkCaller(ctx); err != nil {
		return localFileRootView{}, err
	}
	if !validUUID(conversationID) || (mode != "read" && mode != "write") {
		return localFileRootView{}, errors.New("VALIDATION_ERROR")
	}
	ownerID, _, ok := d.account.currentAccessTokenIdentity()
	if !ok {
		return localFileRootView{}, errors.New("AUTH_REQUIRED")
	}
	if d.fileRoots == nil {
		return localFileRootView{}, errors.New("DESKTOP_FILE_UNAVAILABLE")
	}
	deviceID, _ := d.storedDeviceIdentity()
	d.fileRoots.mu.Lock()
	defer d.fileRoots.mu.Unlock()
	if err := d.fileRoots.load(); err != nil {
		return localFileRootView{}, err
	}
	rootID := d.fileRoots.ownerConversations(ownerID)[conversationID]
	if rootID == "" {
		view, err := d.fileRoots.defaultRoot(ownerID, conversationID, deviceID)
		if err != nil {
			return localFileRootView{}, err
		}
		rootID = view.ID
	}
	if _, ok := d.fileRoots.normalizeOwner(ownerID)[rootID]; !ok {
		return localFileRootView{}, errors.New("DESKTOP_FILE_UNAVAILABLE")
	}
	d.fileRoots.ownerConversationModes(ownerID)[conversationID] = mode
	if err := d.fileRoots.persist(); err != nil {
		return localFileRootView{}, err
	}
	view, ok := d.fileRoots.view(ownerID, conversationID, rootID, deviceID)
	if !ok {
		return localFileRootView{}, errors.New("DESKTOP_FILE_UNAVAILABLE")
	}
	return view, nil
}

// AddFileRoot opens the native folder picker and grants that folder to one
// conversation. A folder authorized before is reused without another grant.
func (d *Desktop) AddFileRoot(ctx context.Context, conversationID, mode string) (localFileRootView, error) {
	if err := d.checkCaller(ctx); err != nil {
		return localFileRootView{}, err
	}
	if !validUUID(conversationID) || (mode != "read" && mode != "write") {
		return localFileRootView{}, errors.New("VALIDATION_ERROR")
	}
	ownerID, _, ok := d.account.currentAccessTokenIdentity()
	if !ok {
		return localFileRootView{}, errors.New("AUTH_REQUIRED")
	}
	if d.fileRoots == nil {
		return localFileRootView{}, errors.New("DESKTOP_FILE_UNAVAILABLE")
	}
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent:            d.mainWindow(),
		Title:             locales.FileRootPickerTitle(),
		Message:           locales.FileRootPickerMessage(),
		Directory:         true,
		CreateDirectories: true,
	})
	if err != nil || len(paths) == 0 {
		return localFileRootView{}, errors.New("DESKTOP_FILE_PICKER_CANCELLED")
	}
	currentOwner, _, stillCurrent := d.account.currentAccessTokenIdentity()
	if !stillCurrent || currentOwner != ownerID {
		return localFileRootView{}, errors.New("AUTH_REQUIRED")
	}
	selected, err := filepath.Abs(paths[0])
	if err != nil {
		return localFileRootView{}, errors.New("DESKTOP_FILE_INVALID_PATH")
	}
	selected, err = filepath.EvalSymlinks(selected)
	if err != nil {
		return localFileRootView{}, errors.New("DESKTOP_FILE_INVALID_PATH")
	}
	info, err := os.Stat(selected)
	if err != nil || !info.IsDir() {
		return localFileRootView{}, errors.New("DESKTOP_FILE_INVALID_PATH")
	}
	name := filepath.Base(selected)
	if name == "" || name == "." || name == string(filepath.Separator) {
		return localFileRootView{}, errors.New("DESKTOP_FILE_INVALID_PATH")
	}
	deviceID, _ := d.storedDeviceIdentity()
	d.fileRoots.mu.Lock()
	defer d.fileRoots.mu.Unlock()
	if err := d.fileRoots.load(); err != nil {
		return localFileRootView{}, err
	}
	rootID, meta, exists := d.fileRoots.findByPath(ownerID, selected)
	now := time.Now().UTC().Format(time.RFC3339)
	if !exists {
		rootID = newLocalRootID()
		if rootID == "" {
			return localFileRootView{}, errors.New("DESKTOP_FILE_UNAVAILABLE")
		}
		meta = localRootMeta{Path: selected, Name: name, Mode: mode, CreatedAt: now, UpdatedAt: now}
	} else {
		meta.Name = name
		meta.Mode = mode
		meta.UpdatedAt = now
	}
	d.fileRoots.setRoot(ownerID, rootID, meta)
	d.fileRoots.ownerConversations(ownerID)[conversationID] = rootID
	d.fileRoots.ownerConversationModes(ownerID)[conversationID] = mode
	if err := d.fileRoots.persist(); err != nil {
		return localFileRootView{}, err
	}
	view, ok := d.fileRoots.view(ownerID, conversationID, rootID, deviceID)
	if !ok {
		return localFileRootView{}, errors.New("DESKTOP_FILE_UNAVAILABLE")
	}
	return view, nil
}
