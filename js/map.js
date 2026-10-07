/**
 * 越狱大逃亡 - 地图与监狱场景系统
 * 管理多区域地图网格、障碍物碰撞、视线遮挡检测 (Raycasting)、可交互环境物体与密道
 */

const TILE_SIZE = 48; // 每个网格像素尺寸

// 图块类型常量
const TILE = {
  FLOOR: 0,           // 水泥地面 (可通行)
  WALL: 1,            // 水泥高墙 (阻挡通行与视线)
  BARS: 2,            // 铁栅栏 (阻挡通行，不挡视线)
  DOOR_CELL: 3,       // 牢房铁门
  DOOR_SECURITY: 4,   // 黄色安保门
  DOOR_WARDEN: 5,     // 红色主管门
  DOOR_EXIT: 6,       // 监狱主大门
  SEWER_COVER: 7,     // 下水道井盖
  VENT_SHAFT: 8,      // 通风管道百叶格栅
  VENT_FLOOR: 9,      // 通风管道内部通道
  LASER_BARRIER: 10,  // 红外激光绊线
  GRASS: 11           // 操场外围草地
};

class PrisonMap {
  constructor() {
    this.width = 36;   // 地图宽 (网格)
    this.height = 26;  // 地图高 (网格)
    this.grid = [];
    this.doors = {};   // 记录门状态
    this.interactives = []; // 柜子、终端、宝箱等
    this.laserActive = true; // 激光栅栏通电状态

    this.initMapData();
  }

