import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'tv.lntelecom.net',
  appName: 'LN TV',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
  server: {
    url: 'https://tv.lntelecom.net',
    cleartext: false,
  },
};

export default config;
