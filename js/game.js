/**
 * 越狱大逃亡 - 核心游戏主引擎 (Game Engine)
 * 调度游戏循环、相机视口跟随、任务目标推进、HUD 界面更新、小地图绘制与胜负结算
 */

class PrisonGame {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');

    this.minimapCanvas = document.getElementById('minimap-canvas');
    this.minimapCtx = this.minimapCanvas.getContext('2d');

    // 视口相机与画面缩放 (Zoom In 放大操作区域与角色)
    this.viewport = { x: 0, y: 0, width: 800, height: 600 };
    this.zoom = 1.65;

    // 游戏核心状态
    this.isRunning = false;
    this.isPaused = false;
    this.gameTime = 0;
    this.lastTime = 0;

    // 警报值系统 (0 - 100)
    this.alertLevel = 0;

    // 战绩统计
    this.stats = {
      guardsKnockedOut: 0,
      itemsCollected: 0,
      alarmsTriggered: 0,
      escapeRoute: '未逃出'
    };

    // 系统模块
    this.map = null;
    this.player = null;
    this.guards = [];
    this.cameras = [];
    this.particles = new ParticleSystem();

    // 任务阶段目标
    this.currentMissionStep = 1;

    this.initDOM();
    this.setupResize();
    this.bindButtons();
    this.bindCanvasTap();
  }

  initDOM() {
    this.hpBar = document.getElementById('hp-bar');
    this.hpText = document.getElementById('hp-text');
    this.spBar = document.getElementById('sp-bar');
    this.spText = document.getElementById('sp-text');
    this.alertBar = document.getElementById('alert-bar');
    this.alertText = document.getElementById('alert-text');
    this.missionText = document.getElementById('mission-text');
    this.inventorySlots = document.getElementById('inventory-slots');
    this.interactionPrompt = document.getElementById('interaction-prompt');
    this.promptText = document.getElementById('prompt-text');
    this.notificationBanner = document.getElementById('notification-banner');

    this.modalOverlay = document.getElementById('modal-overlay');
    this.startModal = document.getElementById('start-modal');
    this.victoryModal = document.getElementById('victory-modal');
    this.gameoverModal = document.getElementById('gameover-modal');
    this.btnStart = document.getElementById('btn-start-game');
    this.btnRestart = document.getElementById('btn-restart-game');
    this.btnRetry = document.getElementById('btn-retry-game');
  }

  setupResize() {
    const resize = () => {
      // 适配高分辨率视网膜屏 (Retina Display on iPad)
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = window.innerWidth * dpr;
      this.canvas.height = window.innerHeight * dpr;
      this.canvas.style.width = `${window.innerWidth}px`;
      this.canvas.style.height = `${window.innerHeight}px`;
      this.ctx.scale(dpr, dpr);

      this.viewport.width = window.innerWidth;
      this.viewport.height = window.innerHeight;
    };

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 100));
    resize();
  }

  bindButtons() {
    // 全屏按钮 (iPad / 桌面均支持)
    const btnFullscreen = document.getElementById('btn-fullscreen');
    btnFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.() ||
        document.documentElement.webkitRequestFullscreen?.();
      } else {
        document.exitFullscreen?.() || document.webkitExitFullscreen?.();
      }
    });

    // 声音切换按钮
    const btnSound = document.getElementById('btn-sound');
    btnSound.addEventListener('click', () => {
      const enabled = window.soundEngine.toggleSound();
      btnSound.textContent = enabled ? '🔊 声音' : '🔇 静音';
    });

    // 弹窗按键
    this.btnStart.addEventListener('click', () => {
      window.soundEngine.init();
      this.startModal.classList.add('hidden');
      this.modalOverlay.classList.add('hidden');
      this.startNewGame();
    });

    this.btnRestart.addEventListener('click', () => {
      this.victoryModal.classList.add('hidden');
      this.modalOverlay.classList.add('hidden');
      this.startNewGame();
    });

    this.btnRetry.addEventListener('click', () => {
      this.gameoverModal.classList.add('hidden');
      this.modalOverlay.classList.add('hidden');
      this.startNewGame();
    });
  }

  bindCanvasTap() {
    // 点击/触摸地图移动
    const canvas = this.canvas;

    const handleTap = (clientX, clientY) => {
      if (!this.isRunning || !this.player) return;

      // 屏幕坐标 → 世界坐标 (考虑缩放 zoom 与视口偏移)
      const rect = canvas.getBoundingClientRect();
      const screenX = clientX - rect.left;
      const screenY = clientY - rect.top;

      // 反算缩放：屏幕中心为缩放原点
      const cx = this.viewport.width / 2;
      const cy = this.viewport.height / 2;
      const worldScreenX = (screenX - cx) / this.zoom + cx;
      const worldScreenY = (screenY - cy) / this.zoom + cy;

      // 加上视口偏移得到世界坐标
      const worldX = worldScreenX + this.viewport.x;
      const worldY = worldScreenY + this.viewport.y;

      // 检查目标位置是否可通行
      if (this.map.isPassable(worldX, worldY, 8)) {
        this.player.moveTarget = { x: worldX, y: worldY };

        // 显示点击目标的视觉反馈粒子
        this.particles.spawnHitSparks(worldX, worldY, '#38bdf8');
      }
    };

    // 鼠标点击 (桌面)
    canvas.addEventListener('click', (e) => {
      handleTap(e.clientX, e.clientY);
    });

    // 触摸点击 (iPad) - 只响应短按 tap，不干扰摇杆
    let tapStartTime = 0;
    let tapStartPos = null;

    canvas.addEventListener('touchstart', (e) => {
      // 忽略摇杆区域和按钮区域的触摸
      if (e.target !== canvas) return;
      if (e.touches.length > 1) return;

      tapStartTime = Date.now();
      tapStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });

    canvas.addEventListener('touchend', (e) => {
      if (!tapStartPos) return;

      const elapsed = Date.now() - tapStartTime;
      const touch = e.changedTouches[0];
      const dist = Math.hypot(touch.clientX - tapStartPos.x, touch.clientY - tapStartPos.y);

      // 短按 (<300ms) 且几乎没有移动 (<15px) 才算 tap
      if (elapsed < 300 && dist < 15) {
        handleTap(touch.clientX, touch.clientY);
      }

      tapStartPos = null;
    }, { passive: true });
  }

  startNewGame() {
    this.map = new PrisonMap();
    // 玩家出生在 A 区牢房 (网格 3, 3)
    this.player = new Player(3.5 * TILE_SIZE, 3.5 * TILE_SIZE);

    // 生成守卫队伍
    this.guards = [
      // 牢房走廊巡逻警
      new Guard(9 * TILE_SIZE, 4 * TILE_SIZE, [
        { x: 9 * TILE_SIZE, y: 4 * TILE_SIZE },
        { x: 9 * TILE_SIZE, y: 9 * TILE_SIZE }
      ], GUARD_TYPE.REGULAR),

      // 中央监控大厅警卫
      new Guard(16 * TILE_SIZE, 8 * TILE_SIZE, [
        { x: 14 * TILE_SIZE, y: 8 * TILE_SIZE },
        { x: 20 * TILE_SIZE, y: 8 * TILE_SIZE }
      ], GUARD_TYPE.REGULAR),

      // 配电室走廊重装巡警
      new Guard(8 * TILE_SIZE, 15 * TILE_SIZE, [
        { x: 4 * TILE_SIZE, y: 15 * TILE_SIZE },
        { x: 12 * TILE_SIZE, y: 15 * TILE_SIZE }
      ], GUARD_TYPE.HEAVY),

      // 典狱长办公室专属 Boss 守卫
      new Guard(20 * TILE_SIZE, 18 * TILE_SIZE, [
        { x: 18 * TILE_SIZE, y: 18 * TILE_SIZE },
        { x: 23 * TILE_SIZE, y: 18 * TILE_SIZE }
      ], GUARD_TYPE.WARDEN),

      // 操场外场巡逻重装警
      new Guard(30 * TILE_SIZE, 6 * TILE_SIZE, [
        { x: 30 * TILE_SIZE, y: 4 * TILE_SIZE },
        { x: 30 * TILE_SIZE, y: 14 * TILE_SIZE }
      ], GUARD_TYPE.HEAVY)
    ];

    // 生成监控探头
    this.cameras = [
      new SecurityCamera(13 * TILE_SIZE, 2 * TILE_SIZE, Math.PI * 0.5),  // 医务室入口走廊向下扫视
      new SecurityCamera(18 * TILE_SIZE, 11 * TILE_SIZE, Math.PI * 0.75), // 激光栅栏枢纽斜向下扫视
      new SecurityCamera(27 * TILE_SIZE, 8 * TILE_SIZE, 0)                // 操场外场向右扫视
    ];

    this.particles = new ParticleSystem();
    this.alertLevel = 0;
    this.gameTime = 0;
    this.currentMissionStep = 1;
    this.stats = {
      guardsKnockedOut: 0,
      itemsCollected: 0,
      alarmsTriggered: 0,
      escapeRoute: '未逃出'
    };

    this.updateMissionText();
    this.renderInventory();
    this.showBanner('🔓 越狱开始：先在牢房搜寻开锁工具！');

    this.isRunning = true;
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.gameLoop(t));
  }

  // 增加警报值
  raiseAlarm(amount) {
    this.alertLevel = Math.min(100, this.alertLevel + amount);
    this.stats.alarmsTriggered++;

    if (this.alertLevel >= 100) {
      window.soundEngine.startAlarmSiren();
      this.showBanner('🚨 监狱一级戒备！所有守卫进入搜捕状态！', true);

      // 令所有未昏迷的守卫全部进入警戒状态
      this.guards.forEach(g => {
        if (g.state !== GUARD_STATE.KNOCKED_OUT && g.hp > 0) {
          g.state = GUARD_STATE.ALERT;
          g.investigatePos = { x: this.player.x, y: this.player.y };
        }
      });
    }
  }

  // 主循环
  gameLoop(timestamp) {
    if (!this.isRunning) return;

    const dt = Math.min(0.08, (timestamp - this.lastTime) / 1000);
    this.lastTime = timestamp;
    this.gameTime += dt;

    this.update(dt);
    this.render();

    requestAnimationFrame((t) => this.gameLoop(t));
  }

  update(dt) {
    window.inputHandler.update();

    // 自然消退警报
    if (this.alertLevel > 0) {
      this.alertLevel = Math.max(0, this.alertLevel - 3.5 * dt);
      if (this.alertLevel < 50) {
        window.soundEngine.stopAlarmSiren();
      }
    }

    // 更新玩家
    this.player.update(dt, this.map, window.inputHandler, this.particles);

    // 攻击指令响应
    if (window.inputHandler.consumeAttack()) {
      const koCountBefore = this.guards.filter(g => g.state === GUARD_STATE.KNOCKED_OUT).length;
      this.player.performAttack(this.guards, this.particles, this.map);
      const koCountAfter = this.guards.filter(g => g.state === GUARD_STATE.KNOCKED_OUT).length;
      if (koCountAfter > koCountBefore) {
        this.stats.guardsKnockedOut += (koCountAfter - koCountBefore);
      }
    }

    // 交互响应与可交互目标探测
    this.handleInteractions();

    // 更新守卫 AI
    this.guards.forEach(guard => {
      guard.update(dt, this.player, this.map, this.particles, (amt) => this.raiseAlarm(amt));
    });

    // 更新监控探头
    this.cameras.forEach(cam => {
      cam.update(dt, this.player, this.map, (amt) => this.raiseAlarm(amt));
    });

    // 更新粒子与飘字
    this.particles.update(dt);

    // 相机视口平滑跟随玩家居中
    this.viewport.x = this.player.x - this.viewport.width / 2;
    this.viewport.y = this.player.y - this.viewport.height / 2;

    // 任务状态检查
    this.checkMissionProgress();

    // 更新 HUD
    this.updateHUD();

    // 走到终极大门处自动触发逃生通关
    if (this.player.x >= 33.5 * TILE_SIZE && Math.abs(this.player.y - 12.5 * TILE_SIZE) < 1.2 * TILE_SIZE) {
      this.tryMainGateEscape();
    }

    // 死亡失败判定
    if (this.player.hp <= 0) {
      this.triggerGameOver('你的生命值耗尽，被防暴警重创捕获！');
    }
  }

  // 探测周围交互物体
  handleInteractions() {
    const interactDist = 56;
    let foundInteractable = null;
    let interactAction = null;

    // 1. 检测地图家具/宝箱/控制台
    for (const item of this.map.interactives) {
      const itemWx = item.tileX * TILE_SIZE + TILE_SIZE / 2;
      const itemWy = item.tileY * TILE_SIZE + TILE_SIZE / 2;
      const dist = Math.hypot(this.player.x - itemWx, this.player.y - itemWy);

      if (dist <= interactDist) {
        if (item.isTerminal) {
          if (!item.hacked) {
            foundInteractable = `黑入【${item.name}】`;
            interactAction = () => this.hackTerminal(item);
            break;
          }
        } else if (!item.searched) {
          foundInteractable = `搜查【${item.name}】`;
          interactAction = () => this.lootInteractive(item);
          break;
        }
      }
    }

    // 2. 检测身旁的门
    if (!foundInteractable) {
      const curTileX = Math.round(this.player.x / TILE_SIZE);
      const curTileY = Math.round(this.player.y / TILE_SIZE);

      // 检查四周紧邻网格
      const offsets = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
      for (const off of offsets) {
        const tx = curTileX + off.x;
        const ty = curTileY + off.y;

        // 终极正门出口 (优先于普通开门关门判定，直接触发逃跑通关)
        if (tx === 34 && ty === 12) {
          foundInteractable = '穿过【监狱主大门逃生】';
          interactAction = () => this.tryMainGateEscape();
          break;
        }

        // 下水道井盖出口
        if (this.map.getTile(tx, ty) === TILE.SEWER_COVER) {
          foundInteractable = '撬开【下水道井盖逃离】';
          interactAction = () => this.trySewerEscape();
          break;
        }

        // 通风管百叶格栅口
        if (this.map.getTile(tx, ty) === TILE.VENT_SHAFT) {
          if (ty === 2 && tx === 2) {
            if (this.player.y > 2 * TILE_SIZE) {
              foundInteractable = '钻入【牢房通风管道】';
              interactAction = () => {
                this.player.x = 2.5 * TILE_SIZE;
                this.player.y = 1.5 * TILE_SIZE;
                window.soundEngine.playFootstep(true);
                this.showBanner('💨 你钻入了通风管道！这里是绝佳的潜行密道！');
              };
            } else {
              foundInteractable = '爬出通风口【进入牢房】';
              interactAction = () => {
                this.player.x = 2.5 * TILE_SIZE;
                this.player.y = 3.5 * TILE_SIZE;
                window.soundEngine.playFootstep(true);
              };
            }
            break;
          } else if (ty === 2 && tx === 22) {
            if (this.player.y > 2 * TILE_SIZE) {
              foundInteractable = '钻入【医务室通风管道】';
              interactAction = () => {
                this.player.x = 21.5 * TILE_SIZE;
                this.player.y = 1.5 * TILE_SIZE;
                window.soundEngine.playFootstep(true);
                this.showBanner('💨 你钻入了通风管道！');
              };
            } else {
              foundInteractable = '爬出通风口【进入医务室】';
              interactAction = () => {
                this.player.x = 22.5 * TILE_SIZE;
                this.player.y = 3.5 * TILE_SIZE;
                window.soundEngine.playFootstep(true);
              };
            }
            break;
          }
        }

        const door = this.map.doors[`${tx},${ty}`];
        if (door) {
          if (door.isOpen) {
            foundInteractable = `关上【${door.name}】`;
            interactAction = () => { door.isOpen = false; window.soundEngine.playDoorUnlock(); };
          } else {
            foundInteractable = `开启【${door.name}】`;
            interactAction = () => this.tryOpenDoor(door, tx, ty);
          }
          break;
        }
      }
    }

    // 3. 检测击昏倒地的守卫（搜刮）
    if (!foundInteractable) {
      for (const guard of this.guards) {
        if (guard.state === GUARD_STATE.KNOCKED_OUT && !guard.looted) {
          const dist = Math.hypot(this.player.x - guard.x, this.player.y - guard.y);
          if (dist <= 40) {
            foundInteractable = `搜刮倒地【${guard.type.name}】`;
            interactAction = () => this.lootGuard(guard);
            break;
          }
        }
      }
    }

    // 更新界面提示
    const btnInteract = document.getElementById('btn-interact');
    if (foundInteractable) {
      this.interactionPrompt.classList.remove('hidden');
      this.promptText.textContent = `按【互动】：${foundInteractable}`;
      btnInteract.classList.add('active-prompt');

      if (window.inputHandler.consumeInteract()) {
        interactAction();
      }
    } else {
      this.interactionPrompt.classList.add('hidden');
      btnInteract.classList.remove('active-prompt');
    }
  }

  // 搜刮箱子/家具
  lootInteractive(item) {
    item.searched = true;
    if (item.loot) {
      this.player.addItem(item.loot);
      this.stats.itemsCollected++;
      this.showBanner(`🎒 获得：${item.loot.icon} ${item.loot.name}（${item.loot.desc}）`);
      this.renderInventory();

      // 特殊道具立即生效或换装
      if (item.loot.id === 'disguise') {
        this.player.isDisguised = true;
        this.showBanner('🎭 已换上狱警制服！守卫视线距离大幅缩短！');
      }
      if (item.loot.id === 'bandage') {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 40);
      }
      if (item.loot.id === 'medkit') {
        this.player.hp = this.player.maxHp;
      }
    }
  }

  // 黑客破解总控电力终端
  hackTerminal(terminal) {
    terminal.hacked = true;
    window.soundEngine.playHackTerminal();
    this.map.disableLasers();

    // 关停所有摄像头
    this.cameras.forEach(c => c.active = false);

    this.showBanner('⚡ 电力总控被黑！红外激光与监控探头已全部关停！');
    this.particles.spawnHitSparks(this.player.x, this.player.y, '#38bdf8');
  }

  // 搜刮守卫掉落物
  lootGuard(guard) {
    guard.looted = true;
    if (guard.type === GUARD_TYPE.WARDEN) {
      const card = { id: 'keycard_red', name: '红色万能卡', icon: '🔑', desc: '可开启典狱长室与操场大门' };
      this.player.addItem(card);
      this.showBanner('🔑 从典狱长身上搜出【红色万能卡】！');
    } else {
      const drop = Math.random() > 0.5
        ? { id: 'bandage', name: '急救绷带', icon: '🩹', desc: '恢复 40 生命值' }
        : { id: 'keycard_yellow', name: '黄色安保卡', icon: '💳', desc: '普通安保卡' };
      this.player.addItem(drop);
      this.showBanner(`🎒 从守卫身上搜获：${drop.icon} ${drop.name}`);
    }
    this.renderInventory();
  }

  // 尝试开门
  tryOpenDoor(door, tx, ty) {
    if (tx === 34 && ty === 12) {
      this.tryMainGateEscape();
      return;
    }

    if (door.keyRequired) {
      if (this.player.hasItem(door.keyRequired)) {
        door.isOpen = true;
        window.soundEngine.playDoorUnlock();
        this.showBanner(`🔓 成功开启【${door.name}】！`);
      } else {
        let hint = '需要钥匙钥匙卡！';
        if (door.keyRequired === 'lockpick') hint = '需要【自制开锁丝】！先搜查牢房马桶水箱！';
        if (door.keyRequired === 'keycard_yellow') hint = '需要【黄色安保卡】！';
        if (door.keyRequired === 'keycard_red') hint = '需要【红色万能卡】（在典狱长办公室）！';
        this.showBanner(`🔒 门已上锁：${hint}`, true);
      }
    } else {
      door.isOpen = true;
      window.soundEngine.playDoorUnlock();
    }
  }

  // 下水道井盖逃生判定
  trySewerEscape() {
    if (this.player.hasItem('crowbar')) {
      this.stats.escapeRoute = '秘密下水道管网';
      this.triggerVictory();
    } else {
      this.showBanner('🔒 井盖被螺丝封死，需要【重型铁撬】（在军械库）撬开！', true);
    }
  }

  // 正门逃生判定
  tryMainGateEscape() {
    if (this.player.hasItem('keycard_red') || this.player.isDisguised) {
      if (this.map.doors['34,12']) {
        this.map.doors['34,12'].isOpen = true;
      }
      this.stats.escapeRoute = '监狱正门哨所 (大摇大摆离开)';
      this.triggerVictory();
    } else {
      this.showBanner('🔒 正门需要【红色万能卡】或【狱警制服伪装】才能通过！', true);
    }
  }

  // 任务进度检测与指引文本
  checkMissionProgress() {
    if (this.currentMissionStep === 1 && this.player.hasItem('lockpick')) {
      this.currentMissionStep = 2;
      this.updateMissionText();
    } else if (this.currentMissionStep === 2 && (this.player.hasItem('keycard_yellow') || this.player.isDisguised)) {
      this.currentMissionStep = 3;
      this.updateMissionText();
    } else if (this.currentMissionStep === 3 && !this.map.laserActive) {
      this.currentMissionStep = 4;
      this.updateMissionText();
    } else if (this.currentMissionStep === 4 && (this.player.hasItem('keycard_red') || this.player.hasItem('crowbar'))) {
      this.currentMissionStep = 5;
      this.updateMissionText();
    }
  }

  updateMissionText() {
    const goals = [
      '目标 1: 搜查牢房内马桶暗格，找到开锁铁丝撬开牢门',
      '目标 2: 潜行避开狱警，在走廊值班台或更衣柜搜寻钥匙卡与警服',
      '目标 3: 前往下方电力机房，黑入总控终端关闭激光与监控',
      '目标 4: 暗算典狱长取得红色万能钥匙，或在军械库获取铁撬',
      '目标 5: 前往右侧操场，从主出入口或下水道井盖逃脱！'
    ];
    this.missionText.textContent = goals[this.currentMissionStep - 1] || goals[0];
  }

  // 更新 HUD
  updateHUD() {
    // 生命条
    const hpPct = Math.max(0, (this.player.hp / this.player.maxHp) * 100);
    this.hpBar.style.width = `${hpPct}%`;
    this.hpText.textContent = `${Math.ceil(this.player.hp)}/${this.player.maxHp}`;

    // 体力条
    const spPct = Math.max(0, (this.player.sp / this.player.maxSp) * 100);
    this.spBar.style.width = `${spPct}%`;
    this.spText.textContent = `${Math.ceil(this.player.sp)}/${this.player.maxSp}`;

    // 警报条
    this.alertBar.style.width = `${this.alertLevel}%`;
    this.alertText.textContent = `${Math.ceil(this.alertLevel)}% ${this.alertLevel > 50 ? '🚨警戒' : '安全'}`;
  }

  // 渲染物品栏
  renderInventory() {
    this.inventorySlots.innerHTML = '';
    const maxSlots = 5;

    for (let i = 0; i < maxSlots; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot-box';

      const item = this.player.inventory[i];
      if (item) {
        slot.classList.add('has-item');
        slot.innerHTML = `
          <span class="slot-icon">${item.icon}</span>
          ${item.count > 1 ? `<span class="slot-count">x${item.count}</span>` : ''}
          <span class="slot-tag">${item.name}</span>
        `;
      }
      this.inventorySlots.appendChild(slot);
    }
  }

  // 顶部横幅通知
  showBanner(msg, isWarning = false) {
    this.notificationBanner.textContent = msg;
    this.notificationBanner.classList.remove('hidden');
    if (isWarning) {
      this.notificationBanner.classList.add('alert-warning');
    } else {
      this.notificationBanner.classList.remove('alert-warning');
    }

    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => {
      this.notificationBanner.classList.add('hidden');
    }, 3500);
  }

  // 胜利结算
  triggerVictory() {
    this.isRunning = false;
    window.soundEngine.stopAlarmSiren();
    window.soundEngine.playVictoryFanfare();

    const victoryStats = document.getElementById('victory-stats');
    const timeFormatted = `${Math.floor(this.gameTime / 60)}分${Math.floor(this.gameTime % 60)}秒`;

    let rank = 'S (完美幽灵)';
    if (this.stats.alarmsTriggered > 3) rank = 'A (特种强突)';
    if (this.stats.alarmsTriggered > 8) rank = 'B (暴力越狱)';

    victoryStats.innerHTML = `
      <div class="stat-box">
        <span class="stat-val">${timeFormatted}</span>
        <span class="stat-lbl">越狱用时</span>
      </div>
      <div class="stat-box">
        <span class="stat-val">${this.stats.guardsKnockedOut}</span>
        <span class="stat-lbl">击晕守卫</span>
      </div>
      <div class="stat-box">
        <span class="stat-val">${rank}</span>
        <span class="stat-lbl">潜行评级</span>
      </div>
    `;

    this.victoryModal.classList.remove('hidden');
    this.modalOverlay.classList.remove('hidden');
  }

  // 失败结算
  triggerGameOver(reason) {
    this.isRunning = false;
    window.soundEngine.stopAlarmSiren();
    window.soundEngine.playGameOver();

    const gameoverReason = document.getElementById('gameover-reason');
    gameoverReason.textContent = reason;

    this.gameoverModal.classList.remove('hidden');
    this.modalOverlay.classList.remove('hidden');
  }

  // 绘制
  render() {
    // 清屏
    this.ctx.fillStyle = '#0b0f19';
    this.ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);

    this.ctx.save();
    // 以屏幕物理中心为原点进行放大 (Zoom In 1.65x)
    const cx = this.viewport.width / 2;
    const cy = this.viewport.height / 2;
    this.ctx.translate(cx, cy);
    this.ctx.scale(this.zoom, this.zoom);
    this.ctx.translate(-cx, -cy);

    // 绘制地图
    this.map.draw(this.ctx, this.viewport);

    // 绘制摄像头
    this.cameras.forEach(cam => cam.draw(this.ctx, this.viewport, this.map));

    // 绘制守卫
    this.guards.forEach(guard => guard.draw(this.ctx, this.viewport, this.map));

    // 绘制玩家
    this.player.draw(this.ctx, this.viewport);

    // 绘制点击移动目标指示器
    if (this.player.moveTarget) {
      const mtx = this.player.moveTarget.x - this.viewport.x;
      const mty = this.player.moveTarget.y - this.viewport.y;
      const pulse = (Math.sin(this.gameTime * 6) + 1) * 0.3 + 0.2;
      this.ctx.save();
      this.ctx.strokeStyle = `rgba(56, 189, 248, ${pulse})`;
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(mtx, mty, 12, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.arc(mtx, mty, 4, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(56, 189, 248, ${pulse + 0.2})`;
      this.ctx.fill();
      this.ctx.restore();
    }

    // 绘制粒子与飘字
    this.particles.draw(this.ctx, this.viewport);

    this.ctx.restore();

    // 警报高危时屏幕红光呼吸闪烁 (在屏幕空间)
    if (this.alertLevel > 60) {
      const pulseAlpha = (Math.sin(this.gameTime * 6) + 1) * 0.12 * (this.alertLevel / 100);
      this.ctx.fillStyle = `rgba(239, 68, 68, ${pulseAlpha})`;
      this.ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);
    }

    // 绘制小地图
    this.renderMinimap();
  }

  // 绘制右上角雷达小地图
  renderMinimap() {
    const mctx = this.minimapCtx;
    const mw = this.minimapCanvas.width;
    const mh = this.minimapCanvas.height;

    mctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    mctx.fillRect(0, 0, mw, mh);

    const scaleX = mw / (this.map.width * TILE_SIZE);
    const scaleY = mh / (this.map.height * TILE_SIZE);

    // 绘制简略墙体
    mctx.fillStyle = '#475569';
    for (let ty = 0; ty < this.map.height; ty++) {
      for (let tx = 0; tx < this.map.width; tx++) {
        if (this.map.grid[ty][tx] === TILE.WALL) {
          mctx.fillRect(tx * TILE_SIZE * scaleX, ty * TILE_SIZE * scaleY, TILE_SIZE * scaleX + 0.5, TILE_SIZE * scaleY + 0.5);
        }
      }
    }

    // 绘制出口标记 (绿点)
    mctx.fillStyle = '#22c55e';
    mctx.fillRect(34 * TILE_SIZE * scaleX - 3, 12 * TILE_SIZE * scaleY - 3, 6, 6);
    mctx.fillRect(32 * TILE_SIZE * scaleX - 3, 22 * TILE_SIZE * scaleY - 3, 6, 6);

    // 绘制守卫 (红点)
    mctx.fillStyle = '#ef4444';
    this.guards.forEach(g => {
      if (g.state !== GUARD_STATE.KNOCKED_OUT) {
        mctx.beginPath();
        mctx.arc(g.x * scaleX, g.y * scaleY, 2.5, 0, Math.PI * 2);
        mctx.fill();
      }
    });

    // 绘制玩家 (蓝/绿点)
    mctx.fillStyle = '#38bdf8';
    mctx.beginPath();
    mctx.arc(this.player.x * scaleX, this.player.y * scaleY, 3.5, 0, Math.PI * 2);
    mctx.fill();
  }
}

// 页面加载完成后实例化游戏
window.addEventListener('DOMContentLoaded', () => {
  window.prisonGame = new PrisonGame();
});
