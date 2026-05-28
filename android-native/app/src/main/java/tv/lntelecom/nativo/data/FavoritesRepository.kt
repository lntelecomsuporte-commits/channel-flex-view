package tv.lntelecom.nativo.data

import org.json.JSONArray

class FavoritesRepository(private val sb: SupabaseClient, private val prefs: Prefs) {

    @Volatile private var ids: MutableSet<String> = mutableSetOf()

    fun load(): Set<String> {
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

    /** Retorna o novo estado (true = é favorito). */
    fun toggle(channelId: String): Boolean {
        val uid = prefs.userId ?: return ids.contains(channelId)
        return if (ids.contains(channelId)) {
            sb.delete("user_favorites?user_id=eq.$uid&channel_id=eq.$channelId").use { res ->
                if (res.isSuccessful) ids.remove(channelId)
            }
            false
        } else {
            sb.insert(
                "user_favorites",
                mapOf("user_id" to uid, "channel_id" to channelId, "position" to 0)
            ).use { res -> if (res.isSuccessful) ids.add(channelId) }
            true
        }
    }
}
