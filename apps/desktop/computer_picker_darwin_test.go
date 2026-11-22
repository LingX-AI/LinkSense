//go:build darwin

package main

import (
	"testing"

	"github.com/LingX-AI/linksense/apps/desktop/locales"
	"github.com/egoist/mygo/ui"
)

func newPickerTestModel(tx locales.Messages, options []computerPickerOption) *computerPickerModel {
	model := &computerPickerModel{tx: tx, options: options, chosen: -1, done: make(chan computerPickerOutcome, 1)}
	model.list.Selected = &model.chosen
	model.list.Label = func(index int) string { return model.options[index].Label }
	return model
}

func pickerOutcome(model *computerPickerModel) (computerPickerOutcome, bool) {
	select {
	case outcome := <-model.done:
		return outcome, true
	default:
		return computerPickerOutcome{}, false
	}
}

func TestComputerPickerRequiresFocusSelectionAndExplicitConfirm(t *testing.T) {
	target := computerSelectedTarget{BundleID: "com.example.editor", WindowID: "42", PID: 7, ProcessInstance: "instance"}
	model := newPickerTestModel(locales.In("en-US"), []computerPickerOption{{Label: "Editor — Untitled", Target: target}})
	focused := false
	model.focused = func() bool { return focused }
	tester := ui.NewTester(model.view, 620, 500)
	tx := locales.In("en-US")

	// Confirm with no row chosen does nothing.
	if err := tester.Click(tx.ComputerPickerConfirm()); err != nil {
		t.Fatal(err)
	}
	if _, ok := pickerOutcome(model); ok {
		t.Fatal("confirm without a selection produced an outcome")
	}
	// Choosing a row still needs focus.
	if err := tester.Click("Editor — Untitled"); err != nil {
		t.Fatal(err)
	}
	if model.chosen != 0 {
		t.Fatalf("the row was not chosen: %d", model.chosen)
	}
	if err := tester.Click(tx.ComputerPickerConfirm()); err != nil {
		t.Fatal(err)
	}
	if _, ok := pickerOutcome(model); ok {
		t.Fatal("an unfocused picker accepted a selection")
	}
	// With focus, the same explicit confirm produces the exact target.
	focused = true
	if err := tester.Click(tx.ComputerPickerConfirm()); err != nil {
		t.Fatal(err)
	}
	outcome, ok := pickerOutcome(model)
	if !ok || !outcome.selected || outcome.target != target {
		t.Fatalf("confirm produced %+v", outcome)
	}
}

func TestComputerPickerCancelAndEmptyInventory(t *testing.T) {
	model := newPickerTestModel(locales.In("en-US"), nil)
	model.focused = func() bool { return true }
	tester := ui.NewTester(model.view, 620, 500)
	tx := locales.In("en-US")
	if err := tester.Click(tx.ComputerPickerCancel()); err != nil {
		t.Fatal(err)
	}
	outcome, ok := pickerOutcome(model)
	if !ok || outcome.selected {
		t.Fatalf("cancel produced %+v", outcome)
	}

	// A second close/cancel is idempotent.
	model.cancel()
	if _, ok := pickerOutcome(model); ok {
		t.Fatal("the picker reported two outcomes")
	}
}

func TestComputerPickerRowsAreUniqueAndBounded(t *testing.T) {
	options := computerPickerOptions([]computerPickerCandidate{
		{AppName: "Editor", Title: "One", Target: computerSelectedTarget{BundleID: "a", WindowID: "1", PID: 1, ProcessInstance: "i"}},
		{AppName: "Editor", Title: "Two", Target: computerSelectedTarget{BundleID: "b", WindowID: "2", PID: 2, ProcessInstance: "i"}},
	})
	model := newPickerTestModel(locales.In("en-US"), options)
	model.focused = func() bool { return true }
	tester := ui.NewTester(model.view, 620, 500)
	if err := tester.Click(options[1].Label); err != nil {
		t.Fatal(err)
	}
	if model.chosen != 1 {
		t.Fatalf("the second row was not chosen: %d", model.chosen)
	}
	model.confirm()
	outcome, ok := pickerOutcome(model)
	if !ok || outcome.target.BundleID != "b" {
		t.Fatalf("confirm chose %+v", outcome)
	}
	if _, ok := pickerOutcome(model); ok {
		t.Fatal("the picker reported two outcomes")
	}
}
