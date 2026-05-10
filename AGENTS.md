# タダサポ管理システム — AGENTS.md

> **OpenAI Codex 専用の開発指示ファイル。** 自動読み込みされる。
> 詳細仕様は各ドキュメントを参照。コードを触る前に必ずこのファイルを確認すること。

---

## プロジェクト概要

介護事業所向け無料 IT サポート管理システム。GAS 上の React SPA で、Google スプレッドシートをデータストアとして使用。

- **現行バージョン:** v1.11.3
- **詳細設計:** `docs/SDD.md`
- **引き継ぎ書:** `docs/HANDOVER.md`
- **運用手順:** `docs/RUNBOOK.md`

---

## ファイル構成（厳守）

```
index.html      — フロントエンド（React SPA、Babel in-browser、モックデータ含む単一ファイル）
コード.js        — バックエンド（GAS サーバーサイド）
appsscript.json — GASマニフェスト
```

- `src/` フォルダは廃止済み。**絶対に作らないこと**
- 新規ファイル追加は原則不要。上記2ファイルを編集する

---

## シェル実行ポリシー（Codex 向け）

以下のコマンドは読み取り専用操作として安全に実行してよい:

```bash
# 行数確認・差分確認
wc -l index.html コード.js
git diff --stat
git log --oneline -10
git status

# ローカルプレビュー起動（変更なし）
npx serve -s . -l 3000
```

以下は**ユーザー確認なしに実行しないこと:**

```bash
# GAS への書き込み・デプロイ
clasp push
clasp deploy

# git への書き込み
git add
git commit
git push
```

---

## 絶対厳守の制約

### React 18.2.0 固定（ADR-004）

React 19系を混在させると `Minified React error #31` でクラッシュする。CDN ライブラリには必ず `?deps=react@18.2.0` を付与。

```json
"imports": {
  "react":           "https://esm.sh/react@18.2.0",
  "react-dom/client":"https://esm.sh/react-dom@18.2.0/client?deps=react@18.2.0",
  "lucide-react":    "https://esm.sh/lucide-react@0.330.0?deps=react@18.2.0"
}
```

### ローカル/本番判定

```javascript
const isLocal = typeof google === 'undefined';
```

### 案件リストシートへの書き込み禁止

IMPORTRANGE 数式を破壊する。管理者による補正は「案件補正」シート経由で行う。

---

## データモデル（コード.js 約30行目の IDX 定数）

全シート左詰め、ギャップなし。変更時は `docs/SDD.md` §1 も更新すること。

```javascript
RECORDS: { FK:0, STATUS:1, STAFF_EMAIL:2, STAFF_NAME:3, DATE:4, COUNT:5,
           METHOD:6, BUSINESS:7, CONTENT:8, REMARKS:9, HISTORY:10,
           EVENT_ID:11, MEET_URL:12, THREAD_ID:13, ATTACHMENTS:14,
           CASE_LIMIT_OVERRIDE:15, ANNUAL_LIMIT_OVERRIDE:16,
           TOOLS:17, SUB_STAFF:18 }   // 19列

DRAFT:     { DRAFT_ID:0, CASE_ID:1, STAFF_EMAIL:2, MODE:3, THREAD_ID:4,
             SUBJECT:5, BODY:6, CC:7, BCC:8, TOOLS:9, UPDATED_AT:10 }  // 11列

SCHEDULED: { QUEUE_ID:0, CASE_ID:1, STAFF_EMAIL:2, STAFF_NAME:3, MODE:4,
             THREAD_ID:5, SUBJECT:6, BODY:7, CC:8, BCC:9, TOOLS:10,
             SEND_AT:11, STATUS:12, ERROR:13, CREATED_AT:14, SENT_AT:15 }  // 16列

STAFF:     { NAME:1, EMAIL:2, ROLE:3, IS_ACTIVE:4 }
CASES:     { PK:0, EMAIL:1, OFFICE:2, NAME:3, DETAILS:4, PREFECTURE:5, SERVICE:6 }
```

詳細（各シートの全列定義・制約）: `docs/SDD.md` §1

---

## ビジネスルール

- 案件ごと最大3回（`supportCount`、設定値で変更可）
- 年間最大10回（同一メール + 年度、設定値で変更可）
- 上限優先順: 案件特例 > 全体設定 > ハードコードデフォルト
- 未対応 + 年間>=上限 → 「回数超過」ボタンのみ表示
- 完了 + 年間>=上限 → 再開ボタン非表示
- `rejected`: 回数超過メール送信後に設定
- 年度計算: 4月開始。`inProgress`/`completed` の `supportCount` を合算

詳細（全ビジネスルール・ステータス遷移）: `docs/SDD.md` §2〜3

---

## ローカル開発

```bash
npx serve -s . -l 3000
# → http://localhost:3000 でプレビュー（モックデータ14パターンで動作）
```

---

## デプロイ

```bash
# 1. 必ず先に git commit
git add <files> && git commit -m "feat: vX.X.X - 説明"

# 2. GAS にプッシュ（--force 必須）
clasp push --force

# 3. デプロイ更新
clasp deploy -i AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ -d "vX.X.X"
```

詳細手順・ロールバック・インシデント対応: `docs/RUNBOOK.md`

---

## 本番環境

| 項目 | 値 |
|-----|----|
| GAS プロジェクト ID | `1UMg3CaTlbZW0YfjzgqbOwd-XOYdIsVELmGpsP7O-MrwFSiAJdS-ySLvP` |
| スプレッドシート ID | `1hllLdETiK0sk0xW_y0V6vOmnlK7kIkHBjntYiCTom4w` |
| デプロイ ID | `AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ` |
| Webapp 設定 | `executeAs: USER_ACCESSING` / `access: DOMAIN` |

---

## コーディング規約

- 日本語コメント推奨
- フロントエンドは Tailwind CSS でスタイリング
- ESM import は importmap 経由（Babel in-browser のため）
- GAS 関数呼び出しは `google.script.run` 経由（ローカルではモック）
- 日付フォーマット: `toISOString()` は UTC ずれが出るため `getFullYear()/getMonth()/getDate()` を使用

---

## ドキュメント索引

| ファイル | 用途 |
|---------|------|
| `CLAUDE.md` | Claude Code 専用指示 |
| `AGENTS.md`（本ファイル） | OpenAI Codex 専用指示 |
| `docs/SDD.md` | システム詳細設計書 v1.11.3 |
| `docs/HANDOVER.md` | 引き継ぎ書 v1.11.3 |
| `docs/ADR.md` | アーキテクチャ判断記録 |
| `docs/RUNBOOK.md` | 運用手順書 |
| `docs/Manual.md` | 操作マニュアル |
| `CHANGELOG.md` | 変更履歴 |
| `SECURITY.md` | セキュリティ情報 |
