package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/egoist/mygo"
)

const (
	localFileMaxBytes      = 1_048_576
	localFileReadDefault   = 262_144
	localFileSearchDefault = 50
	localFileListDefault   = 100
)

var localFileSearchExcludedDirectories = map[string]struct{}{
	".git": {}, ".hg": {}, ".svn": {}, "node_modules": {}, "dist": {},
	"build": {}, "coverage": {}, ".next": {}, ".cache": {}, "vendor": {},
	"Pods": {}, "DerivedData": {},
}

var localFileTrashItem = func(path string) error {
	return mygo.Shell.TrashItem(path)
}

type localFileToolError struct{ code string }

func (e *localFileToolError) Error() string { return e.code }

func localFileFailure(code string) error { return &localFileToolError{code: code} }

type localFileRootInput struct {
	RootID string `json:"root_id"`
}

type localFilesListInput struct {
	RootID string `json:"root_id"`
	Path   string `json:"path"`
	Limit  int    `json:"limit"`
}

type localFilesReadInput struct {
	RootID   string `json:"root_id"`
	Path     string `json:"path"`
	MaxBytes int    `json:"max_bytes"`
}

type localFilesSearchInput struct {
	RootID     string `json:"root_id"`
	Path       string `json:"path"`
	Query      string `json:"query"`
	MaxResults int    `json:"max_results"`
}

type localFilesWriteInput struct {
	RootID         string  `json:"root_id"`
	Path           string  `json:"path"`
	Content        string  `json:"content"`
	ExpectedDigest *string `json:"expected_digest"`
	CreateParents  bool    `json:"create_parents"`
}

type localFilesCreateInput struct {
	RootID  string  `json:"root_id"`
	Path    string  `json:"path"`
	Kind    string  `json:"kind"`
	Content *string `json:"content"`
}

type localFilesDeleteInput struct {
	RootID         string  `json:"root_id"`
	Path           string  `json:"path"`
	ExpectedDigest *string `json:"expected_digest"`
}

type localFileEntry struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Kind       string `json:"kind"`
	Size       int64  `json:"size"`
	ModifiedAt string `json:"modified_at"`
}

type localFilesListResult struct {
	Entries   []localFileEntry `json:"entries"`
	Truncated bool             `json:"truncated"`
}

type localFilesReadResult struct {
	Path       string  `json:"path"`
	Kind       string  `json:"kind"`
	Content    *string `json:"content,omitempty"`
	Digest     *string `json:"digest"`
	Size       int64   `json:"size"`
	ModifiedAt string  `json:"modified_at"`
	Truncated  bool    `json:"truncated"`
}

type localFileSearchMatch struct {
	Path    string `json:"path"`
	Line    int    `json:"line"`
	Column  int    `json:"column"`
	Preview string `json:"preview"`
}

type localFilesSearchResult struct {
	Matches   []localFileSearchMatch `json:"matches"`
	Truncated bool                   `json:"truncated"`
}

type localFilesWriteResult struct {
	Path       string `json:"path"`
	Digest     string `json:"digest"`
	Size       int64  `json:"size"`
	ModifiedAt string `json:"modified_at"`
	Created    bool   `json:"created"`
}

type localFilesCreateResult struct {
	Path       string  `json:"path"`
	Kind       string  `json:"kind"`
	Digest     *string `json:"digest"`
	Size       *int64  `json:"size"`
	ModifiedAt string  `json:"modified_at"`
}

type localFilesDeleteResult struct {
	Path    string `json:"path"`
	Trashed bool   `json:"trashed"`
}

func decodeLocalFileInput(raw json.RawMessage, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return localFileFailure("DESKTOP_FILE_UNSUPPORTED")
	}
	if decoder.More() {
		return localFileFailure("DESKTOP_FILE_UNSUPPORTED")
	}
	return nil
}

