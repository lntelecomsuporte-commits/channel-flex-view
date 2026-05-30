package tv.lntelecom.nativo.data

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import tv.lntelecom.nativo.BuildConfig
import java.util.UUID

/**
 * Mantém uma user_session ativa no painel enquanto o player está aberto.
 * Espelha src/hooks/useSessionHeartbeat.ts.
 */
class HeartbeatManager(
    private val ctx: Context,
    private val sb: SupabaseClient,
) {
    private val handler = Handler(Looper.getMainLooper())
    private val intervalMs = 30_000L
    private val sessionToken = UUID.randomUUID().toString()
    private val deviceId = DeviceId.get(ctx)
    private val deviceName = "${Build.MANUFACTURER} ${Build.MODEL}".trim()
    private val appVersion = BuildConfig.VERSION_NAME

    @Volatile private var sessionId: String? = null
    @Volatile private var channelId: String? = null
    @Volatile private var channelName: String? = null
    @Volatile private var isWatching: Boolean = false
    @Volatile private var running = false

    fun updateChannel(id: String?, name: String?, watching: Boolean) {
        channelId = id
        channelName = name
        isWatching = watching
    }

    fun start() {
        if (running) return
        running = true
        Thread {
            try { startSession() } catch (_: Exception) {}
            handler.post(tick)
        }.start()
    }

    private val tick = object : Runnable {
        override fun run() {
            if (!running) return
            Thread {
                try { heartbeat() } catch (_: Exception) {}
            }.start()
            handler.postDelayed(this, intervalMs)
        }
    }

    fun stop() {
        if (!running) return
        running = false
        handler.removeCallbacks(tick)
        val sid = sessionId ?: return
        sessionId = null
        Thread { try { endSession(sid) } catch (_: Exception) {} }.start()
    }

    private fun basePayload(): JSONObject = JSONObject().apply {
        put("sessionToken", sessionToken)
        put("userAgent", "LNTV-Native/$appVersion Android ${Build.VERSION.RELEASE}")
        put("channelId", channelId)
        put("channelName", channelName)
        put("isWatching", isWatching)
        put("deviceId", deviceId)
        put("platform", "android")
        put("deviceName", deviceName)
        put("appVersion", appVersion)
    }

    private fun startSession() {
        sb.ensureFreshSession()
        val tok = sb.prefs.accessToken ?: return
        val body = basePayload().put("action", "start").toString()
            .toRequestBody("application/json".toMediaType())
        val req = Request.Builder()
            .url("${sb.functionsUrl}/session-heartbeat")
            .header("apikey", anonKey())
            .header("Authorization", "Bearer $tok")
            .header("Content-Type", "application/json")
            .post(body).build()
        sb.http.newCall(req).execute().use { res ->
            val txt = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                android.util.Log.w("LNTV-HB", "start falhou ${res.code}: $txt")
                return
            }
            try {
                val obj = JSONObject(txt)
                sessionId = obj.optString("id").takeIf { it.isNotEmpty() }
                android.util.Log.i("LNTV-HB", "session iniciada $sessionId")
            } catch (_: Exception) {}
        }
    }

    private fun heartbeat() {
        val sid = sessionId ?: run { startSession(); return }
        sb.ensureFreshSession()
        val tok = sb.prefs.accessToken ?: return
        val body = basePayload().put("action", "heartbeat").put("sessionId", sid).toString()
            .toRequestBody("application/json".toMediaType())
        val req = Request.Builder()
            .url("${sb.functionsUrl}/session-heartbeat")
            .header("apikey", anonKey())
            .header("Authorization", "Bearer $tok")
            .header("Content-Type", "application/json")
            .post(body).build()
        sb.http.newCall(req).execute().use { res ->
            val txt = res.body?.string().orEmpty()
            if (res.code == 404) {
                // sessão sumiu, recria
                sessionId = null
                return
            }
            if (!res.isSuccessful) android.util.Log.w("LNTV-HB", "hb ${res.code}: $txt")
        }
    }

    private fun endSession(sid: String) {
        val tok = sb.prefs.accessToken ?: return
        val body = JSONObject().put("action", "end").put("sessionId", sid).toString()
            .toRequestBody("application/json".toMediaType())
        val req = Request.Builder()
            .url("${sb.functionsUrl}/session-heartbeat")
            .header("apikey", anonKey())
            .header("Authorization", "Bearer $tok")
            .header("Content-Type", "application/json")
            .post(body).build()
        sb.http.newCall(req).execute().use { it.body?.string() }
    }

    private fun anonKey(): String = tv.lntelecom.nativo.App.ANON_KEY
}
