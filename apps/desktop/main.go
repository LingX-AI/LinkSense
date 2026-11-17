package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/fetch"
	"github.com/egoist/mygo/ui"
)

func main() {
	mygo.App.SetName("LinkSense")
	desktop := &Desktop{}
	defer desktop.closeDevice()
	mygo.Bind(desktop)
	mygo.Use(fetch.New(fetch.Options{
		Client: &http.Client{
			Transport: &configuredTransport{desktop: desktop},
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		Allow: func(request *http.Request) bool {
			return desktop.checkCaller(request.Context()) == nil &&
				desktop.server != nil && allowsAPIRequest(desktop.server, request)
		},
	}))
	mygo.App.WhenReady(func() {
		if !mygo.App.RequestSingleInstanceLock() {
			mygo.App.Quit()
			return
		}
		mygo.App.OnSecondInstance(func(_ []string, _ string) {
			if win := desktop.mainWindow(); win != nil {
				win.Show()
				win.Focus()
			}
		})
		mygo.App.OnOpenURL(func(raw string) {
			win := desktop.mainWindow()
			if route, err := conversationDeepLink(raw); err == nil && win != nil {
				win.Show()
				win.Focus()
				_ = win.Page().LoadURL(route)
			}
		})
		root, err := mygo.App.Path(mygo.PathUserData)
		if err != nil {
			log.Fatal("DESKTOP_DATA_DIRECTORY_UNAVAILABLE")
		}
		configPath := filepath.Join(root, "config.json")
		config, configErr := loadDesktopConfig(configPath)
		server := os.Getenv("LINKSENSE_DESKTOP_SERVER_URL")
		if server == "" && configErr == nil {
			server = config.ServerURL
		}
		if parsed, err := parseServerURL(server); err == nil {
			desktop.configure(parsed, mygo.Secrets, root)
			desktop.openMainWindow()
			return
		}
		catalog := locales.In(mygo.App.Locale())
		status := ""
		var setup *mygo.Window
		setup = mygo.NewWindow(mygo.WindowOptions{
			Title: "LinkSense", Width: 500, Height: 310, MinWidth: 420, MinHeight: 300,
			Content: ui.View(func(c *ui.Context) {
				ui.Column(c).Fill().Padding(28).Gap(16).Children(func() {
					ui.Text(c, catalog.ServerTitle()).Role(ui.RoleHeading).Level(1)
					ui.Text(c, catalog.ServerDescription())
					ui.TextInput(c, &server).Label(catalog.ServerLabel()).Placeholder("https://…")
					if status != "" {
						ui.Text(c, status)
					}
					ui.PrimaryButton(c, catalog.Connect()).OnClick(func() {
						parsed, err := parseServerURL(server)
						if err != nil {
							status = catalog.ServerInvalid()
							return
						}
						if err := saveDesktopConfig(configPath, parsed); err != nil {
							status = catalog.ConfigSaveFailed()
							return
						}
						desktop.configure(parsed, mygo.Secrets, root)
						desktop.openMainWindow()
						setup.Close()
					})
				})
			}),
		})
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal("DESKTOP_START_FAILED")
	}
}

// The client is created only after the user has chosen a server.
type configuredTransport struct {
	desktop *Desktop
}

func (t *configuredTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return t.desktop.roundTrip(request)
}
