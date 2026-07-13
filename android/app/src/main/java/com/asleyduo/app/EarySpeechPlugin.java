package com.asleyduo.app;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.Locale;

@CapacitorPlugin(
    name = "EarySpeech",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = EarySpeechPlugin.MICROPHONE)
    }
)
public class EarySpeechPlugin extends Plugin {
    static final String MICROPHONE = "microphone";
    private static final int COMPLETE_SILENCE_MS = 30000;
    private static final int POSSIBLY_COMPLETE_SILENCE_MS = 15000;
    private static final int MINIMUM_SESSION_MS = 600000;
    private static final long FAST_HANDOFF_DELAY_MS = 40;
    private static final long END_OF_SPEECH_WATCHDOG_MS = 12000;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private boolean listening = false;
    private boolean desiredListening = false;
    private boolean continuousMode = false;
    private long sessionId = 0;
    private long nextSessionId = 1;
    private int rapidRestartCount = 0;
    private long lastRestartAt = 0;
    private long lastSpeechEventAt = 0;
    private Runnable endOfSpeechWatchdog = null;
    private String lastText = "";
    private String currentLanguage = "";
    private int currentMaxResults = 5;
    private boolean currentPartialResults = true;
    private boolean debugEnabled = false;
    private long debugStartedAt = 0;
    private long lastRmsDebugAt = 0;

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        call.resolve(permissionPayload());
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (getPermissionState(MICROPHONE) == PermissionState.GRANTED) {
            call.resolve(permissionPayload());
            return;
        }
        requestPermissionForAlias(MICROPHONE, call, "microphonePermissionCallback");
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        call.resolve(permissionPayload());
    }

    @PluginMethod
    public void isListening(PluginCall call) {
        call.resolve(new JSObject().put("listening", listening));
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState(MICROPHONE) != PermissionState.GRANTED) {
            call.reject("Mikrofon izni verilmedi.");
            return;
        }

        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("Konuşma tanıma bu cihazda kullanılamıyor.");
            return;
        }

        String language = normalizeLanguage(call.getString("language", Locale.getDefault().toLanguageTag()));
        int maxResults = call.getInt("maxResults", 1);
        boolean partialResults = call.getBoolean("partialResults", true);
        boolean continuous = call.getBoolean("continuous", false);
        debugEnabled = call.getBoolean("debug", false);
        debugStartedAt = System.currentTimeMillis();
        lastRmsDebugAt = 0;
        emitDebug("startCall", 0, new JSObject()
            .put("language", language)
            .put("maxResults", maxResults)
            .put("partialResults", partialResults)
            .put("continuous", continuous));

        mainHandler.post(() -> startListening(call, language, maxResults, partialResults, continuous));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        mainHandler.post(() -> {
            desiredListening = false;
            stopListening("userStop", true);
            call.resolve();
        });
    }

    @PluginMethod
    public void abort(PluginCall call) {
        mainHandler.post(() -> {
            desiredListening = false;
            stopListening("abort", false);
            call.resolve();
        });
    }

    private void startListening(PluginCall call, String language, int maxResults, boolean partialResults, boolean continuous) {
        emitDebug("startListening", sessionId, new JSObject().put("language", language).put("continuous", continuous));
        stopListening("restart", false);
        desiredListening = true;
        continuousMode = continuous;
        currentLanguage = language;
        currentMaxResults = Math.max(1, maxResults);
        currentPartialResults = partialResults;

        beginRecognizerSession(call, language, Math.max(1, maxResults), partialResults, true);
    }

    private void beginRecognizerSession(PluginCall call, String language, int maxResults, boolean partialResults, boolean resolveCall) {
        SpeechRecognizer nextRecognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
        recognizer = nextRecognizer;
        sessionId = nextSessionId++;
        lastText = "";
        listening = true;
        lastSpeechEventAt = System.currentTimeMillis();
        long currentSessionId = sessionId;
        emitDebug("beginSession", currentSessionId, new JSObject()
            .put("language", language)
            .put("maxResults", maxResults)
            .put("partialResults", partialResults)
            .put("resolveCall", resolveCall));

        nextRecognizer.setRecognitionListener(new RecognitionListener() {
            @Override
            public void onReadyForSpeech(Bundle params) {
                markSpeechEvent();
                emitDebug("readyForSpeech", currentSessionId, null);
                emitState("started", currentSessionId, null);
            }

            @Override
            public void onBeginningOfSpeech() {
                markSpeechEvent();
                cancelEndOfSpeechWatchdog();
                emitDebug("beginningOfSpeech", currentSessionId, null);
            }

            @Override
            public void onRmsChanged(float rmsdB) {
                long now = System.currentTimeMillis();
                if (debugEnabled && now - lastRmsDebugAt >= 600) {
                    lastRmsDebugAt = now;
                    emitDebug("rms", currentSessionId, new JSObject().put("rms", rmsdB));
                }
            }

            @Override
            public void onBufferReceived(byte[] buffer) {}

            @Override
            public void onEndOfSpeech() {
                if (!shouldContinueListening()) return;
                emitDebug("endOfSpeech", currentSessionId, null);
                scheduleEndOfSpeechWatchdog(currentSessionId);
            }

            @Override
            public void onError(int error) {
                if (currentSessionId != sessionId) return;
                emitDebug("error", currentSessionId, new JSObject().put("code", error).put("message", errorMessage(error)));
                if (!lastText.trim().isEmpty()) {
                    emitText(lastText.trim(), true, currentSessionId);
                }
                if (shouldKeepListeningAfter(error)) {
                    finishRecognizerCallback("recoverableError", currentSessionId, restartDelayFor(error));
                    return;
                }
                JSObject payload = new JSObject();
                payload.put("code", error);
                payload.put("message", errorMessage(error));
                payload.put("sessionId", currentSessionId);
                notifyListeners("error", payload);
                finishRecognizerCallback("error", currentSessionId);
            }

            @Override
            public void onResults(Bundle results) {
                if (currentSessionId != sessionId) return;
                cancelEndOfSpeechWatchdog();
                emitDebug("results", currentSessionId, null);
                emitBundleText(results, true, currentSessionId);
                finishRecognizerCallback("results", currentSessionId, shouldContinueListening() ? restartDelayFor(0) : -1);
            }

            @Override
            public void onSegmentResults(Bundle segmentResults) {
                if (currentSessionId != sessionId) return;
                cancelEndOfSpeechWatchdog();
                emitDebug("segmentResults", currentSessionId, null);
                emitBundleText(segmentResults, true, currentSessionId);
            }

            @Override
            public void onEndOfSegmentedSession() {
                if (currentSessionId != sessionId) return;
                emitDebug("endOfSegmentedSession", currentSessionId, null);
                finishRecognizerCallback("segmentedSessionEnd", currentSessionId, shouldContinueListening() ? FAST_HANDOFF_DELAY_MS : -1);
            }

            @Override
            public void onPartialResults(Bundle partialResultsBundle) {
                if (currentSessionId != sessionId) return;
                cancelEndOfSpeechWatchdog();
                emitDebug("partialResults", currentSessionId, null);
                emitBundleText(partialResultsBundle, false, currentSessionId);
            }

            @Override
            public void onEvent(int eventType, Bundle params) {}
        });

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language);
        intent.putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, false);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partialResults);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, Math.max(1, maxResults));
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, COMPLETE_SILENCE_MS);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, POSSIBLY_COMPLETE_SILENCE_MS);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, MINIMUM_SESSION_MS);
        intent.putExtra("android.speech.extra.ENABLE_LANGUAGE_DETECTION", false);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());

        try {
            emitDebug("nativeStartListening", currentSessionId, null);
            nextRecognizer.startListening(intent);
            if (resolveCall && call != null) call.resolve(new JSObject().put("sessionId", currentSessionId).put("state", "started"));
        } catch (Exception exception) {
            emitDebug("nativeStartError", currentSessionId, new JSObject().put("message", exception.getMessage()));
            if (shouldContinueListening()) {
                finishRecognizerCallback("startErrorRecoverable", currentSessionId, restartDelayFor(SpeechRecognizer.ERROR_CLIENT));
            } else {
                stopListening("startError", false);
            }
            if (resolveCall && call != null) call.reject(exception.getMessage());
        }
    }

    private boolean shouldContinueListening() {
        return desiredListening && continuousMode;
    }

    private boolean shouldKeepListeningAfter(int error) {
        if (!shouldContinueListening()) return false;
        return error == SpeechRecognizer.ERROR_NO_MATCH ||
            error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ||
            error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT ||
            error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ||
            error == SpeechRecognizer.ERROR_CLIENT;
    }

    private long restartDelayFor(int error) {
        long now = System.currentTimeMillis();
        boolean needsBackoff = error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || error == SpeechRecognizer.ERROR_CLIENT;
        rapidRestartCount = needsBackoff && now - lastRestartAt < 2500 ? rapidRestartCount + 1 : 0;
        lastRestartAt = now;

        long delay;
        if (needsBackoff) {
            delay = 180;
        } else if (error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT) {
            delay = 300;
        } else {
            delay = FAST_HANDOFF_DELAY_MS;
        }

        if (needsBackoff && rapidRestartCount >= 2) delay += Math.min(260, rapidRestartCount * 70L);
        return delay;
    }

    private void markSpeechEvent() {
        lastSpeechEventAt = System.currentTimeMillis();
    }

    private void scheduleEndOfSpeechWatchdog(long currentSessionId) {
        cancelEndOfSpeechWatchdog();
        long watchedAt = lastSpeechEventAt;
        emitDebug("watchdogScheduled", currentSessionId, new JSObject().put("delayMs", END_OF_SPEECH_WATCHDOG_MS));
        endOfSpeechWatchdog = () -> {
            endOfSpeechWatchdog = null;
            if (currentSessionId != sessionId || recognizer == null || !shouldContinueListening()) return;
            if (lastSpeechEventAt != watchedAt) return;
            emitDebug("watchdogFired", currentSessionId, null);
            if (!lastText.trim().isEmpty()) {
                emitText(lastText.trim(), true, currentSessionId);
            }
            finishRecognizerCallback("endOfSpeechWatchdog", currentSessionId, FAST_HANDOFF_DELAY_MS);
        };
        mainHandler.postDelayed(endOfSpeechWatchdog, END_OF_SPEECH_WATCHDOG_MS);
    }

    private void cancelEndOfSpeechWatchdog() {
        if (endOfSpeechWatchdog == null) return;
        mainHandler.removeCallbacks(endOfSpeechWatchdog);
        endOfSpeechWatchdog = null;
    }

    private void stopListening(String reason, boolean emitFinal) {
        long currentSessionId = sessionId;
        boolean wasListening = listening;
        emitDebug("stopListening", currentSessionId, new JSObject().put("reason", reason).put("emitFinal", emitFinal));
        if (emitFinal && !lastText.trim().isEmpty()) {
            emitText(lastText.trim(), true, currentSessionId);
        }

        SpeechRecognizer currentRecognizer = recognizer;
        recognizer = null;
        listening = false;
        sessionId = 0;
        lastText = "";
        cancelEndOfSpeechWatchdog();

        if (wasListening || currentSessionId != 0) {
            emitState("stopped", currentSessionId, reason);
        }

        if (currentRecognizer != null) {
            try {
                currentRecognizer.stopListening();
            } catch (Exception ignored) {}
            destroyRecognizer(currentRecognizer);
        }
    }

    private void finishRecognizerCallback(String reason, long currentSessionId) {
        finishRecognizerCallback(reason, currentSessionId, -1);
    }

    private void finishRecognizerCallback(String reason, long currentSessionId, long restartDelayMs) {
        SpeechRecognizer currentRecognizer = recognizer;
        recognizer = null;
        listening = false;
        sessionId = 0;
        lastText = "";
        cancelEndOfSpeechWatchdog();
        boolean shouldRestart = restartDelayMs >= 0;
        emitDebug("finish", currentSessionId, new JSObject()
            .put("reason", reason)
            .put("restart", shouldRestart)
            .put("restartDelayMs", restartDelayMs));
        if (!shouldRestart) emitState("stopped", currentSessionId, reason);
        destroyRecognizer(currentRecognizer);
        if (shouldRestart) {
            mainHandler.postDelayed(() -> {
                if (!shouldContinueListening() || recognizer != null) return;
                beginRecognizerSession(null, currentLanguage, currentMaxResults, currentPartialResults, false);
            }, restartDelayMs);
        }
    }

    private void destroyRecognizer(SpeechRecognizer currentRecognizer) {
        if (currentRecognizer == null) return;
        try {
            currentRecognizer.cancel();
        } catch (Exception ignored) {}
        try {
            currentRecognizer.destroy();
        } catch (Exception ignored) {}
    }

    private void emitBundleText(Bundle bundle, boolean isFinal, long currentSessionId) {
        ArrayList<String> matches = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (matches == null || matches.isEmpty()) {
            emitDebug("emptyTextBundle", currentSessionId, new JSObject().put("isFinal", isFinal));
            return;
        }
        String text = chooseBestMatch(matches);
        if (text.isEmpty()) {
            emitDebug("emptyText", currentSessionId, new JSObject().put("isFinal", isFinal).put("matchCount", matches.size()));
            return;
        }
        markSpeechEvent();
        lastText = text;
        float confidence = readBestConfidence(bundle, matches, text);
        emitDebug(isFinal ? "emitFinalText" : "emitPartialText", currentSessionId, new JSObject()
            .put("length", text.length())
            .put("words", wordCount(text))
            .put("confidence", confidence)
            .put("matchCount", matches.size()));
        emitText(text, isFinal, currentSessionId, confidence);
    }

    private String chooseBestMatch(ArrayList<String> matches) {
        String first = matches.get(0) == null ? "" : matches.get(0).trim();
        String best = first;
        int bestWords = wordCount(best);
        for (String candidateValue : matches) {
            String candidate = candidateValue == null ? "" : candidateValue.trim();
            int candidateWords = wordCount(candidate);
            boolean meaningfullyLonger = candidateWords >= bestWords + 2 || candidate.length() >= best.length() + 12;
            if (candidateWords > 0 && (best.isEmpty() || meaningfullyLonger)) {
                best = candidate;
                bestWords = candidateWords;
            }
        }
        return best;
    }

    private int wordCount(String value) {
        String text = value == null ? "" : value.trim();
        if (text.isEmpty()) return 0;
        return text.split("\\s+").length;
    }

    private float readBestConfidence(Bundle bundle, ArrayList<String> matches, String text) {
        float[] scores = bundle.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);
        if (scores == null || scores.length == 0) return -1;
        for (int index = 0; index < matches.size() && index < scores.length; index += 1) {
            String candidate = matches.get(index) == null ? "" : matches.get(index).trim();
            if (candidate.equals(text)) return scores[index];
        }
        return scores[0];
    }

    private void emitText(String text, boolean isFinal, long currentSessionId) {
        emitText(text, isFinal, currentSessionId, -1);
    }

    private void emitText(String text, boolean isFinal, long currentSessionId, float confidence) {
        JSArray matches = new JSArray();
        matches.put(text);
        JSObject payload = new JSObject();
        payload.put("matches", matches);
        payload.put("isFinal", isFinal);
        payload.put("sessionId", currentSessionId);
        if (confidence >= 0) payload.put("confidence", confidence);
        notifyListeners("partialResults", payload);
    }

    private void emitState(String state, long currentSessionId, String reason) {
        JSObject payload = new JSObject();
        payload.put("state", state);
        payload.put("sessionId", currentSessionId);
        if (reason != null) payload.put("reason", reason);
        notifyListeners("listeningState", payload);
    }

    private void emitDebug(String event, long currentSessionId, JSObject extra) {
        if (!debugEnabled) return;
        long now = System.currentTimeMillis();
        JSObject payload = new JSObject();
        payload.put("event", event);
        payload.put("sessionId", currentSessionId);
        payload.put("at", now);
        payload.put("sinceStartMs", debugStartedAt > 0 ? now - debugStartedAt : 0);
        payload.put("listening", listening);
        payload.put("desiredListening", desiredListening);
        payload.put("continuousMode", continuousMode);
        if (extra != null) payload.put("detail", extra);
        notifyListeners("speechDebug", payload);
    }

    private JSObject permissionPayload() {
        return new JSObject()
            .put("microphone", getPermissionState(MICROPHONE).toString())
            .put("speechRecognition", "granted");
    }

    private String normalizeLanguage(String language) {
        String raw = language == null ? Locale.getDefault().toLanguageTag() : language.replace('_', '-').trim();
        if (raw.isEmpty()) return Locale.getDefault().toLanguageTag();
        String prefix = raw.length() >= 2 ? raw.substring(0, 2).toLowerCase(Locale.ROOT) : raw.toLowerCase(Locale.ROOT);
        switch (prefix) {
            case "tr":
                return "tr-TR";
            case "en":
                return "en-US";
            case "de":
                return "de-DE";
            case "fr":
                return "fr-FR";
            case "es":
                return "es-ES";
            case "it":
                return "it-IT";
            default:
                return raw;
        }
    }

    private String errorMessage(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO:
                return "Ses kaydı başlatılamadı.";
            case SpeechRecognizer.ERROR_CLIENT:
                return "Konuşma tanıma istemcisi hata verdi.";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "Mikrofon izni eksik.";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "Konuşma tanıma ağına ulaşılamadı.";
            case SpeechRecognizer.ERROR_NO_MATCH:
                return "Konuşma algılanamadı.";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "Konuşma tanıma zaten çalışıyor.";
            case SpeechRecognizer.ERROR_SERVER:
                return "Konuşma tanıma servisi hata verdi.";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "Konuşma zaman aşımına uğradı.";
            default:
                return "Konuşma tanıma hata verdi.";
        }
    }

    @Override
    protected void handleOnDestroy() {
        desiredListening = false;
        stopListening("destroy", false);
        super.handleOnDestroy();
    }
}
