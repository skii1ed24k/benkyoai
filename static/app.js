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

function renderQuiz(quiz, options = {}) {
  const questions = options.questions || quiz.questions.map((q, index) => ({
    ...q,
    originalIndex: index,
  }));

  if (!options.isRetry) {
    quizState = {
      quizTitle: quiz.title || "AI生成クイズ",
      quizLevel: quiz.level || "",
      originalQuestions: quiz.questions.map((q, index) => ({
        ...q,
        originalIndex: index,
      })),
      answers: Array(questions.length).fill(null),
      questions,
      isRetry: false,
    };
  } else {
    quizState = {
      ...quizState,
      questions,
      answers: Array(questions.length).fill(null),
      isRetry: true,
    };
  }

  quizContainer.innerHTML = "";

  const title = document.createElement("h3");
  title.textContent = options.isRetry ? "間違えた問題の再挑戦" : quizState.quizTitle;
  quizContainer.appendChild(title);

  const level = document.createElement("p");
  level.textContent = quizState.quizLevel ? `推定レベル: ${quizState.quizLevel}` : "";
  quizContainer.appendChild(level);

  quizState.questions.forEach((q, qi) => {
    const qDiv = document.createElement("div");
    qDiv.className = "quiz-question";
    const qText = document.createElement("p");
    qText.textContent = `${options.isRetry ? q.originalIndex + 1 : qi + 1}. ${q.question}`;
    qDiv.appendChild(qText);

    const choicesList = document.createElement("ul");
    choicesList.className = "choices";
    q.choices.forEach((choice, ci) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = choice;
      btn.addEventListener("click", () => handleAnswer(qDiv, q, qi, ci));
      li.appendChild(btn);
      choicesList.appendChild(li);
    });

    qDiv.appendChild(choicesList);
    quizContainer.appendChild(qDiv);
  });

  const summaryBox = document.createElement("div");
  summaryBox.id = "quizSummary";
  quizContainer.appendChild(summaryBox);
  updateQuizSummary();
}

function handleAnswer(questionDiv, question, questionIndex, selectedIndex) {
  if (!quizState || questionIndex == null) return;
  if (quizState.answers[questionIndex] !== null) return;

  quizState.answers[questionIndex] = selectedIndex;

  const choicesList = questionDiv.querySelector(".choices");
  if (choicesList) {
    Array.from(choicesList.querySelectorAll("button")).forEach(b => (b.disabled = true));
  }

  const isCorrect = selectedIndex === question.answer_index;
  const result = document.createElement("div");
  result.className = isCorrect ? "correct" : "incorrect";
  result.textContent = isCorrect ? "正解！" : `不正解。正しい答え: ${question.choices[question.answer_index]}`;
  questionDiv.appendChild(result);

  const expl = document.createElement("div");
  expl.className = "explanation";
  expl.textContent = question.explanation || "解説はありません。";
  questionDiv.appendChild(expl);

  updateQuizSummary();
}

function updateQuizSummary() {
  const summaryBox = document.getElementById("quizSummary");
  if (!summaryBox || !quizState) return;

  const answeredCount = quizState.answers.filter(ans => ans !== null).length;
  const totalCount = quizState.questions.length;
  summaryBox.innerHTML = "";

  if (answeredCount < totalCount) {
    summaryBox.textContent = `回答済み: ${answeredCount}/${totalCount}`;
    return;
  }

  const correctCount = quizState.questions.reduce((count, question, index) => {
    return count + (quizState.answers[index] === question.answer_index ? 1 : 0);
  }, 0);
  const accuracy = Math.round((correctCount / totalCount) * 100);

  const resultText = document.createElement("div");
  resultText.className = "quiz-result";
  resultText.textContent = `全 ${totalCount} 問中 ${correctCount} 問正解、正答率 ${accuracy}%`; 
  summaryBox.appendChild(resultText);

  const wrongIndices = quizState.questions
    .map((q, index) => ({
      originalIndex: q.originalIndex,
      index,
      isCorrect: quizState.answers[index] === q.answer_index,
    }))
    .filter(item => !item.isCorrect);

  if (wrongIndices.length > 0 && !quizState.isRetry) {
    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.textContent = `間違えた ${wrongIndices.length} 問をもう一度解く`;
    retryButton.addEventListener("click", () => {
      const retryQuestions = wrongIndices.map(item => quizState.questions[item.index]);
      renderQuiz({
        title: quizState.quizTitle,
        level: quizState.quizLevel,
        questions: retryQuestions,
      }, { isRetry: true, questions: retryQuestions });
    });
    summaryBox.appendChild(retryButton);
  } else if (wrongIndices.length === 0) {
    const perfect = document.createElement("div");
    perfect.className = "perfect-score";
    perfect.textContent = "全問正解です！おめでとうございます。";
    summaryBox.appendChild(perfect);
  }
}
