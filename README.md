# benkyoai

## 勉強AIアシスタント

複数の教科書画像をアップロードして、AIがまとめて問題を作成し、理解レベルを評価するアプリです。

### 仕組み

- `templates/index.html` で画像を複数選択できるようにしました。
- `static/app.js` が複数ファイルを `POST /api/analyze` に送信します。
- `app.py` が画像から OCR でテキストを抽出し、Gemini API（OpenAI `responses` API）を呼び出して問題と理解レベルを生成します。

### 環境変数

- `OPENAI_API_KEY` を設定すると Gemini API を使った自然な問題生成が有効になります。

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
