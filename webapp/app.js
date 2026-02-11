(function () {
  'use strict';

  var MAX_DURATION = 6000;

  // --- API URL from query params ---
  var params = new URLSearchParams(window.location.search);
  var API_URL = params.get('api') || '';

  // --- DOM ---
  var introScreen = document.getElementById('intro-screen');
  var surveyScreen = document.getElementById('survey-screen');
  var countdownScreen = document.getElementById('countdown-screen');
  var countdownNumber = document.getElementById('countdown-number');
  var tapScreen = document.getElementById('tap-screen');
  var resultScreen = document.getElementById('result-screen');
  var groupScreen = document.getElementById('group-screen');
  var startBtn = document.getElementById('start-btn');
  var retryBtn = document.getElementById('retry-btn');
  var groupBtn = document.getElementById('group-btn');
  var doneBtn = document.getElementById('done-btn');
  var backResultBtn = document.getElementById('back-result-btn');
  var groupRetryBtn = document.getElementById('group-retry-btn');
  var surveyNextBtn = document.getElementById('survey-next-btn');
  var feedbackSection = document.getElementById('feedback-section');
  var feedbackCorrection = document.getElementById('feedback-correction');
  var feedbackDoneBtn = document.getElementById('feedback-done-btn');
  var postFeedbackButtons = document.getElementById('post-feedback-buttons');
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
  var timerInterval = null;
  var isDown = false;
  var trailPoints = [];
  var animFrameId = null;
  var trailHue = 45;
  var strokeId = 0;
  var lastResult = null;
  var emotionChart = null;
  var tapsChart = null;
  var pollTimer = null;

  // --- Dataset collection state ---
  var surveyData = { valence: null, arousal: null, dominance: null, emotion: null };
  var feedbackData = { rating: null, correctedEmotion: null };
  var attemptNumber = 0;
  var sessionId = '';

  // --- Telegram ---
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }

  var userName = 'Аноним';
  var userId = 'anon_' + Math.random().toString(36).slice(2, 8);
  if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
    userName = tg.initDataUnsafe.user.first_name || 'Аноним';
    userId = String(tg.initDataUnsafe.user.id);
  }

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
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
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
      sendResultToAPI(lastResult);
    }, 1500);
  }

  function hideAll() {
    introScreen.classList.add('hidden');
    surveyScreen.classList.add('hidden');
    countdownScreen.classList.add('hidden');
    tapScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    groupScreen.classList.add('hidden');
  }

  // --- Countdown 3-2-1 ---
  function startCountdown() {
    hideAll();
    countdownScreen.classList.remove('hidden');
    var count = 3;
    countdownNumber.textContent = count;
    countdownNumber.style.animation = 'none';
    void countdownNumber.offsetWidth;
    countdownNumber.style.animation = 'countPop 0.8s ease-in-out';
    var iv = setInterval(function () {
      count--;
      if (count > 0) {
        countdownNumber.textContent = count;
        countdownNumber.style.animation = 'none';
        void countdownNumber.offsetWidth;
        countdownNumber.style.animation = 'countPop 0.8s ease-in-out';
      } else {
        clearInterval(iv);
        startSession();
      }
    }, 1000);
  }

  // --- Send result to API ---
  function sendResultToAPI(result) {
    if (!API_URL) return;
    fetch(API_URL + '/api/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        name: userName,
        emotion: result.emotion,
        stats: result.stats,
      }),
    }).catch(function () {});
  }

  // --- Analysis ---
  function analyze() {
    var downs = taps.filter(function (t) { return t.type === 'down'; });
    var tapCount = downs.length;
    var dur = (Date.now() - sessionStart) / 1000;
    var freq = tapCount / Math.max(dur, 0.1);
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
      tapCount: tapCount, duration: dur.toFixed(1), frequency: freq.toFixed(1),
      regularity: (reg*100).toFixed(0), avgHold: avgHold.toFixed(0),
      shakeIntensity: shake.toFixed(1), trailDist: Math.round(tDist),
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
    var st = result.stats;
    resultStats.textContent = 'Тапов: ' + st.tapCount + ' | ' + st.duration + 'с'
      + ' | Частота: ' + st.frequency + '/с | Ритм: ' + st.regularity + '%'
      + (st.trailDist > 0 ? ' | След: ' + st.trailDist + 'px' : '')
      + (gyroAvailable ? ' | Тряска: ' + st.shakeIntensity : '');
    // Show feedback, hide nav buttons until feedback done
    resetFeedbackUI();
    feedbackSection.classList.remove('hidden');
    postFeedbackButtons.classList.add('hidden');
  }

  // --- Group Dashboard ---
  function showGroupScreen() {
    hideAll();
    groupScreen.classList.remove('hidden');
    fetchGroupResults();
    pollTimer = setInterval(fetchGroupResults, 3000);
  }

  function fetchGroupResults() {
    if (!API_URL) return;
    document.getElementById('group-error').textContent = '';
    fetch(API_URL + '/api/results')
      .then(function (r) { return r.json(); })
      .then(renderGroupDashboard)
      .catch(function () {
        document.getElementById('group-error').textContent = 'Нет связи с сервером';
      });
  }

  function renderGroupDashboard(data) {
    var countEl = document.getElementById('group-count');
    var domEl = document.getElementById('group-dominant');
    var errEl = document.getElementById('group-error');
    errEl.textContent = '';

    countEl.textContent = data.count + ' ' + pluralize(data.count, 'участник', 'участника', 'участников');

    if (data.count > 0) {
      domEl.innerHTML = '<span style="font-size:48px">' + esc(data.dominant_emoji) + '</span><br>' +
        'Общее настроение: <strong>' + esc(data.dominant_title) + '</strong>';
    } else {
      domEl.innerHTML = '<span style="opacity:0.5">Пока никто не прошёл тест</span>';
    }

    renderEmotionChart(data);
    renderTapsChart(data);
    renderMembersList(data);
  }

  function renderEmotionChart(data) {
    var wrap = document.getElementById('emotion-chart-wrap');
    var canvas = document.getElementById('emotion-chart');
    var labels = [], values = [], colors = [];
    var counts = data.emotion_counts || {};
    var titles = data.emotion_titles || {};
    var colorMap = data.emotion_colors || {};
    var order = ['stressed', 'excited', 'calm', 'anxious', 'focused', 'sad'];
    for (var i = 0; i < order.length; i++) {
      if (counts[order[i]]) {
        labels.push(titles[order[i]] || order[i]);
        values.push(counts[order[i]]);
        colors.push(colorMap[order[i]] || '#888');
      }
    }
    if (emotionChart) emotionChart.destroy();
    if (values.length === 0) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    emotionChart = new Chart(canvas, {
      type: 'doughnut',
      data: { labels: labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { position: 'bottom', labels: { color: '#eee', font: { size: 13 }, padding: 12 } } }
      }
    });
  }

  function renderTapsChart(data) {
    var wrap = document.getElementById('taps-chart-wrap');
    var canvas = document.getElementById('taps-chart');
    var labels = [], values = [], colors = [];
    var colorMap = data.emotion_colors || {};
    var members = data.results || [];
    for (var i = 0; i < members.length; i++) {
      labels.push(members[i].name);
      values.push(members[i].stats ? (members[i].stats.tapCount || 0) : 0);
      colors.push(colorMap[members[i].emotion] || '#888');
    }
    if (tapsChart) tapsChart.destroy();
    if (values.length === 0) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    tapsChart = new Chart(canvas, {
      type: 'bar',
      data: { labels: labels, datasets: [{ label: 'Тапы', data: values, backgroundColor: colors, borderRadius: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: true, indexAxis: 'y',
        scales: {
          x: { ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#eee', font: { size: 13 } }, grid: { display: false } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }

  function renderMembersList(data) {
    var container = document.getElementById('members-list');
    var members = data.results || [];
    var titles = data.emotion_titles || {};
    var colorMap = data.emotion_colors || {};
    var html = '';
    for (var i = 0; i < members.length; i++) {
      var m = members[i];
      var s = m.stats || {};
      var color = colorMap[m.emotion] || '#888';
      var time = '';
      if (m.timestamp) {
        var d = new Date(m.timestamp);
        time = pad(d.getHours()) + ':' + pad(d.getMinutes());
      }
      html += '<div class="member-card" style="border-left-color:' + color + '">' +
        '<div class="member-header">' +
          '<span class="member-emoji">' + esc(m.emoji) + '</span>' +
          '<span class="member-name">' + esc(m.name) + '</span>' +
          '<span class="member-emotion">' + esc(titles[m.emotion] || m.emotion) + '</span>' +
        '</div>' +
        '<div class="member-stats">' +
          '<span>' + (s.tapCount || 0) + ' тапов</span>' +
          '<span>' + (s.frequency || '0') + '/с</span>' +
          '<span>Ритм ' + (s.regularity || '0') + '%</span>' +
          '<span>Удерж ' + (s.avgHold || '0') + 'мс</span>' +
          (s.duration ? '<span>' + s.duration + 'с</span>' : '') +
          (s.trailDist ? '<span>След ' + s.trailDist + 'px</span>' : '') +
          (s.shakeIntensity && s.shakeIntensity !== '0.0' ? '<span>Тряска ' + s.shakeIntensity + '</span>' : '') +
        '</div>' +
        (time ? '<div class="member-time">' + time + '</div>' : '') +
      '</div>';
    }
    if (members.length === 0) html = '<p class="no-members">Пока никто не прошёл тест</p>';
    container.innerHTML = html;
  }

  // --- Utils ---
  function pluralize(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // --- Survey ---
  function generateSessionId() {
    return 'xxxx-xxxx-xxxx'.replace(/x/g, function () {
      return Math.floor(Math.random() * 16).toString(16);
    });
  }

  function showSurvey() {
    surveyData = { valence: null, arousal: null, dominance: null, emotion: null };
    attemptNumber++;
    sessionId = generateSessionId();
    // Reset UI selections
    var allCircles = surveyScreen.querySelectorAll('.sam-circle');
    for (var i = 0; i < allCircles.length; i++) allCircles[i].classList.remove('selected');
    var allEmotions = surveyScreen.querySelectorAll('.emotion-option');
    for (var i = 0; i < allEmotions.length; i++) allEmotions[i].classList.remove('selected');
    surveyNextBtn.disabled = true;
    hideAll();
    surveyScreen.classList.remove('hidden');
  }

  function checkSurveyComplete() {
    surveyNextBtn.disabled = !(surveyData.valence && surveyData.arousal && surveyData.dominance && surveyData.emotion);
  }

  // SAM circles click
  var samScales = surveyScreen.querySelectorAll('.sam-scale');
  for (var si = 0; si < samScales.length; si++) {
    (function (scale) {
      var scaleName = scale.getAttribute('data-scale');
      var circles = scale.querySelectorAll('.sam-circle');
      for (var ci = 0; ci < circles.length; ci++) {
        (function (circle) {
          circle.addEventListener('click', function () {
            var siblings = scale.querySelectorAll('.sam-circle');
            for (var j = 0; j < siblings.length; j++) siblings[j].classList.remove('selected');
            circle.classList.add('selected');
            surveyData[scaleName] = parseInt(circle.getAttribute('data-value'));
            checkSurveyComplete();
          });
        })(circles[ci]);
      }
    })(samScales[si]);
  }

  // Survey emotion picker
  var surveyEmotionOptions = surveyScreen.querySelectorAll('.emotion-option');
  for (var ei = 0; ei < surveyEmotionOptions.length; ei++) {
    (function (opt) {
      opt.addEventListener('click', function () {
        for (var j = 0; j < surveyEmotionOptions.length; j++) surveyEmotionOptions[j].classList.remove('selected');
        opt.classList.add('selected');
        surveyData.emotion = opt.getAttribute('data-emotion');
        checkSurveyComplete();
      });
    })(surveyEmotionOptions[ei]);
  }

  // --- Feedback ---
  function resetFeedbackUI() {
    feedbackData = { rating: null, correctedEmotion: null };
    var stars = document.querySelectorAll('#star-rating .star');
    for (var i = 0; i < stars.length; i++) stars[i].classList.remove('active');
    feedbackCorrection.classList.add('hidden');
    var corrEmotions = feedbackCorrection.querySelectorAll('.emotion-option');
    for (var i = 0; i < corrEmotions.length; i++) corrEmotions[i].classList.remove('selected');
    feedbackDoneBtn.disabled = true;
  }

  // Star rating
  var stars = document.querySelectorAll('#star-rating .star');
  for (var sti = 0; sti < stars.length; sti++) {
    (function (star, idx) {
      star.addEventListener('click', function () {
        feedbackData.rating = idx + 1;
        for (var j = 0; j < stars.length; j++) {
          stars[j].classList.toggle('active', j <= idx);
        }
        if (feedbackData.rating < 4) {
          feedbackCorrection.classList.remove('hidden');
          // Require corrected emotion if rating < 4
          feedbackDoneBtn.disabled = !feedbackData.correctedEmotion;
        } else {
          feedbackCorrection.classList.add('hidden');
          feedbackData.correctedEmotion = null;
          feedbackDoneBtn.disabled = false;
        }
      });
    })(stars[sti], sti);
  }

  // Feedback emotion correction picker
  var correctionOptions = feedbackCorrection.querySelectorAll('.emotion-option');
  for (var coi = 0; coi < correctionOptions.length; coi++) {
    (function (opt) {
      opt.addEventListener('click', function () {
        for (var j = 0; j < correctionOptions.length; j++) correctionOptions[j].classList.remove('selected');
        opt.classList.add('selected');
        feedbackData.correctedEmotion = opt.getAttribute('data-emotion');
        feedbackDoneBtn.disabled = false;
      });
    })(correctionOptions[coi]);
  }

  // --- Send dataset ---
  function sendDataset() {
    if (!API_URL || !lastResult) return;
    var payload = {
      user_id: userId,
      user_name: userName,
      session_id: sessionId,
      attempt_number: attemptNumber,
      timestamp: new Date().toISOString(),
      survey: {
        valence: surveyData.valence,
        arousal: surveyData.arousal,
        dominance: surveyData.dominance,
        self_reported_emotion: surveyData.emotion,
      },
      tap_features: lastResult.stats,
      scores: lastResult.scores,
      model_prediction: lastResult.emotion,
      feedback: {
        accuracy_rating: feedbackData.rating,
        corrected_emotion: feedbackData.correctedEmotion,
      },
    };
    fetch(API_URL + '/api/dataset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(function () {});
  }

  // --- Events ---
  startBtn.addEventListener('click', showSurvey);
  surveyNextBtn.addEventListener('click', startCountdown);
  feedbackDoneBtn.addEventListener('click', function () {
    sendDataset();
    feedbackSection.classList.add('hidden');
    postFeedbackButtons.classList.remove('hidden');
    groupBtn.style.display = API_URL ? '' : 'none';
  });
  retryBtn.addEventListener('click', showSurvey);
  doneBtn.addEventListener('click', function (e) { e.stopPropagation(); if (sessionActive) endSession(); });
  groupBtn.addEventListener('click', showGroupScreen);
  backResultBtn.addEventListener('click', function () {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    hideAll(); resultScreen.classList.remove('hidden');
  });
  groupRetryBtn.addEventListener('click', function () {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    showSurvey();
  });
  tapArea.addEventListener('pointerdown', onPointerDown);
  tapArea.addEventListener('pointermove', onPointerMove);
  tapArea.addEventListener('pointerup', onPointerUp);
  tapArea.addEventListener('pointercancel', onPointerUp);
  tapArea.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  window.addEventListener('resize', function () { if (sessionActive) resizeCanvas(); });
})();
