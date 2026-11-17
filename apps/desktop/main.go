package main

import (
	"log"
	"net/http"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/fetch"
	"github.com/egoist/mygo/ui"
)

func main() {
	mygo.App.SetName("LinkSense")
	desktop := &Desktop{}
	defer desktop.closeDevice()
	defer desktop.cancelSignIn()
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
				desktop.server != nil && request.URL.Path != desktopLoginExchangePath &&
				allowsAPIRequest(desktop.server, request)
		},
	}))
	mygo.App.OnOpenURL(desktop.handleOpenURL)
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
		root, err := mygo.App.Path(mygo.PathUserData)
		if err != nil {
			log.Fatal("DESKTOP_DATA_DIRECTORY_UNAVAILABLE")
		}
		if parsed, err := configuredServerURL(mygo.IsDev()); err == nil {
			desktop.configure(parsed, mygo.Secrets, root)
			desktop.openMainWindow()
			return
		}
		catalog := locales.In(mygo.App.Locale())
		mygo.NewWindow(mygo.WindowOptions{
			Title: "LinkSense", Width: 500, Height: 310, MinWidth: 420, MinHeight: 300,
			Content: ui.View(func(c *ui.Context) {
				ui.Column(c).Fill().Padding(28).Gap(16).Children(func() {
					ui.Text(c, catalog.BuildConfigurationTitle()).Role(ui.RoleHeading).Level(1)
					ui.Text(c, catalog.BuildConfigurationInvalid())
					ui.PrimaryButton(c, catalog.Quit()).OnClick(func() { mygo.App.Quit() })
				})
			}),
		})
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal("DESKTOP_START_FAILED")
	}
}

// The client is created after validating the packaged server origin.
type configuredTransport struct {
	desktop *Desktop
}

func (t *configuredTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return t.desktop.roundTrip(request)
}
