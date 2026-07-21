package tv.lntelecom.nativo.ui.player

import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
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
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackGroup
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi

import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.mediacodec.MediaCodecInfo as ExoMediaCodecInfo
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
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

@UnstableApi
class PlayerActivity : AppCompatActivity() {

    private lateinit var b: ActivityPlayerBinding
    private var player: ExoPlayer? = null
    private lateinit var sb: SupabaseClient
    private lateinit var prefs: Prefs
    private lateinit var epg: EpgRepository
    private lateinit var favorites: FavoritesRepository
    private lateinit var updater: UpdateChecker
    private lateinit var listAdapter: ChannelAdapter
    private var heartbeat: tv.lntelecom.nativo.data.HeartbeatManager? = null
    private var voice: tv.lntelecom.nativo.voice.VoiceRecognizer? = null

    private var channels: List<Channel> = emptyList()
    private var index = 0
    private var pendingIndex = -1
    private var retries = 0
    private val maxRetries = 6
    private var playerNeedsReset = false
    // Zap adaptativo: toque isolado sintoniza na hora; rajada (toques dentro de
    // zapBurstWindowMs) só sintoniza o canal final após zapCommitDelayMs de silêncio.
    // Usa event.eventTime (SystemClock.uptimeMillis) — imune a atraso da main thread.
    private var lastZapEventMs = 0L
    private val zapBurstWindowMs = 250L
    private val zapCommitDelayMs = 350L
    private var screenOffReceiver: BroadcastReceiver? = null
    private var shuttingDown = false
    // Enquanto o instalador do sistema estiver aberto, ignoramos sinais de
    // desligamento pra não matar o processo antes do usuário ter chance de
    // confirmar/instalar o APK.
    // Alias local — a fonte da verdade é App.installingUpdate (global, pra
    // todas as Activities honrarem).
    private var installingUpdate: Boolean
        get() = App.installingUpdate
        set(v) { App.installingUpdate = v }
    // Preferência de decoder da instância atual do ExoPlayer. Se o próximo
    // canal exigir preferência diferente, o player é recriado em loadCurrent().
    private var currentPreferSwDecoder = false

    private val timeFmt = SimpleDateFormat("HH:mm", Locale.getDefault())

    private val osdHandler = Handler(Looper.getMainLooper())
    private val hideOsd = Runnable { b.osd.visibility = View.GONE }

    private val stallHandler = Handler(Looper.getMainLooper())
    private val stallCheck = Runnable { checkStall() }

    // Handler dedicado pros retries de erro — permite cancelar callbacks pendentes
    // quando o usuário troca de canal (senão um retry agendado do canal anterior
    // dispara setMediaItem em cima do novo, causando tela preta).
    private val retryHandler = Handler(Looper.getMainLooper())
    private val retryRunnable = Runnable { doRetryNow() }
    // Sonda lenta: após esgotar os retries normais, tenta de novo a cada 30s
    // pra que o canal volte sozinho quando a origem se recuperar.
    private val slowProbeInterval = 30_000L
    private val slowProbe = Runnable { doSlowProbe() }

    private val previewHandler = Handler(Looper.getMainLooper())
    private val tunePending = Runnable { commitPending() }
    private val previewDelay = 1500L
    // Debounce do zap adaptativo (só usado em rajada).
    private val zapPending = Runnable { retries = 0; loadCurrent() }


