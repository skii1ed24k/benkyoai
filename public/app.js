const imageInput = document.getElementById("imageInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const resultSection = document.getElementById("resultSection");
const extractedText = document.getElementById("extractedText");
const quizSection = document.getElementById("quizSection");
const quizContainer = document.getElementById("quizContainer");
const quizButtonGroup = document.getElementById("quizButtonGroup");
const retryBtn = document.getElementById("retryBtn");
const loadPhotoBtn = document.getElementById("loadPhotoBtn");

let selectedFile = null;
let quizData = null;
let currentQuestionIndex = 0;

imageInput.addEventListener("change", (event) => {
  selectedFile = event.target.files[0];
  analyzeBtn.disabled = !selectedFile;
});

analyzeBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "OCR中...";
  resultSection.hidden = true;
  quizSection.hidden = true;
  extractedText.textContent = "";

  let worker = null;
  try {
    worker = Tesseract.createWorker({
      workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@4.0.4/dist/worker.min.js",
      corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@4.0.4/tesseract-core.wasm.js",
      langPath: "https://tessdata.projectnaptha.com/4.0.0",
      logger: (m) => {
        if (m.status === "recognizing text") {
          analyzeBtn.textContent = `OCR ${Math.round(m.progress * 100)}%`;
        }
      },
    });

    let text = "";
    // Prefer worker API, but fall back to Tesseract.recognize if worker lacks load()
    if (worker && typeof worker.load === "function") {
      await worker.load();
      await worker.loadLanguage("jpn");
      await worker.initialize("jpn");

      const { data } = await worker.recognize(selectedFile);
      text = data.text.trim();
    } else {
      // Fallback: some environments/CDNs expose only the simpler recognize API
      const { data } = await Tesseract.recognize(selectedFile, "jpn", {
        logger: (m) => {
          if (m.status === "recognizing text") {
            analyzeBtn.textContent = `OCR ${Math.round(m.progress * 100)}%`;
          }
        },
      });
      text = data.text.trim();
    }
    if (!text) {
      throw new Error("画像からテキストを抽出できませんでした。");
    }

    extractedText.textContent = text;
    analyzeBtn.textContent = "AI解析中...";

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "API解析に失敗しました。");
    }

    if (typeof result.ai_result === "undefined" || result.ai_result === null) {
      throw new Error("APIの応答に問題がありました。再度お試しください。");
    }

    // Try to parse AI result as JSON for structured quiz data
    let parsedResult = result.ai_result;
    let rawResult = null;
    if (typeof parsedResult === "string") {
      try {
        parsedResult = JSON.parse(parsedResult);
      } catch (e) {
        rawResult = parsedResult;
        parsedResult = null;
      }
    }

    if (!parsedResult || typeof parsedResult !== "object") {
      quizData = { questions: [], rawOutput: rawResult || String(result.ai_result) };
    } else {
      quizData = parsedResult;
    }

    currentQuestionIndex = 0;
    resultSection.hidden = false;
    displayQuiz();
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    extractedText.textContent = `エラー: ${message}`;
    resultSection.hidden = false;
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch (terminateError) {
        // ignore termination errors
      }
    }
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "問題を作成する";
  }
});

// Quiz display functions
function displayQuiz() {
  quizSection.hidden = false;
  
  if (!quizData || !Array.isArray(quizData.questions) || quizData.questions.length === 0) {
    const rawOutput = quizData && quizData.rawOutput ? quizData.rawOutput : "クイズデータが見つかりませんでした。";
    quizContainer.innerHTML = `
      <div class="quiz-error">
        <p>問題を生成できませんでした。AIの応答を表示します：</p>
        <pre>${escapeHtml(rawOutput)}</pre>
      </div>
    `;
    quizButtonGroup.hidden = true;
    return;
  }

  displayQuestion(currentQuestionIndex);
}

function displayQuestion(index) {
  if (!quizData.questions || index >= quizData.questions.length) {
    quizContainer.innerHTML = "<p>すべての問題が終了しました。</p>";
    quizButtonGroup.hidden = true;
    return;
  }

  const question = quizData.questions[index];
  let html = `<div class="quiz-question">`;
  
  html += `<h3>問題 ${index + 1}/${quizData.questions.length}</h3>`;
  html += `<p class="question-text">${escapeHtml(question.question)}</p>`;
  
  html += `<div class="choices">`;
  question.choices.forEach((choice, i) => {
    html += `
      <label class="choice-label">
        <input type="radio" name="answer" value="${i}" />
        <span>${escapeHtml(choice)}</span>
      </label>
    `;
  });
  html += `</div>`;
  
  html += `<button id="submitBtn" class="submit-btn">回答する</button>`;
  html += `</div>`;
  
  quizContainer.innerHTML = html;
  quizButtonGroup.hidden = true;

  // Add submit handler
  document.getElementById("submitBtn").addEventListener("click", checkAnswer);
}

function checkAnswer() {
  const selectedInput = document.querySelector('input[name="answer"]:checked');
  if (!selectedInput) {
    alert("選択肢を選んでください");
    return;
  }

  const selectedIndex = parseInt(selectedInput.value, 10);
  const question = quizData.questions[currentQuestionIndex] || {};
  const answerIndex = Number.isInteger(question.answer_index) ? question.answer_index : -1;
  const isCorrect = answerIndex >= 0 ? selectedIndex === answerIndex : false;
  const correctChoice = Array.isArray(question.choices) && question.choices[answerIndex]
    ? question.choices[answerIndex]
    : question.choices && question.choices[selectedIndex]
      ? question.choices[selectedIndex]
      : "(正解情報なし)";
  const explanation = question.explanation || "解説はありません。";

  let resultHtml = `<div class="quiz-result ${isCorrect ? "correct" : "incorrect"}">`;
  resultHtml += `<h3>${isCorrect ? "正解！" : "不正解"}</h3>`;
  resultHtml += `<p class="result-text"><strong>正解:</strong> ${escapeHtml(correctChoice)}</p>`;
  resultHtml += `<p class="explanation"><strong>解説:</strong> ${escapeHtml(explanation)}</p>`;
  resultHtml += `</div>`;

  quizContainer.innerHTML = resultHtml;
  quizButtonGroup.hidden = false;

  // Update button text based on whether it's the last question
  if (currentQuestionIndex < quizData.questions.length - 1) {
    retryBtn.textContent = "再々挑戦";
  } else {
    retryBtn.textContent = "最後の問題に戻る";
  }
}

function retryCurrentQuestion() {
  displayQuestion(currentQuestionIndex);
}

function loadAnotherPhoto() {
  // Reset all state
  selectedFile = null;
  quizData = null;
  currentQuestionIndex = 0;
  
  // Reset UI
  resultSection.hidden = true;
  quizSection.hidden = true;
  extractedText.textContent = "";
  quizContainer.innerHTML = "";
  imageInput.value = "";
  analyzeBtn.disabled = true;
}

retryBtn.addEventListener("click", retryCurrentQuestion);
loadPhotoBtn.addEventListener("click", loadAnotherPhoto);

// Helper function to escape HTML
function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}
