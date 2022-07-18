import Color from "./Color.js";
import Trigger from "./Trigger.js";
import Sound, { EffectChain, AudioEffectMap } from "./Sound.js";

import { effectNames } from "./renderer/effectInfo.js";
// This is a wrapper to allow the enabled effects in a sprite to be used as a Map key.
// By setting an effect, the bitmask is updated as well.
// This allows the bitmask to be used to uniquely identify a set of enabled effects.
class _EffectMap {
  constructor() {
    this._bitmask = 0;
    this._effectValues = {};

    for (let i = 0; i < effectNames.length; i++) {
      const effectName = effectNames[i];
      this._effectValues[effectName] = 0;

      Object.defineProperty(this, effectName, {
        get: () => {
          return this._effectValues[effectName];
        },

        set: val => {
          this._effectValues[effectName] = val;

          if (val === 0) {
            // If the effect value is 0, meaning it's disabled, set its bit in the bitmask to 0.
            this._bitmask = this._bitmask & ~(1 << i);
          } else {
            // Otherwise, set its bit to 1.
            this._bitmask = this._bitmask | (1 << i);
          }
        }
      });
    }
  }

  _clone() {
    const m = new _EffectMap();
    for (const effectName of Object.keys(this._effectValues)) {
      m[effectName] = this[effectName];
    }
    return m;
  }

  clear() {
    for (const effectName of Object.keys(this._effectValues)) {
      this._effectValues[effectName] = 0;
    }
    this._bitmask = 0;
  }
}

class SpriteBase {
  constructor(initialConditions, vars = {}) {
    this._project = null;

    const { costumeNumber, layerOrder = 0 } = initialConditions;
    this._costumeNumber = costumeNumber;
    this._layerOrder = layerOrder;

    this.triggers = [];
    this.watchers = {};
    this.costumes = [];
    this.sounds = [];

    this.effectChain = new EffectChain({
      getNonPatchSoundList: this.getSoundsPlayedByMe.bind(this)
    });
    this.effectChain.connect(Sound.audioContext.destination);

    this.effects = new _EffectMap();
    this.audioEffects = new AudioEffectMap(this.effectChain);

    this._vars = vars;
  }

  getSoundsPlayedByMe() {
    return this.sounds.filter(sound => this.effectChain.isTargetOf(sound));
  }

  get stage() {
    return this._project.stage;
  }

  get sprites() {
    return this._project.sprites;
  }

  get vars() {
    return this._vars;
  }

  get costumeNumber() {
    return this._costumeNumber;
  }

  set costumeNumber(number) {
    this._costumeNumber = this.wrapClamp(number, 1, this.costumes.length);
    if (this.fireBackdropChanged) this.fireBackdropChanged();
  }

  set costume(costume) {
    if (typeof costume === "number") {
      this.costumeNumber = costume;
    }
    if (typeof costume === "string") {
      const index = this.costumes.findIndex(c => c.name === costume);
      if (index > -1) {
        this.costumeNumber = index + 1;
      } else {
        switch (costume) {
          case "next costume":
          case "next backdrop": {
            this.costumeNumber = this.costumeNumber + 1;
            break;
          }

          case "previous costume":
          case "previous backdrop": {
            this.costumeNumber = this.costumeNumber - 1;
            break;
          }

          case "random costume":
          case "random backdrop": {
            // Based on joker314's inclusiveRandIntWithout: https://github.com/LLK/scratch-vm/pull/2011
            // Note: We use 1 -> length instead of 0 -> length-1, since we want a 1-indexed result.
            const lower = 1;
            const upper = this.costumes.length;
            const excluded = this.costumeNumber;

            const possibleOptions = upper - lower;
            let randInt = lower + Math.floor(Math.random() * possibleOptions);
            if (randInt >= excluded) {
              randInt++;
            }

            this.costumeNumber = randInt;
            break;
          }

          default: {
            if (!(isNaN(costume) || costume.trim().length === 0)) {
              this.costumeNumber = Number(costume);
            }
          }
        }
      }
    }
  }

  get costume() {
    return this.costumes[this.costumeNumber - 1];
  }

  moveAhead(value = Infinity) {
    if (typeof value === "number") {
      this._project.changeSpriteLayer(this, value);
    } else {
      this._project.changeSpriteLayer(this, 1, value);
    }
  }

