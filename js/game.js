/** 房主权威：对局逻辑 */

const MAX_HP = 6;
const HAND_LIMIT = 8;

/** 客户端动画最长等待；超时后房主可自动推进，任意客户端也可提前发送 done */
const AWAITING_ANIM_MS = {
  ammo_draw: 5200,
  first_player_spin: 3500,
  painkiller_dice: 2800,
  eject_anim: 2800,
  item_fx: 3200,
  double_barrel_reveal: 3800,
  shot_reveal: 5600
};

/** 需玩家操作的窗口超时（弃牌 / 双管） */
const INTERACTIVE_AWAITING_MS = 30000;

const AWAITING_TIMEOUT_MS = Object.assign({}, AWAITING_ANIM_MS, {
  discard_hand: INTERACTIVE_AWAITING_MS,
  double_barrel: INTERACTIVE_AWAITING_MS
});

function stampAwaitingExpiry(awaiting, type) {
  if (!awaiting) return awaiting;
  const ms = AWAITING_TIMEOUT_MS[type || awaiting.type];
  if (ms) {
    awaiting.expiresAt = Date.now() + ms;
    if (ms >= 10000) awaiting.seconds = Math.round(ms / 1000);
  }
  return awaiting;
}

function resolveExpiredAwaiting(state) {
  const a = state.awaiting;
  if (!a || !a.expiresAt) return false;
  if (Date.now() < a.expiresAt) return false;
  switch (a.type) {
    case 'ammo_draw':
      continueAfterAmmoDraw(state);
      return true;
    case 'first_player_spin':
      continueAfterFirstPlayer(state);
      return true;
    case 'painkiller_dice':
      continueAfterPainkillerDice(state);
      return true;
    case 'eject_anim':
      continueAfterEject(state);
      return true;
    case 'item_fx':
      continueAfterItemFx(state);
      return true;
    case 'double_barrel_reveal':
      continueAfterDoubleBarrelReveal(state);
      return true;
    case 'shot_reveal':
      continueAfterShotReveal(state);
      return true;
    case 'discard_hand':
      timeoutDiscardHand(state);
      return true;
    case 'double_barrel':
      timeoutDoubleBarrel(state);
      return true;
    case 'rattlesnake':
      rattlesnakeTimeout(state, a.token);
      return true;
    default:
      return false;
  }
}

function createEmptyState() {
  return {
    phase: 'lobby', // lobby | playing | ended
    mode: 'ffa',
    round: 0,
    players: [],
    turnOrder: [],
    currentTurn: 0,
    itemDeck: [],
    itemDiscard: [],
    ammoCountDeck: [],
    magazine: [],
    loadout: { live: 0, blank: 0, special: 0 },
    fired: { live: 0, blank: 0, special: 0 },
    effects: {
      reverseNext: false,
      shotgunNext: false,
      sniperNext: false,
      // 连锁配对：每组 1～2 人；每人同时只能出现在一组中
      linkedPairs: [], // Array<actorNr[]>
      doubleItemBonus: {}, // actorNr -> extra draws next round
      // 双管声明公示：fromBottom 为弹匣底部起 0-based，随换弹跟随实体弹
      doubleBarrelCall: null
    },
    awaiting: null, // { type, actorNr, ... }
    lastItemForSnake: null,
    rattlesnakeQueue: [],
    rattlesnakeUsedThisRound: {},
    winner: null,
    winnerTeam: null,
    publicLog: [],
    seq: 0
  };
}

function logState(state, msg) {
  state.publicLog.push(msg);
  if (state.publicLog.length > 80) state.publicLog.shift();
}

function getPlayer(state, actorNr) {
  const nr = Number(actorNr);
  return state.players.find((p) => Number(p.actorNr) === nr);
}

/** 对手：混战=其他存活玩家；组队=其他队伍存活玩家 */
function isOpponent(state, me, other) {
  if (!me || !other || !other.alive) return false;
  if (Number(me.actorNr) === Number(other.actorNr)) return false;
  if (state.mode === 'team') return Number(me.team) !== Number(other.team);
  return true;
}

function alivePlayers(state) {
  return state.players.filter((p) => p.alive);
}

function initPlayers(state, actors, mode) {
  state.mode = mode || 'ffa';
  state.players = actors.map((a, i) => ({
    actorNr: a.actorNr,
    userId: a.userId || '',
    name: a.name || `玩家${a.actorNr}`,
    hp: MAX_HP,
    role: null,
    hand: [],
    alive: true,
    team: mode === 'team' ? (i % 2) : i, // team 0/1 for 2v2; ffa unique
    skipNextTurn: false,
    bulletproof: false,
    debtorNr: null,
    scentMarkedThisRound: false
  }));

  if (mode === 'team' && state.players.length === 4) {
    // A1 B1 A2 B2 → teams 0,1,0,1 already; turn order A1,B1,A2,B2
    state.turnOrder = state.players.map((p) => p.actorNr);
  } else {
    state.turnOrder = shuffle(state.players.map((p) => p.actorNr));
  }

  const roles = buildRoleDeck();
  state.players.forEach((p, i) => {
    p.role = roles[i % roles.length];
  });

  state.itemDeck = buildItemDeck();
  state.itemDiscard = [];
  state.ammoCountDeck = buildAmmoCountDeck();
  state.masterActorNr = Math.min(...state.players.map((p) => p.actorNr));
  state.phase = 'playing';
  state.round = 0;
  state.winner = null;
  state.winnerTeam = null;
  logState(state, `游戏开始（${state.mode === 'team' ? '组队' : '混战'}）。角色已发放。`);
  startRound(state);
}

/** 重连后座位号变化时，把对局里的旧 actorNr 全部映射到新座位 */
function remapActorNr(state, oldNr, newNr) {
  const from = Number(oldNr);
  const to = Number(newNr);
  if (!state || !Number.isFinite(from) || !Number.isFinite(to) || from === to) return false;
  const p = getPlayer(state, from);
  if (!p) return false;
  if (getPlayer(state, to)) return false;

  const swap = (n) => (Number(n) === from ? to : n);

  p.actorNr = to;
  state.turnOrder = (state.turnOrder || []).map(swap);
  if (state.handDiscardQueue) state.handDiscardQueue = state.handDiscardQueue.map(swap);
  if (state.rattlesnakeQueue) state.rattlesnakeQueue = state.rattlesnakeQueue.map(swap);

  state.players.forEach((pl) => {
    if (Number(pl.debtorNr) === from) pl.debtorNr = to;
  });

  if (state.effects) {
    if (Array.isArray(state.effects.linkedPairs)) {
      state.effects.linkedPairs = state.effects.linkedPairs.map((pair) => pair.map(swap));
    }
    if (state.effects.doubleItemBonus && state.effects.doubleItemBonus[from] != null) {
      state.effects.doubleItemBonus[to] = state.effects.doubleItemBonus[from];
      delete state.effects.doubleItemBonus[from];
    }
  }

  if (state.rattlesnakeUsedThisRound && state.rattlesnakeUsedThisRound[from] != null) {
    state.rattlesnakeUsedThisRound[to] = state.rattlesnakeUsedThisRound[from];
    delete state.rattlesnakeUsedThisRound[from];
  }

  if (state.awaiting && Number(state.awaiting.actorNr) === from) {
    state.awaiting.actorNr = to;
  }
  if (state.awaiting && state.awaiting.targetActorNr != null && Number(state.awaiting.targetActorNr) === from) {
    state.awaiting.targetActorNr = to;
  }
  if (state.lastItemForSnake && Number(state.lastItemForSnake.from) === from) {
    state.lastItemForSnake.from = to;
  }
  if (Number(state.winner) === from) state.winner = to;
  if (Number(state.masterActorNr) === from) state.masterActorNr = to;

  logState(state, `${p.name} 重连，座位 #${from} → #${to}`);
  return true;
}

function findPlayerByUserId(state, userId) {
  if (!state || !userId) return null;
  return state.players.find((p) => p.userId && p.userId === userId) || null;
}

function drawItems(state, player, n) {
  for (let i = 0; i < n; i++) {
    if (state.itemDeck.length === 0) {
      if (state.itemDiscard.length === 0) break;
      state.itemDeck = shuffle(state.itemDiscard);
      state.itemDiscard = [];
      logState(state, '道具弃牌堆已洗回。');
    }
    player.hand.push(state.itemDeck.pop());
  }
  queueHandDiscardIfNeeded(state, player);
}

