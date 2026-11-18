// tests/material_text_input.test.js
const test = require('node:test');
const assert = require('node:assert');
const React = require('react');
const renderer = require('react-test-renderer');
const { StyleSheet } = require('react-native');
const { MaterialTextInput } = require('../components/MaterialTextInput');
const { actAsync, getAllText } = require('./helpers/testUtils');

test('MaterialTextInput: renders label, animates focus color, clears text, and respects editable=false', async () => {
  let focused = 0;
  let blurred = 0;
  let value = 'Synthwave';

  const renderInput = (props = {}) =>
    React.createElement(MaterialTextInput, {
      label: 'NOME',
      value,
      onChangeText: (t) => {
        value = t;
      },
      onFocus: () => {
        focused += 1;
      },
      onBlur: () => {
        blurred += 1;
      },
      placeholder: 'Digite aqui...',
      ...props,
    });

  let tree;
  await actAsync(async () => {
    tree = renderer.create(renderInput());
  });
  const root = tree.root;

  assert.ok(getAllText(root).includes('NOME'));
  const input = root.findByType('TextInput');
  const labelNode = root.findAllByType('Text').find((n) => n.children[0] === 'NOME');
  assert.strictEqual(StyleSheet.flatten(labelNode.props.style).color, '#9A9AA0');

  // Focus forwards callback and switches label to crimson
  await actAsync(async () => {
    input.props.onFocus({});
  });
  assert.strictEqual(focused, 1);
  assert.strictEqual(StyleSheet.flatten(labelNode.props.style).color, '#E5484D');

  // Clear button calls onChangeText('')
  const clearBtn = root.findByProps({ accessibilityLabel: 'Limpar texto' });
  await actAsync(async () => {
    clearBtn.props.onPress();
  });
  assert.strictEqual(value, '');

  // Blur forwards callback and restores idle color
  await actAsync(async () => {
    input.props.onBlur({});
  });
  assert.strictEqual(blurred, 1);
  assert.strictEqual(StyleSheet.flatten(labelNode.props.style).color, '#9A9AA0');

  // editable=false hides clear button even with non-empty value
  value = 'Bloqueado';
  await actAsync(async () => {
    tree.update(renderInput({ editable: false }));
  });
  assert.strictEqual(
    root.findAllByProps({ accessibilityLabel: 'Limpar texto' }).length,
    0
  );

  await actAsync(async () => {
    tree.unmount();
  });
});
