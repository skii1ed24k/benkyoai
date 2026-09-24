const imageInput = document.getElementById("imageInput");
const fileInfo = document.getElementById("fileInfo");
const ocrStatus = document.getElementById("ocrStatus");
const analyzeBtn = document.getElementById("analyzeBtn");
const resultSection = document.getElementById("resultSection");
const aiResult = document.getElementById("aiResult");
const quizContainer = document.getElementById("quizContainer");

let selectedFiles = [];
let quizState = null;
const DEVICE_STORAGE_KEY = 'benkyoai-progress';

function getStoredProgress() {
  try {
    const raw = localStorage.getItem(DEVICE_STORAGE_KEY);
    if (!raw) {
      return {
        photos: {},
        loginDates: [],
        streak: 0,
      };
    }
    const parsed = JSON.parse(raw);
    return {
      photos: parsed.photos || {},
      loginDates: Array.isArray(parsed.loginDates) ? parsed.loginDates : [],
      streak: Number(parsed.streak) || 0,
    };
  } catch (error) {
    return {
      photos: {},
      loginDates: [],
      streak: 0,
    };
  }
}

function saveStoredProgress(progress) {
  try {
    localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(progress));
  } catch (error) {
    // ignore storage errors (private browsing / quota exceeded)
  }
}

function recordLoginDay() {
  const progress = getStoredProgress();
  const today = new Date().toISOString().slice(0, 10);
  const dates = new Set(progress.loginDates || []);
  dates.add(today);
  const sortedDates = [...dates].sort();
  let streak = 0;
  let cursor = new Date();
  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if (!sortedDates.includes(key)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  progress.loginDates = sortedDates;
  progress.streak = streak;
  saveStoredProgress(progress);
  return progress;
}

function recordPhotoUsage(photoKey, quizTitle, wrongQuestions = []) {
  const progress = getStoredProgress();
  if (!progress.photos) progress.photos = {};
  const dateKey = new Date().toISOString().slice(0, 10);
  const current = progress.photos[photoKey] || {
    count: 0,
    title: quizTitle || 'AI問題',
    wrongQuestions: [],
    firstUsedDate: dateKey,
    lastUsedDate: dateKey,
  };

  current.count = (current.count || 0) + 1;
  current.title = quizTitle || current.title || 'AI問題';
  current.lastUsedDate = dateKey;
  current.firstUsedDate = current.firstUsedDate || dateKey;
  current.wrongQuestions = Array.isArray(current.wrongQuestions) ? current.wrongQuestions : [];
  if (Array.isArray(wrongQuestions) && wrongQuestions.length > 0) {
    wrongQuestions.forEach((item) => {
      current.wrongQuestions.push({
        questionIndex: item.idx,
        question: item.q.question,
        selectedAnswer: item.selectedAnswer,
        correctAnswer: item.correctAnswer,
        date: dateKey,
      });
    });
  }
  progress.photos[photoKey] = current;
  saveStoredProgress(progress);
  return progress;
}

function readDeviceProgressSummary() {
  const progress = getStoredProgress();
  return {
    streak: progress.streak || 0,
    photos: progress.photos || {},
    loginDates: progress.loginDates || [],
  };
}

function renderStreakBadge() {
  const streakValue = document.getElementById('streakValue');
  if (!streakValue) return;

  const progress = readDeviceProgressSummary();
  const streak = progress.streak || 0;
  streakValue.innerHTML = `🔥 <span>${streak}</span>`;
}

// Simple WebAudio helper for feedback sounds
const FeedbackSound = {
  ctx: null,
  ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  },
  playTone(freq, when = 0, duration = 0.18, type = 'sine') {
    try {
      this.ensure();
      const ctx = this.ctx;
      const play = () => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.value = freq;
        o.connect(g);
        g.connect(ctx.destination);
        const now = ctx.currentTime + when;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
        o.start(now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        o.stop(now + duration + 0.02);
      };
      if (ctx.state === 'suspended') {
        ctx.resume().then(play).catch(() => {});
      } else {
        play();
      }
    } catch (e) {
      // ignore if audio context blocked or unavailable
    }
  },
  playCorrect() {
    // two rising tones
    this.playTone(740, 0, 0.16, 'sine');
    this.playTone(1040, 0.12, 0.12, 'sine');
  },
  playIncorrect() {
    // low buzzer
    this.playTone(180, 0, 0.28, 'sawtooth');
  }
};

