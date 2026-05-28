package tv.lntelecom.nativo.data

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject

/**
 * Resultado HTTP cru pra debug visual no login.
 */
data class HttpDebug(val ok: Boolean, val status: Int, val body: String, val error: String? = null)

class SupabaseClient(
    val http: OkHttpClient,
    private val baseUrl: String,
    private val anonKey: String,
    private val prefs: Prefs
) {
    val authUrl = "$baseUrl/auth/v1"
    val restUrl = "$baseUrl/rest/v1"
    val functionsUrl = "$baseUrl/functions/v1"

    /** Último debug HTTP capturado (para exibição na tela). */
    @Volatile var lastDebug: HttpDebug? = null
        private set

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

    private fun compact(value: String): String = value.replace(Regex("\\s+"), " ").trim()

    private fun responsePreview(label: String, status: Int, body: String): String {
        val prefix = "[$label] HTTP $status"
        val obj = try { JSONObject(body) } catch (_: Exception) { null }
        if (obj != null) {
            val parts = mutableListOf(prefix)
            listOf("success", "registered", "is_active", "code", "error", "detail", "msg", "message", "limit").forEach { key ->
                if (obj.has(key)) parts.add("$key=${compact(obj.opt(key)?.toString() ?: "null").take(120)}")
            }
            if (obj.has("access_token")) parts.add("access_token=OK")
            if (obj.has("refresh_token")) parts.add("refresh_token=OK")
            obj.optJSONObject("user")?.optString("id")?.takeIf { it.isNotEmpty() }?.let { parts.add("user_id=$it") }
            obj.optJSONObject("device")?.optString("id")?.takeIf { it.isNotEmpty() }?.let { parts.add("device_id_db=$it") }
            return parts.joinToString(" | ")
        }
        return "$prefix ${compact(body).take(220)}"
    }

    private fun loginCandidates(login: String): List<String> {
        val raw = login.trim().lowercase()
        if (raw.isEmpty()) return emptyList()
        val out = linkedSetOf<String>()
        val digits = raw.filter { it.isDigit() }
        if (!raw.contains("@") && (digits.length == 11 || digits.length == 14)) {
            out.add("$digits@tvln.local")
        }
        out.add(raw)
        return out.toList()
    }

    private fun saveSession(accessToken: String, refreshToken: String?, userId: String?, expiresIn: Long = 3600) {
        prefs.accessToken = accessToken
        prefs.refreshToken = refreshToken
        prefs.expiresAt = System.currentTimeMillis() + expiresIn * 1000L
        if (!userId.isNullOrEmpty()) prefs.userId = userId
    }

    private fun JSONObject.sessionObject(): JSONObject? {
        optJSONObject("session")?.let { return it }
        optJSONObject("data")?.optJSONObject("session")?.let { return it }
        return null
    }

    private fun JSONObject.sessionToken(key: String): String? {
        optString(key).takeIf { it.isNotEmpty() }?.let { return it }
        sessionObject()?.optString(key)?.takeIf { it.isNotEmpty() }?.let { return it }
        return null
    }

    private fun JSONObject.sessionUserId(): String? {
        optJSONObject("user")?.optString("id")?.takeIf { it.isNotEmpty() }?.let { return it }
        optString("user_id").takeIf { it.isNotEmpty() }?.let { return it }
        sessionObject()?.optJSONObject("user")?.optString("id")?.takeIf { it.isNotEmpty() }?.let { return it }
        return null
    }

    private fun execDebug(req: Request, label: String): HttpDebug {
        return try {
            http.newCall(req).execute().use { res ->
                val body = res.body?.string().orEmpty()
                // Mantém body COMPLETO em `d.body` pro parser; só trunca pro display.
                val d = HttpDebug(res.isSuccessful, res.code, body)
                lastDebug = HttpDebug(res.isSuccessful, res.code, responsePreview(label, res.code, body))
                d
            }
        } catch (e: Exception) {
            val d = HttpDebug(false, -1, "", e.message ?: e.javaClass.simpleName)
            lastDebug = d.copy(body = "[$label] EXCEPTION: ${d.error}")
            d
        }
    }

    fun signInPassword(email: String, password: String): Boolean {
        val req = Request.Builder()
            .url("$authUrl/token?grant_type=password")
            .header("apikey", anonKey)
            .header("Content-Type", "application/json")
            .post(json(mapOf("email" to email, "password" to password)))
            .build()
        val d = execDebug(req, "auth/token")
        if (!d.ok) return false
        return try {
            val obj = JSONObject(d.body.substringAfter("\n", d.body))
            val tok = obj.sessionToken("access_token") ?: return false
            saveSession(tok, obj.sessionToken("refresh_token"), obj.sessionUserId(), obj.optLong("expires_in", 3600))
            true
        } catch (_: Exception) { false }
    }

    private fun deviceLoginOnce(
        email: String, password: String,
        deviceId: String, deviceName: String, appVersion: String,
    ): Pair<Boolean, String?> {
        val payload = json(mapOf(
            "email" to email, "password" to password,
            "device_id" to deviceId, "platform" to "android",
            "device_name" to deviceName, "app_version" to appVersion,
        ))
        val req = Request.Builder()
            .url("$functionsUrl/device-login")
            .header("apikey", anonKey)
            .header("Authorization", "Bearer $anonKey")
            .header("Content-Type", "application/json")
            .post(payload).build()
        val d = execDebug(req, "device-login")
        val raw = d.body.substringAfter("\n", d.body)
        val obj = try { JSONObject(raw) } catch (_: Exception) { JSONObject() }
        if (!d.ok) {
            val msg = obj.optString("error").takeIf { it.isNotEmpty() }
                ?: d.error
                ?: "HTTP ${d.status}"
            return false to msg
        }
        val tok = obj.sessionToken("access_token")
        if (tok.isNullOrEmpty()) {
            // Se o backend só confirmou que o aparelho já está vinculado, entra pela sessão do device.
            if (deviceAutoLogin(deviceId, deviceName, appVersion)) return true to null
            // Fallback final: email/senha normal. O vínculo já foi validado pelo device-login OK.
            if (email.contains("@") && signInPassword(email, password)) return true to null
            return false to "Resposta sem access_token"
        }
        saveSession(tok, obj.sessionToken("refresh_token"), obj.sessionUserId())
        return true to null
    }

    fun deviceLogin(
        login: String, password: String,
        deviceId: String, deviceName: String, appVersion: String,
    ): Pair<Boolean, String?> {
        // Se o aparelho já está vinculado no painel, não depende mais da senha digitada.
        // Isso evita ficar preso em "Resposta sem access_token" quando o backend confirma vínculo.
        if (deviceAutoLogin(deviceId, deviceName, appVersion)) return true to null

        var lastResult: Pair<Boolean, String?> = false to "Login vazio"
        for ((idx, candidate) in loginCandidates(login).withIndex()) {
            val label = if (candidate == login.trim().lowercase()) candidate else "$candidate (CPF→email)"
            lastDebug = HttpDebug(false, 0, "[login] tentativa ${idx + 1}: $label")
            val result = deviceLoginOnce(candidate, password, deviceId, deviceName, appVersion)
            if (result.first) return result
            lastResult = result
            val msg = result.second.orEmpty().lowercase()
            if (!msg.contains("invalid login") && !msg.contains("credenciais inválidas")) break
        }
        return lastResult
    }

    fun deviceAnnounce(deviceId: String, deviceName: String, appVersion: String): Boolean {
        val payload = json(mapOf(
            "device_id" to deviceId, "platform" to "android",
            "device_name" to deviceName, "app_version" to appVersion,
        ))
        val req = Request.Builder()
            .url("$functionsUrl/device-announce")
            .header("apikey", anonKey)
            .header("Authorization", "Bearer $anonKey")
            .header("Content-Type", "application/json")
            .post(payload).build()
        val d = execDebug(req, "device-announce")
        if (!d.ok) return false
        return try {
            JSONObject(d.body.substringAfter("\n", d.body)).optBoolean("registered", false)
        } catch (_: Exception) { false }
    }

    fun deviceAutoLogin(deviceId: String, deviceName: String, appVersion: String): Boolean {
        val payload = json(mapOf(
            "device_id" to deviceId, "platform" to "android",
            "device_name" to deviceName, "app_version" to appVersion,
        ))
        val req = Request.Builder()
            .url("$functionsUrl/device-auto-login")
            .header("apikey", anonKey)
            .header("Authorization", "Bearer $anonKey")
            .header("Content-Type", "application/json")
            .post(payload).build()
        val d = execDebug(req, "device-auto-login")
        if (!d.ok) return false
        return try {
            val obj = JSONObject(d.body.substringAfter("\n", d.body))
            val tok = obj.sessionToken("access_token") ?: return false
            saveSession(tok, obj.sessionToken("refresh_token"), obj.sessionUserId())
            true
        } catch (_: Exception) { false }
    }

    fun refreshSession(): Boolean {
        val refresh = prefs.refreshToken ?: return false
        val req = Request.Builder()
            .url("$authUrl/token?grant_type=refresh_token")
            .header("apikey", anonKey)
            .header("Content-Type", "application/json")
            .post(json(mapOf("refresh_token" to refresh)))
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
