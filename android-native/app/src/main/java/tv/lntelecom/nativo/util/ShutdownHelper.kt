package tv.lntelecom.nativo.util

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent

/**
 * Encerra o app quando o usuário desliga o receptor (Power no controle,
 * TV entrando em stand-by ou HDMI desconectado). Deve ser instanciado em
 * TODAS as Activities pra garantir paridade, já que ACTION_SCREEN_OFF e
 * ACTION_HDMI_PLUG só chegam pra receivers dinâmicos.
 *
 * NÃO trata onStop/onPause/perda de foco — evita fechar durante updates,
 * diálogos do sistema ou notificações.
 */
class ShutdownHelper private constructor(private val activity: Activity) {

    private var shuttingDown = false
    private var receiver: BroadcastReceiver? = null

    private fun register() {
        if (receiver != null) return
        receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                when (intent?.action) {
                    Intent.ACTION_SCREEN_OFF -> shutdown("screen_off")
                    "android.intent.action.HDMI_PLUG" -> {
                        val plugged = intent.getBooleanExtra("state", true)
                        if (!plugged) shutdown("hdmi_unplug")
                    }
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction("android.intent.action.HDMI_PLUG")
        }
        try { activity.registerReceiver(receiver, filter) } catch (_: Exception) {}
    }

    fun unregister() {
        try { receiver?.let { activity.unregisterReceiver(it) } } catch (_: Exception) {}
        receiver = null
    }

    /** Chamar no onKeyDown da Activity. Retorna true se consumiu o evento. */
    fun handleKeyDown(keyCode: Int): Boolean {
        if (keyCode == KeyEvent.KEYCODE_POWER ||
            keyCode == KeyEvent.KEYCODE_SLEEP ||
            keyCode == KeyEvent.KEYCODE_SOFT_SLEEP) {
            shutdown("power_key")
            return true
        }
        return false
    }

    fun shutdown(reason: String) {
        if (shuttingDown) return
        shuttingDown = true
        android.util.Log.i("LNTV", "ShutdownHelper: shutting down ($reason) from ${activity.javaClass.simpleName}")
        try { activity.finishAndRemoveTask() } catch (_: Exception) {
            try { activity.finishAffinity() } catch (_: Exception) {}
        }
        Handler(Looper.getMainLooper()).postDelayed({ System.exit(0) }, 150)
    }

    companion object {
        fun install(activity: Activity): ShutdownHelper {
            val h = ShutdownHelper(activity)
            h.register()
            return h
        }
    }
}
