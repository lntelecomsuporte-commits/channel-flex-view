package tv.lntelecom.net;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PlaybackKeepAlivePlugin.class);
        super.onCreate(savedInstanceState);
        // Mantém a tela acesa enquanto a Activity estiver visível.
        // O foreground service cuida do CPU/processo em background.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
