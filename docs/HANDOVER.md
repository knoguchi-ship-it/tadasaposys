# 開発者向け引継ぎ資料 (HANDOVER.md)

**Project:** タダサポ管理システム
**Version:** 1.11.6（現行リリース）
**Date:** 2026/05/10
**Author:** Development Team

---

## 1. 現行システムの状態

### 本番稼働中

- **URL**: `https://script.google.com/a/macros/tadakayo.jp/s/AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ/exec`
- **デプロイバージョン**: @135
- **Webapp 設定**: `executeAs: USER_ACCESSING` / `access: DOMAIN`（tadakayo.jp ドメインのみ）
- **認証**: タダメンマスタ（B列=氏名, C列=メール, D列=ROLE）で認証

### 実装済み機能

| 機能 | 状態 | 追加バージョン |
|------|------|--------------|
| 案件一覧（6タブ: 未対応/対応中/完了/キャンセル/対応不可/全て） | ✅ | v1.8.1〜 |
| 担当アサイン（メール付き / メールなし） | ✅ | v1.8.1 |
| 日程確定（カレンダー連携 + Meet/Zoom URL 発行） | ✅ | v1.8.1 |
| 完了報告・記録修正（添付ファイル D&D、最大5件） | ✅ | v1.8.1 |
| 完了報告時にサービス種別・都道府県を入力可能 | ✅ | v1.10.0 |
| 案件再開（最大N回、HISTORY JSON 保存） | ✅ | v1.8.1 |
| 2回目以降のロールバック（前回完了状態に戻す） | ✅ | v1.9.94 |
| キャンセル機能（理由記録モーダル） | ✅ | v1.9.96 |
| 年間利用制限・案件回数制限（設定値で変更可） | ✅ | v1.8.2 |
| 案件・年度ごとの上限特例設定（管理者） | ✅ | v1.8.2 |
| 回数超過メール送信 → 対応不可 | ✅ | v1.8.1 |
| メール機能（5モード、CC/BCC、スレッド対応） | ✅ | v1.8.1〜 |
| メール下書き保存（自動復元プロンプト付き） | ✅ | v1.11.0 |
| メール予約送信（5分間隔トリガ、取消可能） | ✅ | v1.11.0 |
| 「下書きあり」「予約あり」バッジ表示 | ✅ | v1.11.0 |
| 表示モード切替（通常/閲覧/管理） | ✅ | v1.8.3 |
| 検索UI（常時表示・チップ型フィルタ・期間プリセット・並び順） | ✅ | v1.9.0 |
| 対応ツール選択・月間上限・設定管理 | ✅ | v1.9.29〜 |
| サブ担当（OJT）機能（最大1名） | ✅ | v1.9.58 |
| 管理モード インライン編集（ステータス・担当者・上限） | ✅ | v1.9.0 |
| 管理者データ抽出・案件追加・案件削除 | ✅ | v1.9.x |
| Meet/Zoom URL コピー・編集・カレンダー同期 | ✅ | v1.9.62〜 |
| カレンダーイベント作成時にアプリURL追記 | ✅ | v1.10.1 |
| Zoom API失敗時もカレンダー作成を継続 | ✅ | v1.10.2 |
| アプリ内ヘルプ | ✅ | v1.9.83 |
| 楽観的更新・初期データHTML埋め込みによる高速化 | ✅ | v1.9.67 |
| **管理機能ステータス遷移の完全修正** | ✅ | **v1.11.6** |
| **Playwright E2E テストスイート（49テスト）** | ✅ | **v1.11.5** |
| **Jest 単体テスト（34テスト）** | ✅ | **v1.11.5** |
| **WCAG 2.1 AA color-contrast 全違反修正** | ✅ | **v1.11.5** |

---

## 2. ファイル構成

