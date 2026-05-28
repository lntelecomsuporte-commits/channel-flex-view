package tv.lntelecom.nativo.data

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

class FavoritesRepository(private val sb: SupabaseClient, private val prefs: Prefs) {

    @Volatile private var ids: MutableSet<String> = mutableSetOf()

    fun load(): Set<String> {
        sb.ensureFreshSession()
        val out = mutableSetOf<String>()
        sb.get("user_favorites?select=channel_id").use { res ->
            if (res.isSuccessful) {
                val arr = JSONArray(res.body?.string() ?: "[]")
                for (i in 0 until arr.length()) {
                    arr.optJSONObject(i)?.optString("channel_id")
                        ?.takeIf { it.isNotEmpty() }?.let { out.add(it) }
                }
            }
        }
        ids = out
        return out
    }

    fun isFavorite(channelId: String) = ids.contains(channelId)

    fun toggle(channelId: String): Boolean {
        sb.ensureFreshSession()
        val uid = prefs.userId ?: return false
        return if (ids.contains(channelId)) {
            val req = Request.Builder()
                .url("${sb.restUrl}/user_favorites?user_id=eq.$uid&channel_id=eq.$channelId")
                .header("apikey", sb.let { App_ANON_KEY })
                .header("Authorization", "Bearer ${prefs.accessToken}")
                .delete()
                .build()
            sb.httpExec(req).use { res ->
                if (res.isSuccessful) { ids.remove(channelId); false } else true
            }
        } else {
            val body = JSONObject().apply {
                put("user_id", uid); put("channel_id", channelId); put("position", 0)
            }.toString().toRequestBody("application/json".toMediaType())
            val req = Request.Builder()
                .url("${sb.restUrl}/user_favorites")
                .header("apikey", App_ANON_KEY)
                .header("Authorization", "Bearer ${prefs.accessToken}")
                .header("Content-Type", "application/json")
                .header("Prefer", "return=minimal")
                .post(body)
                .build()
            sb.httpExec(req).use { res ->
                if (res.isSuccessful) { ids.add(channelId); true } else false
            }
        }
    }
}

// Constante curta pra evitar referência cruzada em build do Kotlin
private val App_ANON_KEY: String get() = tv.lntelecom.nativo.App.ANON_KEY
