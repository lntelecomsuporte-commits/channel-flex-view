import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'tv.lntelecom.net',
  appName: 'LN TV',
  webDir: 'dist',
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