```
tadasaposys/
├── index.html              ← フロントエンド（React SPA、5100行超）
├── コード.js               ← バックエンド（GAS、4200行超）
├── appsscript.json         ← GASマニフェスト
├── CLAUDE.md               ← Claude Code 専用 AI 開発指示書
├── AGENTS.md               ← OpenAI Codex 専用 AI 開発指示書
├── CHANGELOG.md            ← バージョン変更履歴（keepachangelog形式）
├── SECURITY.md             ← セキュリティ情報・脆弱性報告
├── package.json            ← テスト依存（Playwright/Jest）
├── playwright.config.ts    ← E2Eテスト設定
├── jest.config.js          ← 単体テスト設定
├── .claspignore            ← GASプッシュ除外設定（node_modules等を除外）
├── .clasp.json             ← clasp設定（.gitignore対象）
├── tests/
│   ├── e2e/                ← Playwright E2E テスト（7スペック、49テスト）
│   ├── pages/app.page.ts   ← Page Object Model
│   ├── fixtures/           ← カスタム Fixture
│   └── unit/               ← Jest 単体テスト（34テスト）
└── docs/
    ├── SDD.md              ← 設計書 v1.11.6
    ├── HANDOVER.md         ← 本ドキュメント
    ├── ADR.md              ← アーキテクチャ判断記録（ADR-001〜010）
    ├── RUNBOOK.md          ← 運用手順書
    ├── Manual.md           ← 操作マニュアル v1.11.6
    ├── RD.md               ← 要件定義
    ├── playwright-guide.html ← テスト導入・実行ガイド（HTML）
    └── test-criteria.html  ← テスト品質基準チェックリスト（HTML）
```

---

## 3. 技術スタック

| 項目 | 技術 |
|------|------|
| フロントエンド | React 18.2.0 + Babel standalone（CDN、importmap） |
| アイコン | lucide-react 0.330.0（`?deps=react@18.2.0` 必須） |
| CSS | Tailwind CSS（CDN） |
| バックエンド | Google Apps Script (V8) |
| データストア | Google スプレッドシート |
| メール | Gmail Advanced Service (API v1) |
| カレンダー | Calendar Advanced Service + CalendarApp |
| 会議URL | Google Meet（Calendar API）/ Zoom API |
| デプロイ | clasp（`clasp push --force` 必須） |
| E2E テスト | Playwright 1.52.0 + TypeScript |
| 単体テスト | Jest 29 |
| アクセシビリティ | axe-core（WCAG 2.1 AA 準拠確認済み） |

### ⚠️ 絶対厳守

- **React 18.2.0 固定**: React 19系混在で `Minified React error #31` クラッシュ
- **clasp push --force**: `--force` なしだとサイレントにスキップされる場合がある
- **clasp pull 前に git commit**: ローカルファイルが上書きされる
- **案件リストシートへの書き込み禁止**: IMPORTRANGE 数式を破壊する
- **.claspignore の確認**: `node_modules/` 等が除外されていることを確認してから push

---

## 4. データモデル

### シート構成

| シート名 | 用途 |
|----------|------|
| 設定 | Key-Value形式の全設定値 |
| 案件リスト | Googleフォーム回答からIMPORTRANGEで取り込み（**書き込み禁止**） |
| 案件補正 | 管理者による案件情報手動補正 |
| 案件手動追加 | アプリから手動追加した案件 |
| サポート記録 | 各案件の対応記録（**19列**） |
| タダメンマスタ | スタッフ一覧（認証・権限管理） |
| メール履歴 | 送信メールの履歴 |
| 監査ログ | 管理者操作の監査ログ（全管理者操作を記録） |
| メール下書き | 送信前メール一時保存（v1.11.0、11列） |
| 予約送信キュー | 予約送信待機メール（v1.11.0、16列） |

### IDX定数（コード.js 約30行目）

詳細: `docs/SDD.md` §1 参照

```javascript
RECORDS: { FK:0, STATUS:1, STAFF_EMAIL:2, STAFF_NAME:3, DATE:4, COUNT:5,
           METHOD:6, BUSINESS:7, CONTENT:8, REMARKS:9, HISTORY:10,
           EVENT_ID:11, MEET_URL:12, THREAD_ID:13, ATTACHMENTS:14,
           CASE_LIMIT_OVERRIDE:15, ANNUAL_LIMIT_OVERRIDE:16,
           TOOLS:17, SUB_STAFF:18 }  // 19列
```