imageInput.addEventListener("change", async (event) => {
  selectedFiles = Array.from(event.target.files);
  analyzeBtn.disabled = selectedFiles.length === 0;
  if (selectedFiles.length > 0) {
    const file = selectedFiles[0];
    const stablePhotoKey = await getStablePhotoKey(file);
    file._stablePhotoKey = stablePhotoKey;
    photoFingerprintCache.set(`${file.name || 'photo'}-${file.size || 0}-${file.lastModified || 0}-${file.type || 'unknown'}`, stablePhotoKey);
    fileInfo.textContent = `${selectedFiles.length} 枚の画像が選択されました。`;
  } else {
    fileInfo.textContent = "選択された画像はありません。";
  }
  ocrStatus.textContent = "";
});

async function recognizeTextFromFiles(files) {
  let worker = null;
  try {
    worker = Tesseract.createWorker({
      workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@4.0.4/dist/worker.min.js",
      corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@4.0.4/tesseract-core.wasm.js",
      langPath: "https://tessdata.projectnaptha.com/4.0.0",
      logger: (m) => {
        if (m.status === "recognizing text") {
          ocrStatus.textContent = `OCR中: ${Math.round(m.progress * 100)}%`;
        } else {
          ocrStatus.textContent = m.status;
        }
      },
    });

    const chunks = [];
    if (worker && typeof worker.load === "function") {
      await worker.load();
      await worker.loadLanguage("jpn");
      await worker.initialize("jpn");

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const { data } = await worker.recognize(file);
        chunks.push(`--- 画像 ${i + 1} ---\n${data.text.trim()}`);
      }
    } else {
      // Fallback to Tesseract.recognize per-file
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const { data } = await Tesseract.recognize(file, "jpn", {
          logger: (m) => {
            if (m.status === "recognizing text") {
              ocrStatus.textContent = `OCR中: ${Math.round(m.progress * 100)}%`;
            } else {
              ocrStatus.textContent = m.status;
            }
          },
        });
        chunks.push(`--- 画像 ${i + 1} ---\n${data.text.trim()}`);
      }
    }

    return chunks.join("\n\n");
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch (terminateError) {
        // ignore termination errors
      }
    }
  }
}

analyzeBtn.addEventListener("click", async () => {
  if (selectedFiles.length === 0) return;

  recordLoginDay();
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "分析中...";
  resultSection.hidden = true;
  aiResult.textContent = "";
  aiResult.hidden = true;
  ocrStatus.textContent = "OCRを開始しています...";

  try {
    recordLoginDay();
    renderStreakBadge();
    const extracted = await recognizeTextFromFiles(selectedFiles);
    resultSection.hidden = false;

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: extracted }),
    });

    const data = await response.json();
    if (response.ok) {
      if (typeof data.ai_result === "undefined" || data.ai_result === null) {
        throw new Error("APIの応答に問題がありました。再度お試しください。");
      }

      // If backend returned structured JSON, render interactive quiz
      if (typeof data.ai_result === "object" && data.ai_result.questions) {
        aiResult.hidden = true;
        const photoKey = await getStablePhotoKey(selectedFiles[0]);
        if (quizState) {
          quizState.photoKey = photoKey;
        }
        renderQuiz({ ...data.ai_result, photoKey });
      } else {
        aiResult.hidden = false;
        aiResult.textContent = typeof data.ai_result === "string"
          ? data.ai_result
          : JSON.stringify(data.ai_result, null, 2);
        quizContainer.innerHTML = "";
      }
    } else {
      aiResult.hidden = false;
      aiResult.textContent = `エラー: ${data.error || "不明なエラー"}`;
    }
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    aiResult.hidden = false;
    aiResult.textContent = `エラー: ${message}`;
    resultSection.hidden = false;
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "問題を作成する";
    ocrStatus.textContent = "";
  }
});