// executeLocalFileTool runs one file operation against a root that the server
// already authorized. All paths are resolved under the canonical root and
// symlinks are never followed out of it.
func executeLocalFileTool(
	ctx context.Context,
	roots *localFileRoots,
	approvals *cloudApprovalCenter,
	ownerID string,
	conversationID string,
	deviceID string,
	operation string,
	raw json.RawMessage,
) (any, error) {
	if roots == nil {
		return nil, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
	}
	if operation == "local_files.roots" {
		list, err := roots.rootsForConversation(ownerID, conversationID, deviceID)
		if err != nil {
			return nil, err
		}
		return localFilesRootsResult{Roots: list}, nil
	}
	var rootInput localFileRootInput
	if err := json.Unmarshal(raw, &rootInput); err != nil {
		return nil, localFileFailure("DESKTOP_FILE_UNSUPPORTED")
	}
	meta, err := roots.rootForConversation(ownerID, conversationID, deviceID, rootInput.RootID)
	if err != nil {
		return nil, localFileFailure("DESKTOP_FILE_ACCESS_DENIED")
	}
	if operation == "local_files.write" || operation == "local_files.create" ||
		operation == "local_files.delete" {
		if meta.Mode != "write" {
			return nil, localFileFailure("DESKTOP_FILE_ACCESS_DENIED")
		}
	}
	root := meta.Path
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, localFileFailure("DESKTOP_FILE_NOT_FOUND")
	}
	info, err := os.Stat(canonicalRoot)
	if err != nil || !info.IsDir() {
		return nil, localFileFailure("DESKTOP_FILE_NOT_FOUND")
	}
	switch operation {
	case "local_files.list":
		var input localFilesListInput
		if err := decodeLocalFileInput(raw, &input); err != nil {
			return nil, err
		}
		return listLocalFiles(ctx, canonicalRoot, input)
	case "local_files.read":
		var input localFilesReadInput
		if err := decodeLocalFileInput(raw, &input); err != nil {
			return nil, err
		}
		return readLocalFile(ctx, canonicalRoot, input)
	case "local_files.search":
		var input localFilesSearchInput
		if err := decodeLocalFileInput(raw, &input); err != nil {
			return nil, err
		}
		return searchLocalFiles(ctx, canonicalRoot, input)
	case "local_files.write":
		var input localFilesWriteInput
		if err := decodeLocalFileInput(raw, &input); err != nil {
			return nil, err
		}
		if err := approveLocalFileChange(ctx, approvals, roots, ownerID, conversationID,
			meta.Name, operation, input.Path); err != nil {
			return nil, err
		}
		return writeLocalFile(ctx, canonicalRoot, input)
	case "local_files.create":
		var input localFilesCreateInput
		if err := decodeLocalFileInput(raw, &input); err != nil {
			return nil, err
		}
		if err := approveLocalFileChange(ctx, approvals, roots, ownerID, conversationID,
			meta.Name, operation, input.Path); err != nil {
			return nil, err
		}
		return createLocalEntry(ctx, canonicalRoot, input)
	case "local_files.delete":
		var input localFilesDeleteInput
		if err := decodeLocalFileInput(raw, &input); err != nil {
			return nil, err
		}
		if err := approveLocalFileChange(ctx, approvals, roots, ownerID, conversationID,
			meta.Name, operation, input.Path); err != nil {
			return nil, err
		}
		return deleteLocalEntry(ctx, canonicalRoot, input)
	default:
		return nil, localFileFailure("DESKTOP_FILE_UNSUPPORTED")
	}
}

// approveLocalFileChange applies the conversation's permission mode to a
// mutating file tool. Manual asks this Mac first; every other mode runs it.
func approveLocalFileChange(
	ctx context.Context,
	approvals *cloudApprovalCenter,
	roots *localFileRoots,
	ownerID, conversationID, rootName, operation, path string,
) error {
	if !writeApprovalRequired(roots.permissionModeForOwner(ownerID, conversationID)) {
		return nil
	}
	return requestApproval(ctx, approvals, cloudApprovalRequest{
		ConversationID: conversationID,
		Kind:           cloudApprovalKindFileChange,
		Operation:      operation,
		Path:           path,
		RootName:       rootName,
	})
}

func validLocalRelativePath(relative string, allowRoot bool) bool {
	if strings.ContainsRune(relative, 0) || strings.Contains(relative, "\\") {
		return false
	}
	if relative == "" {
		return allowRoot
	}
	for _, segment := range strings.Split(filepath.ToSlash(relative), "/") {
		if segment == "" || segment == "." || segment == ".." {
			return false
		}
	}
	return true
}

