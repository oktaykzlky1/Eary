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

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private boolean listening = false;
    private long sessionId = 0;
    private long nextSessionId = 1;
    private String lastText = "";

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

        mainHandler.post(() -> startListening(call, language, maxResults, partialResults));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        mainHandler.post(() -> {
            stopListening("userStop", true);
            call.resolve();
        });
    }

    @PluginMethod
    public void abort(PluginCall call) {
        mainHandler.post(() -> {
            stopListening("abort", false);
            call.resolve();
        });
    }

    private void startListening(PluginCall call, String language, int maxResults, boolean partialResults) {
        stopListening("restart", false);

        recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
        sessionId = nextSessionId++;
        lastText = "";
        listening = true;
        long currentSessionId = sessionId;

        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override
            public void onReadyForSpeech(Bundle params) {
                emitState("started", currentSessionId, null);
            }

            @Override
            public void onBeginningOfSpeech() {}

            @Override
            public void onRmsChanged(float rmsdB) {}

            @Override
            public void onBufferReceived(byte[] buffer) {}

            @Override
            public void onEndOfSpeech() {}

            @Override
            public void onError(int error) {
                if (currentSessionId != sessionId) return;
                JSObject payload = new JSObject();
                payload.put("code", error);
                payload.put("message", errorMessage(error));
                payload.put("sessionId", currentSessionId);
                notifyListeners("error", payload);
                stopListening("error", false);
            }

            @Override
            public void onResults(Bundle results) {
                if (currentSessionId != sessionId) return;
                emitBundleText(results, true, currentSessionId);
                stopListening("results", false);
            }

            @Override
            public void onPartialResults(Bundle partialResultsBundle) {
                if (currentSessionId != sessionId) return;
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
        intent.putExtra("android.speech.extra.DICTATION_MODE", true);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());

        try {
            recognizer.startListening(intent);
            call.resolve(new JSObject().put("sessionId", currentSessionId).put("state", "started"));
        } catch (Exception exception) {
            stopListening("startError", false);
            call.reject(exception.getMessage());
        }
    }

    private void stopListening(String reason, boolean emitFinal) {
        long currentSessionId = sessionId;
        if (emitFinal && !lastText.trim().isEmpty()) {
            emitText(lastText.trim(), true, currentSessionId);
        }

        if (recognizer != null) {
            try {
                recognizer.stopListening();
            } catch (Exception ignored) {}
            try {
                recognizer.cancel();
            } catch (Exception ignored) {}
            try {
                recognizer.destroy();
            } catch (Exception ignored) {}
            recognizer = null;
        }

        if (listening || currentSessionId != 0) {
            emitState("stopped", currentSessionId, reason);
        }

        listening = false;
        sessionId = 0;
        lastText = "";
    }

    private void emitBundleText(Bundle bundle, boolean isFinal, long currentSessionId) {
        ArrayList<String> matches = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (matches == null || matches.isEmpty()) return;
        String text = matches.get(0) == null ? "" : matches.get(0).trim();
        if (text.isEmpty()) return;
        lastText = text;
        emitText(text, isFinal, currentSessionId);
    }

    private void emitText(String text, boolean isFinal, long currentSessionId) {
        JSArray matches = new JSArray();
        matches.put(text);
        JSObject payload = new JSObject();
        payload.put("matches", matches);
        payload.put("isFinal", isFinal);
        payload.put("sessionId", currentSessionId);
        notifyListeners("partialResults", payload);
    }

    private void emitState(String state, long currentSessionId, String reason) {
        JSObject payload = new JSObject();
        payload.put("state", state);
        payload.put("sessionId", currentSessionId);
        if (reason != null) payload.put("reason", reason);
        notifyListeners("listeningState", payload);
    }

    private JSObject permissionPayload() {
        return new JSObject()
            .put("microphone", getPermissionState(MICROPHONE).toString())
            .put("speechRecognition", "granted");
    }

    private String normalizeLanguage(String language) {
        return language == null ? Locale.getDefault().toLanguageTag() : language.replace('_', '-');
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
        stopListening("destroy", false);
        super.handleOnDestroy();
    }
}
