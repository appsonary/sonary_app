const fs = require('fs');
const path = require('path');
const {
  withMainActivity,
  withMainApplication,
  withAndroidManifest,
  withDangerousMod,
  AndroidConfig,
} = require('@expo/config-plugins');

const V31_STYLES_XML = `<resources xmlns:tools="http://schemas.android.com/tools">
  <style name="AppTheme" parent="Theme.AppCompat.Light.NoActionBar">
    <item name="android:textColor">@android:color/black</item>
    <item name="android:editTextStyle">@style/ResetEditText</item>
    <item name="android:editTextBackground">@drawable/rn_edit_text_material</item>
    <item name="colorPrimary">@color/colorPrimary</item>
    <item name="android:statusBarColor">#000000</item>
    <item name="android:navigationBarColor">#000000</item>
    <item name="android:windowBackground">#000000</item>
    <item name="android:colorBackground">#000000</item>
    <item name="android:windowSplashScreenBackground">#000000</item>
    <item name="android:windowSplashScreenIconBackgroundColor">#000000</item>
  </style>
  <style name="Theme.App.SplashScreen" parent="AppTheme">
    <item name="android:windowBackground">@drawable/splashscreen</item>
    <item name="android:windowSplashScreenBackground">#000000</item>
    <item name="android:windowSplashScreenIconBackgroundColor">#000000</item>
  </style>
</resources>
`;

function upsertStyleItem(styleBody, itemName, value) {
  const escaped = itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const itemRegex = new RegExp(`([ \\t]*)<item name="${escaped}">[^<]*<\\/item>`);
  const line = `<item name="${itemName}">${value}</item>`;
  if (itemRegex.test(styleBody)) {
    return styleBody.replace(itemRegex, `$1${line}`);
  }
  return styleBody.replace(/(\s*<\/style>)/, `\n    ${line}$1`);
}

/**
 * Ensures Android pre-API-31 and API-31+ splash & window backgrounds are solid black (#000000)
 * instead of inheriting Light theme's white surface during cold launch.
 */
function applyBlackSplashTheme(resDir) {
  let changed = false;

  const colorsPath = path.join(resDir, 'values', 'colors.xml');
  if (fs.existsSync(colorsPath)) {
    let colors = fs.readFileSync(colorsPath, 'utf8');
    let nextColors = colors
      .replace(/(<color name="splashscreen_background">)[^<]*(<\/color>)/, '$1#000000$2')
      .replace(/(<color name="iconBackground">)[^<]*(<\/color>)/, '$1#000000$2');
    if (nextColors !== colors) {
      fs.writeFileSync(colorsPath, nextColors, 'utf8');
      changed = true;
    }
  }

  const stylesPath = path.join(resDir, 'values', 'styles.xml');
  if (fs.existsSync(stylesPath)) {
    const styles = fs.readFileSync(stylesPath, 'utf8');
    let nextStyles = styles.replace(
      /(<style name="AppTheme"[\s\S]*?<\/style>)/,
      (block) => {
        let updated = block;
        updated = upsertStyleItem(updated, 'android:statusBarColor', '#000000');
        updated = upsertStyleItem(updated, 'android:navigationBarColor', '#000000');
        updated = upsertStyleItem(updated, 'android:windowBackground', '#000000');
        updated = upsertStyleItem(updated, 'android:colorBackground', '#000000');
        return updated;
      }
    );
    if (nextStyles !== styles) {
      fs.writeFileSync(stylesPath, nextStyles, 'utf8');
      changed = true;
    }
  }

  const v31Dir = path.join(resDir, 'values-v31');
  const v31StylesPath = path.join(v31Dir, 'styles.xml');
  const prevV31 = fs.existsSync(v31StylesPath) ? fs.readFileSync(v31StylesPath, 'utf8') : null;
  if (prevV31 !== V31_STYLES_XML) {
    fs.mkdirSync(v31Dir, { recursive: true });
    fs.writeFileSync(v31StylesPath, V31_STYLES_XML, 'utf8');
    changed = true;
  }

  return changed;
}

/**
 * Expo Config Plugin para Android 14+ (API 34) Startup & Deadlock Fix
 *
 * 1. Desativa popups flutuantes nativos do DevLoadingView no MainActivity e MainApplication
 *    para evitar que o WindowManager do Android 14 trave em mShownAlpha = 0.0 (tela preta).
 * 2. Garante que o MainActivity utilize android:theme="@style/AppTheme" com splash preta (#000000).
 */
