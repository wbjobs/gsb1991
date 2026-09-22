'use strict';

export class History {
  constructor(limit = 200) {
    this.limit = limit;
    this.entries = [];
    this.cursor = -1;
  }

  push(entry) {
    this.entries.splice(this.cursor + 1);
    this.entries.push(entry);
    if (this.entries.length > this.limit) {
      this.entries.shift();
    }
    this.cursor = this.entries.length - 1;
  }

  canUndo() {
    return this.cursor >= 0;
  }

  canRedo() {
    return this.cursor < this.entries.length - 1;
  }

  current() {
    return this.cursor >= 0 ? this.entries[this.cursor] : null;
  }

  moveCursor(delta) {
    this.cursor = Math.max(-1, Math.min(this.entries.length - 1, this.cursor + delta));
  }

  clear() {
    this.entries = [];
    this.cursor = -1;
  }
}

export function undoEntry(polygons, entry) {
  switch (entry.type) {
    case 'add':
      return polygons.filter((p) => p.id !== entry.polygon.id);
    case 'delete':
      return [...polygons.slice(0, entry.index), entry.polygon, ...polygons.slice(entry.index)];
    case 'replace': {
      const index = polygons.findIndex((p) => p.id === entry.before.id);
      if (index === -1) return polygons;
      const result = polygons.slice();
      result[index] = entry.before;
      return result;
    }
    case 'batch':
      return entry.before;
    default:
      return polygons;
  }
}

export function redoEntry(polygons, entry) {
  switch (entry.type) {
    case 'add':
      return [...polygons, entry.polygon];
    case 'delete':
      return polygons.filter((p) => p.id !== entry.polygon.id);
    case 'replace': {
      const index = polygons.findIndex((p) => p.id === entry.after.id);
      if (index === -1) return polygons;
      const result = polygons.slice();
      result[index] = entry.after;
      return result;
    }
    case 'batch':
      return entry.after;
    default:
      return polygons;
  }
}
