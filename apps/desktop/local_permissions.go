package main

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
)

// The four permission modes match Claude Code. There is deliberately no Plan
// mode: a cloud task keeps running; the mode only decides when this Mac asks
// the person before a command or a file change.
const (
	permissionModeAuto        = "auto"
	permissionModeManual      = "manual"
	permissionModeAcceptEdits = "accept_edits"
	permissionModeBypass      = "bypass"
	permissionModeDefault     = permissionModeManual
)

var errPermissionModeInvalid = errors.New("DESKTOP_PERMISSION_MODE_INVALID")

func validPermissionMode(mode string) bool {
	switch mode {
	case permissionModeAuto, permissionModeManual, permissionModeAcceptEdits, permissionModeBypass:
		return true
	}
	return false
}

// writeApprovalRequired keeps reads free in every mode; only a mutating file
// operation can ask. Accept edits, auto and bypass auto-approve the write.
func writeApprovalRequired(mode string) bool {
	return mode == permissionModeManual
}

// shellApprovalRequired is the explicit Auto boundary. Auto runs a command
// without asking only when autoApprovedShellCommand proves it is one plain
// read-only command whose path-like arguments stay inside the granted folder.
// Every other mode asks (Manual, Accept edits) or never asks (Bypass).
func shellApprovalRequired(mode, command, canonicalRoot string) bool {
	switch mode {
	case permissionModeBypass:
		return false
	case permissionModeAuto:
		return !autoApprovedShellCommand(command, canonicalRoot)
	default:
		return true
	}
}

var autoApprovedShellPrograms = map[string]struct{}{
	"cat": {}, "date": {}, "diff": {}, "df": {}, "du": {}, "echo": {},
	"file": {}, "git": {}, "grep": {}, "head": {}, "id": {}, "ls": {},
	"printf": {}, "pwd": {}, "rg": {}, "stat": {}, "sw_vers": {},
	"tail": {}, "tree": {}, "uname": {}, "wc": {}, "which": {}, "whoami": {},
}

var autoApprovedGitSubcommands = map[string]struct{}{
	"blame": {}, "cat-file": {}, "describe": {}, "diff": {}, "grep": {},
	"log": {}, "ls-files": {}, "ls-tree": {}, "rev-parse": {},
	"shortlog": {}, "show": {}, "status": {},
}

var autoApprovedGitFlagOnlySubcommands = map[string]struct{}{
	"branch": {}, "remote": {}, "tag": {},
}

var autoApprovedGitFlagOnlyFlags = map[string]struct{}{
	"-a": {}, "-l": {}, "-r": {}, "-v": {}, "--all": {}, "--list": {},
	"--remotes": {}, "--show-current": {}, "--verbose": {},
}

// shellMetacharacters is conservative on purpose: quoting and composition are
// never auto-approved even when the pieces would be safe.
const shellMetacharacters = ";&|><`$(){}'\"\\*?[]\n\r"

var autoDeniedFlags = map[string]struct{}{
	"-o": {}, "-exec": {}, "-execdir": {}, "-delete": {}, "-ok": {},
	"-okdir": {}, "-fprint": {}, "-fprintf": {}, "-fls": {},
	"--output": {}, "--ext-diff": {}, "--textconv": {}, "--upload-pack": {},
	"--receive-pack": {}, "--exec": {}, "-C": {}, "--git-dir": {},
	"--work-tree": {}, "-c": {}, "--exec-path": {},
}

