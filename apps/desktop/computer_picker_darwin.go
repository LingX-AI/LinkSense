//go:build darwin

package main

// Native MyGo picker for one computer-control target.
//
// The picker is a MyGo native-UI sheet, not the shared WebView page. It shows
// only sanitized, bounded application names and window titles from the signed
// driver's inventory. The selected four-part window identity stays in this
// process; the page, device socket, server, tools and diagnostics never see
// it. An explicit row choice plus the confirm button (or Return on a focused
// list) is required, the window must still have focus, and closing, Escape or
// Cancel reports a cancellation.

import (
	"context"
	"sync"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

type computerPickerOutcome struct {
	target   computerSelectedTarget
	selected bool
}

type computerPickerModel struct {
	tx      locales.Messages
	options []computerPickerOption
	list    ui.ListState
	chosen  int
	focused func() bool
	done    chan computerPickerOutcome
	once    sync.Once
}

func (model *computerPickerModel) finish(outcome computerPickerOutcome) {
	model.once.Do(func() { model.done <- outcome })
}

func (model *computerPickerModel) cancel() {
	model.finish(computerPickerOutcome{})
}

func (model *computerPickerModel) confirm() {
	// Focus is part of the gesture: a click delivered to an inactive window or
	// an automated selection after focus moved elsewhere chooses nothing.
	if model.focused == nil || !model.focused() {
		return
	}
	if model.chosen < 0 || model.chosen >= len(model.options) {
		return
	}
	target := model.options[model.chosen].Target
	if target.validate() != nil {
		return
	}
	model.finish(computerPickerOutcome{target: target, selected: true})
}

func (model *computerPickerModel) view(c *ui.Context) {
	c.OnWindowShortcut(0, ui.KeyEscape, model.cancel)
	ui.Column(c).Fill().Padding(20).Gap(12).Children(func() {
		ui.Text(c, model.tx.ComputerPickerTitle()).FontSize(18).Bold()
		ui.Text(c, model.tx.ComputerPickerHint()).FontSize(12).TextColor(c.Theme().TextMuted)
		if len(model.options) == 0 {
			ui.Text(c, model.tx.ComputerPickerEmpty()).Grow(1)
		} else {
			list := ui.List(c, &model.list, len(model.options), func(index int) {
				ui.Text(c, model.options[index].Label).Padding(8)
			}).Grow(1)
			if list.Submitted() {
				model.confirm()
			}
		}
		ui.Row(c).Gap(8).Justify(ui.End).Children(func() {
			ui.Button(c, model.tx.ComputerPickerCancel()).OnClick(model.cancel)
			confirm := ui.PrimaryButton(c, model.tx.ComputerPickerConfirm()).
				Disabled(len(model.options) == 0 || model.chosen < 0)
			confirm.OnClick(model.confirm)
		})
	})
}

func showComputerTargetPicker(ctx context.Context, parent *mygo.Window, options []computerPickerOption) (computerSelectedTarget, error) {
	if err := ctx.Err(); err != nil {
		return computerSelectedTarget{}, err
	}
	tx := locales.In(mygo.App.Locale())
	model := &computerPickerModel{
		tx: tx, options: options, chosen: -1, done: make(chan computerPickerOutcome, 1),
	}
	model.list.Selected = &model.chosen
	model.list.Label = func(index int) string {
		if index < 0 || index >= len(model.options) {
			return ""
		}
		return model.options[index].Label
	}
	windowOptions := mygo.WindowOptions{
		Title: tx.ComputerPickerTitle(), Width: 620, Height: 500, MinWidth: 460, MinHeight: 320,
		Content: ui.View(model.view),
	}
	if parent != nil {
		windowOptions.Parent = parent
		windowOptions.Modal = true
	}
	window := mygo.NewWindow(windowOptions)
	model.focused = window.IsFocused
	window.OnClose(func(*mygo.CloseEvent) { model.cancel() })
	window.Show()
	window.Focus()
	select {
	case outcome := <-model.done:
		window.Close()
		if !outcome.selected {
			return computerSelectedTarget{}, errComputerPickerCanceled
		}
		return outcome.target, nil
	case <-ctx.Done():
		model.cancel()
		window.Close()
		return computerSelectedTarget{}, ctx.Err()
	}
}
