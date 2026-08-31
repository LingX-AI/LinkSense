export const VOICE_WAVEFORM_INTERVAL_MS = 80
export const VOICE_WAVEFORM_MIN_SAMPLES = 72
export const VOICE_WAVEFORM_BAR_WIDTH_PX = 2
export const VOICE_WAVEFORM_BAR_GAP_PX = 3

const VOICE_INPUT_FREQUENCY_BANDS = [
  [90, 170],
  [170, 300],
  [300, 520],
  [520, 850],
  [850, 1_350],
  [1_350, 2_200],
  [2_200, 3_600],
] as const

const VOICE_INPUT_BAND_CONTOUR = [0.58, 0.92, 0.7, 1, 0.76, 0.88, 0.62]

export type VoiceWaveformHistorySample = {
  id: number
  level: number
}

export function clampVoiceWaveformLevel(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function createSilentVoiceFrequencyWaveform() {
  return Array.from({ length: VOICE_INPUT_FREQUENCY_BANDS.length }, () => 0)
}

export function computeVoiceTimeDomainRms(samples: Uint8Array) {
  if (!samples.length) return 0

  let sum = 0
  for (const sample of samples) {
    const normalized = (sample - 128) / 128
    sum += normalized * normalized
  }
  return Math.sqrt(sum / samples.length)
}

export function normalizeVoiceInputLevel(rms: number) {
  if (!Number.isFinite(rms)) return 0
  return clampVoiceWaveformLevel((rms - 0.003) / 0.075)
}

function normalizeFrequencyMagnitude(value: number) {
  if (!Number.isFinite(value)) return 0
  return clampVoiceWaveformLevel(Math.pow(value / 255, 0.72))
}

export function computeVoiceFrequencyWaveform(
  samples: Uint8Array,
  sampleRate: number
) {
  if (!samples.length) return createSilentVoiceFrequencyWaveform()

  const nyquistFrequency = sampleRate / 2
  const binFrequency = nyquistFrequency / samples.length
  if (!Number.isFinite(binFrequency) || binFrequency <= 0) {
    return createSilentVoiceFrequencyWaveform()
  }

  return VOICE_INPUT_FREQUENCY_BANDS.map(
    ([minFrequency, maxFrequency], index) => {
      const start = Math.max(1, Math.floor(minFrequency / binFrequency))
      const end = Math.min(
        samples.length,
        Math.max(start + 1, Math.ceil(maxFrequency / binFrequency))
      )
      let sum = 0
      let peak = 0

      for (
        let sampleIndex = start;
        sampleIndex < end && sampleIndex < samples.length;
        sampleIndex += 1
      ) {
        const value = samples[sampleIndex] ?? 0
        sum += value
        peak = Math.max(peak, value)
      }

      const count = Math.max(1, Math.min(end, samples.length) - start)
      const average = sum / count
      const contour = VOICE_INPUT_BAND_CONTOUR[index] ?? 0.7
      return (
        normalizeFrequencyMagnitude(average * 0.68 + peak * 0.32) *
        (0.72 + contour * 0.28)
      )
    }
  )
}

export function smoothVoiceFrequencyWaveform(
  previous: readonly number[],
  next: readonly number[]
) {
  return next.map((level, index) => {
    const previousLevel = previous[index] ?? 0
    const smoothing = level > previousLevel ? 0.72 : 0.42
    return previousLevel * (1 - smoothing) + level * smoothing
  })
}

export function combineVoiceWaveformLevel(
  inputLevel: number,
  frequencyWaveform: readonly number[]
) {
  const normalizedInputLevel = clampVoiceWaveformLevel(inputLevel)
  const peak = frequencyWaveform.reduce(
    (maximum, value) => Math.max(maximum, clampVoiceWaveformLevel(value)),
    0
  )
  const average = frequencyWaveform.length
    ? frequencyWaveform.reduce(
        (total, value) => total + clampVoiceWaveformLevel(value),
        0
      ) / frequencyWaveform.length
    : normalizedInputLevel
  const energy = clampVoiceWaveformLevel(
    normalizedInputLevel * 0.58 + peak * 0.28 + average * 0.14
  )

  if (energy <= 0.006) return 0.015
  return Math.max(0.035, energy)
}

export function varyVoiceWaveformLevel(level: number, frame: number) {
  const normalizedFrame = Math.max(0, Math.floor(frame))
  const variation = 0.88 + (normalizedFrame % 5) * 0.06
  return clampVoiceWaveformLevel(level * variation)
}

export function getVoiceWaveformMaxSamples(trackWidth: number) {
  if (!Number.isFinite(trackWidth) || trackWidth <= 0) {
    return VOICE_WAVEFORM_MIN_SAMPLES
  }
  return Math.max(
    VOICE_WAVEFORM_MIN_SAMPLES,
    Math.ceil(
      (trackWidth + VOICE_WAVEFORM_BAR_GAP_PX) /
        (VOICE_WAVEFORM_BAR_WIDTH_PX + VOICE_WAVEFORM_BAR_GAP_PX)
    )
  )
}

export function appendVoiceWaveformHistory(
  history: readonly VoiceWaveformHistorySample[],
  nextSamples: readonly VoiceWaveformHistorySample[],
  maxSamples: number
) {
  const safeMaximum = Math.max(1, Math.floor(maxSamples))
  return [...history, ...nextSamples].slice(-safeMaximum)
}
