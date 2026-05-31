(function (global) {
  'use strict';

  var DEG = Math.PI / 180;
  var INSTANCES = new WeakMap();
  var LOOP_FRAMES = 240;
  var FIT_PADDING = 1.06;
  var PULSE_BIG = 1.12;
  var PULSE_TR = 1.15;
  var PULSE_SMALL = 1.14;
  var WOBBLE_DEG = 0.9;
  var SIZE_SCALE = 2;
  var SCREEN_OFFSET_X = 2;
  var SCREEN_OFFSET_Y = 2;

  function vec(x, y) { return { x: x, y: y }; }
  function vecCopy(v) { return vec(v.x, v.y); }
  function vecLerp(a, b, t) { return vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); }
  function vecAdd(a, b) { return vec(a.x + b.x, a.y + b.y); }
  function vecSub(a, b) { return vec(a.x - b.x, a.y - b.y); }
  function vecMult(v, s) { return vec(v.x * s, v.y * s); }
  function vecMag(v) { return Math.hypot(v.x, v.y); }
  function vecNormalize(v) {
    var m = vecMag(v);
    if (!m) return vec(0, 0);
    return vec(v.x / m, v.y / m);
  }

  var BL_HOME = vec(-5, 5);
  var TR_HOME = vec(65, -55);
  var TL_HOME = vec(-55, -45);
  var BR_HOME = vec(60, 40);
  var TR_TEMP_OFFSET = vecSub(BL_HOME, TR_HOME);

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function mapRange(v, a, b, c, d) { return c + ((v - a) / (b - a)) * (d - c); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeInOutQuint(x) { return x < 0.5 ? 16 * x * x * x * x * x : 1 - Math.pow(-2 * x + 2, 5) / 2; }
  function easeInOutCubic(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function colorMorphFactor(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }
  function sinDeg(d) { return Math.sin(d * DEG); }
  function cosDeg(d) { return Math.cos(d * DEG); }

  function lerpColor(c1, c2, t) {
    return 'rgb(' +
      Math.round(lerp(c1.r, c2.r, t)) + ',' +
      Math.round(lerp(c1.g, c2.g, t)) + ',' +
      Math.round(lerp(c1.b, c2.b, t)) + ')';
  }

  function computeFrameState(frameInLoop) {
    var progress = frameInLoop / LOOP_FRAMES;
    var bigPos = vecCopy(BL_HOME);
    var bigAngle = 0;
    var followOffset = vec(0, 0);
    var tlRhythmScale = 1;
    var colorMorphAmt = 0;
    var tlPos = vecCopy(TL_HOME);
    var brPos = vecCopy(BR_HOME);
    var trPos = vecCopy(TR_HOME);
    var trActiveScale = 1;
    var t;
    var eased;
    var trTarget;
    var trStart;

    if (progress < 0.25) {
      t = mapRange(progress, 0, 0.25, 0, 1);
      eased = easeInOutQuint(t);
      bigPos = vecLerp(BL_HOME, TR_HOME, eased);
      bigAngle = eased * 180;
      followOffset = vecSub(bigPos, BL_HOME);
      trTarget = vecAdd(TR_HOME, TR_TEMP_OFFSET);
      trPos = vecLerp(TR_HOME, trTarget, eased);
      trActiveScale = mapRange(cosDeg(eased * 360), -1, 1, 0, 1);
      colorMorphAmt = eased;
    } else if (progress < 0.5) {
      t = mapRange(progress, 0.25, 0.5, 0, 1);
      bigPos = vecCopy(TR_HOME);
      bigAngle = 180;
      followOffset = vecSub(TR_HOME, BL_HOME);
      trPos = vecAdd(TR_HOME, TR_TEMP_OFFSET);
      trActiveScale = 1;
      if (t < 0.5) tlRhythmScale = mapRange(easeInOutCubic(t * 2), 0, 1, 1, 0.25);
      else tlRhythmScale = mapRange(easeInOutCubic((t - 0.5) * 2), 0, 1, 0.25, 1);
      colorMorphAmt = 1;
    } else if (progress < 0.75) {
      t = mapRange(progress, 0.5, 0.75, 0, 1);
      eased = easeInOutCubic(t);
      bigPos = vecLerp(TR_HOME, BL_HOME, eased);
      bigAngle = 180 + eased * 180;
      followOffset = vecSub(bigPos, BL_HOME);
      trStart = vecAdd(TR_HOME, TR_TEMP_OFFSET);
      trPos = vecLerp(trStart, TR_HOME, eased);
      trActiveScale = mapRange(cosDeg(eased * 360), -1, 1, 0, 1);
      colorMorphAmt = mapRange(eased, 0, 1, 1, 0);
    }

    tlPos = vecAdd(TL_HOME, followOffset);
    brPos = vecAdd(BR_HOME, followOffset);

    return {
      bigPos: bigPos,
      bigAngle: bigAngle,
      tlPos: tlPos,
      brPos: brPos,
      trPos: trPos,
      trActiveScale: trActiveScale,
      tlRhythmScale: tlRhythmScale,
      colorMorphAmt: colorMorphAmt
    };
  }

  function expandBounds(minX, minY, maxX, maxY, x, y, radius) {
    if (x - radius < minX) minX = x - radius;
    if (y - radius < minY) minY = y - radius;
    if (x + radius > maxX) maxX = x + radius;
    if (y + radius > maxY) maxY = y + radius;
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  function computeMotionEnvelope() {
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    var frame;
    var state;
    var bounds;
    var toSmall;
    var pushAmount;
    var tlFinal;
    var brFinal;
    var tlRadius;
    var brRadius;

    for (frame = 0; frame < LOOP_FRAMES; frame += 1) {
      state = computeFrameState(frame);
      bounds = expandBounds(minX, minY, maxX, maxY, state.bigPos.x, state.bigPos.y, 75 * PULSE_BIG);
      minX = bounds.minX;
      minY = bounds.minY;
      maxX = bounds.maxX;
      maxY = bounds.maxY;

      bounds = expandBounds(minX, minY, maxX, maxY, state.trPos.x, state.trPos.y, 32 * PULSE_TR * state.trActiveScale);
      minX = bounds.minX;
      minY = bounds.minY;
      maxX = bounds.maxX;
      maxY = bounds.maxY;

      toSmall = vecSub(state.tlPos, state.bigPos);
      pushAmount = 28;
      tlFinal = vecAdd(state.tlPos, vecMult(vecNormalize(toSmall), pushAmount));
      tlRadius = 18 * PULSE_SMALL * 0.3 * state.tlRhythmScale;
      bounds = expandBounds(minX, minY, maxX, maxY, tlFinal.x, tlFinal.y, tlRadius);
      minX = bounds.minX;
      minY = bounds.minY;
      maxX = bounds.maxX;
      maxY = bounds.maxY;

      toSmall = vecSub(state.brPos, state.bigPos);
      brFinal = vecAdd(state.brPos, vecMult(vecNormalize(toSmall), pushAmount));
      brRadius = 22 * PULSE_SMALL * 0.3;
      bounds = expandBounds(minX, minY, maxX, maxY, brFinal.x, brFinal.y, brRadius);
      minX = bounds.minX;
      minY = bounds.minY;
      maxX = bounds.maxX;
      maxY = bounds.maxY;
    }

    return {
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
      radius: Math.max(maxX - minX, maxY - minY) / 2 * FIT_PADDING
    };
  }

  var MOTION_ENVELOPE = computeMotionEnvelope();

  function computeViewportLayout(canvasSize) {
    var clipRadius = Math.max(1, canvasSize / 2);
    return {
      fitScale: (clipRadius / MOTION_ENVELOPE.radius) * SIZE_SCALE,
      offsetX: -MOTION_ENVELOPE.centerX,
      offsetY: -MOTION_ENVELOPE.centerY
    };
  }

  function drawDenseMorphSparkle(ctx, size, morph) {
    var steps = 20;
    var i;
    var t;
    var starX;
    var starY;
    var angle;
    var circX;
    var circY;

    ctx.beginPath();
    for (i = 0; i <= steps; i += 1) {
      t = i / steps;
      starX = size * (t * t);
      starY = -size * ((1 - t) * (1 - t));
      angle = t * 90;
      circX = size * sinDeg(angle);
      circY = -size * cosDeg(angle);
      if (i === 0) ctx.moveTo(lerp(starX, circX, morph), lerp(starY, circY, morph));
      else ctx.lineTo(lerp(starX, circX, morph), lerp(starY, circY, morph));
    }
    for (i = 0; i <= steps; i += 1) {
      t = i / steps;
      starX = size * ((1 - t) * (1 - t));
      starY = size * (t * t);
      angle = 90 + t * 90;
      circX = size * sinDeg(angle);
      circY = -size * cosDeg(angle);
      ctx.lineTo(lerp(starX, circX, morph), lerp(starY, circY, morph));
    }
    for (i = 0; i <= steps; i += 1) {
      t = i / steps;
      starX = -size * (t * t);
      starY = size * ((1 - t) * (1 - t));
      angle = 180 + t * 90;
      circX = size * sinDeg(angle);
      circY = -size * cosDeg(angle);
      ctx.lineTo(lerp(starX, circX, morph), lerp(starY, circY, morph));
    }
    for (i = 0; i <= steps; i += 1) {
      t = i / steps;
      starX = -size * ((1 - t) * (1 - t));
      starY = -size * (t * t);
      angle = 270 + t * 90;
      circX = size * sinDeg(angle);
      circY = -size * cosDeg(angle);
      ctx.lineTo(lerp(starX, circX, morph), lerp(starY, circY, morph));
    }
    ctx.closePath();
    ctx.fill();
  }

  function Test1GalaxyAiLogo(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.frame = 0;
    this.raf = null;
    this.fitScale = 0.1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.colorBiggestHome = { r: 255, g: 255, b: 255 };
    this.colorBiggestTarget = { r: 0, g: 114, b: 245 };
    this.reactiveStars = [
      { id: 'TL', size: 18, pulsePhase: 45, pulseSpeed: 4.5, currentBlast: 0, col: { r: 225, g: 243, b: 255 } },
      { id: 'BR', size: 22, pulsePhase: 90, pulseSpeed: 3.5, currentBlast: 0, col: { r: 165, g: 222, b: 255 } }
    ];
  }

  Test1GalaxyAiLogo.prototype.draw = function () {
    var ctx = this.ctx;
    var w = this.canvas.width / (this.dpr || 1);
    var h = this.canvas.height / (this.dpr || 1);
    var cx = w / 2;
    var cy = h / 2;
    var clipR = Math.min(w, h) / 2;
    var frameInLoop = this.frame % LOOP_FRAMES;
    var state = computeFrameState(frameInLoop);
    var bigPos = state.bigPos;
    var bigAngle = state.bigAngle;
    var tlPos = state.tlPos;
    var brPos = state.brPos;
    var trPos = state.trPos;
    var trActiveScale = state.trActiveScale;
    var tlRhythmScale = state.tlRhythmScale;
    var colorMorphAmt = state.colorMorphAmt;
    var pulseBig;
    var pulseTR;
    var toSmall;
    var angleToSmall;
    var currentBigAngleNormalized;
    var angleDiff;
    var targetBlast;
    var pushAmount;
    var basePos;
    var finalPos;
    var dynamicScale;
    var smallPulse;
    var finalTRScale;
    var currentBigColor;
    var self = this;

    ctx.setTransform(this.dpr || 1, 0, 0, this.dpr || 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, clipR, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx + SCREEN_OFFSET_X, cy + SCREEN_OFFSET_Y);
    ctx.scale(this.fitScale, this.fitScale);
    ctx.translate(this.offsetX, this.offsetY);
    ctx.rotate(sinDeg(this.frame * 0.5) * WOBBLE_DEG * DEG);

    pulseBig = 1 + sinDeg(this.frame * 4) * 0.12;
    pulseTR = 1 + sinDeg(this.frame * 5 + 135) * 0.15;

    ctx.save();
    ctx.translate(bigPos.x, bigPos.y);
    ctx.rotate(bigAngle * DEG);
    ctx.scale(pulseBig, pulseBig);
    currentBigColor = lerpColor(this.colorBiggestHome, this.colorBiggestTarget, colorMorphFactor(colorMorphAmt));
    ctx.fillStyle = currentBigColor;
    drawDenseMorphSparkle(ctx, 75, 0);
    ctx.restore();

    this.reactiveStars.forEach(function (star) {
      ctx.save();
      toSmall = vecSub(tlPos, bigPos);
      if (star.id === 'BR') toSmall = vecSub(brPos, bigPos);
      angleToSmall = Math.atan2(toSmall.y, toSmall.x) / DEG;
      if (angleToSmall < 0) angleToSmall += 360;
      currentBigAngleNormalized = ((bigAngle % 360) + 360) % 360;
      angleDiff = Math.abs((angleToSmall - currentBigAngleNormalized) % 90);
      if (angleDiff > 45) angleDiff = 90 - angleDiff;
      targetBlast = clamp(mapRange(angleDiff, 0, 32, 1, 0), 0, 1);
      star.currentBlast = lerp(star.currentBlast, targetBlast, 0.08);
      dynamicScale = mapRange(star.currentBlast, 0, 1, 1, 0.3);
      pushAmount = star.currentBlast * 28;
      basePos = star.id === 'TL' ? tlPos : brPos;
      finalPos = vecAdd(basePos, vecMult(vecNormalize(toSmall), pushAmount));
      ctx.translate(finalPos.x, finalPos.y);
      smallPulse = 1 + sinDeg(self.frame * star.pulseSpeed + star.pulsePhase) * 0.14;
      if (star.id === 'TL') {
        ctx.scale(smallPulse * dynamicScale * tlRhythmScale, smallPulse * dynamicScale * tlRhythmScale);
      } else {
        ctx.scale(smallPulse * dynamicScale, smallPulse * dynamicScale);
      }
      ctx.fillStyle = 'rgb(' + star.col.r + ',' + star.col.g + ',' + star.col.b + ')';
      drawDenseMorphSparkle(ctx, star.size, 0);
      ctx.restore();
    });

    ctx.save();
    ctx.fillStyle = 'rgb(100,190,255)';
    ctx.translate(trPos.x, trPos.y);
    finalTRScale = pulseTR * trActiveScale;
    ctx.scale(finalTRScale, finalTRScale);
    drawDenseMorphSparkle(ctx, 32, 0);
    ctx.restore();

    ctx.restore();
  };

  Test1GalaxyAiLogo.prototype.start = function () {
    if (this.raf) return;
    var self = this;
    function loop() {
      self.frame += 1;
      self.draw();
      self.raf = global.requestAnimationFrame(loop);
    }
    self.raf = global.requestAnimationFrame(loop);
  };

  Test1GalaxyAiLogo.prototype.stop = function () {
    if (this.raf) {
      global.cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  };

  function syncHostToPinkCircle(pillRoot, host) {
    var pillEl = pillRoot.querySelector('.test1-bottom-pill') || pillRoot;
    var iconCircle = pillRoot.querySelector('.test1-bottom-pill__icon');
    if (!iconCircle || !host || !pillEl) return 0;
    var pillRect = pillEl.getBoundingClientRect();
    var circleRect = iconCircle.getBoundingClientRect();
    if (!circleRect.width || !circleRect.height) return 0;
    host.style.left = (circleRect.left - pillRect.left) + 'px';
    host.style.top = (circleRect.top - pillRect.top) + 'px';
    host.style.width = circleRect.width + 'px';
    host.style.height = circleRect.height + 'px';
    return Math.max(circleRect.width, circleRect.height);
  }

  function mount(root) {
    if (!root) return null;
    var pillEl = root.querySelector('.test1-bottom-pill') || root;
    var host = pillEl.querySelector('.test1-bottom-pill__ai-logo-host');
    var canvas = pillEl.querySelector('.test1-bottom-pill__ai-logo');
    if (!host || !canvas) return null;
    var existing = INSTANCES.get(canvas);
    if (existing) {
      existing.stop();
      INSTANCES.delete(canvas);
    }

    function setup() {
      var size = syncHostToPinkCircle(root, host);
      if (!size) {
        var hostRect = host.getBoundingClientRect();
        size = Math.max(hostRect.width, hostRect.height);
      }
      size = Math.max(1, Math.round(size));
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      var layout = computeViewportLayout(size);
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      var inst = new Test1GalaxyAiLogo(canvas);
      inst.dpr = dpr;
      inst.fitScale = layout.fitScale;
      inst.offsetX = layout.offsetX;
      inst.offsetY = layout.offsetY;
      inst.start();
      INSTANCES.set(canvas, inst);
      return inst;
    }

    if (root.querySelector('.test1-bottom-pill__icon')) {
      return setup();
    }

    var instRef = null;
    global.requestAnimationFrame(function () {
      global.requestAnimationFrame(function () {
        instRef = setup();
      });
    });
    return instRef;
  }

  function unmount(root) {
    if (!root) return;
    var canvas = root.querySelector('.test1-bottom-pill__ai-logo');
    if (!canvas) return;
    var inst = INSTANCES.get(canvas);
    if (inst) {
      inst.stop();
      INSTANCES.delete(canvas);
    }
  }

  global.__test1GalaxyAiLogo = {
    mount: mount,
    unmount: unmount
  };
})(typeof window !== 'undefined' ? window : this);