  moveBehind(value = Infinity) {
    if (typeof value === "number") {
      this._project.changeSpriteLayer(this, -value);
    } else {
      this._project.changeSpriteLayer(this, -1, value);
    }
  }

  degToRad(deg) {
    return (deg * Math.PI) / 180;
  }

  radToDeg(rad) {
    return (rad * 180) / Math.PI;
  }

  degToScratch(deg) {
    return -deg + 90;
  }

  scratchToDeg(scratchDir) {
    return -scratchDir + 90;
  }

  radToScratch(rad) {
    return this.degToScratch(this.radToDeg(rad));
  }

  scratchToRad(scratchDir) {
    return this.degToRad(this.scratchToDeg(scratchDir));
  }

  // From scratch-vm's math-util.
  scratchTan(angle) {
    angle = angle % 360;
    switch (angle) {
      case -270:
      case 90:
        return Infinity;
      case -90:
      case 270:
        return -Infinity;
      default:
        return parseFloat(Math.tan((Math.PI * angle) / 180).toFixed(10));
    }
  }

  // Wrap rotation from -180 to 180.
  normalizeDeg(deg) {
    // This is a pretty big math expression, but it's necessary because in JavaScript,
    // the % operator means "remainder", not "modulo", and so negative numbers won't "wrap around".
    // See https://web.archive.org/web/20090717035140if_/javascript.about.com/od/problemsolving/a/modulobug.htm
    return ((((deg + 180) % 360) + 360) % 360) - 180;
  }

  // Keep a number between two limits, wrapping "extra" into the range.
  // wrapClamp(7, 1, 5) == 2
  // wrapClamp(0, 1, 5) == 5
  // wrapClamp(-11, -10, 6) == 6
  // Borrowed from scratch-vm (src/util/math-util.js)
  wrapClamp(n, min, max) {
    const range = (max - min) + 1;
    return n - (Math.floor((n - min) / range) * range);
  }

  // Given a generator function, return a version of it that runs in "warp mode" (no yields).
  warp(procedure) {
    const bound = procedure.bind(this);
    return (...args) => {
      const inst = bound(...args);
      while (!inst.next().done);
    };
  }

  random(a, b) {
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    if (min % 1 === 0 && max % 1 === 0) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    return Math.random() * (max - min) + min;
  }

  *wait(secs) {
    let endTime = new Date();
    endTime.setMilliseconds(endTime.getMilliseconds() + secs * 1000);
    while (new Date() < endTime) {
      yield;
    }
  }

  get mouse() {
    return this._project.input.mouse;
  }

  keyPressed(name) {
    return this._project.input.keyPressed(name);
  }

  get timer() {
    return this._project.timer;
  }

  restartTimer() {
    this._project.restartTimer();
  }

  *startSound(soundName) {
    const sound = this.getSound(soundName);
    if (sound) {
      this.effectChain.applyToSound(sound);
      yield* sound.start();
    }
  }

  *playSoundUntilDone(soundName) {
    const sound = this.getSound(soundName);
    if (sound) {
      sound.connect(this.effectChain.inputNode);
      this.effectChain.applyToSound(sound);
      yield* sound.playUntilDone();
    }
  }

  getSound(soundName) {
    if (typeof soundName === "number") {
      return this.sounds[(soundName - 1) % this.sounds.length];
    } else {
      return this.sounds.find(s => s.name === soundName);
    }
  }

  stopAllSounds() {
    this._project.stopAllSounds();
  }

  stopAllOfMySounds() {
    for (const sound of this.sounds) {
      sound.stop();
    }
  }

  broadcast(name) {
    return this._project.fireTrigger(Trigger.BROADCAST, { name });
  }

  *broadcastAndWait(name) {
    let running = true;
    this.broadcast(name).then(() => {
      running = false;
    });

    while (running) {
      yield;
    }
  }

  clearPen() {
    this._project.renderer.clearPen();
  }

  *askAndWait(question) {
    if (this._speechBubble) {
      this.say("");
    }

    let done = false;
    this._project.askAndWait(question).then(() => {
      done = true;
    });

    while (!done) yield;
  }

  get answer() {
    return this._project.answer;
  }

  get loudness() {
    return this._project.loudness;
  }

  toNumber(value) {
    if (typeof value === 'number') {
      if (isNaN(value)) {
        return 0;
      }
      return value;
    }

    const n = Number(value);
    if (Number.isNaN(n)) {
      return 0;
    }
    return n;
  }

