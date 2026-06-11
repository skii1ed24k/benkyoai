import os
from flask import Flask, request, jsonify
import io
import base64
from PIL import Image

try:
    import pytesseract
except ImportError:
    pytesseract = None

app = Flask(__name__)

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
TESSERACT_CMD = os.environ.get("TESSERACT_CMD")
if pytesseract and TESSERACT_CMD:
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD

try:
    import openai
    if OPENAI_API_KEY:
        openai.api_key = OPENAI_API_KEY
except ImportError:
    openai = None


@app.route("/", methods=["POST"])
def analyze():
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "JSON形式でテキストを送信してください。"}), 400

    text = payload.get("text", "").strip()
    if not text:
        return jsonify({"error": "テキストがありません。"}), 400

    if openai and OPENAI_API_KEY:
        prompt = (
            "以下の教科書の内容を読み取り、\n"
            "1) 重要な問題を3問作成してください。\n"
            "2) その範囲の理解レベルを「基礎」「標準」「発展」で評価してください。\n"
            "3) 簡潔な解説を記載してください。\n"
            "内容:\n" + text
        )
        try:
            response = openai.ChatCompletion.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "あなたは日本語の教育アシスタントです。"},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.7,
                max_tokens=800,
            )
            ai_result = response.choices[0].message.content.strip()
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500
    else:
        level = "基礎"
        if len(text) > 400:
            level = "標準"
        if len(text) > 900:
            level = "発展"
        ai_result = (
            "AI連携が未設定のため、簡易問題を表示します。\n"
            f"理解レベルの推定: {level}\n\n"
            "問題:\n"
            "1. ここで説明されている主要なポイントは何ですか？\n"
            "2. 重要な用語や公式を1つ挙げて、その意味を説明してください。\n"
            "3. 学んだ内容を自分の言葉でまとめてください。\n"
        )

    return jsonify({"ai_result": ai_result})


@app.route("/ocr", methods=["POST"])
def ocr():
    if not pytesseract:
        return jsonify({"error": "pytesseract not installed"}), 500

    # Accept file upload (form-data) or base64 image in JSON {"image": "data:...base64..."}
    img = None
    if "file" in request.files:
        try:
            img = Image.open(request.files["file"].stream).convert("RGB")
        except Exception as exc:
            return jsonify({"error": f"Unable to open uploaded image: {exc}"}), 400
    else:
        payload = request.get_json(silent=True) or {}
        img_b64 = payload.get("image")
        if img_b64:
            try:
                if img_b64.startswith("data:"):
                    img_b64 = img_b64.split(",", 1)[1]
                img_bytes = base64.b64decode(img_b64)
                img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
            except Exception as exc:
                return jsonify({"error": f"Unable to decode image: {exc}"}), 400

    if img is None:
        return jsonify({"error": "No image provided. Use form file 'file' or JSON 'image' base64."}), 400

    try:
        text = pytesseract.image_to_string(img)
    except Exception as exc:
        return jsonify({"error": f"Tesseract OCR failed: {exc}"}), 500

    return jsonify({"text": text})
