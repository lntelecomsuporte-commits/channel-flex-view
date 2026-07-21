package tv.lntelecom.nativo

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.decode.SvgDecoder
import coil.disk.DiskCache
import coil.memory.MemoryCache
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

class App : Application(), ImageLoaderFactory {

    val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .callTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    override fun newImageLoader(): ImageLoader = ImageLoader.Builder(this)
        .crossfade(true)
        .components { add(SvgDecoder.Factory()) }
        .memoryCache { MemoryCache.Builder(this).maxSizePercent(0.20).build() }
        .diskCache {
            DiskCache.Builder()
                .directory(cacheDir.resolve("logos"))
                .maxSizeBytes(20L * 1024 * 1024)
                .build()
        }
        .okHttpClient(http)
        .build()

    companion object {
        const val BACKEND = "https://tv2.lntelecom.net"
        // Chave pública local do backend self-hosted (mesma usada pelo Roku/servidor).
        const val ANON_KEY =
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzc3MDA0OTQwLCJleHAiOjIwOTIzNjQ5NDB9.9BCUjjQPaZLLhZnJnpor4cfq7kO6IbjFpt78hPBGyow"

        /**
         * Flag global — quando true, TODAS as activities ignoram sinais de
         * shutdown (screen_off, hdmi_unplug, power_key, user_leave_hint).
         * Ativada antes de baixar/instalar update pra não matar o processo no
         * meio do download nem quando o instalador do sistema abrir em outra task.
         */
        @Volatile
        var installingUpdate: Boolean = false
    }
}
