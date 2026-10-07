/**
 * 越狱大逃亡 - 游戏实体系统
 * 包含玩家控制、狱警巡逻/追击/暗杀击倒 AI、旋转监控探头、粒子特效与掉落物
 */

// 守卫种类
const GUARD_TYPE = {
  REGULAR: { name: '巡逻狱警', hp: 60, speed: 2.0, color: '#3b82f6', damage: 15, viewDist: 200 },
  HEAVY: { name: '重装防暴警', hp: 100, speed: 1.6, color: '#1e3a8a', damage: 25, viewDist: 180 },
  WARDEN: { name: '典狱长', hp: 160, speed: 2.2, color: '#7f1d1d', damage: 30, viewDist: 220 }
};

// 守卫 AI 行为状态
const GUARD_STATE = {
  PATROL: 'PATROL',       // 正常按路线巡逻
  SUSPICIOUS: 'SUSPECT',  // 听到噪音或微弱动静，前去探查 (?)
  ALERT: 'ALERT',         // 发现玩家，鸣笛追击 (!)
  KNOCKED_OUT: 'KO'       // 被打晕/击倒 (Zzz)
};

// ==========================================================================
// 粒子与飘字特效系统
// ==========================================================================
class ParticleSystem {
  constructor() {
    this.particles = [];
    this.floatingTexts = [];
  }