const choiceLabels = ["A", "B", "C", "D"];
const photoAttemptHistory = new Map();
const photoFingerprintCache = new Map();

recordLoginDay();
renderStreakBadge();

function buildPhotoFingerprint(file, extraText = '') {
  const seed = (file ? `${file.name || 'photo'}-${file.size || 0}-${file.lastModified || 0}-${file.type || 'unknown'}` : '') + (extraText || '');
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `photo-${hash.toString(16)}`;
}

function getStablePhotoKey(file) {
  if (!file) {
    const fingerprint = quizState && quizState.quizTitle ? quizState.quizTitle : 'manual';
    return `session-${fingerprint}`;
  }

  const cacheKey = `${file.name || 'photo'}-${file.size || 0}-${file.lastModified || 0}-${file.type || 'unknown'}`;
  if (photoFingerprintCache.has(cacheKey)) {
    return photoFingerprintCache.get(cacheKey);
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = reader.result;
        const buffer = data instanceof ArrayBuffer ? data : await new Response(file).arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const key = Array.from(new Uint8Array(hashBuffer))
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
        const finalKey = `photo-${key}`;
        photoFingerprintCache.set(cacheKey, finalKey);
        resolve(finalKey);
      } catch (error) {
        const fallback = buildPhotoFingerprint(file, file.name || '');
        photoFingerprintCache.set(cacheKey, fallback);
        resolve(fallback);
      }
    };
    reader.onerror = () => {
      const fallback = buildPhotoFingerprint(file, file.name || '');
      photoFingerprintCache.set(cacheKey, fallback);
      resolve(fallback);
    };
    reader.readAsArrayBuffer(file);
  });
}

function getCurrentPhotoKey() {
  if (selectedFiles && selectedFiles.length > 0) {
    const file = selectedFiles[0];
    const stableKey = file && file._stablePhotoKey;
    if (stableKey) return stableKey;
    const cacheKey = `${file.name || 'photo'}-${file.size || 0}-${file.lastModified || 0}-${file.type || 'unknown'}`;
    return photoFingerprintCache.get(cacheKey) || buildPhotoFingerprint(file, file.name || '');
  }

  if (quizState && quizState.photoKey) {
    return quizState.photoKey;
  }

  const fingerprint = quizState && quizState.quizTitle ? quizState.quizTitle : 'manual';
  return `session-${fingerprint}`;
}

function savePhotoAttemptSummary(summary) {
  const key = summary.photoKey || getCurrentPhotoKey();
  const history = photoAttemptHistory.get(key) || [];
  history.push(summary);
  photoAttemptHistory.set(key, history);
  return history;
}

function getImprovementMessage() {
  const key = getCurrentPhotoKey();
  const history = photoAttemptHistory.get(key) || [];

  if (history.length < 2) {
    return null;
  }

  const previous = history[history.length - 2];
  const current = history[history.length - 1];
  const mismatchReduction = previous.wrongCount - current.wrongCount;
  const accuracyImprovement = current.accuracy - previous.accuracy;

  if (current.wrongCount === 0 && previous.wrongCount > 0) {
    return `前回は ${previous.wrongCount} 問間違えていましたが、今回は ${current.correct} / ${current.total} 問で全問正解です。改善したポイントは「${previous.mistakeFocus || '間違えた箇所の理解'}」を克服したことです。`;
  }

  if (mismatchReduction > 0 || accuracyImprovement > 0) {
    return `前回より ${mismatchReduction > 0 ? `${mismatchReduction} 問改善` : `${accuracyImprovement}% 改善`} しました。特に ${previous.mistakeFocus || '苦手だった部分'} を克服できたのが大きいです。`;
  }

  return `前回と同じように取り組みましたが、今回も安定して ${current.correct} / ${current.total} 問の成績でした。`;
}

