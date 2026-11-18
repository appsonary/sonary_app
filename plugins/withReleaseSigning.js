const fs = require('fs');
const path = require('path');
const { withAppBuildGradle } = require('@expo/config-plugins');

const RELEASE_SIGNING_MARKER = '// [SonaryPro] Release Signing Config';

const RELEASE_SIGNING_HELPER_BLOCK = `${RELEASE_SIGNING_MARKER}
def sonaryReleaseSigningConfig = {
    def props = new Properties()
    def localPropsFile = file("../../release-signing.properties")
    if (localPropsFile.exists()) {
        localPropsFile.withInputStream { props.load(it) }
    }
    def storeFilePath = System.getenv("SONARY_UPLOAD_STORE_FILE") ?: props.getProperty("storeFile")
    def storePasswordVal = System.getenv("SONARY_UPLOAD_STORE_PASSWORD") ?: props.getProperty("storePassword")
    def keyAliasVal = System.getenv("SONARY_UPLOAD_KEY_ALIAS") ?: props.getProperty("keyAlias")
    def keyPasswordVal = System.getenv("SONARY_UPLOAD_KEY_PASSWORD") ?: props.getProperty("keyPassword")
    def resolvedStoreFile = storeFilePath ? file(storeFilePath.startsWith("/") || storeFilePath.contains(":") ? storeFilePath : "../../" + storeFilePath) : null
    def isReady = Boolean.valueOf(resolvedStoreFile != null && resolvedStoreFile.exists() && storePasswordVal && keyAliasVal && keyPasswordVal)
    return [
        ready: isReady,
        storeFile: resolvedStoreFile,
        storePassword: storePasswordVal,
        keyAlias: keyAliasVal,
        keyPassword: keyPasswordVal,
    ]
}()
`;

function patchBuildGradleSigning(contents) {
  let next = contents;

  if (!next.includes(RELEASE_SIGNING_MARKER)) {
    next = next.replace(
      /(\bandroid\s*\{)/,
      `${RELEASE_SIGNING_HELPER_BLOCK}\n$1`
    );
  }

  if (!next.includes('sonaryReleaseSigningConfig.ready) {\n            release {')) {
    next = next.replace(
      /(signingConfigs\s*\{\s*\r?\n\s*debug\s*\{[\s\S]*?\r?\n\s*\})/,
      `$1\n        if (sonaryReleaseSigningConfig.ready) {\n            release {\n                storeFile sonaryReleaseSigningConfig.storeFile\n                storePassword sonaryReleaseSigningConfig.storePassword\n                keyAlias sonaryReleaseSigningConfig.keyAlias\n                keyPassword sonaryReleaseSigningConfig.keyPassword\n            }\n        }`
    );
  }

  if (!next.includes('SONARY_REQUIRE_RELEASE_SIGNING')) {
    next = next.replace(
      /(buildTypes\s*\{[\s\S]*?\brelease\s*\{[\s\S]*?)(signingConfig\s+signingConfigs\.debug)/,
      `$1if (System.getenv("SONARY_REQUIRE_RELEASE_SIGNING") == "1" && !sonaryReleaseSigningConfig.ready) {\n                throw new GradleException("SONARY_REQUIRE_RELEASE_SIGNING=1, mas a keystore de release não foi configurada.")\n            }\n            signingConfig sonaryReleaseSigningConfig.ready ? signingConfigs.release : signingConfigs.debug`
    );
  }

  return next;
}

function applyReleaseSigningPatch(projectRoot) {
  const buildGradlePath = path.join(projectRoot, 'android', 'app', 'build.gradle');
  if (!fs.existsSync(buildGradlePath)) return false;

  const prev = fs.readFileSync(buildGradlePath, 'utf8');
  const next = patchBuildGradleSigning(prev);
  if (next === prev) return false;

  fs.writeFileSync(buildGradlePath, next, 'utf8');
  return true;
}

const withReleaseSigning = (config) => {
  return withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = patchBuildGradleSigning(modConfig.modResults.contents);
    return modConfig;
  });
};

withReleaseSigning.patchBuildGradleSigning = patchBuildGradleSigning;
withReleaseSigning.applyReleaseSigningPatch = applyReleaseSigningPatch;
module.exports = withReleaseSigning;
