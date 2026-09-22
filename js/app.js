'use strict';

import { AppState, createId } from './store.js';
import { renderBaseLayer, renderOverlay } from './render.js';
import { topmostAt, vertexAt, dedupeConsecutivePoints, polygonArea } from './geometry.js';
import { downloadJSON, importFromFile, saveToStorage, loadFromStorage } from './io.js';
import { generateStressPolygons } from './stress.js';

const HOVER_THROTTLE_MS = 40;
const TAP_TOLERANCE_PX = 4;
const HIT_TOLERANCE_PX = 8;

class WorkerClient {
  constructor(onStatus) {
    this.worker = null;
    this.alive = false;
    this.reqSeq = 0;
    this.pending = new Map();
    this.onStatus = onStatus;
    this.start();
  }

  start() {
    try {
      this.worker = new Worker('./js/worker.js', { type: 'module' });
      this.worker.onmessage = (event) => this.handleMessage(event.data);
      this.worker.onerror = (error) => this.fail(error);
      this.alive = true;
      this.onStatus('ready');
    } catch (error) {
      this.fail(error);
    }
  }

  fail(error) {
    if (this.alive) {
      console.warn('Web Worker 不可用，已切换到主线程命中检测:', error);
    }
    this.alive = false;
    try {
      this.worker?.terminate();
    } catch {
      /* ignore */
    }
    this.worker = null;
    for (const resolver of this.pending.values()) resolver(null);
    this.pending.clear();
    this.onStatus('fallback');
  }

  handleMessage(msg) {
    if (msg.type === 'error') {
      console.warn('Worker 错误:', msg.message);
      return;
    }
    if (msg.type === 'hitTestResult') {
      const resolver = this.pending.get(msg.reqId);
      if (resolver) {
        this.pending.delete(msg.reqId);
        resolver(msg);
      }
    }
  }

  async request(message) {
    if (!this.alive) return null;
    const reqId = ++this.reqSeq;
    return new Promise((resolve) => {
      this.pending.set(reqId, resolve);
      try {
        this.worker.postMessage({ ...message, reqId });
      } catch (error) {
        this.pending.delete(reqId);
        this.fail(error);
        resolve(null);
      }
    });
  }

  setPolygons(polygons) {
    if (!this.alive) return;
    const transferable = polygons.map((p) => ({
      id: p.id,
      points: p.points.map((pt) => ({ x: pt.x, y: pt.y })),
    }));
    try {
      this.worker.postMessage({ type: 'setPolygons', polygons: transferable });
    } catch (error) {
      this.fail(error);
    }
  }

  hitTest(x, y) {
    if (!this.alive) {
      const local = topmostAt(this.localPolygons ?? [], x, y, HIT_TOLERANCE_PX);
      return Promise.resolve({ index: local.index });
    }
    return this.request({ type: 'hitTest', x, y, tolerance: HIT_TOLERANCE_PX }).then(
      (res) => (res ? { index: res.index } : { index: -1 })
    );
  }

  setLocalPolygons(polygons) {
    this.localPolygons = polygons;
  }
}

class CanvasStage {
  constructor(baseCanvas, overlayCanvas) {
    this.baseCanvas = baseCanvas;
    this.overlayCanvas = overlayCanvas;
    this.baseCtx = baseCanvas.getContext('2d');
    this.overlayCtx = overlayCanvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  }

