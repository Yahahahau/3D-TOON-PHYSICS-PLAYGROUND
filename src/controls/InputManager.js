import { Keyboard } from './Keyboard.js';

/**
 * Merges keyboard and touch input into one state per character.
 * Dual mode: left stick + left jump -> A, right stick + right jump -> B.
 * Single mode: left stick + big jump -> the selected character.
 */
export class InputManager {
  constructor(settings) {
    this.settings = settings;
    this.keyboard = new Keyboard();
    this.touch = null; // set by the UI once the touch controls exist
    this.state = {
      a: { x: 0, y: 0, jumpPressed: false, jumpHeld: false },
      b: { x: 0, y: 0, jumpPressed: false, jumpHeld: false },
    };
    this._kb = { x: 0, y: 0, jumpPressed: false, jumpHeld: false };
    this.singleTarget = 'a';
  }

  attachTouch(touch) {
    this.touch = touch;
  }

  /** Called once per rendered frame. */
  update(dt) {
    for (const id of ['a', 'b']) {
      const s = this.state[id];
      this.keyboard.read(id, this._kb);
      s.x = this._kb.x;
      s.y = this._kb.y;
      s.jumpHeld = this._kb.jumpHeld;
      s.jumpPressed = s.jumpPressed || this._kb.jumpPressed;
    }
    this.keyboard.consume();

    const t = this.touch;
    if (!t) return;
    const single = this.settings.get('controlMode') === 'single';
    const left = t.joyLeft.sample(dt);
    const right = t.joyRight.sample(dt);
    const jumpA = t.jumpA;
    const jumpB = t.jumpB;
    if (single) {
      const id = this.singleTarget;
      const s = this.state[id];
      merge(s, left.x, left.y);
      // the big jump button is jumpB's element in single mode
      if (jumpB.consumePressed()) s.jumpPressed = true;
      s.jumpHeld = s.jumpHeld || jumpB.held;
      jumpA.consumePressed();
    } else {
      merge(this.state.a, left.x, left.y);
      merge(this.state.b, right.x, right.y);
      if (jumpA.consumePressed()) this.state.a.jumpPressed = true;
      if (jumpB.consumePressed()) this.state.b.jumpPressed = true;
      this.state.a.jumpHeld = this.state.a.jumpHeld || jumpA.held;
      this.state.b.jumpHeld = this.state.b.jumpHeld || jumpB.held;
    }
  }

  /** Jump presses are consumed by the first physics step that sees them. */
  consumeJumps() {
    this.state.a.jumpPressed = false;
    this.state.b.jumpPressed = false;
  }
}

function merge(s, x, y) {
  if (Math.hypot(x, y) > Math.hypot(s.x, s.y)) {
    s.x = x;
    s.y = y;
  }
}