function queueHandDiscardIfNeeded(state, player) {
  if (!player || player.hand.length <= HAND_LIMIT) return;
  if (!state.handDiscardQueue) state.handDiscardQueue = [];
  if (!state.handDiscardQueue.includes(player.actorNr)) {
    state.handDiscardQueue.push(player.actorNr);
  }
}

function tryStartHandDiscard(state) {
  if (state.phase === 'ended') return false;
  if (state.awaiting) return false;
  if (!state.handDiscardQueue) state.handDiscardQueue = [];
  while (state.handDiscardQueue.length) {
    const nr = state.handDiscardQueue.shift();
    const p = getPlayer(state, nr);
    if (!p || !p.alive || p.hand.length <= HAND_LIMIT) continue;
    state.awaiting = stampAwaitingExpiry(
      {
        type: 'discard_hand',
        actorNr: p.actorNr,
        name: p.name,
        need: p.hand.length - HAND_LIMIT,
        handCount: p.hand.length,
        token: `hd-${state.round}-${p.actorNr}-${Date.now()}`
      },
      'discard_hand'
    );
    logState(
      state,
      `${p.name} 手牌 ${p.hand.length} 张，需弃至 ${HAND_LIMIT} 张（自选 ${state.awaiting.need} 张，限时 ${state.awaiting.seconds} 秒）。`
    );
    return true;
  }
  return false;
}

function resumeAfterHandDiscard(state) {
  if (tryStartHandDiscard(state)) return;
  if (state.pendingAmmoDraw) {
    const pad = state.pendingAmmoDraw;
    state.pendingAmmoDraw = null;
    state.awaiting = stampAwaitingExpiry(Object.assign({ type: 'ammo_draw' }, pad), 'ammo_draw');
    logState(state, `第 ${pad.round} 轮弹药数量抽取中…`);
    return;
  }
}

function discardHandCards(state, actorNr, indexes) {
  if (!state.awaiting || state.awaiting.type !== 'discard_hand') {
    return { ok: false, reason: '当前无需弃牌' };
  }
  if (Number(state.awaiting.actorNr) !== Number(actorNr)) {
    return { ok: false, reason: '不是你的弃牌' };
  }
  const p = getPlayer(state, actorNr);
  if (!p) return { ok: false, reason: '玩家不存在' };
  const need = state.awaiting.need;
  if (!Array.isArray(indexes) || indexes.length !== need) {
    return { ok: false, reason: `需弃置 ${need} 张` };
  }
  const uniq = [...new Set(indexes.map((i) => i | 0))].sort((a, b) => b - a);
  if (uniq.length !== need) return { ok: false, reason: '弃牌选择重复' };
  if (uniq.some((i) => i < 0 || i >= p.hand.length)) return { ok: false, reason: '弃牌无效' };
  const names = [];
  uniq.forEach((i) => {
    const id = p.hand.splice(i, 1)[0];
    state.itemDiscard.push(id);
    names.push(ITEMS[id] ? ITEMS[id].name : id);
  });
  logState(state, `${p.name} 弃置：${names.map((n) => '【' + n + '】').join('、')}。`);
  state.awaiting = null;
  resumeAfterHandDiscard(state);
  return { ok: true };
}

function timeoutDiscardHand(state) {
  if (!state.awaiting || state.awaiting.type !== 'discard_hand') return;
  const actorNr = state.awaiting.actorNr;
  const need = state.awaiting.need;
  const p = getPlayer(state, actorNr);
  if (!p || need <= 0) {
    state.awaiting = null;
    resumeAfterHandDiscard(state);
    return;
  }
  const idxs = [];
  for (let i = p.hand.length - 1; i >= 0 && idxs.length < need; i--) idxs.push(i);
  if (idxs.length !== need) {
    logState(state, `${p.name} 弃牌超时，强制弃至上限。`);
    while (p.hand.length > HAND_LIMIT) state.itemDiscard.push(p.hand.pop());
    state.awaiting = null;
    resumeAfterHandDiscard(state);
    return;
  }
  logState(state, `${p.name} 弃牌超时，系统代为弃置手牌末尾 ${idxs.length} 张。`);
  discardHandCards(state, actorNr, idxs);
}

function timeoutDoubleBarrel(state) {
  if (!state.awaiting || state.awaiting.type !== 'double_barrel') return;
  const actorNr = state.awaiting.actorNr;
  const player = getPlayer(state, actorNr);
  logState(state, `${player ? player.name : '#' + actorNr}（双管）超时，本轮不声明。`);
  state.awaiting = null;
  beginTurns(state);
}

function hasRole(state, roleId) {
  return state.players.some((p) => p.alive && p.role === roleId);
}

function startRound(state) {
  state.round += 1;
  state.effects.reverseNext = false;
  state.effects.shotgunNext = false;
  state.effects.sniperNext = false;
  state.effects.doubleBarrelCall = null;
  state.rattlesnakeUsedThisRound = {};
  state.lastItemForSnake = null;
  state.rattlesnakeQueue = [];
  state.awaiting = null;

  const alive = alivePlayers(state);
  // 捆绑只作用于「本轮内的下一回合」；弹药打空重装后清掉，避免跨轮仍被跳过
  state.players.forEach((p) => {
    if (p.skipNextTurn) {
      p.skipNextTurn = false;
      logState(state, `${p.name} 的捆绑随本轮结束而解除。`);
    }
    if (p.debtorNr != null) {
      logState(state, `${p.name}（追香）：债务人标记随本轮结束而消失。`);
    }
    p.debtorNr = null;
    p.scentMarkedThisRound = false;
  });
  alive.forEach((p) => {
    let n = 2;
    const bonus = state.effects.doubleItemBonus[p.actorNr] || 0;
    n += bonus;
    drawItems(state, p, n);
    if (bonus) logState(state, `${p.name} 因双管效果额外抽 ${bonus} 张道具。`);
  });
  state.effects.doubleItemBonus = {};

  // 装弹：先抽实弹数，再抽空弹数
  if (state.ammoCountDeck.length === 0) state.ammoCountDeck = buildAmmoCountDeck();
  const liveCount = state.ammoCountDeck[0];
  state.ammoCountDeck = shuffle(state.ammoCountDeck);
  const blankCount = state.ammoCountDeck[0];
  state.ammoCountDeck = shuffle(state.ammoCountDeck);

  const mag = [];
  for (let i = 0; i < liveCount; i++) mag.push(BULLET.LIVE);
  for (let i = 0; i < blankCount; i++) mag.push(BULLET.BLANK);

  let specialCount = 0;
  if (hasRole(state, 'silver_spike')) {
    mag.push(BULLET.SPECIAL);
    specialCount = 1;
    logState(state, '银刺在场：特殊弹已随机塞入本轮弹药堆。');
  }

  state.magazine = shuffle(mag);
  state.loadout = { live: liveCount, blank: blankCount, special: specialCount };
  state.fired = { live: 0, blank: 0, special: 0 };
  logState(
    state,
    `第 ${state.round} 轮：装入 ${liveCount} 实弹 + ${blankCount} 空弹${specialCount ? ' + 特殊弹' : ''}，共 ${state.magazine.length} 发。`
  );

  // 先播弹药数量抽取动画；第 1 轮再接先手转轮
  let firstPlayer = null;
  if (state.round === 1) {
    const starter = alive[Math.floor(Math.random() * alive.length)];
    const idx = state.turnOrder.indexOf(starter.actorNr);
    if (idx > 0) {
      state.turnOrder = state.turnOrder.slice(idx).concat(state.turnOrder.slice(0, idx));
    } else if (idx < 0) {
      state.turnOrder = [starter.actorNr].concat(state.turnOrder.filter((n) => n !== starter.actorNr));
    }
    state.currentTurn = 0;
    firstPlayer = {
      actorNr: starter.actorNr,
      round: state.round,
      token: `game-${starter.actorNr}-${Date.now()}`,
      candidates: alive.map((p) => ({
        actorNr: p.actorNr,
        name: p.name,
        role: p.role,
        roleName: ROLES[p.role] ? ROLES[p.role].name : '?'
      }))
    };
  }

  state.pendingAmmoDraw = {
    round: state.round,
    live: liveCount,
    blank: blankCount,
    special: specialCount,
    token: `ammo-${state.round}-${Date.now()}`,
    firstPlayer
  };
  state.awaiting = null;
  state.handDiscardQueue = alive
    .filter((p) => p.hand.length > HAND_LIMIT)
    .map((p) => p.actorNr);
  if (tryStartHandDiscard(state)) return;
  resumeAfterHandDiscard(state);
}

