package main

import (
	"embed"
	"time"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
	"github.com/egoist/mygo/transfer"
	"github.com/egoist/mygo/ui"
)

//go:embed assets/*
var assets embed.FS

var images = loadImages()
var appIcon = loadAppIcon()

func loadImages() map[string]*ui.SVG {
	result := make(map[string]*ui.SVG)
	for _, name := range []string{
		"linksense-primary", "linksense-on-dark", "Monitor", "ShieldCheck",
		"ArrowUpRight", "Settings2", "Link2", "CircleStop", "LockKeyhole",
		"Check", "ChevronRight", "MousePointer2", "CircleHelp", "X", "Pause",
		"Circle", "CircleCheck",
	} {
		data, err := assets.ReadFile("assets/" + name + ".svg")
		if err != nil {
			panic(err)
		}
		result[name] = ui.MustParseSVG(data)
	}
	return result
}

func loadAppIcon() ui.ImageSource {
	data, err := assets.ReadFile("assets/app-icon.png")
	if err != nil {
		panic(err)
	}
	icon, err := ui.DecodeImage(data)
	if err != nil {
		panic(err)
	}
	return icon
}

// Colors and metrics adapt the existing LinkSense tokens and Figma 1:506.
func (a *desktopApp) applyTheme(c *ui.Context) *ui.Theme {
	dark := c.Theme().Dark
	if a.theme != 0 {
		dark = a.theme == 2
	}
	t := *ui.LightTheme()
	t.FontSize, t.Radius, t.Spacing = 14, 8, 4
	t.Background, t.Surface = ui.Hex("#fafbfd"), ui.Hex("#ffffff")
	t.Text, t.TextMuted, t.Border = ui.Hex("#252b49"), ui.Hex("#626e86"), ui.Hex("#e5e8f0")
	t.Accent, t.AccentHover, t.AccentPressed = ui.Hex("#0070f5"), ui.Hex("#0065df"), ui.Hex("#095ccc")
	t.SurfaceHover, t.SurfacePressed = ui.Hex("#f2f6fd"), ui.Hex("#e9f1ff")
	t.Focus, t.Danger = ui.Hex("#6288dd"), ui.Hex("#d92d3a")
	if dark {
		t = *ui.DarkTheme()
		t.FontSize, t.Radius, t.Spacing = 14, 8, 4
		t.Background, t.Surface = ui.Hex("#141414"), ui.Hex("#202020")
		t.Text, t.TextMuted, t.Border = ui.Hex("#d8d8d8"), ui.Hex("#adb6c8"), ui.Hex("#383e4b")
		t.Accent, t.AccentText = ui.Hex("#8bb6ff"), ui.Hex("#141414")
	}
	c.SetTheme(&t)
	if a.reduceMotion {
		c.DisableAnimations()
	}
	return &t
}

func (a *desktopApp) stateCopy() (string, string) {
	l := locales.In(a.language)
	switch a.state {
	case connected:
		return l.StateConnected(), "Link2"
	case running:
		return l.StateRunning(), "MousePointer2"
	case paused:
		return l.StatePaused(), "Pause"
	case connectionError:
		return l.StateError(), "Link2"
	case awaitingApproval:
		return l.WaitingApproval(), "ShieldCheck"
	default:
		return l.StateDisconnected(), "Monitor"
	}
}

func (a *desktopApp) view(c *ui.Context) {
	t := a.applyTheme(c)
	l := locales.In(a.language)
	logo := images["linksense-primary"]
	if t.Dark {
		logo = images["linksense-on-dark"]
	}
	width, _ := c.Size()
	padding := float32(24)
	if width < 480 {
		padding = 20
	}
	c.OnShortcut(ui.Cmd, ui.KeyComma, func() { a.settings = true })
	ui.Column(c).Fill().Children(func() {
		bar := c.TitleBar()
		ui.Row(c).Height(max(40, bar.Height)).Padding(0, 16, 0, max(20, bar.Left+12)).
			DragWindow().Children(func() {
			ui.Spacer(c)
			ui.Text(c, l.AppTitle()).FontSize(12).TextColor(t.TextMuted)
		})
		ui.Scroll(c).Grow(1).Padding(4, padding, 20, padding).Gap(16).Children(func() {
			ui.Row(c).Children(func() {
				ui.Image(c, logo).Width(112)
				ui.Spacer(c)
				if ui.Button(c.Key("settings"), "").Label(l.Settings()).Tooltip(l.Settings()).
					Size(36, 36).Padding(0).Children(func() {
					ui.Icon(c, images["Settings2"]).FontSize(18)
				}).Clicked() {
					a.settings = true
				}
			})
			if a.preview {
				ui.Column(c.Key("preview")).Gap(8).Padding(12).Radius(8).
					Background(t.SurfacePressed).Children(func() {
					ui.Text(c, l.PreviewLabel()).FontSize(12).FontWeight(510)
					ui.Text(c, l.PreviewDescription()).FontSize(12).TextColor(t.TextMuted)
					selection := int(a.state)
					choices := []string{
						l.StateDisconnected(), l.StateConnected(), l.StateRunning(),
						l.StatePaused(), l.StateError(),
					}
					current := choices[selection]
					if ui.Select(c.Key("preview-state"), &current, choices).
						Label(l.PreviewState()).Changed() {
						for index, name := range choices {
							if name == current {
								a.state = connectionState(index)
								break
							}
						}
					}
				})
			}
			a.connectionCard(c, t)
			a.permissionsCard(c, t)
			if a.message != "" && !a.pairing {
				ui.Text(c, a.errorMessage()).FontSize(12).TextColor(t.Danger).LineHeight(1.5)
			}
		})
		ui.Row(c).Padding(12, padding).BorderWidth(1, 0, 0, 0).BorderColor(t.Border).
			Background(t.Surface).Children(func() {
			ui.Spacer(c)
			ui.Image(c, logo).Size(18*348.14/94, 18)
		})
	})
	a.setupDialog(c, t)
	a.settingsDialog(c, t)
	a.approvalDialog(c, t)
}

