"use strict";

/* ================= 异常提示 ================= */
const toastBox = document.getElementById("toasts");
function toast(message, type = "info", duration = 3200) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  toastBox.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

window.addEventListener("error", (e) => {
  toast(`运行时错误: ${e.message}`, "error");
});
window.addEventListener("unhandledrejection", (e) => {
  toast(`异步错误: ${e.reason && e.reason.message || e.reason}`, "error");
});

/* ================= 画布与渲染（性能：rAF 批处理 + DPR 适配） ================= */
const stage = document.getElementById("stage");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");

let viewW = 0;
let viewH = 0;
let dirty = true;

function resizeCanvas() {
  const rect = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewW = rect.width;
  viewH = rect.height;
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  requestRender();
}
new ResizeObserver(resizeCanvas).observe(stage);
resizeCanvas();

function requestRender() {
  if (dirty) return;
  dirty = true;
  requestAnimationFrame(render);
}

const COLORS = ["#2f6fed", "#2e9e5b", "#c98a1b", "#b04fd6", "#d64545", "#1ba8a0"];
const VERTEX_R = 5;
const CLOSE_DIST = 10;

/* ================= 状态 ================= */
let nextId = 1;
const polygons = [];            // 已完成: { id, points: [[x,y],...] }
let draft = [];                 // 正在绘制的顶点
let cursor = null;              // 指针当前位置（橡皮筋预览）
let selectedId = null;
let hoverVertex = null;         // { poly, index } 或 { draft: true, index }
let dragging = null;            // { poly, index, moved, from }
let bgImage = null;
let bgName = null;

const undoStack = [];
const redoStack = [];

/* ================= 撤销 / 重做 ================= */
function pushHistory(entry) {
  undoStack.push(entry);
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  syncToolbar();
}

function findPolygon(id) {
  return polygons.find((p) => p.id === id) || null;
}

function applyEntry(entry, reverse) {
  switch (entry.type) {
    case "add": {
      const remove = reverse;
      if (remove) {
        const i = polygons.findIndex((p) => p.id === entry.polygon.id);
        if (i >= 0) polygons.splice(i, 1);
      } else {
        polygons.push(entry.polygon);
      }
      break;
    }
    case "delete": {
      if (reverse) {
        polygons.splice(Math.min(entry.index, polygons.length), 0, entry.polygon);
      } else {
        const i = polygons.findIndex((p) => p.id === entry.polygon.id);
        if (i >= 0) polygons.splice(i, 1);
      }
      break;
    }
    case "move": {
      const poly = findPolygon(entry.id);
      if (poly) poly.points[entry.pointIndex] = reverse ? entry.from : entry.to;
      break;
    }
    case "clear": {
      if (reverse) {
        polygons.push(...entry.polygons);
      } else {
        polygons.length = 0;
      }
      break;
    }
  }
  selectedId = null;
  requestRender();
}

function undo() {
  const entry = undoStack.pop();
  if (!entry) return;
  applyEntry(entry, true);
  redoStack.push(entry);
  setStatus("已撤销");
  syncToolbar();
}

function redo() {
  const entry = redoStack.pop();
  if (!entry) return;
  applyEntry(entry, false);
  undoStack.push(entry);
  setStatus("已重做");
  syncToolbar();
}

/* ================= 工具栏状态 ================= */
const btnUndo = document.getElementById("btnUndo");
const btnRedo = document.getElementById("btnRedo");
const btnDelete = document.getElementById("btnDelete");

function syncToolbar() {
  btnUndo.disabled = undoStack.length === 0;
  btnRedo.disabled = redoStack.length === 0;
  btnDelete.disabled = selectedId === null;
}

function setStatus(text) {
  statusEl.textContent =
    `${text} · 多边形 ${polygons.length} 个` +
    (draft.length ? ` · 绘制中 ${draft.length} 点` : "");
}

/* ================= 命中检测 ================= */
function toCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
}

function hitVertex(pos) {
  for (let i = polygons.length - 1; i >= 0; i--) {
    const pts = polygons[i].points;
    for (let j = 0; j < pts.length; j++) {
      if (Math.hypot(pts[j][0] - pos[0], pts[j][1] - pos[1]) <= VERTEX_R + 3) {
        return { poly: polygons[i], index: j };
      }
    }
  }
  return null;
}

