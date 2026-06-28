# Eary

Eary is a mobile messaging app focused on accessible communication, speech-to-text support, translation, and face-to-face conversation tools.

## Setup

Install dependencies:

```bash
npm install
```

Build the web app:

```bash
npm run build
```

Sync mobile projects:

```bash
npx cap sync android
npx cap sync ios
```

## Android APK

After setup and sync, open this folder in Android Studio:

```text
android
```

Then run:

```text
Build > Clean Project
Build > Rebuild Project
Build > Build Bundle(s) / APK(s) > Build APK(s)
```

The debug APK is generated under:

```text
android/app/build/outputs/apk/debug/
```

## Web Deploy

Build first:

```bash
npm run build
```

Deploy Firebase Hosting:

```bash
npm exec --yes firebase-tools -- deploy --only hosting
```

## Notes

- `node_modules`, `dist`, Android build outputs, iOS build outputs, and local caches are intentionally not committed.
- After cloning on another computer, always run `npm install`, then `npm run build`, then `npx cap sync android` before opening/building Android.
- Android includes 16 KB device compatibility package settings in `android/app/build.gradle` and `AndroidManifest.xml`.
