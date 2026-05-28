from flask import Flask, render_template, request, jsonify
from PIL import Image
import pytesseract
import os

app = Flask(__name__)

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

try:
    import openai
    if OPENAI_API_KEY:
        openai.api_key = OPENAI_API_KEY
except ImportError:
    openai = None


def extract_text_from_image(image):
    text = pytesseract.image_to_string(image, lang="jpn+eng")
    return text.strip()


def generate_questions_from_text(text):
    if openai and OPENAI_API_KEY:
        prompt = (
            "以下の教科書の内容を読み取り、\n"
            "1) 重要な問題を3問作成してください。\n"
            "2) その範囲の理解レベルを「基礎」「標準」「発展」のいずれかで評価してください。\n"
            "3) 解説を簡潔にまとめてください。\n"
            "内容:\n" + text
        )
        response = openai.ChatCompletion.create(
            model="gpt-4o-mini",
            messages=[{"role": "system", "content": "あなたは日本語の教育アシスタントです。"},
                      {"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=800,
        )
        answer = response.choices[0].message.content.strip()
        return answer

    # OpenAI APIキーが無い場合は簡易版で返す
    questions = [
        "1. ここで説明されている主要なポイントは何ですか？",
        "2. 重要な用語や公式を1つ挙げて、その意味を説明してください。",
        "3. 学んだ内容を自分の言葉でまとめてください。",
    ]
    level = "基礎"
    if len(text) > 400:
        level = "標準"
    if len(text) > 900:
        level = "発展"

    fallback = (
        "AI連携が未設定のため、簡易問題を表示します。\n"
        f"理解レベルの推定: {level}\n\n"
        "問題:\n" + "\n".join(questions) + "\n\n"
        "本文の要約を作成してください。"
    )
    return fallback


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/analyze", methods=["POST"])
def analyze():
    if "image" not in request.files:
        return jsonify({"error": "画像ファイルがありません。"}), 400

    image_file = request.files["image"]
    try:
        image = Image.open(image_file.stream).convert("RGB")
        text = extract_text_from_image(image)
        if not text:
            return jsonify({"error": "画像からテキストを抽出できませんでした。"}), 400

        ai_result = generate_questions_from_text(text)
        return jsonify({"text": text, "ai_result": ai_result})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    app.run(debug=True)
