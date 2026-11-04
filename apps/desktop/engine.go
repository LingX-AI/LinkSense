package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

type desktopRequest struct {
	Action    string `json:"action"`
	DeviceID  string `json:"device_id,omitempty"`
	App       string `json:"app,omitempty"`
	WindowID  string `json:"window_id,omitempty"`
	Ref       string `json:"ref,omitempty"`
	Text      string `json:"text,omitempty"`
	Key       string `json:"key,omitempty"`
	Direction string `json:"direction,omitempty"`
	Amount    int    `json:"amount,omitempty"`
}

type permissionState struct {
	Accessibility   string `json:"accessibility"`
	ScreenRecording string `json:"screen_recording"`
}

type toolData struct {
	Text      string `json:"text,omitempty"`
	Truncated bool   `json:"truncated,omitempty"`
	Image     string `json:"image,omitempty"`
	MimeType  string `json:"mime_type,omitempty"`
}
type toolResult struct {
	OK        bool      `json:"ok"`
	Data      *toolData `json:"data,omitempty"`
	Code      string    `json:"code,omitempty"`
	Retryable bool      `json:"retryable,omitempty"`
	Delivery  string    `json:"delivery,omitempty"`
	HelpPath  string    `json:"help_path,omitempty"`
}

func (result toolResult) MarshalJSON() ([]byte, error) {
	if result.OK {
		return json.Marshal(struct {
			OK   bool      `json:"ok"`
			Data *toolData `json:"data"`
		}{true, result.Data})
	}
	return json.Marshal(struct {
		OK        bool   `json:"ok"`
		Code      string `json:"code"`
		Retryable bool   `json:"retryable"`
		Delivery  string `json:"delivery"`
		HelpPath  string `json:"help_path"`
	}{false, result.Code, false, result.Delivery, result.HelpPath})
}

func failure(code, delivery string) toolResult {
	return toolResult{Code: code, Delivery: delivery, HelpPath: "/settings/general#computer-use"}
}

