// @vitest-environment node

import { describe, expect, it } from "vitest"

import {
  appendVoiceWaveformHistory,
  combineVoiceWaveformLevel,
  computeVoiceFrequencyWaveform,
  computeVoiceTimeDomainRms,
  getVoiceWaveformMaxSamples,
  normalizeVoiceInputLevel,
  smoothVoiceFrequencyWaveform,
  varyVoiceWaveformLevel,
  VOICE_WAVEFORM_MIN_SAMPLES,
} from "@/features/conversations/voice-waveform"

describe("voice waveform sampling", () => {
  it("derives input energy from time-domain audio around the neutral midpoint", () => {
    const samples = Uint8Array.from([132, 124, 132, 124])

    const rms = computeVoiceTimeDomainRms(samples)

    expect(rms).toBeCloseTo(0.03125)
    expect(normalizeVoiceInputLevel(rms)).toBeGreaterThan(0.3)
    expect(computeVoiceTimeDomainRms(Uint8Array.from([128, 128]))).toBe(0)
  })

  it("keeps seven speech frequency bands and smooths rises faster than falls", () => {
    const frequencySamples = new Uint8Array(512)
    frequencySamples.fill(180, 2, 80)

    const waveform = computeVoiceFrequencyWaveform(frequencySamples, 48_000)
    const rising = smoothVoiceFrequencyWaveform(
      Array.from({ length: 7 }, () => 0),
      waveform
    )
    const falling = smoothVoiceFrequencyWaveform(
      Array.from({ length: 7 }, () => 1),
      waveform
    )

    expect(waveform).toHaveLength(7)
    expect(new Set(waveform).size).toBeGreaterThan(1)
    expect(rising[0]).toBeLessThan(waveform[0] ?? 0)
    expect(falling[0]).toBeGreaterThan(waveform[0] ?? 0)
  })

  it("combines each analyser frame into one bounded temporal sample", () => {
    const silent = combineVoiceWaveformLevel(0, [0, 0, 0, 0, 0, 0, 0])
    const loud = combineVoiceWaveformLevel(
      0.9,
      [0.5, 0.8, 0.6, 1, 0.7, 0.9, 0.4]
    )

    expect(silent).toBe(0.015)
    expect(loud).toBeGreaterThan(silent)
    expect(varyVoiceWaveformLevel(loud, 4)).toBeLessThanOrEqual(1)
  })
})

describe("voice waveform history", () => {
  it("appends on the right and evicts only the oldest samples on the left", () => {
    const history = appendVoiceWaveformHistory(
      [
        { id: 1, level: 0.1 },
        { id: 2, level: 0.2 },
      ],
      [
        { id: 3, level: 0.3 },
        { id: 4, level: 0.4 },
      ],
      3
    )

    expect(history.map((sample) => sample.id)).toEqual([2, 3, 4])
  })

  it("sizes the history from the visible track while preserving a safe minimum", () => {
    expect(getVoiceWaveformMaxSamples(0)).toBe(VOICE_WAVEFORM_MIN_SAMPLES)
    expect(getVoiceWaveformMaxSamples(620)).toBe(125)
  })
})
