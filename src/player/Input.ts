/**
 * Unified walk-mode input: keyboard + mouse (pointer lock), touch (floating stick on the left,
 * look-drag on the right, jump button) and gamepads. Read once per frame with `read()`.
 */
export interface InputFrame {
  /** Desired movement in camera space: x = right, y = forward, length ≤ 1. */
  moveX: number;
  moveY: number;
  /** Look deltas in radians since the last frame. */
  lookX: number;
  lookY: number;
  sprint: boolean;
  walk: boolean;
  jump: boolean;
  zoom: number;
  cycleZoom: boolean;
  /** True if the player turned the camera this frame (pauses auto-recentring). */
  looked: boolean;
}

const MOUSE_SENS = 0.0022;
const TOUCH_SENS = 0.0055;
const PAD_LOOK_RATE = 2.8; // rad/s at full stick
const STICK_RADIUS = 60;

export class Input extends EventTarget {
  enabled = false;
  private keys = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private zoom = 0;
  private jumpQueued = false;
  private cycleQueued = false;
  private walkToggle = false;
  private stick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  private look: { id: number; x: number; y: number } | null = null;
  private mouseDrag: { x: number; y: number } | null = null;

  constructor(private canvas: HTMLElement, private stickEl: HTMLElement, jumpBtn: HTMLElement) {
    super();
    addEventListener('keydown', (e) => {
      if (!this.enabled || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!e.repeat) {
        if (e.code === 'Space') this.jumpQueued = true;
        if (e.code === 'KeyV') this.cycleQueued = true;
        if (e.code === 'KeyC') this.walkToggle = !this.walkToggle;
        if (e.code === 'KeyM') this.dispatchEvent(new Event('exit'));
      }
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code.startsWith('Alt')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    // Mouse: click to lock the pointer (GTA-style free look); drag works as a fallback.
    canvas.addEventListener('click', () => {
      if (this.enabled && !this.locked && matchMedia('(pointer: fine)').matches) {
        canvas.requestPointerLock?.()?.catch?.(() => {});
      }
    });
    document.addEventListener('pointerlockchange', () => this.dispatchEvent(new Event('lockchange')));
    addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked) {
        // Ignore the occasional giant spike some browsers emit right after locking.
        if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
        this.lookX += e.movementX * MOUSE_SENS;
        this.lookY += e.movementY * MOUSE_SENS;
      } else if (this.mouseDrag) {
        this.lookX += (e.clientX - this.mouseDrag.x) * MOUSE_SENS * 1.4;
        this.lookY += (e.clientY - this.mouseDrag.y) * MOUSE_SENS * 1.4;
        this.mouseDrag = { x: e.clientX, y: e.clientY };
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (this.enabled && !this.locked && e.button === 0) this.mouseDrag = { x: e.clientX, y: e.clientY };
    });
    addEventListener('mouseup', () => (this.mouseDrag = null));
    canvas.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      this.zoom += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });

    // Touch: left side spawns a floating stick, right side drags the camera.
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.pointerType !== 'touch') return;
      if (e.clientX < innerWidth * 0.45 && !this.stick) {
        this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
        this.stickEl.style.left = `${e.clientX}px`;
        this.stickEl.style.top = `${e.clientY}px`;
        this.stickEl.classList.remove('hidden');
        this.setKnob(0, 0);
      } else if (!this.look) {
        this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.stick?.id === e.pointerId) {
        let dx = (e.clientX - this.stick.ox) / STICK_RADIUS, dy = (e.clientY - this.stick.oy) / STICK_RADIUS;
        const len = Math.hypot(dx, dy);
        if (len > 1) {
          // Drag the stick base along so the thumb never "falls off" the edge.
          this.stick.ox += (dx - dx / len) * STICK_RADIUS;
          this.stick.oy += (dy - dy / len) * STICK_RADIUS;
          this.stickEl.style.left = `${this.stick.ox}px`;
          this.stickEl.style.top = `${this.stick.oy}px`;
          dx /= len; dy /= len;
        }
        this.stick.x = dx;
        this.stick.y = dy;
        this.setKnob(dx, dy);
      } else if (this.look?.id === e.pointerId) {
        this.lookX += (e.clientX - this.look.x) * TOUCH_SENS;
        this.lookY += (e.clientY - this.look.y) * TOUCH_SENS;
        this.look.x = e.clientX;
        this.look.y = e.clientY;
      }
    });
    const end = (e: PointerEvent) => {
      if (this.stick?.id === e.pointerId) {
        this.stick = null;
        this.stickEl.classList.add('hidden');
      }
      if (this.look?.id === e.pointerId) this.look = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    jumpBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.jumpQueued = true;
    });
  }

  get locked() {
    return document.pointerLockElement === this.canvas;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) {
      this.keys.clear();
      this.stick = null;
      this.look = null;
      this.mouseDrag = null;
      this.stickEl.classList.add('hidden');
      if (this.locked) document.exitPointerLock();
    }
  }

  read(dt: number): InputFrame {
    let x = 0, y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    let sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    if (this.stick) {
      x += this.stick.x;
      y -= this.stick.y;
      if (Math.hypot(this.stick.x, this.stick.y) > 0.97) sprint = true;
    }

    let lookX = this.lookX, lookY = this.lookY;
    let jump = this.jumpQueued, cycle = this.cycleQueued;
    // Gamepad (standard mapping): left stick move, right stick look, A jump, L3/RT sprint, Y zoom.
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad || pad.mapping !== 'standard') continue;
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      x += dz(pad.axes[0]);
      y -= dz(pad.axes[1]);
      lookX += dz(pad.axes[2]) * PAD_LOOK_RATE * dt;
      lookY += dz(pad.axes[3]) * PAD_LOOK_RATE * dt * 0.8;
      if (pad.buttons[10]?.pressed || (pad.buttons[7]?.value ?? 0) > 0.4) sprint = true;
      if (pad.buttons[0]?.pressed && !this.padJumpHeld) jump = true;
      this.padJumpHeld = !!pad.buttons[0]?.pressed;
      if (pad.buttons[3]?.pressed && !this.padZoomHeld) cycle = true;
      this.padZoomHeld = !!pad.buttons[3]?.pressed;
    }

    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    const walk = this.walkToggle || this.keys.has('AltLeft') || this.keys.has('AltRight');
    const frame: InputFrame = {
      moveX: x, moveY: y, lookX, lookY, sprint: sprint && !walk, walk, jump,
      zoom: this.zoom, cycleZoom: cycle, looked: Math.abs(lookX) + Math.abs(lookY) > 1e-4,
    };
    this.lookX = this.lookY = this.zoom = 0;
    this.jumpQueued = this.cycleQueued = false;
    return frame;
  }

  private padJumpHeld = false;
  private padZoomHeld = false;

  private setKnob(x: number, y: number) {
    (this.stickEl.firstElementChild as HTMLElement).style.transform = `translate(${x * 40}px, ${y * 40}px)`;
  }
}
