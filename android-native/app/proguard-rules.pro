# Kotlin metadata + coroutines
-keep class kotlin.Metadata { *; }
-keepclassmembers class kotlinx.coroutines.** { volatile <fields>; }

# Media3/ExoPlayer
-keep class androidx.media3.** { *; }
-dontwarn androidx.media3.**

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**

# Coil
-dontwarn coil.**

# Models (JSON via org.json — sem reflection, mas mantém pra logs)
-keep class tv.lntelecom.nativo.data.model.** { *; }

# Activities/services pra evitar StripException no install
-keep class tv.lntelecom.nativo.ui.** { *; }
-keep class tv.lntelecom.nativo.UpdateInstallActivity { *; }
