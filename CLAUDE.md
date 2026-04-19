# タダサポ管理システム — CLAUDE.md

## プロジェクト概要
介護事業所向け無料ITサポート管理システム。GAS上のReact SPAで、Googleスプレッドシートをデータストアとして使用。

## ファイル構成（厳守）
```
index.html      — フロントエンド（React SPA、Babel in-browser、モックデータ含む単一ファイル）
コード.js        — バックエンド（GAS サーバーサイド）
appsscript.json — GASマニフェスト
```
- `src/` フォルダ構成は廃止済み。**絶対に作らないこと**
- 新規ファイル追加は原則不要。上記2ファイルを編集する

## 絶対厳守の制約

### React 18.2.0 固定
- React 19系を混在させると `Minified React error #31` でクラッシュする
- CDNライブラリには必ず `?deps=react@18.2.0` を付与
```json
"imports": {
  "react": "https://esm.sh/react@18.2.0",
  "react-dom/client": "https://esm.sh/react-dom@18.2.0/client?deps=react@18.2.0",
  "lucide-react": "https://esm.sh/lucide-react@0.330.0?deps=react@18.2.0"
}
```

### ローカル/本番判定
```javascript
const isLocal = typeof google === 'undefined';
```

## ローカル開発
```bash
npx serve -s . -l 3000
# → http://localhost:3000 でプレビュー
```
モックデータ（全14パターン）でオフライン動作する。

## デプロイ
```bash
clasp push --force && clasp deploy -i <DEPLOY_ID> -d "vX.X.X"
```
- `clasp push` は `--force` 必須（なしだとサイレントにスキップされることがある）
- `clasp pull` はローカルファイルを上書きするため、必ず先に `git commit` すること
- v1.11.0 以降：本番初回デプロイ後、GASエディタで `setupScheduledEmailTrigger()` を1回手動実行して5分間隔トリガを登録する（予約送信機能の動作条件）

## データモデル（IDX定数 — コード.js 30行目付近）
- 全シート左詰め、ギャップなし
- RECORDS: FK=0 〜 ATTACHMENTS=14, CASE_LIMIT_OVERRIDE=15, ANNUAL_LIMIT_OVERRIDE=16, TOOLS=17, SUB_STAFF=18（**19列**）
- STAFF: NAME=1, EMAIL=2, ROLE=3, IS_ACTIVE=4（A=ID, B=氏名, C=メール）
- DRAFT (v1.11.0): DRAFT_ID=0 〜 UPDATED_AT=10（11列、case/mode/thread 単位で上書き）
- SCHEDULED (v1.11.0): QUEUE_ID=0 〜 SENT_AT=15（16列、status: pending/sending/sent/failed/cancelled）
- 年度計算: 4月開始。inProgress/completed の supportCount 合算

## ビジネスルール
- 案件ごと最大3回（supportCount）
- 年間最大10回（同一メール＋年度）
- 未対応 + 年間>=10 → 「回数超過」ボタン表示（担当する非表示）
- 完了 + 年間>=10 → 再開ボタン非表示
- rejected ステータス: 回数超過メール送信後に設定

## 本番環境
- GASプロジェクト: `1UMg3CaTlbZW0YfjzgqbOwd-XOYdIsVELmGpsP7O-MrwFSiAJdS-ySLvP`
- スプレッドシート: `1hllLdETiK0sk0xW_y0V6vOmnlK7kIkHBjntYiCTom4w`
- デプロイID: `AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ`
- Webapp: `executeAs: USER_DEPLOYING`, `access: ANYONE`

## ドキュメント
- `docs/HANDOVER.md` — 引き継ぎ書 v1.11.0
- `docs/SDD.md` — 設計書 v1.9.0
- `docs/RD.md` — 要件定義
- `docs/ADR.md` — アーキテクチャ判断記録
- `docs/Manual.md` — 操作マニュアル

## コーディング規約
- 日本語コメント推奨
- フロントエンドは Tailwind CSS でスタイリング
- Babel in-browser のため ESM import は importmap 経由
- GAS関数呼び出しは `google.script.run` 経由（ローカルではモック）
