package tv.lntelecom.nativo.ui.channels

import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.lntelecom.nativo.App
import tv.lntelecom.nativo.BuildConfig
import tv.lntelecom.nativo.data.ChannelsRepository
import tv.lntelecom.nativo.data.EpgRepository
import tv.lntelecom.nativo.data.Prefs
import tv.lntelecom.nativo.data.SupabaseClient
import tv.lntelecom.nativo.data.model.Channel
import tv.lntelecom.nativo.databinding.ActivityChannelsBinding
import tv.lntelecom.nativo.ui.player.PlayerActivity
import tv.lntelecom.nativo.update.UpdateChecker
import tv.lntelecom.nativo.update.UpdateInstallActivity

class ChannelListActivity : AppCompatActivity() {

    private lateinit var b: ActivityChannelsBinding
    private lateinit var adapter: ChannelAdapter
    private lateinit var repo: ChannelsRepository
    private lateinit var prefs: Prefs
    private lateinit var updater: UpdateChecker
    private lateinit var epg: EpgRepository

    private var allChannels: List<Channel> = emptyList()
    private var filtered: List<Channel> = emptyList()
    private var selectedCategory: String = ALL_CATS
    private var autoLaunched = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityChannelsBinding.inflate(layoutInflater)
        setContentView(b.root)
        val app = application as App
        prefs = Prefs(this)
        val sb = SupabaseClient(app.http, App.BACKEND, App.ANON_KEY, prefs)
        repo = ChannelsRepository(sb)
        updater = UpdateChecker(this, app.http)
        epg = EpgRepository(app.http)

        adapter = ChannelAdapter(epg = epg) { openPlayer(it) }
        b.recycler.layoutManager = LinearLayoutManager(this)
        b.recycler.adapter = adapter
        b.refresh.setOnRefreshListener { loadChannels() }

        loadChannels()
        checkUpdate()
    }

    private fun loadChannels() {
        b.progress.visibility = if (allChannels.isEmpty()) View.VISIBLE else View.GONE
        b.emptyMsg.visibility = View.GONE
        lifecycleScope.launch {
            val list = withContext(Dispatchers.IO) {
                try { repo.loadChannels() } catch (e: Exception) { emptyList() }
            }
            // EPG em background pra preencher a lista
            launch(Dispatchers.IO) {
                if (epg.ensureLoaded()) {
                    withContext(Dispatchers.Main) { adapter.notifyDataSetChanged() }
                }
            }
            b.progress.visibility = View.GONE
            b.refresh.isRefreshing = false
            allChannels = list.sortedBy { it.channelNumber }
            applyFilter()

            // Auto-abre player no canal de menor número (igual ao Roku)
            if (!autoLaunched && allChannels.isNotEmpty()) {
                autoLaunched = true
                openPlayer(allChannels.first())
            }
        }
    }

    private fun applyFilter() {
        filtered = if (selectedCategory == ALL_CATS) allChannels
        else allChannels.filter { (it.categoryName ?: "") == selectedCategory }
        adapter.submit(filtered)
        b.emptyMsg.visibility = if (filtered.isEmpty()) View.VISIBLE else View.GONE
        val cats = listOf(ALL_CATS) + allChannels.mapNotNull { it.categoryName }.distinct()
        b.title.text = "Canais — ${filtered.size} • $selectedCategory"
        b.title.tag = cats
    }

    private fun cycleCategory() {
        @Suppress("UNCHECKED_CAST")
        val cats = b.title.tag as? List<String> ?: return
        if (cats.isEmpty()) return
        val idx = cats.indexOf(selectedCategory).let { if (it < 0) 0 else it }
        selectedCategory = cats[(idx + 1) % cats.size]
        applyFilter()
    }

    private fun pageScroll(direction: Int) {
        val lm = b.recycler.layoutManager as? LinearLayoutManager ?: return
        val first = lm.findFirstVisibleItemPosition()
        val last = lm.findLastVisibleItemPosition()
        val pageSize = (last - first).coerceAtLeast(1)
        val total = adapter.itemCount
        if (total == 0) return
        val target = if (direction > 0) (last + pageSize).coerceAtMost(total - 1)
                     else (first - pageSize).coerceAtLeast(0)
        b.recycler.smoothScrollToPosition(target)
    }

    private fun checkUpdate() {
        lifecycleScope.launch {
            val current = BuildConfig.VERSION_CODE
            val update = withContext(Dispatchers.IO) { updater.check(current) } ?: return@launch
            Toast.makeText(
                this@ChannelListActivity,
                "Atualização ${update.versionName} disponível — baixando…",
                Toast.LENGTH_LONG
            ).show()
            val file = withContext(Dispatchers.IO) { updater.download(update) } ?: return@launch
            startActivity(Intent(this@ChannelListActivity, UpdateInstallActivity::class.java).apply {
                putExtra("apkPath", file.absolutePath)
            })
        }
    }

    private fun openPlayer(c: Channel) {
        val list = if (filtered.isNotEmpty()) filtered else allChannels
        val idx = list.indexOf(c).coerceAtLeast(0)
        val ids = list.map { it.id }.toTypedArray()
        val numbers = list.map { it.channelNumber }.toIntArray()
        val urls = list.map { it.streamUrl }.toTypedArray()
        val types = list.map { it.streamType }.toTypedArray()
        val names = list.map { it.name }.toTypedArray()
        val logos = list.map { it.logoUrl ?: "" }.toTypedArray()
        val logoSources = list.map { it.logoSourceUrl ?: "" }.toTypedArray()
        val epgIds = list.map { it.epgChannelId ?: "" }.toTypedArray()

        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra("startIndex", idx)
            putExtra("ids", ids)
            putExtra("numbers", numbers)
            putExtra("urls", urls)
            putExtra("types", types)
            putExtra("names", names)
            putExtra("logos", logos)
            putExtra("logoSources", logoSources)
            putExtra("epgIds", epgIds)
        })
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        return when (keyCode) {
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_PAGE_UP,
            KeyEvent.KEYCODE_MEDIA_REWIND -> { pageScroll(-1); true }
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_PAGE_DOWN,
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { pageScroll(1); true }
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_GUIDE -> { cycleCategory(); true }
            KeyEvent.KEYCODE_BACK -> { finishAffinity(); true }
            else -> super.onKeyDown(keyCode, event)
        }
    }

    companion object { private const val ALL_CATS = "Todas" }
}
