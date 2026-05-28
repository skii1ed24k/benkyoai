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
  analyzeBtn.textContent = "分析中...";
  resultSection.hidden = true;
  extractedText.textContent = "";
  aiResult.textContent = "";

  const formData = new FormData();
  formData.append("image", selectedFile);

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
