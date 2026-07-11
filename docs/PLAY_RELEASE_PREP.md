# Eary Play Release Prep

Date: 2026-07-11

## Current Release Artifacts

- Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`
- Release AAB: `android/app/build/outputs/bundle/release/app-release.aab`
- Package name: `com.asleyduo.app`
- Version: `1.0.1`
- Version code: `2`
- Target SDK: `36`

## Completed

- Full ESLint check passes for active app code.
- Microphone regression guard passes.
- Production web build succeeds.
- Capacitor Android sync succeeds.
- Release AAB generation succeeds.
- Release AAB is signed with local upload key.
- Upload key and signing properties are ignored by git:
  - `android/eary-upload-key.jks`
  - `android/keystore.properties`
- Old e-mail/password wording was replaced with invite-profile wording in supported languages.
- Firebase permission toast is no longer shown to users on app start.

## Must Keep Safe

Back up these two local files before uploading to Play Console:

- `android/eary-upload-key.jks`
- `android/keystore.properties`

If the upload key is lost, future Play releases become painful and require key reset through Google Play Console.

## Play Console Next Steps

1. Create app in Google Play Console.
2. Choose app name: `Eary`.
3. Upload `android/app/build/outputs/bundle/release/app-release.aab`.
4. Enable Play App Signing if prompted.
5. Complete Data safety form.
6. Add Privacy Policy URL.
7. Add store listing:
   - Short description.
   - Full description.
   - Screenshots.
   - Feature graphic.
   - App icon.
8. Fill Content rating questionnaire.
9. Fill Target audience and content.
10. Start with closed testing or open testing before production rollout.

## Data Safety Notes

Likely declarations:

- Microphone access is used for speech-to-text and live captions.
- Internet access is used for chat, sync, translation, and Firebase-backed communication.
- User-generated text/chat content can be processed and transmitted for app functionality.
- Invite profile data may be stored for chat discovery/invitation.
- No e-mail/password account flow is part of the current public UX.

Final wording should match the actual Firebase database rules and privacy policy before production.

## Remaining Manual Items

- Privacy policy URL.
- Store screenshots from a real device.
- Real-device smoke test:
  - Fresh install.
  - First language selection.
  - Ambient listening in Turkish, German, and English.
  - Face-to-face conversation.
  - Invite link copy/share.
  - Direct chat via invite.
  - Group creation/invite flow.
  - Export/save from ambient listening.
- Decide release track:
  - Recommended first step: closed test.
  - Then open test.
  - Then production rollout.
