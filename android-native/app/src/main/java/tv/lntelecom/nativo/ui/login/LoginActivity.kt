package tv.lntelecom.nativo.ui.login

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.lntelecom.nativo.App
import tv.lntelecom.nativo.data.Prefs
import tv.lntelecom.nativo.data.SupabaseClient
import tv.lntelecom.nativo.databinding.ActivityLoginBinding
import tv.lntelecom.nativo.ui.channels.ChannelListActivity

class LoginActivity : AppCompatActivity() {

    private lateinit var b: ActivityLoginBinding
    private lateinit var sb: SupabaseClient
    private lateinit var prefs: Prefs

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(b.root)
        val app = application as App
        prefs = Prefs(this)
        sb = SupabaseClient(app.http, App.BACKEND, App.ANON_KEY, prefs)

        b.deviceInfo.text = "${Build.MANUFACTURER} ${Build.MODEL}"

        // Auto-login se já tem sessão válida
        if (prefs.accessToken != null) {
            goToChannels()
            return
        }

        b.btnLogin.setOnClickListener { doLogin() }
        b.inputPassword.setOnEditorActionListener { _, _, _ -> doLogin(); true }
    }

    private fun doLogin() {
        val email = b.inputEmail.text.toString().trim()
        val pass = b.inputPassword.text.toString()
        if (email.isEmpty() || pass.isEmpty()) return
        setLoading(true)
        b.errorMsg.visibility = View.GONE

        lifecycleScope.launch {
            val ok = withContext(Dispatchers.IO) {
                try { sb.signInPassword(email, pass) } catch (e: Exception) { false }
            }
            setLoading(false)
            if (ok) goToChannels()
            else {
                b.errorMsg.setText(tv.lntelecom.nativo.R.string.login_error)
                b.errorMsg.visibility = View.VISIBLE
            }
        }
    }

    private fun setLoading(loading: Boolean) {
        b.progress.visibility = if (loading) View.VISIBLE else View.GONE
        b.btnLogin.isEnabled = !loading
    }

    private fun goToChannels() {
        startActivity(Intent(this, ChannelListActivity::class.java))
        finish()
    }
}
