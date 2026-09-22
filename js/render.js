'use strict';

import { colorForId } from './geometry.js';

const VERTEX_RADIUS = 4;
const FIRST_VERTEX_RADIUS = 6;
const FILL_ALPHA = 0.16;

function tracePath(ctx, points, close = true) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  if (close) ctx.closePath();
}

export function drawPolygon(ctx, polygon, options = {}) {
  const color = options.color || colorForId(polygon.id);
  const selected = !!options.selected;
  const points = polygon.points;
  if (points.length < 2) {
    drawPoint(ctx, points[0], color, selected);
    return;
  }

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineWidth = selected ? 2.5 : 1.5;
  ctx.strokeStyle = color;
  tracePath(ctx, points, points.length >= 3);

  if (points.length >= 3) {
    ctx.globalAlpha = selected ? FILL_ALPHA + 0.08 : FILL_ALPHA;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.stroke();
  ctx.restore();

  if (selected) {
    points.forEach((p, i) => {
      drawVertex(ctx, p, i === 0 ? FIRST_VERTEX_RADIUS : VERTEX_RADIUS, color);
    });
  }
}

export function drawPoint(ctx, point, color = '#ffd54a', selected = false) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y, FIRST_VERTEX_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.restore();
}

export function drawVertex(ctx, point, radius = VERTEX_RADIUS, color = '#ffd54a') {
  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.restore();
}

export function renderBaseLayer(ctx, polygons, selectedId) {
  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.restore();

  for (const polygon of polygons) {
    drawPolygon(ctx, polygon, { selected: polygon.id === selectedId });
  }
}

export function renderOverlay(ctx, state) {
  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.restore();

  const {
    dragGhost = null,
    draft = null,
    cursorPoint = null,
    hoverId = null,
    polygons = [],
    selectedId = null,
  } = state;

  if (dragGhost) {
    drawPolygon(ctx, dragGhost, { selected: true, color: '#ffd54a' });
  } else if (draft) {
    renderDraft(ctx, draft, cursorPoint, polygons);
  } else if (hoverId && hoverId !== selectedId) {
    const polygon = polygons.find((p) => p.id === hoverId);
    if (polygon) drawPolygon(ctx, polygon, { color: '#e2e8f0' });
  }

  const selected = polygons.find((p) => p.id === selectedId);
  if (selected && !dragGhost) drawLabel(ctx, selected);
}

function renderDraft(ctx, draft, cursorPoint, polygons) {
  const { points, closed } = draft;
  if (!points.length) return;
  const color = '#ffd54a';

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  if (closed && points.length >= 3) ctx.closePath();
  ctx.stroke();
  ctx.restore();

  points.forEach((p, i) => drawVertex(ctx, p, i === 0 ? FIRST_VERTEX_RADIUS : VERTEX_RADIUS, color));

  if (cursorPoint && !closed) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.lineTo(cursorPoint.x, cursorPoint.y);
    if (points.length >= 2) ctx.lineTo(points[0].x, points[0].y);
    ctx.stroke();
    ctx.restore();

    if (points.length >= 3) {
      const dFirst = Math.hypot(cursorPoint.x - points[0].x, cursorPoint.y - points[0].y);
      if (dFirst <= 10) drawVertex(ctx, points[0], FIRST_VERTEX_RADIUS + 2, '#4ade80');
    }
  }
}

export function drawLabel(ctx, polygon) {
  if (!polygon.points.length) return;
  const anchor = polygon.points[0];
  const text = polygon.label || polygon.id.slice(0, 8);
  ctx.save();
  ctx.font = '12px system-ui, sans-serif';
  const metrics = ctx.measureText(text);
  const padX = 6;
  const boxW = metrics.width + padX * 2;
  const boxH = 20;
  const x = anchor.x + 8;
  const y = anchor.y - boxH - 8;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.strokeStyle = colorForId(polygon.id);
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, boxW, boxH, 4);
  } else {
    const r = 4;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + boxW, y, x + boxW, y + boxH, r);
    ctx.arcTo(x + boxW, y + boxH, x, y + boxH, r);
    ctx.arcTo(x, y + boxH, x, y, r);
    ctx.arcTo(x, y, x + boxW, y, r);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f8fafc';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + boxH / 2 + 1);
  ctx.restore();
}