  toBoolean(value) {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      if (value === '' || value === '0' || value.toLowerCase() === 'false') {
        return false;
      }
      return true;
    }

    return Boolean(value);
  }

  toString(value) {
    return String(value);
  }

  stringIncludes(string, substring) {
    return string.toLowerCase().includes(substring.toLowerCase());
  }

  arrayIncludes(array, value) {
    return array.some(item => this.compare(item, value) === 0);
  }

  letterOf(string, index) {
    if (index < 0 || index >= string.length) {
      return "";
    }
    return string[index];
  }

  itemOf(array, index) {
    if (index < 0 || index >= array.length) {
      return "";
    }
    return array[index];
  }

  indexInArray(array, value) {
    return array.findIndex(item => this.compare(item, value) === 0);
  }

  compare(v1, v2) {
    if (v1 === v2) {
      return 0;
    }

    let n1 = Number(v1);
    let n2 = Number(v2);
    if (
      (n1 === Infinity && n2 === Infinity) ||
      (n1 === -Infinity && n2 === -Infinity)
    ) {
      return 0;
    }

    if (n1 === 0 && (v1 === null || typeof v1 === 'string' && v1.trim().length === 0)) {
      n1 = NaN;
    } else if (n2 === 0 && (v2 === null || typeof v2 === 'string' && v2.trim().length === 0)) {
      n2 = NaN;
    }

    if (!isNaN(n1) && !isNaN(n2)) {
      return n1 - n2;
    }

    const s1 = String(v1).toLowerCase();
    const s2 = String(v2).toLowerCase();

    if (s1 === s2) {
      return 0;
    } else if (s1 < s2) {
      return -1;
    } else {
      return 1;
    }
  }
}

export class Sprite extends SpriteBase {
  constructor(initialConditions, ...args) {
    super(initialConditions, ...args);

    const {
      x,
      y,
      direction,
      rotationStyle,
      costumeNumber,
      size,
      visible,
      penDown,
      penSize,
      penColor
    } = initialConditions;

    this._x = x;
    this._y = y;
    this._direction = direction;
    this.rotationStyle = rotationStyle || Sprite.RotationStyle.ALL_AROUND;
    this._costumeNumber = costumeNumber;
    this.size = size;
    this.visible = visible;

    this.parent = null;
    this.clones = [];

    this._penDown = penDown || false;
    this.penSize = penSize || 1;
    this._penColor = penColor || Color.rgb(0, 0, 255);

    this._speechBubble = {
      text: "",
      style: "say",
      timeout: null
    };
  }

  createClone() {
    const clone = Object.assign(
      Object.create(Object.getPrototypeOf(this)),
      this
    );

    clone._project = this._project;
    clone.triggers = this.triggers.map(
      trigger => new Trigger(trigger.trigger, trigger.options, trigger._script)
    );
    clone.costumes = this.costumes;
    clone.sounds = this.sounds;
    clone._vars = Object.assign({}, this._vars);

    clone._speechBubble = {
      text: "",
      style: "say",
      timeout: null
    };

    clone.effects = this.effects._clone();

    // Clones inherit audio effects from the original sprite, for some reason.
    // Couldn't explain it, but that's the behavior in Scratch 3.0.
    let original = this;
    while (original.parent) {
      original = original.parent;
    }
    clone.effectChain = original.effectChain.clone({
      getNonPatchSoundList: clone.getSoundsPlayedByMe.bind(clone)
    });

    // Make a new audioEffects interface which acts on the cloned effect chain.
    clone.audioEffects = new AudioEffectMap(clone.effectChain);

    clone.clones = [];
    clone.parent = this;
    this.clones.push(clone);

    // Trigger CLONE_START:
    const triggers = clone.triggers.filter(tr =>
      tr.matches(Trigger.CLONE_START, {}, clone)
    );
    this._project._startTriggers(
      triggers.map(trigger => ({ trigger, target: clone }))
    );
  }

  deleteThisClone() {
    if (this.parent === null) return;

    this.parent.clones = this.parent.clones.filter(clone => clone !== this);

    this._project.runningTriggers = this._project.runningTriggers.filter(
      ({ target }) => target !== this
    );
  }

  andClones() {
    return [this, ...this.clones.flatMap(clone => clone.andClones())];
  }

  get direction() {
    return this._direction;
  }

