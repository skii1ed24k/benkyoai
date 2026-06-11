const imageInput = document.getElementById("imageInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const resultSection = document.getElementById("resultSection");
const extractedText = document.getElementById("extractedText");
const aiResult = document.getElementById("aiResult");

let selectedFile = null;

imageInput.addEventListener("change", (event) => {
  selectedFile = event.target.files[0];
  analyzeBtn.disabled = !selectedFile;
});

analyzeBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "OCR中...";
  resultSection.hidden = true;
  extractedText.textContent = "";
  aiResult.textContent = "";

  let worker = null;
  try {
    worker = Tesseract.createWorker({
      workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@2/dist/worker.min.js",
      corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@2.0.0/tesseract-core.wasm.js",
      langPath: "https://tessdata.projectnaptha.com/4.0.0",
      logger: (m) => {
        if (m.status === "recognizing text") {
          analyzeBtn.textContent = `OCR ${Math.round(m.progress * 100)}%`;
        }
      },
    });

    await worker.load();
    await worker.loadLanguage("jpn+eng");
    await worker.initialize("jpn+eng");

    const { data } = await worker.recognize(selectedFile);

    const text = data.text.trim();
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

    aiResult.textContent = typeof result.ai_result === "string"
      ? result.ai_result
      : JSON.stringify(result.ai_result, null, 2);
    resultSection.hidden = false;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    aiResult.textContent = `エラー: ${message}`;
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
