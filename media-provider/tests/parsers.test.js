// media-provider/tests/parsers.test.js
const test = require('node:test');
const assert = require('node:assert');
const {
  extractVideoId,
  parseInnerTubeSearchResponse,
  parseInvidiousItems,
  parsePipedItems,
} = require('../parsers/searchParsers');
const {
  parseAlbumBrowsePayload,
  parseArtistBrowsePayload,
  parseMusicListTrackItem,
  pickBestThumbnail,
} = require('../parsers/browseParsers');
const { parsePlaylistPanelItems } = require('../parsers/radioParsers');
const { extractDirectMediaId } = require('../use-cases/directLink');
const { hasLetterboxArtwork } = require('../index');

test('Parsers: extractVideoId and extractDirectMediaId handle valid URLs and reject invalid input', () => {
  assert.strictEqual(extractVideoId('/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(extractDirectMediaId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(
    extractDirectMediaId('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RD123'),
    'dQw4w9WgXcQ'
  );
  assert.strictEqual(extractDirectMediaId('charlie brown jr'), null);
  assert.strictEqual(extractDirectMediaId('https://example.com/watch?v=dQw4w9WgXcQ'), null);
});

test('Parsers: parseInnerTubeSearchResponse deduplicates tracks and extracts continuation token', () => {
  const seen = new Set(['dup_1111111']);
  const res = parseInnerTubeSearchResponse(
    {
      contents: {
        sectionListRenderer: {
          contents: [
            {
              itemSectionRenderer: {
                contents: [
                  {
                    videoRenderer: {
                      videoId: 'dup_1111111',
                      title: { runs: [{ text: 'Already Seen' }] },
                      lengthText: { simpleText: '3:00' },
                    },
                  },
                  {
                    videoRenderer: {
                      videoId: 'new_2222222',
                      title: { runs: [{ text: 'Fresh Track' }] },
                      longBylineText: { runs: [{ text: 'Cool Artist' }] },
                      lengthText: { simpleText: '4:15' },
                    },
                  },
                  {
                    continuationItemRenderer: {
                      continuationEndpoint: {
                        continuationCommand: { token: 'NEXT_TOKEN_42' },
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    },
    seen
  );

  assert.strictEqual(res.tracks.length, 1);
  assert.strictEqual(res.tracks[0].id, 'new_2222222');
  assert.strictEqual(res.tracks[0].duration, 255);
  assert.strictEqual(res.continuationToken, 'NEXT_TOKEN_42');
});

test('Parsers: parsePipedItems and parseInvidiousItems normalize valid tracks and skip non-streams', () => {
  const seen = new Set();
  const piped = parsePipedItems(
    [
      { type: 'channel', url: '/channel/UC123', title: 'Skip Me' },
      { type: 'stream', url: '/watch?v=abc12345678', title: 'Song A', uploaderName: 'Art A', duration: 200 },
    ],
    seen
  );
  assert.strictEqual(piped.length, 1);
  assert.strictEqual(piped[0].id, 'abc12345678');

  const inv = parseInvidiousItems(
    [
      { videoId: 'abc12345678', title: 'Duplicate', author: 'Art A', lengthSeconds: 200 },
      { videoId: 'xyz98765432', title: 'Song B', author: 'Art B', lengthSeconds: 185 },
    ],
    seen
  );
  assert.strictEqual(inv.length, 1);
  assert.strictEqual(inv[0].id, 'xyz98765432');
  assert.strictEqual(inv[0].formattedDuration, '3:05');
});

test('Parsers: parsePlaylistPanelItems excludes seed track and filters shorts', () => {
  const parsed = parsePlaylistPanelItems(
    [
      {
        playlistPanelVideoRenderer: {
          videoId: 'seed_123456',
          title: { runs: [{ text: 'Seed Song' }] },
          shortBylineText: { runs: [{ text: 'Seed Artist' }] },
          lengthText: { simpleText: '3:20' },
        },
      },
      {
        playlistPanelVideoRenderer: {
          videoId: 'short_12345',
          title: { runs: [{ text: 'Short Clip #shorts' }] },
          shortBylineText: { runs: [{ text: 'Clipper' }] },
          lengthText: { simpleText: '0:25' },
        },
      },
      {
        playlistPanelVideoRenderer: {
          videoId: 'valid_12345',
          title: { runs: [{ text: 'Next Valid Song' }] },
          shortBylineText: { runs: [{ text: 'Next Artist' }] },
          lengthText: { simpleText: '3:45' },
        },
      },
    ],
    'seed_123456'
  );

  assert.strictEqual(parsed.seedTitle, 'Seed Song');
  assert.strictEqual(parsed.seedArtist, 'Seed Artist');
  assert.strictEqual(parsed.tracks.length, 1);
  assert.strictEqual(parsed.tracks[0].id, 'valid_12345');
  assert.strictEqual(hasLetterboxArtwork('https://i.ytimg.com/vi/abc/hqdefault.jpg'), true);
  assert.strictEqual(hasLetterboxArtwork('https://cdn.example.com/square.jpg'), false);
});

test('Parsers: browseParsers picks best thumbnail and parses track items with allowShortTracks', () => {
  assert.strictEqual(
    pickBestThumbnail(
      [
        { url: 'https://img/240.jpg', width: 240 },
        { url: 'https://img/544.jpg', width: 544 },
        { url: 'https://img/1200.jpg', width: 1200 },
      ],
      600
    ),
    'https://img/544.jpg'
  );
  assert.strictEqual(pickBestThumbnail([]), '');

  const shortIntroRenderer = {
    playlistItemData: { videoId: 'intro_12345' },
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Intro' }] } } },
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: {
            runs: [
              {
                text: 'Band X',
                navigationEndpoint: { browseEndpoint: { browseId: 'UCbandx123' } },
              },
              { text: ' • ' },
              {
                text: 'Album Y',
                navigationEndpoint: { browseEndpoint: { browseId: 'MPREb_albumY' } },
              },
            ],
          },
        },
      },
    ],
    fixedColumns: [
      { musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: '0:32' }] } } },
    ],
  };

  assert.strictEqual(parseMusicListTrackItem(shortIntroRenderer, 'Fallback'), null);
  const allowed = parseMusicListTrackItem(shortIntroRenderer, 'Fallback', {
    allowShortTracks: true,
  });
  assert.ok(allowed);
  assert.strictEqual(allowed.id, 'intro_12345');
  assert.strictEqual(allowed.artist, 'Band X');
  assert.strictEqual(allowed.album, 'Album Y');
  assert.strictEqual(allowed.duration, 32);
});

test('Parsers: parseArtistBrowsePayload and parseAlbumBrowsePayload extract shelves and headers', () => {
  const artistData = {
    contents: {
      singleColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    {
                      musicShelfRenderer: {
                        bottomEndpoint: {
                          browseEndpoint: { browseId: 'VLOLAK_top', params: 'p_top' },
                        },
                        contents: [
                          {
                            musicResponsiveListItemRenderer: {
                              playlistItemData: { videoId: 'trk_1111111' },
                              flexColumns: [
                                {
                                  musicResponsiveListItemFlexColumnRenderer: {
                                    text: { runs: [{ text: 'Hit Song' }] },
                                  },
                                },
                              ],
                              fixedColumns: [
                                {
                                  musicResponsiveListItemFixedColumnRenderer: {
                                    text: { runs: [{ text: '3:40' }] },
                                  },
                                },
                              ],
                            },
                          },
                        ],
                      },
                    },
                    {
                      musicCarouselShelfRenderer: {
                        header: {
                          musicCarouselShelfBasicHeaderRenderer: {
                            title: { runs: [{ text: 'Álbuns' }] },
                          },
                        },
                        contents: [
                          {
                            musicTwoRowItemRenderer: {
                              title: { runs: [{ text: 'Studio LP' }] },
                              subtitle: { runs: [{ text: 'Álbum • 2023' }] },
                              navigationEndpoint: {
                                browseEndpoint: { browseId: 'MPREb_lp2023' },
                              },
                            },
                          },
                        ],
                      },
                    },
                    {
                      musicCarouselShelfRenderer: {
                        header: {
                          musicCarouselShelfBasicHeaderRenderer: {
                            title: { runs: [{ text: 'Singles e EPs' }] },
                          },
                        },
                        contents: [
                          {
                            musicTwoRowItemRenderer: {
                              title: { runs: [{ text: 'Mini EP' }] },
                              subtitle: { runs: [{ text: 'EP • 2024' }] },
                              navigationEndpoint: {
                                browseEndpoint: { browseId: 'MPREb_ep2024' },
                              },
                            },
                          },
                        ],
                      },
                    },
                    {
                      musicCarouselShelfRenderer: {
                        header: {
                          musicCarouselShelfBasicHeaderRenderer: {
                            title: { runs: [{ text: 'Fãs também podem gostar' }] },
                          },
                        },
                        contents: [
                          {
                            musicTwoRowItemRenderer: {
                              title: { runs: [{ text: 'Similar Artist' }] },
                              subtitle: { runs: [{ text: '1M ouvintes' }] },
                              navigationEndpoint: {
                                browseEndpoint: { browseId: 'UCsimilar123' },
                              },
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };

  const parsedArtist = parseArtistBrowsePayload(artistData, 'Main Artist');
  assert.strictEqual(parsedArtist.songsBrowseId, 'VLOLAK_top');
  assert.strictEqual(parsedArtist.songsBrowseParams, 'p_top');
  assert.strictEqual(parsedArtist.topTracks.length, 1);
  assert.strictEqual(parsedArtist.topTracks[0].artist, 'Main Artist');
  assert.strictEqual(parsedArtist.albums.length, 1);
  assert.strictEqual(parsedArtist.albums[0].year, '2023');
  assert.strictEqual(parsedArtist.albums[0].type, 'album');
  assert.strictEqual(parsedArtist.singles.length, 1);
  assert.strictEqual(parsedArtist.singles[0].type, 'ep');
  assert.strictEqual(parsedArtist.relatedArtists.length, 1);
  assert.strictEqual(parsedArtist.relatedArtists[0].id, 'UCsimilar123');

  const albumData = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    {
                      musicResponsiveHeaderRenderer: {
                        title: { runs: [{ text: 'Studio LP' }] },
                        straplineTextOne: { runs: [{ text: 'Main Artist' }] },
                        subtitle: { runs: [{ text: 'Álbum • 2023' }] },
                        thumbnail: {
                          musicThumbnailRenderer: {
                            thumbnail: {
                              thumbnails: [{ url: 'https://img/album544.jpg', width: 544 }],
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
        secondaryContents: {
          sectionListRenderer: {
            contents: [
              {
                musicShelfRenderer: {
                  contents: [
                    {
                      musicResponsiveListItemRenderer: {
                        playlistItemData: { videoId: 'alb_short01' },
                        flexColumns: [
                          {
                            musicResponsiveListItemFlexColumnRenderer: {
                              text: { runs: [{ text: 'Short Prelude' }] },
                            },
                          },
                        ],
                        fixedColumns: [
                          {
                            musicResponsiveListItemFixedColumnRenderer: {
                              text: { runs: [{ text: '0:28' }] },
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  };

  const parsedAlbum = parseAlbumBrowsePayload(albumData, {
    title: 'Fallback',
    artist: 'Fallback Artist',
    type: 'single',
    thumbnailUrl: '',
  });
  assert.strictEqual(parsedAlbum.title, 'Studio LP');
  assert.strictEqual(parsedAlbum.artist, 'Main Artist');
  assert.strictEqual(parsedAlbum.year, '2023');
  assert.strictEqual(parsedAlbum.type, 'album');
  assert.strictEqual(parsedAlbum.thumbnailUrl, 'https://img/album544.jpg');
  assert.strictEqual(parsedAlbum.tracks.length, 1);
  assert.strictEqual(parsedAlbum.tracks[0].album, 'Studio LP');
  assert.strictEqual(parsedAlbum.tracks[0].thumbnailUrl, 'https://img/album544.jpg');
});
