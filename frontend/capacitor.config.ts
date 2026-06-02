import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.scm.solution',
  appName: 'SCM Solution',
  webDir: '.next',
  server: {
    url: 'http://192.168.1.5:3000',
    cleartext: true
  }
};

export default config;
