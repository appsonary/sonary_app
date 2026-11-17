// tests/mocks/fileSystemMock.js

const documentDirectory = 'file:///data/user/0/com.sonarypro/files/';

const files = new Map();
let _generation = 0;
let customCreateDownloadResumable = null;

function resetFileSystem() {
  _generation += 1;
  files.clear();
  customCreateDownloadResumable = null;
}

function setCreateDownloadResumable(fn) {
  customCreateDownloadResumable = typeof fn === 'function' ? fn : null;
}

function getFileSystemGeneration() {
  return _generation;
}

async function getInfoAsync(fileUri) {
  const exists = files.has(fileUri) || fileUri.endsWith('/');
  return {
    exists,
    isDirectory: fileUri.endsWith('/'),
    size: exists ? 1024 * 1024 * 3 : 0, // 3MB
    uri: fileUri,
    modificationTime: Date.now(),
  };
}

async function makeDirectoryAsync(dirUri, options) {
  files.set(dirUri, { isDirectory: true });
}

async function deleteAsync(fileUri, options) {
  files.delete(fileUri);
}

async function moveAsync({ from, to }) {
  if (files.has(from)) {
    const data = files.get(from);
    files.delete(from);
    files.set(to, data);
  } else {
    files.set(to, { isDirectory: false, size: 1024 });
  }
}

async function downloadAsync(url, fileUri) {
  files.set(fileUri, { isDirectory: false, url, size: 1024 });
  return { uri: fileUri, status: 200 };
}

async function getFreeDiskStorageAsync() {
  return 1024 * 1024 * 1024; // 1GB
}

function createDownloadResumable(url, fileUri, options, callback) {
  if (customCreateDownloadResumable) {
    return customCreateDownloadResumable(url, fileUri, options, callback);
  }
  return {
    downloadAsync: async () => {
      if (callback) callback({ totalBytesWritten: 1024 * 1024 * 3, totalBytesExpectedToWrite: 1024 * 1024 * 3 });
      files.set(fileUri, { isDirectory: false, url, size: 1024 * 1024 * 3 });
      return { uri: fileUri, status: 200 };
    },
    pauseAsync: async () => {},
    resumeAsync: async () => {},
    cancelAsync: async () => {},
  };
}

async function readDirectoryAsync(dirUri) {
  const result = [];
  for (const key of files.keys()) {
    if (key.startsWith(dirUri) && key !== dirUri) {
      result.push(key.replace(dirUri, ''));
    }
  }
  return result;
}

module.exports = {
  documentDirectory,
  files,
  resetFileSystem,
  getFileSystemGeneration,
  getInfoAsync,
  makeDirectoryAsync,
  deleteAsync,
  moveAsync,
  downloadAsync,
  getFreeDiskStorageAsync,
  createDownloadResumable,
  setCreateDownloadResumable,
  readDirectoryAsync,
};
