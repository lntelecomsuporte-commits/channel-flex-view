package tv.lntelecom.nativo.ui.player

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.recyclerview.widget.LinearLayoutManager
import coil.load
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.lntelecom.nativo.App
import tv.lntelecom.nativo.BuildConfig
import tv.lntelecom.nativo.R
import tv.lntelecom.nativo.data.ChannelStore
import tv.lntelecom.nativo.data.EpgRepository
import tv.lntelecom.nativo.data.FavoritesRepository
import tv.lntelecom.nativo.data.Prefs
import tv.lntelecom.nativo.data.StreamUrl
import tv.lntelecom.nativo.data.SupabaseClient
import tv.lntelecom.nativo.data.model.Channel
import tv.lntelecom.nativo.databinding.ActivityPlayerBinding
import tv.lntelecom.nativo.ui.channels.ChannelAdapter
import tv.lntelecom.nativo.update.UpdateChecker
import tv.lntelecom.nativo.update.UpdateInstallActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class PlayerActivity : AppCompatActivity() {

    private lateinit var b: ActivityPlayerBinding
    private var player: ExoPlayer? = null
    private lateinit var epg: EpgRepository
    private lateinit var favorites: FavoritesRepository
    private lateinit var updater: UpdateChecker
    private lateinit var listAdapter: ChannelAdapter

    private var channels: List<Channel> = emptyList()
    private var index = 0
    private var pendingIndex = -1
    private var retries = 0
    private val maxRetries = 6

    private val timeFmt = SimpleDateFormat("HH:mm", Locale.getDefault())

    private val osdHandler = Handler(Looper.getMainLooper())
    private val hideOsd = Runnable { b.osd.visibility = View.GONE }

    private val stallHandler = Handler(Looper.getMainLooper())
    private val stallCheck = Runnable { checkStall() }

    private val previewHandler = Handler(Looper.getMainLooper())
    private val tunePending = Runnable { commitPending() }
    private val previewDelay = 1500L

    // Double-OK detection
    private var lastOkTime = 0L
    private val doubleTapWindow = 400L

    // Triple-BACK detection (only when overlay hidden)
    private var backTimes = ArrayDeque<Long>()
    private val backWindow = 1800L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        b = ActivityPlayerBinding.inflate(layoutInflater)
        setContentView(b.root)
        hideSystemUI()

        val app = application as App
        val prefs = Prefs(this)
        val sb = SupabaseClient(app.http, App.BACKEND, App.ANON_KEY, prefs)
        epg = EpgRepository(app.http)
        favorites = FavoritesRepository(sb, prefs)
        updater = UpdateChecker(this, app.http)

        channels = ChannelStore.channels
        if (channels.isEmpty()) { finish(); return }

        index = intent.getIntExtra("startIndex", 0).coerceIn(0, channels.size - 1)

        initPlayer()
        setupListOverlay()
        loadCurrent()

        lifecycleScope.launch {
            withContext(Dispatchers.IO) {
                epg.ensureLoaded()
                runCatching { favorites.load() }
            }
            refreshOsdEpg()
            listAdapter.notifyDataSetChanged()
        }

        checkUpdate()
    }

    private fun setupListOverlay() {
        listAdapter = ChannelAdapter(epg = epg) { c ->
            val idx = channels.indexOfFirst { it.id == c.id }
            if (idx >= 0) {
                index = idx
                hideListOverlay()
                loadCurrent()
            }
        }
        b.listRecycler.layoutManager = LinearLayoutManager(this)
        b.listRecycler.adapter = listAdapter
        listAdapter.submit(channels)
        b.listTitle.text = "Canais — ${channels.size}"
    }

    private fun showListOverlay() {
        b.listOverlay.visibility = View.VISIBLE
        b.listRecycler.post {
            b.listRecycler.scrollToPosition(index.coerceAtLeast(0))
            b.listRecycler.requestFocus()
        }
    }

    private fun hideListOverlay() {
        b.listOverlay.visibility = View.GONE
    }

    private val isListOpen: Boolean get() = b.listOverlay.visibility == View.VISIBLE

    private fun initPlayer() {
        val p = ExoPlayer.Builder(this).build()
        p.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                b.buffering.visibility =
                    if (state == Player.STATE_BUFFERING) View.VISIBLE else View.GONE
                if (state == Player.STATE_READY) retries = 0
                if (state == Player.STATE_ENDED) attemptRetry("ended")
                stallHandler.removeCallbacks(stallCheck)
                if (state == Player.STATE_BUFFERING) {
                    stallHandler.postDelayed(stallCheck, 8000)
                }
            }
            override fun onPlayerError(error: PlaybackException) { attemptRetry("error") }
        })
        b.playerView.player = p
        player = p
    }

    private fun loadCurrent() {
        val p = player ?: return
        val c = channels.getOrNull(index) ?: return
        val resolved = StreamUrl.resolve(c.streamUrl, c.streamType)
        val ib = MediaItem.Builder().setUri(resolved)
        if (c.streamType == "hls") ib.setMimeType(MimeTypes.APPLICATION_M3U8)
        p.setMediaItem(ib.build())
        p.prepare()
        p.playWhenReady = true
        retries = 0
        showOsd(index)
    }

    private fun attemptRetry(reason: String) {
        if (retries >= maxRetries) return
        retries++
        val delay = (1000L * (1 shl (retries - 1))).coerceAtMost(8000L)
        b.playerView.postDelayed({
            val p = player ?: return@postDelayed
            val c = channels.getOrNull(index) ?: return@postDelayed
            val resolved = StreamUrl.resolve(c.streamUrl, c.streamType)
            val ib = MediaItem.Builder().setUri(resolved)
            if (c.streamType == "hls") ib.setMimeType(MimeTypes.APPLICATION_M3U8)
            p.setMediaItem(ib.build())
            p.prepare()
            p.playWhenReady = true
        }, delay)
    }

    private fun checkStall() {
        val p = player ?: return
        if (p.playbackState == Player.STATE_BUFFERING) attemptRetry("stall")
    }

    /** Troca imediata (UP/DOWN/CH_UP/CH_DOWN). */
    private fun changeChannel(delta: Int) {
        if (channels.isEmpty()) return
        cancelPending()
        index = ((index + delta) % channels.size + channels.size) % channels.size
        loadCurrent()
    }

    /** Preview com LEFT/RIGHT: só atualiza OSD, sintoniza após delay. */
    private fun previewChannel(delta: Int) {
        if (channels.isEmpty()) return
        val base = if (pendingIndex >= 0) pendingIndex else index
        pendingIndex = ((base + delta) % channels.size + channels.size) % channels.size
        showOsd(pendingIndex)
        previewHandler.removeCallbacks(tunePending)
        previewHandler.postDelayed(tunePending, previewDelay)
    }

    private fun commitPending() {
        if (pendingIndex < 0 || pendingIndex == index) { pendingIndex = -1; return }
        index = pendingIndex
        pendingIndex = -1
        loadCurrent()
    }

    private fun cancelPending() {
        previewHandler.removeCallbacks(tunePending)
        pendingIndex = -1
    }

    private fun showOsd(showIndex: Int) {
        val c = channels.getOrNull(showIndex) ?: return
        b.osdNumber.text = c.channelNumber.toString()
        b.osdName.text = c.name
        b.osdEpg.text = ""
        val logo = StreamUrl.resolveLogo(c.logoUrl, c.logoSourceUrl)
        if (logo != null) b.osdLogo.load(logo) { crossfade(false) }
        else b.osdLogo.setImageResource(R.mipmap.ic_launcher)
        b.osd.visibility = View.VISIBLE
        osdHandler.removeCallbacks(hideOsd)
        osdHandler.postDelayed(hideOsd, 4000)
        refreshOsdEpgFor(showIndex)
    }

    private fun refreshOsdEpg() = refreshOsdEpgFor(if (pendingIndex >= 0) pendingIndex else index)

    private fun refreshOsdEpgFor(i: Int) {
        val epgId = channels.getOrNull(i)?.epgChannelId?.takeIf { it.isNotEmpty() } ?: return
        val now = epg.currentProgram(epgId) ?: return
        val nxt = epg.nextProgram(epgId)
        val nowLine = "${timeFmt.format(Date(now.startMs))}  ${now.title}"
        b.osdEpg.text = if (nxt != null)
            "$nowLine\n${timeFmt.format(Date(nxt.startMs))}  ${nxt.title}"
        else nowLine
    }

    private fun toggleFavorite() {
        val cid = channels.getOrNull(index)?.id ?: return
        lifecycleScope.launch {
            val nowFav = withContext(Dispatchers.IO) { favorites.toggle(cid) }
            Toast.makeText(
                this@PlayerActivity,
                if (nowFav) "Favorito adicionado" else "Favorito removido",
                Toast.LENGTH_SHORT
            ).show()
        }
    }

    private fun handleOkPress(): Boolean {
        // Se tem preview pendente, OK confirma imediatamente.
        if (pendingIndex >= 0) {
            previewHandler.removeCallbacks(tunePending)
            commitPending()
            return true
        }
        val now = System.currentTimeMillis()
        if (now - lastOkTime <= doubleTapWindow) {
            lastOkTime = 0L
            showListOverlay()
        } else {
            lastOkTime = now
            showOsd(index)
        }
        return true
    }

    private fun handleBackPress(): Boolean {
        val now = System.currentTimeMillis()
        backTimes.addLast(now)
        while (backTimes.isNotEmpty() && now - backTimes.first() > backWindow) backTimes.removeFirst()
        if (backTimes.size >= 3) {
            backTimes.clear()
            finishAffinity()
            return true
        }
        // 1 ou 2 toques: ignora (não fecha o player sozinho)
        return true
    }

    private fun pageScrollList(direction: Int) {
        val lm = b.listRecycler.layoutManager as? LinearLayoutManager ?: return
        val first = lm.findFirstVisibleItemPosition()
        val last = lm.findLastVisibleItemPosition()
        val pageSize = (last - first).coerceAtLeast(1)
        val total = listAdapter.itemCount
        if (total == 0) return
        val target = if (direction > 0) (last + pageSize).coerceAtMost(total - 1)
                     else (first - pageSize).coerceAtLeast(0)
        b.listRecycler.smoothScrollToPosition(target)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (isListOpen) {
            return when (keyCode) {
                KeyEvent.KEYCODE_BACK -> { hideListOverlay(); backTimes.clear(); true }
                KeyEvent.KEYCODE_PAGE_UP, KeyEvent.KEYCODE_MEDIA_REWIND ->
                    { pageScrollList(-1); true }
                KeyEvent.KEYCODE_PAGE_DOWN, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD ->
                    { pageScrollList(1); true }
                KeyEvent.KEYCODE_DPAD_LEFT -> { pageScrollList(-1); true }
                KeyEvent.KEYCODE_DPAD_RIGHT -> { pageScrollList(1); true }
                else -> super.onKeyDown(keyCode, event)
            }
        }
        return when (keyCode) {
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_CHANNEL_UP -> { changeChannel(1); true }
            KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_CHANNEL_DOWN -> { changeChannel(-1); true }
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_NEXT,
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { previewChannel(1); true }
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_PREVIOUS,
            KeyEvent.KEYCODE_MEDIA_REWIND -> { previewChannel(-1); true }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> handleOkPress()
            KeyEvent.KEYCODE_STAR, KeyEvent.KEYCODE_BOOKMARK,
            KeyEvent.KEYCODE_BUTTON_Y -> { toggleFavorite(); true }
            KeyEvent.KEYCODE_BACK -> handleBackPress()
            else -> super.onKeyDown(keyCode, event)
        }
    }

    private fun checkUpdate() {
        lifecycleScope.launch {
            val current = BuildConfig.VERSION_CODE
            val update = withContext(Dispatchers.IO) { updater.check(current) } ?: return@launch
            Toast.makeText(
                this@PlayerActivity,
                "Atualização ${update.versionName} disponível — baixando…",
                Toast.LENGTH_LONG
            ).show()
            val file = withContext(Dispatchers.IO) { updater.download(update) } ?: return@launch
            startActivity(Intent(this@PlayerActivity, UpdateInstallActivity::class.java).apply {
                putExtra("apkPath", file.absolutePath)
            })
        }
    }

    private fun hideSystemUI() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        )
    }

    override fun onDestroy() {
        super.onDestroy()
        stallHandler.removeCallbacksAndMessages(null)
        osdHandler.removeCallbacksAndMessages(null)
        previewHandler.removeCallbacksAndMessages(null)
        player?.release()
        player = null
    }
}
