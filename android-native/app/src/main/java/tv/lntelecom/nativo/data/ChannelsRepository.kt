package tv.lntelecom.nativo.data

import org.json.JSONArray
import org.json.JSONObject
import tv.lntelecom.nativo.data.model.Category
import tv.lntelecom.nativo.data.model.Channel

class ChannelsRepository(private val sb: SupabaseClient) {

    /**
     * Carrega canais ativos respeitando user_category_access + category_includes.
     * Espelha a lógica de src/hooks/useChannels.ts.
     */
    fun loadChannels(): List<Channel> {
        val uid = sb.run { /* ensure session */ ensureFreshSession(); null } // no-op kicker
        val userId = (sb as SupabaseClient).let { /* placeholder */ null }

        // 1. Lê IDs de categoria autorizados pra esse usuário
        val accessIds = mutableSetOf<String>()
        sb.get("user_category_access?select=category_id&is_active=eq.true").use { res ->
            if (res.isSuccessful) {
                val arr = JSONArray(res.body?.string() ?: "[]")
                for (i in 0 until arr.length()) {
                    arr.optJSONObject(i)?.optString("category_id")?.let { if (it.isNotEmpty()) accessIds.add(it) }
                }
            }
        }

        if (accessIds.isEmpty()) return emptyList()

        // 2. Resolve categorias incluídas (category_includes)
        val inList = accessIds.joinToString(",") { "\"$it\"" }
        sb.get("category_includes?select=included_category_id&category_id=in.($inList)").use { res ->
            if (res.isSuccessful) {
                val arr = JSONArray(res.body?.string() ?: "[]")
                for (i in 0 until arr.length()) {
                    arr.optJSONObject(i)?.optString("included_category_id")?.let { if (it.isNotEmpty()) accessIds.add(it) }
                }
            }
        }

        // 3. Mapa de categorias pra nome
        val catMap = mutableMapOf<String, String>()
        sb.get("categories?select=id,name,sort_order").use { res ->
            if (res.isSuccessful) {
                val arr = JSONArray(res.body?.string() ?: "[]")
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    catMap[o.optString("id")] = o.optString("name")
                }
            }
        }

        // 4. Canais
        val finalIds = accessIds.joinToString(",") { "\"$it\"" }
        val result = mutableListOf<Channel>()
        sb.get("channels?select=*&is_active=eq.true&category_id=in.($finalIds)&order=channel_number.asc")
            .use { res ->
                if (!res.isSuccessful) return emptyList()
                val arr = JSONArray(res.body?.string() ?: "[]")
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    val catId = o.optString("category_id").takeIf { it.isNotEmpty() }
                    result.add(
                        Channel(
                            id = o.optString("id"),
                            name = o.optString("name"),
                            channelNumber = o.optInt("channel_number", 0),
                            streamUrl = o.optString("stream_url"),
                            streamType = o.optString("stream_type", "hls"),
                            logoUrl = o.optString("logo_url").takeIf { it.isNotEmpty() },
                            categoryId = catId,
                            categoryName = catId?.let { catMap[it] },
                            epgChannelId = o.optString("epg_channel_id").takeIf { it.isNotEmpty() },
                            isActive = o.optBoolean("is_active", true),
                            updatedAt = o.optString("updated_at")
                        )
                    )
                }
            }
        return result
    }
}
