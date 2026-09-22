# 多边形标注工具

纯前端多边形标注工具：Canvas 渲染 + Pointer Events 交互 + Web Worker 导出。

## 运行

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

> 需要通过 HTTP 访问（不能直接双击打开 html），否则浏览器会拦截 Web Worker 脚本。

## 功能

- **多边形标注**：左键在空白处落点开始绘制，逐点添加顶点；点击起点（或双击 / 回车）闭合；Esc 取消当前草稿
- **编辑**：点击多边形内部选中；拖动任意顶点微调；Delete 删除选中项
- **撤销 / 重做**：Ctrl+Z / Ctrl+Y（或工具栏按钮），覆盖新建、删除、顶点移动、清空操作
- **导出 JSON**：序列化与校验在 Web Worker 中执行，不阻塞界面；导出前校验顶点数、坐标合法性与退化多边形
- **性能**：requestAnimationFrame 脏标记批渲染、devicePixelRatio 适配、历史栈上限 200 条
- **异常提示**：运行时错误、Worker 异常、导出超时（10s）、非法文件等均以 Toast 提示

## 导出格式

```json
{
  "version": "1.0",
  "exportedAt": "2026-09-22T00:00:00.000Z",
  "image": { "name": "a.png", "width": 1920, "height": 1080 },
  "stats": { "count": 2, "totalVertices": 9 },
  "annotations": [
    { "id": 1, "points": [[100, 100], [200, 100], [150, 200]] }
  ]
}
```

## 文件结构

- `index.html` — 页面与工具栏
- `css/style.css` — 样式
- `js/app.js` — 画布渲染、Pointer Events 交互、撤销/重做栈、导出调度
- `js/worker.js` — Worker 线程内的标注校验与 JSON 序列化
