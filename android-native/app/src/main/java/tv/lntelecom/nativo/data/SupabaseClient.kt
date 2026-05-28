package tv.lntelecom.nativo.data

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject

/**
 * Cliente Supabase REST direto contra o backend self-hosted, sem WebView.
 * Bate em https://tv2.lntelecom.net/auth/v1 e /rest/v1 — mesma API do frontend web.
 */
class SupabaseClient(
    val http: OkHttpClient,
    private val baseUrl: String,
    private val anonKey: String,
    private val prefs: Prefs
) {
    val authUrl = "$baseUrl/auth/v1"
    val restUrl = "$baseUrl/rest/v1"
    val functionsUrl = "$baseUrl/functions/v1"

    private fun json(map: Map<String, Any?>): okhttp3.RequestBody {
        val obj = JSONObject()
        map.forEach { (k, v) -> obj.put(k, v) }
        return obj.toString().toRequestBody("application/json".toMediaType())
    }

    private fun baseRequest(url: String, withAuth: Boolean = true): Request.Builder {
        val b = Request.Builder().url(url).header("apikey", anonKey)
        if (withAuth) {
            val tok = prefs.accessToken ?: anonKey
            b.header("Authorization", "Bearer $tok")
        }
        return b
    }

    // --- AUTH ---

    private fun saveSession(accessToken: String, refreshToken: String?, userId: String?, expiresIn: Long = 3600) {
        prefs.accessToken = accessToken
        prefs.refreshToken = refreshToken
        prefs.expiresAt = System.currentTimeMillis() + expiresIn * 1000L
        if (!userId.isNullOrEmpty()) prefs.userId = userId
    }

    /** Fallback direto via /auth/v1/token (sem registro de device). */
    fun signInPassword(email: String, password: String): Boolean {
        val body = json(mapOf("email" to email, "password" to password))
        val req = Request.Builder()
            .url("$authUrl/token?grant_type=password")
            .header("apikey", anonKey)
            .header("Content-Type", "application/json")
            .post(body)
            .build()
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) return false
            val obj = JSONObject(res.body?.string() ?: return false)
            val tok = obj.optString("access_token").takeIf { it.isNotEmpty() } ?: return false
            saveSession(
                tok,
                obj.optString("refresh_token").takeIf { it.isNotEmpty() },
                obj.optJSONObject("user")?.optString("id"),
                obj.optLong("expires_in", 3600),
            )
            return true
        }
    }

    /**
     * Login com password + registro do device via edge function device-login.
     * Retorna Pair(ok, mensagemDeErro?).
     */
    fun deviceLogin(
        email: String,
        password: String,
        deviceId: String,
        deviceName: String,
        appVersion: String,
    ): Pair<Boolean, String?> {
        val payload = json(
            mapOf(
                "email" to email,
                "password" to password,
                "device_id" to deviceId,
                "platform" to "android",
                "device_name" to deviceName,
                "app_version" to appVersion,
            )
        )
        val req = Request.Builder()
            .url("$functionsUrl/device-login")
            .header("apikey", anonKey)
            .header("Authorization", "Bearer $anonKey")
            .header("Content-Type", "application/json")
            .post(payload)
            .build()
        http.newCall(req).execute().use { res ->
            val txt = res.body?.string().orEmpty()
            val obj = try { JSONObject(txt) } catch (_: Exception) { JSONObject() }
            if (!res.isSuccessful) {
                return false to (obj.optString("error").takeIf { it.isNotEmpty() } ?: "HTTP ${res.code}")
            }
            val tok = obj.optString("access_token").takeIf { it.isNotEmpty() }
                ?: return false to "Resposta inválida"
            saveSession(
                tok,
                obj.optString("refresh_token").takeIf { it.isNotEmpty() },
                obj.optJSONObject("user")?.optString("id"),
            )
            return true to null
        }
    }

    /** Beacon pending_devices. Retorna true se admin já vinculou (APK deve tentar auto-login). */
    fun deviceAnnounce(deviceId: String, deviceName: String, appVersion: String): Boolean {
        val payload = json(
            mapOf(
                "device_id" to deviceId,
                "platform" to "android",
                "device_name" to deviceName,
                "app_version" to appVersion,
            )
        )
        val req = Request.Builder()
            .url("$functionsUrl/device-announce")
            .header("apikey", anonKey)
            .header("Authorization", "Bearer $anonKey")
            .header("Content-Type", "application/json")
            .post(payload)
            .build()
        return try {
            http.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return false
                val obj = JSONObject(res.body?.string() ?: return false)
                obj.optBoolean("registered", false)
            }
        } catch (_: Exception) { false }
    }

    /** Autenticação sem senha (admin pré-vinculou o device). */
    fun deviceAutoLogin(deviceId: String, deviceName: String, appVersion: String): Boolean {
        val payload = json(
            mapOf(
                "device_id" to deviceId,
                "platform" to "android",
                "device_name" to deviceName,
                "app_version" to appVersion,
            )
        )
        val req = Request.Builder()
            .url("$functionsUrl/device-auto-login")
            .header("apikey", anonKey)
            .header("Authorization", "Bearer $anonKey")
            .header("Content-Type", "application/json")
            .post(payload)
            .build()
        return try {
            http.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return false
                val obj = JSONObject(res.body?.string() ?: return false)
                val tok = obj.optString("access_token").takeIf { it.isNotEmpty() } ?: return false
                saveSession(
                    tok,
                    obj.optString("refresh_token").takeIf { it.isNotEmpty() },
                    obj.optString("user_id").takeIf { it.isNotEmpty() },
                )
                true
            }
        } catch (_: Exception) { false }
    }

    fun refreshSession(): Boolean {
        val refresh = prefs.refreshToken ?: return false
        val body = json(mapOf("refresh_token" to refresh))
        val req = Request.Builder()
            .url("$authUrl/token?grant_type=refresh_token")
            .header("apikey", anonKey)
            .header("Content-Type", "application/json")
            .post(body)
            .build()
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) { prefs.clearSession(); return false }
            val obj = JSONObject(res.body?.string() ?: return false)
            prefs.accessToken = obj.optString("access_token")
            prefs.refreshToken = obj.optString("refresh_token")
            prefs.expiresAt = System.currentTimeMillis() + obj.optLong("expires_in", 3600) * 1000L
            return true
        }
    }

    fun ensureFreshSession() {
        if (prefs.accessToken != null && System.currentTimeMillis() > prefs.expiresAt - 60_000) {
            refreshSession()
        }
    }

    fun signOut() { prefs.clearSession() }

    // --- REST ---

    fun get(path: String): Response {
        ensureFreshSession()
        val req = baseRequest("$restUrl/$path").get().build()
        return http.newCall(req).execute()
    }

    fun insert(table: String, row: Map<String, Any?>): Response {
        ensureFreshSession()
        val req = baseRequest("$restUrl/$table")
            .header("Content-Type", "application/json")
            .header("Prefer", "return=minimal")
            .post(json(row))
            .build()
        return http.newCall(req).execute()
    }

    fun delete(path: String): Response {
        ensureFreshSession()
        val req = baseRequest("$restUrl/$path").delete().build()
        return http.newCall(req).execute()
    }

    fun callFunction(name: String, body: Map<String, Any?>): Response {
        ensureFreshSession()
        val req = baseRequest("$functionsUrl/$name")
            .header("Content-Type", "application/json")
            .post(json(body))
            .build()
        return http.newCall(req).execute()
    }
}
