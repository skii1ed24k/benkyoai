# benkyoai

## 勉強AIアシスタント

複数の教科書画像をアップロードして、AIがまとめて問題を作成し、理解レベルを評価するアプリです。

### 仕組み

- `templates/index.html` で画像を複数選択できるようにしました。
- `static/app.js` が複数ファイルを `POST /api/analyze` に送信します。
- `app.py` はクライアントでOCRしたテキストを受け取り、Google Generative API（Gemini）を呼び出して問題と理解レベルを生成します。

### 環境変数

 - `GOOGLE_API_KEY` を設定すると Google Generative API（Gemini）を使って問題生成できます。VercelでGoogleキーを使う場合はこちらを推奨します。

### ローカル開発

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
brew install tesseract
python app.py
```

### 実行後

- ブラウザで `http://127.0.0.1:5000/` にアクセス
- 画像を複数選択して「問題を作成する」をクリック
- 抽出したテキストと AI の出力が表示されます

### Google Generative API の動作確認（任意）

ローカルで `GOOGLE_API_KEY` が有効か簡単に試すには次の curl コマンドを実行します（モデルは `gemini-3.1-flash-lite` を例示）。

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent" \
  -H 'Content-Type: application/json' \
  -H "X-goog-api-key: $GOOGLE_API_KEY" \
  -X POST \
  -d '{"contents":[{"parts":[{"text":"簡単なテストをしてください。"}]}],"maxOutputTokens":64}' | jq .
```

返り値に JSON が返ってきて生成テキストを含めばキーは有効です。

#### 404 が返る場合

`Requested entity was not found.` が返るときは、次を確認してください。
- `GOOGLE_API_KEY` が該当プロジェクトのキーであること
- `Generative Language API` がそのプロジェクトで有効化されていること
- API キーにリファラー/IP 制限がないこと
- API キーがアクセスできるモデル一覧に `gemini-3.1-flash-lite` が含まれていること
