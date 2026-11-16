// tests/helpers/testUtils.js
const React = require('react');
const renderer = require('react-test-renderer');
const { mockPlayer } = require('../mocks/trackPlayerMock');
const { dbInstance } = require('../mocks/sqliteMock');
const { resetFileSystem } = require('../mocks/fileSystemMock');
const { Clipboard, Linking } = require('../mocks/reactNativeMock');
const notificationsMock = require('../mocks/notificationsMock');
const { invalidateDatabaseCaches } = require('../../services/database');
const { clearStorageCache } = require('../../services/storage');

/**
 * Flush all microtasks, timers and pending promises within act()
 */
async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

/**
 * Run an async function wrapped in renderer.act() and wait for microtasks
 */
async function actAsync(fn) {
  let result;
  await renderer.act(async () => {
    result = await fn();
    await flushPromises();
  });
  return result;
}

/**
 * Find all Text nodes that contain a specific substring
 */
function findTextNodes(root, text) {
  return root.findAll((node) => {
    if (node.type === 'Text') {
      const children = Array.isArray(node.props.children)
        ? node.props.children.join('')
        : String(node.props.children || '');
      return children.includes(text);
    }
    return false;
  });
}

/**
 * Find the first Text node containing text
 */
function findTextNode(root, text) {
  const nodes = findTextNodes(root, text);
  return nodes.length > 0 ? nodes[0] : null;
}

/**
 * Collect all text strings from a node and its descendants
 */
function getAllText(node) {
  if (!node) return '';
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  let text = '';
  if (node.children) {
    for (const child of node.children) {
      text += getAllText(child) + ' ';
    }
  }
  if (node.props && node.props.children) {
    if (Array.isArray(node.props.children)) {
      for (const child of node.props.children) {
        text += getAllText(child) + ' ';
      }
    } else {
      text += getAllText(node.props.children) + ' ';
    }
  }
  return text.trim();
}

/**
 * Find TouchableOpacity button containing specific text or icon
 */
function findButtonByText(root, text) {
  const buttons = root.findAllByType('TouchableOpacity');
  const matching = buttons.filter((btn) => getAllText(btn).includes(text));
  if (matching.length === 0) return null;
  // If text is 'Buscar' and multiple exist, prefer the navigation tab button
  if (text === 'Buscar' && matching.length > 1) {
    const tabBtn = matching.find((b) => b.props.accessibilityRole === 'tab');
    if (tabBtn) return tabBtn;
  }
  return matching[0];
}

/**
 * Find all TouchableOpacity buttons containing specific text
 */
function findAllButtonsByText(root, text) {
  const buttons = root.findAllByType('TouchableOpacity');
  return buttons.filter((btn) => getAllText(btn).includes(text));
}

/**
 * Find the primary Search action button (in searchContainer, distinct from TabBar)
 */
function findSearchActionButton(root) {
  const byLabel = root
    .findAllByType('TouchableOpacity')
    .find((btn) => btn.props && btn.props.accessibilityLabel === 'Buscar músicas');
  if (byLabel) return byLabel;
  const buttons = findAllButtonsByText(root, 'Buscar');
  const actionBtn = buttons.find(
    (btn) => btn.props.accessibilityRole === 'button' || btn.props.accessibilityLabel === 'Buscar músicas'
  );
  if (actionBtn) return actionBtn;
  return buttons[0];
}

/**
 * Find TouchableOpacity button containing a specific LucideIcon name (returns innermost button)
 */
function findButtonByIcon(root, iconName) {
  const buttons = root.findAllByType('TouchableOpacity');
  const matching = buttons.filter((btn) => {
    const hasIcon =
      btn.findAll((node) => node.type === 'LucideIcon' && node.props.name === iconName).length > 0;
    if (!hasIcon) return false;
    // innermost: ensure no nested TouchableOpacity also contains this icon
    const childButtons = btn.findAllByType('TouchableOpacity').filter((b) => b !== btn);
    const childHasIcon = childButtons.some(
      (b) =>
        b.findAll((node) => node.type === 'LucideIcon' && node.props.name === iconName).length > 0
    );
    return !childHasIcon;
  });
  return matching.length > 0 ? matching[0] : null;
}

/**
 * Find TextInput by placeholder
 */
function findInputByPlaceholder(root, placeholder) {
  const inputs = root.findAllByType('TextInput');
  for (const input of inputs) {
    if (input.props.placeholder && input.props.placeholder.includes(placeholder)) {
      return input;
    }
  }
  return null;
}

/**
 * Reset all test mocks to a fresh state
 */
function resetAllMocks() {
  mockPlayer.resetState();
  dbInstance.reset();
  resetFileSystem();
  invalidateDatabaseCaches();
  clearStorageCache();
  Clipboard.reset();
  Linking.__reset();
  notificationsMock.__reset();
}

module.exports = {
  flushPromises,
  actAsync,
  findTextNodes,
  findTextNode,
  getAllText,
  findButtonByText,
  findAllButtonsByText,
  findSearchActionButton,
  findButtonByIcon,
  findInputByPlaceholder,
  resetAllMocks,
};