function continueAfterAmmoDraw(state) {
  if (!state.awaiting || state.awaiting.type !== 'ammo_draw') {
    return { ok: true, reason: '已结算' };
  }
  const firstPlayer = state.awaiting.firstPlayer;
  state.awaiting = null;
  if (firstPlayer) {
    state.awaiting = stampAwaitingExpiry(
      {
        type: 'first_player_spin',
        actorNr: firstPlayer.actorNr,
        round: firstPlayer.round,
        token: firstPlayer.token,
        candidates: firstPlayer.candidates
      },
      'first_player_spin'
    );
    logState(state, `本局先手抽取中…`);
    return { ok: true };
  }
  proceedRoundAfterSetup(state);
  return { ok: true };
}

function proceedRoundAfterSetup(state) {
  const alive = alivePlayers(state);
  const db = alive.find((p) => p.role === 'double_barrel');
  if (db && state.magazine.length > 0) {
    const bullets = countTableBullets(state.magazine);
    state.awaiting = stampAwaitingExpiry(
      {
        type: 'double_barrel',
        actorNr: db.actorNr,
        name: db.name,
        magSize: state.magazine.length,
        live: bullets.live,
        blank: bullets.blank,
        special: bullets.special,
        token: `db-${state.round}-${db.actorNr}-${Date.now()}`
      },
      'double_barrel'
    );
    logState(state, `${db.name}（双管）请声明第几发是实弹或空弹（限时 ${state.awaiting.seconds} 秒）。`);
    return;
  }
  beginTurns(state);
}

function continueAfterFirstPlayer(state) {
  if (!state.awaiting || state.awaiting.type !== 'first_player_spin') {
    return { ok: true, reason: '已结算' };
  }
  const starter = getPlayer(state, state.awaiting.actorNr);
  const name = starter ? starter.name : `#${state.awaiting.actorNr}`;
  logState(state, `本局由 ${name} 先开始！`);
  state.awaiting = null;
  proceedRoundAfterSetup(state);
  return { ok: true };
}

function beginTurns(state) {
  const n = state.turnOrder.length;
  if (!n) return;
  // 新一轮：从上一轮结束处的下一位续；否则从当前指针开始找
  let start = state.currentTurn || 0;
  if (state.nextRoundStartTurn != null) {
    start = state.nextRoundStartTurn % n;
    state.nextRoundStartTurn = null;
  }
  let aliveSeen = 0;
  let boundSkips = 0;
  for (let step = 0; step < n; step++) {
    state.currentTurn = (start + step) % n;
    const p = currentPlayer(state);
    if (!p || !p.alive) continue;
    aliveSeen += 1;
    if (p.skipNextTurn) {
      p.skipNextTurn = false;
      boundSkips += 1;
      logState(state, `${p.name} 被捆绑，跳过本回合。`);
      continue;
    }
    onTurnStart(state, p);
    return;
  }
  if (aliveSeen > 0 && boundSkips === aliveSeen) {
    logState(state, '全员均被捆绑跳过，自动开启新一轮。');
    markNextRoundResume(state);
    startRound(state);
  }
}

function markNextRoundResume(state) {
  const n = state.turnOrder.length;
  if (!n) return;
  state.nextRoundStartTurn = (state.currentTurn + 1) % n;
}

function currentPlayer(state) {
  const nr = state.turnOrder[state.currentTurn];
  return getPlayer(state, nr);
}

function moveToNextPlayer(state) {
  const n = state.turnOrder.length;
  if (!n) return;
  let aliveSeen = 0;
  let boundSkips = 0;
  for (let step = 0; step < n; step++) {
    state.currentTurn = (state.currentTurn + 1) % n;
    const p = currentPlayer(state);
    if (!p || !p.alive) continue;
    aliveSeen += 1;
    if (p.skipNextTurn) {
      p.skipNextTurn = false;
      boundSkips += 1;
      logState(state, `${p.name} 被捆绑，跳过本回合。`);
      continue;
    }
    onTurnStart(state, p);
    return;
  }
  if (aliveSeen > 0 && boundSkips === aliveSeen) {
    logState(state, '全员均被捆绑跳过，自动开启新一轮。');
    markNextRoundResume(state);
    startRound(state);
  }
}

function onTurnStart(state, player) {
  logState(state, `轮到 ${player.name} 行动。弹药剩余 ${state.magazine.length}。`);
}

function gunpowderBottomFor(state, viewer) {
  if (!viewer || viewer.role !== 'gunpowder' || !viewer.alive) return null;
  if (state.phase !== 'playing') return null;
  // 新一轮 setup 尚未 beginTurns：不展示，避免偷看刚装入的弹匣
  if (state.nextRoundStartTurn != null || state.pendingAmmoDraw) return null;
  const aType = state.awaiting && state.awaiting.type;
  if (
    aType === 'ammo_draw' ||
    aType === 'first_player_spin' ||
    aType === 'double_barrel' ||
    aType === 'double_barrel_reveal'
  ) {
    return null;
  }
  const cur = currentPlayer(state);
  if (!cur || Number(cur.actorNr) !== Number(viewer.actorNr)) return null;
  if (!state.magazine.length) return [];
  return state.magazine.slice(0, Math.min(2, state.magazine.length));
}

function linkPairLabel(state, pair) {
  return pair.map((nr) => {
    const p = getPlayer(state, nr);
    return p ? p.name : `#${nr}`;
  }).join('与');
}

function findLinkPairIndex(state, actorNr) {
  const nr = Number(actorNr);
  return state.effects.linkedPairs.findIndex((pair) =>
    pair.some((x) => Number(x) === nr)
  );
}

/** 解除与给定玩家有交集的连锁组；每人同时仅可与一人连锁 */
function dissolveConflictingLinks(state, actorNrs) {
  const set = new Set(actorNrs.map((nr) => Number(nr)));
  const kept = [];
  const dissolved = [];
  state.effects.linkedPairs.forEach((pair) => {
    if (pair.some((nr) => set.has(Number(nr)))) dissolved.push(pair);
    else kept.push(pair);
  });
  if (!dissolved.length) return;
  state.effects.linkedPairs = kept;
  logState(
    state,
    `连锁自动解除：${dissolved.map((pair) => linkPairLabel(state, pair)).join('；')}（每人同时仅可与一人连锁）。`
  );
}

function removeLinkPairAt(state, index) {
  if (index < 0) return;
  state.effects.linkedPairs.splice(index, 1);
}

function flattenLinked(state) {
  return [...new Set(state.effects.linkedPairs.flat().map((nr) => Number(nr)))];
}

/** 追香：可否把 shooter 记为债务人（不要求 shooter 仍存活） */
function canMarkScentDebtor(state, scent, shooter) {
  if (!scent || !shooter) return false;
  if (scent.role !== 'zhui_xiang') return false;
  if (Number(scent.actorNr) === Number(shooter.actorNr)) return false;
  if (state.mode === 'team') return Number(scent.team) !== Number(shooter.team);
  return true;
}

/** 开枪造成扣血后，尝试给受伤的追香标记债务人 */
function tryMarkScentDebt(state, shooterNr, victims) {
  const shooter = getPlayer(state, shooterNr);
  if (!shooter || !victims || !victims.length) return;
  victims.forEach((v) => {
    if (!v || v.role !== 'zhui_xiang') return;
    if (v.scentMarkedThisRound) return;
    if (!canMarkScentDebtor(state, v, shooter)) return;
    v.debtorNr = Number(shooter.actorNr);
    v.scentMarkedThisRound = true;
    logState(state, `${v.name}（追香）：${shooter.name} 成为债务人。`);
  });
}

/** 防弹衣：抵消本次实弹伤害；狙击枪穿透时失效但不抵消 */
function absorbLiveBulletWithVest(state, player, pierceVest) {
  if (!player || !player.bulletproof) return false;
  if (pierceVest) {
    player.bulletproof = false;
    logState(state, `${player.name} 的防弹衣被狙击枪无视并失效。`);
    return false;
  }
  player.bulletproof = false;
  logState(state, `${player.name} 的防弹衣抵消了本次实弹伤害。`);
  return true;
}

