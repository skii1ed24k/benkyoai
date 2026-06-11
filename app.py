from flask import Flask, render_template, request, jsonify
import os

app = Flask(__name__)
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")
# Use Gemini 3.1 Flash-Lite free-tier model by default for lower-cost / free usage.
# Can be overridden by setting the `GOOGLE_MODEL` env var to a full model path like
# "models/gemini-3.1-flash-lite" or another supported model name.
GOOGLE_MODEL = os.environ.get("GOOGLE_MODEL", "models/gemini-3.1-flash-lite")


def extract_text_from_image(image):
    # Server-side OCR is not used in this deployment (client-side Tesseract.js is used).
    raise RuntimeError("Server-side OCR is disabled. Use client-side OCR and send text to the API.")


def build_ai_prompt(text):
    # Ask the model to return a strict JSON-formatted 4-choice quiz (no extra text).
    return (
        "以下の教科書の内容を読み取り、厳密なJSONのみを出力してください。\n"
        "余分な説明や会話文を含めないでください。\n"
        "出力スキーマ: \n"
        "{\n"
        "  \"title\": \"教科書名または要約タイトル\",\n"
        "  \"level\": \"基礎|標準|発展\",\n"
        "  \"questions\": [\n"
        "    {\n"
        "      \"question\": \"問題文\",\n"
        "      \"choices\": [\"選択肢A\", \"選択肢B\", \"選択肢C\", \"選択肢D\"],\n"
        "      \"answer_index\": 0,\n"
        "      \"explanation\": \"簡潔な解説\"\n"
        "    }\n"
        "  ]\n"
        "}\n"
        "上記スキーマに正確に従って、重要な問題を3問（それぞれ4択）作成してください。\n"
        "出力は有効なJSONでなければなりません。\n"
        "内容:\n" + text
    )


