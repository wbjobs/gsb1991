import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppState } from '../js/store.js';
import { exportToObject, importFromObject } from '../js/io.js';

const tri = (id, label = '') => ({
  id,
  label,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ],
});

test('完整流程: 新增 -> 撤销/重做 -> 移动替换 -> 删除 -> 批量清空 -> 导出/导入往返', () => {
  const app = new AppState();

  const a = tri('a', 'A');
  app.commitAdd(a);
  const b = tri('b', 'B');
  b.points = b.points.map((p) => ({ x: p.x + 20, y: p.y }));
  app.commitAdd(b);
  assert.equal(app.polygons.length, 2);

  assert.equal(app.undo(), true);
  assert.equal(app.polygons.length, 1);
  assert.equal(app.polygons[0].id, 'a');
  assert.equal(app.redo(), true);
  assert.equal(app.polygons.length, 2);

  const before = app.polygons[0];
  const moved = {
    ...before,
    points: before.points.map((p) => ({ x: p.x + 5, y: p.y + 7 })),
  };
  app.commitReplace(before, moved);
  assert.deepEqual(app.polygons[0].points[0], { x: 5, y: 7 });
  app.undo();
  assert.deepEqual(app.polygons[0].points[0], { x: 0, y: 0 });
  app.redo();

  app.commitDelete(app.polygons[1]);
  assert.equal(app.polygons.length, 1);
  app.undo();
  assert.equal(app.polygons.length, 2);

  const snapshot = app.polygons;
  app.commitBatch(snapshot, []);
  assert.equal(app.polygons.length, 0);
  app.undo();
  assert.equal(app.polygons.length, 2);

  const doc = exportToObject(app.polygons, { width: 800, height: 600 });
  assert.equal(doc.version, 1);
  assert.equal(doc.meta.polygonCount, 2);
  assert.equal(doc.meta.coordinateSystem, 'canvas-css-pixel');
  assert.ok(doc.polygons.every((p) => p.points.length === 3));

  const restored = importFromObject(JSON.parse(JSON.stringify(doc)));
  assert.equal(restored.length, 2);
  assert.deepEqual(restored.map((p) => p.id), ['a', 'b']);
  assert.deepEqual(restored[0].points, app.polygons[0].points.map((p) => ({ x: p.x, y: p.y })));
});

test('撤销栈为空时边界安全', () => {
  const app = new AppState();
  assert.equal(app.undo(), false);
  assert.equal(app.redo(), false);
});

test('撤销后新增会截断重做分支', () => {
  const app = new AppState();
  app.commitAdd(tri('a'));
  app.commitAdd(tri('b'));
  app.undo();
  app.commitAdd(tri('c'));
  assert.equal(app.redo(), false);
  assert.deepEqual(app.polygons.map((p) => p.id), ['a', 'c']);
});
