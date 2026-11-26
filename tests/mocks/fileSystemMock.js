// tests/mocks/fileSystemMock.js

const documentDirectory = 'file:///data/user/0/com.sonarypro/files/';
const cacheDirectory = 'file:///data/user/0/com.sonarypro/cache/';
const EncodingType = {
  UTF8: 'utf8',
  Base64: 'base64',
};

const files = new Map();
let _generation = 0;
let customCreateDownloadResumable = null;
let freeDiskStorageBytes = 1024 * 1024 * 1024; // 1GB

function resetFileSystem() {
  _generation += 1;
  files.clear();
  customCreateDownloadResumable = null;
  freeDiskStorageBytes = 1024 * 1024 * 1024;
}

function setCreateDownloadResumable(fn) {
  customCreateDownloadResumable = typeof fn === 'function' ? fn : null;
}

function setFreeDiskStorageBytes(bytes) {
  freeDiskStorageBytes = typeof bytes === 'number' ? bytes : 1024 * 1024 * 1024;
}

function getFileSystemGeneration() {
  return _generation;
}

async function getInfoAsync(fileUri) {
  const entry = files.get(fileUri);
  const exists = Boolean(entry) || fileUri.endsWith('/');
  const size =
    entry && typeof entry.content === 'string'
      ? entry.content.length
      : exists
        ? 1024 * 1024 * 3
        : 0;
  return {
    exists,
    isDirectory: fileUri.endsWith('/'),
    size,
    uri: fileUri,
    modificationTime: Date.now(),
  };
}

async function writeAsStringAsync(fileUri, content, options = {}) {
  const str = String(content ?? '');
  files.set(fileUri, {
    isDirectory: false,
    content: str,
    encoding: options.encoding || EncodingType.UTF8,
    size: str.length,
  });
}

async function readAsStringAsync(fileUri) {
  const entry = files.get(fileUri);
  if (!entry || typeof entry.content !== 'string') {
    throw new Error(`File not found: ${fileUri}`);
  }
  return entry.content;
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
  return freeDiskStorageBytes;
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

const StorageAccessFramework = {
  requestDirectoryPermissionsAsync: (...args) =>
    global.__safMock?.requestDirectoryPermissionsAsync
      ? global.__safMock.requestDirectoryPermissionsAsync(...args)
      : Promise.resolve({ granted: false }),
  createFileAsync: (...args) =>
    global.__safMock?.createFileAsync
      ? global.__safMock.createFileAsync(...args)
      : Promise.reject(new Error('SAF mock not configured')),
};

module.exports = {
  documentDirectory,
  cacheDirectory,
  EncodingType,
  StorageAccessFramework,
  files,
  resetFileSystem,
  getFileSystemGeneration,
  getInfoAsync,
  writeAsStringAsync,
  readAsStringAsync,
  makeDirectoryAsync,
  deleteAsync,
  moveAsync,
  downloadAsync,
  getFreeDiskStorageAsync,
  setFreeDiskStorageBytes,
  createDownloadResumable,
  setCreateDownloadResumable,
  readDirectoryAsync,
};