func resolveLocalTarget(canonicalRoot, relative string, allowRoot bool) (string, string, error) {
	if !validLocalRelativePath(relative, allowRoot) {
		return "", "", localFileFailure("DESKTOP_FILE_INVALID_PATH")
	}
	cleaned := filepath.Clean(filepath.FromSlash(relative))
	if cleaned == "." {
		if !allowRoot {
			return "", "", localFileFailure("DESKTOP_FILE_INVALID_PATH")
		}
		return canonicalRoot, "", nil
	}
	if filepath.IsAbs(cleaned) || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", "", localFileFailure("DESKTOP_FILE_INVALID_PATH")
	}
	target := filepath.Join(canonicalRoot, cleaned)
	if !localPathWithin(canonicalRoot, target) {
		return "", "", localFileFailure("DESKTOP_FILE_INVALID_PATH")
	}
	logical := filepath.ToSlash(cleaned)
	info, err := os.Lstat(target)
	if err == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return "", "", localFileFailure("DESKTOP_FILE_ACCESS_DENIED")
		}
		real, err := filepath.EvalSymlinks(target)
		if err != nil || !localPathWithin(canonicalRoot, real) {
			return "", "", localFileFailure("DESKTOP_FILE_ACCESS_DENIED")
		}
		return real, logical, nil
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return "", "", localFileFailure("DESKTOP_FILE_UNAVAILABLE")
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(target))
	if err != nil {
		return "", "", localFileFailure("DESKTOP_FILE_NOT_FOUND")
	}
	if !localPathWithin(canonicalRoot, parent) {
		return "", "", localFileFailure("DESKTOP_FILE_ACCESS_DENIED")
	}
	return filepath.Join(parent, filepath.Base(target)), logical, nil
}

// resolveLocalTargetAllowMissing keeps a not-yet-created path under the root
// while still resolving the nearest existing ancestor, so a symlinked parent
// cannot redirect the write outside the grant.
func resolveLocalTargetAllowMissing(canonicalRoot, relative string) (string, string, error) {
	if !validLocalRelativePath(relative, false) {
		return "", "", localFileFailure("DESKTOP_FILE_INVALID_PATH")
	}
	cleaned := filepath.Clean(filepath.FromSlash(relative))
	logical := filepath.ToSlash(cleaned)
	target := filepath.Join(canonicalRoot, cleaned)
	if !localPathWithin(canonicalRoot, target) {
		return "", "", localFileFailure("DESKTOP_FILE_INVALID_PATH")
	}
	ancestor := filepath.Dir(target)
	for {
		if _, err := os.Lstat(ancestor); err == nil {
			break
		}
		next := filepath.Dir(ancestor)
		if next == ancestor {
			return "", "", localFileFailure("DESKTOP_FILE_NOT_FOUND")
		}
		ancestor = next
	}
	realAncestor, err := filepath.EvalSymlinks(ancestor)
	if err != nil || !localPathWithin(canonicalRoot, realAncestor) {
		return "", "", localFileFailure("DESKTOP_FILE_ACCESS_DENIED")
	}
	suffix, err := filepath.Rel(ancestor, target)
	if err != nil {
		return "", "", localFileFailure("DESKTOP_FILE_INVALID_PATH")
	}
	resolved := filepath.Join(realAncestor, suffix)
	if !localPathWithin(canonicalRoot, resolved) {
		return "", "", localFileFailure("DESKTOP_FILE_ACCESS_DENIED")
	}
	return resolved, logical, nil
}