const withAndroidStartupFix = (config) => {
  // 1. Modifica MainActivity
  config = withMainActivity(config, (modConfig) => {
    let contents = modConfig.modResults.contents;

    // Injeta import se ausente
    if (!contents.includes('DefaultDevLoadingViewImplementation')) {
      contents = contents.replace(
        /(package\s+[\w\.]+)/,
        `$1\n\nimport com.facebook.react.devsupport.DefaultDevLoadingViewImplementation`
      );
    }

    // Injeta chamada dentro de onCreate
    if (!contents.includes('DefaultDevLoadingViewImplementation.setDevLoadingEnabled(false)')) {
      if (contents.includes('super.onCreate')) {
        contents = contents.replace(
          /(override\s+fun\s+onCreate\s*\([^)]*\)\s*\{)/,
          `$1\n    DefaultDevLoadingViewImplementation.setDevLoadingEnabled(false)`
        );
      } else {
        // Se onCreate não existir, cria o método
        contents = contents.replace(
          /(class\s+MainActivity\s*:\s*ReactActivity\(\)\s*\{)/,
          `$1\n  override fun onCreate(savedInstanceState: android.os.Bundle?) {\n    DefaultDevLoadingViewImplementation.setDevLoadingEnabled(false)\n    super.onCreate(null)\n  }\n`
        );
      }
    }

    // Força formato de janela 32-bit RGBA_8888 para reduzir color banding em gradientes escuros
    if (!contents.includes('PixelFormat.RGBA_8888')) {
      contents = contents.replace(
        /(class\s+MainActivity\s*:\s*ReactActivity\(\)\s*\{)/,
        `$1\n  override fun onAttachedToWindow() {\n    super.onAttachedToWindow()\n    window?.setFormat(android.graphics.PixelFormat.RGBA_8888)\n  }\n`
      );
    }

    // Converte intent de notificação de apoio em deep link na abertura/cold start sem corrida com BroadcastReceiver
    if (!contents.includes('applySupportNotificationDeepLink')) {
      if (!contents.includes('import android.content.Intent')) {
        contents = contents.replace(
          /(package\s+[\w\.]+)/,
          `$1\n\nimport android.content.Intent\nimport android.net.Uri\nimport expo.modules.notifications.service.NotificationsService`
        );
      }
      contents = contents.replace(
        /(class\s+MainActivity\s*:\s*ReactActivity\(\)\s*\{)/,
        `$1\n  private fun applySupportNotificationDeepLink(targetIntent: Intent?) {\n    if (targetIntent == null || targetIntent.data != null) return\n    try {\n      val response = NotificationsService.getNotificationResponseFromOpenIntent(targetIntent) ?: return\n      val targetTab = response.notification.notificationRequest.content.body?.optString("targetTab")\n      if (targetTab == "support") {\n        val identifier = response.notification.notificationRequest.identifier\n        targetIntent.action = Intent.ACTION_VIEW\n        targetIntent.data = Uri.Builder()\n          .scheme("com.sonarypro.app")\n          .authority("support")\n          .appendQueryParameter("nid", identifier)\n          .build()\n      }\n    } catch (_: Throwable) {\n      // Never block Activity launch if notification extras cannot be parsed\n    }\n  }\n`
      );
      contents = contents.replace(
        /(super\.onCreate\([^\)]*\))/,
        `applySupportNotificationDeepLink(intent)\n    $1`
      );
      if (!contents.includes('override fun onNewIntent')) {
        contents = contents.replace(
          /(override\s+fun\s+getMainComponentName)/,
          `override fun onNewIntent(intent: Intent) {\n    applySupportNotificationDeepLink(intent)\n    setIntent(intent)\n    super.onNewIntent(intent)\n  }\n\n  $1`
        );
      }
    }

    modConfig.modResults.contents = contents;
    return modConfig;
  });

  // 2. Modifica MainApplication
  config = withMainApplication(config, (modConfig) => {
    let contents = modConfig.modResults.contents;

    // Injeta import se ausente
    if (!contents.includes('DefaultDevLoadingViewImplementation')) {
      contents = contents.replace(
        /(package\s+[\w\.]+)/,
        `$1\n\nimport com.facebook.react.devsupport.DefaultDevLoadingViewImplementation`
      );
    }

    // Injeta chamada dentro de onCreate
    if (!contents.includes('DefaultDevLoadingViewImplementation.setDevLoadingEnabled(false)')) {
      contents = contents.replace(
        /(super\.onCreate\(\))/,
        `$1\n    DefaultDevLoadingViewImplementation.setDevLoadingEnabled(false)`
      );
    }

    modConfig.modResults.contents = contents;
    return modConfig;
  });

  // 3. Modifica AndroidManifest para garantir AppTheme na MainActivity
  config = withAndroidManifest(config, (modConfig) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(modConfig.modResults);

    mainApplication.$['android:theme'] = '@style/AppTheme';
    mainActivity.$['android:theme'] = '@style/AppTheme';

    return modConfig;
  });

  // 4. Aplica fundo preto (#000000) na Splash Screen nativa (Android <=11 e Android 12+ values-v31)
  config = withDangerousMod(config, [
    'android',
    (modConfig) => {
      const resDir = path.join(modConfig.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
      applyBlackSplashTheme(resDir);
      return modConfig;
    },
  ]);

  return config;
};

withAndroidStartupFix.applyBlackSplashTheme = applyBlackSplashTheme;
module.exports = withAndroidStartupFix;

