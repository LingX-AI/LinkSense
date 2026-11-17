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
}

const (
	runtimeStartupTimeout = 45 * time.Second
	runtimeExitGrace      = 3 * time.Second
	runtimeHealthTimeout  = 10 * time.Second
)

func superviseRuntime(dataRoot, runtimeRoot string) *runtimeSupervisor {
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
			if err := supervisor.run(ctx, dataRoot, runtimeRoot); err != nil && ctx.Err() == nil {
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

func (s *runtimeSupervisor) run(ctx context.Context, dataRoot, runtimeRoot string) error {
	binary := "node"
	if goruntime.GOOS == "windows" {
		binary += ".exe"
	}
	cmd := exec.Command(filepath.Join(runtimeRoot, "bin", binary),
		filepath.Join(runtimeRoot, "runner", "dist", "desktop-supervised.js"))
	cmd.Dir = dataRoot
	cmd.Env = desktopRuntimeEnvironment(os.Environ())
	// Runner output is private. Only the fixed readiness frame crosses stdout.
	input, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	defer input.Close()
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
	}{dataRoot, runtimeRoot, hex.EncodeToString(randomLoginBytes())}
	initDone := make(chan error, 1)
	go func() { initDone <- json.NewEncoder(input).Encode(startup) }()
	frames := make(chan string)
	doneReading := make(chan struct{})
	defer close(doneReading)
	go func() {
		defer close(frames)
		scanner := bufio.NewScanner(reader)
		scanner.Buffer(make([]byte, 256), 4096)
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
	s.ready.Store(true)
	defer s.ready.Store(false)
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
			if frame != `{"type":"heartbeat","version":1}` {
				s.ready.Store(false)
				stop()
				return errors.New("DESKTOP_RUNTIME_PROTOCOL_ERROR")
			}
			timer.Reset(runtimeHealthTimeout)
		}
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
