'use strict';

import { buildDocument, normalizeDocument, DOCUMENT_VERSION } from './model.js';

const STORAGE_KEY = 'polygon-annotator:autosave:v1';

export function exportToObject(polygons, canvasSize) {
  return buildDocument(polygons, {
    width: canvasSize.width,
    height: canvasSize.height,
    coordinateSystem: 'canvas-css-pixel',
  });
}

export function downloadJSON(polygons, canvasSize) {
  const doc = exportToObject(polygons, canvasSize);
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `polygons-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return doc;
}

export function importFromObject(raw) {
  const doc = normalizeDocument(raw);
  return doc.polygons;
}

export async function importFromFile(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是合法的 JSON');
  }
  return importFromObject(parsed);
}

export function saveToStorage(polygons) {
  try {
    const doc = {
      version: DOCUMENT_VERSION,
      savedAt: new Date().toISOString(),
      polygons: polygons.map((p) => ({
        id: p.id,
        label: p.label ?? '',
        points: p.points.map((pt) => ({ x: pt.x, y: pt.y })),
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    return true;
  } catch (error) {
    console.warn('自动保存失败:', error);
    return false;
  }
}

export function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return importFromObject(JSON.parse(raw));
  } catch (error) {
    console.warn('自动保存数据已损坏，已忽略:', error);
    return null;
  }
}