  set direction(dir) {
    this._direction = this.normalizeDeg(dir);
  }

  goto(x, y) {
    if (x === this.x && y === this.y) return;

    if (this.penDown) {
      this._project.renderer.penLine(
        { x: this._x, y: this._y },
        { x, y },
        this._penColor,
        this.penSize
      );
    }

    this._x = x;
    this._y = y;
  }

  get x() {
    return this._x;
  }

  set x(x) {
    this.goto(x, this._y);
  }

  get y() {
    return this._y;
  }

  set y(y) {
    this.goto(this._x, y);
  }

  move(dist) {
    const moveDir = this.scratchToRad(this.direction);

    this.goto(
      this._x + dist * Math.cos(moveDir),
      this._y + dist * Math.sin(moveDir)
    );
  }

  *glide(seconds, x, y) {
    const interpolate = (a, b, t) => a + (b - a) * t;

    const startTime = new Date();
    const startX = this._x;
    const startY = this._y;

    let t;
    do {
      t = (new Date() - startTime) / (seconds * 1000);
      this.goto(interpolate(startX, x, t), interpolate(startY, y, t));
      yield;
    } while (t < 1);
  }

  ifOnEdgeBounce() {
    const nearestEdge = this.nearestEdge();
    if (!nearestEdge) return;
    const rad = this.scratchToRad(this.direction);
    let dx = Math.cos(rad);
    let dy = Math.sin(rad);
    switch (nearestEdge) {
      case Sprite.Edge.LEFT:
        dx = Math.max(0.2, Math.abs(dx));
        break;
      case Sprite.Edge.RIGHT:
        dx = -Math.max(0.2, Math.abs(dx));
        break;
      case Sprite.Edge.TOP:
        dy = -Math.max(0.2, Math.abs(dy));
        break;
      case Sprite.Edge.BOTTOM:
        dy = Math.max(0.2, Math.abs(dy));
        break;
    }
    this.direction = this.radToScratch(Math.atan2(dy, dx));
    const { x, y } = this.keepInFence(this.x, this.y);
    this.goto(x, y);
  }

  keepInFence(newX, newY) {
    // https://github.com/LLK/scratch-vm/blob/develop/src/sprites/rendered-target.js#L949
    const fence = this.stage.fence;
    const bounds = this._project.renderer.getBoundingBox(this);
    bounds.left += newX - this.x;
    bounds.right += newX - this.x;
    bounds.top += newY - this.y;
    bounds.bottom += newY - this.y;

    let dx = 0,
      dy = 0;
    if (bounds.left < fence.left) {
      dx += fence.left - bounds.left;
    }
    if (bounds.right > fence.right) {
      dx += fence.right - bounds.right;
    }
    if (bounds.top > fence.top) {
      dy += fence.top - bounds.top;
    }
    if (bounds.bottom < fence.bottom) {
      dy += fence.bottom - bounds.bottom;
    }
    return {
      x: newX + dx,
      y: newY + dy
    };
  }

  get penDown() {
    return this._penDown;
  }

  set penDown(penDown) {
    if (penDown) {
      this._project.renderer.penLine(
        { x: this.x, y: this.y },
        { x: this.x, y: this.y },
        this._penColor,
        this.penSize
      );
    }
    this._penDown = penDown;
  }

  get penColor() {
    return this._penColor;
  }

  set penColor(color) {
    if (color instanceof Color) {
      this._penColor = color;
    } else {
      console.error(
        `${color} is not a valid penColor. Try using the Color class!`
      );
    }
  }

  stamp() {
    this._project.renderer.stamp(this);
  }

  touching(target, fast = false) {
    if (typeof target === "string") {
      switch (target) {
        case "mouse":
          return this._project.renderer.checkPointCollision(
            this,
            {
              x: this.mouse.x,
              y: this.mouse.y
            },
            fast
          );
        case "edge": {
          const bounds = this._project.renderer.getTightBoundingBox(this);
          const stageWidth = this.stage.width;
          const stageHeight = this.stage.height;
          return (
            bounds.left < -stageWidth / 2 ||
            bounds.right > stageWidth / 2 ||
            bounds.top > stageHeight / 2 ||
            bounds.bottom < -stageHeight / 2
          );
        }
        default:
          console.error(
            `Cannot find target "${target}" in "touching". Did you mean to pass a sprite class instead?`
          );
          return false;
      }
    } else if (target instanceof Color) {
      return this._project.renderer.checkColorCollision(this, target);
    }

    return this._project.renderer.checkSpriteCollision(this, target, fast);
  }

