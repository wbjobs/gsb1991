import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDocument, buildDocument, isValidPolygon } from '../js/model.js';

const valid = {
  id: 'p1',
  label: 'cat',
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ],
};

test('normalizeDocument: 合法数据通过并补默认 label', () => {
  const doc = normalizeDocument({ polygons: [{ id: 'p1', points: valid.points }] });
  assert.equal(doc.polygons[0].label, '');
  assert.equal(doc.version, 1);
});

test('normalizeDocument: 拒绝非法输入', () => {
  assert.throws(() => normalizeDocument(null), /对象/);
  assert.deepEqual(normalizeDocument({ polygons: [] }).polygons, []);
  assert.throws(() => normalizeDocument({}), /polygons/);
  assert.throws(() => normalizeDocument({ polygons: [{ id: '', points: [] }] }), /id/);
  assert.throws(
    () => normalizeDocument({ polygons: [{ id: 'x', points: [{ x: 0, y: 0 }] }] }),
    /3 个顶点/
  );
  assert.throws(
    () => normalizeDocument({ polygons: [{ id: 'x', points: [{ x: 0, y: 'y' }, { x: 1, y: 1 }, { x: 2, y: 2 }] }] }),
    /顶点无效/
  );
  assert.equal(
    normalizeDocument({ polygons: [valid, { ...valid, id: 'p2' }] }).polygons.length,
    2
  );
  assert.throws(() => normalizeDocument({ polygons: [valid, valid] }), /重复/);
});

test('buildDocument: 导出结构与坐标截断', () => {
  const polygon = { ...valid, points: [{ x: 1.23456, y: 2.98765 }, { x: 10, y: 0 }, { x: 10, y: 10 }] };
  const doc = buildDocument([polygon], { width: 800, height: 600 });
  assert.equal(doc.meta.polygonCount, 1);
  assert.equal(doc.meta.width, 800);
  assert.deepEqual(doc.polygons[0].points[0], { x: 1.23, y: 2.99 });
  assert.ok(typeof doc.exportedAt === 'string');
});

test('isValidPolygon: 基本判定', () => {
  assert.equal(isValidPolygon(valid), true);
  assert.equal(isValidPolygon({ id: 'x', points: [{ x: 0, y: 0 }] }), false);
  assert.equal(isValidPolygon(null), false);
});
