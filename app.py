from flask import Flask, render_template, request, jsonify
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


def build_ai_prompt(text):
    return (
        "以下の教科書の内容を読み取り、\n"
        "1) 重要な問題を3問作成してください。\n"
        "2) その範囲の理解レベルを「基礎」「標準」「発展」のいずれかで評価してください。\n"
        "3) 簡潔な解説を記載してください。\n"
        "4) 問題文と評価を分かりやすく出力してください。\n"
        "内容:\n" + text
    )


def extract_response_text(response):
    if hasattr(response, "output_text") and response.output_text:
        return response.output_text.strip()

    output = []
    for item in getattr(response, "output", []):
        if isinstance(item, dict):
            for content in item.get("content", []):
                if isinstance(content, dict) and "text" in content:
                    output.append(content["text"])
                elif isinstance(content, str):
                    output.append(content)
    return "".join(output).strip()


def generate_questions_from_text(text):
    if openai and OPENAI_API_KEY:
        prompt = build_ai_prompt(text)
        try:
            if hasattr(openai, "responses"):
                response = openai.responses.create(
                    model="gemini-3.1-flash-lite",
                    input=[
                        {"role": "system", "content": "あなたは日本語の教育アシスタントです。"},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.7,
                    max_output_tokens=800,
                )
                answer = extract_response_text(response)
            else:
                response = openai.ChatCompletion.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": "あなたは日本語の教育アシスタントです。"},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.7,
                    max_tokens=800,
                )
                answer = response.choices[0].message.content.strip()
            return answer
        except Exception as exc:
            return f"AI生成中にエラーが発生しました: {exc}"

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
    payload = request.get_json(silent=True)
    if payload and payload.get("text"):
        text = payload.get("text", "").strip()
        if not text:
            return jsonify({"error": "テキストがありません。"}), 400
        ai_result = generate_questions_from_text(text)
        return jsonify({"text": text, "ai_result": ai_result})

    images = request.files.getlist("image")
    if not images:
        return jsonify({"error": "テキストまたは画像ファイルが必要です。"}), 400

    try:
        return jsonify({"error": "サーバー側OCRは現在利用できません。ブラウザ側で画像をOCRしてから送信してください。"}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    app.run(debug=True)
