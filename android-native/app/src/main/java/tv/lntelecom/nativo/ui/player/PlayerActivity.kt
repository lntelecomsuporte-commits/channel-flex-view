package tv.lntelecom.nativo.ui.player

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
import coil.load
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.lntelecom.nativo.App
import tv.lntelecom.nativo.R
import tv.lntelecom.nativo.data.EpgRepository
import tv.lntelecom.nativo.data.FavoritesRepository
import tv.lntelecom.nativo.data.Prefs
import tv.lntelecom.nativo.data.StreamUrl
import tv.lntelecom.nativo.data.SupabaseClient
import tv.lntelecom.nativo.databinding.ActivityPlayerBinding
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class PlayerActivity : AppCompatActivity() {

    private lateinit var b: ActivityPlayerBinding
    private var player: ExoPlayer? = null
    private lateinit var epg: EpgRepository
    private lateinit var favorites: FavoritesRepository

    private lateinit var ids: Array<String>
    private lateinit var numbers: IntArray
    private lateinit var urls: Array<String>
    private lateinit var types: Array<String>
    private lateinit var names: Array<String>
    private lateinit var logos: Array<String>
    private lateinit var epgIds: Array<String>

    private var index = 0
    private var retries = 0
    private val maxRetries = 6

    private val timeFmt = SimpleDateFormat("HH:mm", Locale.getDefault())

    private val osdHandler = Handler(Looper.getMainLooper())
    private val hideOsd = Runnable { b.osd.visibility = View.GONE }

    private val stallHandler = Handler(Looper.getMainLooper())
    private val stallCheck = Runnable { checkStall() }

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

        ids = intent.getStringArrayExtra("ids") ?: emptyArray()
        numbers = intent.getIntArrayExtra("numbers") ?: IntArray(0)
        urls = intent.getStringArrayExtra("urls") ?: emptyArray()
        types = intent.getStringArrayExtra("types") ?: emptyArray()
        names = intent.getStringArrayExtra("names") ?: emptyArray()
        logos = intent.getStringArrayExtra("logos") ?: emptyArray()
        epgIds = intent.getStringArrayExtra("epgIds") ?: emptyArray()
        index = intent.getIntExtra("startIndex", 0).coerceIn(0, (ids.size - 1).coerceAtLeast(0))

        if (ids.isEmpty()) { finish(); return }

        initPlayer()
        loadCurrent()

        // Pré-carrega EPG + favoritos em background
        lifecycleScope.launch {
            withContext(Dispatchers.IO) {
                epg.ensureLoaded()
                runCatching { favorites.load() }
            }
            refreshOsdEpg()
        }
    }

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
        val resolved = StreamUrl.resolve(urls[index], types[index])
        val itemBuilder = MediaItem.Builder().setUri(resolved)
        if (types[index] == "hls") itemBuilder.setMimeType(MimeTypes.APPLICATION_M3U8)
        p.setMediaItem(itemBuilder.build())
        p.prepare()
        p.playWhenReady = true
        retries = 0
        showOsd()
    }

    private fun attemptRetry(reason: String) {
        if (retries >= maxRetries) return
        retries++
        val delay = (1000L * (1 shl (retries - 1))).coerceAtMost(8000L)
        b.playerView.postDelayed({
            val p = player ?: return@postDelayed
            val resolved = StreamUrl.resolve(urls[index], types[index])
            val ib = MediaItem.Builder().setUri(resolved)
            if (types[index] == "hls") ib.setMimeType(MimeTypes.APPLICATION_M3U8)
            p.setMediaItem(ib.build())
            p.prepare()
            p.playWhenReady = true
        }, delay)
    }

    private fun checkStall() {
        val p = player ?: return
        if (p.playbackState == Player.STATE_BUFFERING) attemptRetry("stall")
    }

    private fun changeChannel(delta: Int) {
        if (ids.isEmpty()) return
        index = ((index + delta) % ids.size + ids.size) % ids.size
        loadCurrent()
    }

    private fun showOsd() {
        b.osdNumber.text = numbers.getOrNull(index)?.toString() ?: ""
        b.osdName.text = names.getOrNull(index) ?: ""
        b.osdEpg.text = ""
        val logo = StreamUrl.resolveLogo(logos.getOrNull(index)?.takeIf { it.isNotEmpty() })
        if (logo != null) b.osdLogo.load(logo) { crossfade(false) }
        else b.osdLogo.setImageResource(R.drawable.ic_launcher_foreground)
        b.osd.visibility = View.VISIBLE
        osdHandler.removeCallbacks(hideOsd)
        osdHandler.postDelayed(hideOsd, 4000)
        refreshOsdEpg()
    }

    private fun refreshOsdEpg() {
        val epgId = epgIds.getOrNull(index)?.takeIf { it.isNotEmpty() } ?: return
        val now = epg.currentProgram(epgId) ?: return
        val nxt = epg.nextProgram(epgId)
        val nowLine = "${timeFmt.format(Date(now.startMs))}  ${now.title}"
        b.osdEpg.text = if (nxt != null)
            "$nowLine\n${timeFmt.format(Date(nxt.startMs))}  ${nxt.title}"
        else nowLine
    }

    private fun toggleFavorite() {
        val cid = ids.getOrNull(index) ?: return
        lifecycleScope.launch {
            val nowFav = withContext(Dispatchers.IO) { favorites.toggle(cid) }
            Toast.makeText(
                this@PlayerActivity,
                if (nowFav) "Favorito adicionado" else "Favorito removido",
                Toast.LENGTH_SHORT
            ).show()
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        return when (keyCode) {
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_CHANNEL_UP -> { changeChannel(-1); true }
            KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_CHANNEL_DOWN -> { changeChannel(1); true }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> { showOsd(); true }
            KeyEvent.KEYCODE_STAR, KeyEvent.KEYCODE_BOOKMARK,
            KeyEvent.KEYCODE_BUTTON_Y -> { toggleFavorite(); true }
            KeyEvent.KEYCODE_BACK -> { finish(); true }
            else -> super.onKeyDown(keyCode, event)
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
        player?.release()
        player = null
    }
}