func localPathWithin(root, target string) bool {
	relative, err := filepath.Rel(root, target)
	if err != nil || filepath.IsAbs(relative) {
		return false
	}
	return relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func localFileTimestamp(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}

func localFileDigest(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func listLocalFiles(ctx context.Context, root string, input localFilesListInput) (localFilesListResult, error) {
	target, logical, err := resolveLocalTarget(root, input.Path, true)
	if err != nil {
		return localFilesListResult{}, err
	}
	info, err := os.Stat(target)
	if err != nil || !info.IsDir() {
		return localFilesListResult{}, localFileFailure("DESKTOP_FILE_NOT_FOUND")
	}
	limit := input.Limit
	if limit <= 0 || limit > 200 {
		limit = localFileListDefault
	}
	entries, err := os.ReadDir(target)
	if err != nil {
		return localFilesListResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
	}
	sort.Slice(entries, func(left, right int) bool { return entries[left].Name() < entries[right].Name() })
	result := localFilesListResult{Entries: make([]localFileEntry, 0, min(len(entries), limit))}
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return localFilesListResult{}, localFileFailure("DESKTOP_TOOL_UNAVAILABLE")
		}
		if len(result.Entries) >= limit {
			result.Truncated = true
			break
		}
		entryInfo, err := entry.Info()
		if err != nil {
			continue
		}
		kind := "other"
		switch {
		case entry.Type()&os.ModeSymlink != 0:
			kind = "symlink"
		case entry.IsDir():
			kind = "directory"
		case entry.Type().IsRegular():
			kind = "file"
		}
		entryPath := entry.Name()
		if logical != "" {
			entryPath = path.Join(logical, entry.Name())
		}
		size := entryInfo.Size()
		if kind == "directory" || kind == "symlink" {
			size = 0
		}
		result.Entries = append(result.Entries, localFileEntry{
			Name:       entry.Name(),
			Path:       entryPath,
			Kind:       kind,
			Size:       size,
			ModifiedAt: localFileTimestamp(entryInfo.ModTime()),
		})
	}
	return result, nil
}

func readLocalFile(ctx context.Context, root string, input localFilesReadInput) (localFilesReadResult, error) {
	if err := ctx.Err(); err != nil {
		return localFilesReadResult{}, localFileFailure("DESKTOP_TOOL_UNAVAILABLE")
	}
	target, logical, err := resolveLocalTarget(root, input.Path, false)
	if err != nil {
		return localFilesReadResult{}, err
	}
	info, err := os.Stat(target)
	if err != nil || !info.Mode().IsRegular() {
		return localFilesReadResult{}, localFileFailure("DESKTOP_FILE_NOT_FOUND")
	}
	maxBytes := input.MaxBytes
	if maxBytes <= 0 || maxBytes > localFileMaxBytes {
		maxBytes = localFileReadDefault
	}
	truncated := info.Size() > int64(maxBytes)
	var data []byte
	if truncated {
		file, err := os.Open(target)
		if err != nil {
			return localFilesReadResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
		}
		data, err = io.ReadAll(io.LimitReader(file, int64(maxBytes)))
		closeErr := file.Close()
		if err != nil || closeErr != nil {
			return localFilesReadResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
		}
	} else {
		var err error
		data, err = os.ReadFile(target)
		if err != nil {
			return localFilesReadResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
		}
	}
	result := localFilesReadResult{
		Path: logical, Size: info.Size(),
		ModifiedAt: localFileTimestamp(info.ModTime()),
		Truncated:  truncated,
	}
	if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		result.Kind = "binary"
		return result, nil
	}
	content := string(data)
	result.Kind = "text"
	result.Content = &content
	if !truncated {
		digest := localFileDigest(data)
		result.Digest = &digest
	}
	return result, nil
}

func searchLocalFiles(ctx context.Context, root string, input localFilesSearchInput) (localFilesSearchResult, error) {
	target, _, err := resolveLocalTarget(root, input.Path, true)
	if err != nil {
		return localFilesSearchResult{}, err
	}
	info, err := os.Stat(target)
	if err != nil || !info.IsDir() {
		return localFilesSearchResult{}, localFileFailure("DESKTOP_FILE_NOT_FOUND")
	}
	query := strings.ToLower(strings.TrimSpace(input.Query))
	if query == "" {
		return localFilesSearchResult{}, localFileFailure("DESKTOP_FILE_UNSUPPORTED")
	}
	limit := input.MaxResults
	if limit <= 0 || limit > 200 {
		limit = localFileSearchDefault
	}
	result := localFilesSearchResult{Matches: make([]localFileSearchMatch, 0, min(limit, 16))}
	errStop := errors.New("stop")
	walkErr := filepath.WalkDir(target, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if err := ctx.Err(); err != nil {
			return errStop
		}
		if entry.IsDir() {
			if current != target {
				if _, excluded := localFileSearchExcludedDirectories[entry.Name()]; excluded {
					return filepath.SkipDir
				}
			}
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		entryInfo, err := entry.Info()
		if err != nil || entryInfo.Size() > localFileMaxBytes {
			return nil
		}
		data, err := os.ReadFile(current)
		if err != nil || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
			return nil
		}
		relative, err := filepath.Rel(root, current)
		if err != nil || !localPathWithin(root, current) {
			return nil
		}
		for lineIndex, line := range strings.Split(string(data), "\n") {
			lower := strings.ToLower(line)
			column := strings.Index(lower, query)
			if column < 0 {
				continue
			}
			if len(result.Matches) >= limit {
				result.Truncated = true
				return errStop
			}
			preview := strings.TrimSpace(line)
			if utf8.RuneCountInString(preview) > 240 {
				runes := []rune(preview)
				preview = strings.TrimSpace(string(runes[:237])) + "..."
			}
			result.Matches = append(result.Matches, localFileSearchMatch{
				Path: filepath.ToSlash(relative), Line: lineIndex + 1,
				Column: utf8.RuneCountInString(line[:column]) + 1, Preview: preview,
			})
		}
		return nil
	})
	if walkErr != nil && !errors.Is(walkErr, errStop) {
		return localFilesSearchResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
	}
	return result, nil
}

