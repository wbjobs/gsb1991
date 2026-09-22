'use strict';

export const DOCUMENT_VERSION = 1;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isValidPoint(point) {
  return (
    !!point &&
    isFiniteNumber(point.x) &&
    isFiniteNumber(point.y)
  );
}

export function isValidPolygon(polygon) {
  return (
    !!polygon &&
    typeof polygon.id === 'string' &&
    polygon.id.length > 0 &&
    Array.isArray(polygon.points) &&
    polygon.points.length >= 3 &&
    polygon.points.every(isValidPoint)
  );
}

export function normalizePolygon(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('多边形必须是对象');
  if (typeof raw.id !== 'string' || !raw.id.trim()) {
    throw new Error('多边形缺少有效的 id');
  }
  if (!Array.isArray(raw.points) || raw.points.length < 3) {
    throw new Error(`多边形 ${raw.id} 至少需要 3 个顶点`);
  }
  const points = raw.points.map((p, i) => {
    if (!isValidPoint(p)) {
      throw new Error(`多边形 ${raw.id} 的第 ${i + 1} 个顶点无效`);
    }
    return { x: p.x, y: p.y };
  });
  return {
    id: raw.id,
    label: raw.label == null ? '' : String(raw.label),
    points,
  };
}

export function normalizeDocument(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('JSON 顶层必须是对象');
  if (!Array.isArray(raw.polygons)) throw new Error('缺少 polygons 数组');
  const seenIds = new Set();
  const polygons = raw.polygons.map((p) => {
    const polygon = normalizePolygon(p);
    if (seenIds.has(polygon.id)) throw new Error(`多边形 id 重复: ${polygon.id}`);
    seenIds.add(polygon.id);
    return polygon;
  });
  return {
    version: DOCUMENT_VERSION,
    polygons,
  };
}

export function buildDocument(polygons, meta = {}) {
  const polygonsOut = polygons.map((p) => {
    if (!isValidPolygon(p)) {
      throw new Error(`多边形 ${p.id || '(无 id)'} 顶点不足，无法导出`);
    }
    return {
      id: p.id,
      label: p.label ?? '',
      points: p.points.map((pt) => ({ x: Number(pt.x.toFixed(2)), y: Number(pt.y.toFixed(2)) })),
    };
  });
  return {
    version: DOCUMENT_VERSION,
    exportedAt: new Date().toISOString(),
    meta: {
      width: meta.width ?? null,
      height: meta.height ?? null,
      ...meta,
      polygonCount: polygonsOut.length,
    },
    polygons: polygonsOut,
  };
}
