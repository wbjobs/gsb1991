"use strict";

// 在 Worker 线程中完成校验、统计与 JSON 序列化，避免阻塞主线程渲染。
function polygonArea(points) {
  let area = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

function validate(annotations) {
  const errors = [];
  annotations.forEach((ann, index) => {
    if (!Array.isArray(ann.points) || ann.points.length < 3) {
      errors.push(`标注 #${ann.id ?? index} 顶点数不足（至少需要 3 个）`);
      return;
    }
    for (const p of ann.points) {
      if (!Array.isArray(p) || p.length !== 2 ||
          !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
        errors.push(`标注 #${ann.id ?? index} 存在非法顶点坐标`);
        return;
      }
    }
    if (polygonArea(ann.points) < 1) {
      errors.push(`标注 #${ann.id ?? index} 面积过小，疑似退化多边形`);
    }
  });
  return errors;
}

self.onmessage = (event) => {
  const { jobId, type, payload } = event.data || {};
  try {
    if (type !== "export") {
      throw new Error(`未知任务类型: ${type}`);
    }
    const { annotations, image } = payload;
    const errors = validate(annotations);
    if (errors.length > 0) {
      self.postMessage({ jobId, ok: false, errors });
      return;
    }
    const doc = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      image: image || null,
      stats: {
        count: annotations.length,
        totalVertices: annotations.reduce((sum, a) => sum + a.points.length, 0),
      },
      annotations,
    };
    const json = JSON.stringify(doc, null, 2);
    self.postMessage({ jobId, ok: true, json, stats: doc.stats });
  } catch (err) {
    self.postMessage({ jobId, ok: false, errors: [String(err && err.message || err)] });
  }
};
