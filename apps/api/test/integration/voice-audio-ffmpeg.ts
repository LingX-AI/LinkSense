import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { createVoiceAudioNormalizer } from "../../src/adapters/voice-audio-normalizer.js"

const execute = promisify(execFile)
const root = await mkdtemp(join(tmpdir(), "linksense-voice-native-"))
const normalize = createVoiceAudioNormalizer({ temporaryRoot: root })
const fixtures = [
  { mime: "audio/webm", extension: "webm", codec: "libopus" },
  { mime: "audio/mp4", extension: "mp4", codec: "aac" },
  { mime: "audio/x-m4a", extension: "m4a", codec: "aac" },
  { mime: "audio/ogg", extension: "ogg", codec: "libopus" },
  { mime: "audio/wav", extension: "wav", codec: "pcm_s16le" },
  { mime: "audio/mpeg", extension: "mp3", codec: "libmp3lame" },
  { mime: "audio/aac", extension: "aac", codec: "aac" },
]

try {
  await execute("ffmpeg", ["-version"])
  for (const fixture of fixtures) {
    const source = join(root, `fixture.${fixture.extension}`)
    await execute("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-f", "lavfi",
      "-i", "sine=frequency=440:sample_rate=48000:duration=0.25",
      "-ac", "2", "-c:a", fixture.codec, source,
    ], { timeout: 10_000 })
    const bytes = await readFile(source)
    const audio = Buffer.from(await normalize({
      audioDataUrl: `data:${fixture.mime};base64,${bytes.toString("base64")}`,
    }))
    assert.equal(audio.toString("ascii", 0, 4), "RIFF")
    assert.equal(audio.toString("ascii", 8, 12), "WAVE")
    assert.equal(audio.toString("ascii", 12, 16), "fmt ")
    assert.equal(audio.readUInt16LE(20), 1, "PCM encoding")
    assert.equal(audio.readUInt16LE(22), 1, "mono")
    assert.equal(audio.readUInt32LE(24), 16_000, "16 kHz")
    assert.equal(audio.readUInt16LE(34), 16, "16-bit samples")
    assert.equal(audio.toString("ascii", 36, 40), "data")
    assert.equal(audio.readUInt32LE(4), audio.length - 8, "final RIFF size")
    assert.equal(audio.readUInt32LE(40), audio.length - 44, "final data size for gateway duration accounting")
    assert.ok(audio.length > 44)
    console.log(`${fixture.mime}: valid 16 kHz mono PCM WAV`)
  }
  const longAudio = join(root, "overlong.webm")
  await execute("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-f", "lavfi",
    "-i", "anullsrc=r=16000:cl=mono", "-t", "301", "-c:a", "libopus", longAudio,
  ], { timeout: 10_000 })
  const data = await readFile(longAudio)
  await assert.rejects(normalize({ audioDataUrl: `data:audio/webm;base64,${data.toString("base64")}` }), { reason: "too_long" })
  await assert.rejects(normalize({ audioDataUrl: `data:audio/wav;base64,${Buffer.from("corrupt audio").toString("base64")}` }), { reason: "failed" })
  assert.ok((await readdir(root)).every((name) => !name.startsWith("linksense-voice-")), "conversion directories are cleaned")
  console.log("overlong/corrupt recordings: rejected and cleaned")
} finally {
  await rm(root, { recursive: true, force: true })
}