### ステータス遷移

```
unhandled → inProgress → completed → (reopen → inProgress、最大N回)
unhandled → rejected（回数超過時）
inProgress/completed → cancelled
```

### 上限値の優先順位

```
案件回数上限:  caseLimitOverride > masters.limits.caseSupport > 3
年間利用上限: annualLimitOverride > masters.limits.annual > 10
```

---

## 5. バックエンド関数一覧（コード.js）

### 公開関数（google.script.run 経由）

| 関数 | 説明 |
|------|------|
| `doGet()` | Web App エントリポイント（初期データHTML埋め込み） |
| `getInitialData()` | 起動時データ取得 |
| `getAllCasesJoined()` | 全案件結合データ取得 |
| `assignCase(caseId, user, tools)` | 案件アサイン（メール送信なし） |
| `assignAndSendEmail(...)` | アサイン＋初回メール送信 |
| `updateSupportRecord(recordData)` | 記録更新＋カレンダー連携＋添付更新 |
| `reopenCase(caseId, user)` | 案件再開（正規フロー） |
| `rollbackCurrentRound(caseId)` | 2回目以降の取り消し |
| `cancelCase(caseId)` | 案件キャンセル |
| `declineCase(...)` | 回数超過メール→rejected |
| `sendNewCaseEmail(...)` | 新規スレッドメール送信 |
| `sendCaseEmail(...)` | スレッド返信 |
| `getThreadMessages(caseId)` | スレッドグループ取得 |
| `getMasters()` | マスタデータ取得 |
| `getStaffByEmail(email)` | スタッフ情報取得 |
| `getAdminPanelData()` | 管理パネル初期データ |
| `upsertStaffMember(payload)` | 既存スタッフの権限更新 |
| `deactivateStaffMember(email)` | スタッフ無効化 |
| `updateSettingsAdmin(patch)` | 設定更新（許可キーのみ） |
| `reassignCaseAdmin(caseId, staffEmail)` | **管理者再アサイン（v1.11.6修正済み）** |
| `setCaseStatusAdmin(caseId, status)` | **管理者ステータス変更（v1.11.6修正済み）** |
| `updateCaseDataAdmin(caseId, payload)` | **管理者案件データ編集（v1.11.6修正済み）** |
| `addManualCase(payload)` | 管理者による新規案件手動追加 |
| `updateSubStaff(caseId, subStaffArray)` | サブ担当の追加・変更 |
| `updateMeetUrl(caseId, newUrl)` | Meet/Zoom URL変更＋カレンダー同期 |
| `updateSupportHistory(caseId, roundIndex, patch)` | 過去対応記録の編集 |
| `deleteCaseAdmin(caseId)` | 管理者による案件削除 |
| `createGoogleMeetEvent(...)` | Google Meetイベント作成 |
| `createZoomMeeting(...)` | Zoomミーティング作成 |
| `verifyCcDryRun()` | CC設定のドライラン検証 |
| `saveDraft / loadDraft / deleteDraft / listDraftsForCase` | メール下書き管理（v1.11.0） |
| `scheduleEmail / cancelScheduledEmail / listScheduledForCase` | 予約送信管理（v1.11.0） |
| `processScheduledEmails_()` | 予約送信トリガハンドラ（5分間隔・内部） |
| `setupScheduledEmailTrigger()` | 予約送信トリガ登録（初回手動実行） |

### 重要な内部関数（v1.11.6追加）

