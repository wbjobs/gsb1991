'use strict';

import { topmostAt, polygonArea } from './geometry.js';

let polygons = [];

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

self.onmessage = (event) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'setPolygons':
        polygons = Array.isArray(msg.polygons) ? msg.polygons : [];
        break;
      case 'hitTest': {
        const result = topmostAt(polygons, msg.x, msg.y, msg.tolerance ?? 8);
        post('hitTestResult', {
          reqId: msg.reqId,
          index: result.index,
        });
        break;
      }
      case 'stats': {
        const totalArea = polygons.reduce((sum, p) => sum + polygonArea(p.points), 0);
        post('statsResult', {
          reqId: msg.reqId,
          polygonCount: polygons.length,
          totalArea: Math.round(totalArea),
          vertexCount: polygons.reduce((sum, p) => sum + p.points.length, 0),
        });
        break;
      }
      default:
        post('error', { message: `未知的 Worker 消息: ${msg.type}` });
    }
  } catch (error) {
    post('error', { message: error && error.message ? error.message : String(error) });
  }
};
