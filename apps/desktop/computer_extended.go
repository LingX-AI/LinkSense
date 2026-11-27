package main

import (
	"context"
)

// Internal-build extended actions. The native driver still owns the window
// pin and ref map; this request carries only a closed action and bounded
// arguments. Release builds refuse the operation.
type computerExtendedRequest struct {
	Action        string
	ObservationID string
	Ref           string
	ToRef         string
	Direction     string
	Amount        int
	Combo         string
	App           string
	WindowAction  string
	Width         int
	Height        int
	X             int
	Y             int
	Text          string
	TimeoutMS     int
}

type computerExtendedResult struct {
	OK     bool   `json:"ok"`
	Effect string `json:"effect,omitempty"`
	Data   any    `json:"data,omitempty"`
	Error  string `json:"error,omitempty"`
}

type computerExtendedExecutor interface {
	extended(ctx context.Context, selection m1bComputerSelection, request computerExtendedRequest) computerExtendedResult
}

type computerExtendedDriver interface {
	Extended(context.Context, computerTarget, computerExtendedRequest) computerExtendedResult
}
