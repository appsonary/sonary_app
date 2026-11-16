// tests/mocks/trackPlayerMock.js
const EventEmitter = require('events');

const State = {
  None: 'none',
  Ready: 'ready',
  Playing: 'playing',
  Paused: 'paused',
  Stopped: 'stopped',
  Loading: 'loading',
  Connecting: 'loading',
  Buffering: 'buffering',
  Error: 'error',
  Ended: 'ended',
};

const Event = {
  PlayerError: 'player-error',
  PlaybackState: 'playback-state',
  PlaybackError: 'playback-error',
  PlaybackQueueEnded: 'playback-queue-ended',
  PlaybackTrackChanged: 'playback-track-changed',
  PlaybackActiveTrackChanged: 'playback-active-track-changed',
  PlaybackMetadataReceived: 'playback-metadata-received',
  PlaybackPlayWhenReadyChanged: 'playback-play-when-ready-changed',
  PlaybackProgressUpdated: 'playback-progress-updated',
  RemotePlay: 'remote-play',
  RemotePause: 'remote-pause',
  RemoteStop: 'remote-stop',
  RemoteNext: 'remote-next',
  RemotePrevious: 'remote-previous',
  RemoteSeek: 'remote-seek',
};

const Capability = {
  Play: 0,
  Pause: 1,
  Stop: 2,
  SkipToNext: 3,
  SkipToPrevious: 4,
  SeekTo: 5,
  JumpForward: 6,
  JumpBackward: 7,
};

const AppKilledPlaybackBehavior = {
  StopPlaybackAndRemoveNotification: 'stop-playback-and-remove-notification',
  ContinuePlayback: 'continue-playback',
  PausePlayback: 'pause-playback',
};

const RepeatMode = {
  Off: 0,
  Track: 1,
  Queue: 2,
};

class TrackPlayerMock extends EventEmitter {
  constructor() {
    super();
    this.resetState();
  }

  resetState() {
    this.isInitialized = false;
    this.state = State.None;
    this.queue = [];
    this.activeTrackIndex = -1;
    this.position = 0;
    this.duration = 180;
    this.repeatMode = RepeatMode.Off;
    this.volume = 1.0;
    this.options = null;
    this.callLog = [];
    this.removeAllListeners();
  }

  async setupPlayer(options) {
    this.callLog.push({ method: 'setupPlayer', options });
    this.isInitialized = true;
    return true;
  }

  async updateOptions(options) {
    this.callLog.push({ method: 'updateOptions', options });
    this.options = options;
  }

  async reset() {
    this.callLog.push({ method: 'reset' });
    this.queue = [];
    this.activeTrackIndex = -1;
    this.state = State.None;
    this.position = 0;
    this.emit(Event.PlaybackState, { state: State.None });
    this.emit(Event.PlaybackActiveTrackChanged, { index: -1, track: null });
  }

  async add(tracks, insertBeforeIndex) {
    const list = Array.isArray(tracks) ? tracks : [tracks];
    this.callLog.push({ method: 'add', tracks: list, insertBeforeIndex });
    if (
      insertBeforeIndex !== undefined &&
      insertBeforeIndex >= 0 &&
      insertBeforeIndex <= this.queue.length
    ) {
      this.queue.splice(insertBeforeIndex, 0, ...list);
      if (this.activeTrackIndex !== -1 && insertBeforeIndex <= this.activeTrackIndex) {
        this.activeTrackIndex += list.length;
      }
    } else {
      this.queue.push(...list);
    }
    if (this.activeTrackIndex === -1 && this.queue.length > 0) {
      this.activeTrackIndex = 0;
      this.duration = this.queue[0].duration || 180;
      this.emit(Event.PlaybackActiveTrackChanged, {
        index: 0,
        track: this.queue[0],
      });
    }
  }

  async remove(indexOrIndices) {
    this.callLog.push({ method: 'remove', indexOrIndices });
    const indices = Array.isArray(indexOrIndices) ? indexOrIndices : [indexOrIndices];
    const sorted = [...indices].sort((a, b) => b - a);
    for (const idx of sorted) {
      if (idx >= 0 && idx < this.queue.length) {
        this.queue.splice(idx, 1);
        if (this.activeTrackIndex > idx) {
          this.activeTrackIndex -= 1;
        }
      }
    }
  }

  async move(fromIndex, toIndex) {
    this.callLog.push({ method: 'move', fromIndex, toIndex });
    if (
      fromIndex >= 0 &&
      fromIndex < this.queue.length &&
      toIndex >= 0 &&
      toIndex < this.queue.length
    ) {
      const [item] = this.queue.splice(fromIndex, 1);
      this.queue.splice(toIndex, 0, item);
      if (this.activeTrackIndex === fromIndex) {
        this.activeTrackIndex = toIndex;
      } else if (fromIndex < this.activeTrackIndex && toIndex >= this.activeTrackIndex) {
        this.activeTrackIndex -= 1;
      } else if (fromIndex > this.activeTrackIndex && toIndex <= this.activeTrackIndex) {
        this.activeTrackIndex += 1;
      }
    }
  }

  async play() {
    this.callLog.push({ method: 'play' });
    this.state = State.Playing;
    this.emit(Event.PlaybackState, { state: State.Playing });
  }