| 関数 | 説明 |
|------|------|
| `adminTransitionStatus_()` | **管理者ステータス遷移ゲートキーパー** — 全ての管理者経由STATUS変更の統一処理。fromStatus×toStatusの組み合わせに応じた正しいDB操作を実行 |
| `buildHistoryEntry_()` | 現在回のフィールドをHISTORYエントリ形式に変換 |
| `applyWriteUpdates_()` | updatesオブジェクトを一括でDBに書き込む |
| `buildTransitionResult_()` | API戻り値（楽観的更新用サマリ）を構築 |
| `sanitizeForSheet_()` | スプレッドシート書き込み前の数式インジェクション防止（v1.11.4） |

---

## 6. 管理機能ステータス遷移（v1.11.6）

### ⚠️ 重要: 管理機能の STATUS 変更は必ず `adminTransitionStatus_()` を経由する

v1.11.6 以前は STATUS 列のみを書き換えていたため、データ不整合が発生していた。
v1.11.6 以降は全ての管理者 STATUS 変更が `adminTransitionStatus_()` を経由し、
各遷移で必要な DB 操作セットを確実に実行する。

### 遷移で実行されるDB操作（主要なもの）

| 遷移 | 実行される操作 |
|------|-------------|
| `completed → inProgress` | HISTORY保存 + supportCount+1 + DATE/CONTENT等クリア + 上限超過時 caseLimitOverride 自動+1 |
| `→ unhandled` | STAFF/DATE/METHOD/CONTENT/REMARKS/MEET_URL/ATTACHMENTS/TOOLS/SUB_STAFF クリア + supportCount=1 |
| `unhandled → inProgress` | STATUS変更 + optionsのSTAFF情報を設定 |
| `unhandled → inProgress`（再アサイン） | STAFF情報のみ変更、STATUS変更なし（unhandled以外） |

### caseLimitOverride 自動調整ルール

`completed → inProgress` 時に supportCount の新値が現在の上限を超える場合:
```
新 caseLimitOverride = 新 supportCount（新しい回を許容する最小値に自動調整）
```

---

## 7. 設定管理

管理者が設定画面から編集可能なキー: `docs/SDD.md` §S-00 参照

主要な設定:
- `MAIL_FORCE_CC`: 全メールの自動CC
- `ANNUAL_USAGE_LIMIT`: 年間利用上限（デフォルト10）
- `CASE_USAGE_LIMIT`: 案件ごと対応上限（デフォルト3）
- `MAIL_*`: 各種メールテンプレート
- `ZOOM_*`: Zoom API 認証情報
- `ATTACHMENT_FOLDER_ID`: 添付ファイル保存先DriveフォルダID

---

## 8. テスト

### E2E テスト（Playwright）

```bash
# 全テスト実行（49テスト / 約1.4分）
npm test

# UIモード（デバッグ用）
npm run test:ui

# レポート表示
npm run test:report
```

スペック一覧:
- `01-app-load`: アプリ初期化（7件）
- `02-case-list`: ケースリスト表示（9件）
- `03-mode-switching`: 表示モード切替（5件）
- `04-search-filter`: 検索・フィルタ（6件）
- `05-case-detail`: ケース詳細パネル（7件）
- `06-admin-features`: 管理者機能（6件）
- `07-a11y`: WCAG 2.1 AA アクセシビリティ（8件）

詳細: `docs/playwright-guide.html`

### 単体テスト（Jest）

```bash
npm run test:unit  # 34テスト / 約0.2秒
```

対象: `getFiscalYear` / `sanitizeForSheet_` / `parseNullablePositiveInteger_` / `normalizeEmail_` / `parseBoolean_` 等の純粋関数

---

## 9. 既知の課題・制約

