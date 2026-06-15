package tv.lntelecom.nativo.voice

import tv.lntelecom.nativo.data.model.Channel
import java.text.Normalizer
import java.util.Locale

sealed class VoiceAction {
    data class TuneNumber(val number: Int) : VoiceAction()
    data class TuneChannel(val channel: Channel) : VoiceAction()
    object Audio : VoiceAction()
    object Subtitle : VoiceAction()
    object Shutdown : VoiceAction()
    data class Unknown(val raw: String) : VoiceAction()
}

object VoiceCommandParser {
    private val NUM_WORDS = mapOf(
        "zero" to 0, "um" to 1, "uma" to 1, "dois" to 2, "duas" to 2,
        "tres" to 3, "quatro" to 4, "cinco" to 5, "seis" to 6,
        "sete" to 7, "oito" to 8, "nove" to 9, "dez" to 10,
        "onze" to 11, "doze" to 12, "treze" to 13, "quatorze" to 14,
        "catorze" to 14, "quinze" to 15, "dezesseis" to 16, "dezessete" to 17,
        "dezoito" to 18, "dezenove" to 19, "vinte" to 20, "trinta" to 30,
        "quarenta" to 40, "cinquenta" to 50, "sessenta" to 60,
        "setenta" to 70, "oitenta" to 80, "noventa" to 90,
    )

    private fun stripAccents(s: String): String =
        Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("\\p{M}"), "")

    private fun normalize(s: String): String =
        stripAccents(s).lowercase(Locale.ROOT).trim()

    private fun wordsToNumber(text: String): Int? {
        val cleaned = text.replace(Regex("\\s+e\\s+"), " ").trim()
        if (cleaned.matches(Regex("\\d{1,4}"))) return cleaned.toIntOrNull()
        var sum = 0; var any = false
        for (p in cleaned.split(Regex("\\s+"))) {
            val v = NUM_WORDS[p] ?: return null
            sum += v; any = true
        }
        return if (any) sum else null
    }

    private fun levenshtein(a: String, b: String): Int {
        if (a == b) return 0
        val al = a.length; val bl = b.length
        if (al == 0) return bl; if (bl == 0) return al
        val v = IntArray(bl + 1) { it }
        for (i in 1..al) {
            var prev = v[0]; v[0] = i
            for (j in 1..bl) {
                val tmp = v[j]
                v[j] = if (a[i - 1] == b[j - 1]) prev else minOf(prev, v[j], v[j - 1]) + 1
                prev = tmp
            }
        }
        return v[bl]
    }

    private fun fuzzyMatch(q: String, channels: List<Channel>): Channel? {
        var best: Pair<Channel, Int>? = null
        for (ch in channels) {
            val name = normalize(ch.name)
            var score = 0
            when {
                name == q -> score = 1000
                name.startsWith(q) || q.startsWith(name) ->
                    score = 500 - kotlin.math.abs(name.length - q.length)
                name.contains(q) || q.contains(name) ->
                    score = 300 - kotlin.math.abs(name.length - q.length)
                else -> {
                    val d = levenshtein(name, q)
                    val maxLen = maxOf(name.length, q.length)
                    if (d <= 2 || d.toDouble() / maxLen < 0.34) score = 200 - d * 10
                }
            }
            if (score > 0 && (best == null || score > best.second)) best = ch to score
        }
        return best?.first
    }

    fun parse(raw: String, channels: List<Channel>): VoiceAction {
        val t = normalize(raw)
        if (t.isEmpty()) return VoiceAction.Unknown(raw)

        if (Regex("^(audio|som|sap|mts|trilha( de audio)?)$").matches(t) ||
            Regex("\\b(trocar|mudar|alternar|proximo|outro)\\s+(audio|som|trilha|idioma)\\b").containsMatchIn(t))
            return VoiceAction.Audio

        if (Regex("^(legenda|legendas|caption|closed caption|cc|subtitulo|subtitulos)$").matches(t) ||
            Regex("\\b(legenda|caption|cc|subtitulo)\\b").containsMatchIn(t))
            return VoiceAction.Subtitle

        if (Regex("^(desligar|desliga|sair|fechar|fecha|tchau|encerrar|finalizar)$").matches(t) ||
            Regex("\\b(desligar|desliga)\\s+(tv|aparelho|receptor|tudo)\\b").containsMatchIn(t))
            return VoiceAction.Shutdown

        // número
        val numTxt = t.replace(Regex("^(canal|numero|n[uo])\\s+"), "")
        wordsToNumber(numTxt)?.let { return VoiceAction.TuneNumber(it) }

        // nome
        val nameQuery = t.replace(Regex("^(canal|coloca|colocar|poe|por|abre|abrir|sintoniza|sintonizar|ver|assistir|quero ver|quero assistir|botar)\\s+"), "")
        fuzzyMatch(nameQuery, channels)?.let { return VoiceAction.TuneChannel(it) }

        return VoiceAction.Unknown(raw)
    }
}
