# ProGuard / R8 rules para LN TV
#
# Capacitor + plugins usam reflection no startup pra registrar pontes JS<->Java.
# Sem essas regras, R8 remove classes "não usadas" e o app crasha no boot.

# Preserve line numbers for stack traces
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
-keepattributes *Annotation*, Signature, Exceptions, InnerClasses, EnclosingMethod

# === Capacitor core + bridge ===
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
  @com.getcapacitor.PluginMethod public *;
}
-keep class com.capacitorjs.** { *; }

# === Capacitor community plugins ===
-keep class io.capawesome.capacitorjs.** { *; }
-keep class com.capacitor.community.** { *; }

# === AndroidX Media3 / ExoPlayer ===
-keep class androidx.media3.** { *; }
-dontwarn androidx.media3.**

# === Nossos plugins nativos e Activities ===
-keep class tv.lntelecom.net.** { *; }

# === Cordova fallback (se houver plugins legacy) ===
-keep class org.apache.cordova.** { *; }
-keep class org.crosswalk.engine.** { *; }

# === WebView JS interface (genérico) ===
-keepclassmembers class * {
  @android.webkit.JavascriptInterface <methods>;
}

# === Suprimir warnings ===
-dontwarn com.getcapacitor.**
-dontwarn org.apache.cordova.**