def build_advice_prompt(text):
    # Generate study advice based on the content
    return (
        "以下の教科書の内容を分析して、学習アドバイスを厳密なJSONのみで出力してください。\n"
        "余分な説明や会話文を含めないでください。\n"
        "出力スキーマ: \n"
        "{\n"
        "  \"key_topics\": [\"重要なトピック1\", \"重要なトピック2\", \"重要なトピック3\"],\n"
        "  \"difficulty_areas\": [\"難易度が高い項目1\", \"難易度が高い項目2\"],\n"
        "  \"focus_points\": [\"重点的に学ぶべき点1\", \"重点的に学ぶべき点2\", \"重点的に学ぶべき点3\"],\n"
        "  \"study_recommendations\": \"より深く学習するために何をすべきかの具体的なアドバイス（2-3文）\",\n"
        "  \"related_concepts\": [\"関連する概念1\", \"関連する概念2\"]\n"
        "}\n"
        "上記スキーマに正確に従ってください。\n"
        "出力は有効なJSONでなければなりません。\n"
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

            url = f"https://generativelanguage.googleapis.com/v1beta/{GOOGLE_MODEL}:generateContent"
            headers = {
                "Content-Type": "application/json",
                "X-goog-api-key": GOOGLE_API_KEY,
            }
            body = {
                "contents": [
                    {
                        "parts": [
                            {"text": prompt},
                        ],
                    }
                ],
                "generationConfig": {
                    "temperature": 0.7,
                    "topP": 0.9,
                    "maxOutputTokens": 1200,
                    "responseMimeType": "application/json",
                },
            }
            resp = requests.post(url, headers=headers, json=body, timeout=20)
            resp.raise_for_status()
            data = resp.json()

            def _extract_google_text(d):
                if not isinstance(d, dict):
                    return str(d)
                cands = d.get("candidates")
                if cands and isinstance(cands, list) and len(cands) > 0:
                    cand = cands[0]
                    if isinstance(cand, dict):
                        if isinstance(cand.get("output"), str):
                            return cand["output"]
                        if isinstance(cand.get("outputText"), str):
                            return cand["outputText"]
                        content = cand.get("content")
                        if isinstance(content, dict):
                            parts = content.get("parts")
                            if isinstance(parts, list):
                                texts = []
                                for item in parts:
                                    if isinstance(item, dict) and isinstance(item.get("text"), str):
                                        texts.append(item["text"])
                                    elif isinstance(item, str):
                                        texts.append(item)
                                if texts:
                                    return "\n".join(texts)
                        if isinstance(content, list):
                            parts = []
                            for item in content:
                                if isinstance(item, dict) and isinstance(item.get("text"), str):
                                    parts.append(item["text"])
                                elif isinstance(item, str):
                                    parts.append(item)
                            if parts:
                                return "\n".join(parts)
                # fallback to common top-level fields
                for key in ("output", "outputText", "text"):  # noqa: C401
                    if isinstance(d.get(key), str):
                        return d.get(key)
                return str(d)

            answer = _extract_google_text(data).strip()
            # Try to parse JSON output from the model for structured quiz data.
            # Be tolerant: extract the first JSON object found in the text.
            try:
                import json, re

                json_text = answer
                if json_text.strip().startswith("{") and not json_text.strip().endswith("}" ):
                    open_braces = json_text.count("{")
                    close_braces = json_text.count("}")
                    if open_braces > close_braces:
                        json_text += "}" * (open_braces - close_braces)
                    open_brackets = json_text.count("[")
                    close_brackets = json_text.count("]")
                    if open_brackets > close_brackets:
                        json_text += "]" * (open_brackets - close_brackets)

                m = re.search(r"(\{[\s\S]*\})", json_text)
                json_text = m.group(1) if m else json_text
                parsed = json.loads(json_text)
                return parsed
            except Exception:
                return answer
        except requests.exceptions.HTTPError as http_exc:
            resp = getattr(http_exc, 'response', None)
            status = getattr(resp, 'status_code', None)
            body = getattr(resp, 'text', '')
            if status == 404:
                hint = (
                    "モデルがこのAPIキー/プロジェクトで利用できない可能性があります。"
                    "Generative Language API が有効であること、"
                    "APIキーが正しいプロジェクトのものであること、"
                    "制限がないことを確認してください。"
                )
            else:
                hint = "HTTPエラーが発生しました。"
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


def generate_advice_from_text(text):
    # Generate study advice using AI
    if GOOGLE_API_KEY:
        prompt = build_advice_prompt(text)
        try:
            import requests

            url = f"https://generativelanguage.googleapis.com/v1beta/{GOOGLE_MODEL}:generateContent"
            headers = {
                "Content-Type": "application/json",
                "X-goog-api-key": GOOGLE_API_KEY,
            }
            body = {
                "contents": [
                    {
                        "parts": [
                            {"text": prompt},
                        ],
                    }
                ],
                "generationConfig": {
                    "temperature": 0.7,
                    "topP": 0.9,
                    "maxOutputTokens": 1000,
                    "responseMimeType": "application/json",
                },
            }
            resp = requests.post(url, headers=headers, json=body, timeout=20)
            resp.raise_for_status()
            data = resp.json()

            def _extract_google_text(d):
                if not isinstance(d, dict):
                    return str(d)
                cands = d.get("candidates")
                if cands and isinstance(cands, list) and len(cands) > 0:
                    cand = cands[0]
                    if isinstance(cand, dict):
                        if isinstance(cand.get("output"), str):
                            return cand["output"]
                        if isinstance(cand.get("outputText"), str):
                            return cand["outputText"]
                        content = cand.get("content")
                        if isinstance(content, dict):
                            parts = content.get("parts")
                            if isinstance(parts, list):
                                texts = []
                                for item in parts:
                                    if isinstance(item, dict) and isinstance(item.get("text"), str):
                                        texts.append(item["text"])
                                    elif isinstance(item, str):
                                        texts.append(item)
                                if texts:
                                    return "\n".join(texts)
                        if isinstance(content, list):
                            parts = []
                            for item in content:
                                if isinstance(item, dict) and isinstance(item.get("text"), str):
                                    parts.append(item["text"])
                                elif isinstance(item, str):
                                    parts.append(item)
                            if parts:
                                return "\n".join(parts)
                for key in ("output", "outputText", "text"):
                    if isinstance(d.get(key), str):
                        return d.get(key)
                return str(d)

            answer = _extract_google_text(data).strip()
            try:
                import json, re
                json_text = answer
                if json_text.strip().startswith("{") and not json_text.strip().endswith("}"):
                    open_braces = json_text.count("{")
                    close_braces = json_text.count("}")
                    if open_braces > close_braces:
                        json_text += "}" * (open_braces - close_braces)
                    open_brackets = json_text.count("[")
                    close_brackets = json_text.count("]")
                    if open_brackets > close_brackets:
                        json_text += "]" * (open_brackets - close_brackets)

                m = re.search(r"(\{[\s\S]*\})", json_text)
                json_text = m.group(1) if m else json_text
                parsed = json.loads(json_text)
                return parsed
            except Exception:
                return answer
        except Exception as exc:
            return f"アドバイス生成中にエラーが発生しました: {exc}"

    # Fallback advice if no API key
    return {
        "key_topics": ["主要なトピック1", "主要なトピック2", "主要なトピック3"],
        "difficulty_areas": ["難しい項目"],
        "focus_points": ["重点的に学ぶべき項目"],
        "study_recommendations": "テキストを何度も読み返し、重要なキーワードをまとめてください。",
        "related_concepts": ["関連する概念1", "関連する概念2"]
    }


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


@app.route("/api/get-advice", methods=["POST"])
def get_advice():
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "JSON形式でテキストを送信してください。"}), 400

    text = payload.get("text", "").strip()
    if not text:
        return jsonify({"error": "テキストがありません。"}), 400

    advice = generate_advice_from_text(text)
    return jsonify({"advice": advice})


if __name__ == "__main__":
    app.run(debug=True)
