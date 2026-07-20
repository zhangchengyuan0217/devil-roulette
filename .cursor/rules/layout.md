# 对局界面 · 单屏布局规则

本文约定 `Devil Roulette` 对局中的视口与底部交互区布局，改 UI / CSS 时必须遵守。

## 硬性目标

1. **单屏锁定**：默认整页为 `100vw × 100dvh`（`html, body`），对局中**禁止出现页面滚动条**（`overflow: hidden`）。
2. **手牌完整显示**：道具手牌在静止态必须整张可见，不得被视口底边、工具栏或父容器裁切。
3. **悬停向上放大**：手牌悬停可放大（目标约 **2.7×** 及以上），放大方向为**向上**，且不得被牌桌 / 座位挡住。
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
| `.hand-fan` | 静止态高度 ≥ 道具牌高度；**禁止**用大额负 `margin-top` 把牌推到视口外。悬停放大靠 `transform` + 高层 `z-index` 盖到牌桌上。 |
| `.actions-dock` | 始终 `flex: 0 0 auto`，完整可见。 |
| 悬停放大 | 手牌：`transform-origin: center bottom`，向上 `translateY` + `scale(≥2.7)`；`.bottom-panel` 的 `z-index` 高于 `.board-arena`。角色牌可有独立悬停放大，同样不得裁切工具栏。 |
| 四座位「开枪」 | 顶座位可在牌下；左右座位必须横排在角色牌靠毡桌一侧（勿牌下竖排），总高度≈角色牌，避免压到底栏分界线以下。自己座位「开枪」在角色牌右侧。 |

## 推荐尺寸参考（可调，但需自测不裁切）

- 道具牌静止：约 `86×120` px
- 手牌悬停（未选中）：`scale(2.7)` 或以上，向上预览
- 手牌选中：斗地主式上移固定（约 `translateY(-36px)`），悬停不再放大；普通道具单选，铁玫瑰最多 2 张；用后从手牌移除，本回合可再选再用
- 自己角色牌：宜略小于桌面座位，避免底部过高挤掉工具栏
- 桌面座位列宽与红队顶栏宽度保持一致（勿让顶座位横向拉满）

## 改动后自测清单

- [ ] 窗口约 1280×720 / 1920×1080：无纵向滚动条
- [ ] 道具手牌四角完整可见
- [ ] 悬停手牌向上放大 ≥2.7×，不被裁切、不被牌桌挡住
- [ ] 「使用道具」按钮完整可见且可点
- [ ] 轮到自己时可点选手牌 → 使用道具
- [ ] 左右座位「开枪」在角色牌内侧完整可见，不被底栏分界线挡住

## 相关文件

- `.cursor/rules/layout.md` — 本文（完整说明）
- `.cursor/rules/single-screen-layout.mdc` — Cursor 规则（编辑 CSS/HTML 时自动应用）
- `css/style.css` — 视口与底部布局
- `index.html` — `.table-wrap` / `.bottom-panel` 结构
