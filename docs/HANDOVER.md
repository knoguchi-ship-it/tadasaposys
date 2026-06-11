# 開発者向け引継ぎ資料 (HANDOVER.md)

**Project:** タダサポ管理システム
**Version:** 1.12.9（現行リリース）
**Date:** 2026/06/11
**Author:** Development Team

---

## 1. 現行システムの状態

### 本番稼働中

- **URL**: `https://script.google.com/a/macros/tadakayo.jp/s/AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ/exec`
- **本番デプロイバージョン**: @154（v1.12.8、2026/06/11 デプロイ。固定 deploymentId / URL 不変。S1 Stage4＝Read切替を設定トグル `CASE_KEY_READ_VIA_MAP` で有効化可能に。Backfill は実行済＝既存136案件に case_id 付与・診断クリア）
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
| メール予約送信（5分間隔トリガ、取消可能） | 廃止 | v1.12.1（本人送信保証不可のため） |
| 「下書きあり」バッジ表示 | ✅ | v1.11.0 |
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
| **Playwright E2E テストスイート（61テスト）** | ✅ | **v1.11.5〜（T1/T2 で +8）** |
| **Jest 単体テスト（92テスト）** | ✅ | **v1.12.0〜** |
| **S1 案件キーのサロゲート化（Stage1-4＋Backfill・根治）** | ✅ | **v1.12.6〜v1.12.8** |
| **WCAG 2.1 AA color-contrast 全違反修正** | ✅ | **v1.11.5** |
| **日程の重複検知（バッファ込み・Zoom時のみ）** | ✅ | **v1.12.0** |
| **Zoom時のチームカレンダー強制登録（重複防止）** | ✅ | **v1.11.8** |
| **FullCalendar 埋込み（週/月ビュー・ドラッグ選択）** | ✅ | **v1.11.9** |
| **「いつものタダスクID」（固定Zoom）モード** | ✅ | **v1.12.0** |
| **送信メール差出人(From)の文字化け修正** | ✅ | **v1.12.2** |
| **選択中スロットの「✓ 選択中」緑バー永続表示** | ✅ | **v1.12.2** |
| **日程カレンダーのバッファ/既存予定への枠重ね防止** | ✅ | **v1.12.2** |
| **手動追加案件の年間カウント合流（同一メール+年度）** | ✅ | **v1.12.3** |
| **年度利用回数の管理者手動修正（実数の補正）** | ✅ | **v1.12.4** |

---

## 2. ファイル構成

```
tadasaposys/
├── index.html              ← フロントエンド（React SPA、5100行超）
├── コード.js               ← バックエンド（GAS、4200行超）
├── appsscript.json         ← GASマニフェスト
├── CLAUDE.md               ← Claude Code 専用 AI 開発指示書
├── AGENTS.md               ← OpenAI Codex 専用 AI 開発指示書
├── .claude/settings.json   ← Claude Code 起動方針（GitHub共有用）
├── claude-tadasaposys.ps1  ← Claude プロジェクト起動ランチャー
├── CHANGELOG.md            ← バージョン変更履歴（keepachangelog形式）
├── SECURITY.md             ← セキュリティ情報・脆弱性報告
├── package.json            ← テスト依存（Playwright/Jest）
├── playwright.config.ts    ← E2Eテスト設定
├── jest.config.js          ← 単体テスト設定
├── .claspignore            ← GASプッシュ除外設定（node_modules等を除外）
├── .clasp.json             ← clasp設定（.gitignore対象）
├── .codex/config.toml      ← Codex 起動方針（GitHub共有用）
├── codex-tadasaposys.ps1   ← Codex プロジェクト起動ランチャー
├── tests/
│   ├── e2e/                ← Playwright E2E テスト（9スペック、61テスト）
│   ├── pages/app.page.ts   ← Page Object Model
│   ├── fixtures/           ← カスタム Fixture
│   ├── unit/               ← Jest 単体テスト（92テスト）
│   └── manual/             ← 検証ハーネス（case-key-migration-harness.html・Playwright MCP用）
└── docs/
    ├── SDD.md              ← 設計書 v1.12.9
    ├── HANDOVER.md         ← 本ドキュメント
    ├── ADR.md              ← アーキテクチャ判断記録（ADR-001〜010）
    ├── RUNBOOK.md          ← 運用手順書
    ├── Manual.md           ← 操作マニュアル v1.12.1
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

詳細な判断基準と作業チェックリストは `AGENTS.md` / `CLAUDE.md` / `docs/RUNBOOK.md` の「グランドルール実行チェック」を参照する。

- **React 18.2.0 固定**: React 19系混在で `Minified React error #31` クラッシュ
- **clasp push --force**: `--force` なしだとサイレントにスキップされる場合がある
- **clasp pull 前に git commit**: ローカルファイルが上書きされる
- **案件リストシートへの書き込み禁止**: IMPORTRANGE 数式を破壊する
- **.claspignore の確認**: `node_modules/` 等が除外されていることを確認してから push
- **temp/ 配下は追跡禁止**: ローカルバックアップ・GAS上の残存スタブ確認用。Git/GAS配布対象から除外し、今後追わない
- **DRY原則**: 既存ヘルパー・既存パターンを確認し、共通化できる処理を重複実装しない。新設処理も同様
- **曖昧な依頼の明確化**: 不明瞭・抽象的・掘り下げが必要な依頼は、想像で作業せず、必ずユーザーへ質問して前提を明らかにしてから進める
- **影響範囲確認**: 既存機能を破壊しないことを、関連コード確認・テスト・差分確認で保証する
- **コード/ドキュメント整合**: コード更新時は毎回、SDD/HANDOVER/Manual/CHANGELOG/AI指示/モック/テスト等の必要箇所を同期する
- **セキュアコーディング**: 認証認可、入力検証/出力無害化、機密情報管理、データ保護/最小権限、監査性/エラー処理の5視点で実装・レビューする
- **ハードコーディング原則禁止**: 固定値は事前確認。機密情報は許可があってもコード・ドキュメント・GitHubに置かず、設定シート・PropertiesService・環境変数等で安全に管理する
- **ドライラン後の状態復元**: ドライランテストで作成・更新したテストデータは必ず削除または復元し、テスト前状態に戻す。戻せないドライランは実施しない
- **ER図/テーブル設計書はHTML**: 新規作成・更新時は人間が読みやすいHTMLで `docs/` 配下に保存する
- **人間向けドキュメント維持**: AI向け指示だけでなく、運用者・開発者・利用者が読める Markdown/HTML も更新する
- **文字化け修正**: 文字化けを見つけたら放置せず UTF-8 として読める状態へ修正する

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
| 予約送信キュー | v1.12.1で予約送信廃止。既存キュー履歴・無効化確認用（16列） |
| 年間利用補正 | 管理者による年度利用回数の手動補正（メール+年度→補正量。5列）（v1.12.4） |

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
| `scheduleEmail / cancelScheduledEmail / listScheduledForCase` | v1.12.1で廃止。新規予約登録・一覧表示は行わない |
| `processScheduledEmails_()` | 旧トリガー互換。送信せず未送信予約を `disabled` 化 |
| `setupScheduledEmailTrigger()` | v1.12.1以降は新規作成せず既存トリガーを削除 |
| `disablePendingScheduledEmails()` | 既存の `pending` / `sending` 予約を `disabled` 化 |

