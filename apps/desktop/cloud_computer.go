package main

// Cloud-task desktop lane. It reuses the private computer driver and native
// window picker, but its five-minute selection belongs to this Mac rather than
// to a server-run local turn. The model sees only a virtual selection id.

import (
	"context"
	"encoding/json"
)

const (
	cloudComputerStatusOperation   = "local_computer.status"
	cloudComputerSelectOperation   = "local_computer.select"
	cloudComputerObserveOperation  = "local_computer.observe"
	cloudComputerActOperation      = "local_computer.act"
	cloudComputerWaitOperation     = "local_computer.wait"
	cloudComputerPauseOperation    = "local_computer.pause"
	cloudComputerResumeOperation   = "local_computer.resume"
	cloudComputerStopOperation     = "local_computer.stop"
	cloudComputerExtendedOperation = "local_computer.extended"
)

func cloudComputerOperationKnown(operation string) bool {
	switch operation {
	case cloudComputerStatusOperation, cloudComputerSelectOperation,
		cloudComputerObserveOperation, cloudComputerActOperation,
		cloudComputerWaitOperation, cloudComputerPauseOperation,
		cloudComputerResumeOperation, cloudComputerStopOperation,
		cloudComputerExtendedOperation:
		return true
	default:
		return false
	}
}

type CloudComputerControlStatus struct {
	State     string `json:"state"`
	ExpiresAt string `json:"expiresAt,omitempty"`
}

type cloudComputerHost interface {
	handle(ctx context.Context, callID, ownerID, linkID, operation string, input json.RawMessage) (any, string)
	control(ctx context.Context, desktop *Desktop, ownerID, linkID, action string) (CloudComputerControlStatus, error)
	emergencyPause()
	emergencyStop()
}

func (d *Desktop) CloudComputerControl(
	ctx context.Context,
	conversationID, turnID, action string,
) (CloudComputerControlStatus, error) {
	if err := d.checkCaller(ctx); err != nil {
		return CloudComputerControlStatus{State: computerControlStateUnavailable}, err
	}
	if !validUUID(conversationID) || !validUUID(turnID) {
		return CloudComputerControlStatus{State: computerControlStateUnavailable}, errComputerInvalid
	}
	switch action {
	case "select", "status", "pause", "resume", "stop":
	default:
		return CloudComputerControlStatus{State: computerControlStateUnavailable}, errComputerInvalid
	}
	connection := d.currentDevice()
	if d.cloudComputer == nil || connection == nil || !connection.authorized() {
		return CloudComputerControlStatus{State: computerControlStateUnavailable}, errComputerUnavailable
	}
	return d.cloudComputer.control(
		ctx, d, connection.credential.OwnerID, connection.credential.DeviceID, action,
	)
}

func (d *Desktop) CloudComputerStatus(ctx context.Context) (CloudComputerControlStatus, error) {
	return d.CloudComputerControl(ctx, newComputerControlID(), newComputerControlID(), "status")
}

func (d *Desktop) emergencyPauseCloudComputer() {
	if d != nil && d.cloudComputer != nil {
		d.cloudComputer.emergencyPause()
	}
}

func (d *Desktop) emergencyStopCloudComputer() {
	if d != nil && d.cloudComputer != nil {
		d.cloudComputer.emergencyStop()
	}
}