function applyDamage(state, target, amount, sourceMsg, ctx) {
  if (!target.alive || amount <= 0) return [];
  const pairIdx = findLinkPairIndex(state, target.actorNr);
  const pair = pairIdx >= 0 ? state.effects.linkedPairs[pairIdx].slice() : null;
  const victims = [target];
  if (pair) {
    pair.forEach((nr) => {
      if (Number(nr) === Number(target.actorNr)) return;
      const p = getPlayer(state, nr);
      if (p && p.alive) victims.push(p);
    });
  }
  const pierceVest = !!(ctx && ctx.pierceVest);
  const damaged = [];
  victims.forEach((v) => {
    if (ctx && ctx.liveBullet && absorbLiveBulletWithVest(state, v, pierceVest)) return;
    v.hp -= amount;
    damaged.push(v);
    logState(state, `${sourceMsg || ''}${v.name} 受到 ${amount} 点伤害（剩余 ${Math.max(v.hp, 0)}）。`);
    if (v.hp <= 0) {
      v.hp = 0;
      v.alive = false;
      v.bulletproof = false;
      logState(state, `${v.name} 出局！`);
    }
  });
  // 防弹衣完全抵消则未「受到伤害」，连锁不解除
  if (pairIdx >= 0 && damaged.length > 0) {
    removeLinkPairAt(state, pairIdx);
    logState(state, victims.length > 1 ? '连锁已触发并解除。' : '连锁因受到伤害而解除。');
  }
  if (ctx && ctx.shotBy != null) {
    tryMarkScentDebt(state, ctx.shotBy, damaged);
  }
  checkWin(state);
  return damaged;
}

/** 解除该玩家所在连锁（用于夜枭等已批量结算伤害后的清理） */
function breakLinkAfterAnyDamage(state, actorNr) {
  const pairIdx = findLinkPairIndex(state, actorNr);
  if (pairIdx < 0) return false;
  removeLinkPairAt(state, pairIdx);
  logState(state, '连锁因受到伤害而解除。');
  return true;
}

function heal(state, player, amount) {
  if (!player.alive) return;
  player.hp = Math.min(MAX_HP, player.hp + amount);
  logState(state, `${player.name} 回复 ${amount} 点血（当前 ${player.hp}）。`);
}

function resolveBulletType(state, shooter, raw) {
  let t = raw;
  // 先快轮，后反转
  if (shooter.role === 'quick_cyl') {
    if (t === BULLET.LIVE) t = BULLET.BLANK;
    else if (t === BULLET.BLANK) t = BULLET.LIVE;
  }
  // 反转挂在「下一发」上：打出即消耗；特殊弹类型不变但仍消耗反转
  if (state.effects.reverseNext) {
    if (t === BULLET.LIVE || t === BULLET.BLANK) {
      t = t === BULLET.LIVE ? BULLET.BLANK : BULLET.LIVE;
    }
    state.effects.reverseNext = false;
  }
  return t;
}

function findSilverSpike(state) {
  return state.players.find((p) => p.alive && p.role === 'silver_spike');
}

function shoot(state, actorNr, targetActorNr, nightOwlTargetNr) {
  if (state.phase !== 'playing' || state.awaiting) return { ok: false, reason: '当前不能开枪' };
  const shooter = getPlayer(state, actorNr);
  const cur = currentPlayer(state);
  if (!shooter || !cur || Number(shooter.actorNr) !== Number(cur.actorNr)) {
    return { ok: false, reason: '不是你的回合' };
  }
  if (!shooter.alive) return { ok: false, reason: '你已出局' };
  if (state.magazine.length === 0) return { ok: false, reason: '弹药已空' };

  const target = getPlayer(state, targetActorNr);
  if (!target || !target.alive) return { ok: false, reason: '目标无效' };
  const toSelf = Number(target.actorNr) === Number(shooter.actorNr);

  const raw = state.magazine.pop();
  const resolved = resolveBulletType(state, shooter, raw);
  // 计数按结算结果，与玩家体感一致（快轮/反转后）
  if (resolved === BULLET.LIVE) state.fired.live += 1;
  else if (resolved === BULLET.BLANK) state.fired.blank += 1;
  else if (resolved === BULLET.SPECIAL) state.fired.special += 1;

  let dmg = 1;
  let shotgunUsed = false;
  let sniperUsed = false;
  let scentDebtBonus = false;
  let scentDebtClear = false;
  // 霰弹与狙击不可叠加：优先已挂起的霰弹，二者不会同时生效
  if (resolved === BULLET.LIVE) {
    if (state.effects.shotgunNext) {
      dmg = 2;
      shotgunUsed = true;
      state.effects.shotgunNext = false;
      state.effects.sniperNext = false;
    } else if (state.effects.sniperNext) {
      sniperUsed = true;
      state.effects.sniperNext = false;
    }
  } else {
    state.effects.shotgunNext = false;
    state.effects.sniperNext = false;
  }

  // 追香讨债：仅实弹打债务人；有霰弹则不追加但仍清标记
  if (
    resolved === BULLET.LIVE &&
    shooter.role === 'zhui_xiang' &&
    shooter.debtorNr != null &&
    Number(shooter.debtorNr) === Number(target.actorNr)
  ) {
    scentDebtClear = true;
    if (!shotgunUsed) {
      dmg += 1;
      scentDebtBonus = true;
    }
  }

  let owlTarget = nightOwlTargetNr != null ? Number(nightOwlTargetNr) : null;
  if (
    resolved === BULLET.LIVE &&
    toSelf &&
    shooter.role === 'night_owl' &&
    shooter.hp <= 4
  ) {
    const picked = owlTarget != null ? getPlayer(state, owlTarget) : null;
    if (!picked || !isOpponent(state, shooter, picked)) {
      const foes = alivePlayers(state).filter((p) => isOpponent(state, shooter, p));
      owlTarget = foes[0] ? Number(foes[0].actorNr) : null;
    }
  } else {
    owlTarget = null;
  }

  state.awaiting = stampAwaitingExpiry(
    {
      type: 'shot_reveal',
      token: `shot-${state.round}-${actorNr}-${raw}-${resolved}-${Date.now()}`,
      actorNr: shooter.actorNr,
      name: shooter.name,
      targetActorNr: target.actorNr,
      targetName: target.name,
      toSelf,
      raw,
      resolved,
      dmg,
      shotgunUsed,
      sniperUsed,
      scentDebtBonus,
      scentDebtClear,
      nightOwlTargetNr: owlTarget || null,
      magazineLeft: state.magazine.length
    },
    'shot_reveal'
  );
  return { ok: true };
}