function pointInPolygon([x, y], points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function hitPolygon(pos) {
  for (let i = polygons.length - 1; i >= 0; i--) {
    if (pointInPolygon(pos, polygons[i].points)) return polygons[i];
  }
  return null;
}

/* ================= Pointer Events ================= */
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const pos = toCanvasPos(e);
  canvas.setPointerCapture(e.pointerId);

  const v = hitVertex(pos);
  if (v) {
    dragging = { poly: v.poly, index: v.index, moved: false, from: [...v.poly.points[v.index]] };
    return;
  }

  if (draft.length > 0) {
    // 点击起点附近则闭合
    const [fx, fy] = draft[0];
    if (draft.length >= 3 && Math.hypot(fx - pos[0], fy - pos[1]) <= CLOSE_DIST) {
      closeDraft();
      return;
    }
    draft.push(pos);
    setStatus("添加顶点");
    requestRender();
    return;
  }

  const hit = hitPolygon(pos);
  if (hit) {
    selectedId = hit.id;
    setStatus(`选中多边形 #${hit.id}`);
    syncToolbar();
    requestRender();
    return;
  }

  // 空白处落点：开始新的多边形
  selectedId = null;
  draft.push(pos);
  setStatus("开始绘制");
  syncToolbar();
  requestRender();
});

canvas.addEventListener("pointermove", (e) => {
  const pos = toCanvasPos(e);
  cursor = pos;
  if (dragging) {
    const pts = dragging.poly.points;
    pts[dragging.index] = pos;
    dragging.moved = true;
  } else {
    hoverVertex = hitVertex(pos);
    canvas.style.cursor = hoverVertex ? "grab" : "crosshair";
  }
  requestRender();
});

canvas.addEventListener("pointerup", () => {
  if (dragging) {
    if (dragging.moved) {
      pushHistory({
        type: "move",
        id: dragging.poly.id,
        pointIndex: dragging.index,
        from: dragging.from,
        to: [...dragging.poly.points[dragging.index]],
      });
      setStatus("顶点已移动");
    }
    dragging = null;
    requestRender();
  }
});

canvas.addEventListener("pointerleave", () => {
  cursor = null;
  requestRender();
});

canvas.addEventListener("dblclick", () => {
  if (draft.length >= 3) closeDraft();
});

function closeDraft() {
  if (draft.length < 3) {
    toast("至少需要 3 个顶点才能构成多边形", "warn");
    return;
  }
  const polygon = { id: nextId++, points: draft.map((p) => [...p]) };
  polygons.push(polygon);
  pushHistory({ type: "add", polygon });
  draft = [];
  selectedId = polygon.id;
  setStatus(`多边形 #${polygon.id} 已完成`);
  toast(`多边形 #${polygon.id} 已创建（${polygon.points.length} 个顶点）`, "success");
  syncToolbar();
  requestRender();
}

function cancelDraft() {
  if (draft.length === 0) return;
  draft = [];
  setStatus("已取消绘制");
  requestRender();
}

/* ================= 键盘 ================= */
window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
  else if (e.key === "Escape") cancelDraft();
  else if (e.key === "Enter" && draft.length >= 3) closeDraft();
  else if ((e.key === "Delete" || e.key === "Backspace") && selectedId !== null) deleteSelected();
});

/* ================= 工具栏动作 ================= */
btnUndo.addEventListener("click", undo);
btnRedo.addEventListener("click", redo);

function deleteSelected() {
  const index = polygons.findIndex((p) => p.id === selectedId);
  if (index < 0) return;
  const [polygon] = polygons.splice(index, 1);
  pushHistory({ type: "delete", polygon, index });
  selectedId = null;
  setStatus(`已删除多边形 #${polygon.id}`);
  syncToolbar();
  requestRender();
}
btnDelete.addEventListener("click", deleteSelected);

document.getElementById("btnClear").addEventListener("click", () => {
  if (polygons.length === 0 && draft.length === 0) {
    toast("当前没有可清空的标注", "info");
    return;
  }
  pushHistory({ type: "clear", polygons: polygons.map((p) => ({ ...p, points: p.points.map((pt) => [...pt]) })) });
  polygons.length = 0;
  draft = [];
  selectedId = null;
  setStatus("已清空");
  syncToolbar();
  requestRender();
});

/* ================= 背景图片 ================= */
const fileInput = document.getElementById("fileInput");
document.getElementById("btnLoadImage").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  fileInput.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    toast("请选择图片文件", "error");
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    bgImage = img;
    bgName = file.name;
    URL.revokeObjectURL(url);
    setStatus("图片已加载");
    requestRender();
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    toast("图片加载失败，请重试", "error");
  };
  img.src = url;
});

