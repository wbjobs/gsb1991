# 多边形标注工具

基于 **Canvas + Pointer Events + Web Worker** 的纯前端多边形标注工具，无任何第三方依赖。

## 运行

ES Module（含 module Worker）需要通过 HTTP 访问，不能直接双击 `index.html`：

```bash
# 任选其一
python3 -m http.server 8080
# 或
npx serve .
```

然后打开 <http://localhost:8080/index.html>。

## 功能

- **多边形标注**：单击逐点添加顶点；点击起点 / 双击 / Enter /「闭合」按钮闭合；绘制中显示橡皮筋预览线；Backspace 或 Ctrl+Z 可逐点回退；Esc /「取消」放弃当前绘制。
- **选择与编辑**：V 切选择模式（P 回绘制）；点击选中、拖空白处取消；可整体拖动多边形、拖动选中多边形的顶点；标签输入框实时编辑标签。
- **撤销 / 重做**：Ctrl+Z / Ctrl+Y（或 Ctrl+Shift+Z），支持 add / delete / replace / 批量清空，连续标签编辑自动合并，上限 200 步。
- **导出 JSON**：结构如下，坐标为画布 CSS 像素，保留两位小数：
  ```json
  {
    "version": 1,
    "exportedAt": "2026-09-22T00:00:00.000Z",
    "meta": { "width": 1200, "height": 800, "coordinateSystem": "canvas-css-pixel", "polygonCount": 2 },
    "polygons": [
      { "id": "uuid", "label": "目标A", "points": [{ "x": 10, "y": 20 }, { "x": 100, "y": 20 }, { "x": 60, "y": 90 }] }
    ]
  }
  ```
- **导入 JSON**：导入同结构文件并做完整校验（id 非空且唯一、顶点 ≥ 3、坐标必须为有限数），失败弹出具体原因。
- **性能**：
  - 双 Canvas 分层：静态底图（所有多边形）只在数据变化时重绘，overlay 层负责拖拽/悬停/橡皮筋，单帧只需清屏重绘少量内容。
  - 命中检测放在 Web Worker，hover 节流 40ms 且结果按 token 丢弃过期响应，500 个多边形也不阻塞输入。
  - DPR 感知（上限 2x），rAF 渲染循环，状态栏实时显示多边形数、顶点数、FPS、帧耗时、底图重绘耗时。
  - 「压测 500」按钮一键生成 500 个随机多边形并报告生成/渲染耗时。
  - Worker 初始化或运行失败时自动降级为主线程命中检测并提示。
- **异常提示**：顶点不足无法闭合、退化多边形自动还原、导出空数据、非法 JSON、重复 id、Worker 不可用、localStorage 写入失败、未捕获的运行时/Promise 错误，均通过右上角 Toast 给出中文提示。
- **自动保存**：每 400ms 防抖写入 localStorage，刷新后自动恢复；数据损坏时静默忽略。

## 目录结构

```
index.html            页面与工具栏
css/style.css         样式
js/geometry.js        纯几何算法（点在多边形内、点到折线距离等，Worker 复用）
js/model.js           JSON 文档规范化与导出构造、校验
js/history.js         撤销/重做栈与增删改回放
js/store.js           AppState 全局状态与提交入口
js/worker.js          Web Worker：命中检测/统计
js/render.js          底图与 overlay 绘制
js/io.js              下载/导入/localStorage
js/stress.js          压测数据生成
js/app.js             控制器：Pointer Events、键盘、UI、渲染循环
test/                 node:test 单元测试（几何/历史/模型）
```

## 测试

```bash
npm test
```