function renderQuiz(quiz, options = {}) {
  const questions = options.questions || quiz.questions.map((q, index) => ({
    ...q,
    originalIndex: index,
  }));

  const photoKey = quiz.photoKey || getCurrentPhotoKey();
  quizState = {
    quizTitle: quiz.title || "AI生成クイズ",
    quizLevel: quiz.level || "",
    originalQuestions: quiz.questions ? quiz.questions.map((q, index) => ({ ...q, originalIndex: index })) : [],
    questions,
    answers: Array(questions.length).fill(null),
    currentIndex: 0,
    isRetry: !!options.isRetry,
    countAttempt: options.countAttempt !== false,
    photoKey,
  };

  renderQuestion();
}

function renderQuestion() {
  quizContainer.innerHTML = "";

  const header = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = quizState.isRetry ? "間違えた問題の再挑戦" : quizState.quizTitle;
  header.appendChild(title);
  const level = document.createElement("p");
  level.textContent = quizState.quizLevel ? `推定レベル: ${quizState.quizLevel}` : "";
  header.appendChild(level);
  quizContainer.appendChild(header);

  const q = quizState.questions[quizState.currentIndex];
  const qDiv = document.createElement("div");
  qDiv.className = "quiz-question";
  const qText = document.createElement("p");
  const displayNumber = q.originalIndex != null ? q.originalIndex + 1 : quizState.currentIndex + 1;
  qText.textContent = `${displayNumber}. ${q.question}`;
  qDiv.appendChild(qText);

  const choicesList = document.createElement("ul");
  choicesList.className = "choices";
  q.choices.forEach((choice, ci) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    const label = choiceLabels[ci] || `${ci + 1}`;
    btn.textContent = `${label}. ${choice}`;
    btn.addEventListener("click", () => selectChoice(ci));
    li.appendChild(btn);
    choicesList.appendChild(li);
  });

  qDiv.appendChild(choicesList);
  quizContainer.appendChild(qDiv);

  const controlBar = document.createElement("div");
  controlBar.className = "control-bar";
  const progress = document.createElement("div");
  progress.textContent = `問題 ${quizState.currentIndex + 1}/${quizState.questions.length}`;
  controlBar.appendChild(progress);

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.textContent = quizState.currentIndex + 1 === quizState.questions.length ? "結果を見る" : "次へ";
  nextBtn.disabled = true;
  nextBtn.addEventListener("click", () => {
    if (quizState.currentIndex + 1 >= quizState.questions.length) {
      showSummary();
    } else {
      quizState.currentIndex += 1;
      renderQuestion();
    }
  });
  controlBar.appendChild(nextBtn);

  quizContainer.appendChild(controlBar);

  // expose helper to enable next when answered
  quizContainer._enableNext = () => { nextBtn.disabled = false; };
}

function selectChoice(selectedIndex) {
  const q = quizState.questions[quizState.currentIndex];
  if (!q) return;
  if (quizState.answers[quizState.currentIndex] !== null) return;

  quizState.answers[quizState.currentIndex] = selectedIndex;

  const qDiv = quizContainer.querySelector('.quiz-question');
  const choicesBtns = qDiv.querySelectorAll('button');
  choicesBtns.forEach(b => b.disabled = true);

  const isCorrect = selectedIndex === q.answer_index;
  const answerLabel = choiceLabels[selectedIndex] || `${selectedIndex + 1}`;
  const correctLabel = choiceLabels[q.answer_index] || `${q.answer_index + 1}`;
  const selectedText = q.choices[selectedIndex];
  const correctText = q.choices[q.answer_index];

  const result = document.createElement("div");
  result.className = isCorrect ? "correct" : "incorrect";

  const icon = document.createElement("div");
  icon.className = "result-icon";
  if (isCorrect) {
    icon.textContent = "⭕";
  } else {
    icon.textContent = "❌";
  }

  const textSpan = document.createElement("div");
  textSpan.className = "result-text";
  textSpan.textContent = isCorrect
    ? `正解！ 問${(q.originalIndex||quizState.currentIndex)+1}: ${answerLabel}. ${selectedText}`
    : `不正解。問${(q.originalIndex||quizState.currentIndex)+1} の正解は ${correctLabel}. ${correctText}`;

  result.appendChild(icon);
  result.appendChild(textSpan);
  qDiv.appendChild(result);

  const feedbackMascot = document.createElement("div");
  feedbackMascot.className = `feedback-mascot ${isCorrect ? "feedback-correct" : "feedback-incorrect"}`;
  const mascot = document.querySelector(".mascot");
  if (mascot) {
    const mascotCopy = mascot.cloneNode(true);
    mascotCopy.classList.add(isCorrect ? "mascot-celebrate" : "mascot-encourage");
    feedbackMascot.appendChild(mascotCopy);
  }
  qDiv.appendChild(feedbackMascot);

  const expl = document.createElement("div");
  expl.className = "explanation";
  expl.textContent = `解説: ${q.explanation || "解説はありません。"}`;
  qDiv.appendChild(expl);
  // play sound and animate icon
  setTimeout(() => {
    if (isCorrect) {
      icon.classList.add('pop');
      FeedbackSound.playCorrect();
    } else {
      icon.classList.add('shake');
      FeedbackSound.playIncorrect();
    }
    // remove animation class after it finishes
    setTimeout(() => { icon.classList.remove('pop'); icon.classList.remove('shake'); }, 800);
  }, 40);

  if (quizContainer._enableNext) quizContainer._enableNext();
}

