package com.asleyduo.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(EarySpeechPlugin.class);
        registerPlugin(VoiceSettingsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