  async pause() {
    this.callLog.push({ method: 'pause' });
    this.state = State.Paused;
    this.emit(Event.PlaybackState, { state: State.Paused });
  }

  async skip(index) {
    this.callLog.push({ method: 'skip', index });
    if (index >= 0 && index < this.queue.length) {
      this.activeTrackIndex = index;
      this.position = 0;
      this.duration = this.queue[index].duration || 180;
      this.emit(Event.PlaybackActiveTrackChanged, {
        index,
        track: this.queue[index],
      });
    } else {
      throw new Error(`Index ${index} out of queue bounds`);
    }
  }

  async skipToNext() {
    this.callLog.push({ method: 'skipToNext' });
    if (this.activeTrackIndex >= 0 && this.activeTrackIndex < this.queue.length - 1) {
      this.activeTrackIndex += 1;
      this.position = 0;
      this.duration = this.queue[this.activeTrackIndex].duration || 180;
      this.emit(Event.PlaybackActiveTrackChanged, {
        index: this.activeTrackIndex,
        track: this.queue[this.activeTrackIndex],
      });
      return true;
    }
    throw new Error('End of queue');
  }

  async skipToPrevious() {
    this.callLog.push({ method: 'skipToPrevious' });
    if (this.position > 3) {
      this.position = 0;
      return true;
    }
    if (this.activeTrackIndex > 0) {
      this.activeTrackIndex -= 1;
      this.position = 0;
      this.duration = this.queue[this.activeTrackIndex].duration || 180;
      this.emit(Event.PlaybackActiveTrackChanged, {
        index: this.activeTrackIndex,
        track: this.queue[this.activeTrackIndex],
      });
      return true;
    }
    throw new Error('Beginning of queue');
  }

  async seekTo(seconds) {
    this.callLog.push({ method: 'seekTo', seconds });
    this.position = Math.max(0, Math.min(this.duration, seconds));
  }

  async getProgress() {
    return {
      position: this.position,
      duration: this.duration,
      buffered: this.duration,
    };
  }

  async getPlaybackState() {
    return { state: this.state };
  }

  async getQueue() {
    return [...this.queue];
  }

  async setRepeatMode(mode) {
    this.callLog.push({ method: 'setRepeatMode', mode });
    this.repeatMode = mode;
    return mode;
  }

  async getRepeatMode() {
    return this.repeatMode;
  }

  async setVolume(volume) {
    this.callLog.push({ method: 'setVolume', volume });
    this.volume = volume;
  }

  async getVolume() {
    return this.volume;
  }

  async getActiveTrackIndex() {
    return this.activeTrackIndex >= 0 ? this.activeTrackIndex : undefined;
  }

  async removeUpcomingTracks() {
    this.callLog.push({ method: 'removeUpcomingTracks' });
    if (this.activeTrackIndex >= 0) {
      this.queue = this.queue.slice(0, this.activeTrackIndex + 1);
    }
  }

  getActiveTrack() {
    if (this.activeTrackIndex >= 0 && this.activeTrackIndex < this.queue.length) {
      return this.queue[this.activeTrackIndex];
    }
    return null;
  }
}

const mockPlayer = new TrackPlayerMock();

// Hooks for React components
function usePlaybackState() {
  const React = require('react');
  const [playbackState, setPlaybackState] = React.useState({ state: mockPlayer.state });

  React.useEffect(() => {
    const handler = (evt) => {
      setPlaybackState({ state: evt.state });
    };
    mockPlayer.on(Event.PlaybackState, handler);
    return () => {
      mockPlayer.off(Event.PlaybackState, handler);
    };
  }, []);

  return playbackState;
}

function useActiveTrack() {
  const React = require('react');
  const [activeTrack, setActiveTrack] = React.useState(mockPlayer.getActiveTrack());

  React.useEffect(() => {
    const handler = () => {
      setActiveTrack(mockPlayer.getActiveTrack());
    };
    mockPlayer.on(Event.PlaybackActiveTrackChanged, handler);
    mockPlayer.on(Event.PlaybackTrackChanged, handler);
    return () => {
      mockPlayer.off(Event.PlaybackActiveTrackChanged, handler);
      mockPlayer.off(Event.PlaybackTrackChanged, handler);
    };
  }, []);

  return activeTrack;
}

function useProgress(interval) {
  return {
    position: mockPlayer.position,
    duration: mockPlayer.duration,
    buffered: mockPlayer.duration,
  };
}

function useTrackPlayerEvents(events, handler) {
  const React = require('react');
  React.useEffect(() => {
    const listeners = events.map((evt) => {
      const listener = (data) => handler({ type: evt, ...data });
      mockPlayer.on(evt, listener);
      return { evt, listener };
    });
    return () => {
      listeners.forEach(({ evt, listener }) => mockPlayer.off(evt, listener));
    };
  }, [events, handler]);
}

module.exports = {
  __esModule: true,
  default: mockPlayer,
  mockPlayer,
  State,
  Event,
  Capability,
  RepeatMode,
  AppKilledPlaybackBehavior,
  usePlaybackState,
  useActiveTrack,
  useProgress,
  useTrackPlayerEvents,
};
