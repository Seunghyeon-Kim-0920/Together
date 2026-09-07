package com.seunghyeonkim.walletdiary;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(CardAutomationPlugin.class);
        registerPlugin(DocumentFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
