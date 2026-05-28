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

  try {
    const imageUrl = URL.createObjectURL(selectedFile);
    const worker = Tesseract.createWorker({
      logger: (m) => {
        if (m.status === "recognizing text") {
          analyzeBtn.textContent = `OCR ${Math.round(m.progress * 100)}%`;
        }
      },
    });

    await worker.load();
    await worker.loadLanguage("jpn+eng");
    await worker.initialize("jpn+eng");

    const { data } = await worker.recognize(imageUrl);
    await worker.terminate();

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

    aiResult.textContent = result.ai_result;
    resultSection.hidden = false;
  } catch (error) {
    aiResult.textContent = `エラー: ${error.message}`;
    resultSection.hidden = false;
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "問題を作成する";
  }
});
