# PentaBlocks - Android (Capacitor) Kurulum Rehberi

## Gereksinimler

| Arac | Minimum Versiyon | Indirme |
|------|-----------------|---------|
| Node.js | 18+ | nodejs.org |
| Android Studio | Ladybug (2024.2+) | developer.android.com/studio |
| JDK | 17+ | Android Studio ile birlikte gelir |
| Android SDK | API 24+ (Android 7.0) | Android Studio > SDK Manager |

Android Studio kurulumundan sonra:
1. **SDK Manager** > Android 14 (API 34) SDK Platform'u yukle
2. **Virtual Device Manager** > bir emulator olustur (Pixel 7, API 34)
3. `ANDROID_HOME` ortam degiskenini ayarla:

```
# Windows (System Environment Variables)
ANDROID_HOME = C:\Users\<kullanici>\AppData\Local\Android\Sdk
```

---

## 1. Capacitor Kurulumu

```bash
npm install @capacitor/core @capacitor/android
npm install -D @capacitor/cli
```

---

## 2. Capacitor Baslatma

```bash
npx cap init
```

Sorular:
- **App name:** PentaBlocks
- **App ID (Bundle ID):** com.pentablocks.app
- **Web asset directory:** dist

Olusturulan `capacitor.config.ts` dosyasini su sekilde guncelle:

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pentablocks.app',
  appName: 'PentaBlocks',
  webDir: 'dist',
  android: {
    backgroundColor: '#0b0f17',
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0b0f17',
    },
  },
};

export default config;
```

---

## 3. Android Platformu Ekleme

```bash
npx cap add android
```

Proje kokunde `android/` klasoru olusur.

---

## 4. API Base URL Ayari (Kritik)

Android WebView icindeki uygulama `capacitor://localhost` origin'inden calisir.
Relative URL kullanilirsa (`/api/...`) istekler WebView'e gider, backend'e degil.

Android build icin `.env.android` dosyasi olustur:

```
VITE_API_BASE_URL=https://www.pentablocks.live
```

Build sirasinda bu env dosyasini kullan:

```bash
# package.json'a ekle
"android:build": "vite build --mode android && npx cap sync android"
```

`vite.config.ts` mode destegi icin `vite.config.ts` zaten `loadEnv` kullaniyor,
sadece `.env.android` dosyasini olusturmak yeterli.

Alternatif olarak dogrudan build:
```bash
# Bash / zsh
VITE_API_BASE_URL=https://www.pentablocks.live npm run build
npx cap sync android
```

```powershell
# PowerShell
$env:VITE_API_BASE_URL="https://www.pentablocks.live"
npm run build
npx cap sync android
```

`src/lib/arena.ts` (ve diger API dosyalari) zaten `VITE_API_BASE_URL`'i okuyor:
```ts
const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim();
const API_BASE = configuredApiBase ? ... : (import.meta.env.DEV ? 'http://localhost:8787' : '');
```
Bu yuzden sadece `VITE_API_BASE_URL` set edilmesi yeterli, baska degisiklik gerekmez.

---

## 5. CORS Ayari (Backend)

Backend `APP_ORIGIN` ve `APP_ORIGINS` env degiskenleri uzerinden CORS yonetiyor
(`server/index.mjs` > `buildAllowedOrigins`). Kod degisikligi yapma,
VPS'teki `.env` dosyasina Capacitor origin'lerini ekle:

```
# .env (VPS'te)
APP_ORIGIN=https://www.pentablocks.live
APP_ORIGINS=capacitor://localhost,http://localhost
```

`APP_ORIGINS` virgullu liste, `buildAllowedOrigins()` otomatik parse ediyor.

---

## 6. Cookie Ayari (SameSite)

Backend `pb_session` cookie'si varsayilan olarak `sameSite: 'lax'` set ediliyor.
Capacitor uygulamasi `capacitor://localhost` origin'inden geldigi icin,
web API'ye cookie tasimak adina production ortaminda `sameSite: 'none'` kullanmak gerekir.

`server/index.mjs` icinde `setSessionCookie` fonksiyonunu guncelle:

