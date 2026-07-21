# 对局界面 · 单屏布局规则

本文约定 `Devil Roulette` 对局中的视口与底部交互区布局，改 UI / CSS 时必须遵守。

## 硬性目标

1. **单屏锁定**：默认整页为 `100vw × 100dvh`（`html, body`），对局中**禁止出现页面滚动条**（`overflow: hidden`）。
2. **手牌完整显示**：道具手牌在静止态必须整张可见，不得被视口底边、工具栏或父容器裁切。
3. **悬停预览（炉石式）**：悬停手牌时，手牌本身只**轻微抬起**；大图在独立层 `.hand-preview`（约 200×280，矮屏可缩小），盖在牌桌上方，不得被牌桌挡住。
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
| `.hand-fan` | 静止态高度 ≥ 道具牌高度；**禁止**用大额负 `margin-top` 把牌推到视口外。命中靠固定尺寸 `.hand-slot`；牌面只轻抬，**禁止**对手牌本身做 ≥2× 缩放（大图走 `.hand-preview`）。 |
| `.hand-preview` | `position: absolute`，不占布局高度；悬停/点选时显示，含大图 + 名称 + 简述。 |
| `.actions-dock` | 始终 `flex: 0 0 auto`，完整可见。 |
| 四座位「开枪」 | 顶座位可在牌下；左右座位必须横排在角色牌靠毡桌一侧（勿牌下竖排），总高度≈角色牌，避免压到底栏分界线以下。自己座位「开枪」在角色牌右侧。 |

## 推荐尺寸参考（可调，但需自测不裁切）

- 道具牌静止：约 `86×120` px；扇形可轻微重叠与旋转
- 手牌悬停（未选中）：约 `translateY(-22px) scale(1.08)`，同时显示 `.hand-preview`
- 预览大图：约 `200×280`（`--hand-preview-w/h`）；矮屏可降到约 `150×210`
- 手牌选中：上移固定（约 `translateY(-28px)`）+ 金边；普通道具单选，铁玫瑰最多 2 张；用后从手牌移除，本回合可再选再用
- 自己角色牌：宜略小于桌面座位，避免底部过高挤掉工具栏
- 桌面座位列宽与红队顶栏宽度保持一致（勿让顶座位横向拉满）

## 改动后自测清单

- [ ] 窗口约 1280×720 / 1920×1080：无纵向滚动条
- [ ] 道具手牌四角完整可见
- [ ] 悬停手牌：轻抬 + 独立大图预览完整可见，不被裁切
- [ ] 「使用道具」按钮完整可见且可点
- [ ] 轮到自己时可点选手牌 → 使用道具
- [ ] 左右座位「开枪」在角色牌内侧完整可见，不被底栏分界线挡住

## 相关文件

- `.cursor/rules/layout.md` — 本文（完整说明）
- `.cursor/rules/single-screen-layout.mdc` — Cursor 规则（编辑 CSS/HTML 时自动应用）
- `css/style.css` — 视口与底部布局
- `index.html` — `.table-wrap` / `.bottom-panel` / `.hand-preview` 结构
