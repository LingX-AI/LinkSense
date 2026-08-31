---
title: Use voice input
description: Convert microphone speech into editable text and resolve permission or transcription problems.
---

# Use voice input

Voice input only converts speech into text in the input field. It never submits a task automatically or attaches the recording to the task.

## Record and transcribe

1. Select the microphone button in the task composer or an Office selection action field.
2. The first time you use it, allow the current LinkSense page to access your microphone.
3. Start speaking when the recording duration and waveform appear.
4. Select the stop button. Recording also stops automatically at five minutes.
5. Wait for **Transcribing speech** to finish.
6. Review and edit the text inserted into the field, then choose whether to send or run the action.

You cannot begin another recording or submit the current input while transcription is in progress. Existing draft text is preserved, and the transcript is added to the current draft.

## Recording limits

- A recording must be at least one second long.
- A single recording can last up to five minutes.
- If the audio exceeds the safe transfer size, shorten it and record again.
- The browser must support `MediaRecorder`, and the device must have an available microphone.

Web and Teams follow the same rules. Audio exists only during the current recording and transcription request. The original recording is not stored as a task attachment or written to file storage, the workspace, audit records, or logs.

## If voice input is unavailable

- Permission denied: allow microphone access in the browser or Teams site permissions, then retry.
- No device: check the microphone connection and the system input device.
- Device busy: close applications that have exclusive microphone access.
- No speech recognized: move closer to the microphone, reduce background noise, and record again.
- Transcription timed out or failed: retry later or continue with keyboard input.

:::warning Privacy
The recording is sent to the speech recognition service configured by the deployment operator. Do not speak passwords, keys, or sensitive information that is not required for the task.
:::