### 重要な内部関数（v1.11.6追加）

| 関数 | 説明 |
|------|------|
| `adminTransitionStatus_()` | **管理者ステータス遷移ゲートキーパー** — 全ての管理者経由STATUS変更の統一処理。fromStatus×toStatusの組み合わせに応じた正しいDB操作を実行 |
| `buildHistoryEntry_()` | 現在回のフィールドをHISTORYエントリ形式に変換 |
| `applyWriteUpdates_()` | updatesオブジェクトを一括でDBに書き込む |
| `buildTransitionResult_()` | API戻り値（楽観的更新用サマリ）を構築 |
| `sanitizeForSheet_()` | スプレッドシート書き込み前の数式インジェクション防止（v1.11.4） |
| `getSenderInfo_()` | **差出人情報取得（v1.12.2追加）** — `Session.getActiveUser()` をタダメンマスタで引き、`{email, name}` を返す。`sendInThread_` の From ヘッダ RFC 2047 エンコードに使用 |
| `caseFiscalYear_()` | **案件PKの年度解決（v1.12.3追加）** — 手動追加案件のPK `manual_<エポックミリ秒>` も申込日年度へ正しく解決する。`getFiscalYear` への委譲ラッパ |
| `annualUsageKey_()` | **年間集計キー生成（v1.12.3追加）** — `normalizeEmail_(email) + '_' + caseFiscalYear_(pk)`。フォーム申込と手動追加案件を同一メール+年度で合算するための統一キー |
| `setAnnualUsageCountAdmin()` | **年度利用回数の手動修正（v1.12.4追加）** — 目的の絶対値を受け、`補正量 = 目的値 − base` を `年間利用補正` シートへ保存。メール+年度単位 |
| `getAnnualAdjustmentMap_()` / `upsertAnnualAdjustment_()` / `ensureAnnualUsageAdjustmentSheet_()` | **年間利用補正シートのI/O（v1.12.4追加）** — 補正量の読込・upsert・シート初期化 |

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
# 全テスト実行（61テスト / 約3分）
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
- `08-scheduling`: 日程確定モーダル（重複検知・Zoom強制登録警告・URL発行モード・FullCalendar・非Meet/Zoom時のカレンダー文言）（7件 / **T1** + **R3ガード**）
- `09-admin-status-transition`: 管理者ステータス遷移（再開で回数+1・リセット・単純遷移）（3件 / **T2**、v1.11.6 回帰ガード）

> **モック整備（T1）**: ローカル/E2E で Zoom 機能を再現するため、`index.html` の `MOCK_MASTERS.methods` に `Zoom` を追加（本番 `getMasters` の `zoomEnabled` 時と同形状＝index1 に挿入）。モックは `IS_LOCAL` 専用で本番挙動に影響なし。

