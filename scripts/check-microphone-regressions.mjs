import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

const files = {
  speech: 'src/utils/speech.js',
  hub: 'src/components/AccessibilityHub.jsx',
  intercom: 'src/components/IntercomInterface.jsx',
  sidebar: 'src/components/Sidebar.jsx',
  app: 'src/App.jsx',
  native: 'android/app/src/main/java/com/asleyduo/app/EarySpeechPlugin.java',
  voiceSettings: 'android/app/src/main/java/com/asleyduo/app/VoiceSettingsPlugin.java',
};

const read = file => readFileSync(resolve(root, file), 'utf8');
const contents = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, read(file)]));

const checks = [
  {
    file: files.speech,
    ok: contents.speech.includes('addPunctuation: false'),
    message: 'Native Android speech must keep addPunctuation disabled for live dictation.',
  },
  {
    file: files.speech,
    ok: contents.speech.includes('maxResults: 5') && contents.speech.includes('continuous: true'),
    message: 'Native speech must request multiple alternatives for accented or unclear speech.',
  },
  {
    file: files.speech,
    ok: contents.speech.includes('desiredListening') && contents.speech.includes('scheduleRestart'),
    message: 'Speech wrapper must keep invisible recovery state so UI does not look open while native recognizer is dead.',
  },
  {
    file: files.hub,
    ok: contents.hub.includes('stripKnownTranscriptCarryover'),
    message: 'Live transcript carryover dedupe helper is missing.',
  },
  {
    file: files.hub,
    ok: contents.hub.includes('isLikelySpeechRevision') &&
      contents.hub.includes('findFuzzyCarryoverPrefixLength') &&
      contents.hub.includes('getRecentTranscriptWindow') &&
      contents.hub.includes('mergeLongLiveTranscript'),
    message: 'Live transcript merge must tolerate fuzzy revisions from accented or unclear speech.',
  },
  {
    file: files.hub,
    ok: contents.hub.includes('updatePlainTranscriptTape') && contents.hub.includes('flushPlainTranscriptTape'),
    message: 'Plain transcript tape helpers are required for face-to-face speech.',
  },
  {
    file: files.hub,
    ok: contents.hub.includes('updatePlainTranscriptTape(faceCommittedRef, faceLiveRef') &&
      !contents.hub.includes('updatePlainTranscriptTape(ambientCommittedRef, ambientDraftRef'),
    message: 'Ambient listening must stay on the raw live path; face-to-face keeps the transcript tape flow.',
  },
  {
    file: files.hub,
    ok: !contents.hub.includes('VoiceNotebook') &&
      !contents.hub.includes("view==='notebook'") &&
      !contents.hub.includes("setView('notebook')") &&
      !contents.hub.includes('committedNoteRef') &&
      !contents.hub.includes('eary_voice_note'),
    message: 'Notebook must remain removed from the production accessibility flow.',
  },
  {
    file: files.hub,
    ok: contents.hub.includes('pendingCaptionFrameRef') &&
      contents.hub.includes('lastActivitySyncRef') &&
      contents.hub.includes('listening || !translateEnabled') &&
      contents.hub.includes('appendRawAmbientTranscript') &&
      contents.hub.includes('composeRawAmbientTranscript') &&
      contents.hub.includes('updateAmbientLiveTail') &&
      contents.hub.includes('AMBIENT_MUTABLE_TAIL_WORDS') &&
      contents.hub.includes('AMBIENT_PARAGRAPH_WORDS') &&
      contents.hub.includes('buildAmbientParagraphs') &&
      contents.hub.includes('displayedCaptions') &&
      contents.hub.includes('syncAmbientBackgroundWork') &&
      contents.hub.includes('setInterval(() => syncAmbientBackgroundWork(false), 10000'),
    message: 'Ambient live captions must stay raw, use stable text plus mutable live tail, render as lightweight paragraphs, move storage/cleanup to the 10 second background loop, and pause translation while listening.',
  },
  {
    file: files.hub,
    ok: contents.hub.includes('exportWordDocument') &&
      contents.hub.includes('createAmbientWordHtml') &&
      contents.hub.includes('application/msword') &&
      contents.hub.includes('exportSession'),
    message: 'Ambient sessions must support Word-compatible export without adding live microphone work.',
  },
  {
    file: files.hub,
    ok: !/summary|summarize|canSummarize|summaryOpen|buildListeningSummary|ambientSubtitleSummary/i.test(contents.hub),
    message: 'Ambient summary feature must remain removed from the accessibility hub.',
  },
  {
    file: files.hub,
    ok: contents.hub.includes('const MAX_FACE_MESSAGE_CHARS = 700') &&
      contents.hub.includes('maxLength={MAX_FACE_MESSAGE_CHARS}'),
    message: 'Face-to-face manual messages must keep the 700 character safety limit.',
  },
  {
    file: files.intercom,
    ok: contents.intercom.includes('const MAX_CHAT_MESSAGE_CHARS = 700') &&
      contents.intercom.includes('const MAX_VOICE_MESSAGE_CHARS = MAX_CHAT_MESSAGE_CHARS'),
    message: 'Chat and voice message limits must stay aligned at 700 characters.',
  },
  {
    file: files.intercom,
    ok: contents.intercom.includes('limitChatMessageText(msgText)') &&
      contents.intercom.includes('maxLength={MAX_CHAT_MESSAGE_CHARS}'),
    message: 'Chat send path and manual input must enforce the shared character limit.',
  },
  {
    file: files.native,
    ok: contents.native.includes('stopListening("userStop", true)'),
    message: 'Native stop must remain an explicit user stop, not a recoverable speech lifecycle end.',
  },
  {
    file: files.native,
    ok: contents.native.includes('EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS') &&
      contents.native.includes('EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS') &&
      contents.native.includes('EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS') &&
      contents.native.includes('COMPLETE_SILENCE_MS') &&
      contents.native.includes('POSSIBLY_COMPLETE_SILENCE_MS') &&
      contents.native.includes('MINIMUM_SESSION_MS') &&
      !contents.native.includes('EXTRA_SEGMENTED_SESSION') &&
      !contents.native.includes('DICTATION_MODE'),
    message: 'Android recognizer must keep silence hints but avoid segmented/dictation extras that can degrade speaker-audio recognition.',
  },
  {
    file: files.native,
    ok: contents.native.includes('"android.speech.extra.ENABLE_LANGUAGE_DETECTION", false'),
    message: 'Native recognizer must not auto-detect language while the user has selected a speech language.',
  },
  {
    file: files.speech,
    ok: contents.speech.includes('debug: false') &&
      !contents.speech.includes("addListener('speechDebug'"),
    message: 'Production speech wrapper must not attach debug listeners or enable native debug events.',
  },
  {
    file: files.native,
    ok: contents.native.includes('chooseBestMatch') &&
      contents.native.includes('CONFIDENCE_SCORES') &&
      contents.native.includes('continuousMode') &&
      contents.native.includes('FAST_HANDOFF_DELAY_MS') &&
      contents.native.includes('onEndOfSpeech') &&
      contents.native.includes('onSegmentResults') &&
      contents.native.includes('restartDelayFor') &&
      contents.native.includes('rapidRestartCount') &&
      contents.native.includes('ERROR_RECOGNIZER_BUSY') &&
      contents.native.includes('ERROR_CLIENT') &&
      contents.native.includes('postDelayed'),
    message: 'Android recognizer must preserve alternative-result handling and controlled continuous restart for unclear speech.',
  },
  {
    file: files.native,
    ok: contents.native.includes('emitText(lastText.trim(), true, currentSessionId)'),
    message: 'Native recognizer must flush last text on stop/error before ending.',
  },
  {
    file: files.voiceSettings,
    ok: contents.voiceSettings.includes('openNotificationSettings') &&
      !contents.voiceSettings.includes('prepareSpeechModel') &&
      !contents.voiceSettings.includes('checkSpeechModel') &&
      !contents.voiceSettings.includes('checkRecognitionSupport') &&
      !contents.voiceSettings.includes('triggerModelDownload') &&
      !contents.voiceSettings.includes('ModelDownloadListener') &&
      !contents.voiceSettings.includes('speechModelProgress') &&
      !contents.voiceSettings.includes('ACTION_VOICE_INPUT_SETTINGS'),
    message: 'Voice settings plugin must not include Google/Android speech-pack download or model-preparation code.',
  },
  {
    file: files.sidebar,
    ok: contents.sidebar.includes('pendingSpeechLang') &&
      contents.sidebar.includes('saveLanguageSettings') &&
      contents.sidebar.includes('Dili kaydet') &&
      !contents.sidebar.includes('VoiceSettings.prepareSpeechModel') &&
      !contents.sidebar.includes('prepareAndReportSpeechPack') &&
      !contents.sidebar.includes('speechPackMessage') &&
      !contents.sidebar.includes('speechPackProgress') &&
      !contents.sidebar.includes('openSpeechSettings'),
    message: 'Settings language selection must save only the app/speech language and must not prepare speech packs.',
  },
  {
    file: files.hub,
    ok: contents.hub.includes('draftLanguage') &&
      contents.hub.includes('saveAmbientLanguage') &&
      !contents.hub.includes('VoiceSettings.prepareSpeechModel') &&
      !contents.hub.includes('prepareAndReportSpeechPack') &&
      !contents.hub.includes('prepareSpeechPackInBackground') &&
      !contents.hub.includes('ensureAmbientSpeechPackReady') &&
      !contents.hub.includes('speechPackMessage') &&
      !contents.hub.includes('speechPackProgress') &&
      !contents.hub.includes('eary_speech_pack'),
    message: 'Ambient speech language selection must not block or prepare speech packs.',
  },
  {
    file: files.app,
    ok: !contents.app.includes('prepareSpeechModelForLanguage') &&
      !contents.app.includes('VoiceSettings.prepareSpeechModel') &&
      !contents.app.includes('speechPackProgress') &&
      !contents.app.includes('speechModelProgress') &&
      !contents.app.includes('preparingLanguage') &&
      !contents.app.includes('eary_speech_pack') &&
      contents.app.includes('setLanguageConfirmed(true);') &&
      !contents.app.includes('paketi arka planda hazirlaniyor') &&
      !contents.app.includes('await VoiceSettings.openSpeechSettings()'),
    message: 'First launch language gate must save language only and must not start speech-pack preparation.',
  },];

const failures = checks.filter(check => !check.ok);

if (failures.length) {
  console.error('Microphone regression guard failed:');
  for (const failure of failures) {
    console.error(`- ${failure.file}: ${failure.message}`);
  }
  process.exit(1);
}

console.log(`Microphone regression guard passed (${checks.length} checks).`);
