package tv.lntelecom.nativo.data

import android.util.Xml
import okhttp3.OkHttpClient
import okhttp3.Request
import org.xmlpull.v1.XmlPullParser
import tv.lntelecom.nativo.App
import tv.lntelecom.nativo.data.model.EpgProgram
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Lê o XML consolidado /epg/lntv.xml (gerado pelo sync-epg.mjs no servidor).
 * Cache em memória por ~10min.
 */
class EpgRepository(private val http: OkHttpClient) {

    @Volatile private var cache: Map<String, List<EpgProgram>> = emptyMap()
    @Volatile private var fetchedAt: Long = 0L
    private val ttlMs = 10 * 60_000L

    private val fmt = SimpleDateFormat("yyyyMMddHHmmss Z", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    fun ensureLoaded(): Boolean {
        if (cache.isNotEmpty() && System.currentTimeMillis() - fetchedAt < ttlMs) return true
        return try {
            val req = Request.Builder().url("${App.BACKEND}/epg/lntv.xml").get().build()
            http.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return false
                val body = res.body?.byteStream() ?: return false
                cache = parseXmlTv(body)
                fetchedAt = System.currentTimeMillis()
                true
            }
        } catch (_: Exception) { false }
    }

    fun currentProgram(epgChannelId: String?): EpgProgram? {
        if (epgChannelId.isNullOrBlank()) return null
        val list = cache[epgChannelId] ?: return null
        val now = System.currentTimeMillis()
        return list.firstOrNull { now in it.startMs..it.endMs }
    }

    fun nextProgram(epgChannelId: String?): EpgProgram? {
        if (epgChannelId.isNullOrBlank()) return null
        val list = cache[epgChannelId] ?: return null
        val now = System.currentTimeMillis()
        return list.firstOrNull { it.startMs > now }
    }

    private fun parseXmlTv(input: java.io.InputStream): Map<String, List<EpgProgram>> {
        val parser = Xml.newPullParser()
        parser.setInput(input, null)
        val out = mutableMapOf<String, MutableList<EpgProgram>>()
        var event = parser.eventType
        var curChan: String? = null
        var curStart = 0L
        var curEnd = 0L
        var curTitle = ""
        var curDesc: String? = null
        var inTitle = false
        var inDesc = false
        while (event != XmlPullParser.END_DOCUMENT) {
            when (event) {
                XmlPullParser.START_TAG -> when (parser.name) {
                    "programme" -> {
                        curChan = parser.getAttributeValue(null, "channel")
                        curStart = parseTs(parser.getAttributeValue(null, "start"))
                        curEnd = parseTs(parser.getAttributeValue(null, "stop"))
                        curTitle = ""; curDesc = null
                    }
                    "title" -> inTitle = true
                    "desc" -> inDesc = true
                }
                XmlPullParser.TEXT -> {
                    if (inTitle) curTitle = parser.text ?: ""
                    if (inDesc) curDesc = parser.text
                }
                XmlPullParser.END_TAG -> when (parser.name) {
                    "title" -> inTitle = false
                    "desc" -> inDesc = false
                    "programme" -> {
                        val c = curChan
                        if (c != null && curStart > 0 && curEnd > curStart) {
                            out.getOrPut(c) { mutableListOf() }
                                .add(EpgProgram(curTitle, curDesc, curStart, curEnd))
                        }
                    }
                }
            }
            event = parser.next()
        }
        out.values.forEach { it.sortBy { p -> p.startMs } }
        return out
    }

    private fun parseTs(s: String?): Long {
        if (s.isNullOrBlank()) return 0L
        return try {
            val withTz = if (s.length >= 14 && !s.contains(" ")) "${s.substring(0, 14)} +0000" else s
            fmt.parse(withTz)?.time ?: 0L
        } catch (_: Exception) { 0L }
    }
}
