(function () {
  'use strict';

  var MAX_DURATION = 30000;

  // --- DOM ---
  var introScreen = document.getElementById('intro-screen');
  var tapScreen = document.getElementById('tap-screen');
  var resultScreen = document.getElementById('result-screen');
  var startBtn = document.getElementById('start-btn');
  var retryBtn = document.getElementById('retry-btn');
  var doneBtn = document.getElementById('done-btn');
  var tapArea = document.getElementById('tap-area');
  var face = document.getElementById('face');
  var pulseRing = document.getElementById('pulse-ring');
  var tapCounter = document.getElementById('tap-counter');
  var gyroHint = document.getElementById('gyro-hint');
  var thinkingDiv = document.getElementById('thinking');
  var resultCard = document.getElementById('result-card');
  var resultEmoji = document.getElementById('result-emoji');
  var resultEmotion = document.getElementById('result-emotion');
  var resultDescription = document.getElementById('result-description');
  var adviceList = document.getElementById('advice-list');
  var resultStats = document.getElementById('result-stats');
  var mouth = document.getElementById('mouth');
  var trailCanvas = document.getElementById('trail-canvas');
  var ctx = trailCanvas.getContext('2d');

  // --- State ---
  var sessionActive = false;
  var sessionStart = 0;
  var taps = [];
  var motionSamples = [];
  var orientationSamples = [];
  var gyroAvailable = false;
  var autoEndTimer = null;
  var isDown = false;
  var lastPoint = null;
  var trailPoints = []; // {x, y, t, age}
  var animFrameId = null;
  var trailHue = 45; // start golden

  // --- Telegram WebApp ---
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  // --- Canvas sizing ---
  function resizeCanvas() {
    trailCanvas.width = trailCanvas.offsetWidth * (window.devicePixelRatio || 1);
    trailCanvas.height = trailCanvas.offsetHeight * (window.devicePixelRatio || 1);
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  }

  // --- Trail rendering ---
  function renderTrail() {
    if (!sessionActive) return;

    var now = Date.now();
    ctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);

    // Remove old points (fade after 1.5s)
    var fadeTime = 1500;
    trailPoints = trailPoints.filter(function (p) {
      return now - p.t < fadeTime;
    });

    if (trailPoints.length < 2) {
      animFrameId = requestAnimationFrame(renderTrail);
      return;
    }

    // Draw trail segments
    for (var i = 1; i < trailPoints.length; i++) {
      var prev = trailPoints[i - 1];
      var curr = trailPoints[i];

      // Skip if from different strokes
      if (curr.stroke !== prev.stroke) continue;

      var age = now - curr.t;
      var alpha = Math.max(0, 1 - age / fadeTime);
      var lineWidth = Math.max(2, 8 * alpha);

      // Shift hue along the trail
      var hue = (trailHue + i * 0.5) % 360;

      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(curr.x, curr.y);
      ctx.strokeStyle = 'hsla(' + hue + ', 100%, 65%, ' + alpha + ')';
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Glow effect
      if (alpha > 0.3) {
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(curr.x, curr.y);
        ctx.strokeStyle = 'hsla(' + hue + ', 100%, 80%, ' + (alpha * 0.3) + ')';
        ctx.lineWidth = lineWidth + 8;
        ctx.stroke();
      }
    }

    // Draw glow dot at current finger position
    if (isDown && trailPoints.length > 0) {
      var last = trailPoints[trailPoints.length - 1];
      var dotHue = (trailHue + trailPoints.length * 0.5) % 360;
      ctx.beginPath();
      ctx.arc(last.x, last.y, 12, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + dotHue + ', 100%, 75%, 0.5)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + dotHue + ', 100%, 90%, 0.9)';
      ctx.fill();
    }

    animFrameId = requestAnimationFrame(renderTrail);
  }

  // --- Gyroscope Setup ---
  function initGyroscope() {
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission()
        .then(function (state) {
          if (state === 'granted') {
            gyroAvailable = true;
            subscribeMotion();
          }
        })
        .catch(function () {
          gyroHint.textContent = '';
        });
    } else if ('DeviceMotionEvent' in window) {
      gyroAvailable = true;
      subscribeMotion();
    }
  }

  function subscribeMotion() {
    window.addEventListener('devicemotion', onDeviceMotion);
    window.addEventListener('deviceorientation', onDeviceOrientation);
  }

  function onDeviceMotion(e) {
    if (!sessionActive) return;
    var acc = e.accelerationIncludingGravity || e.acceleration;
    if (!acc) return;
    motionSamples.push({
      x: acc.x || 0,
      y: acc.y || 0,
      z: acc.z || 0,
      t: Date.now()
    });
  }

  function onDeviceOrientation(e) {
    if (!sessionActive) return;
    orientationSamples.push({
      alpha: e.alpha || 0,
      beta: e.beta || 0,
      gamma: e.gamma || 0,
      t: Date.now()
    });
  }

  // --- Stroke counter for trail (to not connect separate strokes) ---
  var strokeId = 0;

  // --- Pointer Handling ---
  function onPointerDown(e) {
    if (!sessionActive) return;
    e.preventDefault();

    isDown = true;
    strokeId++;
    lastPoint = { x: e.clientX, y: e.clientY };

    trailPoints.push({
      x: e.clientX,
      y: e.clientY,
      t: Date.now(),
      stroke: strokeId
    });

    var now = Date.now();
    taps.push({
      time: now,
      pressure: e.pressure || 0,
      width: e.width || 0,
      height: e.height || 0,
      type: 'down'
    });

    // Visual feedback
    face.classList.add('tapped');
    pulseRing.classList.remove('animate');
    void pulseRing.offsetWidth;
    pulseRing.classList.add('animate');

    // Shift trail color on each tap
    trailHue = (trailHue + 30) % 360;

    var tapCount = taps.filter(function (t) { return t.type === 'down'; }).length;
    updateFaceMouth(tapCount);
    tapCounter.textContent = tapCount + ' ' + pluralize(tapCount, 'тап', 'тапа', 'тапов');
  }

  function onPointerMove(e) {
    if (!sessionActive || !isDown) return;
    e.preventDefault();

    trailPoints.push({
      x: e.clientX,
      y: e.clientY,
      t: Date.now(),
      stroke: strokeId
    });

    lastPoint = { x: e.clientX, y: e.clientY };
  }

  function onPointerUp(e) {
    if (!sessionActive) return;
    e.preventDefault();

    isDown = false;
    lastPoint = null;

    taps.push({
      time: Date.now(),
      pressure: e.pressure || 0,
      width: e.width || 0,
      height: e.height || 0,
      type: 'up'
    });

    face.classList.remove('tapped');
  }

  function updateFaceMouth(count) {
    var openness = Math.min(count * 3, 40);
    var y = 125 + openness * 0.1;
    var qy = 160 + openness * 0.3;
    mouth.setAttribute('d', 'M 60 ' + y + ' Q 100 ' + qy + ' 140 ' + y);
    if (openness > 20) {
      mouth.setAttribute('fill', '#333');
      mouth.setAttribute('fill-opacity', '0.15');
    }
  }

  // --- Session ---
  function startSession() {
    taps = [];
    motionSamples = [];
    orientationSamples = [];
    trailPoints = [];
    strokeId = 0;
    isDown = false;
    lastPoint = null;
    trailHue = 45;
    sessionActive = true;
    sessionStart = Date.now();

    introScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    tapScreen.classList.remove('hidden');

    resizeCanvas();
    ctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);

    tapCounter.textContent = '0 тапов';
    face.classList.remove('face-stressed', 'face-excited', 'face-calm',
                          'face-anxious', 'face-focused', 'face-sad');
    mouth.setAttribute('d', 'M 60 125 Q 100 160 140 125');
    mouth.removeAttribute('fill');
    mouth.removeAttribute('fill-opacity');

    if (!gyroAvailable) {
      gyroHint.textContent = '';
    } else {
      gyroHint.textContent = 'Гироскоп активен';
    }

    initGyroscope();

    // Auto-end after 30s
    autoEndTimer = setTimeout(function () {
      if (sessionActive) endSession();
    }, MAX_DURATION);

    // Start trail rendering loop
    animFrameId = requestAnimationFrame(renderTrail);
  }

  function endSession() {
    sessionActive = false;
    clearTimeout(autoEndTimer);
    if (animFrameId) cancelAnimationFrame(animFrameId);

    tapScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    thinkingDiv.classList.remove('hidden');
    resultCard.classList.add('hidden');

    setTimeout(function () {
      var result = analyze();
      showResult(result);
    }, 1500);
  }

  // --- Analysis ---
  function analyze() {
    var downs = taps.filter(function (t) { return t.type === 'down'; });
    var tapCount = downs.length;
    var actualDuration = (Date.now() - sessionStart) / 1000;
    var frequency = tapCount / actualDuration;

    var avgPressure = 0;
    if (tapCount > 0) {
      var sum = 0;
      for (var i = 0; i < downs.length; i++) sum += downs[i].pressure;
      avgPressure = sum / tapCount;
    }

    var avgArea = 0;
    if (tapCount > 0) {
      var areaSum = 0;
      for (var i = 0; i < downs.length; i++) {
        areaSum += (downs[i].width || 1) * (downs[i].height || 1);
      }
      avgArea = areaSum / tapCount;
    }

    var intervals = [];
    for (var i = 1; i < downs.length; i++) {
      intervals.push(downs[i].time - downs[i - 1].time);
    }
    var avgInterval = 0;
    var intervalVariance = 0;
    if (intervals.length > 0) {
      var intSum = 0;
      for (var i = 0; i < intervals.length; i++) intSum += intervals[i];
      avgInterval = intSum / intervals.length;

      var varSum = 0;
      for (var i = 0; i < intervals.length; i++) {
        varSum += Math.pow(intervals[i] - avgInterval, 2);
      }
      intervalVariance = Math.sqrt(varSum / intervals.length);
    }
    var regularity = avgInterval > 0 ? Math.max(0, 1 - intervalVariance / avgInterval) : 0;

    var avgHold = 0;
    var ups = taps.filter(function (t) { return t.type === 'up'; });
    if (downs.length > 0 && ups.length > 0) {
      var holdSum = 0;
      var holdCount = Math.min(downs.length, ups.length);
      for (var i = 0; i < holdCount; i++) {
        holdSum += ups[i].time - downs[i].time;
      }
      avgHold = holdSum / holdCount;
    }

    // Trail: total distance drawn
    var totalTrailDist = 0;
    for (var i = 1; i < trailPoints.length; i++) {
      if (trailPoints[i].stroke !== trailPoints[i - 1].stroke) continue;
      var dx = trailPoints[i].x - trailPoints[i - 1].x;
      var dy = trailPoints[i].y - trailPoints[i - 1].y;
      totalTrailDist += Math.sqrt(dx * dx + dy * dy);
    }

    var shakeIntensity = 0;
    if (motionSamples.length > 1) {
      var diffs = [];
      for (var i = 1; i < motionSamples.length; i++) {
        var mdx = motionSamples[i].x - motionSamples[i - 1].x;
        var mdy = motionSamples[i].y - motionSamples[i - 1].y;
        var mdz = motionSamples[i].z - motionSamples[i - 1].z;
        diffs.push(Math.sqrt(mdx * mdx + mdy * mdy + mdz * mdz));
      }
      var diffSum = 0;
      for (var i = 0; i < diffs.length; i++) diffSum += diffs[i];
      shakeIntensity = diffSum / diffs.length;
    }

    var tiltRange = 0;
    if (orientationSamples.length > 1) {
      var betas = orientationSamples.map(function (s) { return s.beta; });
      var gammas = orientationSamples.map(function (s) { return s.gamma; });
      var betaRange = Math.max.apply(null, betas) - Math.min.apply(null, betas);
      var gammaRange = Math.max.apply(null, gammas) - Math.min.apply(null, gammas);
      tiltRange = betaRange + gammaRange;
    }

    var intensity = 0;
    if (avgPressure > 0.1) {
      intensity = avgPressure;
    } else {
      intensity = Math.min(1, avgArea / 5000 + Math.min(avgHold / 500, 0.5));
    }

    // --- Classification ---
    var scores = {
      stressed: 0,
      excited: 0,
      calm: 0,
      anxious: 0,
      focused: 0,
      sad: 0
    };

    scores.stressed += clamp01(frequency / 5) * 0.3;
    scores.stressed += clamp01(intensity) * 0.3;
    scores.stressed += clamp01(shakeIntensity / 15) * 0.4;

    scores.excited += clamp01(frequency / 4) * 0.4;
    scores.excited += clamp01(1 - intensity) * 0.2;
    scores.excited += clamp01(regularity) * 0.2;
    scores.excited += clamp01(totalTrailDist / 3000) * 0.2;

    scores.calm += clamp01(1 - frequency / 3) * 0.4;
    scores.calm += clamp01(1 - intensity) * 0.3;
    scores.calm += clamp01(1 - shakeIntensity / 10) * 0.3;

    scores.anxious += clamp01(1 - regularity) * 0.3;
    scores.anxious += clamp01(shakeIntensity / 10) * 0.3;
    scores.anxious += (intensity > 0.3 && intensity < 0.7 ? 0.2 : 0);
    scores.anxious += clamp01(totalTrailDist / 5000) * 0.2;

    scores.focused += clamp01(1 - frequency / 4) * 0.2;
    scores.focused += clamp01(intensity) * 0.3;
    scores.focused += clamp01(1 - shakeIntensity / 10) * 0.2;
    scores.focused += clamp01(regularity) * 0.3;

    scores.sad += clamp01(1 - frequency / 2) * 0.3;
    scores.sad += clamp01(1 - intensity) * 0.2;
    scores.sad += clamp01(tiltRange / 60) * 0.2;
    scores.sad += clamp01(avgHold / 400) * 0.3;

    if (tapCount === 0) {
      scores.calm = 0.3;
      scores.sad = 0.7;
    }

    var best = 'calm';
    var bestScore = 0;
    var keys = Object.keys(scores);
    for (var i = 0; i < keys.length; i++) {
      if (scores[keys[i]] > bestScore) {
        bestScore = scores[keys[i]];
        best = keys[i];
      }
    }

    return {
      emotion: best,
      scores: scores,
      stats: {
        tapCount: tapCount,
        frequency: frequency.toFixed(1),
        avgPressure: avgPressure.toFixed(2),
        regularity: (regularity * 100).toFixed(0),
        shakeIntensity: shakeIntensity.toFixed(1),
        avgHold: avgHold.toFixed(0),
        trailDist: Math.round(totalTrailDist)
      }
    };
  }

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  // --- Results Data ---
  var emotions = {
    stressed: {
      emoji: '\uD83D\uDE24',
      title: '\u0421\u0442\u0440\u0435\u0441\u0441',
      description: '\u041F\u043E\u0445\u043E\u0436\u0435, \u0432\u043D\u0443\u0442\u0440\u0438 \u043D\u0430\u043A\u043E\u043F\u0438\u043B\u043E\u0441\u044C \u043D\u0430\u043F\u0440\u044F\u0436\u0435\u043D\u0438\u0435. \u0422\u0432\u043E\u0438 \u0442\u0430\u043F\u044B \u0431\u044B\u043B\u0438 \u0440\u0435\u0437\u043A\u0438\u043C\u0438 \u0438 \u0447\u0430\u0441\u0442\u044B\u043C\u0438 \u2014 \u0442\u0435\u043B\u043E \u0433\u043E\u0432\u043E\u0440\u0438\u0442 \u0437\u0430 \u0442\u0435\u0431\u044F.',
      advice: [
        '\uD83C\uDF2C\uFE0F \u0421\u0434\u0435\u043B\u0430\u0439 5 \u0433\u043B\u0443\u0431\u043E\u043A\u0438\u0445 \u0432\u0434\u043E\u0445\u043E\u0432: 4 \u0441\u0435\u043A \u0432\u0434\u043E\u0445, 7 \u0441\u0435\u043A \u0432\u044B\u0434\u043E\u0445',
        '\uD83D\uDEB6 \u0412\u044B\u0439\u0434\u0438 \u043D\u0430 10-\u043C\u0438\u043D\u0443\u0442\u043D\u0443\u044E \u043F\u0440\u043E\u0433\u0443\u043B\u043A\u0443 \u0431\u0435\u0437 \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u0430',
        '\uD83C\uDFB5 \u0412\u043A\u043B\u044E\u0447\u0438 \u0441\u043F\u043E\u043A\u043E\u0439\u043D\u0443\u044E \u043C\u0443\u0437\u044B\u043A\u0443 \u0438 \u0437\u0430\u043A\u0440\u043E\u0439 \u0433\u043B\u0430\u0437\u0430 \u043D\u0430 3 \u043C\u0438\u043D\u0443\u0442\u044B',
        '\u270D\uFE0F \u0417\u0430\u043F\u0438\u0448\u0438 \u0442\u043E, \u0447\u0442\u043E \u0442\u0435\u0431\u044F \u0431\u0435\u0441\u043F\u043E\u043A\u043E\u0438\u0442 \u2014 \u043D\u0430 \u0431\u0443\u043C\u0430\u0433\u0435 \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u044B \u043A\u0430\u0436\u0443\u0442\u0441\u044F \u043C\u0435\u043D\u044C\u0448\u0435'
      ],
      faceClass: 'face-stressed'
    },
    excited: {
      emoji: '\uD83E\uDD29',
      title: '\u0412\u043E\u0437\u0431\u0443\u0436\u0434\u0435\u043D\u0438\u0435 / \u042D\u043D\u0435\u0440\u0433\u0438\u044F',
      description: '\u0422\u044B \u043F\u043E\u043B\u043E\u043D \u044D\u043D\u0435\u0440\u0433\u0438\u0438! \u0411\u044B\u0441\u0442\u0440\u044B\u0435 \u043B\u0451\u0433\u043A\u0438\u0435 \u0442\u0430\u043F\u044B \u0433\u043E\u0432\u043E\u0440\u044F\u0442 \u043E \u043F\u0440\u0438\u043F\u043E\u0434\u043D\u044F\u0442\u043E\u043C \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u0438\u0438 \u0438 \u0434\u0440\u0430\u0439\u0432\u0435.',
      advice: [
        '\uD83C\uDFAF \u041D\u0430\u043F\u0440\u0430\u0432\u044C \u044D\u043D\u0435\u0440\u0433\u0438\u044E \u0432 \u0434\u0435\u043B\u043E: \u043D\u0430\u0447\u043D\u0438 \u0437\u0430\u0434\u0430\u0447\u0443, \u043A\u043E\u0442\u043E\u0440\u0443\u044E \u043E\u0442\u043A\u043B\u0430\u0434\u044B\u0432\u0430\u043B',
        '\uD83C\uDFC3 \u0421\u0445\u043E\u0434\u0438 \u043D\u0430 \u0442\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0443 \u0438\u043B\u0438 \u043F\u0440\u043E\u0431\u0435\u0436\u043A\u0443',
        '\uD83C\uDFA8 \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439 \u0447\u0442\u043E-\u0442\u043E \u0442\u0432\u043E\u0440\u0447\u0435\u0441\u043A\u043E\u0435: \u0440\u0438\u0441\u043E\u0432\u0430\u043D\u0438\u0435, \u043C\u0443\u0437\u044B\u043A\u0430, \u043F\u0438\u0441\u044C\u043C\u043E',
        '\uD83D\uDCAC \u041F\u043E\u0437\u0432\u043E\u043D\u0438 \u0434\u0440\u0443\u0433\u0443 \u0438 \u043F\u043E\u0434\u0435\u043B\u0438\u0441\u044C \u0445\u043E\u0440\u043E\u0448\u0438\u043C \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u0438\u0435\u043C'
      ],
      faceClass: 'face-excited'
    },
    calm: {
      emoji: '\uD83D\uDE0C',
      title: '\u0421\u043F\u043E\u043A\u043E\u0439\u0441\u0442\u0432\u0438\u0435',
      description: '\u0422\u044B \u0432 \u0440\u0430\u0441\u0441\u043B\u0430\u0431\u043B\u0435\u043D\u043D\u043E\u043C \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0438. \u041C\u044F\u0433\u043A\u0438\u0435, \u043D\u0435\u0442\u043E\u0440\u043E\u043F\u043B\u0438\u0432\u044B\u0435 \u0442\u0430\u043F\u044B \u2014 \u043F\u0440\u0438\u0437\u043D\u0430\u043A \u0432\u043D\u0443\u0442\u0440\u0435\u043D\u043D\u0435\u0433\u043E \u0431\u0430\u043B\u0430\u043D\u0441\u0430.',
      advice: [
        '\uD83E\uDDD8 \u0425\u043E\u0440\u043E\u0448\u0435\u0435 \u0432\u0440\u0435\u043C\u044F \u0434\u043B\u044F \u043C\u0435\u0434\u0438\u0442\u0430\u0446\u0438\u0438 \u0438\u043B\u0438 \u0439\u043E\u0433\u0438',
        '\uD83D\uDCD6 \u041F\u043E\u0447\u0438\u0442\u0430\u0439 \u043A\u043D\u0438\u0433\u0443 \u0438\u043B\u0438 \u043F\u043E\u0441\u043B\u0443\u0448\u0430\u0439 \u043F\u043E\u0434\u043A\u0430\u0441\u0442',
        '\u2615 \u0417\u0430\u0432\u0430\u0440\u0438 \u0447\u0430\u0439 \u0438 \u043D\u0430\u0441\u043B\u0430\u0434\u0438\u0441\u044C \u043C\u043E\u043C\u0435\u043D\u0442\u043E\u043C',
        '\uD83D\uDCDD \u0417\u0430\u043F\u0438\u0448\u0438 3 \u0432\u0435\u0449\u0438, \u0437\u0430 \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u0431\u043B\u0430\u0433\u043E\u0434\u0430\u0440\u0435\u043D \u0441\u0435\u0433\u043E\u0434\u043D\u044F'
      ],
      faceClass: 'face-calm'
    },
    anxious: {
      emoji: '\uD83D\uDE1F',
      title: '\u0422\u0440\u0435\u0432\u043E\u0433\u0430',
      description: '\u041D\u0435\u0440\u0435\u0433\u0443\u043B\u044F\u0440\u043D\u044B\u0439 \u0440\u0438\u0442\u043C \u0438 \u043B\u0451\u0433\u043A\u0430\u044F \u0434\u0440\u043E\u0436\u044C \u0433\u043E\u0432\u043E\u0440\u044F\u0442 \u043E \u0432\u043D\u0443\u0442\u0440\u0435\u043D\u043D\u0435\u043C \u0431\u0435\u0441\u043F\u043E\u043A\u043E\u0439\u0441\u0442\u0432\u0435. \u042D\u0442\u043E \u043D\u043E\u0440\u043C\u0430\u043B\u044C\u043D\u043E.',
      advice: [
        '\uD83D\uDC63 \u0422\u0435\u0445\u043D\u0438\u043A\u0430 \u0437\u0430\u0437\u0435\u043C\u043B\u0435\u043D\u0438\u044F 5-4-3-2-1: \u043D\u0430\u0437\u043E\u0432\u0438 5 \u0432\u0435\u0449\u0435\u0439, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u0432\u0438\u0434\u0438\u0448\u044C, 4 \u0441\u043B\u044B\u0448\u0438\u0448\u044C, 3 \u0447\u0443\u0432\u0441\u0442\u0432\u0443\u0435\u0448\u044C...',
        '\uD83E\uDDF4 \u0421\u043E\u0436\u043C\u0438 \u0438 \u0440\u0430\u0437\u043E\u0436\u043C\u0438 \u043A\u0443\u043B\u0430\u043A\u0438 10 \u0440\u0430\u0437 \u2014 \u0441\u0431\u0440\u043E\u0441\u044C \u043D\u0430\u043F\u0440\u044F\u0436\u0435\u043D\u0438\u0435 \u0438\u0437 \u0442\u0435\u043B\u0430',
        '\uD83D\uDCAD \u041D\u0430\u043F\u0438\u0448\u0438 \u0442\u0440\u0435\u0432\u043E\u0436\u043D\u0443\u044E \u043C\u044B\u0441\u043B\u044C \u0438 \u0440\u044F\u0434\u043E\u043C \u2014 \u0441\u0430\u043C\u044B\u0439 \u0440\u0435\u0430\u043B\u0438\u0441\u0442\u0438\u0447\u043D\u044B\u0439 \u0438\u0441\u0445\u043E\u0434',
        '\uD83D\uDC9A \u041D\u0430\u043F\u043E\u043C\u043D\u0438 \u0441\u0435\u0431\u0435: \u0442\u0440\u0435\u0432\u043E\u0433\u0430 \u2014 \u044D\u0442\u043E \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E\u0435 \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435, \u043D\u0435 \u0444\u0430\u043A\u0442'
      ],
      faceClass: 'face-anxious'
    },
    focused: {
      emoji: '\uD83E\uDDD0',
      title: '\u0421\u043E\u0441\u0440\u0435\u0434\u043E\u0442\u043E\u0447\u0435\u043D\u043D\u043E\u0441\u0442\u044C',
      description: '\u0420\u0430\u0437\u043C\u0435\u0440\u0435\u043D\u043D\u044B\u0435, \u0443\u0432\u0435\u0440\u0435\u043D\u043D\u044B\u0435 \u0442\u0430\u043F\u044B \u043F\u0440\u0438 \u0441\u0442\u0430\u0431\u0438\u043B\u044C\u043D\u043E\u043C \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u0435. \u0422\u044B \u0432 \u043F\u043E\u0442\u043E\u043A\u0435.',
      advice: [
        '\uD83D\uDE80 \u041E\u0442\u043B\u0438\u0447\u043D\u043E\u0435 \u0432\u0440\u0435\u043C\u044F \u0434\u043B\u044F \u0441\u043B\u043E\u0436\u043D\u044B\u0445 \u0437\u0430\u0434\u0430\u0447 \u2014 \u043B\u043E\u0432\u0438 \u043F\u043E\u0442\u043E\u043A!',
        '\uD83D\uDD07 \u0423\u0431\u0435\u0440\u0438 \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F \u0438 \u043F\u043E\u0440\u0430\u0431\u043E\u0442\u0430\u0439 25 \u043C\u0438\u043D\u0443\u0442 \u043F\u043E \u041F\u043E\u043C\u043E\u0434\u043E\u0440\u043E',
        '\uD83C\uDFAF \u0417\u0430\u043F\u0438\u0448\u0438 \u0433\u043B\u0430\u0432\u043D\u0443\u044E \u0446\u0435\u043B\u044C \u043D\u0430 \u0441\u0435\u0433\u043E\u0434\u043D\u044F \u0438 \u0441\u0444\u043E\u043A\u0443\u0441\u0438\u0440\u0443\u0439\u0441\u044F \u043D\u0430 \u043D\u0435\u0439',
        '\uD83D\uDCA7 \u041D\u0435 \u0437\u0430\u0431\u0443\u0434\u044C \u043F\u0438\u0442\u044C \u0432\u043E\u0434\u0443 \u2014 \u043C\u043E\u0437\u0433\u0443 \u043D\u0443\u0436\u043D\u0430 \u0433\u0438\u0434\u0440\u0430\u0442\u0430\u0446\u0438\u044F'
      ],
      faceClass: 'face-focused'
    },
    sad: {
      emoji: '\uD83D\uDE14',
      title: '\u0413\u0440\u0443\u0441\u0442\u044C / \u041C\u0435\u043B\u0430\u043D\u0445\u043E\u043B\u0438\u044F',
      description: '\u041C\u0435\u0434\u043B\u0435\u043D\u043D\u044B\u0435 \u0442\u0430\u043F\u044B \u0441 \u0434\u043E\u043B\u0433\u0438\u043C \u0443\u0434\u0435\u0440\u0436\u0430\u043D\u0438\u0435\u043C \u0438 \u043D\u0430\u043A\u043B\u043E\u043D\u043E\u043C \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430. \u041F\u043E\u0445\u043E\u0436\u0435, \u043D\u0430 \u0434\u0443\u0448\u0435 \u0442\u044F\u0436\u0435\u043B\u043E\u0432\u0430\u0442\u043E.',
      advice: [
        '\uD83D\uDC9B \u0411\u0443\u0434\u044C \u043C\u044F\u0433\u0447\u0435 \u043A \u0441\u0435\u0431\u0435 \u2014 \u0433\u0440\u0443\u0441\u0442\u0438\u0442\u044C \u043D\u043E\u0440\u043C\u0430\u043B\u044C\u043D\u043E',
        '\uD83D\uDCDE \u041F\u043E\u0437\u0432\u043E\u043D\u0438 \u0438\u043B\u0438 \u043D\u0430\u043F\u0438\u0448\u0438 \u043A\u043E\u043C\u0443-\u0442\u043E \u0431\u043B\u0438\u0437\u043A\u043E\u043C\u0443',
        '\u2600\uFE0F \u0412\u044B\u0439\u0434\u0438 \u043D\u0430 \u0441\u0432\u0435\u0436\u0438\u0439 \u0432\u043E\u0437\u0434\u0443\u0445 \u0445\u043E\u0442\u044F \u0431\u044B \u043D\u0430 5 \u043C\u0438\u043D\u0443\u0442',
        '\uD83C\uDFB6 \u041F\u043E\u0441\u043B\u0443\u0448\u0430\u0439 \u043B\u044E\u0431\u0438\u043C\u0443\u044E \u043C\u0443\u0437\u044B\u043A\u0443 \u0438\u043B\u0438 \u043F\u043E\u0441\u043C\u043E\u0442\u0440\u0438 \u0434\u043E\u0431\u0440\u043E\u0435 \u0432\u0438\u0434\u0435\u043E'
      ],
      faceClass: 'face-sad'
    }
  };

  // --- Show Result ---
  function showResult(result) {
    var e = emotions[result.emotion];

    thinkingDiv.classList.add('hidden');
    resultCard.classList.remove('hidden');

    resultEmoji.textContent = e.emoji;
    resultEmotion.textContent = e.title;
    resultDescription.textContent = e.description;

    adviceList.innerHTML = '';
    for (var i = 0; i < e.advice.length; i++) {
      var li = document.createElement('li');
      li.textContent = e.advice[i];
      adviceList.appendChild(li);
    }

    resultStats.textContent =
      '\u0422\u0430\u043F\u043E\u0432: ' + result.stats.tapCount +
      ' | \u0427\u0430\u0441\u0442\u043E\u0442\u0430: ' + result.stats.frequency + '/\u0441' +
      ' | \u0420\u0438\u0442\u043C\u0438\u0447\u043D\u043E\u0441\u0442\u044C: ' + result.stats.regularity + '%' +
      (result.stats.trailDist > 0 ? ' | \u0421\u043B\u0435\u0434: ' + result.stats.trailDist + 'px' : '') +
      (gyroAvailable ? ' | \u0422\u0440\u044F\u0441\u043A\u0430: ' + result.stats.shakeIntensity : '');
  }

  // --- Utils ---
  function pluralize(n, one, few, many) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  }

  // --- Event Listeners ---
  startBtn.addEventListener('click', function () {
    startSession();
  });

  retryBtn.addEventListener('click', function () {
    resultScreen.classList.add('hidden');
    startSession();
  });

  doneBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (sessionActive) endSession();
  });

  tapArea.addEventListener('pointerdown', onPointerDown);
  tapArea.addEventListener('pointermove', onPointerMove);
  tapArea.addEventListener('pointerup', onPointerUp);
  tapArea.addEventListener('pointercancel', onPointerUp);

  tapArea.addEventListener('contextmenu', function (e) {
    e.preventDefault();
  });

  window.addEventListener('resize', function () {
    if (sessionActive) resizeCanvas();
  });
})();