  // 初始化监狱地图布局
  initMapData() {
    // 基础实体墙填充
    this.grid = [];
    for (let y = 0; y < this.height; y++) {
      const row = [];
      for (let x = 0; x < this.width; x++) {
        row.push(TILE.WALL);
      }
      this.grid.push(row);
    }

    // 辅助打通房间地面
    const carveRoom = (x1, y1, x2, y2, tileType = TILE.FLOOR) => {
      for (let y = y1; y <= y2; y++) {
        for (let x = x1; x <= x2; x++) {
          this.setTile(x, y, tileType);
        }
      }
    };

    // 1. 通风管道暗道 (y = 1, x: 2 到 22)
    carveRoom(2, 1, 22, 1, TILE.VENT_FLOOR);
    this.setTile(2, 2, TILE.VENT_SHAFT);   // 玩家牢房上方的通风口百叶窗
    this.setTile(3, 2, TILE.FLOOR);  // 通风口前方走廊，确保玩家可接近
    this.setTile(22, 2, TILE.VENT_SHAFT);  // 更衣室上方的通风口百叶窗

    // 2. 牢房区 A (左上方)
    // 玩家牢房 (x: 2..5, y: 3..6)
    carveRoom(2, 3, 5, 6, TILE.FLOOR);
    this.setTile(6, 4, TILE.DOOR_CELL); // 玩家牢房门
    this.doors['6,4'] = { type: TILE.DOOR_CELL, isOpen: false, name: '牢房铁门', keyRequired: 'lockpick' };

    // 隔壁囚犯牢房 (x: 2..5, y: 8..10)
    carveRoom(2, 8, 5, 10, TILE.FLOOR);
    this.setTile(6, 9, TILE.DOOR_CELL); // 隔壁牢房铁门，可使用自制开锁丝撬开进入搜刮物资！
    this.doors['6,9'] = { type: TILE.DOOR_CELL, isOpen: false, name: 'B区牢房门', keyRequired: 'lockpick' };

    // 牢房巡逻走廊 (x: 7..11, y: 3..9)
    carveRoom(7, 3, 11, 9, TILE.FLOOR);
    this.setTile(12, 6, TILE.DOOR_SECURITY); // 走廊通往更衣室的黄色安保门
    this.doors['12,6'] = { type: TILE.DOOR_SECURITY, isOpen: false, name: 'A区安保门', keyRequired: 'keycard_yellow' };

    // 牢区与中央大走廊的分隔墙 (y=10)：全线筑墙封死
    for (let x = 1; x <= 26; x++) {
      this.setTile(x, 10, TILE.WALL);
    }
    this.setTile(9, 10, TILE.DOOR_SECURITY);
    this.doors['9,10'] = { type: TILE.DOOR_SECURITY, isOpen: false, name: '牢区南通道门', keyRequired: 'keycard_yellow' };

    // 3. 更衣室与医务室 (右上区域, x: 13..26, y: 3..9)
    carveRoom(13, 3, 26, 9, TILE.FLOOR);
    // 隔离墙将更衣室与医务室半隔开
    for (let y = 3; y <= 7; y++) {
      this.setTile(19, y, TILE.WALL);
    }
    // (y=10 全线已在上方统一封墙)
    this.setTile(16, 10, TILE.DOOR_SECURITY);
    this.doors['16,10'] = { type: TILE.DOOR_SECURITY, isOpen: false, name: '更衣室南通道门', keyRequired: 'keycard_yellow' };

    // 4. 中央东西巡逻大走廊 (y = 11, x: 7..26)
    carveRoom(7, 11, 26, 11, TILE.FLOOR);
    this.setTile(16, 11, TILE.LASER_BARRIER); // 中央走廊红外激光屏障

    // 5. 电力控制室与军械库 (左下区域, x: 2..13, y: 13..24)
    carveRoom(2, 13, 13, 24, TILE.FLOOR);
    // 电力机房入口门 (x=10, y=12)，确保 y=12 的其余网格全部为墙壁，严防绕行！
    for (let x = 1; x <= 14; x++) {
      this.setTile(x, 12, TILE.WALL);
    }
    this.setTile(10, 12, TILE.DOOR_SECURITY);
    this.doors['10,12'] = { type: TILE.DOOR_SECURITY, isOpen: false, name: '机房防爆门', keyRequired: 'keycard_yellow' };

    // 6. 典狱长办公室 (右下区域, x: 15..26, y: 13..24)
    carveRoom(15, 13, 26, 24, TILE.FLOOR);
    // 典狱长办公室入口密封墙 (y=12)，仅在 x=20 处留门！
    for (let x = 14; x <= 26; x++) {
      this.setTile(x, 12, TILE.WALL);
    }
    this.setTile(20, 12, TILE.DOOR_WARDEN); // 红色主管防暴门
    this.doors['20,12'] = { type: TILE.DOOR_WARDEN, isOpen: false, name: '主管通行门', keyRequired: 'keycard_yellow' };

    // 7. 外围操场与出口区 (最右侧, x: 28..34, y: 2..24)
    carveRoom(28, 2, 34, 24, TILE.GRASS);
    // 操场铁丝网隔离墙 (x=27)
    for (let y = 1; y <= 24; y++) {
      this.setTile(27, y, TILE.BARS);
    }
    // 操场出入主重型铁门 (x=27, y=11 正对中央走廊)
    this.setTile(27, 11, TILE.DOOR_EXIT);
    this.doors['27,11'] = { type: TILE.DOOR_EXIT, isOpen: false, name: '操场重型出入门', keyRequired: 'keycard_red' };

    // 逃脱路线 A: 正门主哨所出口 (最右侧 x=34, y=12)
    this.setTile(34, 12, TILE.DOOR_EXIT);
    this.doors['34,12'] = { type: TILE.DOOR_EXIT, isOpen: false, name: '监狱主出境大门', keyRequired: 'keycard_red' };

    // 逃脱路线 B: 操场废弃下水道井盖 (x=31, y=22)
    this.setTile(31, 22, TILE.SEWER_COVER);

    // 注册地图可交互家具与宝箱
    this.initInteractives();
  }

