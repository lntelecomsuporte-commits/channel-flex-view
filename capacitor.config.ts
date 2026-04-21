import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.dce7d3392c3f4716a54b6eb723a76e37',
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