  // 击中火花/碎屑
  spawnHitSparks(x, y, color = '#f59e0b') {
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3.5;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.25 + Math.random() * 0.2,
        maxLife: 0.45,
        color: color,
        size: 3 + Math.random() * 3
      });
    }
  }

  // 飘字提示 (如: -20, 暗杀成功!, 发现!)
  addFloatingText(x, y, text, color = '#f87171', size = 14) {
    this.floatingTexts.push({
      x, y,
      text,
      color,
      size,
      life: 0,
      maxLife: 1.2,
      vy: -1.2
    });
  }

  update(dt) {
    // 更新粒子
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // 更新飘字
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy;
      ft.life += dt;
      if (ft.life >= ft.maxLife) {
        this.floatingTexts.splice(i, 1);
      }
    }
  }

  draw(ctx, viewport) {
    // 渲染粒子
    this.particles.forEach(p => {
      const sx = p.x - viewport.x;
      const sy = p.y - viewport.y;
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(sx, sy, p.size, 0, Math.PI * 2);
      ctx.fill();
    });

    // 渲染飘字
    this.floatingTexts.forEach(ft => {
      const sx = ft.x - viewport.x;
      const sy = ft.y - viewport.y;
      const progress = ft.life / ft.maxLife;
      const alpha = Math.max(0, 1 - progress);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `bold ${ft.size}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = ft.color;
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 4;
      ctx.fillText(ft.text, sx, sy);
      ctx.restore();
    });
    ctx.globalAlpha = 1.0;
  }
}

// ==========================================================================
// 玩家类 (Player - 越狱囚犯)
// ==========================================================================
class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 16;
    this.angle = 0; // 朝向角度 (弧度)

    // 属性
    this.maxHp = 100;
    this.hp = 100;
    this.maxSp = 100;
    this.sp = 100;

    // 移动参数
    this.baseSpeed = 3.2;
    this.sneakSpeed = 1.6;
    this.sprintSpeed = 5.2;

    // 状态
    this.isDisguised = false; // 是否身穿狱警制服
    this.isHidingInVent = false; // 是否在通风管道中
    this.footstepTimer = 0;

    // 攻击冷却
    this.attackCooldown = 0;
    this.punchAnim = 0;

    // 物品栏 (初始空)
    this.inventory = [];
    this.prevX = x;
    this.prevY = y;
    // 点击移动目标
    this.moveTarget = null;
  }

  addItem(item) {
    const existing = this.inventory.find(i => i.id === item.id);
    if (existing) {
      existing.count = (existing.count || 1) + 1;
    } else {
      this.inventory.push({ ...item, count: 1 });
    }
    window.soundEngine?.playItemPickup();
  }

  hasItem(itemId) {
    return this.inventory.some(i => i.id === itemId);
  }

  consumeItem(itemId) {
    const idx = this.inventory.findIndex(i => i.id === itemId);
    if (idx !== -1) {
      if (this.inventory[idx].count > 1) {
        this.inventory[idx].count--;
      } else {
        this.inventory.splice(idx, 1);
      }
      return true;
    }
    return false;
  }

  update(dt, map, input, particles) {
    this.prevX = this.x;
    this.prevY = this.y;

    // 冷却递减
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.punchAnim > 0) this.punchAnim -= dt * 4;

    // 判断移动速度与体力消耗
    let currentSpeed = this.baseSpeed;
    let isSprinting = false;

    if (input.isSneaking) {
      currentSpeed = this.sneakSpeed;
    } else if (input.isSprinting && this.sp > 5 && (input.moveX !== 0 || input.moveY !== 0)) {
      currentSpeed = this.sprintSpeed;
      isSprinting = true;
      this.sp = Math.max(0, this.sp - 35 * dt); // 冲刺消耗体力
    } else {
      // 停止冲刺或自然恢复体力
      this.sp = Math.min(this.maxSp, this.sp + 20 * dt);
      if (input.isSprinting && this.sp <= 5) {
        // 体力耗尽，自动退出冲刺状态
        input.isSprinting = false;
        input.updateButtonVisuals?.();
      }
    }

    // 移动与朝向
    let inputX = input.moveX;
    let inputY = input.moveY;

    // 如果摇杆/键盘有输入，取消点击移动目标
    if (inputX !== 0 || inputY !== 0) {
      this.moveTarget = null;
    }

    // 点击移动：如果有移动目标且没有手动输入
    if (this.moveTarget && inputX === 0 && inputY === 0) {
      const dx = this.moveTarget.x - this.x;
      const dy = this.moveTarget.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 8) {
        this.moveTarget = null; // 到达目标
      } else {
        inputX = dx / dist;
        inputY = dy / dist;
      }
    }

    if (inputX !== 0 || inputY !== 0) {
      this.angle = Math.atan2(inputY, inputX);

      const targetX = this.x + inputX * currentSpeed;
      const targetY = this.y + inputY * currentSpeed;

      // 分轴滑动碰撞检测 (X轴 & Y轴独立)
      if (map.isPassable(targetX, this.y, this.radius)) {
        this.x = targetX;
      }
      if (map.isPassable(this.x, targetY, this.radius)) {
        this.y = targetY;
      }

      // 点击移动碰撞检测：如果撞墙了就取消目标
      if (this.moveTarget) {
        const movedDist = Math.hypot(this.x - this.prevX, this.y - this.prevY);
        if (movedDist < 0.1) {
          this.moveTarget = null;
        }
      }

      // 脚步声节拍
      this.footstepTimer += dt * (isSprinting ? 2.0 : (input.isSneaking ? 0.8 : 1.3));
      if (this.footstepTimer >= 0.45) {
        this.footstepTimer = 0;
        window.soundEngine?.playFootstep(input.isSneaking);
      }
    }

    // 检测当前是否处于通风管道网格
    const curTileX = Math.floor(this.x / TILE_SIZE);
    const curTileY = Math.floor(this.y / TILE_SIZE);
    this.isHidingInVent = (map.getTile(curTileX, curTileY) === TILE.VENT_FLOOR);
  }

  // 挥拳/武器攻击
  performAttack(guards, particles, map) {
    if (this.attackCooldown > 0) return;
    this.attackCooldown = 0.35;
    this.punchAnim = 1.0;
    window.soundEngine?.playPunchSwing();

    // 判定攻击扇形与距离 (适度放宽到 64px，更容易命中)
    const attackRange = 64;
    let hitAny = false;

    // 基础拳击 40 伤害 (普通警卫 60 血两拳必倒)；若装备铁撬棒则高达 70 伤害一击必杀！
    const baseDamage = this.hasItem('crowbar') ? 70 : 40;

    guards.forEach(guard => {
      if (guard.state === GUARD_STATE.KNOCKED_OUT) return;

      const dx = guard.x - this.x;
      const dy = guard.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= attackRange) {
        // 计算击打角度
        const toGuardAngle = Math.atan2(dy, dx);
        let angleDiff = Math.abs(toGuardAngle - this.angle);
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        angleDiff = Math.abs(angleDiff);

        // 攻击正面 90 度内有效
        if (angleDiff < Math.PI * 0.48) {
          hitAny = true;

          // 核心偷袭判定：从背后接近未进入全面警报的守卫，一击必杀击晕！
          let guardFacingDiff = Math.abs(guard.angle - this.angle);
          while (guardFacingDiff > Math.PI) guardFacingDiff -= Math.PI * 2;
          guardFacingDiff = Math.abs(guardFacingDiff);

          const isBehind = guardFacingDiff < Math.PI * 0.48;
          const isStealthy = guard.state !== GUARD_STATE.ALERT;

          // 击退与短暂僵直击晕机制
          const knockDist = 18;
          const knockX = Math.cos(this.angle) * knockDist;
          const knockY = Math.sin(this.angle) * knockDist;
          if (map && map.isPassable(guard.x + knockX, guard.y, guard.radius)) guard.x += knockX;
          if (map && map.isPassable(guard.x, guard.y + knockY, guard.radius)) guard.y += knockY;
          guard.attackCooldown = Math.max(guard.attackCooldown, 0.6); // 击退并打断守卫攻击

          if (isBehind && isStealthy) {
            // 背后偷袭成功！直接击倒
            guard.takeDamage(guard.hp, true);
            particles.addFloatingText(guard.x, guard.y - 25, '💥 背后偷袭秒杀击晕!', '#38bdf8', 22);
            particles.spawnHitSparks(guard.x, guard.y, '#38bdf8');
            window.soundEngine?.playTakedown();
          } else {
            // 正面打击：扣除伤害并显示血量
            guard.takeDamage(baseDamage, false);
            if (guard.hp > 0) {
              guard.triggerAlert(this.x, this.y); // 未倒地的守卫才会反击与报警
            } else {
              particles.addFloatingText(guard.x, guard.y - 35, '💀 击晕倒地!', '#4ade80', 24);
            }
            particles.addFloatingText(guard.x, guard.y - 18, `-${baseDamage} HP`, '#f87171', 20);
            particles.spawnHitSparks(guard.x, guard.y, '#ef4444');
            window.soundEngine?.playHitGuard();
          }
        }
      }
    });
  }

  takeDamage(amount, particles) {
    this.hp = Math.max(0, this.hp - amount);
    particles.addFloatingText(this.x, this.y - 15, `-${amount} HP`, '#ef4444', 15);
    particles.spawnHitSparks(this.x, this.y, '#dc2626');
    window.soundEngine?.playPlayerHurt();
  }

  draw(ctx, viewport) {
    const sx = this.x - viewport.x;
    const sy = this.y - viewport.y;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(this.angle);

    // 阴影
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(0, 0, this.radius, this.radius * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // 身体颜色：若身穿伪装则是警服深蓝，否则是醒目的囚犯橙色
    const bodyColor = this.isDisguised ? '#1e3a8a' : '#ea580c';
    const skinColor = '#fed7aa';

    // 躯干
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 头部
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.arc(4, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 双拳/手部动画
    const punchOffset = this.punchAnim * 12;
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.arc(10 + punchOffset, 10, 4.5, 0, Math.PI * 2);
    ctx.arc(10, -10, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 伪装状态特有标志：警帽
    if (this.isDisguised) {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(2, -7, 6, 14);
      ctx.fillStyle = '#fbbf24'; // 金色警徽
      ctx.fillRect(7, -2, 3, 4);
    }

    ctx.restore();

    // 潜行 / 冲刺 状态与声音光环指示 (让玩家清晰感知静音效果)
    const isMoving = (Math.abs(this.x - this.prevX) > 0.05 || Math.abs(this.y - this.prevY) > 0.05);
    if (window.inputHandler?.isSneaking) {
      // 潜行翡翠绿光环 (代表 100% 绝对静音)
      ctx.save();
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, this.radius + 6, 0, Math.PI * 2);
      ctx.stroke();

      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#34d399';
      ctx.textAlign = 'center';
      ctx.fillText('🤫 潜行静音', sx, sy - 22);
      ctx.restore();
    } else if (window.inputHandler?.isSprinting && isMoving) {
      // 冲刺声音扩散圈 (清晰提示发出大脚步声)
      ctx.save();
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(sx, sy, 70, 0, Math.PI * 2);
      ctx.stroke();

      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#fbbf24';
      ctx.textAlign = 'center';
      ctx.fillText('🔊 奔跑声响', sx, sy - 22);
      ctx.restore();
    }
  }
}

// ==========================================================================
// 狱警类 (Guard - 巡逻、警戒、追击、击倒)
// ==========================================================================
class Guard {
  constructor(x, y, waypoints = [], type = GUARD_TYPE.REGULAR) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.hp = type.hp;
    this.maxHp = type.hp;
    this.speed = type.speed;
    this.damage = type.damage;
    this.viewDist = type.viewDist;
    this.viewAngle = Math.PI * 0.38; // 视野开角 (~68度)

    this.radius = 16;
    this.angle = 0;
    this.state = GUARD_STATE.PATROL;

    // 巡逻航点
    this.waypoints = waypoints.length > 0 ? waypoints : [{ x, y }];
    this.currentWaypointIdx = 0;
    this.waitTimer = 0;

    // 警觉与疑虑目标点
    this.investigatePos = null;
    this.lostSightTimer = 0;
    this.suspiciousTimer = 0;
    this.stuckTimer = 0; // 卡墙检测计时器

    // 昏迷计时器
    this.knockoutTimer = 0;

    // 攻击冷却
    this.attackCooldown = 0;

    // 是否已被搜刮掉落物
    this.looted = false;
  }

  update(dt, player, map, particles, onAlarmTrigger) {
    // 昏迷状态处理：彻底失去行动能力，永久倒地不可行动
    if (this.state === GUARD_STATE.KNOCKED_OUT || this.hp <= 0) {
      this.state = GUARD_STATE.KNOCKED_OUT;
      this.hp = 0;
      return;
    }

    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    // 视觉检测玩家
    const canSeePlayer = this.checkCanSeePlayer(player, map);

    if (canSeePlayer) {
      // 发现玩家！
      if (this.state !== GUARD_STATE.ALERT) {
        this.state = GUARD_STATE.ALERT;
        particles.addFloatingText(this.x, this.y - 25, '🚨 发现可疑人员!', '#ef4444', 22);
        window.soundEngine?.playAlertFound();
        if (onAlarmTrigger) onAlarmTrigger(25); // 增加全局警报值
      }
      this.investigatePos = { x: player.x, y: player.y };
      this.lostSightTimer = 0;
      this.suspiciousTimer = 0;

      // 追击玩家 (带自动滑墙避障)
      this.moveTowards(player.x, player.y, dt, map, 1.25);

      // 攻击玩家判定
      const distToPlayer = Math.hypot(player.x - this.x, player.y - this.y);
      if (distToPlayer <= 40 && this.attackCooldown <= 0) {
        this.attackCooldown = 0.9;
        player.takeDamage(this.damage, particles);
        window.soundEngine?.playHitGuard();
      }
    } else {
      // 没看到玩家时，检测脚步声音 (冲刺发出大噪音、行走发出中等噪音，潜行完全无声)
      const isPlayerMoving = (Math.abs(player.x - player.prevX) > 0.1 || Math.abs(player.y - player.prevY) > 0.1);
      if (isPlayerMoving && this.state !== GUARD_STATE.ALERT && !player.isHidingInVent) {
        const distToPlayer = Math.hypot(player.x - this.x, player.y - this.y);
        let soundRadius = 0;
        if (window.inputHandler?.isSprinting) {
          soundRadius = 180; // 冲刺狂奔：脚步极响，180px 内警卫立即察觉转头
        } else if (!window.inputHandler?.isSneaking) {
          soundRadius = 75;  // 正常行走：75px 内背后警卫会听到异响
        } else {
          soundRadius = 0;   // 潜行模式：绝对静音！敌人完全听不见！
        }

        if (soundRadius > 0 && distToPlayer <= soundRadius) {
          if (this.state === GUARD_STATE.PATROL) {
            this.state = GUARD_STATE.SUSPICIOUS;
            this.investigatePos = { x: player.x, y: player.y };
            this.suspiciousTimer = 0;
            particles.addFloatingText(this.x, this.y - 30, '👂 听到动静!', '#f59e0b', 20);
          }
        }
      }

      if (this.state === GUARD_STATE.ALERT) {
        // 丢失视野，前往最后目击点
        this.lostSightTimer += dt;
        // 若追击超时或卡墙无法接近，立即降级为疑虑调查，防止卡死
        if (this.lostSightTimer > 3.0 || this.stuckTimer > 1.2) {
          this.state = GUARD_STATE.SUSPICIOUS;
          this.lostSightTimer = 0;
          this.suspiciousTimer = 0;
          this.stuckTimer = 0;
        } else if (this.investigatePos) {
          this.moveTowards(this.investigatePos.x, this.investigatePos.y, dt, map, 1.2);
        }
      } else if (this.state === GUARD_STATE.SUSPICIOUS) {
        // 疑虑状态：前往调查点，设定严格超时保护（最多2.5秒或卡墙0.8秒），防止贴墙卡死
        this.suspiciousTimer += dt;
        if (this.suspiciousTimer > 2.5 || this.stuckTimer > 0.8) {
          this.investigatePos = null;
          this.suspiciousTimer = 0;
          this.stuckTimer = 0;
          this.state = GUARD_STATE.PATROL;
        } else if (this.investigatePos) {
          const reached = this.moveTowards(this.investigatePos.x, this.investigatePos.y, dt, map, 0.9);
          if (reached) {
            this.investigatePos = null;
            this.suspiciousTimer = 0;
            this.state = GUARD_STATE.PATROL;
          }
        } else {
          this.state = GUARD_STATE.PATROL;
        }
      } else {
        // 正常巡逻
        this.patrol(dt, map);
      }
    }
  }

  // 检测能否看见玩家 (结合视线遮挡、角度、光照、距离、伪装与潜行状态)
  checkCanSeePlayer(player, map) {
    if (this.state === GUARD_STATE.KNOCKED_OUT || this.hp <= 0) return false;
    if (player.isHidingInVent) return false; // 藏在通风管道内无法被看见

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);

    // 身穿警服伪装，守卫有效辨识距离降低 75%；处于潜行模式，身位伏低，视距缩短 40%！
    let maxDist = this.viewDist;
    if (player.isDisguised) {
      maxDist = window.inputHandler.isSprinting ? 120 : 50;
    } else if (window.inputHandler?.isSneaking) {
      maxDist = this.viewDist * 0.6; // 潜行显著降低敌人发现距离
    }

    if (dist > maxDist) return false;

    // 视锥角度判定
    const toPlayerAngle = Math.atan2(dy, dx);
    let angleDiff = Math.abs(toPlayerAngle - this.angle);
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    angleDiff = Math.abs(angleDiff);

    if (angleDiff > this.viewAngle / 2) return false;

    // 视线射线检测 (检测是否有墙壁或闭合铁门遮挡)
    return map.hasLineOfSight(this.x, this.y, player.x, player.y);
  }

  // 带墙体滑动与卡死自救的移动算法
  moveTowards(tx, ty, dt, map, speedMult = 1.0) {
    if (this.state === GUARD_STATE.KNOCKED_OUT || this.hp <= 0) return true;
    const dx = tx - this.x;
    const dy = ty - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 12) {
      this.stuckTimer = 0;
      return true;
    }

    this.angle = Math.atan2(dy, dx);
    const moveSpeed = this.speed * speedMult;
    const stepX = Math.cos(this.angle) * moveSpeed;
    const stepY = Math.sin(this.angle) * moveSpeed;

    const prevX = this.x;
    const prevY = this.y;

    // 1. 分轴滑动检测 (允许贴墙顺滑滑动)
    let moved = false;
    if (map.isPassable(this.x + stepX, this.y, this.radius)) {
      this.x += stepX;
      moved = true;
    }
    if (map.isPassable(this.x, this.y + stepY, this.radius)) {
      this.y += stepY;
      moved = true;
    }

    // 2. 如果正对着死角卡住，尝试左右切线角度滑步避障
    if (!moved) {
      const anglesToTry = [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2];
      for (const offset of anglesToTry) {
        const altAngle = this.angle + offset;
        const altX = Math.cos(altAngle) * moveSpeed * 0.8;
        const altY = Math.sin(altAngle) * moveSpeed * 0.8;
        if (map.isPassable(this.x + altX, this.y + altY, this.radius)) {
          this.x += altX;
          this.y += altY;
          moved = true;
          break;
        }
      }
    }

    // 3. 统计实际位移判定是否卡住
    const actualDist = Math.hypot(this.x - prevX, this.y - prevY);
    if (actualDist < 0.25) {
      this.stuckTimer += dt;
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2);
    }

    return false;
  }

  patrol(dt, map) {
    if (this.state === GUARD_STATE.KNOCKED_OUT || this.hp <= 0) return;
    if (this.waypoints.length === 0) return;

    const wp = this.waypoints[this.currentWaypointIdx];
    const reached = this.moveTowards(wp.x, wp.y, dt, map, 1.0);

    // 若巡逻中卡住超过 1.2 秒，自动跳过当前航点去下一个，防止卡死在门框
    if (reached || this.stuckTimer > 1.2) {
      this.stuckTimer = 0;
      this.waitTimer += dt;
      if (this.waitTimer > 1.8 || this.stuckTimer > 1.2) {
        this.waitTimer = 0;
        this.currentWaypointIdx = (this.currentWaypointIdx + 1) % this.waypoints.length;
      }
    }
  }

  triggerAlert(x, y) {
    if (this.state === GUARD_STATE.KNOCKED_OUT || this.hp <= 0) return;
    this.state = GUARD_STATE.ALERT;
    this.investigatePos = { x, y };
  }

  takeDamage(amount, instantKnockout = false) {
    this.hp -= amount;
    if (this.hp <= 0 || instantKnockout) {
      this.hp = 0;
      this.state = GUARD_STATE.KNOCKED_OUT;
    }
  }

  draw(ctx, viewport, map) {
    const sx = this.x - viewport.x;
    const sy = this.y - viewport.y;

    // 1. 昏迷状态下绘制趴倒地面的造型
    if (this.state === GUARD_STATE.KNOCKED_OUT) {
      ctx.save();
      ctx.translate(sx, sy);
      // 身体平躺
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.ellipse(0, 0, this.radius * 1.2, this.radius * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 头上漂浮 Zzz
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('Zzz...', -10, -18);
      ctx.restore();
      return;
    }

    // 2. 正常/警觉状态下绘制视锥光束 (FOV Cone)
    this.drawVisionCone(ctx, viewport, map);

    // 3. 绘制守卫身体
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(this.angle);

    // 阴影
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(0, 0, this.radius, this.radius * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // 守卫躯干 (深蓝/防暴黑/典狱长暗红)
    ctx.fillStyle = this.type.color;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 头部与警帽
    ctx.fillStyle = '#fed7aa';
    ctx.beginPath();
    ctx.arc(4, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(2, -7, 6, 14);

    // 右手警棍
    ctx.fillStyle = '#334155';
    ctx.fillRect(10, 8, 14, 4);

    ctx.restore();

    // 4. 头顶实时血量条 (受到攻击扣血或警觉时展示，直观可见剩余血量)
    if (this.hp < this.maxHp || this.state === GUARD_STATE.ALERT || this.state === GUARD_STATE.SUSPICIOUS) {
      const barW = 36;
      const barH = 5;
      const barX = sx - barW / 2;
      const barY = sy - 25;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);

      const pct = Math.max(0, this.hp / this.maxHp);
      ctx.fillStyle = pct > 0.5 ? '#22c55e' : (pct > 0.25 ? '#eab308' : '#ef4444');
      ctx.fillRect(barX, barY, barW * pct, barH);
    }

    // 5. 头顶状态气泡 (! 或 ?)
    if (this.state === GUARD_STATE.ALERT) {
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('❗', sx, sy - 34);
    } else if (this.state === GUARD_STATE.SUSPICIOUS) {
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('❓', sx, sy - 34);
    }
  }

  drawVisionCone(ctx, viewport, map) {
    const sx = this.x - viewport.x;
    const sy = this.y - viewport.y;

    let coneColor = 'rgba(234, 179, 8, 0.16)'; // 巡逻黄色
    if (this.state === GUARD_STATE.SUSPICIOUS) coneColor = 'rgba(249, 115, 22, 0.28)'; // 疑虑橙色
    if (this.state === GUARD_STATE.ALERT) coneColor = 'rgba(239, 68, 68, 0.35)'; // 警戒红色

    ctx.save();
    ctx.fillStyle = coneColor;
    ctx.beginPath();
    ctx.moveTo(sx, sy);

    const numRays = 24;
    const halfAngle = this.viewAngle / 2;

    for (let i = 0; i <= numRays; i++) {
      const rayAngle = this.angle - halfAngle + (this.viewAngle * i) / numRays;
      
      // 光线投射计算墙体阻挡
      let rayDist = this.viewDist;
      const step = 16;
      for (let d = step; d <= this.viewDist; d += step) {
        const testX = this.x + Math.cos(rayAngle) * d;
        const testY = this.y + Math.sin(rayAngle) * d;
        const tx = Math.floor(testX / TILE_SIZE);
        const ty = Math.floor(testY / TILE_SIZE);

        if (map.getTile(tx, ty) === TILE.WALL) {
          rayDist = d;
          break;
        }
      }

      const endX = sx + Math.cos(rayAngle) * rayDist;
      const endY = sy + Math.sin(rayAngle) * rayDist;
      ctx.lineTo(endX, endY);
    }

    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// ==========================================================================
// 监控探头类 (Security Camera - 自动扫视走廊)
// ==========================================================================
class SecurityCamera {
  constructor(x, y, baseAngle, sweepArc = Math.PI * 0.45) {
    this.x = x;
    this.y = y;
    this.baseAngle = baseAngle;
    this.sweepArc = sweepArc;
    this.timer = Math.random() * 5;
    this.angle = baseAngle;
    this.viewDist = 170;
    this.viewAngle = Math.PI * 0.32; // 窄光束
    this.active = true;
    this.detectTimer = 0;
  }

  update(dt, player, map, onAlarmTrigger) {
    if (!this.active) return;

    // 摆动扫视
    this.timer += dt * 0.8;
    this.angle = this.baseAngle + Math.sin(this.timer) * (this.sweepArc / 2);

    // 检测玩家
    if (player.isHidingInVent) return;

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= this.viewDist) {
      const toPlayerAngle = Math.atan2(dy, dx);
      let angleDiff = Math.abs(toPlayerAngle - this.angle);
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      angleDiff = Math.abs(angleDiff);

      if (angleDiff <= this.viewAngle / 2 && map.hasLineOfSight(this.x, this.y, player.x, player.y)) {
        this.detectTimer += dt;
        if (this.detectTimer > 0.6) {
          // 监控触发大警报
          if (onAlarmTrigger) onAlarmTrigger(35);
          window.soundEngine?.playAlertFound();
          this.detectTimer = 0;
        }
        return;
      }
    }

    this.detectTimer = Math.max(0, this.detectTimer - dt);
  }

  draw(ctx, viewport, map) {
    const sx = this.x - viewport.x;
    const sy = this.y - viewport.y;

    if (this.active) {
      // 绘制红外扫描光锥
      ctx.save();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
      ctx.beginPath();
      ctx.moveTo(sx, sy);

      const numRays = 16;
      for (let i = 0; i <= numRays; i++) {
        const rayAngle = this.angle - this.viewAngle / 2 + (this.viewAngle * i) / numRays;
        let rayDist = this.viewDist;
        for (let d = 16; d <= this.viewDist; d += 16) {
          const testX = this.x + Math.cos(rayAngle) * d;
          const testY = this.y + Math.sin(rayAngle) * d;
          if (map.getTile(Math.floor(testX / TILE_SIZE), Math.floor(testY / TILE_SIZE)) === TILE.WALL) {
            rayDist = d;
            break;
          }
        }
        ctx.lineTo(sx + Math.cos(rayAngle) * rayDist, sy + Math.sin(rayAngle) * rayDist);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // 探头本体
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(this.angle);

    ctx.fillStyle = '#334155';
    ctx.fillRect(-6, -6, 12, 12);

    ctx.fillStyle = this.active ? '#ef4444' : '#64748b';
    ctx.fillRect(6, -3, 8, 6);

    ctx.restore();
  }
}

window.GUARD_TYPE = GUARD_TYPE;
window.GUARD_STATE = GUARD_STATE;
window.Player = Player;
window.Guard = Guard;
window.SecurityCamera = SecurityCamera;
window.ParticleSystem = ParticleSystem;
