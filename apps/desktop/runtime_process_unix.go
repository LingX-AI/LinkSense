//go:build darwin || linux

package main

import (
	"errors"
	"os"
	"os/exec"
	"sync"
	"syscall"
)

func secureRuntimeDirectory(root string) error {
	info, err := ensureRuntimeDirectory(root)
	if err != nil {
		return err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != uint32(os.Getuid()) {
		return errors.New("DESKTOP_RUNTIME_DIRECTORY_UNSAFE")
	}
	return os.Chmod(root, 0o700)
}

func startRuntimeProcess(cmd *exec.Cmd) (func(), error) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return sync.OnceFunc(func() {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}), nil
}