function getWrongQuestions() {
  return quizState.questions
    .map((q, idx) => ({
      q,
      idx,
      selectedAnswerIndex: quizState.answers[idx],
      selectedAnswer: quizState.answers[idx] != null ? q.choices[quizState.answers[idx]] : null,
      correctAnswer: q.choices[q.answer_index],
    }))
    .filter(item => item.selectedAnswerIndex !== item.q.answer_index);
}

function analyzeWeakAreas(wrongQuestions) {
  const stopWords = new Set([
    'の', 'は', 'が', 'を', 'に', 'と', 'で', 'た', 'て', 'ている', 'する', 'した', 'など', 'より',
    'ある', 'ない', 'こと', 'これ', 'それ', 'あれ', 'どれ', '問題', '選択肢', '答え', '解説', 'わかる'
  ]);

  const termCounts = new Map();

  wrongQuestions.forEach(({ q }) => {
    const source = `${q.question} ${q.explanation || ''}`;
    const matches = source.match(/[A-Za-z一-龠ぁ-んァ-ン0-9]+/g) || [];

    matches.forEach((word) => {
      const normalized = word
        .replace(/[0-9]/g, '')
        .replace(/[A-Za-z]{1,2}/g, '')
        .trim();

      if (!normalized || normalized.length < 2 || stopWords.has(normalized.toLowerCase())) {
        return;
      }

      termCounts.set(normalized, (termCounts.get(normalized) || 0) + 1);
    });
  });

  const topTerms = [...termCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([term]) => term);

  if (topTerms.length > 0) {
    return topTerms.map((term, index) => `苦手分野 ${index + 1}: ${term}`);
  }

  return wrongQuestions.map((item, index) => `間違えた問題 ${index + 1}: ${item.q.question.slice(0, 24)}...`);
}