```js
function setSessionCookie(res, token) {
  const isSecure = process.env.NODE_ENV === 'production';
  res.header(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: isSecure ? 'none' : 'lax',  // none gerektiriyor Capacitor icin
      secure: isSecure,
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    }),
  );
}
```

> **Not:** `SameSite=None` yalnizca `Secure=true` ile birlikte gecerli.
> Production ortaminda HTTPS zorunlu.

---

## 7. Build & Sync Akisi

```bash
# 1. Web uygulamasini build et (API URL ile)
# Bash / zsh
VITE_API_BASE_URL=https://www.pentablocks.live npm run build

# 2. Capacitor'a sync et
npx cap sync android

# 3. Android Studio'yu ac
npx cap open android
```

```powershell
# PowerShell
$env:VITE_API_BASE_URL="https://www.pentablocks.live"
npm run build
npx cap sync android
npx cap open android
```

`package.json` icin kisa yol:

```json
"scripts": {
  "android:build": "vite build --mode android && npx cap sync android",
  "android:open": "npx cap open android"
}
```

---

## 8. Splash Screen & Ikon

```bash
npm install @capacitor/splash-screen @capacitor/status-bar
npx cap sync android
```

Ikon uretimi icin [Icon Kitchen](https://icon.kitchen) kullanabilirsin:
- 1024x1024 px PNG yukle
- Android ciktisini indir
- `android/app/src/main/res/` klasorune kopyala

---

## 9. Play Store icin Release AAB

### 9a. Keystore olustur (bir kez yapilir - guvende sakla!)

```bash
keytool -genkey -v -keystore pentablocks-release.keystore \
  -alias pentablocks -keyalg RSA -keysize 2048 -validity 10000
```

> `pentablocks-release.keystore` dosyasini git'e commit etme!
> `.gitignore`'a ekle.

### 9b. keystore.properties dosyasi olustur

`android/keystore.properties` (git'e commit etme):

```properties
storePassword=SIFRENIZ
keyPassword=SIFRENIZ
keyAlias=pentablocks
storeFile=../../pentablocks-release.keystore
```

`android/.gitignore` dosyasina ekle:

```
keystore.properties
```

### 9c. android/app/build.gradle guncelleme

```groovy
// Dosyanin en ustune ekle:
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    ...
    signingConfigs {
        release {
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

### 9d. AAB uret

Android Studio > **Build > Generate Signed Bundle / APK** > **Android App Bundle** > keystore sec > Finish

Cikti: `android/app/release/app-release.aab`

---

## 10. Onerilen Capacitor Eklentileri

| Eklenti | Kullanim | Kurulum |
|---------|----------|---------|
| `@capacitor/haptics` | Parca birakma/hata geri bildirimi | `npm i @capacitor/haptics` |
| `@capacitor/status-bar` | Status bar rengi/gizleme | `npm i @capacitor/status-bar` |
| `@capacitor/splash-screen` | Acilis ekrani | `npm i @capacitor/splash-screen` |
| `@capacitor/keyboard` | Klavye davranisi kontrolu | `npm i @capacitor/keyboard` |

---

## 11. Gelistirme Akisi Ozeti

```
Kod degistir
    |
    v
VITE_API_BASE_URL=https://www.pentablocks.live npm run build
    |
    v
npx cap sync android
    |
    v
Android Studio > Run
```

**Canli reload** icin (her build gerekmez):

```ts
// capacitor.config.ts - sadece gelistirmede
server: {
  url: 'https://www.pentablocks.live',
  cleartext: false,
}
```

---

## Sik Karsilasilan Sorunlar

| Sorun | Cozum |
|-------|-------|
| Gradle sync basarisiz | Android Studio > File > Invalidate Caches > Restart |
| `ANDROID_HOME` bulunamiyor | Ortam degiskenini kontrol et, terminal'i yeniden ac |
| Cookie calismiyor | `sameSite: 'none'` + `secure: true` kontrolu yap |
| Beyaz ekran | `dist/` klasorunu kontrol et (`npm run build` calistir) |
| Network hatasi (401/CORS) | `APP_ORIGINS` env'e `capacitor://localhost` eklendi mi? |
| API localhost'a gidiyor | `VITE_API_BASE_URL` build sirasinda set edildi mi? |
