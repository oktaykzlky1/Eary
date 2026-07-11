# Eary Premium Home Handoff

Date: 2026-07-06

## What changed

- `src/components/ChatHome.jsx`
  - Added the premium home shell with one main action and compact mode selector.
  - Modes: Face to face, Ambient, Chat, Notebook.
  - Chat mode opens the existing chat list.
  - Ambient, Face to face, and Notebook open the existing AccessibilityHub tools directly.
  - Bottom navigation now uses `Ana` instead of the older `Erisim` label.

- `src/components/AccessibilityHub.jsx`
  - Added `initialView` and `onBackHome` props.
  - This lets the new home screen open a specific tool directly.
  - Back from a launched tool returns to the premium home screen instead of the old hub.
  - Fixed a stale cleanup reference in FaceToFaceTool.

- `src/components/RoomSetup.jsx`
  - Last message cache is loaded from localStorage for faster chat list paint.
  - Chat list listens to `rooms/{roomId}/lastMessage`.
  - REST fallback now runs only for missing previews and at a slower interval.

- `src/components/IntercomInterface.jsx`
  - New sent/voice/media/forwarded messages update `rooms/{roomId}/lastMessage`.
  - Chat opening keeps the viewport hidden until messages are ready, preventing empty-state flicker.

## Backup / rollback

Pre-design backup was saved here:

`backups/20260706-102432-before-premium-home`

It contains:

- `source-changes.patch`
- `git-status.txt`
- Copies of `RoomSetup.jsx`, `ChatHome.jsx`, `AccessibilityHub.jsx`, and `IntercomInterface.jsx`

Rollback options:

1. Restore the copied files from the backup folder.
2. Or use the patch/status files to reconstruct the previous state manually.

## iOS / Mac notes

- This is React/Capacitor web code, so Mac/iOS can pick it up from the same source files.
- After pulling these changes on Mac, run the normal web build and Capacitor sync flow for iOS.
- The new home screen does not add native permissions by itself.
- Existing microphone behavior remains inside Ambient, FaceToFace, Notebook, and Chat tools.
- Check iOS safe-area spacing on:
  - Premium home header
  - Bottom nav
  - Ambient listening screen
  - Face-to-face split screen
  - Notebook floating mic button

## Verification done

- `npm.cmd run build` passed.
- Local dev server returned HTTP 200.
- Browser smoke test:
  - Premium home rendered.
  - Face-to-face mode opened.
  - Ambient mode opened.
  - Notebook mode opened.
