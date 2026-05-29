package tv.lntelecom.nativo.data

/**
 * Resolve a URL de stream final pro ExoPlayer.
 * Espelha src/lib/stream.ts: rotas HTTP mixed-content / CORS passam pelo hls-proxy.
 */
object StreamUrl {
    private const val BACKEND = "https://tv2.lntelecom.net"

    fun resolve(raw: String, type: String): String {
        if (raw.isBlank()) return raw
        if (raw.startsWith("https://")) return raw
        if (raw.startsWith("http://")) {
            return "$BACKEND/functions/v1/hls-proxy?url=" +
                java.net.URLEncoder.encode(raw, "UTF-8")
        }
        return raw
    }

    /** Logo principal: usa logo_url (local /logos/) com fallback pra logo_source_url (URL externa). */
    fun resolveLogo(logoUrl: String?, sourceUrl: String? = null): String? {
        val primary = logoUrl?.takeIf { it.isNotBlank() }
        if (primary != null) {
            if (primary.startsWith("http")) return primary
            return if (primary.startsWith("/")) "$BACKEND$primary" else "$BACKEND/$primary"
        }
        val src = sourceUrl?.takeIf { it.isNotBlank() } ?: return null
        if (src.startsWith("http")) return src
        return if (src.startsWith("/")) "$BACKEND$src" else "$BACKEND/$src"
    }
}