var appPattern = regexp.MustCompile(`^[\p{L}\p{N}][\p{L}\p{N}\p{M} ._:/+()&'-]{0,199}$`)
var windowPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:+-]{0,199}$`)
var refPattern = regexp.MustCompile(`^@[A-Za-z0-9._-]+:e[0-9]+$`)
var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var keyAliases = map[string]string{
	"Enter": "return", "Tab": "tab", "Shift+Tab": "shift+tab", "Escape": "escape",
	"Backspace": "backspace", "Delete": "delete", "Space": "space",
	"ArrowUp": "up", "ArrowDown": "down", "ArrowLeft": "left", "ArrowRight": "right",
	"Cmd+A": "cmd+a", "Cmd+C": "cmd+c", "Cmd+V": "cmd+v", "Cmd+S": "cmd+s", "Cmd+Z": "cmd+z",
	"Cmd+Shift+Z": "cmd+shift+z", "Ctrl+A": "ctrl+a", "Ctrl+C": "ctrl+c",
	"Ctrl+V": "ctrl+v", "Ctrl+S": "ctrl+s", "Ctrl+Z": "ctrl+z",
}

func readOnlyAction(action string) bool {
	return action == "apps" || action == "windows" || action == "snapshot" || action == "screenshot"
}

func commandArguments(request desktopRequest) ([]string, error) {
	timeout := []string{"--timeout-ms", "5000"}
	headed := []string{}
	if runtime.GOOS == "windows" && (request.Action == "type" || request.Action == "focus") {
		headed = []string{"--headed"}
	}
	switch request.Action {
	case "apps":
		return append([]string{"list-apps"}, timeout...), nil
	case "windows", "snapshot", "screenshot", "key":
		if !appPattern.MatchString(request.App) ||
			request.Action != "windows" && !windowPattern.MatchString(request.WindowID) {
			return nil, errors.New("invalid target")
		}
		args := []string{"list-windows", "--app", request.App}
		if request.Action != "windows" {
			args = []string{request.Action, "--app", request.App, "--window-id", request.WindowID}
		}
		switch request.Action {
		case "key":
			combo, ok := keyAliases[request.Key]
			if !ok {
				return nil, errors.New("invalid key")
			}
			args[0] = "press"
			return append(args, "--headed", "--", combo), nil
		case "screenshot":
			return args, nil
		case "snapshot":
			return append(args, "--timeout-ms", "3000", "--max-depth", "10", "--include-bounds"), nil
		default:
			return append(args, timeout...), nil
		}
	case "click", "focus", "type", "scroll":
		if !refPattern.MatchString(request.Ref) || len(request.Ref) > 200 {
			return nil, errors.New("invalid ref")
		}
		args := append(append([]string{request.Action}, timeout...), headed...)
		if request.Action == "scroll" {
			switch request.Direction {
			case "up", "down", "left", "right":
			default:
				return nil, errors.New("invalid scroll direction")
			}
			if request.Amount < 1 || request.Amount > 10 {
				return nil, errors.New("invalid scroll amount")
			}
			args = append(args, "--direction", request.Direction, "--amount", strconv.Itoa(request.Amount))
		}
		args = append(args, "--", request.Ref)
		if request.Action == "type" {
			if len(request.Text) > 8_000 || strings.ContainsRune(request.Text, 0) {
				return nil, errors.New("invalid text")
			}
			args = append(args, request.Text)
		}
		return args, nil
	default:
		return nil, errors.New("unsupported desktop action")
	}
}

type commandEngine interface {
	Execute(context.Context, desktopRequest, string) toolResult
	Stop()
	Permissions(context.Context) permissionState
}

type engineHost struct {
	cmd     *exec.Cmd
	input   io.WriteCloser
	output  *bufio.Scanner
	session string
	root    string
}
type commandSession struct {
	session string
	root    string
	active  *commandProcess
}
type commandProcess struct {
	cancel context.CancelFunc
	done   chan struct{}
}
type nativeEngine struct {
	path    string
	op      sync.Mutex
	run     sync.Mutex
	mu      sync.Mutex
	host    *engineHost
	windows *commandSession
	refs    *engineRefs
}
type nativeEnvelope struct {
	OK      bool            `json:"ok"`
	Version string          `json:"version"`
	Data    json.RawMessage `json:"data"`
	Error   struct {
		Code        string `json:"code"`
		Disposition struct {
			Delivery string `json:"delivery"`
		} `json:"disposition"`
	} `json:"error"`
}

func (e *nativeEngine) Stop() {
	e.mu.Lock()
	host := e.host
	windows := e.windows
	var active *commandProcess
	if windows != nil {
		active = windows.active
	}
	e.host = nil
	e.windows = nil
	e.refs = nil
	e.mu.Unlock()
	if host != nil {
		killOwnedProcess(host.cmd)
		_ = host.input.Close()
		_ = host.cmd.Wait()
		_ = os.RemoveAll(host.root)
	}
	if windows != nil {
		if active != nil {
			active.cancel()
			<-active.done
		}
		_ = os.RemoveAll(windows.root)
	}
}

func (e *nativeEngine) start(session string) (*engineHost, error) {
	if runtime.GOOS == "windows" {
		return nil, errors.New("windows uses one process per command")
	}
	e.mu.Lock()
	current := e.host
	e.mu.Unlock()
	if current != nil && current.session == session {
		return current, nil
	}
	e.Stop()
	info, err := os.Lstat(e.path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o022 != 0 || info.Mode().Perm()&0o111 == 0 {
		return nil, errors.New("desktop engine is unavailable")
	}
	root, err := os.MkdirTemp("", "linksense-desktop-")
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(e.path)
	// Own the pinned stdio host, not the CLI's detached socket daemon.
	cmd.Env = []string{
		"HOME=" + os.Getenv("HOME"), "TMPDIR=" + os.TempDir(), "PATH=/usr/bin:/bin:/usr/sbin:/sbin",
		"AGENT_DESKTOP_INTERNAL_COMMAND_HOST=1", "AGENT_DESKTOP_SESSION=" + session,
		"AGENT_DESKTOP_HOME=" + root,
	}
	configureOwnedProcess(cmd)
	input, err := cmd.StdinPipe()
	if err != nil {
		_ = os.RemoveAll(root)
		return nil, err
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		_ = input.Close()
		_ = os.RemoveAll(root)
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		_ = input.Close()
		_ = os.RemoveAll(root)
		return nil, err
	}
	scanner := bufio.NewScanner(output)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	host := &engineHost{cmd: cmd, input: input, output: scanner, session: session, root: root}
	e.mu.Lock()
	e.host = host
	e.refs = &engineRefs{session: session, values: make(map[string]bool)}
	e.mu.Unlock()
	return host, nil
}

func (e *nativeEngine) exchange(ctx context.Context, args []string, session string) (nativeEnvelope, error) {
	e.run.Lock()
	defer e.run.Unlock()
	if ctx.Err() != nil {
		return nativeEnvelope{}, ctx.Err()
	}
	if runtime.GOOS == "windows" {
		return e.exchangeWindows(ctx, args, session)
	}
	host, err := e.start(session)
	if err != nil {
		return nativeEnvelope{}, err
	}
	if ctx.Err() != nil {
		e.Stop()
		return nativeEnvelope{}, ctx.Err()
	}
	result := make(chan struct {
		value nativeEnvelope
		err   error
	}, 1)
	go func() {
		var value nativeEnvelope
		if err := json.NewEncoder(host.input).Encode(args); err != nil {
			result <- struct {
				value nativeEnvelope
				err   error
			}{value, err}
			return
		}
		if !host.output.Scan() {
			result <- struct {
				value nativeEnvelope
				err   error
			}{value, errors.New("desktop host closed")}
			return
		}
		err := json.Unmarshal(host.output.Bytes(), &value)
		if err == nil && value.Version != "2.5" {
			err = errors.New("unsupported desktop engine protocol")
		}
		result <- struct {
			value nativeEnvelope
			err   error
		}{value, err}
	}()
	select {
	case <-ctx.Done():
		e.Stop()
		<-result
		return nativeEnvelope{}, ctx.Err()
	case response := <-result:
		if response.err != nil {
			e.Stop()
		}
		return response.value, response.err
	}
}

type nativeOutput struct {
	data bytes.Buffer
}

func (output *nativeOutput) Write(data []byte) (int, error) {
	if len(data) > 8*1024*1024-output.data.Len() {
		return 0, errors.New("desktop output exceeds limit")
	}
	return output.data.Write(data)
}

func (e *nativeEngine) exchangeWindows(ctx context.Context, args []string, session string) (value nativeEnvelope, err error) {
	info, err := os.Lstat(e.path)
	if err != nil || !info.Mode().IsRegular() {
		return nativeEnvelope{}, errors.New("desktop engine is unavailable")
	}
	e.mu.Lock()
	current := e.windows
	e.mu.Unlock()
	if current != nil && current.session != session {
		e.Stop()
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	e.mu.Lock()
	if ctx.Err() != nil {
		e.mu.Unlock()
		return nativeEnvelope{}, ctx.Err()
	}
	if e.windows == nil {
		root, err := os.MkdirTemp("", "linksense-desktop-")
		if err != nil {
			e.mu.Unlock()
			return nativeEnvelope{}, err
		}
		// Native snapshot ref maps must survive the next independent process.
		e.windows = &commandSession{session: session, root: root}
		e.refs = &engineRefs{session: session, values: make(map[string]bool)}
	}
	state := e.windows
	active := &commandProcess{cancel: cancel, done: make(chan struct{})}
	state.active = active
	e.mu.Unlock()
	defer func() {
		cancel()
		e.mu.Lock()
		current := e.windows == state
		if current {
			state.active = nil
		}
		e.mu.Unlock()
		close(active.done)
		if err != nil && current {
			e.Stop()
		}
	}()
	cmd := exec.CommandContext(ctx, e.path, args...)
	cmd.Env = append(os.Environ(), "AGENT_DESKTOP_SESSION="+session, "AGENT_DESKTOP_HOME="+state.root)
	cmd.WaitDelay = time.Second
	configureOwnedProcess(cmd)
	var output nativeOutput
	cmd.Stdout = &output
	runErr := cmd.Run()
	if ctx.Err() != nil {
		return nativeEnvelope{}, ctx.Err()
	}
	if runErr != nil {
		var exitError *exec.ExitError
		if !errors.As(runErr, &exitError) || output.data.Len() == 0 {
			return nativeEnvelope{}, runErr
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(output.data.Bytes()))
	if err := decoder.Decode(&value); err != nil {
		return nativeEnvelope{}, err
	}
	if decoder.Decode(new(json.RawMessage)) != io.EOF {
		return nativeEnvelope{}, errors.New("unexpected trailing desktop output")
	}
	if value.Version != "2.5" {
		return nativeEnvelope{}, errors.New("unsupported desktop engine protocol")
	}
	return value, nil
}

func sessionName(contextID string) string {
	sum := sha256.Sum256([]byte(contextID))
	return "linksense_" + hex.EncodeToString(sum[:16])
}

func (e *nativeEngine) Execute(ctx context.Context, request desktopRequest, contextID string) toolResult {
	e.op.Lock()
	defer e.op.Unlock()
	args, err := commandArguments(request)
	if err != nil {
		return failure("COMPUTER_USE_ACCESS_DENIED", "not_delivered")
	}
	session := sessionName(contextID)
	e.mu.Lock()
	if request.Ref != "" {
		valid := e.refs != nil && e.refs.session == session && e.refs.values[request.Ref]
		if !valid {
			e.mu.Unlock()
			return failure("COMPUTER_USE_STALE_REF", "not_delivered")
		}
	}
	// A failed or uncertain mutation may still have changed the target UI.
	if e.refs != nil && (request.Action == "snapshot" || !readOnlyAction(request.Action)) {
		e.refs.values = make(map[string]bool)
	}
	e.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	envelope, err := e.exchange(ctx, args, session)
	if err != nil {
		if ctx.Err() != nil || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return failure("COMPUTER_USE_CANCELLED", "unknown")
		}
		return failure("COMPUTER_USE_ENGINE_UNAVAILABLE", "unknown")
	}
	if !envelope.OK {
		code := "COMPUTER_USE_COMMAND_FAILED"
		if envelope.Error.Code == "PERM_DENIED" || strings.Contains(envelope.Error.Code, "PERMISSION") {
			code = "COMPUTER_USE_PERMISSION_REQUIRED"
			// A later user grant must not reuse this host's cached denial.
			e.Stop()
		} else if strings.Contains(envelope.Error.Code, "REF") {
			code = "COMPUTER_USE_STALE_REF"
		}
		delivery := "unknown"
		if envelope.Error.Disposition.Delivery == "not_delivered" {
			delivery = "not_delivered"
		}
		return failure(code, delivery)
	}
	if request.Action == "snapshot" {
		refs := snapshotRefs(envelope.Data)
		e.mu.Lock()
		if e.refs == nil || e.refs.session != session {
			e.mu.Unlock()
			return failure("COMPUTER_USE_CANCELLED", "unknown")
		}
		e.refs.values = refs
		e.mu.Unlock()
	}
	if request.Action == "screenshot" {
		var image struct {
			Data   string `json:"data"`
			Format string `json:"format"`
			Width  int    `json:"width"`
			Height int    `json:"height"`
		}
		if json.Unmarshal(envelope.Data, &image) != nil || image.Format != "png" ||
			image.Width <= 0 || image.Height <= 0 || len(image.Data) > 6_000_000 {
			return failure("COMPUTER_USE_COMMAND_FAILED", "unknown")
		}
		return toolResult{OK: true, Data: &toolData{Image: image.Data, MimeType: "image/png"}}
	}
	text := string(envelope.Data)
	truncated := len(text) > 512_000
	if truncated {
		text = text[:512_000]
	}
	return toolResult{OK: true, Data: &toolData{Text: text, Truncated: truncated}}
}

func snapshotRefs(data []byte) map[string]bool {
	refs := make(map[string]bool)
	var snapshot struct {
		SnapshotID string          `json:"snapshot_id"`
		Tree       json.RawMessage `json:"tree"`
	}
	if json.Unmarshal(data, &snapshot) != nil || snapshot.SnapshotID == "" {
		return refs
	}
	var walk func(json.RawMessage)
	walk = func(raw json.RawMessage) {
		var node struct {
			RefID    string            `json:"ref_id"`
			Children []json.RawMessage `json:"children"`
		}
		if json.Unmarshal(raw, &node) != nil {
			return
		}
		if refPattern.MatchString(node.RefID) && strings.HasPrefix(node.RefID, "@"+snapshot.SnapshotID+":") {
			refs[node.RefID] = true
		}
		for _, child := range node.Children {
			walk(child)
		}
	}
	walk(snapshot.Tree)
	return refs
}

func (e *nativeEngine) Permissions(ctx context.Context) permissionState {
	e.op.Lock()
	defer e.op.Unlock()
	// Permission polling must not replace the active task's host or snapshot refs.
	probe := &nativeEngine{path: e.path}
	defer probe.Stop()
	result := permissionState{Accessibility: "unknown", ScreenRecording: "unknown"}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	envelope, err := probe.exchange(ctx, []string{"status"}, sessionName("local-permission-check"))
	if err != nil || !envelope.OK {
		return result
	}
	var status struct {
		Version     string `json:"version"`
		Permissions struct {
			Accessibility struct {
				State string `json:"state"`
			} `json:"accessibility"`
			ScreenRecording struct {
				State string `json:"state"`
			} `json:"screen_recording"`
		} `json:"permissions"`
	}
	if json.Unmarshal(envelope.Data, &status) != nil || status.Version != "1.0.2" {
		return result
	}
	normalize := func(state string) string {
		if state == "granted" || state == "not_required" {
			return "granted"
		}
		if state == "denied" {
			return "denied"
		}
		return "unknown"
	}
	result.Accessibility = normalize(status.Permissions.Accessibility.State)
	result.ScreenRecording = normalize(status.Permissions.ScreenRecording.State)
	return result
}

type engineRefs struct {
	session string
	values  map[string]bool
}