  colorTouching(color, target) {
    if (typeof target === "string") {
      console.error(
        `Cannot find target "${target}" in "touchingColor". Did you mean to pass a sprite class instead?`
      );
      return false;
    }

    if (typeof color === "string") {
      console.error(
        `Cannot find color "${color}" in "touchingColor". Did you mean to pass a Color instance instead?`
      );
      return false;
    }

    if (target instanceof Color) {
      // "Color is touching color"
      return this._project.renderer.checkColorCollision(this, target, color);
    } else {
      // "Color is touching sprite" (not implemented in Scratch!)
      return this._project.renderer.checkSpriteCollision(
        this,
        target,
        false,
        color
      );
    }
  }

  nearestEdge() {
    const bounds = this._project.renderer.getTightBoundingBox(this);
    const { width: stageWidth, height: stageHeight } = this.stage;
    const distLeft = Math.max(0, stageWidth / 2 + bounds.left);
    const distTop = Math.max(0, stageHeight / 2 - bounds.top);
    const distRight = Math.max(0, stageWidth / 2 - bounds.right);
    const distBottom = Math.max(0, stageHeight / 2 + bounds.bottom);
    // Find the nearest edge.
    let nearestEdge = "";
    let minDist = Infinity;
    if (distLeft < minDist) {
      minDist = distLeft;
      nearestEdge = Sprite.Edge.LEFT;
    }
    if (distTop < minDist) {
      minDist = distTop;
      nearestEdge = Sprite.Edge.TOP;
    }
    if (distRight < minDist) {
      minDist = distRight;
      nearestEdge = Sprite.Edge.RIGHT;
    }
    if (distBottom < minDist) {
      minDist = distBottom;
      nearestEdge = Sprite.Edge.BOTTOM;
    }
    if (minDist > 0) {
      nearestEdge = null;
    }
    return nearestEdge;
  }

  say(text) {
    clearTimeout(this._speechBubble.timeout);
    this._speechBubble = { text: String(text), style: "say", timeout: null };
  }

  think(text) {
    clearTimeout(this._speechBubble.timeout);
    this._speechBubble = { text: String(text), style: "think", timeout: null };
  }

  *sayAndWait(text, seconds) {
    clearTimeout(this._speechBubble.timeout);

    let done = false;
    const timeout = setTimeout(() => {
      this._speechBubble.text = "";
      this.timeout = null;
      done = true;
    }, seconds * 1000);

    this._speechBubble = { text, style: "say", timeout };
    while (!done) yield;
  }

  *thinkAndWait(text, seconds) {
    clearTimeout(this._speechBubble.timeout);

    let done = false;
    const timeout = setTimeout(() => {
      this._speechBubble.text = "";
      this.timeout = null;
      done = true;
    }, seconds * 1000);

    this._speechBubble = { text, style: "think", timeout };
    while (!done) yield;
  }
}

Sprite.RotationStyle = Object.freeze({
  ALL_AROUND: Symbol("ALL_AROUND"),
  LEFT_RIGHT: Symbol("LEFT_RIGHT"),
  DONT_ROTATE: Symbol("DONT_ROTATE")
});

Sprite.Edge = Object.freeze({
  BOTTOM: Symbol("BOTTOM"),
  LEFT: Symbol("LEFT"),
  RIGHT: Symbol("RIGHT"),
  TOP: Symbol("TOP")
});

export class Stage extends SpriteBase {
  constructor(initialConditions, ...args) {
    super(initialConditions, ...args);

    // Use defineProperties to make these non-writable.
    // Changing the width and height of the stage after initialization isn't supported.
    Object.defineProperties(this, {
      width: {
        value: initialConditions.width || 480,
        enumerable: true
      },
      height: {
        value: initialConditions.height || 360,
        enumerable: true
      }
    });

    this.fence = {
      left: -this.width / 2,
      right: this.width / 2,
      top: this.height / 2,
      bottom: -this.height / 2
    };

    this.name = "Stage";

    // For obsolete counter blocks.
    this.__counter = 0;
  }

  fireBackdropChanged() {
    return this._project.fireTrigger(Trigger.BACKDROP_CHANGED, {
      backdrop: this.costume.name
    });
  }
}
