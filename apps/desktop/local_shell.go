package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	localShellCommandMaxBytes   = 16_384
	localShellOutputMaxBytes    = 65_536
	localShellDefaultTimeout    = 30 * time.Second
	localShellMaxTimeout        = 120 * time.Second
	localShellApprovalTimeout   = 45 * time.Second
	localShellProgram           = "/bin/zsh"
	localShellOperationConstant = "local_shell.exec"
)

type localShellExecInput struct {
	RootID    string `json:"root_id"`
	Cwd       string `json:"cwd"`
	Command   string `json:"command"`
	TimeoutMS int    `json:"timeout_ms"`
}

type localShellExecResult struct {
	Cwd             string `json:"cwd"`
	ExitCode        *int   `json:"exit_code"`
	TimedOut        bool   `json:"timed_out"`
	Stdout          string `json:"stdout"`
	StdoutTruncated bool   `json:"stdout_truncated"`
	Stderr          string `json:"stderr"`
	StderrTruncated bool   `json:"stderr_truncated"`
	DurationMS      int64  `json:"duration_ms"`
}

type localShellToolError struct{ code string }

func (e *localShellToolError) Error() string { return e.code }

func localShellFailure(code string) error { return &localShellToolError{code: code} }

func decodeLocalShellInput(raw json.RawMessage, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return localShellFailure("DESKTOP_SHELL_UNSUPPORTED")
	}
	if decoder.More() {
		return localShellFailure("DESKTOP_SHELL_UNSUPPORTED")
	}
	return nil
}

// executeLocalShellTool runs one non-interactive shell command in the
// conversation's granted folder. The cwd is contained by the same rules as the
// file tools; the permission mode decides whether this Mac asks first. The
// command itself runs with the user's own privileges, so the approval is the
// boundary: there is no OS sandbox.
func executeLocalShellTool(
	ctx context.Context,
	roots *localFileRoots,
	approvals *cloudApprovalCenter,
	ownerID string,
	conversationID string,
	deviceID string,
	raw json.RawMessage,
) (any, error) {
	if roots == nil {
		return nil, localShellFailure("DESKTOP_SHELL_UNAVAILABLE")
	}
	var input localShellExecInput
	if err := decodeLocalShellInput(raw, &input); err != nil {
		return nil, err
	}
	if input.Command == "" || len(input.Command) > localShellCommandMaxBytes ||
		!utf8.ValidString(input.Command) || strings.ContainsRune(input.Command, 0) {
		return nil, localShellFailure("DESKTOP_SHELL_UNSUPPORTED")
	}
	if input.TimeoutMS == 0 {
		input.TimeoutMS = int(localShellDefaultTimeout / time.Millisecond)
	}
	if input.TimeoutMS < 1_000 || input.TimeoutMS > int(localShellMaxTimeout/time.Millisecond) {
		return nil, localShellFailure("DESKTOP_SHELL_UNSUPPORTED")
	}
	meta, err := roots.rootForConversation(ownerID, conversationID, deviceID, input.RootID)
	if err != nil {
		return nil, localShellFailure("DESKTOP_SHELL_ACCESS_DENIED")
	}
	canonicalRoot, err := filepath.EvalSymlinks(meta.Path)
	if err != nil {
		return nil, localShellFailure("DESKTOP_SHELL_UNAVAILABLE")
	}
	info, err := os.Stat(canonicalRoot)
	if err != nil || !info.IsDir() {
		return nil, localShellFailure("DESKTOP_SHELL_UNAVAILABLE")
	}
	target, logical, err := resolveLocalTarget(canonicalRoot, input.Cwd, true)
	if err != nil {
		return nil, localShellFailure("DESKTOP_SHELL_INVALID_PATH")
	}
	targetInfo, err := os.Stat(target)
	if err != nil || !targetInfo.IsDir() {
		return nil, localShellFailure("DESKTOP_SHELL_INVALID_PATH")
	}
	mode := roots.permissionModeForOwner(ownerID, conversationID)
	if shellApprovalRequired(mode, input.Command, canonicalRoot) {
		if err := requestApproval(ctx, approvals, cloudApprovalRequest{
			ConversationID: conversationID,
			Kind:           cloudApprovalKindCommand,
			Operation:      localShellOperationConstant,
			Command:        input.Command,
			Cwd:            logical,
			RootName:       meta.Name,
		}); err != nil {
			return nil, err
		}
	}
	return runLocalShell(ctx, target, logical, input)
}

func runLocalShell(ctx context.Context, dir, logicalCwd string, input localShellExecInput) (localShellExecResult, error) {
	timeout := time.Duration(input.TimeoutMS) * time.Millisecond
	runContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	command := exec.CommandContext(runContext, localShellProgram, "-c", input.Command)
	command.Dir = dir
	command.Env = os.Environ()
	configureLocalShellProcess(command)
	command.WaitDelay = 2 * time.Second
	stdout := &boundedOutputBuffer{limit: localShellOutputMaxBytes}
	stderr := &boundedOutputBuffer{limit: localShellOutputMaxBytes}
	command.Stdout, command.Stderr = stdout, stderr
	started := time.Now()
	err := command.Run()
	duration := time.Since(started)
	// A lost socket, an explicit cancel or the lane deadline stops the whole
	// call; nothing from a half-run command is returned as data.
	if ctx.Err() != nil {
		return localShellExecResult{}, ctx.Err()
	}
	timedOut := errors.Is(runContext.Err(), context.DeadlineExceeded)
	if err != nil && !timedOut {
		var exitErr *exec.ExitError
		if !errors.As(err, &exitErr) {
			return localShellExecResult{}, localShellFailure("DESKTOP_SHELL_UNAVAILABLE")
		}
	}
	result := localShellExecResult{
		Cwd:             logicalCwd,
		TimedOut:        timedOut,
		Stdout:          stdout.text(),
		StdoutTruncated: stdout.truncated,
		Stderr:          stderr.text(),
		StderrTruncated: stderr.truncated,
		DurationMS:      duration.Milliseconds(),
	}
	if !timedOut && command.ProcessState != nil {
		exitCode := command.ProcessState.ExitCode()
		result.ExitCode = &exitCode
	}
	return result, nil
}

// boundedOutputBuffer keeps draining a stream after its cap so a verbose child
// never blocks on a full pipe, while retaining only the first limit bytes.
type boundedOutputBuffer struct {
	buffer    bytes.Buffer
	limit     int
	truncated bool
}

func (b *boundedOutputBuffer) Write(data []byte) (int, error) {
	written := len(data)
	if room := b.limit - b.buffer.Len(); room > 0 {
		if len(data) > room {
			b.buffer.Write(data[:room])
			b.truncated = true
		} else {
			b.buffer.Write(data)
		}
	} else if len(data) > 0 {
		b.truncated = true
	}
	return written, nil
}

func (b *boundedOutputBuffer) text() string {
	return strings.ToValidUTF8(b.buffer.String(), "")
}

func localShellErrorCode(err error) string {
	var failure *localShellToolError
	if errors.As(err, &failure) {
		return failure.code
	}
	if errors.Is(err, context.Canceled) {
		return "CANCELLED"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "DESKTOP_SHELL_TIMEOUT"
	}
	if errors.Is(err, errApprovalDenied) || errors.Is(err, errApprovalTimedOut) ||
		errors.Is(err, errApprovalUnavailable) || errors.Is(err, errApprovalInvalid) {
		return approvalErrorCode(err)
	}
	return "DESKTOP_SHELL_UNAVAILABLE"
}