| 項目 | 状態 | 備考 |
|------|------|------|
| Gmail Advanced Service | 手動有効化必要 | GASエディタで設定済み |
| Calendar Advanced Service | 手動有効化必要 | Meet URL作成に必要 |
| `ATTACHMENT_FOLDER_ID` | 未設定時は添付保存不可 | 設定シートにDriveフォルダIDを設定 |
| 新着バッジ | localStorage依存 | ブラウザをまたいだ既読状態は同期されない |
| 予約送信トリガ | 手動登録必要 | 本番初回デプロイ後に `setupScheduledEmailTrigger()` を1回実行 |
| color-contrast（旧バージョンデータ） | 修正済み | v1.11.5 で全違反を解消。既存 DB 内のデータは未修正 |
| `updateSupportHistory` 担当者チェックなし | 中リスク残存 | 担当者以外が過去履歴を編集可能（別 Issue で管理） |
| 管理機能で作成された不整合データ（v1.11.5 以前） | 残存可能性あり | v1.11.6 で今後の操作は整合性保証済み。旧データは修復スクリプトを別途検討 |
| SDD.md / Manual.md ドキュメント | v1.11.6 対応済み | 2026/05/10 更新 |
| GitHub Actions CI | ワークフローファイル設定済み | `.github/workflows/playwright.yml` |

---

## 10. 開発の進め方

### ローカル開発

```bash
npx serve -s . -l 3000
# 代替: python -m http.server 3000 --directory .
```

モックデータ（14パターン）で全機能の UI を確認できる。

### デプロイ手順

詳細: `docs/RUNBOOK.md` §3

```bash
# 1. 必ず先に git commit（clasp pull でローカルが上書きされる対策）
git add <files> && git commit -m "feat: vX.X.X - 説明"

# 2. GASにプッシュ（--force 必須）
clasp push --force

# 3. デプロイ更新
clasp deploy -i AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ -d "vX.X.X"
```

### 設計変更時の更新対象

1. `コード.js` — バックエンドロジック
2. `index.html` — フロントエンドUI + モックデータ
3. `docs/SDD.md` — 設計書（データモデル・関数仕様）
4. `docs/HANDOVER.md` — 本ドキュメント
5. `CLAUDE.md` / `AGENTS.md` — AI開発指示書（IDX定数等の変更時）
6. `CHANGELOG.md` — 変更履歴

### バージョン管理ルール

- `コード.js` 先頭コメント・SDD・HANDOVER のバージョンは常に一致させること
- 現行: **v1.11.6**

---

## 11. 次フェーズ候補

| ID | 内容 | 優先度 |
|----|------|--------|
| R1 | 管理機能不整合データの修復スクリプト | 中 |
| R2 | `updateSupportHistory` 担当者チェック追加 | 中 |
| 7-1 | CSV/スプレッドシートエクスポート機能 | 中 |
| 7-3 | 検索のスマート化（条件保存等） | 低 |
| T1 | 管理機能ステータス遷移の E2E テスト追加 | 高（v1.11.6の修正を保護） |
| T2 | `var→let/const` の残り最適化（`const` 候補の特定） | 低 |

---

## 12. バージョン履歴

| バージョン | リリース日 | 主な変更内容 |
|:---|:---|:---|
| v1.8.1 | 2026/02/19 | 初版リリース |
| v1.8.2 | 2026/02/20 | 利用制限設定化、管理者機能拡張 |
| v1.8.3 | 2026/02/20 | 通常/閲覧/管理 3モードボタン化 |
| v1.9.0 | 2026/02/23 | 検索UI刷新、管理インライン編集、新着バッジ |
| v1.9.x | — | 多数の機能追加（対応ツール、サブ担当、高速化、データ抽出等） |
| v1.10.0〜v1.10.3 | 2026/04/18 | 完了報告拡張、カレンダー連動強化、Zoom分離 |
| v1.11.0 | 2026/04/20 | メール下書き保存 + 予約送信機能 |
| v1.11.1〜v1.11.3 | 2026/04/20 | スマホ対応修正、UIフィードバック改善、自動CC説明追加 |
| **v1.11.4** | 2026/05/10 | セキュリティ修正（数式インジェクション対策・Babel SRI）|
| **v1.11.5** | 2026/05/10 | 残課題全対応（GitHub Actions CI・単体テスト34件・WCAG 2.1 AA修正・var→let・複雑度ロードマップ） |
| **v1.11.6** | 2026/05/10 | **管理機能ステータス遷移バグ完全修正**（adminTransitionStatus_() 新設、全11件の致命的・重大バグ修正）|
