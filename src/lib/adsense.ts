const ADSENSE_CLIENT_ID = import.meta.env.VITE_ADSENSE_CLIENT_ID?.trim();
const ADSENSE_SCRIPT_ID = 'pentablocks-adsense-script';

declare global {
  interface Window {
    adsbygoogle?: Array<Record<string, unknown>> & { requestNonPersonalizedAds?: number };
  }
}

let adsenseInitialized = false;

export function configureAdSensePreference(personalizedAds: boolean) {
  if (!ADSENSE_CLIENT_ID) return;
  window.adsbygoogle = window.adsbygoogle ?? [];
  window.adsbygoogle.requestNonPersonalizedAds = personalizedAds ? 0 : 1;
}

export function initializeAdSense(personalizedAds: boolean) {
  if (!ADSENSE_CLIENT_ID || adsenseInitialized) return false;

  configureAdSensePreference(personalizedAds);

  if (document.getElementById(ADSENSE_SCRIPT_ID)) {
    adsenseInitialized = true;
    return true;
  }

  const script = document.createElement('script');
  script.id = ADSENSE_SCRIPT_ID;
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADSENSE_CLIENT_ID)}`;
  document.head.appendChild(script);

  adsenseInitialized = true;
  return true;
}

export function isAdSenseConfigured() {
  return Boolean(ADSENSE_CLIENT_ID);
}
