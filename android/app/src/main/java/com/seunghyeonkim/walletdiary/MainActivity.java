package com.seunghyeonkim.walletdiary;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(CardAutomationPlugin.class);
        registerPlugin(DocumentFilesPlugin.class);
        registerPlugin(InviteLinkPlugin.class);
        // A restored activity replays its launch intent; an invitation link in
        // it was already handled before the activity was recreated.
        InviteLinkPlugin.markRestoredLaunch(savedInstanceState != null);
        super.onCreate(savedInstanceState);
    }
}