// autoApprovedShellCommand decides only whether the local person is spared the
// prompt. A false answer is never a denial; it asks.
func autoApprovedShellCommand(command, canonicalRoot string) bool {
	if command == "" || strings.TrimSpace(command) != command {
		return false
	}
	if strings.ContainsAny(command, shellMetacharacters) {
		return false
	}
	fields := strings.Fields(command)
	if len(fields) == 0 {
		return false
	}
	program := fields[0]
	if program != filepath.Base(program) || strings.ContainsAny(program, "=~") {
		return false
	}
	if _, ok := autoApprovedShellPrograms[program]; !ok {
		return false
	}
	args := fields[1:]
	for _, arg := range args {
		if _, denied := autoDeniedFlags[arg]; denied {
			return false
		}
		if strings.HasPrefix(arg, "--output=") {
			return false
		}
		// Flags may take a value in the next token; that token is checked on
		// its own. A --flag=value pair checks the value here.
		if strings.HasPrefix(arg, "-") {
			if index := strings.Index(arg, "="); index > 0 {
				if !autoShellArgumentInsideRoot(arg[index+1:], canonicalRoot) {
					return false
				}
			}
			continue
		}
		if !autoShellArgumentInsideRoot(arg, canonicalRoot) {
			return false
		}
	}
	if program != "git" {
		return true
	}
	return autoApprovedGitCommand(args, canonicalRoot)
}

func autoApprovedGitCommand(args []string, canonicalRoot string) bool {
	subcommand := ""
	rest := []string(nil)
	for index, arg := range args {
		if strings.HasPrefix(arg, "-") {
			if _, denied := autoDeniedFlags[arg]; denied {
				return false
			}
			continue
		}
		subcommand, rest = arg, args[index+1:]
		break
	}
	if subcommand == "" {
		return false
	}
	if _, ok := autoApprovedGitSubcommands[subcommand]; ok {
		return true
	}
	if _, ok := autoApprovedGitFlagOnlySubcommands[subcommand]; !ok {
		return false
	}
	for _, arg := range rest {
		if _, ok := autoApprovedGitFlagOnlyFlags[arg]; !ok {
			return false
		}
	}
	return true
}

// autoShellArgumentInsideRoot accepts plain words, flags with in-root values
// and relative paths whose nearest existing ancestor stays inside the grant.
// Absolute, home, parent and symlink-escaping paths never auto-run.
func autoShellArgumentInsideRoot(value, canonicalRoot string) bool {
	if value == "" {
		return true
	}
	if strings.ContainsRune(value, 0) || strings.HasPrefix(value, "~") ||
		strings.HasPrefix(value, "/") || strings.Contains(value, "..") {
		return false
	}
	if value == "." {
		return true
	}
	if value != strings.TrimSpace(value) {
		return false
	}
	_, _, err := resolveLocalTargetAllowMissing(canonicalRoot, value)
	return err == nil
}

// PermissionMode returns the conversation's saved mode; a conversation that
// never chose one is Manual.
func (d *Desktop) PermissionMode(ctx context.Context, conversationID string) (string, error) {
	if err := d.checkCaller(ctx); err != nil {
		return "", err
	}
	if !validUUID(conversationID) {
		return "", errors.New("VALIDATION_ERROR")
	}
	ownerID, _, ok := d.account.currentAccessTokenIdentity()
	if !ok {
		return "", errors.New("AUTH_REQUIRED")
	}
	if d.fileRoots == nil {
		return permissionModeDefault, nil
	}
	return d.fileRoots.permissionModeForOwner(ownerID, conversationID), nil
}

// SetPermissionMode saves the mode for this conversation on this Mac. The mode
// is a local trust decision and never leaves the Mac.
func (d *Desktop) SetPermissionMode(ctx context.Context, conversationID, mode string) (string, error) {
	if err := d.checkCaller(ctx); err != nil {
		return "", err
	}
	if !validUUID(conversationID) || !validPermissionMode(mode) {
		return "", errPermissionModeInvalid
	}
	ownerID, _, ok := d.account.currentAccessTokenIdentity()
	if !ok {
		return "", errors.New("AUTH_REQUIRED")
	}
	if d.fileRoots == nil {
		return "", errors.New("DESKTOP_FILE_UNAVAILABLE")
	}
	return d.fileRoots.setPermissionModeForConversation(ownerID, conversationID, mode)
}