function continueAfterShotReveal(state) {
  if (!state.awaiting || state.awaiting.type !== 'shot_reveal') {
    return { ok: true, reason: '已结算' };
  }
  const pending = state.awaiting;
  const shooter = getPlayer(state, pending.actorNr);
  const target = getPlayer(state, pending.targetActorNr);
  if (!shooter || !target) {
    state.awaiting = null;
    logState(state, '开枪结算异常：玩家缺失，强制推进。');
    if (state.phase === 'ended') return { ok: true };
    if (state.magazine.length === 0) {
      markNextRoundResume(state);
      startRound(state);
    } else {
      moveToNextPlayer(state);
    }
    if (!state.awaiting) tryStartHandDiscard(state);
    return { ok: true };
  }
  state.awaiting = null;

  const raw = pending.raw;
  const resolved = pending.resolved;
  const toSelf = !!pending.toSelf;
  const dmg = pending.dmg || 1;
  let nightOwlTargetNr = pending.nightOwlTargetNr;

  logState(
    state,
    `${shooter.name} 向 ${toSelf ? '自己' : target.name} 开枪：抽出【${bulletLabel(raw)}】→ 结算为【${bulletLabel(resolved)}】。`
  );
  if (pending.shotgunUsed) {
    logState(state, '霰弹枪生效：伤害 2 点。');
  }
  if (pending.sniperUsed) {
    logState(state, '狙击枪生效：无视防弹衣。');
  }
  if (pending.scentDebtClear) {
    if (pending.scentDebtBonus) {
      logState(state, '追香：讨债生效，实弹伤害 +1。');
    } else if (pending.shotgunUsed) {
      logState(state, '追香：本发已触发霰弹，讨债不加伤，标记清除。');
    }
  }

  let extraTurn = false;
  const pierceVest = !!pending.sniperUsed;

  if (resolved === BULLET.SPECIAL) {
    const silver = findSilverSpike(state);
    if (target.role === 'silver_spike') {
      heal(state, target, 1);
      logState(state, '特殊弹命中银刺：不扣血，反而回 1 血。');
    } else {
      applyDamage(state, target, 1, '特殊弹：', { shotBy: shooter.actorNr });
      if (silver) {
        drawItems(state, silver, 1);
        logState(state, `银刺抽取一张道具。`);
      }
    }
  } else if (resolved === BULLET.LIVE) {
    if (toSelf && shooter.role === 'night_owl' && shooter.hp <= 4) {
      let foe = nightOwlTargetNr != null ? getPlayer(state, nightOwlTargetNr) : null;
      if (!foe || !isOpponent(state, shooter, foe)) {
        const foes = alivePlayers(state).filter((p) => isOpponent(state, shooter, p));
        foe = foes[0] || null;
      }
      const amount = dmg;
      const primary = [shooter];
      if (foe) primary.push(foe);
      const pairIndexes = [];
      primary.forEach((p) => {
        const idx = findLinkPairIndex(state, p.actorNr);
        if (idx >= 0 && !pairIndexes.includes(idx)) pairIndexes.push(idx);
      });
      const victims = primary.slice();
      pairIndexes.forEach((idx) => {
        state.effects.linkedPairs[idx].forEach((nr) => {
          const p = getPlayer(state, nr);
          if (p && p.alive && !victims.some((v) => Number(v.actorNr) === Number(p.actorNr))) {
            victims.push(p);
          }
        });
      });
      const damaged = [];
      victims.forEach((v) => {
        if (absorbLiveBulletWithVest(state, v, pierceVest)) return;
        v.hp -= amount;
        damaged.push(v);
        logState(state, `夜枭实弹：${v.name} -${amount}（剩余 ${Math.max(v.hp, 0)}）`);
        if (v.hp <= 0) {
          v.hp = 0;
          v.alive = false;
          v.bulletproof = false;
          logState(state, `${v.name} 出局！`);
        }
      });
      // 仅对实际扣血者解除连锁；全员被防弹衣抵消则保留连锁
      damaged.forEach((v) => breakLinkAfterAnyDamage(state, v.actorNr));
      tryMarkScentDebt(state, shooter.actorNr, damaged);
      checkWin(state);
    } else if (pending.scentDebtBonus) {
      // 基础 1 点走连锁；讨债 +1 只打债务人本人（防弹衣抵消则整次不加伤；狙击枪可穿透）
      const damaged = applyDamage(state, target, 1, '', {
        shotBy: shooter.actorNr,
        liveBullet: true,
        pierceVest
      });
      const primaryHit = damaged.some((v) => Number(v.actorNr) === Number(target.actorNr));
      if (primaryHit && target.alive) {
        target.hp -= 1;
        logState(state, `追香讨债追加：${target.name} 再受到 1 点伤害（剩余 ${Math.max(target.hp, 0)}）。`);
        if (target.hp <= 0) {
          target.hp = 0;
          target.alive = false;
          target.bulletproof = false;
          logState(state, `${target.name} 出局！`);
        }
        checkWin(state);
      }
    } else {
      applyDamage(state, target, dmg, '', {
        shotBy: shooter.actorNr,
        liveBullet: true,
        pierceVest
      });
    }
  } else if (resolved === BULLET.BLANK) {
    if (toSelf) {
      extraTurn = true;
      if (shooter.role === 'outlaw') {
        drawItems(state, shooter, 1);
        logState(state, '亡命徒：对自己打出空弹，抽一张道具。');
      }
    }
  }

  if (pending.scentDebtClear && shooter) {
    shooter.debtorNr = null;
  }

  if (state.phase === 'ended') return { ok: true };

  if (state.magazine.length === 0) {
    logState(state, '弹药打空，本轮结束。');
    markNextRoundResume(state);
    startRound(state);
    return { ok: true };
  }

  if (extraTurn && shooter.alive) {
    logState(state, `${shooter.name} 对自己打出空弹，再行动一次。`);
    onTurnStart(state, shooter);
  } else {
    moveToNextPlayer(state);
  }
  if (!state.awaiting) tryStartHandDiscard(state);
  return { ok: true };
}

function validateItemUse(state, player, itemId, payload) {
  payload = payload || {};
  switch (itemId) {
    case 'eject':
    case 'peek_top':
      if (!state.magazine.length) return '弹药堆为空，无法使用';
      break;
    case 'inspect': {
      const idx = typeof payload.index === 'number' ? payload.index : -1;
      if (idx < 0 || idx >= state.magazine.length) return '检视位置无效';
      break;
    }
    case 'swap': {
      const i = payload.i | 0;
      const j = payload.j | 0;
      if (state.magazine.length < 2) return '弹药不足两发，无法换弹';
      if (i === j) return '请选择两发不同的弹药';
      if (i < 0 || j < 0 || i >= state.magazine.length || j >= state.magazine.length) {
        return '换弹位置无效';
      }
      break;
    }
    case 'bind': {
      const t = getPlayer(state, payload.targetActorNr);
      if (!t || !t.alive || Number(t.actorNr) === Number(player.actorNr)) {
        return '捆绑目标无效';
      }
      break;
    }
    case 'steal': {
      const t = getPlayer(state, payload.targetActorNr);
      if (!isOpponent(state, player, t)) return '顺手牵羊目标无效（需选择有手牌的对手）';
      if (!t.hand.length) return '该对手没有手牌';
      break;
    }
    case 'double_arrow': {
      if (!payload.unlock) {
        const raw = payload.targets || [];
        const uniq = [...new Set(raw.map((nr) => Number(nr)))];
        if (uniq.length < 1 || uniq.length > 2) return '连锁需选择 1～2 名玩家';
        const targets = uniq.map((nr) => getPlayer(state, nr)).filter((p) => p && p.alive);
        if (targets.length !== uniq.length) return '连锁目标无效';
        if (targets.length < 1 || targets.length > 2) return '连锁需选择 1～2 名玩家';
      }
      break;
    }
    default:
      break;
  }
  return null;
}

function useItem(state, actorNr, itemIndex, payload) {
  if (state.phase !== 'playing' || state.awaiting) return { ok: false, reason: '当前不能用道具' };
  const player = getPlayer(state, actorNr);
  const cur = currentPlayer(state);
  if (!player || !cur || Number(player.actorNr) !== Number(cur.actorNr)) {
    return { ok: false, reason: '不是你的回合' };
  }
  if (itemIndex < 0 || itemIndex >= player.hand.length) return { ok: false, reason: '无效道具' };

  const itemId = player.hand[itemIndex];
  const bad = validateItemUse(state, player, itemId, payload || {});
  if (bad) return { ok: false, reason: bad };

  player.hand.splice(itemIndex, 1);
  state.itemDiscard.push(itemId);
  logState(state, `${player.name} 使用【${ITEMS[itemId].name}】。`);

  const awaitingBefore = state.awaiting;
  const result = applyItemEffect(state, player, itemId, payload || {});
  // 若道具效果已进入新轮声明/先手等 awaiting，则不再插入响尾蛇窗口
  if (state.awaiting && state.awaiting !== awaitingBefore) return result;
  offerRattlesnake(state, player, itemId, payload);
  if (!state.awaiting) tryStartHandDiscard(state);
  return result;
}

const RATTLESNAKE_WINDOW_MS = 5000;

function offerRattlesnake(state, sourcePlayer, itemId, originalPayload) {
  if (state.phase === 'ended') return;
  const snakes = alivePlayers(state).filter(
    (p) =>
      p.role === 'rattlesnake' &&
      Number(p.actorNr) !== Number(sourcePlayer.actorNr) &&
      !state.rattlesnakeUsedThisRound[Number(p.actorNr)] &&
      p.hp >= 1
  );
  if (!snakes.length) {
    state.lastItemForSnake = null;
    state.rattlesnakeQueue = [];
    return;
  }
  state.lastItemForSnake = { itemId, from: sourcePlayer.actorNr };
  state.rattlesnakeQueue = snakes.map((p) => p.actorNr);
  beginRattlesnakeWindow(state);
}

function beginRattlesnakeWindow(state) {
  if (state.phase === 'ended') {
    state.awaiting = null;
    state.lastItemForSnake = null;
    state.rattlesnakeQueue = [];
    return;
  }
  while (state.rattlesnakeQueue && state.rattlesnakeQueue.length) {
    const nr = state.rattlesnakeQueue.shift();
    const p = getPlayer(state, nr);
    if (!p || !p.alive || p.role !== 'rattlesnake') continue;
    if (state.rattlesnakeUsedThisRound[Number(nr)]) continue;
    if (p.hp < 1 || !state.lastItemForSnake) continue;
    const itemId = state.lastItemForSnake.itemId;
    const itemName = ITEMS[itemId] ? ITEMS[itemId].name : itemId;
    state.awaiting = {
      type: 'rattlesnake',
      actorNr: nr,
      itemId,
      itemName,
      from: state.lastItemForSnake.from,
      seconds: Math.round(RATTLESNAKE_WINDOW_MS / 1000),
      expiresAt: Date.now() + RATTLESNAKE_WINDOW_MS,
      token: `snake-${state.round}-${nr}-${Date.now()}`
    };
    logState(state, `${p.name}（响尾蛇）可将【${itemName}】复制到手牌：扣 1 血，限时 ${state.awaiting.seconds} 秒。`);
    return;
  }
  state.awaiting = null;
  state.lastItemForSnake = null;
  state.rattlesnakeQueue = [];
  tryStartHandDiscard(state);
}

