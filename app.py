from flask import Flask, render_template, request, jsonify
import os

app = Flask(__name__)
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")
GOOGLE_MODEL = os.environ.get("GOOGLE_MODEL", "models/text-bison-001")


def extract_text_from_image(image):
    # Server-side OCR is not used in this deployment (client-side Tesseract.js is used).
    raise RuntimeError("Server-side OCR is disabled. Use client-side OCR and send text to the API.")


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
    # Prefer Google Generative API if GOOGLE_API_KEY is provided
    if GOOGLE_API_KEY:
        prompt = build_ai_prompt(text)
        try:
            import requests

            url = f"https://generativelanguage.googleapis.com/v1beta2/{GOOGLE_MODEL}:generateText?key={GOOGLE_API_KEY}"
            body = {
                "prompt": {"text": prompt},
                "temperature": 0.7,
                "maxOutputTokens": 800,
            }
            resp = requests.post(url, json=body, timeout=20)
            resp.raise_for_status()
            data = resp.json()

            # Extract generated text from common response shapes
            def _extract_google_text(d):
                if not isinstance(d, dict):
                    return str(d)
                # v1beta2: candidates -> [ { output: "..." } ]
                cands = d.get("candidates") or d.get("candidates")
                if cands and isinstance(cands, list) and len(cands) > 0:
                    cand = cands[0]
                    if isinstance(cand, dict):
                        for key in ("output", "content", "text"):
                            if key in cand and isinstance(cand[key], str):
                                return cand[key]
                        # content may be a list of parts
                        cont = cand.get("content")
                        if isinstance(cont, list):
                            parts = []
                            for item in cont:
                                if isinstance(item, dict):
                                    if "text" in item and isinstance(item["text"], str):
                                        parts.append(item["text"]) 
                                elif isinstance(item, str):
                                    parts.append(item)
                            if parts:
                                return "\n".join(parts)
                # fallback to stringifying whole response
                return str(d)

            answer = _extract_google_text(data).strip()
            return answer
        except requests.exceptions.HTTPError as http_exc:
            resp = getattr(http_exc, 'response', None)
            status = getattr(resp, 'status_code', None)
            body = getattr(resp, 'text', '')
            hint = (
                "404が返されました。APIキー、プロジェクトのAPI有効化、"
                "またはAPIキーのリファラー/IP制限を確認してください。"
            ) if status == 404 else "HTTPエラーが発生しました。"
            return f"AI生成中にエラーが発生しました: {status} {body[:1000]} — {hint}"
        except Exception as exc:
            return f"AI生成中にエラーが発生しました: {exc}"

    # OpenAI integration removed. If GOOGLE_API_KEY is not set, provide a simple fallback.

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
