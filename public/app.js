const imageInput = document.getElementById("imageInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const resultSection = document.getElementById("resultSection");
const extractedText = document.getElementById("extractedText");
const quizSection = document.getElementById("quizSection");
const quizContainer = document.getElementById("quizContainer");
const quizButtonGroup = document.getElementById("quizButtonGroup");
const retryBtn = document.getElementById("retryBtn");
const loadPhotoBtn = document.getElementById("loadPhotoBtn");
const adviceSection = document.getElementById("adviceSection");
const adviceContainer = document.getElementById("adviceContainer");
const adviceButtonGroup = document.getElementById("adviceButtonGroup");
const retryQuizBtn = document.getElementById("retryQuizBtn");
const newPhotoBtn = document.getElementById("newPhotoBtn");

let selectedFile = null;
let quizData = null;
let currentQuestionIndex = 0;
let extractedTextContent = null;
let userAnswers = [];

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

    extractedTextContent = text;
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
    if (typeof parsedResult === "string") {
      try {
        parsedResult = JSON.parse(parsedResult);
      } catch (e) {
        // If not JSON, treat as plain text
        parsedResult = { error: parsedResult };
      }
    }

    quizData = parsedResult;
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
  
  // Check if quizData is valid
  if (!quizData || !quizData.questions || !Array.isArray(quizData.questions) || quizData.questions.length === 0) {
    quizContainer.innerHTML = `<p>問題が見つかりません。</p><pre>${JSON.stringify(quizData, null, 2)}</pre>`;
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

  const selectedIndex = parseInt(selectedInput.value);
  const question = quizData.questions[currentQuestionIndex];
  const isCorrect = selectedIndex === question.answer_index;
  
  // Track user answer
  userAnswers.push({
    questionIndex: currentQuestionIndex,
    selected: selectedIndex,
    correct: isCorrect
  });

  let resultHtml = `<div class="quiz-result ${isCorrect ? "correct" : "incorrect"}">`;
  resultHtml += `<h3>${isCorrect ? "正解！" : "不正解"}</h3>`;
  resultHtml += `<p class="result-text"><strong>正解:</strong> ${escapeHtml(question.choices[question.answer_index])}</p>`;
  resultHtml += `<p class="explanation"><strong>解説:</strong> ${escapeHtml(question.explanation)}</p>`;
  resultHtml += `</div>`;

  quizContainer.innerHTML = resultHtml;
  quizButtonGroup.hidden = false;

  // Check if it's the last question
  if (currentQuestionIndex < quizData.questions.length - 1) {
    retryBtn.textContent = "次の問題へ";
    retryBtn.dataset.action = "next";
    retryBtn.style.display = "inline-block";
    loadPhotoBtn.style.display = "none";
  } else {
    retryBtn.textContent = "学習アドバイスを表示";
    retryBtn.dataset.action = "advice";
    loadPhotoBtn.style.display = "none";
  }
}

function retryCurrentQuestion() {
  displayQuestion(currentQuestionIndex);
}

async function showAdvice() {
  if (!extractedTextContent) {
    adviceContainer.innerHTML = "<p>テキストがありません。</p>";
    adviceSection.hidden = false;
    return;
  }

  adviceContainer.innerHTML = "<p>学習アドバイスを生成中...</p>";
  quizSection.hidden = true;
  adviceSection.hidden = false;

  try {
    const response = await fetch("/api/get-advice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: extractedTextContent }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "アドバイス取得に失敗しました。");
    }

    let advice = result.advice;
    if (typeof advice === "string") {
      try {
        advice = JSON.parse(advice);
      } catch (e) {
        advice = { error: advice };
      }
    }

    displayAdvice(advice);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    adviceContainer.innerHTML = `<p>エラー: ${escapeHtml(message)}</p>`;
  }
}

function displayAdvice(advice) {
  let html = "<div class='advice-content'>";

  if (advice.error) {
    html += `<p>${escapeHtml(advice.error)}</p>`;
  } else {
    // Key Topics
    if (advice.key_topics && Array.isArray(advice.key_topics)) {
      html += "<div class='advice-section'>";
      html += "<h3>📌 重要なトピック</h3>";
      html += "<ul>";
      advice.key_topics.forEach(topic => {
        html += `<li>${escapeHtml(topic)}</li>`;
      });
      html += "</ul></div>";
    }

    // Difficulty Areas
    if (advice.difficulty_areas && Array.isArray(advice.difficulty_areas)) {
      html += "<div class='advice-section'>";
      html += "<h3>⚠️ 難易度が高い項目</h3>";
      html += "<ul>";
      advice.difficulty_areas.forEach(area => {
        html += `<li>${escapeHtml(area)}</li>`;
      });
      html += "</ul></div>";
    }

    // Focus Points
    if (advice.focus_points && Array.isArray(advice.focus_points)) {
      html += "<div class='advice-section'>";
      html += "<h3>🎯 重点的に学ぶべき点</h3>";
      html += "<ul>";
      advice.focus_points.forEach(point => {
        html += `<li>${escapeHtml(point)}</li>`;
      });
      html += "</ul></div>";
    }

    // Study Recommendations
    if (advice.study_recommendations) {
      html += "<div class='advice-section'>";
      html += "<h3>💡 学習アドバイス</h3>";
      html += `<p>${escapeHtml(advice.study_recommendations)}</p></div>`;
    }

    // Related Concepts
    if (advice.related_concepts && Array.isArray(advice.related_concepts)) {
      html += "<div class='advice-section'>";
      html += "<h3>🔗 関連する概念</h3>";
      html += "<ul>";
      advice.related_concepts.forEach(concept => {
        html += `<li>${escapeHtml(concept)}</li>`;
      });
      html += "</ul></div>";
    }
  }

  html += "</div>";
  adviceContainer.innerHTML = html;
}

function nextQuestion() {
  if (currentQuestionIndex < quizData.questions.length - 1) {
    currentQuestionIndex++;
    displayQuestion(currentQuestionIndex);
  }
}

function loadAnotherPhoto() {
  // Reset all state
  selectedFile = null;
  quizData = null;
  currentQuestionIndex = 0;
  extractedTextContent = null;
  userAnswers = [];
  
  // Reset UI
  resultSection.hidden = true;
  quizSection.hidden = true;
  adviceSection.hidden = true;
  extractedText.textContent = "";
  quizContainer.innerHTML = "";
  adviceContainer.innerHTML = "";
  imageInput.value = "";
  analyzeBtn.disabled = true;
}

retryBtn.addEventListener("click", function() {
  if (retryBtn.dataset.action === "next") {
    nextQuestion();
  } else if (retryBtn.dataset.action === "advice") {
    showAdvice();
  } else {
    retryCurrentQuestion();
  }
});
loadPhotoBtn.addEventListener("click", loadAnotherPhoto);
retryQuizBtn.addEventListener("click", retryCurrentQuestion);
newPhotoBtn.addEventListener("click", loadAnotherPhoto);

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