function clearRattlesnakeOpportunity(state) {
  state.awaiting = null;
  state.lastItemForSnake = null;
  state.rattlesnakeQueue = [];
}

function rattlesnakeCopy(state, actorNr) {
  if (!state.awaiting || state.awaiting.type !== 'rattlesnake') {
    return { ok: false, reason: '当前不是响尾蛇窗口' };
  }
  if (Number(state.awaiting.actorNr) !== Number(actorNr)) {
    return { ok: false, reason: '不是你的复制窗口' };
  }
  const p = getPlayer(state, actorNr);
  if (!p || p.role !== 'rattlesnake' || !p.alive) return { ok: false, reason: '无法复制' };
  if (state.rattlesnakeUsedThisRound[Number(actorNr)]) {
    return { ok: false, reason: '本轮已复制过' };
  }
  if (!state.lastItemForSnake) return { ok: false, reason: '没有可复制的道具' };
  if (p.hp < 1) return { ok: false, reason: '血量不足' };

  const itemId = state.lastItemForSnake.itemId;
  const itemName = ITEMS[itemId] ? ITEMS[itemId].name : itemId;
  state.rattlesnakeUsedThisRound[Number(actorNr)] = true;
  state.awaiting = null;

  // 消耗血量视为受到伤害：连锁对象一同扣血，随后连锁解除
  applyDamage(state, p, 1, '响尾蛇复制：');
  if (state.phase === 'ended') return { ok: true };
  if (!p.alive) {
    logState(state, `${p.name}（响尾蛇）复制【${itemName}】后出局。`);
    beginRattlesnakeWindow(state);
    return { ok: true };
  }

  p.hand.push(itemId);
  logState(state, `${p.name}（响尾蛇）消耗 1 血，将【${itemName}】复制到手牌。`);
  queueHandDiscardIfNeeded(state, p);
  beginRattlesnakeWindow(state);
  return { ok: true };
}

function rattlesnakePass(state, actorNr) {
  if (!state.awaiting || state.awaiting.type !== 'rattlesnake') {
    return { ok: false, reason: '当前不是响尾蛇窗口' };
  }
  if (Number(state.awaiting.actorNr) !== Number(actorNr)) {
    return { ok: false, reason: '不是你的复制窗口' };
  }
  const p = getPlayer(state, actorNr);
  const itemName = state.awaiting.itemName || '道具';
  logState(state, `${p ? p.name : '#' + actorNr}（响尾蛇）放弃复制【${itemName}】。`);
  state.awaiting = null;
  beginRattlesnakeWindow(state);
  return { ok: true };
}

function rattlesnakeTimeout(state, token) {
  if (!state.awaiting || state.awaiting.type !== 'rattlesnake') {
    return { ok: false, reason: '当前不是响尾蛇窗口' };
  }
  if (token && state.awaiting.token !== token) return { ok: false, reason: '窗口已过期' };
  const p = getPlayer(state, state.awaiting.actorNr);
  const itemName = state.awaiting.itemName || '道具';
  logState(state, `${p ? p.name : '?'}（响尾蛇）超时，放弃复制【${itemName}】。`);
  state.awaiting = null;
  beginRattlesnakeWindow(state);
  return { ok: true };
}

function continueAfterEject(state) {
  if (!state.awaiting || state.awaiting.type !== 'eject_anim') {
    return { ok: true, reason: '已结算' };
  }
  const { bullet, remaining, actorNr, offerSnake } = state.awaiting;
  const player = getPlayer(state, actorNr);
  state.awaiting = null;

  logState(state, `退弹：弃置【${bulletLabel(bullet)}】。剩余 ${remaining}。`);
  if (remaining === 0) {
    logState(state, '弹药打空，本轮结束。');
    markNextRoundResume(state);
    startRound(state);
    return { ok: true };
  }
  if (offerSnake && player) offerRattlesnake(state, player, 'eject', {});
  if (!state.awaiting) tryStartHandDiscard(state);
  return { ok: true };
}

function continueAfterPainkillerDice(state) {
  if (!state.awaiting || state.awaiting.type !== 'painkiller_dice') {
    return { ok: true, reason: '已结算' };
  }
  const { roll, actorNr, offerSnake } = state.awaiting;
  const player = getPlayer(state, actorNr);
  if (!player) {
    state.awaiting = null;
    logState(state, '止痛药结算异常：玩家缺失，强制推进。');
    if (state.phase !== 'ended') moveToNextPlayer(state);
    if (!state.awaiting) tryStartHandDiscard(state);
    return { ok: true };
  }
  state.awaiting = null;

  logState(state, `止痛药掷出 ${roll}（${roll % 2 === 1 ? '奇数' : '偶数'}）。`);
  if (roll % 2 === 1) applyDamage(state, player, 1, '止痛药：');
  else heal(state, player, 2);

  if (state.phase === 'ended') return { ok: true };
  // 出局后必须交回合，否则死者仍为当前行动者，可点开枪并卡死
  if (!player.alive) moveToNextPlayer(state);
  if (offerSnake) offerRattlesnake(state, player, 'painkiller', {});
  if (!state.awaiting) tryStartHandDiscard(state);
  return { ok: true };
}

function continueAfterItemFx(state) {
  if (!state.awaiting || state.awaiting.type !== 'item_fx') {
    return { ok: true, reason: '已结算' };
  }
  const { itemId, actorNr, offerSnake, snakePayload } = state.awaiting;
  const player = getPlayer(state, actorNr);
  state.awaiting = null;
  if (offerSnake && player) offerRattlesnake(state, player, itemId, snakePayload || {});
  if (!state.awaiting) tryStartHandDiscard(state);
  return { ok: true };
}

function startItemFx(state, player, itemId, payload, visual) {
  const safePayload = Object.assign({}, payload || {});
  delete safePayload._noSnakeOffer;
  const meta = ITEMS[itemId] || {};
  state.awaiting = stampAwaitingExpiry(
    Object.assign(
      {
        type: 'item_fx',
        itemId,
        itemName: meta.name || itemId,
        itemArt: meta.art || null,
        actorNr: player.actorNr,
        name: player.name,
        token: `fx-${itemId}-${state.round}-${Date.now()}`,
        offerSnake: !(payload && payload._noSnakeOffer),
        snakePayload: safePayload
      },
      visual || {}
    ),
    'item_fx'
  );
}

