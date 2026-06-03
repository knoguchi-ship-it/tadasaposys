# タダサポ管理システム — AGENTS.md

> **OpenAI Codex 専用の開発指示ファイル。** 自動読み込みされる。
> 詳細仕様は各ドキュメントを参照。コードを触る前に必ずこのファイルを確認すること。

---

## プロジェクト概要

介護事業所向け無料 IT サポート管理システム。GAS 上の React SPA で、Google スプレッドシートをデータストアとして使用。

- **現行バージョン:** v1.12.3
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
- `temp/` 配下はローカルバックアップ・GAS上の残存スタブ確認用。**Git追跡・clasp push対象から除外し、今後追わないこと**

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

### グランドルール実行チェック

以下は「判断基準」と「作業チェック」を一体で扱う。チェックだけで判断せず、本文の禁止事項・理由・例外条件を必ず読む。

#### 1. 本番安全

Webapp 設定は `USER_ACCESSING` / `DOMAIN` 固定。デプロイは固定 deploymentId への `-i` 付き更新のみ。新規デプロイ、`USER_DEPLOYING`、`ANYONE_WITH_GOOGLE_ACCOUNT` は禁止。

作業チェック:
- [ ] `appsscript.json` の `webapp` が `USER_ACCESSING` / `DOMAIN`
- [ ] デプロイ時は固定 deploymentId に `-i` 付き
- [ ] デプロイ前後で Webapp 設定を確認

#### 2. データ保全

`案件リスト` は IMPORTRANGE 保護のため直接書き込み禁止。補正は `案件補正` 経由。IDX/シート列は左詰め・ギャップなし。`temp/` はバックアップ・スタブ隔離先であり、Git追跡・clasp push・レビュー対象に含めない。

ドライランテストで作成・更新したテストデータは、テスト完了後に必ず削除または復元し、ドライラン実施前の状態へ戻す。削除・復元できないドライランは実施しない。

作業チェック:
- [ ] `案件リスト` に直接書き込んでいない
- [ ] IDX/列変更時に `docs/SDD.md` と関連文書を同期
- [ ] `temp/` を差分・デプロイ対象に含めていない
- [ ] ドライランテストで作成/更新したテストデータを削除または復元した

#### 3. セキュリティ

セキュアコーディングは、認証・認可、入力検証/出力無害化、機密情報管理、データ保護/最小権限、監査性/エラー処理の5視点で行う。ハードコーディングは原則禁止。機密情報は操作者の許可があってもコード・ドキュメント・GitHubに置かず、設定シート・PropertiesService・環境変数等で安全に扱う。

作業チェック:
- [ ] UI制御だけでなくサーバー側権限チェックがある
- [ ] 外部入力・シート値・HTML出力・GAS書き込み値を検証/無害化している
- [ ] 機密情報をコード・ドキュメント・GitHubに入れていない
- [ ] 固定値は設定化できないか確認した
- [ ] 管理操作の監査性と失敗時の安全停止を確認した

#### 4. 実装品質

DRY原則を守り、共通化できる処理を重複実装しない。新設処理も既存ヘルパー・既存パターンを確認してから追加する。React は 18.2.0 固定、日付フォーマットは UTC ずれを避ける。

作業チェック:
- [ ] 既存ヘルパー・既存パターンを確認した
- [ ] 重複実装ではなく共通化を検討した
- [ ] React 18.2.0 固定と importmap の依存指定を壊していない
- [ ] 日付処理で `toISOString()` による日付ずれを起こしていない

#### 5. 既存機能保護

既存機能への影響範囲を必ず確認し、破壊しないことを関連コード確認・差分確認・テストで保証する。

ユーザーからの依頼・情報が不明瞭、抽象的、掘り下げが必要、または想像に任せないと作業できない場合は、実装や変更に入る前に必ずユーザーへ質問し、前提を明らかにしてから進める。

作業チェック:
- [ ] 依頼内容・前提・期待結果に曖昧さがない
- [ ] 曖昧な点は作業前にユーザーへ質問して明確化した
- [ ] 影響する画面/API/シート/モック/テストを洗い出した
- [ ] 既存フローの回帰リスクを確認した
- [ ] リスクに応じて単体テスト/E2E/手動確認を実施した
- [ ] ドライランテスト後に本番/検証データが実施前状態へ戻っている

#### 6. ドキュメント・文字コード

