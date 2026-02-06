(function () {
  'use strict';

  const SESSION_DURATION = 5000;

  // --- DOM ---
  const introScreen = document.getElementById('intro-screen');
  const tapScreen = document.getElementById('tap-screen');
  const resultScreen = document.getElementById('result-screen');
  const startBtn = document.getElementById('start-btn');
  const retryBtn = document.getElementById('retry-btn');
  const faceContainer = document.getElementById('face-container');
  const face = document.getElementById('face');
  const pulseRing = document.getElementById('pulse-ring');
  const tapCounter = document.getElementById('tap-counter');
  const timerFill = document.getElementById('timer-fill');
  const gyroHint = document.getElementById('gyro-hint');
  const thinkingDiv = document.getElementById('thinking');
  const resultCard = document.getElementById('result-card');
  const resultEmoji = document.getElementById('result-emoji');
  const resultEmotion = document.getElementById('result-emotion');
  const resultDescription = document.getElementById('result-description');
  const adviceList = document.getElementById('advice-list');
  const resultStats = document.getElementById('result-stats');
  const mouth = document.getElementById('mouth');

  // --- State ---
  let sessionActive = false;
  let sessionStart = 0;
  let taps = [];
  let motionSamples = [];
  let orientationSamples = [];
  let gyroAvailable = false;
  let timerInterval = null;

  // --- Telegram WebApp ---
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  // --- Gyroscope Setup ---
  function initGyroscope() {
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
      // iOS 13+
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

  // --- Tap Handling ---
  function onPointerDown(e) {
    if (!sessionActive) return;
    e.preventDefault();

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
    void pulseRing.offsetWidth; // force reflow
    pulseRing.classList.add('animate');

    // Mouth reacts
    var tapCount = taps.filter(function (t) { return t.type === 'down'; }).length;
    updateFaceMouth(tapCount);
    tapCounter.textContent = tapCount + ' ' + pluralize(tapCount, 'тап', 'тапа', 'тапов');
  }

  function onPointerUp(e) {
    if (!sessionActive) return;
    e.preventDefault();

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
    // Mouth gets more expressive with more taps
    var openness = Math.min(count * 3, 40);
    var y = 125 + openness * 0.1;
    var qy = 160 + openness * 0.3;
    mouth.setAttribute('d', 'M 60 ' + y + ' Q 100 ' + qy + ' 140 ' + y);
    if (openness > 20) {
      mouth.setAttribute('fill', '#333');
      mouth.setAttribute('fill-opacity', '0.15');
    }
  }

  // --- Timer ---
  function startTimer() {
    var start = Date.now();
    timerInterval = setInterval(function () {
      var elapsed = Date.now() - start;
      var pct = Math.max(0, 1 - elapsed / SESSION_DURATION);
      timerFill.style.width = (pct * 100) + '%';

      if (elapsed >= SESSION_DURATION) {
        endSession();
      }
    }, 50);
  }

  // --- Session ---
  function startSession() {
    taps = [];
    motionSamples = [];
    orientationSamples = [];
    sessionActive = true;
    sessionStart = Date.now();

    introScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    tapScreen.classList.remove('hidden');

    tapCounter.textContent = '0 тапов';
    timerFill.style.width = '100%';
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
    startTimer();
  }

  function endSession() {
    sessionActive = false;
    clearInterval(timerInterval);

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
    var duration = SESSION_DURATION / 1000;
    var frequency = tapCount / duration; // taps per second

    // Average pressure
    var avgPressure = 0;
    if (tapCount > 0) {
      var sum = 0;
      for (var i = 0; i < downs.length; i++) {
        sum += downs[i].pressure;
      }
      avgPressure = sum / tapCount;
    }

    // Average tap area (width * height as proxy for touch size)
    var avgArea = 0;
    if (tapCount > 0) {
      var areaSum = 0;
      for (var i = 0; i < downs.length; i++) {
        areaSum += (downs[i].width || 1) * (downs[i].height || 1);
      }
      avgArea = areaSum / tapCount;
    }

    // Tap intervals & regularity
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
    // Normalize regularity: 0 = very irregular, 1 = very regular
    var regularity = avgInterval > 0 ? Math.max(0, 1 - intervalVariance / avgInterval) : 0;

    // Hold durations
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

    // Gyroscope: shake intensity
    var shakeIntensity = 0;
    if (motionSamples.length > 1) {
      var diffs = [];
      for (var i = 1; i < motionSamples.length; i++) {
        var dx = motionSamples[i].x - motionSamples[i - 1].x;
        var dy = motionSamples[i].y - motionSamples[i - 1].y;
        var dz = motionSamples[i].z - motionSamples[i - 1].z;
        diffs.push(Math.sqrt(dx * dx + dy * dy + dz * dz));
      }
      var diffSum = 0;
      for (var i = 0; i < diffs.length; i++) diffSum += diffs[i];
      shakeIntensity = diffSum / diffs.length;
    }

    // Gyroscope: tilt range
    var tiltRange = 0;
    if (orientationSamples.length > 1) {
      var betas = orientationSamples.map(function (s) { return s.beta; });
      var gammas = orientationSamples.map(function (s) { return s.gamma; });
      var betaRange = Math.max.apply(null, betas) - Math.min.apply(null, betas);
      var gammaRange = Math.max.apply(null, gammas) - Math.min.apply(null, gammas);
      tiltRange = betaRange + gammaRange;
    }

    // Composite intensity (pressure is unreliable, so combine multiple signals)
    var intensity = 0;
    if (avgPressure > 0.1) {
      intensity = avgPressure;
    } else {
      // Fallback: use area + hold duration as proxy
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

    // High frequency + high intensity + shaking -> stressed
    scores.stressed += clamp01(frequency / 5) * 0.3;
    scores.stressed += clamp01(intensity) * 0.3;
    scores.stressed += clamp01(shakeIntensity / 15) * 0.4;

    // High frequency + low intensity -> excited
    scores.excited += clamp01(frequency / 4) * 0.5;
    scores.excited += clamp01(1 - intensity) * 0.3;
    scores.excited += clamp01(regularity) * 0.2;

    // Low frequency + low intensity -> calm
    scores.calm += clamp01(1 - frequency / 3) * 0.4;
    scores.calm += clamp01(1 - intensity) * 0.3;
    scores.calm += clamp01(1 - shakeIntensity / 10) * 0.3;

    // Irregular rhythm + medium intensity -> anxious
    scores.anxious += clamp01(1 - regularity) * 0.4;
    scores.anxious += clamp01(shakeIntensity / 10) * 0.3;
    scores.anxious += (intensity > 0.3 && intensity < 0.7 ? 0.3 : 0);

    // Low frequency + high intensity + stable -> focused
    scores.focused += clamp01(1 - frequency / 4) * 0.2;
    scores.focused += clamp01(intensity) * 0.3;
    scores.focused += clamp01(1 - shakeIntensity / 10) * 0.2;
    scores.focused += clamp01(regularity) * 0.3;

    // Very low frequency + soft + tilting -> sad
    scores.sad += clamp01(1 - frequency / 2) * 0.3;
    scores.sad += clamp01(1 - intensity) * 0.2;
    scores.sad += clamp01(tiltRange / 60) * 0.2;
    scores.sad += clamp01(avgHold / 400) * 0.3;

    // Edge case: no taps at all
    if (tapCount === 0) {
      scores.calm = 0.3;
      scores.sad = 0.7;
    }

    // Find winner
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
        avgHold: avgHold.toFixed(0)
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
      title: 'Стресс',
      description: 'Похоже, внутри накопилось напряжение. Твои тапы были резкими и частыми \u2014 тело говорит за тебя.',
      advice: [
        '\uD83C\uDF2C\uFE0F Сделай 5 глубоких вдохов: 4 сек вдох, 7 сек выдох',
        '\uD83D\uDEB6 Выйди на 10-минутную прогулку без телефона',
        '\uD83C\uDFB5 Включи спокойную музыку и закрой глаза на 3 минуты',
        '\u270D\uFE0F Запиши то, что тебя беспокоит \u2014 на бумаге проблемы кажутся меньше'
      ],
      faceClass: 'face-stressed'
    },
    excited: {
      emoji: '\uD83E\uDD29',
      title: 'Возбуждение / Энергия',
      description: 'Ты полон энергии! Быстрые лёгкие тапы говорят о приподнятом настроении и драйве.',
      advice: [
        '\uD83C\uDFAF Направь энергию в дело: начни задачу, которую откладывал',
        '\uD83C\uDFC3 Сходи на тренировку или пробежку',
        '\uD83C\uDFA8 Попробуй что-то творческое: рисование, музыка, письмо',
        '\uD83D\uDCAC Позвони другу и поделись хорошим настроением'
      ],
      faceClass: 'face-excited'
    },
    calm: {
      emoji: '\uD83D\uDE0C',
      title: 'Спокойствие',
      description: 'Ты в расслабленном состоянии. Мягкие, неторопливые тапы \u2014 признак внутреннего баланса.',
      advice: [
        '\uD83E\uDDD8 Хорошее время для медитации или йоги',
        '\uD83D\uDCD6 Почитай книгу или послушай подкаст',
        '\u2615 Завари чай и насладись моментом',
        '\uD83D\uDCDD Запиши 3 вещи, за которые благодарен сегодня'
      ],
      faceClass: 'face-calm'
    },
    anxious: {
      emoji: '\uD83D\uDE1F',
      title: 'Тревога',
      description: 'Нерегулярный ритм и лёгкая дрожь говорят о внутреннем беспокойстве. Это нормально.',
      advice: [
        '\uD83D\uDC63 Техника заземления 5-4-3-2-1: назови 5 вещей, которые видишь, 4 слышишь, 3 чувствуешь...',
        '\uD83E\uDDF4 Сожми и разожми кулаки 10 раз \u2014 сбрось напряжение из тела',
        '\uD83D\uDCAD Напиши тревожную мысль и рядом \u2014 самый реалистичный исход',
        '\uD83D\uDC9A Напомни себе: тревога \u2014 это временное состояние, не факт'
      ],
      faceClass: 'face-anxious'
    },
    focused: {
      emoji: '\uD83E\uDDD0',
      title: 'Сосредоточенность',
      description: 'Размеренные, уверенные тапы при стабильном телефоне. Ты в потоке.',
      advice: [
        '\uD83D\uDE80 Отличное время для сложных задач \u2014 лови поток!',
        '\uD83D\uDD07 Убери уведомления и поработай 25 минут по Помодоро',
        '\uD83C\uDFAF Запиши главную цель на сегодня и сфокусируйся на ней',
        '\uD83D\uDCA7 Не забудь пить воду \u2014 мозгу нужна гидратация'
      ],
      faceClass: 'face-focused'
    },
    sad: {
      emoji: '\uD83D\uDE14',
      title: 'Грусть / Меланхолия',
      description: 'Медленные тапы с долгим удержанием и наклоном устройства. Похоже, на душе тяжеловато.',
      advice: [
        '\uD83D\uDC9B Будь мягче к себе \u2014 грустить нормально',
        '\uD83D\uDCDE Позвони или напиши кому-то близкому',
        '\u2600\uFE0F Выйди на свежий воздух хотя бы на 5 минут',
        '\uD83C\uDFB6 Послушай любимую музыку или посмотри доброе видео'
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
      'Тапов: ' + result.stats.tapCount +
      ' | Частота: ' + result.stats.frequency + '/с' +
      ' | Ритмичность: ' + result.stats.regularity + '%' +
      (gyroAvailable ? ' | Тряска: ' + result.stats.shakeIntensity : '');
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

  faceContainer.addEventListener('pointerdown', onPointerDown);
  faceContainer.addEventListener('pointerup', onPointerUp);

  // Prevent context menu on long press
  faceContainer.addEventListener('contextmenu', function (e) {
    e.preventDefault();
  });
})();
