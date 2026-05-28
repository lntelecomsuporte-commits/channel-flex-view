package tv.lntelecom.nativo.data

/**
 * Resolve a URL de stream final pro ExoPlayer.
 * Espelha src/lib/stream.ts: rotas HTTP mixed-content / CORS passam pelo hls-proxy.
 */
object StreamUrl {
    private const val BACKEND = "https://tv2.lntelecom.net"

    fun resolve(raw: String, type: String): String {
        if (raw.isBlank()) return raw
        // HTTPS direto: usa como veio
        if (raw.startsWith("https://")) return raw
        // HTTP plano: força proxy pra evitar cleartext bloqueado em Android 9+
        if (raw.startsWith("http://")) {
            return "$BACKEND/functions/v1/hls-proxy?url=" +
                java.net.URLEncoder.encode(raw, "UTF-8")
        }
        return raw
    }

    fun resolveLogo(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        if (raw.startsWith("http")) return raw
        // logos locais nginx /logos/...
        return if (raw.startsWith("/")) "$BACKEND$raw" else "$BACKEND/$raw"
    }
}
