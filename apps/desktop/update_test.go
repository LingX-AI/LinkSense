package main

import (
	"context"
	"errors"
	"testing"

	"github.com/egoist/mygo"
)

func TestDesktopUpdateCheckReturnsOnlySafeStatusAndVersion(t *testing.T) {
	for _, test := range []struct {
		name    string
		update  *mygo.Update
		err     error
		expects DesktopUpdateResult
	}{
		{"new version", &mygo.Update{Version: "1.2.3", Notes: "untrusted feed text"}, nil, DesktopUpdateResult{State: UpdateAvailable, Version: "1.2.3"}},
		{"up to date", nil, nil, DesktopUpdateResult{State: UpdateCurrent}},
		{"build without feed", nil, mygo.ErrUpdatesDisabled, DesktopUpdateResult{State: UpdateUnavailable}},
		{"failed feed", nil, errors.New("external feed error"), DesktopUpdateResult{State: UpdateFailed}},
		{"invalid version", &mygo.Update{Version: "unexpected\ntext"}, nil, DesktopUpdateResult{State: UpdateFailed}},
	} {
		t.Run(test.name, func(t *testing.T) {
			result := checkDesktopUpdate(context.Background(), func(context.Context) (*mygo.Update, error) {
				return test.update, test.err
			})
			if result != test.expects {
				t.Fatalf("unexpected update result: %+v", result)
			}
		})
	}
	if _, err := (&Desktop{}).CheckForUpdate(context.Background()); err == nil {
		t.Fatal("untrusted page could check for updates")
	}
}
