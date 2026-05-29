package tv.lntelecom.nativo.ui.player

import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
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
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
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
import tv.lntelecom.nativo.ui.login.LoginActivity
import tv.lntelecom.nativo.update.UpdateChecker
import tv.lntelecom.nativo.update.UpdateInstallActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class PlayerActivity : AppCompatActivity() {

    private lateinit var b: ActivityPlayerBinding
    private var player: ExoPlayer? = null
    private lateinit var sb: SupabaseClient
    private lateinit var prefs: Prefs
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

    // Settings menu
    private var menuFocus = 0
    private val menuItems = listOf(
        "🔑 Trocar senha de login" to "change-password",
        "ℹ️ Sobre o aplicativo" to "about",
        "🚪 Sair da conta" to "logout",
    )

    // Stats overlay live updater
    private val statsHandler = Handler(Looper.getMainLooper())
    private val statsTick = object : Runnable {
        override fun run() {
            if (b.statsOverlay.visibility == View.VISIBLE) {
                renderStats()
                statsHandler.postDelayed(this, 1000)
            }
        }
    }

    // Konami sequence: RIGHT x3, LEFT x2, RIGHT, OK
    private val konamiPattern = listOf(
        KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_DPAD_RIGHT,
        KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_LEFT,
        KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_DPAD_CENTER,
    )
    private val konamiBuffer = ArrayDeque<Int>()
    private var konamiLastTs = 0L
    private val konamiWindow = 4000L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        b = ActivityPlayerBinding.inflate(layoutInflater)
        setContentView(b.root)
        hideSystemUI()

        val app = application as App
        prefs = Prefs(this)
        sb = SupabaseClient(app.http, App.BACKEND, App.ANON_KEY, prefs)
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
        // Stats overlay: qualquer tecla relevante fecha
        if (b.statsOverlay.visibility == View.VISIBLE) {
            return when (keyCode) {
                KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_DPAD_CENTER,
                KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_MENU -> { hideStats(); true }
                else -> true
            }
        }
        // Menu overlay tem prioridade
        if (b.menuOverlay.visibility == View.VISIBLE) {
            return handleMenuKey(keyCode)
        }
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
        // Konami: registra tecla antes de processar
        trackKonami(keyCode)
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_BUTTON_START) {
            showMenu(); return true
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

    // ====== Konami: D D D E E D OK ======
    private fun trackKonami(keyCode: Int) {
        val now = System.currentTimeMillis()
        if (now - konamiLastTs > konamiWindow) konamiBuffer.clear()
        konamiLastTs = now
        konamiBuffer.addLast(keyCode)
        while (konamiBuffer.size > konamiPattern.size) konamiBuffer.removeFirst()
        if (konamiBuffer.size == konamiPattern.size &&
            konamiBuffer.toList() == konamiPattern) {
            konamiBuffer.clear()
            showStats()
        }
    }

    // ====== Menu ======
    private fun showMenu() {
        cancelPending()
        osdHandler.removeCallbacks(hideOsd)
        b.osd.visibility = View.GONE
        b.menuUserInfo.text = prefs.userId?.let { "ID: ${it.take(8)}…" } ?: ""
        menuFocus = 0
        renderMenu()
        b.menuOverlay.visibility = View.VISIBLE
        b.menuOverlay.requestFocus()
    }

    private fun hideMenu() { b.menuOverlay.visibility = View.GONE }

    private fun renderMenu() {
        val container = b.menuItems
        container.removeAllViews()
        menuItems.forEachIndexed { i, (label, _) ->
            val tv = TextView(this).apply {
                text = label
                textSize = 18f
                setPadding(28, 20, 28, 20)
                setTextColor(getColor(R.color.fg))
                setBackgroundColor(
                    if (i == menuFocus) 0xFFDC2626.toInt() else 0x33FFFFFF
                )
            }
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = 8 }
            container.addView(tv, lp)
        }
    }

    private fun handleMenuKey(keyCode: Int): Boolean {
        return when (keyCode) {
            KeyEvent.KEYCODE_DPAD_DOWN -> {
                menuFocus = (menuFocus + 1) % menuItems.size; renderMenu(); true
            }
            KeyEvent.KEYCODE_DPAD_UP -> {
                menuFocus = (menuFocus - 1 + menuItems.size) % menuItems.size; renderMenu(); true
            }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
                onMenuSelect(menuItems[menuFocus].second); true
            }
            KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_MENU -> { hideMenu(); true }
            else -> true
        }
    }

    private fun onMenuSelect(id: String) {
        when (id) {
            "logout" -> doLogout()
            "about" -> showAbout()
            "change-password" -> showChangePassword()
        }
    }

    private fun doLogout() {
        sb.signOut()
        startActivity(Intent(this, LoginActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        })
        finish()
    }

    private fun showAbout() {
        AlertDialog.Builder(this)
            .setTitle("Sobre")
            .setMessage(
                "LN TV\nVersão: ${BuildConfig.VERSION_NAME}\n" +
                "Build: ${BuildConfig.VERSION_CODE}\nServidor: ${App.BACKEND}"
            )
            .setPositiveButton("OK", null)
            .show()
    }

    private fun showChangePassword() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            hint = "Nova senha (mín. 6)"
        }
        AlertDialog.Builder(this)
            .setTitle("Trocar senha de login")
            .setView(input)
            .setPositiveButton("Salvar") { _, _ ->
                val pwd = input.text.toString()
                if (pwd.length < 6) {
                    Toast.makeText(this, "Senha precisa ter no mínimo 6 caracteres", Toast.LENGTH_SHORT).show()
                } else updatePassword(pwd)
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun updatePassword(pwd: String) {
        lifecycleScope.launch {
            val ok = withContext(Dispatchers.IO) {
                runCatching {
                    sb.ensureFreshSession()
                    val tok = prefs.accessToken ?: return@runCatching false
                    val body = JSONObject().put("password", pwd).toString()
                        .toRequestBody("application/json".toMediaType())
                    val req = Request.Builder()
                        .url("${sb.authUrl}/user")
                        .header("apikey", App.ANON_KEY)
                        .header("Authorization", "Bearer $tok")
                        .header("Content-Type", "application/json")
                        .put(body).build()
                    (application as App).http.newCall(req).execute().use { it.isSuccessful }
                }.getOrDefault(false)
            }
            Toast.makeText(
                this@PlayerActivity,
                if (ok) "Senha atualizada!" else "Falha ao atualizar senha",
                Toast.LENGTH_SHORT
            ).show()
            if (ok) hideMenu()
        }
    }

    // ====== Stats overlay ======
    private fun showStats() {
        renderStats()
        b.statsOverlay.visibility = View.VISIBLE
        statsHandler.removeCallbacks(statsTick)
        statsHandler.postDelayed(statsTick, 1000)
    }

    private fun hideStats() {
        b.statsOverlay.visibility = View.GONE
        statsHandler.removeCallbacks(statsTick)
    }

    private fun renderStats() {
        val p = player ?: return
        val c = channels.getOrNull(index)
        val fmt = p.videoFormat
        val res = if (fmt != null && fmt.width > 0) "${fmt.width}x${fmt.height} (${fmt.height}p)" else "—"
        val fps = if (fmt?.frameRate != null && fmt.frameRate > 0) "${fmt.frameRate.toInt()}" else "—"
        val codec = fmt?.sampleMimeType ?: fmt?.codecs ?: "—"
        val bitrate = fmt?.bitrate?.takeIf { it > 0 }?.let { "${it / 1000} kbps" } ?: "—"
        val bufferAhead = ((p.totalBufferedDuration) / 1000.0).let { "%.1fs".format(it) }
        val state = when (p.playbackState) {
            Player.STATE_IDLE -> "IDLE"
            Player.STATE_BUFFERING -> "BUFFERING"
            Player.STATE_READY -> "READY"
            Player.STATE_ENDED -> "ENDED"
            else -> "—"
        }
        val host = runCatching { java.net.URI(c?.streamUrl ?: "").host ?: "—" }.getOrDefault("—")
        b.statsBody.text = """
            Canal       : ${c?.channelNumber ?: "—"} ${c?.name ?: ""}
            Resolução  : $res
            FPS         : $fps
            Bitrate     : $bitrate
            Codec       : $codec
            Buffer      : $bufferAhead
            Estado      : $state
            Tipo        : ${c?.streamType ?: "—"}
            Host        : $host
            App         : ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})
        """.trimIndent()
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
