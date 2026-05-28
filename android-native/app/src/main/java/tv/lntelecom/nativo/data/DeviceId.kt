package tv.lntelecom.nativo.data

import android.annotation.SuppressLint
import android.content.Context
import android.provider.Settings

object DeviceId {
    /**
     * ANDROID_ID estável por aparelho/usuário, normalizado em UPPERCASE alfanumérico.
     * Mesmo formato esperado pelas edge functions device-login / device-announce.
     */
    @SuppressLint("HardwareIds")
    fun get(ctx: Context): String {
        val raw = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID).orEmpty()
        return raw.replace(Regex("[^a-zA-Z0-9]"), "").uppercase()
    }

    /** Formata em blocos de 4 caracteres separados por hífen: A1B2-C3D4-E5F6-G7H8 */
    fun formatCode(deviceId: String, maxBlocks: Int = 4): String {
        val clean = deviceId.replace(Regex("[^a-zA-Z0-9]"), "").uppercase()
        val slice = clean.take(maxBlocks * 4)
        return slice.chunked(4).joinToString("-")
    }
}
