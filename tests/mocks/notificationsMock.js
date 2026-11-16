// tests/mocks/notificationsMock.js
// Mock completo de expo-notifications para testes Node sem dependências nativas.

const responseListeners = new Set();

const state = {
  permissionGranted: true,
  channels: new Map(),
  scheduledNotifications: [],
  notificationHandler: null,
  lastNotificationResponse: null,
  nextId: 1,
};

const AndroidImportance = {
  UNKNOWN: 0,
  UNSPECIFIED: 1,
  NONE: 2,
  MIN: 3,
  LOW: 4,
  DEFAULT: 5,
  HIGH: 6,
  MAX: 7,
};

const notificationsMock = {
  AndroidImportance,
  setNotificationHandler: (handler) => {
    state.notificationHandler = handler;
  },
  getPermissionsAsync: async () => ({
    granted: state.permissionGranted,
    status: state.permissionGranted ? 'granted' : 'denied',
    canAskAgain: true,
  }),
  setNotificationChannelAsync: async (channelId, channelInput) => {
    const channel = { id: channelId, ...channelInput };
    state.channels.set(channelId, channel);
    return channel;
  },
  getNotificationChannelAsync: async (channelId) => {
    return state.channels.get(channelId) || null;
  },
  scheduleNotificationAsync: async (request) => {
    const id = `mock-notif-${state.nextId++}`;
    state.scheduledNotifications.push({
      identifier: id,
      ...request,
    });
    return id;
  },
  getLastNotificationResponseAsync: async () => state.lastNotificationResponse,
  clearLastNotificationResponseAsync: async () => {
    state.lastNotificationResponse = null;
  },
  addNotificationResponseReceivedListener: (listener) => {
    responseListeners.add(listener);
    return {
      remove: () => {
        responseListeners.delete(listener);
      },
    };
  },
  // Test helpers
  __setPermissionGranted: (granted) => {
    state.permissionGranted = Boolean(granted);
  },
  __setLastNotificationResponse: (response) => {
    state.lastNotificationResponse = response;
  },
  __emitNotificationResponse: (response) => {
    state.lastNotificationResponse = response;
    for (const listener of Array.from(responseListeners)) {
      listener(response);
    }
  },
  __getState: () => state,
  __reset: () => {
    state.permissionGranted = true;
    state.channels.clear();
    state.scheduledNotifications = [];
    state.notificationHandler = null;
    state.lastNotificationResponse = null;
    state.nextId = 1;
    responseListeners.clear();
  },
};

module.exports = notificationsMock;

