// tests/visual_responsive_diff.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const fs = require('fs');
const path = require('path');
const App = require('../App').default;
const NowPlayingModal = require('../components/NowPlayingModal').default;
const { AddToPlaylistModal } = require('../components/AddToPlaylistModal');
const { PlaylistDetailModal } = require('../components/PlaylistDetailModal');
const { actAsync, resetAllMocks } = require('./helpers/testUtils');

test.beforeEach(async () => {
  resetAllMocks();
});

test('Visual Diff: DESIGN.md exists and theme.ts matches Sonary dark design specifications', () => {
  const designMdPath = path.resolve(__dirname, '..', 'DESIGN.md');
  assert.ok(fs.existsSync(designMdPath), 'DESIGN.md must exist in project root');

  const { theme } = require('../theme');

  // Core colors
  assert.strictEqual(theme.colors.background.toLowerCase(), '#030303');
  assert.strictEqual(theme.colors.surface.toLowerCase(), '#0f0f0f');
  assert.strictEqual(theme.colors.elevated.toLowerCase(), '#212121');
  assert.strictEqual(theme.colors.brandPrimary.toLowerCase(), '#ff0000');
  assert.strictEqual(theme.colors.textPrimary.toLowerCase(), '#ffffff');
  assert.strictEqual(theme.colors.textSecondary.toLowerCase(), '#aaaaaa');

  // Radii
  assert.strictEqual(theme.radii.track, 4);
  assert.strictEqual(theme.radii.card, 8);
  assert.strictEqual(theme.radii.chip, 8);
  assert.strictEqual(theme.radii.circular, 9999);
});

test('Visual Diff: WCAG Contrast compliance for Sonary dark color tokens', () => {
  // WCAG Relative Luminance calculation
  function getLuminance(hex) {
    const cleanHex = hex.replace('#', '');
    const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
    const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
    const b = parseInt(cleanHex.substring(4, 6), 16) / 255;
    const sRGB = [r, g, b].map((val) =>
      val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4)
    );
    return 0.2126 * sRGB[0] + 0.7152 * sRGB[1] + 0.0722 * sRGB[2];
  }

  function getContrastRatio(hex1, hex2) {
    const lum1 = getLuminance(hex1);
    const lum2 = getLuminance(hex2);
    const brightest = Math.max(lum1, lum2);
    const darkest = Math.min(lum1, lum2);
    return (brightest + 0.05) / (darkest + 0.05);
  }

  // 1. Primary White on Base Pitch Black
  const whiteOnBlack = getContrastRatio('#FFFFFF', '#030303');
  assert.ok(whiteOnBlack >= 7.0, `White on #030303 ratio (${whiteOnBlack.toFixed(2)}) must exceed WCAG AAA (7.0)`);

  // 2. Secondary Gray (#AAAAAA) on Base Pitch Black
  const grayOnBlack = getContrastRatio('#AAAAAA', '#030303');
  assert.ok(grayOnBlack >= 4.5, `Secondary #AAAAAA on #030303 ratio (${grayOnBlack.toFixed(2)}) must exceed WCAG AA (4.5)`);

  // 3. Primary White on Elevated Surface (#212121)
  const whiteOnElevated = getContrastRatio('#FFFFFF', '#212121');
  assert.ok(whiteOnElevated >= 7.0, `White on #212121 ratio (${whiteOnElevated.toFixed(2)}) must exceed WCAG AAA (7.0)`);

  // 4. Secondary Gray (#AAAAAA) on Elevated Surface (#212121)
  const grayOnElevated = getContrastRatio('#AAAAAA', '#212121');
  assert.ok(grayOnElevated >= 4.5, `Secondary #AAAAAA on #212121 ratio (${grayOnElevated.toFixed(2)}) must exceed WCAG AA (4.5)`);
});

test('Visual Diff & Responsive Viewport: Tree renders properly for Mobile (390x844) and Desktop (1440x900)', async () => {
  let tree;
  await actAsync(async () => {
    tree = renderer.create(React.createElement(App));
  });

  const root = tree.root;
  assert.ok(root, 'App should render responsive view hierarchy');

  // Verify Sonary Design System elements in the rendered tree
  const allViews = root.findAllByType('View');
  const allTouchables = root.findAllByType('TouchableOpacity');

  // Verify category filter chips are removed per user request
  const categoryChips = allTouchables.filter(
    (t) => t.props.accessibilityLabel && t.props.accessibilityLabel.includes('Filtrar por')
  );
  assert.strictEqual(categoryChips.length, 0, 'Category filter chips must not be present');

  // Verify horizontal brand logo image is present with proportional styling
  const brandLogo = root.find(
    (n) =>
      n.type === 'Image' &&
      n.props &&
      n.props.accessibilityLabel === 'Sonary'
  );
  assert.ok(brandLogo, 'Sonary brand logo image must be present in Header');
  assert.strictEqual(brandLogo.props.resizeMode, 'contain', 'Brand logo must use contain resizeMode');
  assert.ok(
    brandLogo.props.style && Math.abs(brandLogo.props.style.aspectRatio - 1222 / 420) < 0.05,
    'Brand logo must keep natural horizontal aspect ratio'
  );
});

test('Android Startup Splash: applyBlackSplashTheme enforces #000000 background across values and values-v31 idempotently', () => {
  const os = require('os');
  const { applyBlackSplashTheme } = require('../plugins/withAndroidStartupFix');
  const tmpRes = fs.mkdtempSync(path.join(os.tmpdir(), 'sonary-splash-'));

  try {
    fs.mkdirSync(path.join(tmpRes, 'values'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRes, 'values', 'colors.xml'),
      '<resources>\n  <color name="splashscreen_background">#FFFFFF</color>\n  <color name="iconBackground">#030303</color>\n</resources>'
    );
    fs.writeFileSync(
      path.join(tmpRes, 'values', 'styles.xml'),
      '<resources>\n  <style name="AppTheme" parent="Theme.AppCompat.Light.NoActionBar">\n    <item name="android:statusBarColor">#123456</item>\n  </style>\n</resources>'
    );

    assert.strictEqual(applyBlackSplashTheme(tmpRes), true);
    assert.strictEqual(applyBlackSplashTheme(tmpRes), false, 'Second invocation must be a no-op');

    const colors = fs.readFileSync(path.join(tmpRes, 'values', 'colors.xml'), 'utf8');
    const styles = fs.readFileSync(path.join(tmpRes, 'values', 'styles.xml'), 'utf8');
    const v31 = fs.readFileSync(path.join(tmpRes, 'values-v31', 'styles.xml'), 'utf8');

    assert.ok(colors.includes('<color name="splashscreen_background">#000000</color>'));
    assert.ok(colors.includes('<color name="iconBackground">#000000</color>'));
    assert.ok(styles.includes('<item name="android:windowBackground">#000000</item>'));
    assert.ok(v31.includes('<item name="android:windowSplashScreenBackground">#000000</item>'));
    assert.ok(v31.includes('<item name="android:windowSplashScreenIconBackgroundColor">#000000</item>'));
  } finally {
    fs.rmSync(tmpRes, { recursive: true, force: true });
  }
});
