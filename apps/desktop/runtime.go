package main

import (
	"bufio"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type RuntimeStatus struct {
	State string `json:"state"`
}

type runtimeSupervisor struct {
	cancel context.CancelFunc
	done   chan struct{}
	ready  atomic.Bool
	pipe   atomic.Pointer[runtimePipe]
}

const (
	runtimeStartupTimeout = 45 * time.Second
	runtimeExitGrace      = 3 * time.Second
	runtimeHealthTimeout  = 10 * time.Second
	desktopFrameLimit     = 1024 * 1024
	runtimeFrameLimit     = desktopFrameLimit + 1024
)

func superviseRuntime(dataRoot, runtimeRoot, serverOrigin string) *runtimeSupervisor {
	ctx, cancel := context.WithCancel(context.Background())
	supervisor := &runtimeSupervisor{cancel: cancel, done: make(chan struct{})}
	go func() {
		defer close(supervisor.done)
		defer supervisor.ready.Store(false)
		if err := secureRuntimeDirectory(dataRoot); err != nil {
			log.Print("DESKTOP_RUNTIME_DIRECTORY_UNAVAILABLE")
			return
		}
		for attempt := 0; attempt < 4 && ctx.Err() == nil; attempt++ {
			if err := supervisor.run(ctx, dataRoot, runtimeRoot, serverOrigin); err != nil && ctx.Err() == nil {
				log.Printf("DESKTOP_RUNTIME_STOPPED attempt=%d", attempt+1)
			}
			if attempt == 3 {
				return
			}
			timer := time.NewTimer(time.Duration(1<<attempt) * time.Second)
			select {
			case <-ctx.Done():
				timer.Stop()
			case <-timer.C:
			}
		}
	}()
	return supervisor
}

func (s *runtimeSupervisor) close() {
	s.cancel()
	<-s.done
}

func (s *runtimeSupervisor) run(ctx context.Context, dataRoot, runtimeRoot, serverOrigin string) error {
	binary := "node"
	if goruntime.GOOS == "windows" {
		binary += ".exe"
	}
	cmd := exec.Command(filepath.Join(runtimeRoot, "bin", binary),
		filepath.Join(runtimeRoot, "runner", "dist", "desktop-supervised.js"))
	cmd.Dir = dataRoot
	cmd.Env = desktopRuntimeEnvironment(os.Environ())
	inputReader, input, err := os.Pipe()
	if err != nil {
		return err
	}
	defer inputReader.Close()
	defer input.Close()
	cmd.Stdin = inputReader
	reader, writer, err := os.Pipe()
	if err != nil {
		return err
	}
	defer reader.Close()
	defer writer.Close()
	cmd.Stdout = writer
	stopTree, err := startRuntimeProcess(cmd)
	if err != nil {
		return err
	}
	defer stopTree()
	_ = inputReader.Close()
	_ = writer.Close()
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	stop := func() {
		_ = input.Close()
		timer := time.NewTimer(runtimeExitGrace)
		defer timer.Stop()
		select {
		case <-exited:
		case <-timer.C:
			stopTree()
			<-exited
		}
	}
	startup := struct {
		DataRoot     string `json:"data_root"`
		RuntimeRoot  string `json:"runtime_root"`
		ControlToken string `json:"control_token"`
		ServerOrigin string `json:"server_origin,omitempty"`
	}{dataRoot, runtimeRoot, hex.EncodeToString(randomLoginBytes()), serverOrigin}
	initDone := make(chan error, 1)
	go func() { initDone <- json.NewEncoder(input).Encode(startup) }()
	frames := make(chan string)
	doneReading := make(chan struct{})
	defer close(doneReading)
	go func() {
		defer close(frames)
		scanner := bufio.NewScanner(reader)
		scanner.Buffer(make([]byte, 256), runtimeFrameLimit)
		for scanner.Scan() {
			select {
			case frames <- scanner.Text():
			case <-doneReading:
				return
			}
		}
	}()
	timer := time.NewTimer(runtimeStartupTimeout)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		stop()
		return nil
	case <-timer.C:
		stop()
		return errors.New("DESKTOP_RUNTIME_START_TIMEOUT")
	case err := <-exited:
		return err
	case err := <-initDone:
		if err != nil {
			stop()
			return err
		}
	}
	select {
	case <-ctx.Done():
		stop()
		return nil
	case <-timer.C:
		stop()
		return errors.New("DESKTOP_RUNTIME_START_TIMEOUT")
	case err := <-exited:
		return err
	case frame := <-frames:
		if frame != `{"type":"ready","version":1}` {
			stop()
			return errors.New("DESKTOP_RUNTIME_PROTOCOL_ERROR")
		}
	}
	timer.Reset(runtimeHealthTimeout)
	pipe := &runtimePipe{input: input, done: make(chan struct{})}
	s.pipe.Store(pipe)
	s.ready.Store(true)
	defer func() {
		s.ready.Store(false)
		s.pipe.Store(nil)
		close(pipe.done)
	}()
	for {
		select {
		case <-ctx.Done():
			stop()
			return nil
		case <-timer.C:
			s.ready.Store(false)
			stop()
			return errors.New("DESKTOP_RUNTIME_HEARTBEAT_TIMEOUT")
		case err := <-exited:
			return err
		case frame := <-frames:
			if frame == `{"type":"heartbeat","version":1}` {
				timer.Reset(runtimeHealthTimeout)
			} else if !pipe.deliver(frame) {
				s.ready.Store(false)
				stop()
				return errors.New("DESKTOP_RUNTIME_PROTOCOL_ERROR")
			}
		}
	}
}