function applyItemEffect(state, player, itemId, payload) {
  payload = payload || {};
  switch (itemId) {
    case 'lucky_coin': {
      const start = player.hand.length;
      drawItems(state, player, 2);
      const drawn = player.hand.slice(start);
      logState(state, `${player.name} 抽到 ${drawn.length} 张道具。`);
      startItemFx(state, player, itemId, payload, {
        private: true,
        drawn: drawn.slice()
      });
      break;
    }
    case 'painkiller': {
      const roll = 1 + Math.floor(Math.random() * 6);
      const meta = ITEMS.painkiller || {};
      state.awaiting = stampAwaitingExpiry(
        {
          type: 'painkiller_dice',
          itemId: 'painkiller',
          itemName: meta.name || '止痛药',
          itemArt: meta.art || null,
          actorNr: player.actorNr,
          name: player.name,
          targetActorNr: player.actorNr,
          targetName: player.name,
          roll,
          token: `pk-${state.round}-${player.actorNr}-${Date.now()}`,
          offerSnake: !payload._noSnakeOffer
        },
        'painkiller_dice'
      );
      logState(state, `${player.name} 使用止痛药，投掷六面骰…`);
      break;
    }
    case 'bandage':
      heal(state, player, 1);
      startItemFx(state, player, itemId, payload, {
        heal: 1,
        hpAfter: player.hp,
        targetActorNr: player.actorNr,
        targetName: player.name
      });
      break;
    case 'eject':
      if (state.magazine.length) {
        const b = state.magazine.pop();
        const meta = ITEMS.eject || {};
        state.awaiting = stampAwaitingExpiry(
          {
            type: 'eject_anim',
            itemId: 'eject',
            itemName: meta.name || '退弹',
            itemArt: meta.art || null,
            actorNr: player.actorNr,
            name: player.name,
            bullet: b,
            remaining: state.magazine.length,
            token: `ej-${state.round}-${player.actorNr}-${Date.now()}`,
            offerSnake: !payload._noSnakeOffer
          },
          'eject_anim'
        );
        logState(state, `${player.name} 退弹：弃置弹药中…`);
      }
      break;
    case 'inspect': {
      const idx = typeof payload.index === 'number' ? payload.index : 0;
      if (idx >= 0 && idx < state.magazine.length) {
        const topBased = state.magazine[state.magazine.length - 1 - idx];
        player.lastPeek = { index: idx, bullet: topBased };
        logState(state, `${player.name} 检视了弹药堆从上数第 ${idx + 1} 张（仅自己可见）。`);
        startItemFx(state, player, itemId, payload, {
          private: true,
          peekIndex: idx,
          bullet: topBased
        });
      }
      break;
    }
    case 'shotgun':
      if (state.effects.sniperNext) {
        state.effects.sniperNext = false;
        logState(state, '霰弹枪替换狙击枪挂起（二者不可叠加）。');
      }
      state.effects.shotgunNext = true;
      logState(state, '霰弹枪已挂起：下一发若为实弹则伤害×2。');
      startItemFx(state, player, itemId, payload, {});
      break;
    case 'sniper':
      if (state.effects.shotgunNext) {
        state.effects.shotgunNext = false;
        logState(state, '狙击枪替换霰弹枪挂起（二者不可叠加）。');
      }
      state.effects.sniperNext = true;
      logState(state, '狙击枪已挂起：下一发实弹无视防弹衣。');
      startItemFx(state, player, itemId, payload, {});
      break;
    case 'vest':
      player.bulletproof = true;
      logState(state, `${player.name} 穿上防弹衣：可抵消下一次实弹伤害。`);
      startItemFx(state, player, itemId, payload, {
        targetActorNr: player.actorNr,
        targetName: player.name
      });
      break;
    case 'swap': {
      const i = payload.i | 0;
      const j = payload.j | 0;
      const a = state.magazine.length - 1 - i;
      const b = state.magazine.length - 1 - j;
      if (a >= 0 && b >= 0 && a < state.magazine.length && b < state.magazine.length) {
        [state.magazine[a], state.magazine[b]] = [state.magazine[b], state.magazine[a]];
        const call = state.effects.doubleBarrelCall;
        if (call) {
          if (call.fromBottom === a) call.fromBottom = b;
          else if (call.fromBottom === b) call.fromBottom = a;
        }
        logState(state, `${player.name} 交换了第 ${i + 1} 发与第 ${j + 1} 发。`);
        startItemFx(state, player, itemId, payload, { swapFrom: i + 1, swapTo: j + 1 });
      }
      break;
    }
    case 'peek_top':
      if (state.magazine.length) {
        const top = state.magazine[state.magazine.length - 1];
        player.lastPeek = { index: 0, bullet: top };
        logState(state, `${player.name} 查看了弹药堆顶（仅自己可见）。`);
        startItemFx(state, player, itemId, payload, {
          private: true,
          peekIndex: 0,
          bullet: top
        });
      }
      break;
    case 'reverse':
      state.effects.reverseNext = true;
      logState(state, '反转已挂起：下一发实↔空。');
      startItemFx(state, player, itemId, payload, {});
      break;
    case 'bind': {
      const t = getPlayer(state, payload.targetActorNr);
      if (t && t.alive && Number(t.actorNr) !== Number(player.actorNr)) {
        t.skipNextTurn = true;
        logState(state, `${t.name} 被捆绑，下一回合无法行动。`);
        startItemFx(state, player, itemId, payload, {
          targetName: t.name,
          targetActorNr: t.actorNr
        });
      }
      break;
    }
    case 'steal': {
      const t = getPlayer(state, payload.targetActorNr);
      if (!isOpponent(state, player, t) || !t.hand.length) break;
      const idx = Math.floor(Math.random() * t.hand.length);
      const stolen = t.hand.splice(idx, 1)[0];
      player.hand.push(stolen);
      queueHandDiscardIfNeeded(state, player);
      const stolenName = (ITEMS[stolen] && ITEMS[stolen].name) || stolen;
      logState(state, `${player.name} 从 ${t.name} 处随机抽走了【${stolenName}】。`);
      startItemFx(state, player, itemId, payload, {
        targetName: t.name,
        targetActorNr: t.actorNr,
        stolenItemId: stolen,
        stolenName
      });
      break;
    }
    case 'double_arrow': {
      if (payload.unlock) {
        state.effects.linkedPairs = [];
        logState(state, '连锁已解除。');
        startItemFx(state, player, itemId, payload, { unlock: true, linkNames: [] });
      } else {
        const targets = (payload.targets || []).map((nr) => getPlayer(state, nr)).filter((p) => p && p.alive);
        const ids = [...new Set(targets.map((p) => Number(p.actorNr)))].slice(0, 2);
        dissolveConflictingLinks(state, ids);
        state.effects.linkedPairs.push(ids);
        logState(state, `连锁目标：${targets.map((p) => p.name).join('、') || '无'}。`);
        startItemFx(state, player, itemId, payload, {
          unlock: false,
          linkNames: targets.map((p) => p.name),
          linkActors: ids
        });
      }
      break;
    }
    default:
      break;
  }
  return { ok: true };
}

function declareDoubleBarrel(state, actorNr, index1Based, kind) {
  if (!state.awaiting || state.awaiting.type !== 'double_barrel') return { ok: false, reason: '无需声明' };
  if (Number(state.awaiting.actorNr) !== Number(actorNr)) {
    return { ok: false, reason: '不是双管玩家' };
  }
  const idx = index1Based - 1;
  if (idx < 0 || idx >= state.magazine.length) return { ok: false, reason: '发数无效' };
  if (kind !== BULLET.LIVE && kind !== BULLET.BLANK) return { ok: false, reason: '只能声明实/空' };

  // magazine[0]=bottom, last=top=第1发
  const actual = state.magazine[state.magazine.length - 1 - idx];
  const player = getPlayer(state, actorNr);
  const success = actual === kind;
  logState(
    state,
    `${player.name} 声明第 ${index1Based} 发是【${bulletLabel(kind)}】→ 实际【${bulletLabel(actual)}】→ ${success ? '成功' : '失败'}。`
  );

  const allies = alivePlayers(state).filter((p) => Number(p.team) === Number(player.team));
  const foes = alivePlayers(state).filter((p) => Number(p.team) !== Number(player.team));
  const gainers = success ? allies : foes;
  gainers.forEach((p) => {
    state.effects.doubleItemBonus[p.actorNr] = (state.effects.doubleItemBonus[p.actorNr] || 0) + 2;
  });
  logState(state, `${success ? '己方' : '对手'} 下轮将额外获得双倍道具（+2）。`);

  // 公示到牌桌：该发弹药正面朝上，全员可见
  state.effects.doubleBarrelCall = {
    fromBottom: state.magazine.length - index1Based,
    index: index1Based,
    declared: kind,
    actual,
    success,
    name: player.name
  };

  state.awaiting = stampAwaitingExpiry(
    {
      type: 'double_barrel_reveal',
      actorNr: player.actorNr,
      name: player.name,
      index: index1Based,
      declared: kind,
      actual,
      success,
      gainerSide: success ? 'ally' : 'foe',
      gainers: gainers.map((p) => ({ actorNr: p.actorNr, name: p.name })),
      magSize: state.magazine.length,
      token: `dbr-${state.round}-${player.actorNr}-${Date.now()}`
    },
    'double_barrel_reveal'
  );
  return { ok: true };
}

function continueAfterDoubleBarrelReveal(state) {
  if (!state.awaiting || state.awaiting.type !== 'double_barrel_reveal') {
    return { ok: true, reason: '已结算' };
  }
  state.awaiting = null;
  beginTurns(state);
  return { ok: true };
}

function skipDoubleBarrel(state, actorNr) {
  if (!state.awaiting || state.awaiting.type !== 'double_barrel') {
    return { ok: false, reason: '无需声明' };
  }
  if (Number(state.awaiting.actorNr) !== Number(actorNr)) {
    return { ok: false, reason: '不是双管玩家' };
  }
  const player = getPlayer(state, actorNr);
  logState(state, `${player ? player.name : '#' + actorNr}（双管）选择本轮不声明。`);
  state.awaiting = null;
  beginTurns(state);
  return { ok: true };
}

