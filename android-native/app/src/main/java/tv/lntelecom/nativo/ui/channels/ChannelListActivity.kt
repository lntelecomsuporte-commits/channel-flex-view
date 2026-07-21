package tv.lntelecom.nativo.ui.channels

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.lntelecom.nativo.App
import tv.lntelecom.nativo.data.ChannelStore
import tv.lntelecom.nativo.data.ChannelsRepository
import tv.lntelecom.nativo.data.Prefs
import tv.lntelecom.nativo.data.SupabaseClient
import tv.lntelecom.nativo.databinding.ActivityChannelsBinding
import tv.lntelecom.nativo.ui.player.PlayerActivity
import tv.lntelecom.nativo.util.ShutdownHelper
import android.view.KeyEvent

/**
 * Tela de entrada: carrega os canais e entrega tudo pro PlayerActivity,
 * que mostra a lista como overlay mantendo o vídeo rodando. Não exibe a
 * lista aqui — só um spinner enquanto carrega.
 */
class ChannelListActivity : AppCompatActivity() {

    private lateinit var b: ActivityChannelsBinding
    private lateinit var repo: ChannelsRepository
    private var shutdown: ShutdownHelper? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityChannelsBinding.inflate(layoutInflater)
        setContentView(b.root)
        shutdown = ShutdownHelper.install(this)
        b.title.text = "Carregando canais…"
        b.recycler.visibility = View.GONE
        b.progress.visibility = View.VISIBLE

        val app = application as App
        val prefs = Prefs(this)
        val sb = SupabaseClient(app.http, App.BACKEND, App.ANON_KEY, prefs)
        repo = ChannelsRepository(sb)

        loadAndLaunch()
    }

    private fun loadAndLaunch() {
        lifecycleScope.launch {
            val list = withContext(Dispatchers.IO) {
                try { repo.loadChannels() } catch (_: Exception) { emptyList() }
            }.sortedBy { it.channelNumber }

            if (list.isEmpty()) {
                b.progress.visibility = View.GONE
                b.emptyMsg.visibility = View.VISIBLE
                b.title.text = "Nenhum canal disponível"
                return@launch
            }

            ChannelStore.channels = list
            startActivity(Intent(this@ChannelListActivity, PlayerActivity::class.java).apply {
                putExtra("startIndex", 0)
            })
            finish()
            overridePendingTransition(0, 0)
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (shutdown?.handleKeyDown(keyCode) == true) return true
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        shutdown?.unregister()
        super.onDestroy()
    }
}
