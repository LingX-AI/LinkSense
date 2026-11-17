package main

import (
	"context"
	"errors"
	"regexp"
	"time"

	"github.com/egoist/mygo"
)

type DesktopUpdateState string

const (
	UpdateAvailable   DesktopUpdateState = "available"
	UpdateCurrent     DesktopUpdateState = "current"
	UpdateUnavailable DesktopUpdateState = "unavailable"
	UpdateFailed      DesktopUpdateState = "failed"
)

type DesktopUpdateResult struct {
	State   DesktopUpdateState `json:"state"`
	Version string             `json:"version,omitempty"`
}

var updateVersion = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.+-]+)?$`)

func (d *Desktop) CheckForUpdate(ctx context.Context) (DesktopUpdateResult, error) {
	if err := d.checkCaller(ctx); err != nil {
		return DesktopUpdateResult{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	return checkDesktopUpdate(ctx, mygo.Updater.Check), nil
}

func checkDesktopUpdate(ctx context.Context, check func(context.Context) (*mygo.Update, error)) DesktopUpdateResult {
	update, err := check(ctx)
	switch {
	case errors.Is(err, mygo.ErrUpdatesDisabled):
		return DesktopUpdateResult{State: UpdateUnavailable}
	case err != nil:
		return DesktopUpdateResult{State: UpdateFailed}
	case update == nil:
		return DesktopUpdateResult{State: UpdateCurrent}
	case len(update.Version) > 80 || !updateVersion.MatchString(update.Version):
		return DesktopUpdateResult{State: UpdateFailed}
	default:
		return DesktopUpdateResult{State: UpdateAvailable, Version: update.Version}
	}
}
