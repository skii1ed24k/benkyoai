const imageInput = document.getElementById("imageInput");
const fileInfo = document.getElementById("fileInfo");
const ocrStatus = document.getElementById("ocrStatus");
const analyzeBtn = document.getElementById("analyzeBtn");
const resultSection = document.getElementById("resultSection");
const extractedText = document.getElementById("extractedText");
const aiResult = document.getElementById("aiResult");

let selectedFiles = [];

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
      aiResult.textContent = data.ai_result;
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
