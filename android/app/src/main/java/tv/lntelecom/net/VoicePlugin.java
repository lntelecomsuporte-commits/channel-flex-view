package tv.lntelecom.net;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Locale;

/**
 * Reconhecimento de voz pt-BR via Android SpeechRecognizer.
 * Emite eventos "start", "partial", "result", "error", "end" pro JS.
 */
@CapacitorPlugin(name = "VoicePlugin")
public class VoicePlugin extends Plugin {

    private static final int REQ_AUDIO = 7331;
    private SpeechRecognizer recognizer;
    private boolean listening = false;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        boolean ok = SpeechRecognizer.isRecognitionAvailable(getContext());
        JSObject ret = new JSObject();
        ret.put("available", ok);
        call.resolve(ret);
    }

    @PluginMethod
    public void start(PluginCall call) {
        Activity act = getActivity();
        if (act == null) { call.reject("no_activity"); return; }
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(act, new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AUDIO);
            emitError("Permita o microfone e tente de novo");
            call.resolve();
            return;
        }
        new Handler(Looper.getMainLooper()).post(() -> startInternal());
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        new Handler(Looper.getMainLooper()).post(() -> destroyRecognizer());
        call.resolve();
    }

    private void startInternal() {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            emitError("Reconhecimento de voz indisponível");
            return;
        }
        destroyRecognizer();
        try {
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) {
                    listening = true;
                    notifyListeners("start", new JSObject());
                }
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onError(int error) {
                    String msg;
                    switch (error) {
                        case SpeechRecognizer.ERROR_NO_MATCH:
                        case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: msg = "Não entendi"; break;
                        case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: msg = "Sem permissão de microfone"; break;
                        case SpeechRecognizer.ERROR_NETWORK:
                        case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: msg = "Sem internet"; break;
                        default: msg = "Erro de voz (" + error + ")";
                    }
                    emitError(msg);
                    listening = false;
                }
                @Override public void onResults(Bundle results) {
                    ArrayList<String> arr = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    String text = (arr != null && !arr.isEmpty()) ? arr.get(0) : "";
                    JSObject d = new JSObject();
                    d.put("text", text);
                    notifyListeners("result", d);
                    notifyListeners("end", new JSObject());
                    listening = false;
                }
                @Override public void onPartialResults(Bundle partial) {
                    ArrayList<String> arr = partial.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (arr != null && !arr.isEmpty()) {
                        JSObject d = new JSObject();
                        d.put("text", arr.get(0));
                        notifyListeners("partial", d);
                    }
                }
                @Override public void onEvent(int eventType, Bundle params) {}
            });

            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR");
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "pt-BR");
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
            recognizer.startListening(intent);
        } catch (Exception e) {
            emitError("Falha ao iniciar voz: " + e.getMessage());
        }
    }

    private void destroyRecognizer() {
        if (recognizer != null) {
            try { recognizer.stopListening(); } catch (Exception ignored) {}
            try { recognizer.cancel(); } catch (Exception ignored) {}
            try { recognizer.destroy(); } catch (Exception ignored) {}
            recognizer = null;
        }
        listening = false;
    }

    private void emitError(String message) {
        JSObject d = new JSObject();
        d.put("message", message);
        notifyListeners("error", d);
    }

    @Override
    protected void handleOnDestroy() {
        destroyRecognizer();
        super.handleOnDestroy();
    }
}
