// tests/marquee_text.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const renderer = require('react-test-renderer');
const { MarqueeText } = require('../components/MarqueeText');
const { TrackCard } = require('../components/TrackCard');
const { PersistentMiniPlayer } = require('../components/PersistentMiniPlayer');
const { QuickPicksSection } = require('../components/QuickPicksSection');
const { PlaylistDetailModal } = require('../components/PlaylistDetailModal');
const NowPlayingModal = require('../components/NowPlayingModal').default;
const { initDatabase, createPlaylist, addTrackToPlaylist } = require('../services/database');
const { actAsync, resetAllMocks } = require('./helpers/testUtils');

test.beforeEach(async () => {
  resetAllMocks();
  await initDatabase();
});

test('MarqueeText: animates strictly when active and text overflows container, using native driver only', async () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', 'components', 'MarqueeText.tsx'),
    'utf8'
  );
  assert.strictEqual(
    /useNativeDriver\s*:\s*false/.test(src),
    false,
    'MarqueeText must never use useNativeDriver: false'
  );

  // 1. Inactive -> static single Text node, no probe or marquee
  let inactiveTree;
  await actAsync(async () => {
    inactiveTree = renderer.create(
      React.createElement(MarqueeText, { active: false }, 'Very Long Inactive Song Title')
    );
  });
  assert.strictEqual(inactiveTree.root.findAllByType('Text').length, 1);

  // 2. Active & text fits container -> no marquee overlay (2 Texts: visible + measure probe)
  let activeTree;
  await actAsync(async () => {
    activeTree = renderer.create(
      React.createElement(MarqueeText, { active: true }, 'Short Title')
    );
  });
  const containerView = activeTree.root.findAllByType('View')[0];
  const probeText = activeTree.root.findAllByType('Text')[1];

  await actAsync(async () => {
    containerView.props.onLayout({ nativeEvent: { layout: { width: 220 } } });
    probeText.props.onLayout({ nativeEvent: { layout: { width: 90 } } });
  });
  assert.strictEqual(
    activeTree.root.findAllByType('Text').length,
    2,
    'Short active text must stay static without marquee copies'
  );

  // 3. Active & text overflows container -> mounts 2 marquee Text copies (total 4 Texts)
  await actAsync(async () => {
    activeTree.update(
      React.createElement(
        MarqueeText,
        { active: true },
        'Kate Bush - Running Up That Hill (A Deal With God)'
      )
    );
  });
  const updatedProbe = activeTree.root.findAllByType('Text')[1];
  await actAsync(async () => {
    updatedProbe.props.onLayout({ nativeEvent: { layout: { width: 420 } } });
  });
  assert.strictEqual(
    activeTree.root.findAllByType('Text').length,
    4,
    'Overflowing active text must render circular marquee copies'
  );

  // 4. Switching back to inactive clears marquee copies immediately
  await actAsync(async () => {
    activeTree.update(
      React.createElement(
        MarqueeText,
        { active: false },
        'Kate Bush - Running Up That Hill (A Deal With God)'
      )
    );
  });
  assert.strictEqual(activeTree.root.findAllByType('Text').length, 1);
});