function showWeaknessAnalysis() {
  const wrongQuestions = getWrongQuestions();
  const weakAreas = analyzeWeakAreas(wrongQuestions);
  const improvementMessage = getImprovementMessage();

  quizContainer.innerHTML = '';

  const analysisWrap = document.createElement('div');
  analysisWrap.className = 'analysis-wrap';

  const heading = document.createElement('h3');
  heading.textContent = wrongQuestions.length === 0 ? '全問正解の分析' : '誤答分析';
  analysisWrap.appendChild(heading);

  const summary = document.createElement('p');
  summary.className = 'summary-text';
  if (wrongQuestions.length === 0) {
    summary.textContent = 'この写真では全問正解でした。完璧な理解ができています。次は安定して再現できるよう、解法の流れを意識して復習しましょう。';
  } else {
    summary.textContent = `間違えた問題は ${wrongQuestions.length} 問です。苦手な分野を確認して、次の学習に活かしましょう。`;
  }
  analysisWrap.appendChild(summary);

  if (improvementMessage) {
    const improvement = document.createElement('p');
    improvement.className = 'summary-text';
    improvement.textContent = improvementMessage;
    analysisWrap.appendChild(improvement);
  }

  if (wrongQuestions.length === 0 && (!photoAttemptHistory.get(getCurrentPhotoKey()) || photoAttemptHistory.get(getCurrentPhotoKey()).length < 2)) {
    const praise = document.createElement('p');
    praise.className = 'perfect-score';
    praise.textContent = '1回目で全問正解です。すごいです！この調子で定着を続けましょう。';
    analysisWrap.appendChild(praise);
  }

  const weakAreaList = document.createElement('ul');
  weakAreaList.className = 'weak-area-list';
  weakAreas.forEach((area) => {
    const item = document.createElement('li');
    item.textContent = area;
    weakAreaList.appendChild(item);
  });
  analysisWrap.appendChild(weakAreaList);

  if (wrongQuestions.length > 0) {
    const details = document.createElement('div');
    details.className = 'mistake-detail';

    wrongQuestions.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'mistake-card';

      const questionTitle = document.createElement('strong');
      questionTitle.textContent = `問題 ${item.idx + 1}`;

      const questionText = document.createElement('p');
      questionText.textContent = item.q.question;

      const answerInfo = document.createElement('p');
      answerInfo.textContent = `正解: ${item.correctAnswer} / あなたの回答: ${item.selectedAnswer || '未回答'}`;

      const explanation = document.createElement('p');
      explanation.textContent = `解説: ${item.q.explanation || '解説はありません。'}`;

      card.appendChild(questionTitle);
      card.appendChild(questionText);
      card.appendChild(answerInfo);
      card.appendChild(explanation);
      details.appendChild(card);
    });

    analysisWrap.appendChild(details);
  }

  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'summary-button-group';

  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.textContent = wrongQuestions.length === 0 ? 'もう一度この問題を解く' : '間違えた問題をもう一度解く';
  retryBtn.addEventListener('click', () => {
    const retryQuestions = wrongQuestions.length > 0
      ? wrongQuestions.map(item => ({ ...item.q }))
      : quizState.questions.map(q => ({ ...q }));
    renderQuiz({ title: quizState.quizTitle, level: quizState.quizLevel, questions: retryQuestions, photoKey: quizState.photoKey }, { isRetry: true, countAttempt: false });
  });
  buttonContainer.appendChild(retryBtn);

  const finishBtn = document.createElement('button');
  finishBtn.type = 'button';
  finishBtn.className = 'finish-btn';
  finishBtn.textContent = '終了';
  finishBtn.addEventListener('click', () => {
    quizState = null;
    imageInput.value = '';
    resultSection.hidden = true;
    quizContainer.innerHTML = '';
    analyzeBtn.disabled = true;
  });
  buttonContainer.appendChild(finishBtn);

  analysisWrap.appendChild(buttonContainer);
  quizContainer.appendChild(analysisWrap);
}