func writeLocalFile(ctx context.Context, root string, input localFilesWriteInput) (localFilesWriteResult, error) {
	if err := ctx.Err(); err != nil {
		return localFilesWriteResult{}, localFileFailure("DESKTOP_TOOL_UNAVAILABLE")
	}
	if len(input.Content) > localFileMaxBytes {
		return localFilesWriteResult{}, localFileFailure("DESKTOP_FILE_TOO_LARGE")
	}
	target, logical, err := resolveLocalTarget(root, input.Path, false)
	if err != nil {
		var failure *localFileToolError
		if !input.CreateParents || !errors.As(err, &failure) ||
			failure.code != "DESKTOP_FILE_NOT_FOUND" {
			return localFilesWriteResult{}, err
		}
		target, logical, err = resolveLocalTargetAllowMissing(root, input.Path)
		if err != nil {
			return localFilesWriteResult{}, err
		}
	}
	created := false
	existingDigest := ""
	info, statErr := os.Stat(target)
	if statErr == nil {
		if !info.Mode().IsRegular() {
			return localFilesWriteResult{}, localFileFailure("DESKTOP_FILE_UNSUPPORTED")
		}
		if info.Size() > localFileMaxBytes {
			return localFilesWriteResult{}, localFileFailure("DESKTOP_FILE_TOO_LARGE")
		}
		existing, err := os.ReadFile(target)
		if err != nil {
			return localFilesWriteResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
		}
		existingDigest = localFileDigest(existing)
		// An existing file is never overwritten without the digest the caller
		// observed, so an external edit always surfaces as a conflict.
		if input.ExpectedDigest == nil || *input.ExpectedDigest != existingDigest {
			return localFilesWriteResult{}, localFileFailure("DESKTOP_FILE_CONFLICT")
		}
	} else if errors.Is(statErr, fs.ErrNotExist) {
		if input.ExpectedDigest != nil {
			return localFilesWriteResult{}, localFileFailure("DESKTOP_FILE_CONFLICT")
		}
		parent := filepath.Dir(target)
		if _, err := os.Stat(parent); err != nil {
			if !input.CreateParents {
				return localFilesWriteResult{}, localFileFailure("DESKTOP_FILE_NOT_FOUND")
			}
			if !localPathWithin(root, parent) {
				return localFilesWriteResult{}, localFileFailure("DESKTOP_FILE_ACCESS_DENIED")
			}
			if err := os.MkdirAll(parent, 0o755); err != nil {
				return localFilesWriteResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
			}
		}
		created = true
	} else {
		return localFilesWriteResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
	}
	temporary, err := os.CreateTemp(filepath.Dir(target), ".linksense-write-*")
	if err != nil {
		return localFilesWriteResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
	}
	temporaryPath := temporary.Name()
	defer func() { _ = os.Remove(temporaryPath) }()
	mode := os.FileMode(0o644)
	if statErr == nil {
		mode = info.Mode().Perm()
	}
	if err := temporary.Chmod(mode); err != nil {
		_ = temporary.Close()
		return localFilesWriteResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
	}
	if _, err := io.WriteString(temporary, input.Content); err != nil {
		_ = temporary.Close()
		return localFilesWriteResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
	}
	if err := temporary.Close(); err != nil {
		return localFilesWriteResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
	}
	if err := os.Rename(temporaryPath, target); err != nil {
		return localFilesWriteResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
	}
	written, err := os.Stat(target)
	if err != nil {
		return localFilesWriteResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
	}
	return localFilesWriteResult{
		Path: logical, Digest: localFileDigest([]byte(input.Content)),
		Size: int64(len(input.Content)), ModifiedAt: localFileTimestamp(written.ModTime()),
		Created: created,
	}, nil
}