  resize() {
    const rect = this.baseCanvas.parentElement.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    for (const canvas of [this.baseCanvas, this.overlayCanvas]) {
      canvas.width = Math.round(this.width * this.dpr);
      canvas.height = Math.round(this.height * this.dpr);
      canvas.style.width = `${this.width}px`;
      canvas.style.height = `${this.height}px`;
    }
    this.baseCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.overlayCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  getPosition(event) {
    const rect = this.baseCanvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  drawBase(polygons, selectedId) {
    this.baseCtx.save();
    this.baseCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    renderBaseLayer(this.baseCtx, polygons, selectedId);
    this.baseCtx.restore();
  }

  drawOverlay(state) {
    const ctx = this.overlayCtx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    renderOverlay(ctx, { ...state, width: this.width, height: this.height });
    ctx.restore();
  }
}

function showToast(container, message, kind = 'info', duration = 2600) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

class Annotator {
  constructor() {
    this.state = new AppState();
    this.stage = new CanvasStage(
      document.getElementById('baseLayer'),
      document.getElementById('overlayLayer')
    );
    this.toastContainer = document.getElementById('toastContainer');
    this.elements = {
      toolDraw: document.getElementById('toolDraw'),
      toolSelect: document.getElementById('toolSelect'),
      undo: document.getElementById('btnUndo'),
      redo: document.getElementById('btnRedo'),
      finish: document.getElementById('btnFinish'),
      cancel: document.getElementById('btnCancel'),
      delete: document.getElementById('btnDelete'),
      clear: document.getElementById('btnClear'),
      export: document.getElementById('btnExport'),
      import: document.getElementById('btnImport'),
      importFile: document.getElementById('importFile'),
      stress: document.getElementById('btnStress'),
      labelInput: document.getElementById('labelInput'),
      stats: document.getElementById('stats'),
      workerStatus: document.getElementById('workerStatus'),
      stage: document.getElementById('stage'),
    };

    this.worker = new WorkerClient((status) => {
      this.elements.workerStatus.textContent =
        status === 'ready' ? 'Worker: 已启用' : 'Worker: 不可用（主线程兜底）';
      this.elements.workerStatus.classList.toggle('warn', status !== 'ready');
      if (status === 'fallback') {
        this.toast('Web Worker 初始化失败，已自动切换到主线程模式', 'warn');
      }
    });

    this.cursorPoint = null;
    this.hoverId = null;
    this.lastHoverAt = 0;
    this.hoverToken = 0;
    this.overlayDirty = false;
    this.baseDirty = true;
    this.pointer = null;
    this.fps = { frames: 0, lastSample: performance.now(), value: 0 };
    this.saveTimer = null;
    this.frameTimes = [];

    this.bindEvents();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.elements.stage);

    const restored = loadFromStorage();
    if (restored && restored.length) {
      this.state.replaceAll(restored, false);
      this.toast(`已恢复上次自动保存的 ${restored.length} 个多边形`, 'info', 2000);
    }

    this.state.subscribe(() => this.scheduleSave());
    this.state.subscribe((reason) => {
      this.syncWorker();
      if (reason === 'history' || reason === 'select') this.baseDirty = true;
    });
    this.syncWorker();
    this.loop();
    this.updateUI();
  }

  toast(message, kind = 'info', duration) {
    showToast(this.toastContainer, message, kind, duration);
  }

  bindEvents() {
    const canvas = this.stage.overlayCanvas;
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onPointerCancel(e));
    canvas.addEventListener('pointerleave', () => {
      this.cursorPoint = null;
      this.hoverId = null;
      this.overlayDirty = true;
    });
    canvas.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const draft = this.state.draft;
      if (!draft) return;
      if (draft.points.length >= 3) {
        draft.points.pop();
        this.finishDraft();
      } else {
        this.cancelDraft(true);
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.elements.toolDraw.addEventListener('click', () => this.switchMode('draw'));
    this.elements.toolSelect.addEventListener('click', () => this.switchMode('select'));
    this.elements.undo.addEventListener('click', () => this.safeAction(() => this.state.undo(), '撤销'));
    this.elements.redo.addEventListener('click', () => this.safeAction(() => this.state.redo(), '重做'));
    this.elements.finish.addEventListener('click', () => this.finishDraft());
    this.elements.cancel.addEventListener('click', () => this.cancelDraft());
    this.elements.delete.addEventListener('click', () => this.deleteSelected());
    this.elements.clear.addEventListener('click', () => this.clearAll());
    this.elements.export.addEventListener('click', () => this.exportData());
    this.elements.import.addEventListener('click', () => this.elements.importFile.click());
    this.elements.importFile.addEventListener('change', (e) => this.importData(e));
    this.elements.stress.addEventListener('click', () => this.runStressTest());

    this.elements.labelInput.addEventListener('input', () => {
      const selected = this.state.selectedPolygon;
      if (!selected || this.state.draft) return;
      const before = { ...selected, points: selected.points.map((p) => ({ ...p })) };
      const after = { ...selected, label: this.elements.labelInput.value };
      const index = this.state.polygons.findIndex((p) => p.id === selected.id);
      const next = this.state.polygons.slice();
      next[index] = after;
      this.state.polygons = next;
      this.pushLabelHistory(before, after);
      this.baseDirty = true;
      this.overlayDirty = true;
    });

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('error', (event) => {
      console.error(event.error || event.message);
      this.toast(`运行异常: ${event.message || '未知错误'}`, 'error');
    });
    window.addEventListener('unhandledrejection', (event) => {
      console.error(event.reason);
      this.toast(`异步操作异常: ${event.reason?.message || event.reason || '未知错误'}`, 'error');
    });
  }

  pushLabelHistory(before, after) {
    const history = this.state.history;
    const entry = history.current();
    const now = performance.now();
    if (
      entry &&
      entry.type === 'replace' &&
      entry.after.id === after.id &&
      entry.coalesceKey === 'label' &&
      now - (entry.timestamp || 0) < 800
    ) {
      entry.after = after;
      entry.timestamp = now;
    } else {
      history.push({ type: 'replace', before, after, coalesceKey: 'label', timestamp: now });
    }
    this.state.notify('history');
  }

  switchMode(mode) {
    if (this.state.draft && mode !== this.state.mode) {
      this.cancelDraft(true);
    }
    this.state.setMode(mode);
    this.hoverId = null;
    this.updateUI();
    this.overlayDirty = true;
  }

  onPointerDown(event) {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    try {
      this.stage.overlayCanvas.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture 失败不影响功能 */
    }
    const pos = this.stage.getPosition(event);

    if (this.state.draft) {
      this.handleDraftDown(pos);
      return;
    }

    if (this.state.mode !== 'select') {
      this.startDraft(pos);
      return;
    }

    const selected = this.state.selectedPolygon;
    if (selected) {
      const vertex = vertexAt([selected], pos.x, pos.y, HIT_TOLERANCE_PX, selected.id);
      if (vertex) {
        this.pointer = {
          kind: 'vertex',
          start: pos,
          polygonId: selected.id,
          vertexIndex: vertex.vertexIndex,
          originalPoints: selected.points.map((pt) => ({ ...pt })),
          moved: false,
        };
        return;
      }
    }

    const hit = topmostAt(this.state.polygons, pos.x, pos.y, HIT_TOLERANCE_PX);
    if (hit.hit) {
      const polygon = this.state.polygons[hit.index];
      this.state.select(polygon.id);
      this.pointer = {
        kind: 'move',
        start: pos,
        polygonId: polygon.id,
        originalPoints: polygon.points.map((p) => ({ ...p })),
        moved: false,
      };
    } else {
      this.state.select(null);
      this.pointer = { kind: 'tap', start: pos };
    }
    this.updateUI();
    this.baseDirty = true;
    this.overlayDirty = true;
  }

  handleDraftDown(pos) {
    const draft = this.state.draft;
    if (draft.points.length >= 3) {
      const first = draft.points[0];
      if (Math.hypot(first.x - pos.x, first.y - pos.y) <= 10) {
        this.finishDraft();
        return;
      }
    }
    draft.points.push(pos);
    draft.closed = draft.points.length >= 3;
    this.overlayDirty = true;
    this.updateUI();
  }

  startDraft(pos) {
    this.state.draft = { points: [pos], closed: false };
    this.state.select(null);
    this.updateUI();
    this.overlayDirty = true;
  }

  onPointerMove(event) {
    if (!event.isPrimary) return;
    const pos = this.stage.getPosition(event);
    this.cursorPoint = pos;

    if (this.pointer) {
      this.handleDragMove(pos);
      return;
    }

    if (this.state.draft) {
      this.overlayDirty = true;
      return;
    }

    if (this.state.mode === 'select') {
      this.throttledHover(pos);
    }
  }

  handleDragMove(pos) {
    const drag = this.pointer;
    const dx = pos.x - drag.start.x;
    const dy = pos.y - drag.start.y;

    if (!drag.moved && Math.hypot(dx, dy) < TAP_TOLERANCE_PX) return;
    if (!drag.moved) {
      drag.moved = true;
      if (drag.kind === 'move') {
        drag.startAt = performance.now();
      }
    }

    if (drag.kind === 'move') {
      const polygon = this.state.polygons.find((p) => p.id === drag.polygonId);
      if (!polygon) return;
      drag.ghostPoints = drag.originalPoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      drag.dx = dx;
      drag.dy = dy;
    } else if (drag.kind === 'vertex') {
      const polygon = this.state.polygons.find((p) => p.id === drag.polygonId);
      if (!polygon) return;
      const points = polygon.points.map((p) => ({ ...p }));
      points[drag.vertexIndex] = { x: pos.x, y: pos.y };
      const index = this.state.polygons.findIndex((p) => p.id === polygon.id);
      const next = this.state.polygons.slice();
      next[index] = { ...polygon, points };
      this.state.polygons = next;
      this.baseDirty = true;
    }
    this.overlayDirty = true;
  }

  onPointerUp(event) {
    if (!event.isPrimary) return;
    const pos = this.stage.getPosition(event);
    const drag = this.pointer;
    this.pointer = null;

    if (!drag) return;

    if (drag.kind === 'move' && drag.moved) {
      this.finishMove(drag, pos);
    } else if (drag.kind === 'vertex' && drag.moved) {
      this.finishVertexDrag(drag);
    } else if (drag.kind === 'move' && !drag.moved) {
      const polygon = this.state.polygons.find((p) => p.id === drag.polygonId);
      if (polygon) this.state.select(polygon.id);
      this.baseDirty = true;
    }
    this.overlayDirty = true;
    this.updateUI();
  }

  finishMove(drag) {
    const polygon = this.state.polygons.find((p) => p.id === drag.polygonId);
    if (!polygon) return;
    const before = { ...polygon, points: drag.originalPoints };
    const after = { ...polygon, points: drag.ghostPoints };
    this.state.commitReplace(before, after);
    this.state.select(after.id);
    this.baseDirty = true;
  }

  finishVertexDrag(drag) {
    const polygon = this.state.polygons.find((p) => p.id === drag.polygonId);
    if (!polygon) return;
    const before = { ...polygon, points: drag.originalPoints };
    const cleaned = dedupeConsecutivePoints(polygon.points);
    if (cleaned.length < 3) {
      this.state.polygons = this.state.polygons.map((p) =>
        p.id === polygon.id ? before : p
      );
      this.baseDirty = true;
      this.toast('顶点拖拽导致多边形退化，已还原', 'warn');
      return;
    }
    const after = { ...polygon, points: cleaned };
    const index = this.state.polygons.findIndex((p) => p.id === polygon.id);
    const next = this.state.polygons.slice();
    next[index] = after;
    this.state.polygons = next;
    this.state.commitReplace(
      { ...before, points: before.points.map((p) => ({ ...p })) },
      { ...after, points: after.points.map((p) => ({ ...p })) }
    );
    this.state.select(after.id);
    this.baseDirty = true;
  }

  onPointerCancel() {
    if (this.pointer?.kind === 'vertex') {
      const drag = this.pointer;
      const polygon = this.state.polygons.find((p) => p.id === drag.polygonId);
      if (polygon && drag.originalPoints) {
        const index = this.state.polygons.findIndex((p) => p.id === polygon.id);
        const next = this.state.polygons.slice();
        next[index] = { ...polygon, points: drag.originalPoints };
        this.state.polygons = next;
        this.baseDirty = true;
      }
    }
    this.pointer = null;
    this.overlayDirty = true;
  }

  async throttledHover(pos) {
    const now = performance.now();
    if (now - this.lastHoverAt < HOVER_THROTTLE_MS) return;
    this.lastHoverAt = now;

    if (this.worker.alive) {
      const token = ++this.hoverToken;
      const result = await this.worker.hitTest(pos.x, pos.y);
      if (token !== this.hoverToken || this.pointer || this.state.draft) return;
      const polygon = result.index >= 0 ? this.state.polygons[result.index] : null;
      this.setHover(polygon?.id ?? null);
    } else {
      const result = topmostAt(this.state.polygons, pos.x, pos.y, HIT_TOLERANCE_PX);
      const polygon = result.hit ? this.state.polygons[result.index] : null;
      this.setHover(polygon?.id ?? null);
    }
  }

  setHover(id) {
    if (this.hoverId !== id) {
      this.hoverId = id;
      this.overlayDirty = true;
    }
    this.updateCursor();
  }

  updateCursor() {
    const canvas = this.stage.overlayCanvas;
    if (this.state.draft) {
      canvas.style.cursor = 'crosshair';
    } else if (this.hoverId || this.pointer?.moved) {
      canvas.style.cursor = 'move';
    } else {
      canvas.style.cursor = this.state.mode === 'draw' ? 'crosshair' : 'default';
    }
  }

  finishDraft() {
    const draft = this.state.draft;
    if (!draft) return;
    const points = dedupeConsecutivePoints(draft.points);
    if (points.length < 3) {
      this.toast('至少需要 3 个不重合的顶点才能闭合多边形', 'warn');
      return;
    }
    const label = this.elements.labelInput.value.trim();
    const polygon = { id: createId(), label, points };
    this.state.draft = null;
    this.state.commitAdd(polygon);
    this.state.select(polygon.id);
    this.cursorPoint = null;
    this.baseDirty = true;
    this.overlayDirty = true;
    this.updateUI();
  }

  cancelDraft(silent = false) {
    if (!this.state.draft) return;
    this.state.draft = null;
    this.cursorPoint = null;
    this.overlayDirty = true;
    this.updateUI();
    if (!silent) this.toast('已取消当前绘制', 'info', 1400);
  }

  deleteSelected() {
    const selected = this.state.selectedPolygon;
    if (!selected) {
      this.toast('请先选择一个多边形', 'warn');
      return;
    }
    this.state.commitDelete(selected);
    this.hoverId = null;
    this.baseDirty = true;
    this.overlayDirty = true;
    this.updateUI();
    this.toast('已删除多边形', 'info', 1400);
  }

  clearAll() {
    if (!this.state.polygons.length) {
      this.toast('当前没有任何多边形', 'info', 1400);
      return;
    }
    if (!window.confirm(`确定清空全部 ${this.state.polygons.length} 个多边形吗？`)) return;
    this.state.commitBatch(this.state.polygons, []);
    this.baseDirty = true;
    this.overlayDirty = true;
    this.updateUI();
    this.toast('已清空全部多边形（可撤销）', 'info', 1600);
  }

  safeAction(fn, name) {
    try {
      const ok = fn.call(this.state);
      if (!ok) this.toast(`${name}不可用`, 'warn', 1200);
      this.baseDirty = true;
      this.overlayDirty = true;
      this.updateUI();
    } catch (error) {
      console.error(error);
      this.toast(`${name}失败: ${error.message}`, 'error');
    }
  }

  onKeyDown(event) {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
    const ctrl = event.ctrlKey || event.metaKey;

    if (ctrl && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      if (this.state.draft) {
        this.popDraftVertex();
      } else {
        this.safeAction(this.state.undo, '撤销');
      }
      return;
    }
    if (ctrl && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
      event.preventDefault();
      this.safeAction(this.state.redo, '重做');
      return;
    }
    if (typing) return;

    switch (event.key) {
      case 'Enter':
        if (this.state.draft) this.finishDraft();
        break;
      case 'Escape':
        if (this.state.draft) {
          this.cancelDraft();
        } else {
          this.state.select(null);
          this.baseDirty = true;
          this.overlayDirty = true;
          this.updateUI();
        }
        break;
      case 'Backspace':
      case 'Delete':
        if (this.state.draft) this.popDraftVertex();
        else this.deleteSelected();
        break;
      case 'v':
      case 'V':
        this.switchMode('select');
        break;
      case 'p':
      case 'P':
        this.switchMode('draw');
        break;
      default:
        break;
    }
  }

  popDraftVertex() {
    const draft = this.state.draft;
    if (!draft || !draft.points.length) return;
    draft.points.pop();
    draft.closed = draft.points.length >= 3;
    this.overlayDirty = true;
    this.updateUI();
  }

  exportData() {
    try {
      if (!this.state.polygons.length) {
        this.toast('没有可导出的多边形', 'warn');
        return;
      }
      const invalid = this.state.polygons.filter((p) => !Array.isArray(p.points) || p.points.length < 3);
      if (invalid.length) {
        throw new Error(`${invalid.length} 个多边形数据不合法`);
      }
      const doc = downloadJSON(this.state.polygons, {
        width: this.stage.width,
        height: this.stage.height,
      });
      this.toast(`已导出 ${doc.polygons.length} 个多边形`, 'success');
    } catch (error) {
      console.error(error);
      this.toast(`导出失败: ${error.message}`, 'error');
    }
  }

  async importData(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const polygons = await importFromFile(file);
      this.state.replaceAll(polygons, true);
      this.baseDirty = true;
      this.overlayDirty = true;
      this.updateUI();
      this.toast(`已导入 ${polygons.length} 个多边形`, polygons.length ? 'success' : 'warn');
    } catch (error) {
      console.error(error);
      this.toast(`导入失败: ${error.message}`, 'error');
    }
  }

