'use strict';

import { History, undoEntry, redoEntry } from './history.js';

export class AppState {
  constructor() {
    this.polygons = [];
    this.selectedId = null;
    this.draft = null;
    this.mode = 'draw';
    this.history = new History(200);
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(reason = 'change') {
    for (const listener of this.listeners) {
      try {
        listener(reason);
      } catch (error) {
        console.error('状态监听器执行失败:', error);
      }
    }
  }

  get selectedPolygon() {
    return this.polygons.find((p) => p.id === this.selectedId) || null;
  }

  select(id) {
    if (this.selectedId !== id) {
      this.selectedId = id;
      this.notify('select');
    }
  }

  commitAdd(polygon) {
    this.polygons = [...this.polygons, polygon];
    this.history.push({ type: 'add', polygon });
    this.notify('history');
  }

  commitDelete(polygon) {
    const index = this.polygons.findIndex((p) => p.id === polygon.id);
    if (index === -1) return;
    this.polygons = this.polygons.filter((p) => p.id !== polygon.id);
    this.history.push({ type: 'delete', polygon, index });
    if (this.selectedId === polygon.id) this.selectedId = null;
    this.notify('history');
  }

  commitReplace(before, after) {
    const index = this.polygons.findIndex((p) => p.id === before.id);
    if (index === -1) return;
    const next = this.polygons.slice();
    next[index] = after;
    this.polygons = next;
    this.history.push({ type: 'replace', before, after });
    this.notify('history');
  }

  commitBatch(before, after) {
    this.polygons = after;
    this.history.push({ type: 'batch', before, after });
    if (this.selectedId && !after.some((p) => p.id === this.selectedId)) {
      this.selectedId = null;
    }
    this.notify('history');
  }

  undo() {
    if (!this.history.canUndo()) return false;
    const entry = this.history.current();
    this.polygons = undoEntry(this.polygons, entry);
    this.history.moveCursor(-1);
    if (this.selectedId && !this.polygons.some((p) => p.id === this.selectedId)) {
      this.selectedId = null;
    }
    this.draft = null;
    this.notify('history');
    return true;
  }

  redo() {
    if (!this.history.canRedo()) return false;
    this.history.moveCursor(1);
    const entry = this.history.current();
    this.polygons = redoEntry(this.polygons, entry);
    if (this.selectedId && !this.polygons.some((p) => p.id === this.selectedId)) {
      this.selectedId = null;
    }
    this.draft = null;
    this.notify('history');
    return true;
  }

  replaceAll(polygons, recordHistory = true) {
    const before = this.polygons;
    this.polygons = polygons;
    this.selectedId = null;
    this.draft = null;
    if (recordHistory) {
      this.history.push({ type: 'batch', before, after: polygons });
    } else {
      this.history.clear();
    }
    this.notify('history');
  }

  setMode(mode) {
    if (mode !== this.mode) {
      this.mode = mode;
      this.draft = null;
      this.notify('mode');
    }
  }
}

export function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `poly-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
