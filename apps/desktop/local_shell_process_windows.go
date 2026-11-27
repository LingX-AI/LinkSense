package main

import (
	"os/exec"
	"syscall"
)

// The local shell lane is only offered on macOS. This keeps Windows builds
// compiling; Cancel keeps exec's default single-process termination.
func configureLocalShellProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
