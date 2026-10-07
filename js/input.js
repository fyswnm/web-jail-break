/**
 * 越狱大逃亡 - 跨平台多点触控与输入控制系统
 * 专为 iPad 大屏触控与双手手势优化，兼容桌面键盘与鼠标
 */
class InputHandler {
  constructor() {
    // 移动向量 (-1 到 1)
    this.moveX = 0;
    this.moveY = 0;

    // 动作指令 (瞬时触发与持续状态)
    this.attackPressed = false;
    this.interactPressed = false;
    this.isSneaking = false;
    this.isSprinting = false;

    // 摇杆控制状态
    this.joystickActive = false;
    this.joystickTouchId = null;
    this.joystickCenter = { x: 0, y: 0 };
    this.maxJoystickRadius = 55; // 最大拖拽半径 (px)

    // 键盘状态映射
    this.keys = {};

    this.initElements();
    this.bindTouchEvents();
    this.bindKeyboardEvents();
    this.bindPreventDefaults();
  }

  initElements() {
    this.joystickZone = document.getElementById('joystick-zone');
    this.joystickBase = document.getElementById('joystick-base');
    this.joystickKnob = document.getElementById('joystick-knob');

    this.btnAttack = document.getElementById('btn-attack');
    this.btnInteract = document.getElementById('btn-interact');
    this.btnSneak = document.getElementById('btn-sneak');
    this.btnSprint = document.getElementById('btn-sprint');
  }

  bindPreventDefaults() {
    // 禁止 iPad 浏览器默认手势：双击缩放、右键长按菜单、橡皮筋下拉
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('gesturechange', (e) => e.preventDefault());
    document.addEventListener('gestureend', (e) => e.preventDefault());

    window.addEventListener('contextmenu', (e) => {
      // 游戏区域内禁用长按菜单
      if (e.target.closest('#game-container')) {
        e.preventDefault();
      }
    });

    document.addEventListener('touchmove', (e) => {
      // 阻止整体页面拖拽滚动
      if (e.target.closest('#game-container')) {
        e.preventDefault();
      }
    }, { passive: false });
  }

