# Teleprompter — personal front-camera video recorder

A private Android app for recording marketing videos with a voice-driven
teleprompter overlaid on the live front-camera preview. Read your script while
you look at the lens and check your framing; the text scrolls itself as you
speak. The **saved video is clean** — the teleprompter text is on-screen only,
never burned into the recording — and un-mirrored.

Built with Expo + React Native. Camera is [VisionCamera], speech tracking is
[expo-speech-recognition].

## Features

- Full-resolution front-camera recording (targets **4K**, falls back to 1080p).
- **Voice-driven scroll** — the words you speak advance a highlighted reading band.
- Reading band with the current line(s) held in place; position is adjustable and
  defaults **high, near the camera** for a better eyeline.
- **Optional** karaoke word-highlight and dim-other-lines (both **off** by default).
- Mirror-preview toggle (on-screen only; the file is always un-mirrored).
- Portrait + landscape, countdown, keep-awake, saved scripts, gallery save + share.
- Manual safety net: **Pause/Resume**, **Restart to top**, and **drag the text**
  to re-sync if voice tracking loses your place.
- **Practice** mode: follow your voice without recording, to rehearse.

## One-time setup (build the installable APK)

Everything below runs from the `teleprompter-app/` folder.

1. Make a free Expo account at <https://expo.dev/signup>.
2. Install the CLI and log in:
   ```bash
   npm install -g eas-cli
   eas login
   ```
3. Link the project (creates an EAS project id, writes it into `app.json`):
   ```bash
   eas init
   ```
4. Build the sideloadable APK in Expo's cloud (~10–15 min):
   ```bash
   eas build --platform android --profile preview
   ```
   When it finishes, EAS prints a URL (and a QR code). Open it on the Galaxy S23,
   download the `.apk`, and install it. The first time, Android will ask you to
   allow "install unknown apps" for your browser — allow it, then tap the file.

On first launch, grant **camera**, **microphone**, and (when you first save)
**gallery** permissions.

## Fast iteration after the first build

Once the APK is installed, most changes (layout, scroll feel, matching tuning —
anything that isn't a new native module) ship **over-the-air, no reinstall**:

```bash
eas update --branch preview
```

Reopen the app to pull the update. You only need a new `eas build` if native
modules change.

## The one thing to verify on the phone

The app records audio **and** listens to your speech at the same time. On this
phone that already works in PromptSmart, so it's expected to work here too — but
it's the make-or-break test on the first real build. If the scroll doesn't
follow your voice while recording:

- Confirm the mic + speech permissions are granted.
- Try **Practice** mode (no recording) first — if that follows your voice but
  recording doesn't, it's the simultaneous-mic contention we flagged, and the
  fallback (voice-activity pacing that reads the recorded audio instead of the
  recognizer) is the next step to enable.

## On-device test checklist

1. Front-camera preview fills the screen; your framing is visible behind the text.
2. Paste a script, hit record, read aloud → the band follows your voice.
3. Stop → the saved clip is clean (no text), un-mirrored, high-res, in the gallery.
4. Portrait and landscape both work.
5. Pause/Resume, Restart-to-top, and drag-to-re-sync behave.
6. Word-highlight and dim-other-lines toggles do what you expect.

## Project layout

```
App.js                     screen navigation + state
src/storage.js             scripts + settings (AsyncStorage, on-device only)
src/voice.js               pure voice-matching core (tokenize + advance pointer)
src/components/Teleprompter.js   scrolling overlay, reading band, drag-to-resync
src/screens/ScriptsScreen.js     script library + editor
src/screens/SettingsScreen.js    all settings
src/screens/RecorderScreen.js    camera + teleprompter + recording + voice
src/screens/ReviewScreen.js      playback + save to gallery + share
```

[VisionCamera]: https://react-native-vision-camera.com
[expo-speech-recognition]: https://github.com/jamsch/expo-speech-recognition
