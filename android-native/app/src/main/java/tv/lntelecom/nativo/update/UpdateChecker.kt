package tv.lntelecom.nativo.update

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import tv.lntelecom.nativo.App

/**
 * Auto-update do APK Nativo.
 * Lê /version.json (mesmo endpoint do web/Capacitor) — mas SÓ atualiza
 * se a key `nativoVersionCode` estiver presente, pra evitar instalar
 * APK Capacitor por engano.
 *
 * Se quiser ativar updates do nativo, o script sync-lntv-apk.sh precisa
 * publicar também `nativoVersionCode` + `nativoUrl` no version.json.
 */
class UpdateChecker(private val ctx: Context, private val http: OkHttpClient) {

    data class Update(val versionCode: Int, val versionName: String, val url: String)

    fun check(currentVersionCode: Int): Update? {
        return try {
            val req = Request.Builder().url("${App.BACKEND}/version.json").get().build()
            http.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return null
                val obj = JSONObject(res.body?.string() ?: return null)
                val vc = obj.optInt("nativoVersionCode", -1)
                val vn = obj.optString("nativoVersionName", "")
                val url = obj.optString("nativoUrl", "")
                if (vc > currentVersionCode && url.isNotEmpty()) Update(vc, vn, url) else null
            }
        } catch (_: Exception) { null }
    }

    fun download(update: Update): File? {
        return try {
            val dir = File(ctx.getExternalFilesDir(null), "updates").apply { mkdirs() }
            val out = File(dir, "lntv-nativo-${update.versionCode}.apk")
            val req = Request.Builder().url(update.url).get().build()
            http.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return null
                FileOutputStream(out).use { fos ->
                    res.body?.byteStream()?.copyTo(fos)
                }
            }
            out
        } catch (_: Exception) { null }
    }
}
