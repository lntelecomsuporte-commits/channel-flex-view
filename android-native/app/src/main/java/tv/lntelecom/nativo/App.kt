package tv.lntelecom.nativo

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
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
        // Mesma anon key publicável usada pelo frontend web
        const val ANON_KEY =
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dW5remx0bWxhZmF0emZpaWtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNDcwNDIsImV4cCI6MjA5MDkyMzA0Mn0.9OhGbfjGuoXQaars3TIZ7QyVBnWrWrgkHP3ktWHfMkY"
    }
}
