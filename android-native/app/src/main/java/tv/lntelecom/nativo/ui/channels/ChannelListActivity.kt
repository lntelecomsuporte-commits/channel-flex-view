package tv.lntelecom.nativo.ui.channels

import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.lntelecom.nativo.App
import tv.lntelecom.nativo.data.ChannelsRepository
import tv.lntelecom.nativo.data.Prefs
import tv.lntelecom.nativo.data.SupabaseClient
import tv.lntelecom.nativo.data.model.Channel
import tv.lntelecom.nativo.databinding.ActivityChannelsBinding
import tv.lntelecom.nativo.ui.login.LoginActivity
import tv.lntelecom.nativo.ui.player.PlayerActivity

class ChannelListActivity : AppCompatActivity() {

    private lateinit var b: ActivityChannelsBinding
    private lateinit var adapter: ChannelAdapter
    private lateinit var repo: ChannelsRepository
    private lateinit var prefs: Prefs
    private var channels: List<Channel> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityChannelsBinding.inflate(layoutInflater)
        setContentView(b.root)
        val app = application as App
        prefs = Prefs(this)
        val sb = SupabaseClient(app.http, App.BACKEND, App.ANON_KEY, prefs)
        repo = ChannelsRepository(sb)

        adapter = ChannelAdapter { openPlayer(it) }
        b.recycler.layoutManager = LinearLayoutManager(this)
        b.recycler.adapter = adapter
        b.refresh.setOnRefreshListener { loadChannels() }

        loadChannels()
    }

    private fun loadChannels() {
        b.progress.visibility = if (channels.isEmpty()) View.VISIBLE else View.GONE
        b.emptyMsg.visibility = View.GONE
        lifecycleScope.launch {
            val list = withContext(Dispatchers.IO) {
                try { repo.loadChannels() } catch (e: Exception) { emptyList() }
            }
            b.progress.visibility = View.GONE
            b.refresh.isRefreshing = false
            channels = list
            adapter.submit(list)
            b.emptyMsg.visibility = if (list.isEmpty()) View.VISIBLE else View.GONE
        }
    }

    private fun openPlayer(c: Channel) {
        val idx = channels.indexOf(c).coerceAtLeast(0)
        val ids = channels.map { it.id }.toTypedArray()
        val numbers = channels.map { it.channelNumber }.toIntArray()
        val urls = channels.map { it.streamUrl }.toTypedArray()
        val types = channels.map { it.streamType }.toTypedArray()
        val names = channels.map { it.name }.toTypedArray()
        val logos = channels.map { it.logoUrl ?: "" }.toTypedArray()

        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra("startIndex", idx)
            putExtra("ids", ids)
            putExtra("numbers", numbers)
            putExtra("urls", urls)
            putExtra("types", types)
            putExtra("names", names)
            putExtra("logos", logos)
        })
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            // Voltar na lista pede confirmação simples: encerra
            finishAffinity()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
}
