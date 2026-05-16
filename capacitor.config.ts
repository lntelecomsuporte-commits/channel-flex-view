import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'tv.lntelecom.net',
  appName: 'LN TV',
  webDir: 'dist',
  server: {
    // Shell remoto: o WebView carrega o site em produção, então atualizações
    // em src/** chegam pro usuário sem precisar gerar APK novo. APK só é
    // regerado quando algo nativo muda (android/**, capacitor.config, etc).
    url: 'https://tv2.lntelecom.net/',
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
    // Força console.log do JS aparecer no logcat mesmo em build release
    loggingBehavior: 'production',
  },
  // Idem nível raiz (cobre iOS e overrides)
  loggingBehavior: 'production',
  plugins: {
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
