import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pointInPolygon,
  distanceToSegment,
  distanceToPolygonOutline,
  polygonArea,
  polygonBounds,
  topmostAt,
  vertexAt,
  dedupeConsecutivePoints,
} from '../js/geometry.js';

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

test('pointInPolygon: 内部点命中、外部点不命中、边上点命中', () => {
  assert.equal(pointInPolygon(5, 5, square), true);
  assert.equal(pointInPolygon(-1, 5, square), false);
  assert.equal(pointInPolygon(0, 5, square), true);
});

test('distanceToSegment: 投影在线段内与端点外', () => {
  assert.equal(distanceToSegment(5, 3, 0, 0, 10, 0), 3);
  assert.equal(distanceToSegment(-3, 4, 0, 0, 10, 0), 5);
  assert.equal(distanceToSegment(0, 0, 0, 0, 0, 0), 0);
});

test('distanceToPolygonOutline: 闭合边参与计算', () => {
  assert.equal(distanceToPolygonOutline(5, 10, square), 0);
  assert.equal(distanceToPolygonOutline(5, 12, square), 2);
});

test('polygonArea: 正方形面积为 100', () => {
  assert.equal(polygonArea(square), 100);
  assert.equal(polygonArea([{ x: 0, y: 0 }, { x: 1, y: 0 }]), 0);
});

test('polygonBounds: 返回包围盒', () => {
  assert.deepEqual(polygonBounds(square), { minX: 0, minY: 0, maxX: 10, maxY: 10 });
  assert.equal(polygonBounds([]), null);
});

test('topmostAt: 后绘制的多边形优先，轮廓容差生效', () => {
  const polygons = [
    { id: 'a', points: square },
    { id: 'b', points: [{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }] },
  ];
  assert.equal(topmostAt(polygons, 5, 5).index, 0);
  assert.equal(topmostAt(polygons, 25, 25).index, 1);
  assert.equal(topmostAt(polygons, 100, 100).index, -1);
  assert.equal(topmostAt(polygons, 5, -5, 8).index, 0);
  assert.equal(topmostAt(polygons, 5, -12, 8).index, -1);
});

test('vertexAt: 仅在选中多边形上命中顶点', () => {
  const polygons = [
    { id: 'a', points: square },
    { id: 'b', points: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 5, y: 6 }] },
  ];
  assert.deepEqual(vertexAt(polygons, 0, 0, 5, 'a'), { polygonId: 'a', vertexIndex: 0 });
  assert.equal(vertexAt(polygons, 0, 0, 5, 'b'), null);
});

test('dedupeConsecutivePoints: 去除重复点与重合的首尾点', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0.2, y: 0 },
  ];
  assert.deepEqual(dedupeConsecutivePoints(points), [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ]);
});