  bindTouchEvents() {
    if (!this.joystickZone) return;

    // --- 虚拟摇杆触控 ---
    const updateJoystickPosition = (clientX, clientY) => {
      const dx = clientX - this.joystickCenter.x;
      const dy = clientY - this.joystickCenter.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const radius = Math.min(dist, this.maxJoystickRadius);
      const angle = Math.atan2(dy, dx);

      const knobX = Math.cos(angle) * radius;
      const knobY = Math.sin(angle) * radius;

      // 移动旋钮视觉
      this.joystickKnob.style.transform = `translate(${knobX}px, ${knobY}px)`;

      // 计算归一化向量并施加轻微死区
      const deadzone = 0.15;
      const normalizedDist = radius / this.maxJoystickRadius;

      if (normalizedDist < deadzone) {
        this.moveX = 0;
        this.moveY = 0;
      } else {
        const factor = (normalizedDist - deadzone) / (1 - deadzone);
        this.moveX = Math.cos(angle) * factor;
        this.moveY = Math.sin(angle) * factor;
      }
    };

    const resetJoystick = () => {
      this.joystickActive = false;
      this.joystickTouchId = null;
      this.moveX = 0;
      this.moveY = 0;
      this.joystickKnob.style.transform = 'translate(0px, 0px)';
    };

    this.joystickZone.addEventListener('touchstart', (e) => {
      window.soundEngine?.init();
      if (this.joystickActive) return;

      const touch = e.changedTouches[0];
      this.joystickActive = true;
      this.joystickTouchId = touch.identifier;

      const rect = this.joystickBase.getBoundingClientRect();
      this.joystickCenter = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };

      updateJoystickPosition(touch.clientX, touch.clientY);
      e.preventDefault();
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      if (!this.joystickActive) return;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === this.joystickTouchId) {
          updateJoystickPosition(touch.clientX, touch.clientY);
          break;
        }
      }
    }, { passive: false });

    const handleTouchEnd = (e) => {
      if (!this.joystickActive) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this.joystickTouchId) {
          resetJoystick();
          break;
        }
      }
    };

    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);

    // --- 动作按钮触控绑定 ---
    // 攻击键
    const triggerAttack = (e) => {
      e.preventDefault();
      window.soundEngine?.init();
      this.attackPressed = true;
    };
    this.btnAttack.addEventListener('touchstart', triggerAttack, { passive: false });
    this.btnAttack.addEventListener('mousedown', triggerAttack);

    // 互动键
    const triggerInteract = (e) => {
      e.preventDefault();
      window.soundEngine?.init();
      this.interactPressed = true;
    };
    this.btnInteract.addEventListener('touchstart', triggerInteract, { passive: false });
    this.btnInteract.addEventListener('mousedown', triggerInteract);

    // 潜行键 (点击切换模式，平板上单手点击切换最舒适)
    const toggleSneak = (e) => {
      e.preventDefault();
      window.soundEngine?.init();
      this.isSneaking = !this.isSneaking;
      if (this.isSneaking) {
        this.isSprinting = false;
      }
      this.updateButtonVisuals();
    };
    this.btnSneak.addEventListener('touchstart', toggleSneak, { passive: false });
    this.btnSneak.addEventListener('click', toggleSneak);

    // 冲刺键 (可按住也可点击切换)
    const toggleSprint = (e) => {
      e.preventDefault();
      window.soundEngine?.init();
      this.isSprinting = !this.isSprinting;
      if (this.isSprinting) {
        this.isSneaking = false;
      }
      this.updateButtonVisuals();
    };
    this.btnSprint.addEventListener('touchstart', toggleSprint, { passive: false });
    this.btnSprint.addEventListener('click', toggleSprint);
  }

  // 刷新潜行与冲刺按键的高亮与文字状态
  updateButtonVisuals() {
    if (this.btnSneak) {
      this.btnSneak.classList.toggle('active', this.isSneaking);
      const txt = this.btnSneak.querySelector('.btn-text');
      if (txt) txt.textContent = this.isSneaking ? '潜行中' : '潜行';
    }
    if (this.btnSprint) {
      this.btnSprint.classList.toggle('active', this.isSprinting);
      const txt = this.btnSprint.querySelector('.btn-text');
      if (txt) txt.textContent = this.isSprinting ? '冲刺中' : '冲刺';
    }
  }

  bindKeyboardEvents() {
    window.addEventListener('keydown', (e) => {
      window.soundEngine?.init();
      this.keys[e.code] = true;

      if (e.code === 'KeyE' || e.code === 'KeyF') {
        this.interactPressed = true;
      }
      if (e.code === 'Space' || e.code === 'KeyJ') {
        this.attackPressed = true;
      }
      if (e.code === 'KeyC') {
        this.isSneaking = !this.isSneaking;
        if (this.isSneaking) this.isSprinting = false;
        this.updateButtonVisuals();
      }
      if (e.shiftKey) {
        this.isSprinting = true;
        this.isSneaking = false;
        this.updateButtonVisuals();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.isSprinting = false;
        this.updateButtonVisuals();
      }
    });
  }

  // 每帧由游戏循环调用以刷新状态
  update() {
    // 若未激活触摸摇杆，则从键盘状态合成移动向量
    if (!this.joystickActive) {
      let kx = 0;
      let ky = 0;

      if (this.keys['KeyA'] || this.keys['ArrowLeft']) kx -= 1;
      if (this.keys['KeyD'] || this.keys['ArrowRight']) kx += 1;
      if (this.keys['KeyW'] || this.keys['ArrowUp']) ky -= 1;
      if (this.keys['KeyS'] || this.keys['ArrowDown']) ky += 1;

      if (kx !== 0 && ky !== 0) {
        // 对角线归一化
        kx *= 0.7071;
        ky *= 0.7071;
      }

      this.moveX = kx;
      this.moveY = ky;
    }
  }

  // 读取并消费瞬时按键（避免一次按下持续多帧响应）
  consumeAttack() {
    const p = this.attackPressed;
    this.attackPressed = false;
    return p;
  }

  consumeInteract() {
    const p = this.interactPressed;
    this.interactPressed = false;
    return p;
  }
}

window.inputHandler = new InputHandler();
