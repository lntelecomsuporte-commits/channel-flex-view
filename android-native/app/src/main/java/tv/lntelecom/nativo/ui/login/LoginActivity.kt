package tv.lntelecom.nativo.ui.login

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.lntelecom.nativo.App
import tv.lntelecom.nativo.BuildConfig
import tv.lntelecom.nativo.data.DeviceId
import tv.lntelecom.nativo.data.Prefs
import tv.lntelecom.nativo.data.SupabaseClient
import tv.lntelecom.nativo.databinding.ActivityLoginBinding
import tv.lntelecom.nativo.ui.channels.ChannelListActivity

class LoginActivity : AppCompatActivity() {

    private lateinit var b: ActivityLoginBinding
    private lateinit var sb: SupabaseClient
    private lateinit var prefs: Prefs
    private lateinit var deviceId: String
    private lateinit var deviceName: String
    private val appVersion: String by lazy { "nativo-${BuildConfig.VERSION_NAME}" }

    private val beaconHandler = Handler(Looper.getMainLooper())
    private val beaconRunnable: Runnable = object : Runnable {
        override fun run() {
            val self = this
            lifecycleScope.launch {
                val registered = withContext(Dispatchers.IO) {
                    try { sb.deviceAnnounce(deviceId, deviceName, appVersion) } catch (_: Exception) { false }
                }
                if (registered) {
                    val ok = withContext(Dispatchers.IO) {
                        try { sb.deviceAutoLogin(deviceId, deviceName, appVersion) } catch (_: Exception) { false }
                    }
                    if (ok) { goToChannels(); return@launch }
                }
                beaconHandler.postDelayed(self, 10_000L)
            }
        }
    }


    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(b.root)
        val app = application as App
        prefs = Prefs(this)
        sb = SupabaseClient(app.http, App.BACKEND, App.ANON_KEY, prefs)

        deviceId = DeviceId.get(this).ifEmpty { "ANDROID${System.currentTimeMillis()}" }
        deviceName = "${Build.MANUFACTURER} ${Build.MODEL}"

        b.deviceInfo.text = deviceName
        b.deviceCode.text = DeviceId.formatCode(deviceId)

        // Auto-login se já tem sessão válida
        if (prefs.accessToken != null) {
            goToChannels()
            return
        }

        b.btnLogin.setOnClickListener { doLogin() }
        b.inputPassword.setOnEditorActionListener { _, _, _ -> doLogin(); true }

        // Tenta auto-login (caso admin já tenha vinculado esse aparelho)
        lifecycleScope.launch {
            val ok = withContext(Dispatchers.IO) {
                try { sb.deviceAutoLogin(deviceId, deviceName, appVersion) } catch (_: Exception) { false }
            }
            if (ok) goToChannels() else startBeacon()
        }
    }

    private fun startBeacon() {
        beaconHandler.removeCallbacks(beaconRunnable)
        beaconHandler.postDelayed(beaconRunnable, 3_000L)
    }

    override fun onDestroy() {
        beaconHandler.removeCallbacks(beaconRunnable)
        super.onDestroy()
    }

    private fun doLogin() {
        val email = b.inputEmail.text.toString().trim()
        val pass = b.inputPassword.text.toString()
        if (email.isEmpty() || pass.isEmpty()) return
        setLoading(true)
        b.errorMsg.visibility = View.GONE

        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                try { sb.deviceLogin(email, pass, deviceId, deviceName, appVersion) }
                catch (e: Exception) { false to (e.message ?: "Erro de rede") }
            }
            setLoading(false)
            if (result.first) {
                goToChannels()
            } else {
                b.errorMsg.text = result.second ?: getString(tv.lntelecom.nativo.R.string.login_error)
                b.errorMsg.visibility = View.VISIBLE
            }
        }
    }

    private fun setLoading(loading: Boolean) {
        b.progress.visibility = if (loading) View.VISIBLE else View.GONE
        b.btnLogin.isEnabled = !loading
    }

    private fun goToChannels() {
        beaconHandler.removeCallbacks(beaconRunnable)
        startActivity(Intent(this, ChannelListActivity::class.java))
        finish()
    }
}
