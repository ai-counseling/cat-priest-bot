# 🐱⛩️ 猫神主Bot

神社の猫がお悩み相談とお焚き上げを行うLINE AIボット

## 機能

- **AI相談機能**: OpenAI GPT-4o-miniによる温かい相談対応
- **お焚き上げ機能**: 心の浄化体験による満足度向上
- **利用制限**: 1日10ターンまで、最大100ユーザー
- **自動削除**: 30分無活動でセッション自動削除
- **統計機能**: リアルタイム利用状況監視

## キャラクター特徴

- 神社で参拝者の悩みを聞く賢い神主猫
- 神道の教えを基にした温かいアドバイス
- 時々「にゃ」語尾で親しみやすさ演出
- お焚き上げによる心の重荷の浄化

## 技術スタック

- **Backend**: Node.js + Express
- **LINE SDK**: @line/bot-sdk
- **AI**: OpenAI API (GPT-4o-mini)
- **Deploy**: Render
- **Database**: メモリ内管理 (Map/Set)

## 環境変数

```bash
LINE_CHANNEL_SECRET=your_secret
LINE_CHANNEL_ACCESS_TOKEN=your_token
OPENAI_API_KEY=your_key
PORT=3000
```

## 管理画面

- **統計情報**: `/admin/stats`
- **管理メニュー**: `/admin`
- **ヘルスチェック**: `/health`

## デプロイ

RenderでGitHub自動デプロイ設定済み。pushすると自動でデプロイされます。

---

**神社でお待ちしていますにゃ** 🐾⛩️