func (a *desktopApp) connectionCard(c *ui.Context, t *ui.Theme) {
	l := locales.In(a.language)
	title, icon := a.stateCopy()
	accent := t.Accent
	if a.state == connected {
		accent = ui.Hex("#178a55")
	} else if a.state == connectionError {
		accent = t.Danger
	}
	card := ui.Column(c.Key("connection-card")).Padding(20).Gap(16).Radius(12).
		Background(t.Surface).Border(1, t.Border).
		Shadow(0, 5, 14, 0, ui.RGBA(27, 39, 69, 0.025))
	card.Transition(ui.ElementTransition{Size: true, Duration: 200 * time.Millisecond})
	card.Children(func() {
		ui.Row(c).Gap(12).Children(func() {
			symbol := ui.Box(c.Key("status-icon")).Size(40, 40).Radius(10).Center()
			color := symbol.AnimateColor("accent", accent, ui.Animation{Duration: 180 * time.Millisecond})
			symbol.Background(color.Alpha(0.09)).Children(func() {
				mark := ui.Icon(c.Key(icon), images[icon]).FontSize(20).TextColor(color)
				mark.Transition(ui.ElementTransition{
					Animation: &ui.Snappy,
					Enter:     &ui.Motion{Scale: 0.9},
				})
			})
			ui.Text(c, title).Grow(1).FontSize(16).FontWeight(510).
				Role(ui.RoleHeading).Level(1)
		})
		ui.Column(c).Gap(14).Children(func() {
			a.detail(c, t, l.DeviceLabel(), a.deviceName, "Monitor")
			workspace := l.NoWorkspace()
			if a.preview && a.state != disconnected {
				workspace = l.PreviewWorkspace()
			} else if a.credential != nil {
				workspace = a.credential.Server
			}
			a.detail(c, t, l.WorkspaceLabel(), workspace, "Link2")
		})
		ui.Divider(c)
		if !a.preview && a.bridge != nil && (a.state == connected || a.state == running || a.state == awaitingApproval) {
			a.primary(c, t, l.Stop(), "CircleStop", a.stop).Disabled(false)
			ui.Button(c, l.Disconnect()).FillWidth().OnClick(a.disconnect)
		} else if a.state == running && a.preview {
			a.primary(c, t, l.Stop(), "CircleStop", a.stop).Disabled(false)
		} else if a.state == paused {
			a.primary(c, t, l.Resume(), "ShieldCheck", a.resume)
		} else if a.state == connected && a.preview {
			ui.Button(c, l.Disconnect()).FillWidth().Height(40).
				OnClick(func() { a.state = disconnected })
		} else if !a.preview && a.credential != nil {
			a.primary(c, t, l.Reconnect(), "Link2", a.reconnect)
			ui.Button(c, l.Disconnect()).FillWidth().OnClick(a.disconnect)
		} else {
			a.primary(c, t, l.Connect(), "ArrowUpRight", func() {
				a.message = ""
				a.pairing = true
			})
		}
	})
}

func (a *desktopApp) primary(c *ui.Context, t *ui.Theme, label, icon string, action func()) ui.Element {
	button := ui.PrimaryButton(c.Key(label), "").Label(label).FillWidth().Height(42).
		Disabled(a.busy).Radius(8).Children(func() {
		ui.Text(c, label).FontWeight(510)
		ui.Icon(c, images[icon]).FontSize(18)
	})
	pose := ui.Pose{}
	if button.Hovered() {
		pose.Y = -1
	}
	button.AnimatePose(pose, ui.Smooth)
	button.OnClick(action)
	return button
}