type runtimePipeMessage struct {
	Type         string          `json:"type"`
	LinkID       string          `json:"link_id"`
	OwnerID      string          `json:"owner_id,omitempty"`
	Frame        json.RawMessage `json:"frame,omitempty"`
	ToolsVersion *int            `json:"tools_version,omitempty"`
}

type runtimePipe struct {
	input *os.File
	done  chan struct{}
	mu    sync.Mutex
	link  atomic.Pointer[runtimeLink]
}

type runtimeLink struct {
	id     string
	pipe   *runtimePipe
	frames chan json.RawMessage
}

func (s *runtimeSupervisor) attach(id, owner string, toolsVersion *int) (*runtimeLink, error) {
	pipe := s.pipe.Load()
	if pipe == nil || !validUUID(id) || !validUUID(owner) {
		return nil, errors.New("DESKTOP_RUNTIME_UNAVAILABLE")
	}
	link := &runtimeLink{id: id, pipe: pipe, frames: make(chan json.RawMessage, 16)}
	pipe.mu.Lock()
	defer pipe.mu.Unlock()
	if pipe.link.Load() != nil {
		return nil, errors.New("DESKTOP_RUNTIME_UNAVAILABLE")
	}
	if err := pipe.writeLocked(runtimePipeMessage{Type: "link.open", LinkID: id, OwnerID: owner, ToolsVersion: toolsVersion}); err != nil {
		return nil, err
	}
	pipe.link.Store(link)
	return link, nil
}

func (pipe *runtimePipe) writeLocked(message runtimePipeMessage) error {
	if err := pipe.input.SetWriteDeadline(time.Now().Add(2 * time.Second)); err != nil {
		_ = pipe.input.Close()
		return err
	}
	encoder := json.NewEncoder(pipe.input)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(message); err != nil {
		_ = pipe.input.Close()
		return err
	}
	return nil
}

func (link *runtimeLink) send(frame json.RawMessage) error {
	link.pipe.mu.Lock()
	defer link.pipe.mu.Unlock()
	if link.pipe.link.Load() != link || len(frame) > desktopFrameLimit || !json.Valid(frame) {
		return errors.New("DESKTOP_RUNTIME_PROTOCOL_ERROR")
	}
	return link.pipe.writeLocked(runtimePipeMessage{Type: "link.frame", LinkID: link.id, Frame: frame})
}

func (link *runtimeLink) close() {
	link.pipe.mu.Lock()
	defer link.pipe.mu.Unlock()
	if link.pipe.link.CompareAndSwap(link, nil) {
		_ = link.pipe.writeLocked(runtimePipeMessage{Type: "link.close", LinkID: link.id})
	}
}

func (pipe *runtimePipe) deliver(raw string) bool {
	var message runtimePipeMessage
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if !json.Valid([]byte(raw)) || decoder.Decode(&message) != nil || message.Type != "link.frame" ||
		!validUUID(message.LinkID) || message.OwnerID != "" || message.ToolsVersion != nil || len(message.Frame) > desktopFrameLimit || !json.Valid(message.Frame) {
		return false
	}
	var header struct {
		Type string `json:"type"`
	}
	if json.Unmarshal(message.Frame, &header) != nil ||
		(header.Type != "command.result" && header.Type != "execution.callback" && header.Type != "execution.recovery" &&
			header.Type != "tool.request" && header.Type != "tool.cancel") {
		return false
	}
	link := pipe.link.Load()
	if link == nil || message.LinkID != link.id {
		return true
	}
	select {
	case link.frames <- message.Frame:
		return true
	default:
		return false
	}
}

func desktopRuntimeEnvironment(environment []string) []string {
	allowed := map[string]bool{
		"path": true, "lang": true, "lc_all": true, "shell": true,
		"tmpdir": true, "tmp": true, "temp": true,
		"systemroot": true, "windir": true, "comspec": true, "pathext": true,
	}
	result := []string{"NODE_ENV=production"}
	for _, entry := range environment {
		key, _, exists := strings.Cut(entry, "=")
		if exists && allowed[strings.ToLower(key)] {
			result = append(result, entry)
		}
	}
	return result
}

func (d *Desktop) RuntimeStatus(ctx context.Context) (RuntimeStatus, error) {
	if err := d.checkCaller(ctx); err != nil {
		return RuntimeStatus{}, err
	}
	if d.localRuntime != nil && d.localRuntime.ready.Load() {
		return RuntimeStatus{State: "ready"}, nil
	}
	return RuntimeStatus{State: "unavailable"}, nil
}

// Create only the managed child of the app data directory; never follow a link.
func ensureRuntimeDirectory(root string) (os.FileInfo, error) {
	if err := os.MkdirAll(filepath.Dir(root), 0o700); err != nil {
		return nil, err
	}
	if err := os.Mkdir(root, 0o700); err != nil && !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	info, err := os.Lstat(root)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("DESKTOP_RUNTIME_DIRECTORY_UNSAFE")
	}
	return info, nil
}
