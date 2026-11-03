package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

func main() {
	preview := flag.Bool("preview", false, "preview UI states without connecting or controlling the desktop")
	doctor := flag.Bool("doctor", false, "check the pinned local engine and OS permissions without controlling apps")
	whiteboxTarget := flag.Bool("whitebox-target", false, "open an isolated input window for native Computer Use verification")
	flag.Parse()
	if *doctor {
		binary := os.Getenv("LINKSENSE_AGENT_DESKTOP_BIN")
		engine := &nativeEngine{path: binary}
		defer engine.Stop()
		if err := json.NewEncoder(os.Stdout).Encode(engine.Permissions(context.Background())); err != nil {
			os.Exit(1)
		}
		return
	}
	if *whiteboxTarget {
		value := ""
		clicked := false
		mygo.App.WhenReady(func() {
			mygo.NewWindow(mygo.WindowOptions{
				Title: "LinkSense Computer Use Whitebox", Width: 420, Height: 300,
				Content: ui.View(func(c *ui.Context) {
					ui.Column(c).Fill().Padding(24).Gap(16).Children(func() {
						ui.Text(c, "Computer Use Whitebox").Role(ui.RoleHeading).Level(1)
						ui.TextInput(c, &value).Label("Whitebox input").Placeholder("Whitebox input")
						ui.Button(c, "Whitebox button").OnClick(func() { clicked = true })
						if clicked {
							ui.Text(c, "Whitebox clicked")
						}
					})
				}),
			})
		})
		if err := mygo.App.Run(); err != nil {
			log.Fatal(err)
		}
		return
	}
	deviceName, err := os.Hostname()
	if err != nil {
		deviceName = "Desktop"
	}
	app := newDesktopApp(*preview, deviceName)
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}
	mygo.App.OnOpenURL(app.handlePairURL)
	mygo.App.OnSecondInstance(func(_ []string, _ string) {
		if app.show != nil {
			app.show()
		}
	})
	defer func() {
		app.cancelConnectionAttempt()
		app.stopPermissionRefresh()
		if app.bridge != nil {
			app.bridge.Disconnect()
		}
	}()
	app.openWorkspace = mygo.Shell.OpenExternal
	mygo.App.SetLocale(app.language)
	mygo.App.WhenReady(func() {
		win := mygo.NewWindow(mygo.WindowOptions{
			Title:         locales.In(app.language).AppTitle(),
			Width:         480,
			Height:        570,
			MinWidth:      400,
			MinHeight:     480,
			TitleBarStyle: mygo.TitleBarHidden,
			StateKey:      "desktop-main",
			Content:       ui.View(app.view),
		})
		app.post = win.Update
		app.show = func() { win.Show(); win.Focus() }
		if !app.preview {
			engine := app.attachRuntime()
			mygo.App.OnBeforeQuit(func(_ *mygo.QuitEvent) {
				app.stopPermissionRefresh()
				app.bridge.Disconnect()
				engine.Stop()
			})
			win.OnFocus(app.refreshPermissions)
			app.startPermissionRefresh()
			app.restore()
		}
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