func (a *desktopApp) detail(c *ui.Context, t *ui.Theme, label, value, icon string) {
	ui.Row(c).Gap(9).Children(func() {
		ui.Icon(c, images[icon]).FontSize(16).TextColor(t.TextMuted)
		ui.Text(c, label).FontSize(12).TextColor(t.TextMuted).Grow(1)
		ui.Text(c, value).FontSize(12).MaxWidth(230)
	})
}

func (a *desktopApp) permissionsCard(c *ui.Context, t *ui.Theme) {
	l := locales.In(a.language)
	ui.Column(c).Gap(14).Padding(18, 20).Radius(12).Background(t.Surface).
		Border(1, t.Border).Children(func() {
		ui.Row(c).Children(func() {
			ui.Text(c, l.PermissionsTitle()).Grow(1).FontSize(14).FontWeight(510).Role(ui.RoleHeading).Level(2)
			ui.Button(c, l.CheckPermissions()).Disabled(a.preview || a.busy || a.state == running || a.state == awaitingApproval).
				OnClick(a.checkPermissions)
		})
		if a.platform == "darwin" {
			a.permissionRow(c, t, l.Accessibility(), a.permissions.Accessibility, "MousePointer2", "Privacy_Accessibility")
			a.permissionRow(c, t, l.ScreenCapture(), a.permissions.ScreenRecording, "Monitor", "Privacy_ScreenCapture")
		} else {
			state := a.permissions.Accessibility
			if state == "unknown" && a.permissions.ScreenRecording != "unknown" {
				state = a.permissions.ScreenRecording
			}
			a.permissionRow(c, t, l.DesktopAccess(), state, "MousePointer2", "")
		}
	})
}

func (a *desktopApp) setupDialog(c *ui.Context, t *ui.Theme) {
	l := locales.In(a.language)
	wasOpen := a.pairing
	ui.DialogBase(c, &a.pairing, func(backdrop, panel ui.Element) {
		backdrop.Background(ui.RGBA(23, 27, 64, 0.24))
		panel.Width(420).MaxWidthPercent(92).Padding(24).Gap(18).Radius(16).
			Background(t.Surface).Border(1, t.Border)
		ui.Text(c, l.SetupTitle()).FontSize(20).FontWeight(590)
		ui.Column(c).Gap(8).Children(func() {
			ui.Text(c, l.ServerLabel()).FontSize(13).FontWeight(510)
			ui.TextInput(c.Key("workspace-url"), &a.server).Label(l.ServerLabel()).
				Placeholder(l.ServerPlaceholder()).Height(42)
		})
		ui.Column(c).Gap(8).Children(func() {
			ui.Text(c, l.PairCode()).FontSize(13).FontWeight(510)
			ui.TextInput(c.Key("pair-code"), &a.pairingCode).Label(l.PairCode()).
				Placeholder(l.PairCodeHint()).Height(42).Password()
		})
		message := a.errorMessage()
		if message != "" {
			ui.Text(c.Key("setup-feedback"), message).FontSize(12).LineHeight(1.5).
				TextColor(t.TextMuted).Transition(ui.ElementTransition{Enter: &ui.Motion{Y: 4}})
		}
		ui.Row(c).Gap(8).Justify(ui.End).Children(func() {
			ui.Button(c, l.Cancel()).OnClick(a.cancelPairing)
			ui.Button(c, l.OpenBrowser()).Disabled(a.preview).OnClick(a.open)
			ui.PrimaryButton(c, l.PairConnect()).Disabled(a.preview || a.busy).OnClick(a.pair)
		})
	})
	if wasOpen && !a.pairing {
		a.cancelConnectionAttempt()
	}
}

func (a *desktopApp) permissionRow(c *ui.Context, t *ui.Theme, label, state, icon, pane string) {
	l := locales.In(a.language)
	value := l.NotChecked()
	if state == "granted" {
		value = l.Granted()
	} else if state == "denied" {
		value = l.Denied()
	}
	if a.preview && a.state != disconnected {
		value = l.ExampleGranted()
	}
	ui.Row(c).Gap(9).Children(func() {
		ui.Icon(c, images[icon]).FontSize(16).TextColor(t.TextMuted)
		ui.Text(c, label).Grow(1).FontSize(12).TextColor(t.TextMuted)
		ui.Text(c, value).FontSize(12)
		if !a.preview && state != "granted" && pane != "" {
			ui.Button(c, l.OpenSettings()).OnClick(func() { a.openPermissionSettings(pane) })
		}
	})
}

