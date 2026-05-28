# benkyoai

## 勉強AIアシスタント プロトタイプ

教科書の写真をアップロードして、AIが問題を生成し、理解レベルを評価する試作アプリです。

### 含まれる機能

- 画像アップロードによるテキスト抽出（OCR）
- 抽出した文章をAIに送信し、問題と理解レベルを生成
- OpenAI APIキーがあれば実際のAI出力を利用
- APIキー未設定時は簡易な質問を返すフォールバック

### 使い方

1. Python環境を用意します。
2. 依存パッケージをインストールします。

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

3. 日本語OCR用にTesseractをインストールします。

```bash
brew install tesseract
```

4. OpenAIを使う場合はAPIキーを設定します。

```bash
export OPENAI_API_KEY="your_api_key"
```

5. アプリを起動します。

```bash
python app.py
```

6. ブラウザで `http://127.0.0.1:5000` を開き、教科書の写真をアップロードします。

### 仕組み

- `app.py` でFlaskサーバを立ち上げ、`/api/analyze` に画像を送信します。
- `pytesseract` で画像から文字を抽出します。
- OpenAI連携が有効ならAIに問題作成と理解レベル評価を依頼します。
- 結果を画面に表示します。
