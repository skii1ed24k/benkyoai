# benkyoai

## 勉強AIアシスタント（Vercel対応）

教科書の写真をアップロードして、AIが問題を作成し、理解レベルを評価するアプリです。

### Vercelでの構成

- `public/` に静的フロントエンドを配置
- ブラウザ側で `tesseract.js` を使ってOCRを実行
- `api/analyze.py` で OpenAI にテキストを送信
- `vercel.json` で API と静的ページをルーティング

### 使い方 (Vercel)

1. Vercel CLI をインストールします。

```bash
npm install -g vercel
```

2. プロジェクトをデプロイします。

```bash
vercel
```

3. 環境変数に OpenAI API キーを設定します。

```bash
vercel env add OPENAI_API_KEY production
```

4. `OPENAI_API_KEY` を設定したら再デプロイします。

```bash
vercel --prod
```

### ローカル開発

Vercel用には `public/` と `api/analyze.py` で動作します。ローカルで `app.py` を試す場合は追加パッケージが必要です。

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install pillow pytesseract
brew install tesseract
python app.py
```

### 仕組み

- `public/index.html` で画像を選び、ブラウザが `tesseract.js` でOCRを実行します。
- 抽出したテキストを `POST /api/analyze` に送信します。
- `api/analyze.py` が OpenAI を呼び出し、問題と理解レベルを生成します。
- 結果を画面に表示します。