test('MarqueeText integration: active track title & artist wire MarqueeText across Player, MiniPlayer, TrackCard, QuickPicks and PlaylistDetailModal', async () => {
  const longTitle = 'Super Extensive Active Song Title That Must Scroll Smoothly';
  const longArtist = 'Super Extensive Artist Name Featuring Special Guests';

  // PersistentMiniPlayer
  let miniTree;
  await actAsync(async () => {
    miniTree = renderer.create(
      React.createElement(PersistentMiniPlayer, {
        activeTrack: {
          id: 'mq_1',
          url: 'https://example.com/1.mp4',
          title: longTitle,
          artist: longArtist,
          artwork: '',
          duration: 210,
        },
        isPlaying: true,
        isLoadingAudio: false,
        isBuffering: false,
        progressPct: 30,
        onExpand: () => {},
        onTogglePlay: () => {},
        onSkipNext: () => {},
        onSkipPrevious: () => {},
      })
    );
  });
  const miniMarquees = miniTree.root.findAllByType(MarqueeText);
  assert.strictEqual(miniMarquees.length, 2);
  assert.ok(miniMarquees.every((m) => m.props.active === true));

  // TrackCard (active vs inactive)
  let cardTree;
  await actAsync(async () => {
    cardTree = renderer.create(
      React.createElement(TrackCard, {
        id: 'mq_1',
        title: longTitle,
        artist: longArtist,
        isActive: true,
        isPlaying: true,
        onPress: () => {},
      })
    );
  });
  assert.ok(
    cardTree.root.findAllByType(MarqueeText).every((m) => m.props.active === true),
    'Active TrackCard title & artist enable MarqueeText'
  );

  await actAsync(async () => {
    cardTree.update(
      React.createElement(TrackCard, {
        id: 'mq_1',
        title: longTitle,
        artist: longArtist,
        isActive: false,
        isPlaying: true,
        onPress: () => {},
      })
    );
  });
  assert.ok(
    cardTree.root.findAllByType(MarqueeText).every((m) => m.props.active === false),
    'Inactive TrackCard keeps MarqueeText disabled'
  );

  // QuickPicksSection (active only on matching track)
  let qpTree;
  await actAsync(async () => {
    qpTree = renderer.create(
      React.createElement(QuickPicksSection, {
        tracks: [
          { id: 'qp_1', title: longTitle, artist: longArtist, thumbnailUrl: '' },
          { id: 'qp_2', title: 'Other Song', artist: 'Other Artist', thumbnailUrl: '' },
        ],
        activeTrackId: 'qp_1',
        isPlaying: true,
        onSelectTrack: () => {},
      })
    );
  });
  const qpMarquees = qpTree.root.findAllByType(MarqueeText);
  assert.strictEqual(qpMarquees.filter((m) => m.props.active === true).length, 2);
  assert.strictEqual(qpMarquees.filter((m) => m.props.active === false).length, 2);

  // PlaylistDetailModal (active only on matching track)
  const pl = await createPlaylist('Marquee Playlist');
  await addTrackToPlaylist(pl.id, {
    id: 'pl_mq_1',
    title: longTitle,
    artist: longArtist,
    duration: 200,
    formattedDuration: '3:20',
    thumbnailUrl: '',
  });
  await addTrackToPlaylist(pl.id, {
    id: 'pl_mq_2',
    title: 'Second Song',
    artist: 'Second Artist',
    duration: 180,
    formattedDuration: '3:00',
    thumbnailUrl: '',
  });

  let plTree;
  await actAsync(async () => {
    plTree = renderer.create(
      React.createElement(PlaylistDetailModal, {
        visible: true,
        onClose: () => {},
        playlistId: pl.id,
        currentActiveTrackId: 'pl_mq_1',
        isPlaying: true,
        onPlayTrack: () => {},
      })
    );
  });
  const plMarquees = plTree.root.findAllByType(MarqueeText);
  assert.strictEqual(plMarquees.filter((m) => m.props.active === true).length, 2);
  assert.strictEqual(plMarquees.filter((m) => m.props.active === false).length, 2);

  // NowPlayingModal header + queue active item
  let npTree;
  await actAsync(async () => {
    npTree = renderer.create(
      React.createElement(NowPlayingModal, {
        visible: true,
        onClose: () => {},
        track: {
          id: 'mq_1',
          url: 'https://example.com/1.mp4',
          title: longTitle,
          artist: longArtist,
          artwork: '',
          duration: 210,
        },
        isPlaying: true,
        isBuffering: false,
        onTogglePlay: () => {},
        onSkipNext: () => {},
        onSkipPrevious: () => {},
        onSeekRelative: () => {},
      })
    );
  });
  const npMarquees = npTree.root.findAllByType(MarqueeText);
  assert.ok(npMarquees.length >= 2);
  assert.ok(npMarquees.every((m) => m.props.active === true));
});

