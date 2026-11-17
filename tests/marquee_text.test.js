// tests/marquee_text.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const renderer = require('react-test-renderer');
const { MarqueeText, TrackMetaRow } = require('../components/MarqueeText');
const { TrackCard } = require('../components/TrackCard');
const { PersistentMiniPlayer } = require('../components/PersistentMiniPlayer');
const { QuickPicksSection } = require('../components/QuickPicksSection');
const { PlaylistDetailModal } = require('../components/PlaylistDetailModal');
const { ArtistProfileModal } = require('../components/ArtistProfileModal');
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

test('TrackMetaRow & standardized rows: artist truncates/marquees on left while duration stays fixed on right', async () => {
  const longArtist = 'Richy Mitch & The Coal Miners - Topic Featuring Very Long Ensemble';

  // 1. MarqueeText inactive with containerStyle keeps flex container constraints and tail ellipsis
  let constrainedTree;
  await actAsync(async () => {
    constrainedTree = renderer.create(
      React.createElement(
        MarqueeText,
        { active: false, containerStyle: { flex: 1, minWidth: 0 } },
        longArtist
      )
    );
  });
  const constrainedViews = constrainedTree.root.findAllByType('View');
  assert.strictEqual(constrainedViews.length, 1);
  const flatContainerStyle = Object.assign({}, ...[].concat(constrainedViews[0].props.style));
  assert.strictEqual(flatContainerStyle.flex, 1);
  assert.strictEqual(flatContainerStyle.minWidth, 0);
  const constrainedText = constrainedTree.root.findAllByType('Text')[0];
  assert.strictEqual(constrainedText.props.numberOfLines, 1);
  assert.strictEqual(constrainedText.props.ellipsizeMode, 'tail');

  // 2. TrackCard (Baixadas/Offline): separates artist from duration and omits "• Offline"
  let offlineCardTree;
  await actAsync(async () => {
    offlineCardTree = renderer.create(
      React.createElement(TrackCard, {
        id: 'off_1',
        title: 'Swiss Woods',
        artist: longArtist,
        durationText: '2:19',
        isOfflineList: true,
        isActive: false,
        onPress: () => {},
      })
    );
  });
  const offMetaRow = offlineCardTree.root.findByType(TrackMetaRow);
  assert.strictEqual(offMetaRow.props.artistText, longArtist);
  assert.strictEqual(offMetaRow.props.durationText, undefined);
  assert.strictEqual(offMetaRow.props.active, false);
  const offTexts = offlineCardTree.root
    .findAllByType('Text')
    .map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children || '')));
  assert.ok(offTexts.includes('2:19'), 'Duration must render as standalone Text aligned on the row');
  assert.ok(!offTexts.some((t) => t.includes('Offline')), 'Offline suffix must not be appended');
  assert.strictEqual(
    offlineCardTree.root.findAll((n) => n.type === 'LucideIcon' && n.props.name === 'Folder').length,
    0,
    'Offline list card must not repeat redundant Folder badge'
  );

  // 2b. TrackCard (Search): shows green Folder badge when isDownloaded=true
  let searchDownloadedCardTree;
  await actAsync(async () => {
    searchDownloadedCardTree = renderer.create(
      React.createElement(TrackCard, {
        id: 'search_dl_1',
        title: 'Next To You',
        artist: 'BrysonTillerVEVO',
        durationText: '3:10',
        isDownloaded: true,
        onPress: () => {},
      })
    );
  });
  const searchDlFolder = searchDownloadedCardTree.root.find(
    (n) => n.type === 'LucideIcon' && n.props.name === 'Folder'
  );
  assert.strictEqual(searchDlFolder.props.color, '#2BA640');
  assert.ok(
    searchDownloadedCardTree.root.find((n) => n.type === 'View' && n.props.accessibilityLabel === 'Baixada')
  );

  // 3. PlaylistDetailModal: icon-only badge (Globe / Folder) + artist marquee/ellipsis + centered duration
  const pl = await createPlaylist('To Canada');
  await addTrackToPlaylist(pl.id, {
    id: 'pl_long_1',
    title: 'Swiss Woods',
    artist: longArtist,
    duration: 139,
    thumbnailUrl: '',
  });
  await addTrackToPlaylist(pl.id, {
    id: 'pl_long_2',
    title: 'Fade Into You',
    artist: 'Richy Mitch & The Coal Miners',
    duration: 286,
    thumbnailUrl: '',
  });
  let plTree;
  await actAsync(async () => {
    plTree = renderer.create(
      React.createElement(PlaylistDetailModal, {
        visible: true,
        onClose: () => {},
        playlistId: pl.id,
        currentActiveTrackId: 'pl_long_1',
        downloadedTrackIds: new Set(['pl_long_2']),
        isPlaying: true,
        onPlayTrack: () => {},
      })
    );
  });
  const plMetaRows = plTree.root.findAllByType(TrackMetaRow);
  assert.strictEqual(plMetaRows[0].props.artistText, longArtist);
  assert.strictEqual(plMetaRows[0].props.durationText, undefined);
  assert.strictEqual(plMetaRows[0].props.active, true);
  assert.strictEqual(plMetaRows[1].props.artistText, 'Richy Mitch & The Coal Miners');
  assert.strictEqual(plMetaRows[1].props.active, false);
  const plTexts = plTree.root
    .findAllByType('Text')
    .map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children || '')));
  assert.ok(plTexts.includes('2:19'), 'Playlist track duration must render as standalone Text');
  assert.ok(plTexts.includes('4:46'), 'Playlist track duration must render as standalone Text');
  assert.ok(!plTexts.includes('Stream') && !plTexts.includes('Baixada'), 'Status badges must be icon-only');
  assert.strictEqual(
    plTree.root.findAll((n) => n.type === 'LucideIcon' && n.props.name === 'Globe').length,
    1
  );
  assert.strictEqual(
    plTree.root.findAll((n) => n.type === 'LucideIcon' && n.props.name === 'Folder').length,
    1
  );

  // 4. QuickPicksSection, NowPlayingModal (Relacionados) and ArtistProfileModal (Populares)
  let qpTree;
  await actAsync(async () => {
    qpTree = renderer.create(
      React.createElement(QuickPicksSection, {
        tracks: [{ id: 'qp_long', title: 'Track', artist: longArtist, formattedDuration: '4:46', thumbnailUrl: '' }],
        activeTrackId: 'other',
        downloadedTrackIds: new Set(['qp_long']),
        onSelectTrack: () => {},
      })
    );
  });
  assert.strictEqual(
    qpTree.root.find((n) => n.type === 'LucideIcon' && n.props.name === 'Folder').props.color,
    '#2BA640'
  );
  const qpMetaRow = qpTree.root.findByType(TrackMetaRow);
  assert.strictEqual(qpMetaRow.props.artistText, longArtist);
  assert.strictEqual(qpMetaRow.props.durationText, undefined);
  assert.strictEqual(qpMetaRow.props.active, false);
  const qpTexts = qpTree.root
    .findAllByType('Text')
    .map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children || '')));
  assert.ok(qpTexts.includes('4:46'));

  let relTree;
  await actAsync(async () => {
    relTree = renderer.create(
      React.createElement(NowPlayingModal, {
        visible: true,
        onClose: () => {},
        track: { id: 'curr_1', url: '', title: 'Curr', artist: 'A', duration: 100 },
        isPlaying: true,
        isBuffering: false,
        onTogglePlay: () => {},
        onSkipNext: () => {},
        onSkipPrevious: () => {},
        relatedTracks: [{ id: 'rel_1', title: 'Rel', artist: longArtist, duration: 220, formattedDuration: '3:40', thumbnailUrl: '' }],
      })
    );
  });
  const relMetaRow = relTree.root.findByType(TrackMetaRow);
  assert.strictEqual(relMetaRow.props.artistText, longArtist);
  assert.strictEqual(relMetaRow.props.durationText, undefined);
  assert.strictEqual(relMetaRow.props.active, false);
  const relTexts = relTree.root
    .findAllByType('Text')
    .map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children || '')));
  assert.ok(relTexts.includes('3:40'));

  let artistTree;
  await actAsync(async () => {
    artistTree = renderer.create(
      React.createElement(ArtistProfileModal, {
        visible: true,
        onClose: () => {},
        artistName: 'Richy Mitch',
        initialProfile: {
          name: 'Richy Mitch',
          avatarUrl: '',
          topTracks: [{ id: 'top_1', title: 'Fade Into You', artist: longArtist, duration: 286, formattedDuration: '4:46', thumbnailUrl: '' }],
          albums: [],
          singles: [],
        },
        onPlayTrack: () => {},
        onStartArtistRadio: () => {},
      })
    );
  });
  const artistMetaRow = artistTree.root.findByType(TrackMetaRow);
  assert.strictEqual(artistMetaRow.props.artistText, longArtist);
  assert.strictEqual(artistMetaRow.props.durationText, undefined);
  const artistTexts = artistTree.root
    .findAllByType('Text')
    .map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children || '')));
  assert.ok(artistTexts.includes('4:46'));
});