/* ================= 导出 JSON（Web Worker） ================= */
let worker = null;
let jobSeq = 0;
const pendingJobs = new Map();

function getWorker() {
  if (worker) return worker;
  try {
    worker = new Worker("js/worker.js");
  } catch (err) {
    toast(`Web Worker 创建失败: ${err.message}`, "error");
    return null;
  }
  worker.onmessage = (e) => {
    const { jobId, ok, json, errors, stats } = e.data || {};
    const job = pendingJobs.get(jobId);
    if (!job) return;
    pendingJobs.delete(jobId);
    clearTimeout(job.timer);
    if (ok) job.resolve({ json, stats });
    else job.reject(new Error((errors || ["未知错误"]).join("；")));
  };
  worker.onerror = (e) => {
    toast(`Worker 异常: ${e.message}`, "error");
    for (const [, job] of pendingJobs) {
      clearTimeout(job.timer);
      job.reject(new Error(e.message));
    }
    pendingJobs.clear();
  };
  return worker;
}

function exportInWorker(payload) {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    if (!w) return reject(new Error("Web Worker 不可用"));
    const jobId = ++jobSeq;
    const timer = setTimeout(() => {
      pendingJobs.delete(jobId);
      reject(new Error("导出超时（10s），请重试"));
    }, 10000);
    pendingJobs.set(jobId, { resolve, reject, timer });
    w.postMessage({ jobId, type: "export", payload });
  });
}

document.getElementById("btnExport").addEventListener("click", async () => {
  if (draft.length > 0) {
    toast("存在未闭合的多边形，请先完成或按 Esc 取消", "warn");
    return;
  }
  if (polygons.length === 0) {
    toast("没有可导出的标注", "warn");
    return;
  }
  const payload = {
    image: bgImage
      ? { name: bgName, width: bgImage.naturalWidth, height: bgImage.naturalHeight }
      : { name: null, width: Math.round(viewW), height: Math.round(viewH) },
    annotations: polygons.map((p) => ({ id: p.id, points: p.points.map((pt) => [...pt]) })),
  };
  setStatus("导出中…");
  try {
    const { json, stats } = await exportInWorker(payload);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `annotations-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("导出完成");
    toast(`已导出 ${stats.count} 个多边形，共 ${stats.totalVertices} 个顶点`, "success");
  } catch (err) {
    setStatus("导出失败");
    toast(`导出失败: ${err.message}`, "error");
  }
});

/* ================= 渲染 ================= */
function drawPolygon(points, color, { closed, selected }) {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  if (closed) {
    ctx.closePath();
    ctx.fillStyle = color + (selected ? "55" : "33");
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? 3 : 2;
  ctx.stroke();
  for (const [x, y] of points) {
    ctx.beginPath();
    ctx.arc(x, y, VERTEX_R, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function render() {
  dirty = false;
  ctx.clearRect(0, 0, viewW, viewH);

  if (bgImage) {
    const scale = Math.min(viewW / bgImage.naturalWidth, viewH / bgImage.naturalHeight);
    const w = bgImage.naturalWidth * scale;
    const h = bgImage.naturalHeight * scale;
    ctx.drawImage(bgImage, (viewW - w) / 2, (viewH - h) / 2, w, h);
  }

  for (const poly of polygons) {
    drawPolygon(poly.points, COLORS[poly.id % COLORS.length], {
      closed: true,
      selected: poly.id === selectedId,
    });
  }

  if (draft.length > 0) {
    drawPolygon(draft, "#ffd54a", { closed: false, selected: false });
    if (cursor) {
      const last = draft[draft.length - 1];
      ctx.beginPath();
      ctx.moveTo(last[0], last[1]);
      ctx.lineTo(cursor[0], cursor[1]);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#ffd54a";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      // 起点高亮，提示可点击闭合
      if (draft.length >= 3) {
        ctx.beginPath();
        ctx.arc(draft[0][0], draft[0][1], CLOSE_DIST, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255, 213, 74, 0.5)";
        ctx.stroke();
      }
    }
  }

  if (hoverVertex && !dragging) {
    const [x, y] = hoverVertex.poly.points[hoverVertex.index];
    ctx.beginPath();
    ctx.arc(x, y, VERTEX_R + 3, 0, Math.PI * 2);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

setStatus("就绪");
syncToolbar();
