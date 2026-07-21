# 对局界面 · 单屏布局规则

本文约定 `Devil Roulette` 对局中的视口与底部交互区布局，改 UI / CSS 时必须遵守。

## 硬性目标

1. **单屏锁定**：默认整页为 `100vw × 100dvh`（`html, body`），对局中**禁止出现页面滚动条**（`overflow: hidden`）。
2. **手牌完整显示**：道具手牌在静止态必须整张可见，不得被视口底边、工具栏或父容器裁切。
3. **悬停预览（炉石式）**：桌面端悬停时手牌只**轻微抬起**；大图在独立层 `.hand-preview`。手机**横屏**改为点选预览 + `fixed` 居中浮层；**竖屏不做特殊适配**。
4. **底部工具栏固定可见**：「使用道具」等操作栏（`.actions-dock`）必须始终完整出现在视口内，不得被挤出屏幕。

结束结算（`body.phase-ended`）可临时允许滚动，不在本规则约束内。

## 页面结构（自上而下）

```
body (100dvh, flex column, overflow hidden)
├── .topbar                 /* flex: 0 0 auto */
└── .table-wrap.active      /* flex: 1; grid */
    ├── .round-banner       /* auto */
    ├── .board-arena        /* minmax(0, 1fr) —— 唯一可压缩区 */
    └── .bottom-panel       /* flex/grid: 0 0 auto —— 按内容撑开，不可被压扁裁切 */
        ├── .me-zone        /* 角色 + 手牌，flex: 0 0 auto */
        └── .actions-dock   /* 工具栏，flex: 0 0 auto */
```

## 不可违反的约束

| 区域 | 规则 |
|------|------|
| `.board-arena` | 唯一用 `minmax(0, 1fr)` / `flex: 1` **吸收剩余高度**；内容再多也优先压缩牌桌，而不是裁切底部。 |
| `.bottom-panel` | **禁止**用过小的 `max-height` 把内部压扁；高度由「自己座位 + 完整手牌 + 工具栏」决定。 |
| `.me-zone` | `flex: 0 0 auto`，`min-height` 不得为 `0` 导致被压缩；`overflow: visible`。 |
| `.hand-fan` | 静止态高度 ≥ 道具牌高度；命中靠固定尺寸 `.hand-slot`；牌面只轻抬，大图走 `.hand-preview`。 |
| `.hand-preview` | 桌面：`absolute`；手机横屏：`fixed` 居中。不占布局高度。 |
| `.actions-dock` | 始终 `flex: 0 0 auto`，完整可见。 |
| 四座位「开枪」 | 十字布局：上 / 左毡右；左右开枪靠毡桌一侧。自己座位开枪在角色牌右侧。 |

## 手机横屏（`orientation: landscape` + `max-height: 560px` + `max-width: 960px`）

- 保持十字座位；角色牌缩为迷你卡，名字叠在卡上，开枪按钮叠在卡角。
- **底栏单行横排**：自己角色 | 手牌 | 操作按钮，不再竖堆占高度。
- 预览 fixed 居中；关闭 hover 放大；`safe-area-inset`。
- **竖屏不写特殊对局布局**。

## 推荐尺寸参考（可调，但需自测不裁切）

- 道具牌静止：桌面约 `86×120`；手机横屏约 `44×62`
- 手牌悬停（桌面）：约 `translateY(-22px) scale(1.08)` + `.hand-preview`
- 预览大图：桌面约 `200×280`；手机横屏约 `100×140`
- 手牌选中：上移固定 + 金边；普通道具单选，铁玫瑰最多 2 张

## 改动后自测清单

- [ ] 桌面 1280×720 / 1920×1080：无纵向滚动条
- [ ] 道具手牌四角完整可见；悬停预览正常
- [ ] 手机横屏：座位 / 手牌 /「使用道具」完整可点，无严重叠压
- [ ] 手机竖屏：无额外适配要求（可不测）

## 相关文件

- `.cursor/rules/layout.md` — 本文
- `.cursor/rules/single-screen-layout.mdc` — Cursor 规则
- `css/style.css` — 文末横屏 media 段
- `index.html` — 结构与预览逻辑
