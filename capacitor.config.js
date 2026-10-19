/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  appId: "com.madiba.sfa",
  appName: "MADIBA SFA",
  webDir: "public",
  server: {
    url: process.env.CAPACITOR_SERVER_URL || "https://madiba-sfa.vercel.app",
    cleartext: false,
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#073f4c",
      showSpinner: false,
    },
  },
};

module.exports = config;
