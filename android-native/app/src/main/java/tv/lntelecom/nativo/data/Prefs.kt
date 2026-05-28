package tv.lntelecom.nativo.data

import android.content.Context
import android.content.SharedPreferences

class Prefs(ctx: Context) {
    private val sp: SharedPreferences = ctx.getSharedPreferences("lntv_nativo", Context.MODE_PRIVATE)

    var accessToken: String?
        get() = sp.getString(K_ACCESS, null)
        set(v) = sp.edit().putString(K_ACCESS, v).apply()

    var refreshToken: String?
        get() = sp.getString(K_REFRESH, null)
        set(v) = sp.edit().putString(K_REFRESH, v).apply()

    var userId: String?
        get() = sp.getString(K_UID, null)
        set(v) = sp.edit().putString(K_UID, v).apply()

    var expiresAt: Long
        get() = sp.getLong(K_EXP, 0L)
        set(v) = sp.edit().putLong(K_EXP, v).apply()

    fun clearSession() {
        sp.edit().remove(K_ACCESS).remove(K_REFRESH).remove(K_UID).remove(K_EXP).apply()
    }

    companion object {
        private const val K_ACCESS = "access_token"
        private const val K_REFRESH = "refresh_token"
        private const val K_UID = "user_id"
        private const val K_EXP = "expires_at"
    }
}
