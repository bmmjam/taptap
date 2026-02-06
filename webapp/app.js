(function () {
  'use strict';

  var MAX_DURATION = 30000;

  // --- DOM ---
  var introScreen = document.getElementById('intro-screen');
  var tapScreen = document.getElementById('tap-screen');
  var resultScreen = document.getElementById('result-screen');
  var startBtn = document.getElementById('start-btn');
  var retryBtn = document.getElementById('retry-btn');
  var sendBtn = document.getElementById('send-btn');
  var doneBtn = document.getElementById('done-btn');
  var tapArea = document.getElementById('tap-area');
  var face = document.getElementById('face');
  var pulseRing = document.getElementById('pulse-ring');
  var tapCounter = document.getElementById('tap-counter');
  var timerFill = document.getElementById('timer-fill');
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
  var timerInterval = null;
  var isDown = false;
  var trailPoints = [];
  var animFrameId = null;
  var trailHue = 45;
  var strokeId = 0;
  var lastResult = null;

  // --- Telegram ---
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }

  // --- Canvas ---
  function resizeCanvas() {
    var dpr = window.devicePixelRatio || 1;
    trailCanvas.width = trailCanvas.offsetWidth * dpr;
    trailCanvas.height = trailCanvas.offsetHeight * dpr;
    ctx.scale(dpr, dpr);
  }

  // --- Trail ---
  function renderTrail() {
    if (!sessionActive) return;
    var now = Date.now();
    ctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    var fadeTime = 1500;
    trailPoints = trailPoints.filter(function (p) { return now - p.t < fadeTime; });
    if (trailPoints.length < 2) { animFrameId = requestAnimationFrame(renderTrail); return; }
    for (var i = 1; i < trailPoints.length; i++) {
      var prev = trailPoints[i - 1], curr = trailPoints[i];
      if (curr.stroke !== prev.stroke) continue;
      var alpha = Math.max(0, 1 - (now - curr.t) / fadeTime);
      var lw = Math.max(2, 8 * alpha);
      var hue = (trailHue + i * 0.5) % 360;
      ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(curr.x, curr.y);
      ctx.strokeStyle = 'hsla(' + hue + ',100%,65%,' + alpha + ')';
      ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.stroke();
      if (alpha > 0.3) {
        ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(curr.x, curr.y);
        ctx.strokeStyle = 'hsla(' + hue + ',100%,80%,' + (alpha * 0.3) + ')';
        ctx.lineWidth = lw + 8; ctx.stroke();
      }
    }
    if (isDown && trailPoints.length > 0) {
      var last = trailPoints[trailPoints.length - 1];
      var dh = (trailHue + trailPoints.length * 0.5) % 360;
      ctx.beginPath(); ctx.arc(last.x, last.y, 12, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + dh + ',100%,75%,0.5)'; ctx.fill();
      ctx.beginPath(); ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + dh + ',100%,90%,0.9)'; ctx.fill();
    }
    animFrameId = requestAnimationFrame(renderTrail);
  }

  // --- Gyroscope ---
  function initGyroscope() {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission().then(function (s) { if (s === 'granted') { gyroAvailable = true; subscribeMotion(); } }).catch(function () {});
    } else if ('DeviceMotionEvent' in window) { gyroAvailable = true; subscribeMotion(); }
  }
  function subscribeMotion() {
    window.addEventListener('devicemotion', onDeviceMotion);
    window.addEventListener('deviceorientation', onDeviceOrientation);
  }
  function onDeviceMotion(e) {
    if (!sessionActive) return;
    var a = e.accelerationIncludingGravity || e.acceleration; if (!a) return;
    motionSamples.push({ x: a.x || 0, y: a.y || 0, z: a.z || 0, t: Date.now() });
  }
  function onDeviceOrientation(e) {
    if (!sessionActive) return;
    orientationSamples.push({ alpha: e.alpha || 0, beta: e.beta || 0, gamma: e.gamma || 0, t: Date.now() });
  }

  // --- Pointer ---
  function onPointerDown(e) {
    if (!sessionActive) return; e.preventDefault();
    isDown = true; strokeId++;
    trailPoints.push({ x: e.clientX, y: e.clientY, t: Date.now(), stroke: strokeId });
    taps.push({ time: Date.now(), pressure: e.pressure || 0, width: e.width || 0, height: e.height || 0, type: 'down' });
    face.classList.add('tapped');
    pulseRing.classList.remove('animate'); void pulseRing.offsetWidth; pulseRing.classList.add('animate');
    trailHue = (trailHue + 30) % 360;
    var c = taps.filter(function (t) { return t.type === 'down'; }).length;
    updateFaceMouth(c);
    tapCounter.textContent = c + ' ' + pluralize(c, 'тап', 'тапа', 'тапов');
  }
  function onPointerMove(e) {
    if (!sessionActive || !isDown) return; e.preventDefault();
    trailPoints.push({ x: e.clientX, y: e.clientY, t: Date.now(), stroke: strokeId });
  }
  function onPointerUp(e) {
    if (!sessionActive) return; e.preventDefault();
    isDown = false;
    taps.push({ time: Date.now(), pressure: e.pressure || 0, width: e.width || 0, height: e.height || 0, type: 'up' });
    face.classList.remove('tapped');
  }
  function updateFaceMouth(count) {
    var o = Math.min(count * 3, 40), y = 125 + o * 0.1, qy = 160 + o * 0.3;
    mouth.setAttribute('d', 'M 60 ' + y + ' Q 100 ' + qy + ' 140 ' + y);
    if (o > 20) { mouth.setAttribute('fill', '#333'); mouth.setAttribute('fill-opacity', '0.15'); }
  }

  // --- Timer ---
  function startTimer() {
    var start = Date.now();
    timerFill.style.width = '100%';
    timerInterval = setInterval(function () {
      var elapsed = Date.now() - start;
      var pct = Math.max(0, 1 - elapsed / MAX_DURATION);
      timerFill.style.width = (pct * 100) + '%';
      if (elapsed >= MAX_DURATION) endSession();
    }, 50);
  }

  // --- Session ---
  function startSession() {
    taps = []; motionSamples = []; orientationSamples = []; trailPoints = [];
    strokeId = 0; isDown = false; trailHue = 45;
    sessionActive = true; sessionStart = Date.now(); lastResult = null;
    hideAll(); tapScreen.classList.remove('hidden');
    resizeCanvas(); ctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    tapCounter.textContent = '0 тапов'; timerFill.style.width = '100%';
    face.classList.remove('face-stressed', 'face-excited', 'face-calm', 'face-anxious', 'face-focused', 'face-sad');
    mouth.setAttribute('d', 'M 60 125 Q 100 160 140 125');
    mouth.removeAttribute('fill'); mouth.removeAttribute('fill-opacity');
    gyroHint.textContent = gyroAvailable ? 'Гироскоп активен' : '';
    initGyroscope();
    startTimer();
    animFrameId = requestAnimationFrame(renderTrail);
  }

  function endSession() {
    sessionActive = false;
    clearInterval(timerInterval);
    if (animFrameId) cancelAnimationFrame(animFrameId);
    hideAll(); resultScreen.classList.remove('hidden');
    thinkingDiv.classList.remove('hidden'); resultCard.classList.add('hidden');
    setTimeout(function () {
      lastResult = analyze();
      showResult(lastResult);
    }, 1500);
  }

  function hideAll() {
    introScreen.classList.add('hidden');
    tapScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
  }

  // --- Send to bot via sendData ---
  function sendToBot(result) {
    if (tg && tg.sendData) {
      tg.sendData(JSON.stringify({ emotion: result.emotion, stats: result.stats }));
    }
  }

  // --- Analysis ---
  function analyze() {
    var downs = taps.filter(function (t) { return t.type === 'down'; });
    var tapCount = downs.length;
    var dur = (Date.now() - sessionStart) / 1000;
    var freq = tapCount / dur;
    var avgP = 0;
    if (tapCount > 0) { var s = 0; for (var i = 0; i < downs.length; i++) s += downs[i].pressure; avgP = s / tapCount; }
    var avgArea = 0;
    if (tapCount > 0) { var as = 0; for (var i = 0; i < downs.length; i++) as += (downs[i].width || 1) * (downs[i].height || 1); avgArea = as / tapCount; }
    var intervals = [];
    for (var i = 1; i < downs.length; i++) intervals.push(downs[i].time - downs[i - 1].time);
    var avgInt = 0, intVar = 0;
    if (intervals.length > 0) {
      var is2 = 0; for (var i = 0; i < intervals.length; i++) is2 += intervals[i]; avgInt = is2 / intervals.length;
      var vs = 0; for (var i = 0; i < intervals.length; i++) vs += Math.pow(intervals[i] - avgInt, 2); intVar = Math.sqrt(vs / intervals.length);
    }
    var reg = avgInt > 0 ? Math.max(0, 1 - intVar / avgInt) : 0;
    var avgHold = 0;
    var ups = taps.filter(function (t) { return t.type === 'up'; });
    if (downs.length > 0 && ups.length > 0) {
      var hs = 0, hc = Math.min(downs.length, ups.length);
      for (var i = 0; i < hc; i++) hs += ups[i].time - downs[i].time;
      avgHold = hs / hc;
    }
    var tDist = 0;
    for (var i = 1; i < trailPoints.length; i++) {
      if (trailPoints[i].stroke !== trailPoints[i - 1].stroke) continue;
      var dx = trailPoints[i].x - trailPoints[i - 1].x, dy = trailPoints[i].y - trailPoints[i - 1].y;
      tDist += Math.sqrt(dx * dx + dy * dy);
    }
    var shake = 0;
    if (motionSamples.length > 1) {
      var d = []; for (var i = 1; i < motionSamples.length; i++) {
        var mx = motionSamples[i].x - motionSamples[i-1].x, my = motionSamples[i].y - motionSamples[i-1].y, mz = motionSamples[i].z - motionSamples[i-1].z;
        d.push(Math.sqrt(mx*mx+my*my+mz*mz));
      } var ds = 0; for (var i = 0; i < d.length; i++) ds += d[i]; shake = ds / d.length;
    }
    var tilt = 0;
    if (orientationSamples.length > 1) {
      var b = orientationSamples.map(function(s){return s.beta;}), g = orientationSamples.map(function(s){return s.gamma;});
      tilt = (Math.max.apply(null,b)-Math.min.apply(null,b)) + (Math.max.apply(null,g)-Math.min.apply(null,g));
    }
    var inten = avgP > 0.1 ? avgP : Math.min(1, avgArea/5000 + Math.min(avgHold/500, 0.5));
    var sc = {stressed:0,excited:0,calm:0,anxious:0,focused:0,sad:0};
    sc.stressed += cl(freq/5)*0.3 + cl(inten)*0.3 + cl(shake/15)*0.4;
    sc.excited += cl(freq/4)*0.4 + cl(1-inten)*0.2 + cl(reg)*0.2 + cl(tDist/3000)*0.2;
    sc.calm += cl(1-freq/3)*0.4 + cl(1-inten)*0.3 + cl(1-shake/10)*0.3;
    sc.anxious += cl(1-reg)*0.3 + cl(shake/10)*0.3 + (inten>0.3&&inten<0.7?0.2:0) + cl(tDist/5000)*0.2;
    sc.focused += cl(1-freq/4)*0.2 + cl(inten)*0.3 + cl(1-shake/10)*0.2 + cl(reg)*0.3;
    sc.sad += cl(1-freq/2)*0.3 + cl(1-inten)*0.2 + cl(tilt/60)*0.2 + cl(avgHold/400)*0.3;
    if (tapCount === 0) { sc.calm = 0.3; sc.sad = 0.7; }
    var best = 'calm', bs = 0, k = Object.keys(sc);
    for (var i = 0; i < k.length; i++) { if (sc[k[i]] > bs) { bs = sc[k[i]]; best = k[i]; } }
    return { emotion: best, scores: sc, stats: {
      tapCount: tapCount, frequency: freq.toFixed(1), regularity: (reg*100).toFixed(0),
      shakeIntensity: shake.toFixed(1), avgHold: avgHold.toFixed(0), trailDist: Math.round(tDist)
    }};
  }
  function cl(v) { return Math.max(0, Math.min(1, v)); }

  // --- Emotions ---
  var emotions = {
    stressed: { emoji: '\uD83D\uDE24', title: 'Стресс', description: 'Похоже, внутри накопилось напряжение. Твои тапы были резкими и частыми \u2014 тело говорит за тебя.',
      advice: ['\uD83C\uDF2C\uFE0F Сделай 5 глубоких вдохов: 4 сек вдох, 7 сек выдох', '\uD83D\uDEB6 Выйди на 10-минутную прогулку без телефона', '\uD83C\uDFB5 Включи спокойную музыку и закрой глаза на 3 минуты', '\u270D\uFE0F Запиши то, что тебя беспокоит'] },
    excited: { emoji: '\uD83E\uDD29', title: 'Возбуждение / Энергия', description: 'Ты полон энергии! Быстрые лёгкие тапы говорят о приподнятом настроении и драйве.',
      advice: ['\uD83C\uDFAF Направь энергию в дело', '\uD83C\uDFC3 Сходи на тренировку', '\uD83C\uDFA8 Попробуй что-то творческое', '\uD83D\uDCAC Позвони другу'] },
    calm: { emoji: '\uD83D\uDE0C', title: 'Спокойствие', description: 'Ты в расслабленном состоянии. Мягкие, неторопливые тапы \u2014 признак баланса.',
      advice: ['\uD83E\uDDD8 Хорошее время для медитации', '\uD83D\uDCD6 Почитай книгу', '\u2615 Завари чай', '\uD83D\uDCDD Запиши 3 вещи, за которые благодарен'] },
    anxious: { emoji: '\uD83D\uDE1F', title: 'Тревога', description: 'Нерегулярный ритм говорит о внутреннем беспокойстве. Это нормально.',
      advice: ['\uD83D\uDC63 Техника заземления 5-4-3-2-1', '\uD83E\uDDF4 Сожми и разожми кулаки 10 раз', '\uD83D\uDCAD Напиши тревожную мысль и реалистичный исход', '\uD83D\uDC9A Тревога \u2014 временное состояние'] },
    focused: { emoji: '\uD83E\uDDD0', title: 'Сосредоточенность', description: 'Размеренные, уверенные тапы. Ты в потоке.',
      advice: ['\uD83D\uDE80 Лови поток!', '\uD83D\uDD07 Поработай 25 минут по Помодоро', '\uD83C\uDFAF Запиши главную цель', '\uD83D\uDCA7 Не забудь пить воду'] },
    sad: { emoji: '\uD83D\uDE14', title: 'Грусть / Меланхолия', description: 'Медленные тапы с долгим удержанием. На душе тяжеловато.',
      advice: ['\uD83D\uDC9B Будь мягче к себе', '\uD83D\uDCDE Позвони кому-то близкому', '\u2600\uFE0F Выйди на свежий воздух', '\uD83C\uDFB6 Послушай любимую музыку'] }
  };

  // --- Show Result ---
  function showResult(result) {
    var e = emotions[result.emotion];
    thinkingDiv.classList.add('hidden'); resultCard.classList.remove('hidden');
    resultEmoji.textContent = e.emoji;
    resultEmotion.textContent = e.title;
    resultDescription.textContent = e.description;
    adviceList.innerHTML = '';
    for (var i = 0; i < e.advice.length; i++) { var li = document.createElement('li'); li.textContent = e.advice[i]; adviceList.appendChild(li); }
    resultStats.textContent = 'Тапов: ' + result.stats.tapCount + ' | Частота: ' + result.stats.frequency + '/с | Ритмичность: ' + result.stats.regularity + '%'
      + (result.stats.trailDist > 0 ? ' | След: ' + result.stats.trailDist + 'px' : '')
      + (gyroAvailable ? ' | Тряска: ' + result.stats.shakeIntensity : '');
  }

  // --- Utils ---
  function pluralize(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  // --- Events ---
  startBtn.addEventListener('click', function () { startSession(); });
  retryBtn.addEventListener('click', function () { startSession(); });
  doneBtn.addEventListener('click', function (e) { e.stopPropagation(); if (sessionActive) endSession(); });
  sendBtn.addEventListener('click', function () { if (lastResult) sendToBot(lastResult); });
  tapArea.addEventListener('pointerdown', onPointerDown);
  tapArea.addEventListener('pointermove', onPointerMove);
  tapArea.addEventListener('pointerup', onPointerUp);
  tapArea.addEventListener('pointercancel', onPointerUp);
  tapArea.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  window.addEventListener('resize', function () { if (sessionActive) resizeCanvas(); });
})();