  setTile(x, y, type) {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.grid[y][x] = type;
    }
  }

  getTile(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return TILE.WALL;
    }
    return this.grid[y][x];
  }

  initInteractives() {
    this.interactives = [
      // 玩家出生牢房内的马桶水箱（藏有自制开锁铁丝）
      {
        id: 'toilet_stash',
        tileX: 2, tileY: 3,
        name: '牢房马桶水箱',
        icon: '🚽',
        searched: false,
        loot: { id: 'lockpick', name: '自制开锁丝', icon: '🪛', desc: '可用于悄悄撬开普通牢门' }
      },
      // 隔壁囚犯木桌（藏有急救绷带）
      {
        id: 'cell_desk',
        tileX: 3, tileY: 8,
        name: '木桌暗格',
        icon: '📦',
        searched: false,
        loot: { id: 'bandage', name: '止血绷带', icon: '🩹', desc: '恢复 40 点生命值' }
      },
      // 走廊警卫值班台（放着黄色安保卡）
      {
        id: 'guard_desk_1',
        tileX: 9, tileY: 5,
        name: '值班警卫办公桌',
        icon: '🗄️',
        searched: false,
        loot: { id: 'keycard_yellow', name: '黄色安保卡', icon: '💳', desc: '可解锁普通区域安保铁门' }
      },
      // 更衣室衣柜（藏有警服伪装！）
      {
        id: 'locker_disguise',
        tileX: 16, tileY: 4,
        name: '警官更衣柜',
        icon: '🚪',
        searched: false,
        loot: { id: 'disguise', name: '狱警制服', icon: '👮', desc: '换上后守卫警戒距离大幅降低！' }
      },
      // 医务室药品柜
      {
        id: 'med_cabinet',
        tileX: 24, tileY: 4,
        name: '医务急救药箱',
        icon: '💊',
        searched: false,
        loot: { id: 'medkit', name: '便携急救包', icon: '💉', desc: '生命值恢复全满' }
      },
      // 电力控制台 (可黑客破解，关闭全监狱监控与红外激光)
      {
        id: 'power_terminal',
        tileX: 4, tileY: 20,
        name: '总控电力终端',
        icon: '💻',
        isTerminal: true,
        hacked: false,
        desc: '黑入系统可关闭激光网与监控探头'
      },
      // 军械库工具箱（装有铁撬棒）
      {
        id: 'armory_crate',
        tileX: 11, tileY: 20,
        name: '工程工具箱',
        icon: '🧰',
        searched: false,
        loot: { id: 'crowbar', name: '重型铁撬', icon: '🪓', desc: '可撬开下水道井盖与通风管铁栅' }
      },
      // 典狱长豪华保险柜（装有红色万能主管卡）
      {
        id: 'warden_safe',
        tileX: 24, tileY: 20,
        name: '典狱长保险柜',
        icon: '🔐',
        searched: false,
        loot: { id: 'keycard_red', name: '红色万能卡', icon: '🔑', desc: '通往典狱长室与外围操场最高权限' }
      }
    ];
  }

  // 物理碰撞检测
  isPassable(wx, wy, radius = 16) {
    const minTileX = Math.floor((wx - radius) / TILE_SIZE);
    const maxTileX = Math.floor((wx + radius) / TILE_SIZE);
    const minTileY = Math.floor((wy - radius) / TILE_SIZE);
    const maxTileY = Math.floor((wy + radius) / TILE_SIZE);

    for (let ty = minTileY; ty <= maxTileY; ty++) {
      for (let tx = minTileX; tx <= maxTileX; tx++) {
        const tile = this.getTile(tx, ty);

        // 墙体与铁栅栏阻挡通行
        if (tile === TILE.WALL || tile === TILE.BARS) {
          return false;
        }

        // 激光网处于开启状态时阻挡通行
        if (tile === TILE.LASER_BARRIER && this.laserActive) {
          return false;
        }

        // 门如果关闭则阻挡
        const key = `${tx},${ty}`;
        if (this.doors[key] && !this.doors[key].isOpen) {
          return false;
        }
      }
    }
    return true;
  }

  // 视线投射检测 (Raycast)
  hasLineOfSight(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    const steps = Math.ceil(dist / 14);

    for (let i = 1; i <= steps; i++) {
      const px = x1 + (dx * i) / steps;
      const py = y1 + (dy * i) / steps;
      const tx = Math.floor(px / TILE_SIZE);
      const ty = Math.floor(py / TILE_SIZE);

      const tile = this.getTile(tx, ty);
      // 水泥墙阻挡视线
      if (tile === TILE.WALL) {
        return false;
      }
      // 关上的铁门阻挡视线
      const key = `${tx},${ty}`;
      if (this.doors[key] && !this.doors[key].isOpen) {
        return false;
      }
    }
    return true;
  }

  disableLasers() {
    this.laserActive = false;
  }

  draw(ctx, viewport) {
    const startCol = Math.max(0, Math.floor(viewport.x / TILE_SIZE));
    const endCol = Math.min(this.width - 1, Math.ceil((viewport.x + viewport.width) / TILE_SIZE));
    const startRow = Math.max(0, Math.floor(viewport.y / TILE_SIZE));
    const endRow = Math.min(this.height - 1, Math.ceil((viewport.y + viewport.height) / TILE_SIZE));

    for (let ty = startRow; ty <= endRow; ty++) {
      for (let tx = startCol; tx <= endCol; tx++) {
        const tile = this.grid[ty][tx];
        const screenX = tx * TILE_SIZE - viewport.x;
        const screenY = ty * TILE_SIZE - viewport.y;

        this.renderTile(ctx, tile, tx, ty, screenX, screenY);
      }
    }

    this.renderInteractives(ctx, viewport);
  }

  renderTile(ctx, tile, tx, ty, x, y) {
    switch (tile) {
      case TILE.FLOOR:
        // 可行走的室内水泥/防滑地砖 (明显亮于墙壁，纹理清晰)
        ctx.fillStyle = (tx + ty) % 2 === 0 ? '#384860' : '#2f3e53';
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        // 地砖拼缝
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, TILE_SIZE, TILE_SIZE);
        // 防滑螺栓与微小细节
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(x + 5, y + 5, 2.5, 2.5);
        ctx.fillRect(x + TILE_SIZE - 8, y + TILE_SIZE - 8, 2.5, 2.5);
        break;

      case TILE.VENT_FLOOR:
        // 通风管道低矮通道 (深色金属管道网)
        ctx.fillStyle = '#0a0f1d';
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = '#1e3a8a';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, TILE_SIZE, TILE_SIZE);
        // 金属管道斜格栅
        ctx.strokeStyle = '#2563eb';
        ctx.beginPath();
        ctx.moveTo(x, y + 14); ctx.lineTo(x + 14, y);
        ctx.moveTo(x, y + TILE_SIZE); ctx.lineTo(x + TILE_SIZE, y);
        ctx.stroke();
        break;

      case TILE.WALL:
        // 不可通行的坚固高墙 (深沉厚重 + 3D 立体边框与投影)
        // 1. 墙顶深色主基板
        ctx.fillStyle = '#0b0f19';
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

        // 2. 墙顶防爆钢板与钢筋骨架
        ctx.fillStyle = '#111827';
        ctx.fillRect(x + 3, y + 3, TILE_SIZE - 6, TILE_SIZE - 6);

        // 3. 墙壁高对比亮色外沿 (让墙体边界在视界中一目了然)
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, TILE_SIZE - 2, TILE_SIZE - 2);

        // 4. 四角加固铆钉
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(x + 4, y + 4, 3, 3);
        ctx.fillRect(x + TILE_SIZE - 7, y + 4, 3, 3);
        ctx.fillRect(x + 4, y + TILE_SIZE - 7, 3, 3);
        ctx.fillRect(x + TILE_SIZE - 7, y + TILE_SIZE - 7, 3, 3);

        // 5. 3D 立体下沿与地面阴影 (若下方是地面/草地/门，绘制 3D 墙面立柱与投射阴影)
        const tileBelow = this.getTile(tx, ty + 1);
        if (tileBelow !== TILE.WALL) {
          // 墙体立面
          ctx.fillStyle = '#05070e';
          ctx.fillRect(x, y + TILE_SIZE - 10, TILE_SIZE, 10);
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y + TILE_SIZE - 10, TILE_SIZE, 10);

          // 地面落影
          ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
          ctx.fillRect(x, y + TILE_SIZE, TILE_SIZE, 12);
        }
        break;

      case TILE.BARS:
        // 铁栅栏隔离 (底部是地面，中间是粗实金属竖杆)
        ctx.fillStyle = '#2f3e53';
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        // 上下横梁
        ctx.fillStyle = '#475569';
        ctx.fillRect(x, y + 2, TILE_SIZE, 4);
        ctx.fillRect(x, y + TILE_SIZE - 6, TILE_SIZE, 4);
        // 镀锌钢竖杆 (粗线条 + 高光)
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 3.5;
        for (let bx = 8; bx < TILE_SIZE; bx += 10) {
          ctx.beginPath();
          ctx.moveTo(x + bx, y);
          ctx.lineTo(x + bx, y + TILE_SIZE);
          ctx.stroke();
        }
        break;

      case TILE.DOOR_CELL:
      case TILE.DOOR_SECURITY:
      case TILE.DOOR_WARDEN:
      case TILE.DOOR_EXIT:
        this.renderDoor(ctx, tile, tx, ty, x, y);
        break;

      case TILE.SEWER_COVER:
        // 下水道井盖 (草地中间带有警示标识的重型铸铁盖)
        ctx.fillStyle = '#15803d';
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        // 井圈
        ctx.fillStyle = '#334155';
        ctx.beginPath();
        ctx.arc(x + TILE_SIZE / 2, y + TILE_SIZE / 2, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        // 井盖图标
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🕳️', x + TILE_SIZE / 2, y + TILE_SIZE / 2);
        break;

      case TILE.VENT_SHAFT:
        // 通风百叶窗格栅口 (带发光通风提示)
        ctx.fillStyle = '#2f3e53';
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(x + 5, y + 5, TILE_SIZE - 10, TILE_SIZE - 10);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 5, y + 5, TILE_SIZE - 10, TILE_SIZE - 10);
        // 百叶格栅
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 2;
        for (let vy = 12; vy < TILE_SIZE - 8; vy += 6) {
          ctx.beginPath();
          ctx.moveTo(x + 9, y + vy);
          ctx.lineTo(x + TILE_SIZE - 9, y + vy);
          ctx.stroke();
        }
        break;

      case TILE.LASER_BARRIER:
        // 红外激光屏障
        ctx.fillStyle = '#2f3e53';
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        // 左右发生端子
        ctx.fillStyle = '#475569';
        ctx.fillRect(x, y + 10, 6, TILE_SIZE - 20);
        ctx.fillRect(x + TILE_SIZE - 6, y + 10, 6, TILE_SIZE - 20);
        if (this.laserActive) {
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 5;
          ctx.shadowColor = '#ef4444';
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.moveTo(x + 4, y + TILE_SIZE / 2);
          ctx.lineTo(x + TILE_SIZE - 4, y + TILE_SIZE / 2);
          ctx.stroke();
          ctx.shadowBlur = 0;
        } else {
          ctx.fillStyle = '#64748b';
          ctx.fillRect(x + 4, y + TILE_SIZE / 2 - 2, TILE_SIZE - 8, 4);
        }
        break;

      case TILE.GRASS:
        // 外围操场草地 (鲜明绿色，与室内区分明显)
        ctx.fillStyle = '#166534';
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = '#15803d';
        if ((tx + ty) % 2 === 0) {
          ctx.fillRect(x + 4, y + 4, 12, 12);
          ctx.fillRect(x + 24, y + 24, 10, 10);
        }
        ctx.fillStyle = '#4ade80';
        ctx.fillRect(x + 18, y + 12, 2, 4);
        break;
    }
  }

  renderDoor(ctx, tile, tx, ty, x, y) {
    const door = this.doors[`${tx},${ty}`];
    const isOpen = door ? door.isOpen : false;

    // 地面底色
    ctx.fillStyle = '#2f3e53';
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

    if (isOpen) {
      // 开启状态 (大门缩回，绿灯通行)
      ctx.fillStyle = '#15803d';
      ctx.fillRect(x + 2, y + 2, 8, TILE_SIZE - 4);
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(x + TILE_SIZE - 10, y + 10, 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 关闭状态 (加厚门体 + 颜色鲜明的门型指示)
      let doorColor = '#64748b'; // 普通铁门
      let label = '牢';
      if (tile === TILE.DOOR_SECURITY) { doorColor = '#eab308'; label = '安'; } // 黄色安保门
      if (tile === TILE.DOOR_WARDEN) { doorColor = '#ef4444'; label = '官'; }   // 红色万能门
      if (tile === TILE.DOOR_EXIT) { doorColor = '#3b82f6'; label = '出'; }     // 终极出口

      // 门框与厚重大门
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);

      ctx.fillStyle = doorColor;
      ctx.fillRect(x + 4, y + 4, TILE_SIZE - 8, TILE_SIZE - 8);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 4, y + 4, TILE_SIZE - 8, TILE_SIZE - 8);

      // 门锁红灯
      ctx.fillStyle = '#ef4444';
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(x + TILE_SIZE - 12, y + TILE_SIZE / 2, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // 门牌文字提示
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + 16, y + TILE_SIZE / 2);
    }
  }

  renderInteractives(ctx, viewport) {
    this.interactives.forEach(item => {
      const screenX = item.tileX * TILE_SIZE - viewport.x;
      const screenY = item.tileY * TILE_SIZE - viewport.y;

      if (
        screenX >= -TILE_SIZE &&
        screenX <= viewport.width &&
        screenY >= -TILE_SIZE &&
        screenY <= viewport.height
      ) {
        ctx.font = '22px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.icon, screenX + TILE_SIZE / 2, screenY + TILE_SIZE / 2);

        if (!item.searched && !item.hacked) {
          ctx.fillStyle = '#38bdf8';
          ctx.beginPath();
          ctx.arc(screenX + TILE_SIZE - 8, screenY + 10, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
  }
}

window.PrisonMap = PrisonMap;
window.TILE = TILE;
window.TILE_SIZE = TILE_SIZE;