詳細: `docs/playwright-guide.html`

### 単体テスト（Jest）

```bash
npm run test:unit  # 92テスト / 約0.2秒
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
| 予約送信トリガ | 廃止 | `setupScheduledEmailTrigger()` は既存トリガー削除のみ。未送信予約は `disablePendingScheduledEmails()` で無効化。`clasp run` は権限エラーのため、GAS エディタから手動実行が必要 |
| color-contrast（旧バージョンデータ） | 修正済み | v1.11.5 で全違反を解消。既存 DB 内のデータは未修正 |
| `updateSupportHistory` 担当者チェック | ✅ 実装済み（誤記訂正） | **v1.9.72 から** `ensureCaseEditableByActor_(caseId, actor, false)` で担当者本人・サブ担当・管理者以外を `throw` で拒否済み（`コード.js:3314`）。旧版 HANDOVER の「チェックなし・中リスク残存」は事実誤認のため R2 で訂正。※サーバ権限を保証する自動テストは未整備（harness が GAS Session 依存のため）|
| 管理機能で作成された不整合データ（v1.11.5 以前） | 主動機は解消／汎用修復スクリプトは未作成 | R1 が主眼とした「完了→未対応に戻る」不整合は **S1（Stage0-4）で根治済み**（本番 `duplicateRecordFk=0`）。残存の有無は読み取り専用 `diagnoseCaseKeyMigration_()` で点検可能。汎用の一括修復スクリプトは未作成で、現時点で必要性は低い（R1 参照） |
| SDD.md / Manual.md ドキュメント | v1.12.9 対応済み | 2026/06/11 更新 |
| GitHub Actions CI | ワークフローファイル設定済み | `.github/workflows/playwright.yml` |
| **GAS 上の `temp/index.html` `temp/コード.js`** | 残存（無害化済み）・要手動削除 | clasp push 事故で残存したスタブファイル。doGet 等の関数定義は除去済みで動作影響なし。**ローカルは `.gitignore`(`temp/`) で非追跡＋`.claspignore`(`temp/**`) で push 除外済み**だが、`clasp push` は**既存リモートファイルを削除しない**ため GAS 側スタブは消えない。削除は GAS エディタで手動（手順は RUNBOOK §2-4 参照）。R4 で手順を明記 |
| **`appsscript.json` の `exceptionLogging`** | 監視継続 | 過去に GAS 側で `STACKDRIVER`→`NONE` に変更された痕跡あり。v1.11.8 デプロイ時に復元済み。デプロイ前は git diff で要確認 |
| **GoogleMeet 以外（電話/対面/メール等）でのカレンダー登録** | 既存仕様の歪み | UI は「カレンダーに登録します」と表示するが、バックエンドで実装されていない（pre-existing）。Phase 5 候補 |
| **chiTeam カレンダーへの個人スタッフの書込権限** | 運用前提 | 全タダメンが TEAM_CALENDAR_ID にイベント作成権限を持つ前提。新メンバー追加時は要確認 |

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
7. `docs/*.html` — ER図・テーブル設計書・人間向け補助資料（該当する設計変更時）

### バージョン管理ルール

- `コード.js` 先頭コメント・`index.html`・SDD・HANDOVER・Manual・CHANGELOG・CLAUDE.md・AGENTS.md・package.json のバージョンは常に一致させること
- 現行: **v1.12.9**

### 🔒 デプロイ時の絶対グランドルール（CLAUDE.md / AGENTS.md にも記載）

1. **Webapp 設定固定**: `executeAs: USER_ACCESSING` / `access: DOMAIN`（NPO法人タダカヨ内）
   - ❌ 禁止: 実行=自分（`USER_DEPLOYING`） / アクセス=Googleアカウント全員（`ANYONE_WITH_GOOGLE_ACCOUNT`）
   - 過去にこの誤設定でセキュリティホールが発生。介護事業所の個人情報を扱うため再発禁止
2. **既存 deploymentId へのバージョンアップのみ**: `clasp deploy -i AKfycbw...nuq0ZJHhhUQ -d "vX.X.X"`
   - ❌ 禁止: `-i` 省略コマンド / GAS の「新しいデプロイ」ボタン
   - 新規デプロイは URL が変わり、案内済みのブックマーク・QR・メールリンクが全失効する
3. デプロイ前に `appsscript.json` の `webapp` 設定を git diff で確認、デプロイ後は GAS デプロイ管理画面で目視確認

---

## 11. 次フェーズ候補

| ID | 内容 | 優先度 | メモ |
|----|------|--------|------|
| **S1** | **案件キーのサロゲート化（根治・expand-contract移行）** | **✅ 完了（Stage1-4＋Backfill）** | v1.12.6 は止血(Stage0)のみ。根因＝不安定な日付PKを `String()` 突合し Sheets が UNIQUE を強制できないこと。エポックms基盤の決定的 `case_id`（`case_<epoch>`）を導入し `案件キーマップ` シートで一元解決。**Expand→Dual-write→Backfill→Read切替→Contract** で段階移行。設計: `docs/er-after.dbml` / `docs/SDD.md` §S-09。各段E2E回帰＋ロールバック、Backfill以降（本番データ変更）の前で必ず停止。詳細・根因はメモリ `project_case_key_duplicate_bug.md`。<br>**✅ Stage1（Expand 基盤）完了**: `案件キーマップ` シート（`getOrCreateCaseKeyMapSheet_`）＋採番ヘルパー `getOrCreateCaseId_`（`withScriptLock_` で排他・冪等）＋正準化 `canonicalNaturalKey_`/`buildCaseId_`＋読み取り専用診断 `diagnoseCaseKeyMigration_`。<br>**✅ Stage2（Dual-write）完了**: 7チョークポイント（`assignCase`/`reassignCaseAdmin`/`ensureRecordRowForCase_`/`recordEmail_`/`saveDraft`/`getOrCreateOverrideRowIndex_`/`addManualCase`）から `ensureCaseKeyMapping_`（非致死・生PKを権威解決しBackfillと同一 case_id に収束）を呼び案件キーマップへ登録。`withScriptLock_` に再入ガード追加（GAS ScriptLock 非再入のデッドロック防止）。単体テスト計83件・E2E 51件パス。**本番挙動ゼロ変化（マップ追記のみ）。v1.12.7 で本番反映済**。<br>**✅ Stage3（Backfill）本番実行済**: `backfillCaseKeyMap_(options)`（既定 `dryRun:true`／`dryRun:false`で一括追記）＋`planBackfill_`（既登録スキップ・重複自然キー dedup・衝突連番）。冪等（再実行で重複ゼロ）。**本番で既存136案件すべてに case_id 付与済み**（診断: unmappedCount=0 / unparseable=0 / duplicateRecordFk=0）。単体5件追加（計88）＋ハーネス Playwright MCP 16/16。<br>**✅ Stage3 アプリ実行手段**: 管理者がアプリ上で実行できる公開エントリ `runCaseKeyMigrationDiagnosis()` / `runCaseKeyBackfill(dryRun)`（`requireAdmin_`・監査ログ記録）と、設定管理ダイアログの「メンテナンス：案件キーマップ Backfill」UI（①診断 ②ドライラン ③本実行）を追加。手動GASエディタ操作は不要。<br>**✅ Stage4（Read切替）実装完了・フラグ既定OFF**: `getAllCasesJoined` の内部結合キーを `joinKeyForRead_(raw, viaMap)` 経由にし、設定 `CASE_KEY_READ_VIA_MAP`（既定false）で `String(PK)`→正準 `case_id` へ切替可能に。表示id は `String(PK)` 維持（書込互換）。表記ブレFKの結合ズレを解消。単体4件追加（計92）＋ハーネスに Stage4 追加し Playwright MCP 19/19（OFF=unhandled／ON=completed／一致FK回帰なし）。**デプロイ済みコードだが既定OFFで挙動ゼロ変化**。<br>**✅ Stage4 有効化手段（v1.12.8 @154 デプロイ済）**: 設定 `CASE_KEY_READ_VIA_MAP` を**設定管理ダイアログの boolean トグル**として公開（「その他」タブ）。ON で読取結合が case_id 経由、OFF（既定）で従来挙動。Backfill 済み・診断クリアのため ON/OFF とも表示同一（堅牢化）。**ロールバックはトグルOFFのみ（無デプロイ）**。<br>**🟡 Stage5（Contract）は見送り**: バグ直接原因は消失済（duplicateRecordFk=0）で根治は実質完了。識別子の case_id 置換（フロント~15＋バック~30箇所改修＋破壊的データ移行）は便益<リスクのため未実施。Stage4 コードと case_id 基盤は将来の選択肢として温存（master 保持）。 |
| ~~R1~~ | ~~管理機能不整合データの修復スクリプト~~ | — | **🟢 縮退/クローズ候補**: 主動機（完了→未対応に戻る不整合）は **S1 で根治済み**（本番 `duplicateRecordFk=0`）。残存点検は読み取り専用 `diagnoseCaseKeyMigration_()` で可能。汎用の一括修復スクリプトは未作成だが、現状必要性は低い。**新たな不整合の具体的報告が出た時点で要否を再判断**（想像で先回り実装しない方針） |
| ~~R2~~ | ~~`updateSupportHistory` 担当者チェック追加~~ | — | **✅ 実装済み（誤記訂正）**: v1.9.72 から `ensureCaseEditableByActor_` で担当者本人・サブ担当・管理者以外を拒否（`コード.js:3314`）。HANDOVER §9 の誤記を訂正。残課題はサーバ権限の自動テスト（harness が GAS Session 依存で未整備）→ 別途 T 系で検討余地 |
| **R3** | **GoogleMeet 以外でのカレンダー登録未実装の判断** | **要引継ぎ判断** | **本体実装は次の引継ぎ者が方針決定**（A:全方法で登録実装／B:非Meet/Zoomは登録UIを出さない／C:現状維持で仕様明文化）。**今回は虚偽UI文言のみ修正**: 非Meet/Zoom方法で useCalendar=ON 時に「カレンダーに予定を登録します」と表示していた偽の案内を、「カレンダー登録は行われません（記録のみ）」の注記へ変更（`index.html` 日程モーダル）。バックエンドのカレンダー作成は未実装据え置き（`updateSupportRecord` は Zoom/GoogleMeet のみ作成） |
| ~~**R4**~~ | ~~GAS 上の temp/index.html・temp/コード.js を削除~~ | 低（運用） | ローカル衛生は完了（`temp/` は git 非追跡・clasp push 除外）。**GAS リモートのスタブ削除手順を RUNBOOK §2-4 に明記**。`clasp push` では削除されないため GAS エディタで手動削除（運用作業のため当方からの削除は不可） |
| 7-1 | CSV/スプレッドシートエクスポート機能 | 中 | 案件・サポート記録のCSV出力 |
| 7-3 | 検索のスマート化（条件保存等） | 低 | 検索条件のお気に入り機能 |
| ~~**T1**~~ | ~~日程確定刷新（v1.11.7-v1.12.0）の E2E テスト追加~~ | — | **✅ 完了**: `tests/e2e/08-scheduling.spec.ts`（5件）。重複検知・Zoom強制登録警告・URL発行モード(新規/固定ID)・FullCalendar埋込を検証。モック整備として `MOCK_MASTERS.methods` に Zoom 追加（本番 zoomEnabled 同形状・IS_LOCAL専用） |
| ~~T2~~ | ~~管理機能ステータス遷移の E2E テスト追加~~ | — | **✅ 完了**: `tests/e2e/09-admin-status-transition.spec.ts`（3件）。完了→対応中(再開で回数+1)・→未対応(リセット)・→キャンセル(単純遷移)で v1.11.6 `adminTransitionStatus_()` を保護 |
| ~~T3~~ | ~~`var→let/const` の残り最適化~~ | — | **✅ 完了（限定範囲）**: `コード.js` 最上位の不変定数7件を `const`、可変キャッシュ3件を `let` に変換（無挙動変更・`node --check` 済）。`index.html` の関数ローカル175件は Babel in-browser コンパイル＋同一スコープ `var` 再宣言が存在し、CI lint 不在のためリスク>便益と判断し見送り |

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
| **v1.11.7** | 2026/05/10 | 日程確定刷新 Phase 1: バックエンド土台 + 設定キー6個追加 + 自動マイグレーション |
| **v1.11.8** | 2026/05/10 | Phase 2: 重複検知 + Zoom時チームカレンダー強制登録 |
| **v1.11.9** | 2026/05/11 | Phase 3: FullCalendar 埋込み（ドラッグ選択 + バッファ可視化） |
| **v1.12.0** | 2026/05/11 | Phase 4: 「いつものタダスクID」モード追加・ドキュメント完全更新（@142-143） |
| **v1.12.1** | 2026/05/28 | 予約送信機能を廃止（@147）。旧トリガー互換は未送信キューを `disabled` 化し、即時送信・下書き保存は継続 |
| **v1.12.2** | 2026/06/03 | backup ブランチ統合: 送信メール From 文字化け修正（実害バグ）+ 選択中スロット緑バー永続表示 + 日程カレンダーのバッファ/既存予定への枠重ね防止。版数衝突を解消し再採番（@148 デプロイ済み） |
| **v1.12.3** | 2026/06/03 | 手動追加案件の年間カウント合流: フォーム申込と同一メール（正規化）+ 同一年度で利用回数を合算（`caseFiscalYear_`/`annualUsageKey_` 新設）。手動追加直後の受付日「manual_…」表示も修正（@149 デプロイ済み） |
| **v1.12.4** | 2026/06/03 | 年度利用回数の管理者手動修正: 案件詳細「今年度利用数」から実数を直接入力で補正（`年間利用補正` シート + `setAnnualUsageCountAdmin` 新設）。メール+年度単位で反映（@150 デプロイ済み） |
| **v1.12.5** | 2026/06/09 | 管理担当者インライン変更のバグ修正: `handleAdminReassignInline` が API 戻り値を捕捉せず `result is not defined`（ReferenceError）で失敗していた問題を、共通ヘルパー `applyCaseTransitionResult` への集約（DRY）で修正。デッドコード削除＋回帰E2E追加（@151 デプロイ済み） |
| **v1.12.6** | 2026/06/11 | 重複サポート記録による「完了しても未対応に戻る」事象の止血（Stage 0）: 表示の `recordMap` を「最初の一致」採用に統一し書込経路と一致＋`withRecordWriteLock_`（LockService）で検索→追記を排他化し重複行生成を防止。単体テスト4件追加（計72件）。根治（案件キーのサロゲート化）は後続 expand-contract 予定（@152 デプロイ済み） |
| **v1.12.7** | 2026/06/11 | S1 案件キーのサロゲート化 Stage1-3（根治の段階移行）: 決定的サロゲート `case_id`（`case_<epoch>`）＋`案件キーマップ`シート（Expand）／7チョークポイントの Dual-write（additive・読取/FK列不変）／冪等 Backfill `backfillCaseKeyMap_`（既定dryRun・管理画面から実行可能）。`withScriptLock_` 再入ガード追加。単体72→88件・E2E51件パス＋Playwright MCP harness 16/16（@153 デプロイ済み） |
| **v1.12.8** | 2026/06/11 | S1 Stage4（Read切替）有効化: 設定 `CASE_KEY_READ_VIA_MAP` を設定管理のトグルとして公開（ONで結合を case_id 経由・既定OFF・OFFで即ロールバック）。本番Backfill完了（136案件・診断クリア duplicateRecordFk=0）で根治完了。単体92件・E2E51件・harness19/19。Stage5(Contract)は便益<リスクで見送り（@154 デプロイ済み） |
| **v1.12.9** | 2026/06/11 | R/T タスク対応: **R3** 日程確定モーダルの虚偽UI文言を修正（非Meet/Zoom方法で useCalendar=ON 時「カレンダーに登録します」→「登録は行われません(記録のみ)」。バックエンドのカレンダー作成は未実装据え置き＝引継ぎ判断）。**R2** `updateSupportHistory` 担当者チェックは実装済みのため誤記訂正。**R1** S1 根治で動機消失につき縮退。**R4** GAS残存スタブの手動削除手順を RUNBOOK §2-4 に明記。**T1/T2** 日程確定・管理ステータス遷移の E2E 追加＋**R3ガード**（E2E 51→61件）。**T3** `コード.js` 最上位定数の const/let 化（無挙動）。本番差分は R3 文言のみ |

---

## 13. 直近セッション作業ログ（2026/05/10〜2026/05/28）

このセッションで実施した日程確定刷新プロジェクトと整合性監査の記録。次の担当者がコンテキストを引き継ぐためのリファレンス。

### 13-1. 確立したグランドルール（CLAUDE.md / AGENTS.md / RUNBOOK.md に明文化）

- **Webapp 設定固定**: `USER_ACCESSING` / `DOMAIN` から逸脱禁止（過去事故あり）
- **既存 deploymentId へのバージョンアップのみ**: 新規デプロイ作成は URL 失効を招くため禁止

### 13-2. 日程確定刷新プロジェクト（v1.11.7〜v1.12.0）

**動機:** Zoom がタダスク業務とアカウント共有しており、ダブルブッキング事故が発生。日程確定モーダルに視覚的な空き状況確認と重複検知を導入。

| Phase | バージョン | デプロイ | 主な追加 |
|-------|----------|--------|--------|
| 1 | v1.11.7 | @137-138 | バックエンド土台（`getScheduleAvailability` / `checkScheduleConflict` / 純粋関数群）、設定キー6個、自動マイグレーション |
| 2 | v1.11.8 | @139 | 重複検知UI（赤帯ブロック）、method=Zoom 時のチームカレンダー強制登録 |
| 3 | v1.11.9 | @140-141 | FullCalendar 6.1.18 グローバルバンドル埋込み、ドラッグ選択、バッファ斜線表示 |
| 4 | v1.12.0 | @142 | 「いつものタダスクID」（固定Zoom）ラジオモード、全ドキュメント更新 |
| 整合性 | v1.12.0-r2 | @143 | 整合性監査結果の修正（バージョン文字列・SETTINGS_LABEL_MAP_補完・ADR-011/012追加） |

### 13-3. 仕様変更（要周知）

| 項目 | 旧（〜v1.11.6） | 新（v1.12.0〜） |
|------|--------------|--------------|
| 方法=Zoom + カレンダー登録チェックOFF | 何もしない | チームカレンダーには登録（重複防止のため必須） |
| 重複する日程の送信 | そのまま登録 | 赤帯エラーで送信ブロック |
| 重複チェック対象 | （なし） | **方法=Zoom 時のみ**（他の方法はチェックなし） |
| カレンダー視覚化 | datetime-local のみ | FullCalendar の週/月ビュー埋込み |

### 13-4. 設定シート新キー（自動マイグレーションで追加済み）

`ensureAttachmentSchema_()` から `addScheduleZoomSettings()` を自動呼出し（SCHEMA_VERSION_=6）。次回ユーザー初回アクセス時に設定シートへ追加される。

| キー | 既定値 | 用途 |
|-----|------|-----|
| `TEAM_CALENDAR_ID` | チームタダカヨカレンダーID | Zoom予約・日程確定の書込み先（強制） |
| `DISPLAY_CALENDARS_JSON` | `[{"name":"タダスク","id":"..."}]` | 重複監視する読取専用カレンダー |
| `SCHEDULE_BUFFER_MIN` | `30` | 重複判定で前後に確保するバッファ（分） |
| `ZOOM_FIXED_URL` | （空） | 「いつものタダスクID」の参加URL |
| `ZOOM_FIXED_ID` | （空） | 同 ミーティングID |
| `ZOOM_FIXED_PASS` | （空） | 同 パスコード |

### 13-5. 整合性監査結果（v1.12.0-r2 で修正完了）

監査範囲: 全 `*.md` `*.js` `*.html` `*.json` のバージョン文字列、純粋関数の同期、設定キーの網羅性、ADR の意思決定記録、グランドルール準拠。

修正内容:
- AGENTS.md / CLAUDE.md / HANDOVER.md / RUNBOOK.md のバージョン表記不整合（8箇所）
- ADR-011（FullCalendar 採用）/ ADR-012（Zoom 強制登録 + 限定重複検知）追加
- `SETTINGS_LABEL_MAP_` に欠落していた4キー（`MAIL_NEW_SUBJECT` / `MAIL_SCHEDULE_SUBJECT` / `MAIL_SCHEDULE_BODY` / `TOOL_MONTHLY_LIMITS`）を補完

検証結果:
```
Jest 単体テスト   : 92/92 PASS
JSX 構文          : OK
pure-functions.js : 10/10 関数同期
設定キー          : getEditableSettingsKeys_(25) ≡ SETTINGS_LABEL_MAP_(25) ≡ settingsMeta(25)
Webapp 設定       : USER_ACCESSING / DOMAIN ✅
deploymentId      : 固定値維持
```

### 13-6. 2026/05/28 引継ぎ最終整備

v1.12.1 デプロイ後、次担当者が安全に作業へ入れるよう、開発ルールと起動設定を整理した。

完了内容:
- `temp/` 配下を Git/GAS 配布対象から除外し、ローカルバックアップ・残存スタブ確認用として扱うルールを明文化
- グランドルールを「判断基準 + 作業チェックリスト」の2層構造へ再編
- DRY原則、曖昧な依頼の明確化、既存機能保護、セキュアコーディング5視点、ハードコーディング禁止、機密情報管理、ドキュメント整合、文字化け修正を明文化
- ドライランテスト後は、作成・更新したテストデータを必ず削除または復元し、テスト前状態へ戻すルールを追加
- Codex 用のプロジェクト共有設定 `.codex/config.toml` と起動ランチャー `codex-tadasaposys.ps1` を追加
- Claude 用のプロジェクト共有設定 `.claude/settings.json` と起動ランチャー `claude-tadasaposys.ps1` を追加
- RUNBOOK の v1.12.1 / `SCHEMA_VERSION_ = '6'` 表記を実装と整合

直近コミット:
- `387b937 docs: ドライラン後の状態復元ルールを追加`
- `e8992d2 chore: Claudeプロジェクト起動設定を追加`
- `2b33968 chore: Codexプロジェクト起動設定を追加`
- `408c549 docs: グランドルールを二層構造に整理`
- `0a0b2ee docs: temp除外ルールを明文化`

### 13-7. 2026/06/03 backup ブランチ統合（v1.12.2）

開発再開時に、`backup/local-v1.12.1-to-1.12.3` ブランチが master と分岐し、未マージのコード修正3件が取り残されていることを検出。版数も衝突していた（master=予約送信廃止の v1.12.1／backup=緑バーの v1.12.1）。

**経緯と判断:**
- 本番（master @147 v1.12.1）をベースに据え、backup の3コミットを `git cherry-pick -x` で取り込み（コード本体はクリーンに自動マージ、衝突はドキュメント版数のみ）。
- 版数衝突を解消するため、3変更を単一の **v1.12.2** に再採番して束ね、全ドキュメントの版数を統一。
- ベストプラクティス（自己完結 hotfix は cherry-pick）に準拠。分岐元の `backup/local-v1.12.1-to-1.12.3` は保全のため残置。

**取り込んだ修正:**
| 旧版（backup） | 内容 | 統合先 |
|------|------|------|
| 2e086bd (v1.12.1) | 選択中スロット「✓ 選択中」緑バー永続表示 | v1.12.2 |
| 0cb7ff3 (v1.12.2) | 送信メール From 文字化け修正（実害バグ）| v1.12.2 |
| 3e5903c (v1.12.3) | 日程カレンダーの枠重ね防止 (`selectOverlap`) | v1.12.2 |

**結果:** v1.12.2 を固定 deploymentId へ **@148** デプロイ済み（From 文字化けの実害バグは本番で解消）。`clasp deployments` で新規デプロイ未作成・URL 不変を確認。

---

## 14. 次の担当者へのクイックスタート

### 1. 最初に読むもの（30分）

1. **本ファイル `docs/HANDOVER.md`** §1〜§13（現状把握）
2. **`CLAUDE.md`** または **`AGENTS.md`**（AI 開発支援を使う場合）
3. **`docs/SDD.md`** §1（データモデルと IDX 定数）
4. **`docs/ADR.md`**（10件の設計判断）

AIツール起動:

```powershell
.\codex-tadasaposys.ps1
.\claude-tadasaposys.ps1
```

### 2. ローカル環境構築（10分）

```bash
git clone <repo>
cd tadasaposys
npm install
npx serve -s . -l 3000  # → http://localhost:3000
```

モックデータ14パターンで全機能の UI を確認できる（GAS API は IS_LOCAL モックでスタブ化）。

### 3. テスト走行（5分）

```bash
npm run test:unit  # Jest 55件
npm test           # Playwright E2E 51件
```

### 4. 本番デプロイ（変更がある場合）

**絶対グランドルール（§10「バージョン管理ルール」参照）を厳守**:
1. `appsscript.json` の `webapp` 設定が `USER_ACCESSING` / `DOMAIN` であることを確認
2. `git commit` してから `clasp push --force`
3. `clasp deploy -i AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ -d "vX.X.X"`
4. デプロイ後、ブラウザの GAS デプロイ管理画面で設定を目視確認

### 4-1. v1.12.1 デプロイ後の残作業

2026/05/28 に固定 deploymentId へ `v1.12.1` をデプロイ済み（@147）。ユーザーによる動作確認は完了済み。

`clasp run disablePendingScheduledEmails` は権限エラーで実行できなかったため、旧予約送信キューや旧トリガーが残っている場合のみ、GAS エディタから以下を手動実行する。

```javascript
disablePendingScheduledEmails();  // pending/sending の旧予約を disabled 化
setupScheduledEmailTrigger();     // 旧 processScheduledEmails_ トリガーを削除
getScheduledEmailTriggerStatus(); // { active: false } を確認
```

### 4-2. v1.12.2 のデプロイ（2026/06/03 実施済み）

backup ブランチの3修正を本番ラインへ統合し、リポジトリを **v1.12.2** に再採番後、固定 deploymentId へ **@148** としてデプロイ済み（From 文字化けの実害バグは本番で解消）。新規デプロイは作成せず URL 不変。

実施コマンド:
```bash
clasp push --force   # appsscript.json / index.html / コード.js の3ファイル
clasp deploy -i AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ -d "v1.12.2"
# → @148。clasp deployments で固定IDのみ(新規なし)を確認済み
```

> ⚠️ デプロイ直後の**目視確認**（GAS デプロイ管理画面で「実行=アクセスしているユーザー / アクセス=NPO法人タダカヨ 内の全員」）は、ブラウザの GAS 管理画面で都度実施すること。appsscript.json は正値でプッシュ済み。

### 5. 推奨される次の作業（優先度順）

1. ~~**T1/T2** — 日程確定・管理ステータス遷移の E2E テスト追加~~ ✅ 完了（08/09 spec・計8件追加、E2E 59件）
2. **R3** — GoogleMeet 以外のカレンダー登録未実装を修正（pre-existing バグ）
3. **R4** — GAS 上の temp/* スタブを手動削除
4. **R1/R2** — 管理機能関連の修復スクリプトと担当者チェック追加
5. **7-1** — CSV エクスポート機能

### 5-1. グランドルール運用状況

G1（グランドルール見直し）は 2026/05/28 に完了。以後は `AGENTS.md` / `CLAUDE.md` / `docs/RUNBOOK.md` の「グランドルール実行チェック」に従う。

特に次の点は毎回確認する:
- 不明瞭・抽象的・掘り下げが必要な依頼は、想像で進めずユーザーに質問して明確化する
- ドライランテストで作成・更新したテストデータは、必ず削除または復元してテスト前状態へ戻す
- コード変更時は、コード・ドキュメント・テスト・モックデータの整合性を必ず合わせる
- 機密情報は、操作者の許可があってもコード・ドキュメント・GitHubに置かない

### 6. 困ったとき

- **設計の意図を知りたい**: `docs/ADR.md`（ADR-001〜012）
- **データモデルの詳細**: `docs/SDD.md` §1
- **デプロイ事故対応**: `docs/RUNBOOK.md` §4-5
- **コードの場所を探す**: `コード.js` は約4500行・1ファイル / `index.html` は約5400行・1ファイル（モックデータも含む）。`docs/HANDOVER.md` §5 にバックエンド関数一覧あり

### 7. 連絡先・関連リソース

- **本番URL（不変）**: https://script.google.com/a/macros/tadakayo.jp/s/AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ/exec
- **GAS プロジェクト**: ID `1UMg3CaTlbZW0YfjzgqbOwd-XOYdIsVELmGpsP7O-MrwFSiAJdS-ySLvP`
- **タダサポDB**: ID `1hllLdETiK0sk0xW_y0V6vOmnlK7kIkHBjntYiCTom4w`
- **フォーム回答シート**: ID `1cvwtRJSK3gD1SLhG3TBD0uJFsR3ApIpZsYWaruDnJ5A`（IMPORTRANGE で案件リスト生成）

---

**🎁 最後に**

このプロジェクトは介護事業所への無料 IT サポートを支える社会的意義のある仕組みです。タダメン（運営スタッフ）の運用負担を最小化し、サポート相手の事業所に最大の価値を届けることが最終目的です。技術的な意思決定はすべて「タダメンが楽に・ミスなく業務を回せること」と「相談者に迷惑をかけないこと」の二軸で判断してください。

不明点があれば `docs/ADR.md` の意思決定背景を読み、それでも分からなければ過去の Issue / PR / コミット履歴を辿ってください。よろしくお願いします。