func createLocalEntry(ctx context.Context, root string, input localFilesCreateInput) (localFilesCreateResult, error) {
	if err := ctx.Err(); err != nil {
		return localFilesCreateResult{}, localFileFailure("DESKTOP_TOOL_UNAVAILABLE")
	}
	if input.Kind != "file" && input.Kind != "directory" {
		return localFilesCreateResult{}, localFileFailure("DESKTOP_FILE_UNSUPPORTED")
	}
	if input.Kind == "directory" && input.Content != nil {
		return localFilesCreateResult{}, localFileFailure("DESKTOP_FILE_UNSUPPORTED")
	}
	if input.Content != nil && len(*input.Content) > localFileMaxBytes {
		return localFilesCreateResult{}, localFileFailure("DESKTOP_FILE_TOO_LARGE")
	}
	target, logical, err := resolveLocalTarget(root, input.Path, false)
	if err != nil {
		return localFilesCreateResult{}, err
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(target))
	if err != nil || !localPathWithin(root, parent) {
		return localFilesCreateResult{}, localFileFailure("DESKTOP_FILE_NOT_FOUND")
	}
	target = filepath.Join(parent, filepath.Base(target))
	if _, err := os.Lstat(target); err == nil {
		return localFilesCreateResult{}, localFileFailure("DESKTOP_FILE_CONFLICT")
	} else if !errors.Is(err, fs.ErrNotExist) {
		return localFilesCreateResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
	}
	result := localFilesCreateResult{Path: logical, Kind: input.Kind}
	if input.Kind == "directory" {
		if err := os.Mkdir(target, 0o755); err != nil {
			return localFilesCreateResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
		}
	} else {
		file, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err != nil {
			return localFilesCreateResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
		}
		content := ""
		if input.Content != nil {
			content = *input.Content
		}
		if _, err := io.WriteString(file, content); err != nil {
			_ = file.Close()
			_ = os.Remove(target)
			return localFilesCreateResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
		}
		if err := file.Close(); err != nil {
			return localFilesCreateResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
		}
		digest := localFileDigest([]byte(content))
		size := int64(len(content))
		result.Digest = &digest
		result.Size = &size
	}
	info, err := os.Stat(target)
	if err != nil {
		return localFilesCreateResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
	}
	result.ModifiedAt = localFileTimestamp(info.ModTime())
	return result, nil
}

func deleteLocalEntry(ctx context.Context, root string, input localFilesDeleteInput) (localFilesDeleteResult, error) {
	if err := ctx.Err(); err != nil {
		return localFilesDeleteResult{}, localFileFailure("DESKTOP_TOOL_UNAVAILABLE")
	}
	target, logical, err := resolveLocalTarget(root, input.Path, false)
	if err != nil {
		return localFilesDeleteResult{}, err
	}
	if target == root || logical == "" {
		return localFilesDeleteResult{}, localFileFailure("DESKTOP_FILE_ACCESS_DENIED")
	}
	info, err := os.Stat(target)
	if err != nil {
		return localFilesDeleteResult{}, localFileFailure("DESKTOP_FILE_NOT_FOUND")
	}
	if input.ExpectedDigest != nil {
		if !info.Mode().IsRegular() || info.Size() > localFileMaxBytes {
			return localFilesDeleteResult{}, localFileFailure("DESKTOP_FILE_CONFLICT")
		}
		data, err := os.ReadFile(target)
		if err != nil {
			return localFilesDeleteResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
		}
		if localFileDigest(data) != *input.ExpectedDigest {
			return localFilesDeleteResult{}, localFileFailure("DESKTOP_FILE_CONFLICT")
		}
	}
	if err := localFileTrashItem(target); err != nil {
		return localFilesDeleteResult{}, localFileFailure("DESKTOP_FILE_UNAVAILABLE")
	}
	return localFilesDeleteResult{Path: logical, Trashed: true}, nil
}
