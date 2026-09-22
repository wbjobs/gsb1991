'use strict';

import { createId } from './store.js';

function randomConvexPolygon(cx, cy, radius, vertexCount) {
  const points = [];
  const step = (Math.PI * 2) / vertexCount;
  for (let i = 0; i < vertexCount; i++) {
    const angle = step * i + (Math.random() - 0.5) * step * 0.25;
    const r = radius * (0.55 + Math.random() * 0.45);
    points.push({
      x: Math.round(cx + Math.cos(angle) * r),
      y: Math.round(cy + Math.sin(angle) * r),
    });
  }
  return points;
}

export function generateStressPolygons(count, width, height) {
  const polygons = [];
  for (let i = 0; i < count; i++) {
    const radius = 18 + Math.random() * 70;
    const cx = radius + Math.random() * Math.max(1, width - radius * 2);
    const cy = radius + Math.random() * Math.max(1, height - radius * 2);
    const vertexCount = 3 + Math.floor(Math.random() * 7);
    polygons.push({
      id: createId(),
      label: `stress-${i + 1}`,
      points: randomConvexPolygon(cx, cy, radius, vertexCount),
    });
  }
  return polygons;
}
