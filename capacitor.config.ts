import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'tv.lntelecom.net',
  appName: 'LN TV',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
  plugins: {
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