function showSummary() {
  quizContainer.innerHTML = "";
  const total = quizState.questions.length;
  const correct = quizState.questions.reduce((acc, q, idx) => acc + (quizState.answers[idx] === q.answer_index ? 1 : 0), 0);
  const accuracy = Math.round((correct / total) * 100);
  const currentPhotoKey = quizState.photoKey || getCurrentPhotoKey();
  const historyBeforeSave = photoAttemptHistory.get(currentPhotoKey) || [];

  const summaryWrap = document.createElement('div');
  summaryWrap.className = 'summary-wrap';

  // Donut chart
  const donut = document.createElement('div');
  donut.className = 'donut-container';
  const svgNS = 'http://www.w3.org/2000/svg';
  const size = 140;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.classList.add('donut-svg');

  const g = document.createElementNS(svgNS, 'g');
  g.setAttribute('transform', `translate(${size/2}, ${size/2})`);

  const bgCircle = document.createElementNS(svgNS, 'circle');
  bgCircle.setAttribute('r', r.toString());
  bgCircle.setAttribute('cx', '0');
  bgCircle.setAttribute('cy', '0');
  bgCircle.setAttribute('fill', 'none');
  bgCircle.setAttribute('stroke', 'rgba(15,23,42,0.06)');
  bgCircle.setAttribute('stroke-width', stroke.toString());

  const prog = document.createElementNS(svgNS, 'circle');
  prog.setAttribute('r', r.toString());
  prog.setAttribute('cx', '0');
  prog.setAttribute('cy', '0');
  prog.setAttribute('fill', 'none');
  prog.setAttribute('stroke', '#3346f0');
  prog.setAttribute('stroke-width', stroke.toString());
  prog.setAttribute('stroke-linecap', 'round');
  prog.setAttribute('transform', 'rotate(-90)');
  prog.setAttribute('stroke-dasharray', `${c} ${c}`);
  const offset = Math.round(c * (1 - accuracy / 100));
  // start full and animate to offset
  prog.setAttribute('stroke-dashoffset', c.toString());
  prog.classList.add('donut-progress');

  // set CSS var color on container to match correct color
  donut.style.setProperty('--donut-color', getComputedStyle(document.documentElement).getPropertyValue('--correct-color') || '#10B981');

  // force paint then animate to final offset
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      prog.setAttribute('stroke-dashoffset', offset.toString());
    });
  });

  g.appendChild(bgCircle);
  g.appendChild(prog);
  svg.appendChild(g);

  const center = document.createElement('div');
  center.className = 'donut-center';
  center.innerHTML = `<div class="donut-percent">${accuracy}%</div><div class="donut-label">正答率</div>`;

  donut.appendChild(svg);
  donut.appendChild(center);
  summaryWrap.appendChild(donut);

  const textSummary = document.createElement('div');
  textSummary.className = 'summary-text';
  textSummary.innerText = `全 ${total} 問中 ${correct} 問正解`;
  summaryWrap.appendChild(textSummary);

  quizContainer.appendChild(summaryWrap);

  // animate percent count up
  const percentEl = summaryWrap.querySelector('.donut-percent');
  if (percentEl) {
    let start = null;
    const duration = 900;
    const from = 0;
    const to = accuracy;
    function step(ts) {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const current = Math.round(from + (to - from) * progress);
      percentEl.textContent = `${current}%`;
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  const wrong = getWrongQuestions();
  const shouldCountAttempt = quizState.countAttempt !== false && !quizState.isRetry;
  let attemptHistory = historyBeforeSave;

  if (shouldCountAttempt) {
    attemptHistory = savePhotoAttemptSummary({
      photoKey: currentPhotoKey,
      total,
      correct,
      wrongCount: wrong.length,
      accuracy,
      mistakeFocus: analyzeWeakAreas(wrong)[0] || '重点理解',
      attemptNumber: historyBeforeSave.length + 1,
    });
    recordPhotoUsage(currentPhotoKey, quizState.quizTitle || 'AI問題', wrong);
  }

  const improvementMessage = getImprovementMessage();

  const textMeta = document.createElement('p');
  textMeta.className = 'summary-text';
  textMeta.textContent = shouldCountAttempt
    ? `この写真を ${attemptHistory.length} 回取り組みました。`
    : '同じ問題の再挑戦としては回数に含めません。';
  summaryWrap.appendChild(textMeta);

  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'summary-button-group';

  if (wrong.length === 0) {
    const perfect = document.createElement('div');
    perfect.className = 'perfect-score';
    perfect.textContent = attemptHistory.length === 1
      ? '全問正解です！初回で完璧でした。すごいですね。'
      : `全問正解です！この写真に ${attemptHistory.length} 回取り組んで、${improvementMessage ? '前回から改善されています。' : '安定して正解できています。'}`;
    quizContainer.appendChild(perfect);
  }

  const actionBtn = document.createElement('button');
  actionBtn.type = 'button';
  actionBtn.className = 'finish-btn';
  actionBtn.textContent = '考察する';
  actionBtn.addEventListener('click', () => {
    showWeaknessAnalysis();
  });
  buttonContainer.appendChild(actionBtn);

  if (wrong.length > 0 || buttonContainer.children.length > 0) {
    quizContainer.appendChild(buttonContainer);
  }
}
