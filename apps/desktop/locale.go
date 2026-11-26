package main

import (
	"context"
	"errors"
	"runtime"
	"slices"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
	"github.com/egoist/mygo"
)

var (
	desktopLocaleGOOS = runtime.GOOS
	// The native language calls stay behind seams so the validated effect can
	// be tested without starting an app.
	desktopChosenLocale = func() string { return mygo.App.ChosenLocale() }
	desktopSetLocale    = func(tag string) { mygo.App.SetLocale(tag) }
	desktopRunOnMain    = mygo.RunOnMain
	desktopLocaleCaller = func(d *Desktop, ctx context.Context) error {
		return d.checkCaller(ctx)
	}
)

// SetLocale makes the macOS app language follow an explicit language choice
// made in the shared UI. The caller is checked before any work and again when
// the change is applied on the main thread, so a page that navigated away
// cannot change the app afterwards. MyGo applies SetLocale synchronously on
// the main thread, so a successful reply means the app language already
// changed.
func (d *Desktop) SetLocale(ctx context.Context, tag string) error {
	if err := desktopLocaleCaller(d, ctx); err != nil {
		return err
	}
	return applyDesktopLocale(ctx, d, tag)
}

func applyDesktopLocale(ctx context.Context, d *Desktop, tag string) error {
	if desktopLocaleGOOS != "darwin" {
		return errors.New("DESKTOP_HOST_UNAVAILABLE")
	}
	if !slices.Contains(locales.Catalog.Languages(), tag) {
		return errors.New("VALIDATION_ERROR")
	}
	ran := false
	var applyErr error
	desktopRunOnMain(func() {
		ran = true
		if err := desktopLocaleCaller(d, ctx); err != nil {
			applyErr = err
			return
		}
		if desktopChosenLocale() == tag {
			return
		}
		desktopSetLocale(tag)
	})
	if !ran {
		// The application quit before the main thread could apply the change.
		return errors.New("DESKTOP_HOST_UNAVAILABLE")
	}
	return applyErr
}
