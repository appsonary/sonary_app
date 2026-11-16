// tests/spotify_mini_player.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const {
  PersistentMiniPlayer,
  getDominantTrackColor,
  SPOTIFY_DARK_PALETTES,
} = require('../components/PersistentMiniPlayer');
const { actAsync, findButtonByIcon, getAllText, resetAllMocks } = require('./helpers/testUtils');

test.beforeEach(async () => {
  resetAllMocks();
});

test('Spotify Mini Player: getDominantTrackColor extracts dynamic dark background colors', () => {
  // Test distinct track seeds produce valid deep dark tones
  const colorNavy = getDominantTrackColor('https://example.com/blue_cover.jpg', 'track_1', 'Still Yours');
  const colorForest = getDominantTrackColor('https://example.com/forest.jpg', 'track_2', 'Chill Green');
  const colorBurgundy = getDominantTrackColor('https://example.com/red_love.jpg', 'track_3', 'Red Love');
  const colorPlum = getDominantTrackColor('https://example.com/violet.jpg', 'track_4', 'Starboy');

  assert.strictEqual(colorNavy, '#132438', 'Blue/Navy track should get Spotify deep midnight navy');
  assert.strictEqual(colorForest, '#0e2d24', 'Green track should get Spotify deep forest emerald');
  assert.strictEqual(colorBurgundy, '#351419', 'Red track should get Spotify deep wine burgundy');
  assert.strictEqual(colorPlum, '#2a1435', 'Purple track should get Spotify deep velvet violet');

  // Verify all palette colors are valid hex colors
  for (const hex of SPOTIFY_DARK_PALETTES) {
    assert.match(hex, /^#[0-9a-fA-F]{6}$/, `${hex} must be a valid 6-digit hex color`);
  }
});

test('Spotify Mini Player: Renders floating card with dynamic background, bottom progress bar and Spotify controls', async () => {
  let playToggled = false;
  let favoriteToggled = false;
  let expanded = false;

  const sampleTrack = {
    id: 'bryson_1',
    title: 'Still Yours (feat. Big Sean)',
    artist: 'Bryson Tiller, Big Sean',
    duration: 215,
    artwork: 'https://example.com/stillyours_blue.jpg',
  };

  let tree;
  await actAsync(async () => {
    tree = renderer.create(
      React.createElement(PersistentMiniPlayer, {
        activeTrack: sampleTrack,
        isPlaying: true,
        isLoadingAudio: false,
        isBuffering: false,
        isFavorite: true,
        progressPct: 40,
        onExpand: () => {
          expanded = true;
        },
        onTogglePlay: () => {
          playToggled = true;
        },
        onSkipNext: () => {},
        onSkipPrevious: () => {},
        onToggleFavorite: () => {
          favoriteToggled = true;
        },
      })
    );
  });

  const root = tree.root;
  assert.ok(root, 'Mini player should render');

  // Verify text content: Title and Artist
  const text = getAllText(root);
  assert.ok(text.includes('Still Yours'), 'Title must be rendered');
  assert.ok(text.includes('Bryson Tiller'), 'Artist must be rendered');

  // Verify dynamic background color on root card
  const touchables = root.findAllByType('TouchableOpacity');
  const card = touchables[0];
  const flattenedStyle = Object.assign({}, ...[].concat(card.props.style).filter(Boolean));
  assert.strictEqual(flattenedStyle.backgroundColor, '#132438', 'Background color should dynamically match album palette');
  assert.strictEqual(flattenedStyle.borderRadius, 8, 'Mini player must have floating card rounded corners');
  assert.strictEqual(flattenedStyle.marginHorizontal, 8, 'Mini player must have horizontal margin (floating card)');

  // Verify device connect button is omitted (no unlinked device pairing)
  const deviceBtn = findButtonByIcon(root, 'Laptop2');
  assert.strictEqual(deviceBtn, null, 'Device connect button must not be present when pairing feature is inactive');

  // Verify Favorite Heart button exists, is red (#FF0000) when active, and toggles
  const favBtn = findButtonByIcon(root, 'Heart');
  assert.ok(favBtn, 'Favorite button must exist');
  const heartIcon = favBtn.find((n) => n.type === 'LucideIcon' && n.props.name === 'Heart');
  assert.strictEqual(heartIcon.props.color, '#FF0000', 'Favorite heart color must be red (#FF0000)');
  assert.strictEqual(heartIcon.props.fill, '#FF0000', 'Favorite heart fill must be red (#FF0000)');
  await actAsync(async () => {
    favBtn.props.onPress({ stopPropagation: () => {} });
  });
  assert.strictEqual(favoriteToggled, true, 'Pressing favorite should trigger callback');

  // Verify Play/Pause button
  const pauseBtn = findButtonByIcon(root, 'Pause');
  assert.ok(pauseBtn, 'Pause icon button must be rendered when playing');
  await actAsync(async () => {
    pauseBtn.props.onPress({ stopPropagation: () => {} });
  });
  assert.strictEqual(playToggled, true, 'Pressing play/pause should trigger callback');
});

