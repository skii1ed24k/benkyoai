const imageInput = document.getElementById("imageInput");
const fileInfo = document.getElementById("fileInfo");
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
});

analyzeBtn.addEventListener("click", async () => {
  if (selectedFiles.length === 0) return;

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "分析中...";
  resultSection.hidden = true;
  extractedText.textContent = "";
  aiResult.textContent = "";

  const formData = new FormData();
  selectedFiles.forEach((file) => formData.append("image", file));

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    if (response.ok) {
      resultSection.hidden = false;
      extractedText.textContent = data.text;
      aiResult.textContent = data.ai_result;
    } else {
      aiResult.textContent = `エラー: ${data.error}`;
      resultSection.hidden = false;
    }
  } catch (error) {
    aiResult.textContent = `通信エラー: ${error.message}`;
    resultSection.hidden = false;
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "問題を作成する";
  }
});