function useIronRose(state, actorNr, handIndexes) {
  const p = getPlayer(state, actorNr);
  if (!p || p.role !== 'iron_rose') return { ok: false, reason: '不是铁玫瑰' };
  if (state.phase !== 'playing' || state.awaiting) return { ok: false, reason: '时机不对' };
  const cur = currentPlayer(state);
  if (!cur || Number(cur.actorNr) !== Number(actorNr)) return { ok: false, reason: '不是你的回合' };
  if (!Array.isArray(handIndexes) || handIndexes.length !== 2) return { ok: false, reason: '需弃两张' };
  const idxs = handIndexes.slice().sort((a, b) => b - a);
  if (idxs[0] === idxs[1] || idxs.some((i) => i < 0 || i >= p.hand.length)) return { ok: false, reason: '手牌无效' };
  const discarded = idxs.map((i) => p.hand[i]);
  idxs.forEach((i) => {
    state.itemDiscard.push(p.hand.splice(i, 1)[0]);
  });
  heal(state, p, 1);
  const healTargets = [p];
  alivePlayers(state)
    .filter((x) => Number(x.team) === Number(p.team) && Number(x.actorNr) !== Number(p.actorNr))
    .forEach((ally) => {
      heal(state, ally, 1);
      healTargets.push(ally);
    });
  logState(state, `${p.name} 发动铁玫瑰。`);
  const role = ROLES.iron_rose || {};
  state.awaiting = stampAwaitingExpiry(
    {
      type: 'item_fx',
      itemId: 'iron_rose',
      itemName: '铁玫瑰',
      itemArt: role.art || null,
      actorNr: p.actorNr,
      name: p.name,
      token: `fx-iron_rose-${state.round}-${Date.now()}`,
      offerSnake: false,
      snakePayload: {},
      discarded: discarded.slice(),
      healNames: healTargets.map((t) => t.name),
      healActors: healTargets.map((t) => t.actorNr),
      targetActorNr: p.actorNr,
      targetName: p.name,
      linkActors: healTargets.map((t) => t.actorNr),
      linkNames: healTargets.map((t) => t.name)
    },
    'item_fx'
  );
  return { ok: true };
}

function checkWin(state) {
  const alive = alivePlayers(state);
  if (alive.length === 0) {
    state.phase = 'ended';
    state.winner = null;
    logState(state, '无人存活，平局。');
    return;
  }
  if (state.mode === 'ffa') {
    if (alive.length === 1) {
      state.phase = 'ended';
      state.winner = alive[0].actorNr;
      logState(state, `${alive[0].name} 获胜！`);
    }
  } else {
    const teams = new Set(alive.map((p) => p.team));
    if (teams.size === 1) {
      state.phase = 'ended';
      state.winnerTeam = [...teams][0];
      logState(state, `队伍 ${state.winnerTeam + 1} 获胜！`);
    }
  }
}

/** 发给客户端的视图：隐藏他人手牌与弹药内容 */
function viewAwaiting(state, viewerActorNr) {
  const a = state.awaiting;
  if (!a) return null;
  if (a.type !== 'item_fx') return a;
  const copy = Object.assign({}, a);
  delete copy.snakePayload;
  if (a.private && Number(a.actorNr) !== Number(viewerActorNr)) {
    delete copy.bullet;
    delete copy.drawn;
    copy.hidden = true;
  }
  return copy;
}

function countTableBullets(magazine) {
  const c = { live: 0, blank: 0, special: 0 };
  for (const b of magazine) {
    if (b === BULLET.LIVE) c.live += 1;
    else if (b === BULLET.BLANK) c.blank += 1;
    else if (b === BULLET.SPECIAL) c.special += 1;
  }
  return c;
}

function viewDoubleBarrelCall(state) {
  const c = state.effects && state.effects.doubleBarrelCall;
  if (!c) return null;
  const mag = state.magazine.length;
  // 已打出 / 退弹则不再公示
  if (c.fromBottom < 0 || c.fromBottom >= mag) return null;
  const actual = state.magazine[c.fromBottom];
  return {
    index: c.index,
    declared: c.declared,
    actual,
    success: actual === c.declared,
    name: c.name || '',
    fromTop: mag - c.fromBottom
  };
}

function publicView(state, viewerActorNr) {
  const viewer = getPlayer(state, viewerActorNr);
  return {
    phase: state.phase,
    mode: state.mode,
    round: state.round,
    currentTurn: state.currentTurn,
    turnOrder: state.turnOrder,
    magazineCount: state.magazine.length,
    tableBullets: countTableBullets(state.magazine),
    effects: {
      reverseNext: state.effects.reverseNext,
      shotgunNext: state.effects.shotgunNext,
      sniperNext: state.effects.sniperNext,
      linked: flattenLinked(state),
      linkedPairs: state.effects.linkedPairs.map((pair) => pair.slice()),
      doubleItemBonus: state.effects.doubleItemBonus,
      doubleBarrelCall: viewDoubleBarrelCall(state)
    },
    awaiting: viewAwaiting(state, viewerActorNr),
    winner: state.winner,
    winnerTeam: state.winnerTeam,
    publicLog: state.publicLog.slice(-30),
    // seq 由权威状态变更时递增，勿在 publicView 内 ++（否则同一次广播会反复打满去重）
    seq: Number(state.seq) || 0,
    players: state.players.map((p) => ({
      actorNr: p.actorNr,
      name: p.name,
      hp: p.hp,
      role: p.role,
      roleName: ROLES[p.role] ? ROLES[p.role].name : '?',
      alive: p.alive,
      team: p.team,
      skipNextTurn: p.skipNextTurn,
      bulletproof: !!p.bulletproof,
      debtorNr: p.debtorNr != null ? Number(p.debtorNr) : null,
      handCount: p.hand.length,
      hand: Number(p.actorNr) === Number(viewerActorNr) ? p.hand.slice() : null
    })),
    me: viewer
      ? {
          hand: viewer.hand.slice(),
          lastPeek: viewer.lastPeek || null,
          gunpowderBottom: gunpowderBottomFor(state, viewer),
          debtorNr: viewer.debtorNr != null ? Number(viewer.debtorNr) : null
        }
      : null,
    lastItemForSnake: state.lastItemForSnake
      ? { itemId: state.lastItemForSnake.itemId, from: state.lastItemForSnake.from }
      : null
  };
}

function handleAction(state, actorNr, action) {
  // 动画/操作超时兜底：不依赖操作者是否还在线
  if (resolveExpiredAwaiting(state)) {
    // 若本次就是对应的 done / 超时心跳，当作已处理成功
    const doneTypes = {
      ammo_draw_done: true,
      first_player_done: true,
      painkiller_dice_done: true,
      eject_done: true,
      item_fx_done: true,
      double_barrel_done: true,
      shot_reveal_done: true,
      rattlesnake_timeout: true,
      awaiting_timeout: true
    };
    if (doneTypes[action.type]) return { ok: true };
    // 超时推进后禁止同一次调用再执行开枪/用牌，避免双结算
    return { ok: false, reason: '结算窗口已超时推进，请重试' };
  }
  switch (action.type) {
    case 'shoot':
      return shoot(state, actorNr, action.targetActorNr, action.nightOwlTargetNr);
    case 'use_item':
      return useItem(state, actorNr, action.itemIndex, action.payload);
    case 'double_barrel':
      return declareDoubleBarrel(state, actorNr, action.index, action.kind);
    case 'double_barrel_skip':
      return skipDoubleBarrel(state, actorNr);
    case 'double_barrel_done':
      return continueAfterDoubleBarrelReveal(state);
    case 'shot_reveal_done':
      return continueAfterShotReveal(state);
    case 'discard_hand':
      return discardHandCards(state, actorNr, action.indexes);
    case 'ammo_draw_done':
      return continueAfterAmmoDraw(state);
    case 'first_player_done':
      return continueAfterFirstPlayer(state);
    case 'painkiller_dice_done':
      return continueAfterPainkillerDice(state);
    case 'eject_done':
      return continueAfterEject(state);
    case 'item_fx_done':
      return continueAfterItemFx(state);
    case 'iron_rose':
      return useIronRose(state, actorNr, action.handIndexes);
    case 'rattlesnake_copy':
      return rattlesnakeCopy(state, actorNr);
    case 'rattlesnake_pass':
      return rattlesnakePass(state, actorNr);
    case 'rattlesnake_timeout':
      return rattlesnakeTimeout(state, action.token);
    case 'awaiting_timeout':
      return { ok: false, reason: '尚未超时' };
    default:
      return { ok: false, reason: '未知动作' };
  }
}