コード更新時は毎回、コード・ドキュメント・テスト・モックデータの整合性を確認する。バージョン同期対象には `index.html` を含める。ER図・テーブル設計書は HTML で `docs/` 配下に保存する。AI向け指示だけでなく、人間が読める Markdown/HTML も維持する。文字化けは放置せず UTF-8 として読める状態に修正する。

作業チェック:
- [ ] SDD/HANDOVER/Manual/CHANGELOG/AGENTS/CLAUDE/package/index.html の必要箇所を同期
- [ ] ER図・テーブル設計書の作成/更新が必要な場合は HTML で保存
- [ ] 人間向けドキュメントも更新
- [ ] 文字化けがないことを確認

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
             SEND_AT:11, STATUS:12, ERROR:13, CREATED_AT:14, SENT_AT:15 }  // 16列・予約送信はv1.12.1で廃止、既存キュー確認用

STAFF:     { NAME:1, EMAIL:2, ROLE:3, IS_ACTIVE:4 }
CASES:     { PK:0, EMAIL:1, OFFICE:2, NAME:3, DETAILS:4, PREFECTURE:5, SERVICE:6 }
```

詳細（各シートの全列定義・制約）: `docs/SDD.md` §1。ER図・テーブル設計書を別途作成する場合はHTMLで保存する。

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

## Codex 起動

このプロジェクトでは、GitHubで共有する Codex 起動方針を `.codex/config.toml` に置く。Codex CLI はリポジトリ設定を自動読込しないため、起動時は以下のランチャーを使う。

```powershell
.\codex-tadasaposys.ps1
```

適用される起動オプション:

```powershell
codex --sandbox workspace-write --ask-for-approval on-request -c approvals_reviewer=auto_review
```

## Claude 起動

このプロジェクトでは、GitHubで共有する Claude Code 起動方針を `.claude/settings.json` に置く。権限確認を省略する設定は `permissionMode: bypassPermissions` として保存している。

Claude CLI が `--dangerously-skip-permissions` フラグ自体をリポジトリ設定から自動付与する保証はないため、起動時は以下のランチャーを使う。

```powershell
.\claude-tadasaposys.ps1
```

適用される起動オプション:

```powershell
claude --dangerously-skip-permissions
```

---

## デプロイ

### 🔒 デプロイは必ずバージョンアップ（絶対厳守 / URL不変原則）

新規デプロイ作成は禁止。必ず固定 deploymentId への `-i` 付きバージョン更新で行う。新規デプロイすると Webapp URL が変わり、タダメンに案内済みのブックマーク・QR・メールリンクが全て失効する。

- 固定 deploymentId: `AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ`
- ✅ 正: `clasp deploy -i AKfycbw...nuq0ZJHhhUQ -d "vX.X.X"`
- ❌ 禁: `clasp deploy -d "vX.X.X"` / `clasp deploy`（新URL発行）

### 🔒 Webapp 設定グランドルール（絶対厳守）

| 項目 | 必ずこの値 |
|------|-----------|
| 次のユーザーとして実行 | **ウェブ アプリケーションにアクセスしているユーザー** (`USER_ACCESSING`) |
| アクセスできるユーザー | **NPO法人タダカヨ 内の全員** (`access: DOMAIN`) |

過去に「実行=自分 / アクセス=Googleアカウント全員」の誤設定でセキュリティホールが発生した事例があるため絶対厳守。

### デプロイ手順

```bash
# 0. appsscript.json の webapp 設定確認（USER_ACCESSING / DOMAIN）

# 1. 必ず先に git commit
git add <files> && git commit -m "feat: vX.X.X - 説明"

# 2. GAS にプッシュ（--force 必須）
clasp push --force

# 3. デプロイ更新（既存IDへバージョンアップのみ）
clasp deploy -i AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ -d "vX.X.X"

# 4. ブラウザの GAS デプロイ管理画面で「実行=アクセスしているユーザー / アクセス=NPO法人タダカヨ 内の全員」を目視確認
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
| `docs/SDD.md` | システム詳細設計書 v1.12.3 |
| `docs/HANDOVER.md` | 引き継ぎ書 v1.12.3 |
| `docs/ADR.md` | アーキテクチャ判断記録（ADR-001〜012） |
| `docs/RUNBOOK.md` | 運用手順書 |
| `docs/Manual.md` | 操作マニュアル v1.12.3 |
| `CHANGELOG.md` | 変更履歴 |
| `SECURITY.md` | セキュリティ情報 |
