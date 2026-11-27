package main

import (
	"context"
	"errors"
	"path"
	"path/filepath"
)

// localFileListing is one directory of the conversation's granted folder for
// the composer's @ menu. Paths are relative to the grant; no absolute path
// leaves the Mac.
type localFileListing struct {
	RootName  string           `json:"root_name"`
	Mode      string           `json:"mode"`
	Path      string           `json:"path"`
	Entries   []localFileEntry `json:"entries"`
	Truncated bool             `json:"truncated"`
}

// FileRoot returns the conversation's granted folder for the local UI. It
// grants the default Home folder on first use, exactly like the cloud tools.
func (d *Desktop) FileRoot(ctx context.Context, conversationID string) (localFileRootView, error) {
	if err := d.checkCaller(ctx); err != nil {
		return localFileRootView{}, err
	}
	if !validUUID(conversationID) {
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
	roots, err := d.fileRoots.rootsForConversation(ownerID, conversationID, deviceID)
	if err != nil {
		return localFileRootView{}, err
	}
	return roots[0], nil
}

// ListFileRoot lists one directory of that folder for the composer's @ menu.
// It uses the same containment and symlink rules as the cloud file tools.
func (d *Desktop) ListFileRoot(ctx context.Context, conversationID, relativePath string) (localFileListing, error) {
	if err := d.checkCaller(ctx); err != nil {
		return localFileListing{}, err
	}
	if !validUUID(conversationID) {
		return localFileListing{}, errors.New("VALIDATION_ERROR")
	}
	ownerID, _, ok := d.account.currentAccessTokenIdentity()
	if !ok {
		return localFileListing{}, errors.New("AUTH_REQUIRED")
	}
	deviceID, _ := d.storedDeviceIdentity()
	return listConversationFileRoot(ctx, d.fileRoots, ownerID, conversationID, deviceID, relativePath)
}

func listConversationFileRoot(
	ctx context.Context,
	roots *localFileRoots,
	ownerID, conversationID, deviceID, relativePath string,
) (localFileListing, error) {
	if roots == nil {
		return localFileListing{}, errors.New("DESKTOP_FILE_UNAVAILABLE")
	}
	meta, err := roots.rootForConversation(ownerID, conversationID, deviceID, "")
	if err != nil {
		return localFileListing{}, errors.New("DESKTOP_FILE_ACCESS_DENIED")
	}
	canonicalRoot, err := filepath.EvalSymlinks(meta.Path)
	if err != nil {
		return localFileListing{}, errors.New("DESKTOP_FILE_NOT_FOUND")
	}
	cleaned := ""
	if relativePath != "" {
		cleaned = path.Clean(filepath.ToSlash(relativePath))
		if cleaned == "." {
			cleaned = ""
		}
	}
	result, err := listLocalFiles(ctx, canonicalRoot, localFilesListInput{
		Path: cleaned, Limit: localFileListDefault,
	})
	if err != nil {
		return localFileListing{}, err
	}
	listing := localFileListing{
		RootName: meta.Name, Mode: meta.Mode, Path: cleaned,
		Entries:   make([]localFileEntry, 0, len(result.Entries)),
		Truncated: result.Truncated,
	}
	for _, entry := range result.Entries {
		// Symlinks and special files stay out of the picker; the cloud tools
		// refuse them too.
		if entry.Kind != "file" && entry.Kind != "directory" {
			continue
		}
		listing.Entries = append(listing.Entries, entry)
	}
	return listing, nil
}
