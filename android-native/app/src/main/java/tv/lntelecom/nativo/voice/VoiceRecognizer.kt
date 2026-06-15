package tv.lntelecom.nativo.voice

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

/**
 * Reconhecimento de voz pt-BR + overlay simples.
 * Notifica via callbacks; quem decide o que fazer com o texto é o PlayerActivity.
 */
class VoiceRecognizer(
    private val activity: Activity,
    private val onTranscript: (String) -> Unit,
) {
    companion object { const val REQ_AUDIO = 7331 }

    private var recognizer: SpeechRecognizer? = null
    private var overlay: LinearLayout? = null
    private var statusText: TextView? = null
    private var partialText: TextView? = null
    private val main = Handler(Looper.getMainLooper())

    fun start() {
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.RECORD_AUDIO), REQ_AUDIO)
            showOverlay("Permita o microfone e tente de novo", isError = true)
            main.postDelayed({ hideOverlay() }, 2200)
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
            showOverlay("Reconhecimento de voz indisponível", isError = true)
            main.postDelayed({ hideOverlay() }, 2200)
            return
        }
        destroy()
        showOverlay("Ouvindo…")
        recognizer = SpeechRecognizer.createSpeechRecognizer(activity).apply {
            setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {}
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onError(error: Int) {
                    val msg = when (error) {
                        SpeechRecognizer.ERROR_NO_MATCH,
                        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Não entendi"
                        SpeechRecognizer.ERROR_NETWORK,
                        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Sem internet"
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Sem permissão de microfone"
                        else -> "Erro de voz ($error)"
                    }
                    showOverlay(msg, isError = true)
                    main.postDelayed({ hideOverlay() }, 1800)
                }
                override fun onResults(results: Bundle?) {
                    val arr = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    val text = arr?.firstOrNull().orEmpty()
                    if (text.isNotEmpty()) {
                        showOverlay("“$text”")
                        main.postDelayed({ hideOverlay() }, 1400)
                        onTranscript(text)
                    } else {
                        showOverlay("Não entendi", isError = true)
                        main.postDelayed({ hideOverlay() }, 1500)
                    }
                }
                override fun onPartialResults(partialResults: Bundle?) {
                    val arr = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    arr?.firstOrNull()?.let { partialText?.text = it }
                }
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR")
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "pt-BR")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, activity.packageName)
        }
        try { recognizer?.startListening(intent) } catch (e: Exception) {
            showOverlay("Falha ao iniciar voz", isError = true)
            main.postDelayed({ hideOverlay() }, 1800)
        }
    }

    fun destroy() {
        try { recognizer?.stopListening() } catch (_: Exception) {}
        try { recognizer?.cancel() } catch (_: Exception) {}
        try { recognizer?.destroy() } catch (_: Exception) {}
        recognizer = null
    }

    private fun showOverlay(status: String, isError: Boolean = false) {
        val root = activity.findViewById<ViewGroup>(android.R.id.content) ?: return
        if (overlay == null) {
            val ll = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(dp(28), dp(20), dp(28), dp(20))
                background = GradientDrawable().apply {
                    cornerRadius = dp(20).toFloat()
                    setColor(Color.argb(220, 0, 0, 0))
                    setStroke(dp(1), Color.argb(40, 255, 255, 255))
                }
            }
            statusText = TextView(activity).apply {
                setTextColor(Color.WHITE)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
            }
            partialText = TextView(activity).apply {
                setTextColor(Color.argb(220, 255, 255, 255))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                gravity = Gravity.CENTER
                setPadding(0, dp(8), 0, 0)
            }
            ll.addView(statusText, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            ll.addView(partialText, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            val lp = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
            )
            root.addView(ll, lp)
            overlay = ll
        }
        statusText?.text = status
        statusText?.setTextColor(if (isError) Color.rgb(252, 165, 165) else Color.WHITE)
        partialText?.text = ""
        overlay?.visibility = ViewGroup.VISIBLE
        overlay?.bringToFront()
    }

    private fun hideOverlay() {
        overlay?.visibility = ViewGroup.GONE
    }

    private fun dp(v: Int): Int =
        (v * activity.resources.displayMetrics.density).toInt()
}
