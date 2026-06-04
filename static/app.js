const imageInput = document.getElementById("imageInput");
const fileInfo = document.getElementById("fileInfo");
const ocrStatus = document.getElementById("ocrStatus");
const analyzeBtn = document.getElementById("analyzeBtn");
const resultSection = document.getElementById("resultSection");
const extractedText = document.getElementById("extractedText");
const aiResult = document.getElementById("aiResult");
const quizContainer = document.getElementById("quizContainer");

let selectedFiles = [];
let quizState = null;

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

imageInput.addEventListener("change", (event) => {
  selectedFiles = Array.from(event.target.files);
  analyzeBtn.disabled = selectedFiles.length === 0;
  if (selectedFiles.length === 0) {
    fileInfo.textContent = "選択された画像はありません。";
  } else {
    fileInfo.textContent = `${selectedFiles.length} 枚の画像が選択されました。`;
  }
  ocrStatus.textContent = "";
});

async function recognizeTextFromFiles(files) {
  const worker = Tesseract.createWorker({
    logger: (m) => {
      if (m.status === "recognizing text") {
        ocrStatus.textContent = `OCR中: ${Math.round(m.progress * 100)}%`;
      } else {
        ocrStatus.textContent = m.status;
      }
    },
  });

  await worker.load();
  await worker.loadLanguage("jpn+eng");
  await worker.initialize("jpn+eng");

  const chunks = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const { data } = await worker.recognize(file);
    chunks.push(`--- 画像 ${i + 1} ---\n${data.text.trim()}`);
  }

  await worker.terminate();
  return chunks.join("\n\n");
}

analyzeBtn.addEventListener("click", async () => {
  if (selectedFiles.length === 0) return;

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "分析中...";
  resultSection.hidden = true;
  extractedText.textContent = "";
  aiResult.textContent = "";
  ocrStatus.textContent = "OCRを開始しています...";

  try {
    const extracted = await recognizeTextFromFiles(selectedFiles);
    extractedText.textContent = extracted;
    resultSection.hidden = false;

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: extracted }),
    });

    const data = await response.json();
    if (response.ok) {
      // If backend returned structured JSON, render interactive quiz
      if (data.ai_result && typeof data.ai_result === "object" && data.ai_result.questions) {
        aiResult.textContent = "(クイズを表示しています)";
        renderQuiz(data.ai_result);
      } else {
        aiResult.textContent = data.ai_result;
        quizContainer.innerHTML = "";
      }
    } else {
      aiResult.textContent = `エラー: ${data.error}`;
    }
  } catch (error) {
    aiResult.textContent = `エラー: ${error.message}`;
    resultSection.hidden = false;
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "問題を作成する";
    ocrStatus.textContent = "";
  }
});

const choiceLabels = ["A", "B", "C", "D"];

function renderQuiz(quiz, options = {}) {
  const questions = options.questions || quiz.questions.map((q, index) => ({
    ...q,
    originalIndex: index,
  }));

  quizState = {
    quizTitle: quiz.title || "AI生成クイズ",
    quizLevel: quiz.level || "",
    originalQuestions: quiz.questions ? quiz.questions.map((q, index) => ({ ...q, originalIndex: index })) : [],
    questions,
    answers: Array(questions.length).fill(null),
    currentIndex: 0,
    isRetry: !!options.isRetry,
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

function showSummary() {
  quizContainer.innerHTML = "";
  const total = quizState.questions.length;
  const correct = quizState.questions.reduce((acc, q, idx) => acc + (quizState.answers[idx] === q.answer_index ? 1 : 0), 0);
  const accuracy = Math.round((correct / total) * 100);

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

  const wrong = quizState.questions
    .map((q, idx) => ({ q, idx }))
    .filter(item => quizState.answers[item.idx] !== item.q.answer_index);

  if (wrong.length > 0 && !quizState.isRetry) {
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.textContent = `間違えた ${wrong.length} 問をもう一度解く`;
    retryBtn.addEventListener('click', () => {
      const retryQuestions = wrong.map(item => ({ ...item.q }));
      renderQuiz({ title: quizState.quizTitle, level: quizState.quizLevel, questions: retryQuestions }, { isRetry: true });
    });
    quizContainer.appendChild(retryBtn);
  } else if (wrong.length === 0) {
    const perfect = document.createElement('div');
    perfect.className = 'perfect-score';
    perfect.textContent = '全問正解です！おめでとうございます。';
    quizContainer.appendChild(perfect);
  }
}
