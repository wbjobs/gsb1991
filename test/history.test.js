import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History, undoEntry, redoEntry } from '../js/history.js';

const poly = (id) => ({ id, label: '', points: [] });

test('History: 撤销/重做栈基础行为', () => {
  const history = new History(3);
  assert.equal(history.canUndo(), false);
  history.push({ type: 'add', polygon: poly('a') });
  history.push({ type: 'add', polygon: poly('b') });
  assert.equal(history.canUndo(), true);
  history.moveCursor(-1);
  assert.equal(history.current().polygon.id, 'a');
  history.moveCursor(1);
  assert.equal(history.current().polygon.id, 'b');
});

test('History: 超限时丢弃最早记录', () => {
  const history = new History(2);
  history.push({ type: 'add', polygon: poly('a') });
  history.push({ type: 'add', polygon: poly('b') });
  history.push({ type: 'add', polygon: poly('c') });
  assert.equal(history.entries.length, 2);
  assert.equal(history.cursor, 1);
  assert.equal(history.entries[0].polygon.id, 'b');
});

test('History: 在旧状态上 push 会截断重做分支', () => {
  const history = new History();
  history.push({ type: 'add', polygon: poly('a') });
  history.push({ type: 'add', polygon: poly('b') });
  history.moveCursor(-1);
  history.push({ type: 'add', polygon: poly('c') });
  assert.equal(history.canRedo(), false);
  assert.equal(history.entries.length, 2);
  assert.equal(history.current().polygon.id, 'c');
});

test('undoEntry/redoEntry: add、delete、replace、batch', () => {
  const a = poly('a');
  const b = poly('b');
  assert.deepEqual(undoEntry([a], { type: 'add', polygon: a }), []);
  assert.deepEqual(redoEntry([], { type: 'add', polygon: a }), [a]);

  assert.deepEqual(undoEntry([], { type: 'delete', polygon: a, index: 0 }), [a]);
  assert.deepEqual(redoEntry([a], { type: 'delete', polygon: a, index: 0 }), []);

  const a2 = { ...a, label: 'x' };
  assert.deepEqual(undoEntry([a2], { type: 'replace', before: a, after: a2 }), [a]);
  assert.deepEqual(redoEntry([a], { type: 'replace', before: a, after: a2 }), [a2]);

  assert.deepEqual(undoEntry([b], { type: 'batch', before: [a], after: [b] }), [a]);
  assert.deepEqual(redoEntry([a], { type: 'batch', before: [a], after: [b] }), [b]);
});
