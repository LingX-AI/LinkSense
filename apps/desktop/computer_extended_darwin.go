//go:build darwin

package main

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
)

func extendedWindowCommand(action string) string {
	switch action {
	case "focus":
		return "focus-window"
	case "resize":
		return "resize-window"
	case "move":
		return "move-window"
	case "minimize":
		return "minimize"
	case "maximize":
		return "maximize"
	case "restore":
		return "restore"
	default:
		return ""
	}
}

func (d *computerDriver) Extended(ctx context.Context, target computerTarget, request computerExtendedRequest) computerExtendedResult {
	result := computerExtendedResult{}
	if ctx == nil || target.validate() != nil || request.TimeoutMS < m1bComputerMinTimeout || request.TimeoutMS > m1bComputerMaxTimeout {
		result.Error = computerExecutorInvalid
		return result
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closed {
		result.Error = computerExecutorUnavailable
		return result
	}
	if err := ctx.Err(); err != nil {
		result.Error = computerExecutorTimeout
		return result
	}
	var args []string
	var stdin []byte
	inputAction := false
	commandName := ""
	switch request.Action {
	case "scroll":
		observation := d.latest
		if observation == nil || observation.ID != request.ObservationID ||
			!strings.HasPrefix(request.Ref, "@"+observation.SnapshotID+":") {
			result.Error = computerExecutorStaleObservation
			return result
		}
		if _, ok := observation.refs[request.Ref]; !ok {
			result.Error = computerExecutorStaleRef
			return result
		}
		args = d.baseArgs("scroll", request.Ref,
			"--direction="+request.Direction, "--amount="+strconv.Itoa(request.Amount),
			"--timeout-ms="+strconv.Itoa(request.TimeoutMS))
		commandName = "scroll"
		inputAction = true
	case "press":
		args = d.baseArgs("press", request.Combo,
			"--window-id="+target.WindowID, "--timeout-ms="+strconv.Itoa(request.TimeoutMS))
		commandName = "press"
		inputAction = true
	case "drag":
		observation := d.latest
		if observation == nil || observation.ID != request.ObservationID ||
			!strings.HasPrefix(request.Ref, "@"+observation.SnapshotID+":") ||
			!strings.HasPrefix(request.ToRef, "@"+observation.SnapshotID+":") {
			result.Error = computerExecutorStaleObservation
			return result
		}
		if _, ok := observation.refs[request.Ref]; !ok {
			result.Error = computerExecutorStaleRef
			return result
		}
		if _, ok := observation.refs[request.ToRef]; !ok {
			result.Error = computerExecutorStaleRef
			return result
		}
		args = d.baseArgs("drag", "--from="+request.Ref, "--to="+request.ToRef,
			"--headed", "--timeout-ms="+strconv.Itoa(request.TimeoutMS))
		commandName = "drag"
		inputAction = true
	case "launch":
		args = d.baseArgs("launch", request.App, "--timeout="+strconv.Itoa(request.TimeoutMS))
		commandName = "launch"
		inputAction = true
	case "window":
		command := extendedWindowCommand(request.WindowAction)
		if command == "" {
			result.Error = computerExecutorInvalid
			return result
		}
		args = d.baseArgs(command, "--window-id="+target.WindowID,
			"--timeout-ms="+strconv.Itoa(request.TimeoutMS))
		switch request.WindowAction {
		case "resize":
			if request.Width < 1 || request.Height < 1 {
				result.Error = computerExecutorInvalid
				return result
			}
			args = append(args, "--width="+strconv.Itoa(request.Width), "--height="+strconv.Itoa(request.Height))
		case "move":
			args = append(args, "--x="+strconv.Itoa(request.X), "--y="+strconv.Itoa(request.Y))
		}
		commandName = command
		inputAction = true
	case "clipboard_get":
		args = d.baseArgs("clipboard-get", "--format=text")
		commandName = "clipboard-get"
	case "clipboard_set":
		args = d.baseArgs("clipboard-set", "--stdin")
		stdin = []byte(request.Text)
		commandName = "clipboard-set"
		inputAction = true
	case "clipboard_clear":
		args = d.baseArgs("clipboard-clear")
		commandName = "clipboard-clear"
		inputAction = true
	case "screenshot":
		args = d.baseArgs("screenshot", "--window-id="+target.WindowID)
		commandName = "screenshot"
	default:
		result.Error = computerExecutorInvalid
		return result
	}
	if inputAction {
		d.latest = nil
	}
	command, err := d.run(ctx, computerActionProcessTimeout, stdin, args...)
	if !command.started {
		if err != nil {
			result.Error = driverErrorCode(err)
		}
		if result.Error == "" {
			result.Error = computerExecutorUnavailable
		}
		return result
	}
	envelope, decodeErr := decodeEnvelope(command, commandName)
	if decodeErr != nil {
		result.Error = driverErrorCode(decodeErr)
		return result
	}
	if !envelope.OK {
		result.Error = stableCLICode(envelope.Error)
		return result
	}
	var data any
	if len(envelope.Data) > 0 && string(envelope.Data) != "null" {
		_ = json.Unmarshal(envelope.Data, &data)
	}
	result.OK = true
	result.Data = data
	if inputAction {
		result.Effect = "done"
	}
	return result
}
