// Where the app is running: inside the Android app (Trusted Web Activity) or in a browser.

export const APK_URL = 'https://github.com/duycan2000/pos.dui.social/releases/latest/download/dui-pos.apk';
const KEY = 'inAndroidApp';

/** The Android app opens Chrome with referrer android-app://social.dui.pos; remember it for later reloads. */
export function inAndroidApp(): boolean {
  try {
    if (document.referrer.startsWith('android-app://social.dui.pos')) sessionStorage.setItem(KEY, '1');
    return sessionStorage.getItem(KEY) === '1' || matchMedia('(display-mode: standalone)').matches && /Android/i.test(navigator.userAgent) && document.referrer.startsWith('android-app://');
  } catch { return false; }
}

export const isAndroid = () => /Android/i.test(navigator.userAgent);
