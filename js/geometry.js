'use strict';

export function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distanceToPolygonOutline(x, y, points) {
  if (points.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const d = distanceToSegment(x, y, a.x, a.y, b.x, b.y);
    if (d < min) min = d;
  }
  return min;
}

export function polygonArea(points) {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function polygonBounds(points) {
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function topmostAt(polygons, x, y, outlineTolerance = 8) {
  for (let i = polygons.length - 1; i >= 0; i--) {
    const polygon = polygons[i];
    if (pointInPolygon(x, y, polygon.points)) return { index: i, hit: true };
    if (distanceToPolygonOutline(x, y, polygon.points) <= outlineTolerance) {
      return { index: i, hit: true };
    }
  }
  return { index: -1, hit: false };
}

export function vertexAt(polygons, x, y, tolerance = 8, selectedId = null) {
  for (const polygon of polygons) {
    if (selectedId != null && polygon.id !== selectedId) continue;
    for (let i = 0; i < polygon.points.length; i++) {
      const p = polygon.points[i];
      if (Math.hypot(p.x - x, p.y - y) <= tolerance) {
        return { polygonId: polygon.id, vertexIndex: i };
      }
    }
  }
  return null;
}

export function dedupeConsecutivePoints(points, epsilon = 1) {
  const result = [];
  for (const p of points) {
    const last = result[result.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > epsilon) result.push(p);
  }
  if (result.length > 1) {
    const first = result[0];
    const last = result[result.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= epsilon) result.pop();
  }
  return result;
}

export function colorForId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return `hsl(${Math.abs(hash) % 360} 80% 55%)`;
}