  async runStressTest() {
    const count = 500;
    if (this.state.polygons.length && !window.confirm('压测将替换当前画布内容，是否继续？')) return;
    const t0 = performance.now();
    const polygons = generateStressPolygons(count, this.stage.width, this.stage.height);
    const tGen = performance.now() - t0;

    const t1 = performance.now();
    this.state.replaceAll(polygons, false);
    this.baseDirty = true;
    this.overlayDirty = true;
    await this.framePainted();
    const tRender = performance.now() - t1;
    this.updateUI();
    this.toast(`压测 ${count} 个多边形：生成 ${tGen.toFixed(0)}ms / 渲染 ${tRender.toFixed(0)}ms`, 'success', 4200);
  }

  framePainted() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  syncWorker() {
    this.worker.setPolygons(this.state.polygons);
    this.worker.setLocalPolygons(this.state.polygons);
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const ok = saveToStorage(this.state.polygons);
      if (!ok) this.toast('自动保存失败（可能是存储空间不足）', 'warn', 1800);
    }, 400);
  }

  resize() {
    this.stage.resize();
    this.baseDirty = true;
    this.overlayDirty = true;
  }

  loop = () => {
    const frameStart = performance.now();

    if (this.baseDirty) {
      const t0 = performance.now();
      this.stage.drawBase(this.state.polygons, this.state.selectedId);
      this.lastBaseMs = performance.now() - t0;
      this.baseDirty = false;
    }

    if (this.overlayDirty || this.pointer || this.state.draft) {
      const dragGhost =
        this.pointer?.kind === 'move' && this.pointer.moved && this.pointer.ghostPoints
          ? (() => {
              const polygon = this.state.polygons.find((p) => p.id === this.pointer.polygonId);
              return polygon ? { ...polygon, points: this.pointer.ghostPoints } : null;
            })()
          : null;
      this.stage.drawOverlay({
        polygons: this.state.polygons,
        selectedId: this.state.selectedId,
        draft: this.state.draft,
        cursorPoint: this.cursorPoint,
        hoverId: this.hoverId,
        dragGhost,
      });
      this.overlayDirty = false;
    }

    const frameCost = performance.now() - frameStart;
    this.frameTimes.push(frameCost);
    if (this.frameTimes.length > 60) this.frameTimes.shift();

    this.fps.frames++;
    const now = performance.now();
    if (now - this.fps.lastSample >= 500) {
      this.fps.value = Math.round((this.fps.frames * 1000) / (now - this.fps.lastSample));
      this.fps.frames = 0;
      this.fps.lastSample = now;
      this.updateStats();
    }
    this.updateCursor();
    requestAnimationFrame(this.loop);
  };

  updateStats() {
    const polygons = this.state.polygons;
    const area = polygons.reduce((sum, p) => sum + polygonArea(p.points), 0);
    const vertices = polygons.reduce((sum, p) => sum + p.points.length, 0);
    const avgFrame = this.frameTimes.length
      ? (this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length).toFixed(1)
      : '0.0';
    const baseMs = this.lastBaseMs ? this.lastBaseMs.toFixed(1) : '0.0';
    this.elements.stats.textContent =
      `多边形 ${polygons.length} · 顶点 ${vertices} · 面积 ${Math.round(area)}px² · ` +
      `FPS ${this.fps.value} · 帧耗时 ${avgFrame}ms · 底图 ${baseMs}ms`;
  }

  updateUI() {
    const { state, elements } = this;
    elements.undo.disabled = !state.history.canUndo();
    elements.redo.disabled = !state.history.canRedo();
    elements.finish.disabled = !(state.draft && state.draft.points.length >= 3);
    elements.cancel.disabled = !state.draft;
    elements.delete.disabled = !state.selectedPolygon || !!state.draft;
    elements.export.disabled = state.polygons.length === 0;

    const inDraw = state.mode === 'draw';
    elements.toolDraw.classList.toggle('active', inDraw);
    elements.toolSelect.classList.toggle('active', !inDraw);
    elements.toolDraw.setAttribute('aria-pressed', String(inDraw));
    elements.toolSelect.setAttribute('aria-pressed', String(!inDraw));

    const selected = state.selectedPolygon;
    if (state.draft) {
      elements.labelInput.disabled = true;
      elements.labelInput.placeholder = `绘制中（${state.draft.points.length} 个顶点）`;
    } else if (selected) {
      elements.labelInput.disabled = false;
      if (document.activeElement !== elements.labelInput) {
        elements.labelInput.value = selected.label ?? '';
      }
      elements.labelInput.placeholder = '为选中多边形输入标签';
    } else {
      elements.labelInput.disabled = true;
      elements.labelInput.value = '';
      elements.labelInput.placeholder = '选择多边形后可编辑标签';
    }
    this.updateStats();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    window.annotator = new Annotator();
  } catch (error) {
    console.error(error);
    const container = document.getElementById('toastContainer');
    showToast(container, `应用初始化失败: ${error.message}`, 'error', 10000);
  }
});