func (a *desktopApp) permissionDragView(c *ui.Context, close func(), appData transfer.Data) {
	t := a.applyTheme(c)
	l := locales.In(a.language)
	c.OnShortcut(0, ui.KeyEscape, close)
	ui.Column(c).Fill().Padding(16).Gap(12).Radius(16).
		Background(t.Surface).Border(1, t.Border).Children(func() {
		ui.Row(c).AlignItems(ui.Center).Gap(8).DragWindow().Children(func() {
			ui.Text(c, l.AppTitle()).Grow(1).FontSize(13).FontWeight(590)
			ui.Button(c, "").Size(24, 24).Padding(0).Radius(6).OnClick(close).
				Label(l.Cancel()).Children(func() {
				ui.Icon(c, images["X"]).FontSize(13).TextColor(t.TextMuted)
			})
		})
		drag := ui.Column(c).Grow(1).Center().Gap(8).Padding(10).Radius(12).
			Background(t.SurfaceHover).Border(1, t.Border)
		drag.DragData(appData, transfer.DragOptions{Operations: transfer.Copy})
		drag.Children(func() {
			ui.Image(c, appIcon).Size(64, 64)
			ui.Text(c, l.DragToSettings()).FontSize(12).TextColor(t.TextMuted)
		})
	})
}

func (a *desktopApp) approvalDialog(c *ui.Context, t *ui.Theme) {
	pending := a.pendingApproval
	if pending == nil {
		return
	}
	if pending.ctx.Err() != nil {
		a.pendingApproval = nil
		return
	}
	l := locales.In(a.language)
	open := true
	ui.DialogBase(c, &open, func(backdrop, panel ui.Element) {
		backdrop.Background(ui.RGBA(23, 27, 64, 0.24))
		panel.Width(420).MaxWidthPercent(92).Padding(24).Gap(18).Radius(16).Background(t.Surface).Border(1, t.Border)
		ui.Text(c, l.AllowTask()).FontSize(18).FontWeight(590)
		ui.Text(c, pending.command.Title).FontSize(14).MaxHeight(100)
		text := l.TaskScope()
		if *pending.command.ReadOnly {
			text = l.ReadOnlyScope()
		}
		ui.Text(c, text).FontSize(12).LineHeight(1.5).TextColor(t.TextMuted)
		ui.Row(c).Gap(8).Justify(ui.End).Children(func() {
			ui.Button(c, l.Reject()).OnClick(func() { a.decide(false) })
			ui.PrimaryButton(c, l.AllowOnce()).OnClick(func() { a.decide(true) })
		})
	})
	if !open {
		a.decide(false)
	}
}

func (a *desktopApp) errorMessage() string {
	l := locales.In(a.language)
	switch a.message {
	case "invalidURL":
		return l.InvalidURL()
	case "openFailed":
		return l.OpenFailed()
	case "invalidPairCode":
		return l.InvalidPairCode()
	case "pairFailed":
		return l.PairFailed()
	case "credentialFailed":
		return l.CredentialFailed()
	case "connectionFailed", "connectionLost":
		return l.ConnectionFailed()
	default:
		return ""
	}
}

func (a *desktopApp) settingsDialog(c *ui.Context, t *ui.Theme) {
	l := locales.In(a.language)
	ui.DialogBase(c, &a.settings, func(backdrop, panel ui.Element) {
		backdrop.Background(ui.RGBA(23, 27, 64, 0.24))
		panel.Width(420).MaxWidthPercent(92).Padding(24).Gap(20).Radius(16).
			Background(t.Surface).Border(1, t.Border)
		ui.Row(c).Children(func() {
			ui.Text(c, l.Settings()).FontSize(20).FontWeight(590).Grow(1)
			ui.Button(c, "").Label(l.Cancel()).Children(func() {
				ui.Icon(c, images["X"]).FontSize(16)
			}).OnClick(func() { a.settings = false })
		})
		ui.Column(c).Gap(8).Children(func() {
			ui.Text(c, l.LanguageLabel()).FontSize(13).FontWeight(510)
			tags := []string{"zh-CN", "en-US", "es-ES", "pt-BR", "fr-FR", "ja-JP"}
			names := []string{"简体中文", "English", "Español", "Português (Brasil)", "Français", "日本語"}
			current := names[0]
			for index, tag := range tags {
				if tag == a.language {
					current = names[index]
				}
			}
			if ui.Select(c, &current, names).Label(l.LanguageLabel()).Changed() {
				for index, name := range names {
					if name == current {
						a.language = tags[index]
					}
				}
			}
		})
		ui.Column(c).Gap(8).Children(func() {
			ui.Text(c, l.ThemeLabel()).FontSize(13).FontWeight(510)
			ui.Segmented(c, &a.theme, l.ThemeSystem(), l.ThemeLight(), l.ThemeDark()).Label(l.ThemeLabel())
		})
		ui.Checkbox(c, &a.reduceMotion, l.ReduceMotion())
	})
}
