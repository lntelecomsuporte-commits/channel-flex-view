import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.dce7d3392c3f4716a54b6eb723a76e37',
  appName: 'LN TV',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
  // Para desenvolvimento com hot-reload, descomente o bloco abaixo:
  // server: {
  //   url: 'https://dce7d339-2c3f-4716-a54b-6eb723a76e37.lovableproject.com?forceHideBadge=true',
  //   cleartext: true,
  // },
};

export default config;