    // Numeric channel entry (digits typed on the remote)
    private val digitBuffer = StringBuilder()
    private val digitHandler = Handler(Looper.getMainLooper())
    private val digitCommit = Runnable { commitDigitBuffer() }
    private val digitWindow = 2000L
    private val maxDigits = 4

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
        "🔞 Trocar PIN dos canais adultos" to "change-pin",
        "ℹ️ Sobre o aplicativo" to "about",
    )
    private var userFullName: String? = null
    private var userEmailCached: String? = null
    private var currentAdultPin: String = "1234"
    private val retryingProxyChannels = mutableSetOf<String>()

    // Parental PIN gate
    private val unlockedAdult = mutableSetOf<String>()
    private var lastSafeIndex = 0
    private var pinDialogOpen = false

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

        heartbeat = tv.lntelecom.nativo.data.HeartbeatManager(applicationContext, sb).also { it.start() }

        // Carrega PIN parental cedo (não só ao abrir menu) pra que o gate funcione
        fetchUserProfile()


        lifecycleScope.launch {
            withContext(Dispatchers.IO) {
                epg.ensureLoaded()
                runCatching { favorites.load() }
            }
            refreshOsdEpg()
            listAdapter.notifyDataSetChanged()
        }

        checkUpdate()
        registerScreenOffReceiver()
    }

    /**
     * Quando o usuário aperta Power no controle (entra em stand-by) o sistema
     * dispara ACTION_SCREEN_OFF. Encerramos o app pra liberar RAM (mesmo padrão
     * do legacy `MainActivity.java`). ACTION_SCREEN_OFF SÓ funciona com receiver
     * registrado dinamicamente (não no manifest).
     */
    private fun registerScreenOffReceiver() {
        if (screenOffReceiver != null) return
        screenOffReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action == Intent.ACTION_SCREEN_OFF) {
                    if (installingUpdate) return
                    shutdownAndRelease("screen_off")
                }
            }
        }
        registerReceiver(screenOffReceiver, IntentFilter(Intent.ACTION_SCREEN_OFF))
    }

    private fun shutdownAndRelease(reason: String) {
        if (shuttingDown) return
        shuttingDown = true
        android.util.Log.i("LNTV", "Shutting down ($reason)")
        try { heartbeat?.stop() } catch (_: Exception) {}
        try { player?.release() } catch (_: Exception) {}
        player = null
        try { finishAndRemoveTask() } catch (_: Exception) {
            try { finishAffinity() } catch (_: Exception) {}
        }
        Handler(Looper.getMainLooper()).postDelayed({ System.exit(0) }, 150)
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
        initPlayer(currentPreferSwDecoder)
    }

    private fun initPlayer(preferSwDecoder: Boolean) {
        // Buffer mais conservador para TV ao vivo: não força ficar colado no
        // live edge e tenta manter uma folga maior antes de tocar/rebufferizar.
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                30_000,  // mínimo em buffer
                120_000, // máximo em buffer
                3_000,   // antes de iniciar
                8_000,   // depois de travar/rebufferizar
            )
            .build()

        currentPreferSwDecoder = preferSwDecoder
        val renderersFactory = DefaultRenderersFactory(this)
            .setEnableDecoderFallback(true)
            .setMediaCodecSelector(
                if (preferSwDecoder) SOFTWARE_FIRST_SELECTOR else MediaCodecSelector.DEFAULT
            )

        val p = ExoPlayer.Builder(this, renderersFactory)
            .setLoadControl(loadControl)
            .build()
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
            override fun onPlayerError(error: PlaybackException) {
                if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                    android.util.Log.w("LNTV", "BehindLiveWindow — seek pro live e prepare")
                    runCatching {
                        player?.seekToDefaultPosition()
                        player?.prepare()
                    }
                    return
                }
                attemptRetry("error code=${error.errorCode}")
            }
        })
        b.playerView.player = p
        player = p
    }

    private fun rebuildPlayerIfDecoderChanged(preferSwDecoder: Boolean) {
        if (player != null && preferSwDecoder == currentPreferSwDecoder) return
        android.util.Log.i("LNTV",
            "recriando ExoPlayer: preferSwDecoder $currentPreferSwDecoder -> $preferSwDecoder")
        try {
            player?.stop()
            player?.release()
        } catch (_: Exception) {}
        player = null
        initPlayer(preferSwDecoder)
    }

    companion object {
        /**
         * Reordena decoders para colocar decoders de software na frente
         * (OMX.google.*, c2.android.*, .sw., "software"). Contorna bugs do
         * decoder HW H.264 (vídeo verde/faixas em alguns canais 1080i).
         */
        private val SOFTWARE_FIRST_SELECTOR = MediaCodecSelector { mimeType, requiresSecure, requiresTunneling ->
            val list: MutableList<ExoMediaCodecInfo> =
                MediaCodecSelector.DEFAULT.getDecoderInfos(mimeType, requiresSecure, requiresTunneling).toMutableList()
            list.sortWith(Comparator { a, b ->
                java.lang.Boolean.compare(isHardwareDecoder(a.name), isHardwareDecoder(b.name))
            })
            list
        }

        private fun isHardwareDecoder(name: String?): Boolean {
            if (name == null) return true
            val n = name.lowercase(Locale.ROOT)
            return !(n.startsWith("omx.google.")
                    || n.startsWith("c2.android.")
                    || n.contains(".sw.")
                    || n.contains("software"))
        }
    }

    private fun loadCurrent() {
        val c = channels.getOrNull(index) ?: return
        // Se o canal exige preferência de decoder diferente, recria o player
        // (RenderersFactory é fixado na construção). Faz isso ANTES de qualquer
        // uso de `player` no restante da função.
        rebuildPlayerIfDecoderChanged(c.preferSwDecoder)
        val p = player ?: return
        if (maybeRequestPin(c)) return
        lastSafeIndex = index
        // Cancela qualquer callback pendente do canal anterior:
        // - retries agendados (podiam stompar a nova mídia 2-8s depois)
        // - stall-check antigo (podia disparar reset duro no canal novo)
        // - sonda lenta de recuperação (não vale pro canal novo)
        retryHandler.removeCallbacksAndMessages(null)
        stallHandler.removeCallbacks(stallCheck)
        // Reset duro do player só quando necessário:
        // - flag explícita (maxRetries esgotado)
        // - estado de erro fatal
        // - troca durante ciclo de retry em curso (retries > 0)
        // Em canal saudável (retries==0, sem erro) pulamos: setMediaItem
        // já substitui a mídia anterior e mantém o zap rápido (~800ms).
        if (playerNeedsReset || p.playerError != null || retries > 0) {
            android.util.Log.i(
                "LNTV",
                "loadCurrent: reset duro (needsReset=$playerNeedsReset err=${p.playerError != null} retries=$retries)"
            )
            try {
                p.stop()
                p.clearMediaItems()
            } catch (e: Exception) {
                android.util.Log.w("LNTV", "Falha no reset duro: ${e.message}", e)
            }
            playerNeedsReset = false
        }
        val resolved = resolveStreamForChannel(c)
        android.util.Log.i("LNTV", "loadCurrent #${c.channelNumber} type=${c.streamType} raw=${c.streamUrl} resolved=${safeStreamLog(resolved)}")
        val ib = MediaItem.Builder().setUri(resolved)
        when (c.streamType) {
            "hls" -> {
                ib.setMimeType(MimeTypes.APPLICATION_M3U8)
            }
            "mp4" -> ib.setMimeType(MimeTypes.VIDEO_MP4)
        }
        p.setMediaItem(ib.build())
        p.prepare()
        p.playWhenReady = true
        retries = 0
        showOsd(index)
        heartbeat?.updateChannel(c.id, c.name, true)
    }

    /** Mostra dialog de PIN se canal é adulto e ainda não liberado. Retorna true se bloqueou. */
    private fun maybeRequestPin(c: Channel): Boolean {
        if (!c.isAdult || unlockedAdult.contains(c.id)) return false
        if (pinDialogOpen) return true
        pinDialogOpen = true
        // Pausa qualquer mídia em curso enquanto o dialog está aberto
        player?.playWhenReady = false
        b.osd.visibility = View.GONE
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            hint = "PIN (4 dígitos)"
        }
        AlertDialog.Builder(this)
            .setTitle("🔞 Canal adulto — digite o PIN")
            .setMessage("Canal ${c.channelNumber} • ${c.name}")
            .setView(input)
            .setCancelable(false)
            .setPositiveButton("OK") { _, _ ->
                pinDialogOpen = false
                if (input.text.toString() == currentAdultPin) {
                    unlockedAdult.add(c.id)
                    loadCurrent()
                } else {
                    Toast.makeText(this, "PIN incorreto", Toast.LENGTH_SHORT).show()
                    revertToSafe()
                }
            }
            .setNegativeButton("Cancelar") { _, _ ->
                pinDialogOpen = false
                revertToSafe()
            }
            .show()
        return true
    }

    private fun revertToSafe() {
        if (channels.isEmpty()) return
        val safe = lastSafeIndex.coerceIn(0, channels.size - 1)
        if (safe == index) return
        index = safe
        retries = 0
        loadCurrent()
    }

    private fun attemptRetry(reason: String) {
        val current = channels.getOrNull(index) ?: return
        if (current.streamUrl.startsWith("http://", ignoreCase = true) && retryingProxyChannels.add(current.id)) {
            android.util.Log.w("LNTV", "HTTP direto falhou; tentando proxy HTTPS no canal ${current.channelNumber} ($reason)")
            retries = 0
            retryHandler.removeCallbacksAndMessages(null)
            player?.let { p ->
                val resolved = resolveStreamForChannel(current)
                val ib = MediaItem.Builder().setUri(resolved)
                when (current.streamType) {
                    "hls" -> ib.setMimeType(MimeTypes.APPLICATION_M3U8)
                    "mp4" -> ib.setMimeType(MimeTypes.VIDEO_MP4)
                }
                p.setMediaItem(ib.build())
                p.prepare()
                p.playWhenReady = true
            }
            return
        }
        if (retries >= maxRetries) {
            android.util.Log.w("LNTV", "maxRetries atingido — agendando sonda lenta ($slowProbeInterval ms) pra recuperação automática")
            playerNeedsReset = true
            // Reagenda só uma sonda lenta. Se o canal voltar, STATE_READY zera
            // retries e tudo segue. Se falhar de novo, attemptRetry vai escalar
            // até maxRetries e cair aqui de novo (loop infinito de recuperação,
            // cancelado quando o usuário troca de canal).
            retryHandler.removeCallbacks(slowProbe)
            retryHandler.postDelayed(slowProbe, slowProbeInterval)
            return
        }
        retries++
        val delay = (1000L * (1 shl (retries - 1))).coerceAtMost(8000L)
        retryHandler.removeCallbacks(retryRunnable)
        retryHandler.postDelayed(retryRunnable, delay)
    }

    /** Executa um retry agora (chamado pelo retryHandler). */
    private fun doRetryNow() {
        val p = player ?: return
        val c = channels.getOrNull(index) ?: return
        val resolved = resolveStreamForChannel(c)
        val ib = MediaItem.Builder().setUri(resolved)
        when (c.streamType) {
            "hls" -> ib.setMimeType(MimeTypes.APPLICATION_M3U8)
            "mp4" -> ib.setMimeType(MimeTypes.VIDEO_MP4)
        }
        p.setMediaItem(ib.build())
        p.prepare()
        p.playWhenReady = true
    }

    /** Sonda lenta após esgotar retries: força reset duro e tenta de novo.
     *  Se a origem voltou, o canal recupera sozinho sem o usuário precisar zapar. */
    private fun doSlowProbe() {
        val p = player ?: return
        if (channels.getOrNull(index) == null) return
        android.util.Log.i("LNTV", "Sonda lenta: tentando reabrir canal #${channels[index].channelNumber}")
        try {
            p.stop()
            p.clearMediaItems()
        } catch (e: Exception) {
            android.util.Log.w("LNTV", "Falha no reset da sonda lenta: ${e.message}", e)
        }
        playerNeedsReset = false
        retries = 0
        doRetryNow()
    }

    private fun resolveStreamForChannel(c: Channel): String {
        // Admin marcou "forçar proxy nativo" → sempre via hls-proxy (mesmo HTTPS).
        // Útil pra canais com cert ruim, HTTP cleartext bloqueado em rota, etc.
        if (c.forceProxyNative) {
            return StreamUrl.resolveViaProxy(c.streamUrl, prefs.accessToken)
        }
        return if (retryingProxyChannels.contains(c.id)) {
            StreamUrl.resolveViaProxy(c.streamUrl, prefs.accessToken)
        } else {
            StreamUrl.resolve(c.streamUrl, c.streamType)
        }
    }

    private fun safeStreamLog(url: String): String {
        return Regex("([?&](token|st)=)[^&]+").replace(url) { "${it.groupValues[1]}***" }
    }

    private fun isOkKey(keyCode: Int): Boolean = keyCode == KeyEvent.KEYCODE_DPAD_CENTER ||
        keyCode == KeyEvent.KEYCODE_ENTER ||
        keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER ||
        keyCode == KeyEvent.KEYCODE_BUTTON_A ||
        keyCode == KeyEvent.KEYCODE_BUTTON_B ||
        keyCode == KeyEvent.KEYCODE_BUTTON_SELECT ||
        keyCode == KeyEvent.KEYCODE_SPACE ||
        keyCode == KeyEvent.KEYCODE_MEDIA_PLAY ||
        keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE ||
        keyCode == KeyEvent.KEYCODE_NAVIGATE_IN

    private fun isMenuKey(keyCode: Int): Boolean = keyCode == KeyEvent.KEYCODE_MENU ||
        keyCode == KeyEvent.KEYCODE_BUTTON_START

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (::b.isInitialized && b.menuOverlay.visibility == View.VISIBLE && event.action == KeyEvent.ACTION_DOWN) {
            return handleMenuKey(event.keyCode, event)
        }
        return super.dispatchKeyEvent(event)
    }


    private fun checkStall() {
        val p = player ?: return
        if (p.playbackState != Player.STATE_BUFFERING) return
        // Travado bufferando: faz reset duro (stop+prepare) em vez de só retry,
        // porque streams Amagi e similares ficam presos em buffering eterno.
        android.util.Log.w("LNTV", "Stall detectado — reset duro do canal atual")
        runCatching {
            p.stop()
            p.clearMediaItems()
        }
        playerNeedsReset = false
        retries = 0
        loadCurrent()
    }


    /**
     * Troca UP/DOWN/CH_UP/CH_DOWN — paridade com o app release (web):
     *  - toque isolado (sem auto-repeat) → sintoniza instantaneamente;
     *  - segurando (auto-repeat) → não chama aqui; usa previewChannel()
     *    pra ciclar OSD e só sintonizar ao soltar (ver onKeyDown/onKeyUp).
     */
    private fun changeChannel(delta: Int, eventTimeMs: Long = 0L) {
        if (channels.isEmpty()) return
        cancelPending()
        index = ((index + delta) % channels.size + channels.size) % channels.size
        retries = 0
        showOsd(index)
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
        retries = 0
        loadCurrent()
    }

    private fun cancelPending() {
        previewHandler.removeCallbacks(tunePending)
        previewHandler.removeCallbacks(zapPending)
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
        // scrollToPositionWithOffset é síncrono — assim conseguimos focar
        // o item depois sem race com smoothScroll.
        lm.scrollToPositionWithOffset(target, 0)
        b.listRecycler.post { focusListItem(target) }
    }

    /** Põe foco D-pad no item da posição, pra o cursor vermelho aparecer já. */
    private fun focusListItem(position: Int) {
        val lm = b.listRecycler.layoutManager as? LinearLayoutManager ?: return
        val vh = b.listRecycler.findViewHolderForAdapterPosition(position)
        val view = vh?.itemView ?: run {
            // Item ainda não inflado — tenta de novo no próximo frame
            b.listRecycler.post {
                b.listRecycler.findViewHolderForAdapterPosition(position)?.itemView?.requestFocus()
            }
            return
        }
        view.requestFocus()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // Power/Sleep: alguns STBs/FireTV entregam a tecla ao app antes de
        // acionar SCREEN_OFF. Encerra o app imediatamente pra liberar RAM.
        if (keyCode == KeyEvent.KEYCODE_POWER || keyCode == KeyEvent.KEYCODE_SLEEP ||
            keyCode == KeyEvent.KEYCODE_SOFT_SLEEP) {
            if (installingUpdate) return super.onKeyDown(keyCode, event)
            shutdownAndRelease("power_key")
            return true
        }
        // Stats overlay: deixa trocar canal com cima/baixo mantendo overlay aberto
        if (b.statsOverlay.visibility == View.VISIBLE) {
            return when (keyCode) {
                KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_CHANNEL_UP -> {
                    if ((event?.repeatCount ?: 0) == 0) {
                        changeChannel(1, event?.eventTime ?: 0L); renderStats()
                    } else {
                        previewChannel(1); renderStats()
                    }
                    true
                }
                KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_CHANNEL_DOWN -> {
                    if ((event?.repeatCount ?: 0) == 0) {
                        changeChannel(-1, event?.eventTime ?: 0L); renderStats()
                    } else {
                        previewChannel(-1); renderStats()
                    }
                    true
                }
                KeyEvent.KEYCODE_BACK -> { hideStats(); true }
                // Qualquer outra tecla fecha o overlay e processa normalmente
                else -> if (isOkKey(keyCode) || isMenuKey(keyCode)) { hideStats(); true }
                    else { hideStats(); super.onKeyDown(keyCode, event) }
            }
        }
        // Menu overlay tem prioridade
        if (b.menuOverlay.visibility == View.VISIBLE) {
            return handleMenuKey(keyCode, event)
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
                KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN -> {
                    // Se nada está focado (pós page-scroll), foca o primeiro visível
                    if (b.listRecycler.findFocus() == null) {
                        val lm = b.listRecycler.layoutManager as? LinearLayoutManager
                        val pos = lm?.findFirstVisibleItemPosition() ?: 0
                        focusListItem(pos)
                        true
                    } else super.onKeyDown(keyCode, event)
                }
                else -> super.onKeyDown(keyCode, event)
            }
        }
        // Konami: registra tecla antes de processar
        trackKonami(keyCode)
        if (isMenuKey(keyCode)) {
            showMenu(); return true
        }
        return when (keyCode) {
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_CHANNEL_UP -> {
                // Primeiro toque: sintoniza na hora. Auto-repeat (segurando):
                // cicla OSD como preview; sintoniza ao soltar (onKeyUp) ou
                // após previewDelay de silêncio.
                if ((event?.repeatCount ?: 0) == 0) changeChannel(1, event?.eventTime ?: 0L)
                else previewChannel(1)
                true
            }
            KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_CHANNEL_DOWN -> {
                if ((event?.repeatCount ?: 0) == 0) changeChannel(-1, event?.eventTime ?: 0L)
                else previewChannel(-1)
                true
            }
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_NEXT,
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { previewChannel(1); true }
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_PREVIOUS,
            KeyEvent.KEYCODE_MEDIA_REWIND -> { previewChannel(-1); true }
            KeyEvent.KEYCODE_STAR, KeyEvent.KEYCODE_BOOKMARK,
            KeyEvent.KEYCODE_BUTTON_Y -> { toggleFavorite(); true }
            // Legenda: CC ou botão azul do controle
            KeyEvent.KEYCODE_CAPTIONS, KeyEvent.KEYCODE_PROG_BLUE ->
                { cycleSubtitleTrack(); true }
            // Áudio: SAP, Audio/MTS ou botão amarelo
            KeyEvent.KEYCODE_MEDIA_AUDIO_TRACK, KeyEvent.KEYCODE_TV_AUDIO_DESCRIPTION,
            KeyEvent.KEYCODE_PROG_YELLOW ->
                { cycleAudioTrack(); true }
            // Voz: mic/Assist do controle
            KeyEvent.KEYCODE_VOICE_ASSIST, KeyEvent.KEYCODE_ASSIST,
            KeyEvent.KEYCODE_SEARCH -> { startVoice(); true }
            KeyEvent.KEYCODE_BACK -> handleBackPress()
            in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> {
                appendDigit(keyCode - KeyEvent.KEYCODE_0); true
            }
            in KeyEvent.KEYCODE_NUMPAD_0..KeyEvent.KEYCODE_NUMPAD_9 -> {
                appendDigit(keyCode - KeyEvent.KEYCODE_NUMPAD_0); true
            }
            else -> if (isOkKey(keyCode)) {
                if (digitBuffer.isNotEmpty()) { commitDigitBuffer(); true } else handleOkPress()
            } else super.onKeyDown(keyCode, event)
        }
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean {
        // Ao soltar UP/DOWN/CH_UP/CH_DOWN: se ficou um preview pendente
        // (usuário estava segurando pra ciclar canais), sintoniza na hora
        // sem esperar o previewDelay. Paridade com o app release/web.
        if (keyCode == KeyEvent.KEYCODE_DPAD_UP || keyCode == KeyEvent.KEYCODE_DPAD_DOWN ||
            keyCode == KeyEvent.KEYCODE_CHANNEL_UP || keyCode == KeyEvent.KEYCODE_CHANNEL_DOWN) {
            if (pendingIndex >= 0) {
                previewHandler.removeCallbacks(tunePending)
                commitPending()
                return true
            }
        }
        return super.onKeyUp(keyCode, event)
    }

    // ====== Faixas de Legenda / Áudio ======
    // Persistência: enquanto a Activity viver. Trocar de canal (loadCurrent →
    // setMediaItem) reseta naturalmente. Ao fechar o app, volta ao padrão.

    private fun cycleSubtitleTrack() {
        val p = player ?: return
        cycleTrack(p, C.TRACK_TYPE_TEXT, allowOff = true) { label ->
            Toast.makeText(this, "Legenda: $label", Toast.LENGTH_SHORT).show()
        }
    }

    private fun cycleAudioTrack() {
        val p = player ?: return
        cycleTrack(p, C.TRACK_TYPE_AUDIO, allowOff = false) { label ->
            Toast.makeText(this, "Áudio: $label", Toast.LENGTH_SHORT).show()
        }
    }

    private fun cycleTrack(
        p: ExoPlayer,
        trackType: Int,
        allowOff: Boolean,
        report: (String) -> Unit,
    ) {
        data class Item(val group: TrackGroup, val indexInGroup: Int, val format: Format)
        val items = mutableListOf<Item>()
        val tracks: Tracks = p.currentTracks
        for (g in tracks.groups) {
            if (g.type != trackType) continue
            val tg = g.mediaTrackGroup
            for (i in 0 until tg.length) {
                if (!g.isTrackSupported(i)) continue
                items.add(Item(tg, i, tg.getFormat(i)))
            }
        }
        if (items.isEmpty()) {
            report(if (allowOff) "Sem legendas disponíveis" else "Áudio único disponível")
            return
        }
        if (!allowOff && items.size == 1) {
            report(formatTrackLabel(items[0].format, 0))
            return
        }
        // Índice atual
        var currentIdx = -1
        outer@ for (g in tracks.groups) {
            if (g.type != trackType) continue
            val tg = g.mediaTrackGroup
            for (i in 0 until tg.length) {
                if (g.isTrackSelected(i)) {
                    val k = items.indexOfFirst { it.group === tg && it.indexInGroup == i }
                    if (k >= 0) {
                        currentIdx = k
                        break@outer
                    }
                }
            }
        }
        val textDisabled = allowOff &&
            p.trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT)
        if (textDisabled) currentIdx = -1

        val nextIdx: Int = if (allowOff) {
            if (currentIdx + 1 >= items.size) -1 else currentIdx + 1
        } else {
            if (currentIdx < 0) 0 else (currentIdx + 1) % items.size
        }

        val pb = p.trackSelectionParameters.buildUpon()
        if (allowOff) {
            pb.clearOverridesOfType(C.TRACK_TYPE_TEXT)
            if (nextIdx < 0) {
                pb.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
            } else {
                pb.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                pb.addOverride(
                    TrackSelectionOverride(items[nextIdx].group, listOf(items[nextIdx].indexInGroup))
                )
            }
        } else {
            pb.clearOverridesOfType(C.TRACK_TYPE_AUDIO)
            pb.addOverride(
                TrackSelectionOverride(items[nextIdx].group, listOf(items[nextIdx].indexInGroup))
            )
        }
        p.trackSelectionParameters = pb.build()

        report(if (nextIdx < 0) "Desligado" else formatTrackLabel(items[nextIdx].format, nextIdx))
    }

    private fun formatTrackLabel(f: Format?, fallbackIdx: Int): String {
        if (f == null) return "Faixa ${fallbackIdx + 1}"
        f.label?.takeIf { it.isNotEmpty() }?.let { return it }
        f.language?.takeIf { it.isNotEmpty() }?.let {
            return runCatching { Locale(it).displayLanguage }.getOrDefault(it)
        }
        return "Faixa ${fallbackIdx + 1}"
    }

    // ====== Numeric channel entry ======
    private fun appendDigit(d: Int) {
        if (channels.isEmpty()) return
        cancelPending()
        if (digitBuffer.length >= maxDigits) digitBuffer.clear()
        digitBuffer.append(d)
        showDigitOsd()
        digitHandler.removeCallbacks(digitCommit)
        digitHandler.postDelayed(digitCommit, digitWindow)
    }

    private fun showDigitOsd() {
        b.osdNumber.text = digitBuffer.toString()
        b.osdName.text = "Digitando..."
        b.osdEpg.text = ""
        b.osdLogo.setImageResource(R.mipmap.ic_launcher)
        b.osd.visibility = View.VISIBLE
        osdHandler.removeCallbacks(hideOsd)
    }

    private fun commitDigitBuffer() {
        digitHandler.removeCallbacks(digitCommit)
        if (digitBuffer.isEmpty()) return
        val num = digitBuffer.toString().toIntOrNull()
        digitBuffer.clear()
        if (num == null) return
        val idx = channels.indexOfFirst { it.channelNumber == num }
        if (idx < 0) {
            b.osdName.text = "Canal $num não encontrado"
            osdHandler.removeCallbacks(hideOsd)
            osdHandler.postDelayed(hideOsd, 2000)
            return
        }
        index = idx
        retries = 0
        loadCurrent()
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
        b.menuAboutInfo.visibility = View.GONE
        b.menuUserInfo.text = buildUserHeader()
        menuFocus = 0
        renderMenu()
        b.menuOverlay.visibility = View.VISIBLE
        b.menuOverlay.requestFocus()
        // Carrega perfil + PIN do usuário em background pra exibir nome e ter PIN atual
        fetchUserProfile()
    }

    private fun hideMenu() {
        b.menuOverlay.visibility = View.GONE
        b.menuAboutInfo.visibility = View.GONE
    }

    private fun buildUserHeader(): String {
        val name = userFullName?.takeIf { it.isNotBlank() }
        val email = userEmailCached?.takeIf { it.isNotBlank() }
        return when {
            name != null && email != null -> "$name • $email"
            name != null -> name
            email != null -> email
            else -> prefs.userId?.let { "ID: ${it.take(8)}…" } ?: ""
        }
    }

    private fun fetchUserProfile() {
        val uid = prefs.userId ?: return
        lifecycleScope.launch {
            withContext(Dispatchers.IO) {
                runCatching {
                    sb.get("profiles?select=full_name,email,adult_pin&user_id=eq.$uid").use { res ->
                        if (res.isSuccessful) {
                            val arr = org.json.JSONArray(res.body?.string() ?: "[]")
                            arr.optJSONObject(0)?.let { o ->
                                userFullName = o.optString("full_name").takeIf { it.isNotEmpty() }
                                userEmailCached = o.optString("email").takeIf { it.isNotEmpty() }
                                o.optString("adult_pin").takeIf { it.isNotEmpty() }?.let { currentAdultPin = it }
                            }
                        }
                    }
                }
            }
            if (b.menuOverlay.visibility == View.VISIBLE) {
                b.menuUserInfo.text = buildUserHeader()
            }
        }
    }

    private fun renderMenu() {
        val container = b.menuItems
        container.removeAllViews()
        menuItems.forEachIndexed { i, (label, _) ->
            val tv = TextView(this).apply {
                text = label
                textSize = 18f
                setPadding(28, 20, 28, 20)
                setTextColor(getColor(R.color.fg))
                isFocusable = true
                isClickable = true
                setBackgroundColor(
                    if (i == menuFocus) 0xFFDC2626.toInt() else 0x33FFFFFF
                )
                setOnClickListener {
                    menuFocus = i
                    renderMenu()
                    onMenuSelect(menuItems[i].second)
                }
            }
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = 8 }
            container.addView(tv, lp)
        }
    }

    private fun handleMenuKey(keyCode: Int, event: KeyEvent? = null): Boolean {
        android.util.Log.i("LNTV", "menu key code=$keyCode action=${event?.action} scan=${event?.scanCode} name=${KeyEvent.keyCodeToString(keyCode)}")
        return when (keyCode) {
            KeyEvent.KEYCODE_DPAD_DOWN -> {
                menuFocus = (menuFocus + 1) % menuItems.size; renderMenu(); true
            }
            KeyEvent.KEYCODE_DPAD_UP -> {
                menuFocus = (menuFocus - 1 + menuItems.size) % menuItems.size; renderMenu(); true
            }
            KeyEvent.KEYCODE_BACK -> { hideMenu(); true }
            else -> when {
                isOkKey(keyCode) -> { selectFocusedMenuItem(); true }
                isMenuKey(keyCode) -> { hideMenu(); true }
                else -> true
            }
        }
    }

    private fun selectFocusedMenuItem() {
        b.menuItems.getChildAt(menuFocus)?.performClick()
            ?: onMenuSelect(menuItems[menuFocus].second)
    }

    private fun onMenuSelect(id: String) {
        when (id) {
            "about" -> showAbout()
            "change-password" -> showChangePassword()
            "change-pin" -> showChangePin()
        }
    }

    private fun showAbout() {
        val androidVer = android.os.Build.VERSION.RELEASE
        val sdk = android.os.Build.VERSION.SDK_INT
        val device = "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}"
        val name = userFullName?.takeIf { it.isNotBlank() } ?: "—"
        val email = userEmailCached?.takeIf { it.isNotBlank() } ?: "—"
        val info = """
            App         : LN TV
            Versão APK  : ${BuildConfig.VERSION_NAME}
            Build       : ${BuildConfig.VERSION_CODE}
            Servidor    : ${App.BACKEND}

            Usuário     : $name
            Login       : $email

            Aparelho    : $device
            Android     : $androidVer  (SDK $sdk)
        """.trimIndent()
        b.menuAboutInfo.text = info
        b.menuAboutInfo.visibility = View.VISIBLE
    }

    private fun showChangePassword() {
        // ESCONDE o menu antes — senão o handleMenuKey come as teclas do dialog
        hideMenu()
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

    private fun showChangePin() {
        hideMenu()
        // 1) Confirma PIN atual
        val cur = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            hint = "PIN atual (4 dígitos)"
        }
        AlertDialog.Builder(this)
            .setTitle("Confirme o PIN atual")
            .setView(cur)
            .setPositiveButton("Avançar") { _, _ ->
                if (cur.text.toString() != currentAdultPin) {
                    Toast.makeText(this, "PIN incorreto", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                // 2) Pede novo PIN
                val novo = EditText(this).apply {
                    inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
                    hint = "Novo PIN (4 dígitos)"
                }
                AlertDialog.Builder(this)
                    .setTitle("Novo PIN parental")
                    .setView(novo)
                    .setPositiveButton("Salvar") { _, _ ->
                        val pin = novo.text.toString()
                        if (pin.length != 4 || !pin.all { it.isDigit() }) {
                            Toast.makeText(this, "O PIN precisa ter 4 dígitos", Toast.LENGTH_SHORT).show()
                        } else updateAdultPin(pin)
                    }
                    .setNegativeButton("Cancelar", null)
                    .show()
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    private fun updateAdultPin(pin: String) {
        val uid = prefs.userId ?: return
        lifecycleScope.launch {
            val ok = withContext(Dispatchers.IO) {
                runCatching {
                    sb.ensureFreshSession()
                    val tok = prefs.accessToken ?: return@runCatching false
                    val body = JSONObject().put("adult_pin", pin).toString()
                        .toRequestBody("application/json".toMediaType())
                    val req = Request.Builder()
                        .url("${sb.restUrl}/profiles?user_id=eq.$uid")
                        .header("apikey", App.ANON_KEY)
                        .header("Authorization", "Bearer $tok")
                        .header("Content-Type", "application/json")
                        .header("Prefer", "return=minimal")
                        .patch(body).build()
                    (application as App).http.newCall(req).execute().use { it.isSuccessful }
                }.getOrDefault(false)
            }
            Toast.makeText(
                this@PlayerActivity,
                if (ok) "PIN atualizado!" else "Falha ao atualizar PIN",
                Toast.LENGTH_SHORT
            ).show()
            if (ok) currentAdultPin = pin
        }
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
        // Fixa a largura do overlay em 1/3 da tela pra não cobrir metade do vídeo,
        // independente do tamanho do texto.
        val lp = b.statsOverlay.layoutParams
        lp.width = resources.displayMetrics.widthPixels / 3
        b.statsOverlay.layoutParams = lp
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
            val currentName = BuildConfig.VERSION_NAME
            val update = withContext(Dispatchers.IO) { updater.check(current, currentName) } ?: return@launch
            // Ativa o guard ANTES do download começar — se o processo for pro
            // background durante o download (troca de foco, screen dim, etc.)
            // não queremos que ShutdownHelper/onUserLeaveHint matem o app.
            installingUpdate = true
            Toast.makeText(
                this@PlayerActivity,
                "Atualização ${update.versionName} disponível — baixando…",
                Toast.LENGTH_LONG
            ).show()
            val file = withContext(Dispatchers.IO) { updater.download(update) }
            if (file == null) {
                // Falhou o download — libera o guard pra voltar ao normal.
                installingUpdate = false
                return@launch
            }
            Toast.makeText(
                this@PlayerActivity,
                "Abrindo instalador…",
                Toast.LENGTH_LONG
            ).show()
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
        retryHandler.removeCallbacksAndMessages(null)
        osdHandler.removeCallbacksAndMessages(null)
        previewHandler.removeCallbacksAndMessages(null)
        statsHandler.removeCallbacksAndMessages(null)
        screenOffReceiver?.let {
            runCatching { unregisterReceiver(it) }
            screenOffReceiver = null
        }
        heartbeat?.stop()
        heartbeat = null
        voice?.destroy()
        voice = null
        player?.release()
        player = null
    }

    // ====== Reconhecimento de voz ======
    private fun startVoice() {
        if (voice == null) {
            voice = tv.lntelecom.nativo.voice.VoiceRecognizer(this) { text ->
                handleVoiceTranscript(text)
            }
        }
        voice?.start()
    }

    private fun handleVoiceTranscript(raw: String) {
        val action = tv.lntelecom.nativo.voice.VoiceCommandParser.parse(raw, channels)
        when (action) {
            is tv.lntelecom.nativo.voice.VoiceAction.TuneNumber -> {
                val idx = channels.indexOfFirst { it.channelNumber == action.number }
                if (idx >= 0) {
                    index = idx
                    retries = 0
                    loadCurrent()
                } else {
                    Toast.makeText(this, "Canal ${action.number} não encontrado", Toast.LENGTH_SHORT).show()
                }
            }
            is tv.lntelecom.nativo.voice.VoiceAction.TuneChannel -> {
                val idx = channels.indexOfFirst { it.id == action.channel.id }
                if (idx >= 0) {
                    index = idx
                    retries = 0
                    loadCurrent()
                    Toast.makeText(this, "Sintonizando ${action.channel.name}", Toast.LENGTH_SHORT).show()
                }
            }
            tv.lntelecom.nativo.voice.VoiceAction.Audio -> cycleAudioTrack()
            tv.lntelecom.nativo.voice.VoiceAction.Subtitle -> cycleSubtitleTrack()
            tv.lntelecom.nativo.voice.VoiceAction.Shutdown -> {
                Toast.makeText(this, "Encerrando...", Toast.LENGTH_SHORT).show()
                Handler(Looper.getMainLooper()).postDelayed({
                    finishAndRemoveTask()
                    System.exit(0)
                }, 800)
            }
            is tv.lntelecom.nativo.voice.VoiceAction.Unknown -> {
                Toast.makeText(this, "Não entendi: \"${action.raw}\"", Toast.LENGTH_SHORT).show()
            }
        }
    }
}


