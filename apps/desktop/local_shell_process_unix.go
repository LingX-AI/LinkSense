//go:build darwin || linux

package main

import (
	"os/exec"
	"syscall"
)

// configureLocalShellProcess puts the command in its own process group so a
// timeout or a lost socket kills the whole tree, not only the shell.
func configureLocalShellProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	command.Cancel = func() error {
		if command.Process == nil {
			return nil
		}
		return syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
	}
}
