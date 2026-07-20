/** 房主权威：对局逻辑 */

const MAX_HP = 6;
const HAND_LIMIT = 8;

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
      linked: [], // actorNr[]
      doubleItemBonus: {} // actorNr -> extra draws next round
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
  return state.players.find((p) => p.actorNr === actorNr);
}

function alivePlayers(state) {
  return state.players.filter((p) => p.alive);
}

function initPlayers(state, actors, mode) {
  state.mode = mode || 'ffa';
  state.players = actors.map((a, i) => ({
    actorNr: a.actorNr,
    name: a.name || `玩家${a.actorNr}`,
    hp: MAX_HP,
    role: null,
    hand: [],
    alive: true,
    team: mode === 'team' ? (i % 2) : i, // team 0/1 for 2v2; ffa unique
    skipNextTurn: false,
    peekedBottom: null
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
  logState(state, `游戏开始（${state.mode === 'team' ? '组队' : '混战'}）。角色已发放。`);
  startRound(state);
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
  while (player.hand.length > HAND_LIMIT) {
    const dumped = player.hand.pop();
    state.itemDiscard.push(dumped);
    logState(state, `${player.name} 手牌超限，弃置【${ITEMS[dumped].name}】。`);
  }
}

function hasRole(state, roleId) {
  return state.players.some((p) => p.alive && p.role === roleId);
}

function startRound(state) {
  state.round += 1;
  state.effects.reverseNext = false;
  state.effects.shotgunNext = false;
  state.rattlesnakeUsedThisRound = {};
  state.lastItemForSnake = null;
  state.rattlesnakeQueue = [];
  state.awaiting = null;

  const alive = alivePlayers(state);
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

  state.awaiting = {
    type: 'ammo_draw',
    round: state.round,
    live: liveCount,
    blank: blankCount,
    special: specialCount,
    token: `ammo-${state.round}-${Date.now()}`,
    firstPlayer
  };
  logState(state, `第 ${state.round} 轮弹药数量抽取中…`);
}

function continueAfterAmmoDraw(state) {
  if (!state.awaiting || state.awaiting.type !== 'ammo_draw') {
    return { ok: false, reason: '无需确认弹药抽取' };
  }
  const firstPlayer = state.awaiting.firstPlayer;
  state.awaiting = null;
  if (firstPlayer) {
    state.awaiting = {
      type: 'first_player_spin',
      actorNr: firstPlayer.actorNr,
      round: firstPlayer.round,
      token: firstPlayer.token,
      candidates: firstPlayer.candidates
    };
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
    state.awaiting = {
      type: 'double_barrel',
      actorNr: db.actorNr,
      name: db.name,
      magSize: state.magazine.length,
      token: `db-${state.round}-${db.actorNr}-${Date.now()}`
    };
    logState(state, `${db.name}（双管）请声明第几发是实弹或空弹。`);
    return;
  }
  beginTurns(state);
}

function continueAfterFirstPlayer(state) {
  if (!state.awaiting || state.awaiting.type !== 'first_player_spin') {
    return { ok: false, reason: '无需确认先手' };
  }
  const starter = getPlayer(state, state.awaiting.actorNr);
  const name = starter ? starter.name : `#${state.awaiting.actorNr}`;
  logState(state, `本局由 ${name} 先开始！`);
  state.awaiting = null;
  proceedRoundAfterSetup(state);
  return { ok: true };
}

function beginTurns(state) {
  // 找到第一个可行动玩家
  for (let i = 0; i < state.turnOrder.length; i++) {
    state.currentTurn = i;
    const p = currentPlayer(state);
    if (p && p.alive && !p.skipNextTurn) {
      onTurnStart(state, p);
      return;
    }
    if (p && p.skipNextTurn) {
      p.skipNextTurn = false;
      logState(state, `${p.name} 被捆绑，跳过本回合。`);
    }
  }
}

function currentPlayer(state) {
  const nr = state.turnOrder[state.currentTurn];
  return getPlayer(state, nr);
}

function moveToNextPlayer(state) {
  state.currentTurn = (state.currentTurn + 1) % state.turnOrder.length;
  let guard = 0;
  while (guard++ < state.turnOrder.length + 2) {
    const p = currentPlayer(state);
    if (p && p.alive && !p.skipNextTurn) {
      onTurnStart(state, p);
      return;
    }
    if (p && p.skipNextTurn) {
      p.skipNextTurn = false;
      logState(state, `${p.name} 被捆绑，跳过本回合。`);
    }
    state.currentTurn = (state.currentTurn + 1) % state.turnOrder.length;
  }
}

function onTurnStart(state, player) {
  player.peekedBottom = null;
  if (player.role === 'gunpowder' && state.magazine.length > 0) {
    const bottom = state.magazine.slice(0, Math.min(2, state.magazine.length));
    player.peekedBottom = bottom.slice();
    logState(state, `${player.name}（火药）查看了弹药堆底部 ${bottom.length} 张（仅自己可见）。`);
  }
  logState(state, `轮到 ${player.name} 行动。弹药剩余 ${state.magazine.length}。`);
}

function applyDamage(state, target, amount, sourceMsg) {
  if (!target.alive || amount <= 0) return;
  const linked = state.effects.linked.filter((nr) => nr !== target.actorNr);
  const victims = [target];
  linked.forEach((nr) => {
    const p = getPlayer(state, nr);
    if (p && p.alive) victims.push(p);
  });
  // 连锁：同时各扣
  victims.forEach((v) => {
    v.hp -= amount;
    logState(state, `${sourceMsg}${v.name} 受到 ${amount} 点伤害（剩余 ${Math.max(v.hp, 0)}）。`);
    if (v.hp <= 0) {
      v.hp = 0;
      v.alive = false;
      logState(state, `${v.name} 出局！`);
    }
  });
  if (linked.length) {
    state.effects.linked = [];
    logState(state, '连锁已触发并清除。');
  }
  checkWin(state);
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
  if (state.effects.reverseNext && (t === BULLET.LIVE || t === BULLET.BLANK)) {
    t = t === BULLET.LIVE ? BULLET.BLANK : BULLET.LIVE;
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
  if (!shooter || !cur || shooter.actorNr !== cur.actorNr) return { ok: false, reason: '不是你的回合' };
  if (!shooter.alive) return { ok: false, reason: '你已出局' };
  if (state.magazine.length === 0) return { ok: false, reason: '弹药已空' };

  const target = getPlayer(state, targetActorNr);
  if (!target || !target.alive) return { ok: false, reason: '目标无效' };
  const toSelf = target.actorNr === shooter.actorNr;

  const raw = state.magazine.pop();
  const resolved = resolveBulletType(state, shooter, raw);
  // 按实际抽出的弹种计入已射出（物理弹种）
  if (raw === BULLET.LIVE) state.fired.live += 1;
  else if (raw === BULLET.BLANK) state.fired.blank += 1;
  else if (raw === BULLET.SPECIAL) state.fired.special += 1;
  logState(
    state,
    `${shooter.name} 向 ${toSelf ? '自己' : target.name} 开枪：抽出【${bulletLabel(raw)}】→ 结算为【${bulletLabel(resolved)}】。`
  );

  let extraTurn = false;
  let dmg = 1;
  if (resolved === BULLET.LIVE && state.effects.shotgunNext) {
    dmg = 2;
    state.effects.shotgunNext = false;
    logState(state, '霰弹枪生效：伤害 2 点。');
  } else if (resolved !== BULLET.LIVE) {
    state.effects.shotgunNext = false;
  }

  if (resolved === BULLET.SPECIAL) {
    const silver = findSilverSpike(state);
    if (target.role === 'silver_spike') {
      heal(state, target, 1);
      logState(state, '特殊弹命中银刺：不扣血，反而回 1 血。');
    } else {
      applyDamage(state, target, 1, '特殊弹：');
      if (silver) {
        drawItems(state, silver, 1);
        logState(state, `银刺抽取一张道具。`);
      }
    }
    if (!toSelf || resolved === BULLET.SPECIAL) {
      // 特殊弹打自己/别人都结束回合（规则未写空弹续回合逻辑）
    }
  } else if (resolved === BULLET.LIVE) {
    if (toSelf && shooter.role === 'night_owl' && shooter.hp <= 4) {
      if (!nightOwlTargetNr) {
        const foes = alivePlayers(state).filter((p) => p.actorNr !== shooter.actorNr);
        nightOwlTargetNr = foes[0] && foes[0].actorNr;
      }
      const foe = getPlayer(state, nightOwlTargetNr);
      // 同时结算，避免连锁被第一次 apply 清掉
      const amount = dmg;
      const victims = [shooter];
      if (foe && foe.alive) victims.push(foe);
      state.effects.linked.forEach((nr) => {
        const p = getPlayer(state, nr);
        if (p && p.alive && !victims.includes(p)) victims.push(p);
      });
      victims.forEach((v) => {
        v.hp -= amount;
        logState(state, `夜枭实弹：${v.name} -${amount}（剩余 ${Math.max(v.hp, 0)}）`);
        if (v.hp <= 0) {
          v.hp = 0;
          v.alive = false;
          logState(state, `${v.name} 出局！`);
        }
      });
      if (state.effects.linked.length) {
        state.effects.linked = [];
        logState(state, '连锁已触发并清除。');
      }
      checkWin(state);
    } else {
      applyDamage(state, target, dmg, '');
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

  if (state.phase === 'ended') return { ok: true };

  if (state.magazine.length === 0) {
    logState(state, '弹药打空，本轮结束。');
    startRound(state);
    return { ok: true };
  }

  if (extraTurn && shooter.alive) {
    logState(state, `${shooter.name} 对自己打出空弹，再行动一次。`);
    onTurnStart(state, shooter);
  } else {
    moveToNextPlayer(state);
  }
  return { ok: true };
}

function useItem(state, actorNr, itemIndex, payload) {
  if (state.phase !== 'playing' || state.awaiting) return { ok: false, reason: '当前不能用道具' };
  const player = getPlayer(state, actorNr);
  const cur = currentPlayer(state);
  if (!player || !cur || player.actorNr !== cur.actorNr) return { ok: false, reason: '不是你的回合' };
  if (itemIndex < 0 || itemIndex >= player.hand.length) return { ok: false, reason: '无效道具' };

  const itemId = player.hand[itemIndex];
  player.hand.splice(itemIndex, 1);
  state.itemDiscard.push(itemId);
  logState(state, `${player.name} 使用【${ITEMS[itemId].name}】。`);

  const awaitingBefore = state.awaiting;
  const result = applyItemEffect(state, player, itemId, payload || {});
  // 若道具效果已进入新轮声明/先手等 awaiting，则不再插入响尾蛇窗口
  if (state.awaiting && state.awaiting !== awaitingBefore) return result;
  offerRattlesnake(state, player, itemId, payload);
  return result;
}

const RATTLESNAKE_WINDOW_MS = 5000;

function offerRattlesnake(state, sourcePlayer, itemId, originalPayload) {
  const snakes = alivePlayers(state).filter(
    (p) =>
      p.role === 'rattlesnake' &&
      p.actorNr !== sourcePlayer.actorNr &&
      !state.rattlesnakeUsedThisRound[p.actorNr] &&
      p.hp >= 1
  );
  if (!snakes.length) {
    state.lastItemForSnake = null;
    state.rattlesnakeQueue = [];
    return;
  }
  state.lastItemForSnake = { itemId, payload: originalPayload || {}, from: sourcePlayer.actorNr };
  state.rattlesnakeQueue = snakes.map((p) => p.actorNr);
  beginRattlesnakeWindow(state);
}

function beginRattlesnakeWindow(state) {
  while (state.rattlesnakeQueue && state.rattlesnakeQueue.length) {
    const nr = state.rattlesnakeQueue.shift();
    const p = getPlayer(state, nr);
    if (!p || !p.alive || p.role !== 'rattlesnake') continue;
    if (state.rattlesnakeUsedThisRound[nr]) continue;
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
    logState(state, `${p.name}（响尾蛇）可复制【${itemName}】：扣 1 血，限时 ${state.awaiting.seconds} 秒。`);
    return;
  }
  state.awaiting = null;
  state.lastItemForSnake = null;
  state.rattlesnakeQueue = [];
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
  if (state.awaiting.actorNr !== actorNr) return { ok: false, reason: '不是你的复制窗口' };
  const p = getPlayer(state, actorNr);
  if (!p || p.role !== 'rattlesnake' || !p.alive) return { ok: false, reason: '无法复制' };
  if (state.rattlesnakeUsedThisRound[actorNr]) return { ok: false, reason: '本轮已复制过' };
  if (!state.lastItemForSnake) return { ok: false, reason: '没有可复制的道具' };
  if (p.hp < 1) return { ok: false, reason: '血量不足' };
  p.hp -= 1;
  state.rattlesnakeUsedThisRound[actorNr] = true;
  const { itemId, payload } = state.lastItemForSnake;
  logState(state, `${p.name}（响尾蛇）消耗 1 血复制【${ITEMS[itemId].name}】。`);
  clearRattlesnakeOpportunity(state);
  applyItemEffect(state, p, itemId, { ...(payload || {}), _noSnakeOffer: true });
  if (p.hp <= 0) {
    p.alive = false;
    logState(state, `${p.name} 出局！`);
    checkWin(state);
  }
  return { ok: true };
}

function rattlesnakePass(state, actorNr) {
  if (!state.awaiting || state.awaiting.type !== 'rattlesnake') {
    return { ok: false, reason: '当前不是响尾蛇窗口' };
  }
  if (state.awaiting.actorNr !== actorNr) return { ok: false, reason: '不是你的复制窗口' };
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
    return { ok: false, reason: '无需确认退弹' };
  }
  const { bullet, remaining, actorNr, offerSnake } = state.awaiting;
  const player = getPlayer(state, actorNr);
  state.awaiting = null;

  logState(state, `退弹：弃置【${bulletLabel(bullet)}】。剩余 ${remaining}。`);
  if (remaining === 0) {
    logState(state, '弹药打空，本轮结束。');
    startRound(state);
    return { ok: true };
  }
  if (offerSnake && player) offerRattlesnake(state, player, 'eject', {});
  return { ok: true };
}

function continueAfterPainkillerDice(state) {
  if (!state.awaiting || state.awaiting.type !== 'painkiller_dice') {
    return { ok: false, reason: '无需确认骰子' };
  }
  const { roll, actorNr, offerSnake } = state.awaiting;
  const player = getPlayer(state, actorNr);
  state.awaiting = null;
  if (!player) return { ok: false, reason: '玩家不存在' };

  logState(state, `止痛药掷出 ${roll}（${roll % 2 === 1 ? '奇数' : '偶数'}）。`);
  if (roll % 2 === 1) applyDamage(state, player, 1, '止痛药：');
  else heal(state, player, 2);

  if (offerSnake) offerRattlesnake(state, player, 'painkiller', {});
  return { ok: true };
}

function continueAfterItemFx(state) {
  if (!state.awaiting || state.awaiting.type !== 'item_fx') {
    return { ok: false, reason: '无需确认道具动画' };
  }
  const { itemId, actorNr, offerSnake, snakePayload } = state.awaiting;
  const player = getPlayer(state, actorNr);
  state.awaiting = null;
  if (offerSnake && player) offerRattlesnake(state, player, itemId, snakePayload || {});
  return { ok: true };
}

function startItemFx(state, player, itemId, payload, visual) {
  const safePayload = Object.assign({}, payload || {});
  delete safePayload._noSnakeOffer;
  const meta = ITEMS[itemId] || {};
  state.awaiting = Object.assign(
    {
      type: 'item_fx',
      itemId,
      itemName: meta.name || itemId,
      itemArt: meta.art || null,
      itemGlyph: meta.glyph || '✦',
      actorNr: player.actorNr,
      name: player.name,
      token: `fx-${itemId}-${state.round}-${Date.now()}`,
      offerSnake: !(payload && payload._noSnakeOffer),
      snakePayload: safePayload
    },
    visual || {}
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
      state.awaiting = {
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
      };
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
        state.awaiting = {
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
        };
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
      state.effects.shotgunNext = true;
      logState(state, '霰弹枪已挂起：下一发若为实弹则伤害×2。');
      startItemFx(state, player, itemId, payload, {});
      break;
    case 'swap': {
      const i = payload.i | 0;
      const j = payload.j | 0;
      const a = state.magazine.length - 1 - i;
      const b = state.magazine.length - 1 - j;
      if (a >= 0 && b >= 0 && a < state.magazine.length && b < state.magazine.length) {
        [state.magazine[a], state.magazine[b]] = [state.magazine[b], state.magazine[a]];
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
      if (t && t.alive && t.actorNr !== player.actorNr) {
        t.skipNextTurn = true;
        logState(state, `${t.name} 被捆绑，下一回合无法行动。`);
        startItemFx(state, player, itemId, payload, {
          targetName: t.name,
          targetActorNr: t.actorNr
        });
      }
      break;
    }
    case 'double_arrow': {
      if (payload.unlock) {
        state.effects.linked = [];
        logState(state, '连锁已解除。');
        startItemFx(state, player, itemId, payload, { unlock: true, linkNames: [] });
      } else {
        const targets = (payload.targets || []).map((nr) => getPlayer(state, nr)).filter((p) => p && p.alive);
        state.effects.linked = targets.map((p) => p.actorNr);
        logState(state, `连锁目标：${targets.map((p) => p.name).join('、') || '无'}。`);
        startItemFx(state, player, itemId, payload, {
          unlock: false,
          linkNames: targets.map((p) => p.name),
          linkActors: targets.map((p) => p.actorNr)
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
  if (state.awaiting.actorNr !== actorNr) return { ok: false, reason: '不是双管玩家' };
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

  const allies = alivePlayers(state).filter((p) => p.team === player.team);
  const foes = alivePlayers(state).filter((p) => p.team !== player.team);
  const gainers = success ? allies : foes;
  gainers.forEach((p) => {
    state.effects.doubleItemBonus[p.actorNr] = (state.effects.doubleItemBonus[p.actorNr] || 0) + 2;
  });
  logState(state, `${success ? '己方' : '对手'} 下轮将额外获得双倍道具（+2）。`);

  state.awaiting = {
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
  };
  return { ok: true };
}

function continueAfterDoubleBarrelReveal(state) {
  if (!state.awaiting || state.awaiting.type !== 'double_barrel_reveal') {
    return { ok: false, reason: '无需确认双管公示' };
  }
  state.awaiting = null;
  beginTurns(state);
  return { ok: true };
}

function useIronRose(state, actorNr, handIndexes) {
  const p = getPlayer(state, actorNr);
  if (!p || p.role !== 'iron_rose') return { ok: false, reason: '不是铁玫瑰' };
  if (state.phase !== 'playing' || state.awaiting) return { ok: false, reason: '时机不对' };
  const cur = currentPlayer(state);
  if (!cur || cur.actorNr !== actorNr) return { ok: false, reason: '不是你的回合' };
  if (!Array.isArray(handIndexes) || handIndexes.length !== 2) return { ok: false, reason: '需弃两张' };
  const idxs = handIndexes.slice().sort((a, b) => b - a);
  if (idxs[0] === idxs[1] || idxs.some((i) => i < 0 || i >= p.hand.length)) return { ok: false, reason: '手牌无效' };
  idxs.forEach((i) => {
    state.itemDiscard.push(p.hand.splice(i, 1)[0]);
  });
  heal(state, p, 1);
  alivePlayers(state)
    .filter((x) => x.team === p.team && x.actorNr !== p.actorNr)
    .forEach((ally) => heal(state, ally, 1));
  logState(state, `${p.name} 发动铁玫瑰。`);
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

function publicView(state, viewerActorNr) {
  const viewer = getPlayer(state, viewerActorNr);
  return {
    phase: state.phase,
    mode: state.mode,
    round: state.round,
    currentTurn: state.currentTurn,
    turnOrder: state.turnOrder,
    magazineCount: state.magazine.length,
    loadout: state.loadout || { live: 0, blank: 0, special: 0 },
    fired: state.fired || { live: 0, blank: 0, special: 0 },
    effects: {
      reverseNext: state.effects.reverseNext,
      shotgunNext: state.effects.shotgunNext,
      linked: state.effects.linked.slice(),
      doubleItemBonus: state.effects.doubleItemBonus
    },
    awaiting: viewAwaiting(state, viewerActorNr),
    winner: state.winner,
    winnerTeam: state.winnerTeam,
    publicLog: state.publicLog.slice(-30),
    seq: ++state.seq,
    players: state.players.map((p) => ({
      actorNr: p.actorNr,
      name: p.name,
      hp: p.hp,
      role: p.role,
      roleName: ROLES[p.role] ? ROLES[p.role].name : '?',
      alive: p.alive,
      team: p.team,
      skipNextTurn: p.skipNextTurn,
      handCount: p.hand.length,
      hand: p.actorNr === viewerActorNr ? p.hand.slice() : null
    })),
    me: viewer
      ? {
          hand: viewer.hand.slice(),
          lastPeek: viewer.lastPeek || null,
          peekedBottom: viewer.peekedBottom || null
        }
      : null,
    lastItemForSnake: state.lastItemForSnake
      ? { itemId: state.lastItemForSnake.itemId, from: state.lastItemForSnake.from }
      : null
  };
}

function handleAction(state, actorNr, action) {
  switch (action.type) {
    case 'shoot':
      return shoot(state, actorNr, action.targetActorNr, action.nightOwlTargetNr);
    case 'use_item':
      return useItem(state, actorNr, action.itemIndex, action.payload);
    case 'double_barrel':
      return declareDoubleBarrel(state, actorNr, action.index, action.kind);
    case 'double_barrel_done':
      return continueAfterDoubleBarrelReveal(state);
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
    default:
      return { ok: false, reason: '未知动作' };
  }
}
