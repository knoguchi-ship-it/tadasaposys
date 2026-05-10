# 開発者向け引継ぎ資料 (HANDOVER.md)

**Project:** タダサポ管理システム
**Version:** 1.11.3（現行リリース）
**Date:** 2026/05/10
**Author:** Development Team

---

## 1. 現行システムの状態

### 本番稼働中

- **URL:** `https://script.google.com/a/macros/tadakayo.jp/s/AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ/exec`
- **Webapp 設定:** `executeAs: USER_ACCESSING` / `access: DOMAIN`
  - `USER_ACCESSING`: スクリプトがアクセスユーザーの権限で実行される。`Session.getActiveUser()` で実際のログインユーザーのメールを取得可能
  - `DOMAIN`: tadakayo.jp ドメインのユーザーのみアクセス可能
- **認証:** タダメンマスタ（B列=氏名, C列=メールアドレス, D列=ROLE）で認証

### 実装済み機能

| 機能 | 状態 | 追加バージョン |
|------|------|--------------|
| 案件一覧（6タブ: 未対応/対応中/完了/キャンセル/対応不可/全て） | ✅ | v1.8.1〜v1.9.38 |
| 担当アサイン（メール付き / メールなし の2方式） | ✅ | v1.8.1 |
| 日程確定（カレンダー連携 + Meet/Zoom URL 自動発行） | ✅ | v1.8.1 |
| 日程確定時にメール作成モーダル自動表示 | ✅ | v1.9.89 |
| 完了報告・記録修正（対応日時なしでも入力可能） | ✅ | v1.8.1〜v1.9.22 |
| 完了報告時にサービス種別・都道府県を入力可能 | ✅ | v1.10.0 |
| 案件再開（最大N回、履歴JSON保存） | ✅ | v1.8.1 |
| 2回目以降の対応回のロールバック（取り消し） | ✅ | v1.9.94 |
| キャンセル機能（キャンセル理由記録モーダル） | ✅ | v1.9.38〜v1.9.96 |
| 年間利用制限（設定値/年度、デフォルト10回） | ✅ | v1.8.2 |
| 案件ごと対応回数制限（設定値、デフォルト3回） | ✅ | v1.8.2 |
| 案件・年度ごとの上限特例設定（管理者） | ✅ | v1.8.2 |
| 回数超過メール送信 → 対応不可 | ✅ | v1.8.1 |
| メール機能（初回/新規/返信/回数超過/日程 の5モード、CC/BCC対応） | ✅ | v1.8.1〜v1.9.42 |
| メール送信時にサブ担当⇔メイン担当をCC自動設定 | ✅ | v1.9.61 |
| 管理者メールCC自動追加（MAIL_FORCE_CC） | ✅ | v1.9.72 |
| 新規メール件名テンプレート | ✅ | v1.9.91 |
| 表示モード切替（通常/閲覧/管理 の3ボタン式） | ✅ | v1.8.3 |
| 検索UI（常時表示キーワード・チップ型フィルタ・期間プリセット・並び順） | ✅ | v1.9.0 |
| 対応ツールフィルター | ✅ | v1.9.29 |
| 完了報告/記録修正でのファイル添付（D&D対応、1回最大5件） | ✅ | v1.8.1 |
| 管理者機能（スタッフ管理/設定編集/再アサイン/監査ログ） | ✅ | v1.8.2 |
| 管理モード インライン編集（ステータス・担当者・上限をクリック変更） | ✅ | v1.9.0 |
| 管理者編集フォーム（担当者サジェスト、対応時間フィールド） | ✅ | v1.9.87 |
| 新着バッジ（タブごとの未読件数、管理モードでON/OFF可能） | ✅ | v1.9.0 |
| 対応ツール選択＋月間上限機能 | ✅ | v1.9.43 |
| 対応ツール設定管理（追加・編集・削除・並び替え） | ✅ | v1.9.31 |
| ツール月間利用数バッジ（サイドバー） | ✅ | v1.9.44 |
| 当月の依頼件数バッジ（ケースリスト上部） | ✅ | v1.9.78 |
| サブ担当（OJT）機能（最大1名、検索サジェスト付き） | ✅ | v1.9.58〜v1.9.60 |
| 管理者向けデータ抽出（都道府県＋事業所名、項目選択UI） | ✅ | v1.9.53〜v1.9.55 |
| 新規案件の手動追加（管理モード） | ✅ | v1.9.13 |
| 案件削除（管理者専用、ソフトデリート） | ✅ | v1.9.68 |
| Meet/Zoom URL コピーボタン＋編集機能 | ✅ | v1.9.62〜v1.9.73 |
| カレンダー連動強化（Meet/Zoom URL変更時にカレンダー同期） | ✅ | v1.9.73〜v1.9.82 |
| カレンダーイベント作成時にアプリURLを説明欄に追記 | ✅ | v1.10.1 |
| Zoom会議作成とカレンダーイベント作成を分離（Zoom API失敗時もカレンダー作成） | ✅ | v1.10.2 |
| Zoom選択時にタダスク利用確認の注意メッセージ表示 | ✅ | v1.10.3 |
| メール下書き保存（手動保存、モード/スレッド別、自動復元プロンプト） | ✅ | v1.11.0 |
| メール予約送信（日時指定、5分間隔トリガで自動送信、取消可能） | ✅ | v1.11.0 |
| 案件一覧に「下書きあり」「予約あり」バッジ表示 | ✅ | v1.11.0 |
| 新規案件追加モーダルのスマホ送信バグ修正 | ✅ | v1.11.1 |
| 下書き保存・予約送信ボタンの押下フィードバック追加 | ✅ | v1.11.2 |
| メール作成画面に自動CC（MAIL_FORCE_CC）の説明を追加 | ✅ | v1.11.3 |
| 過去対応記録の編集機能 | ✅ | v1.9.72 |
| 対応記録・備考内のURL自動リンク化 | ✅ | v1.9.15 |
| 操作中のグレーアウト＋スピナー表示 | ✅ | v1.9.69 |
| アプリ内ヘルプ（操作マニュアル） | ✅ | v1.9.83 |
| 楽観的更新＋バックエンドバッチ書込み＋フロントメモ化で高速化 | ✅ | v1.9.67 |
| 初期データHTML埋め込み＋CDN preconnect/preloadで起動高速化 | ✅ | v1.9.66 |
| 全モーダルスクロール対応 | ✅ | v1.10.0 |

---

## 2. ファイル構成

```
tadasaposys/
├── index.html          ← フロントエンド（React SPA、単一ファイル、5100行）
├── コード.js            ← バックエンド（GAS、4021行）
├── appsscript.json      ← GASマニフェスト
├── CLAUDE.md            ← Claude Code 専用 AI 開発指示書
├── AGENTS.md            ← OpenAI Codex 専用 AI 開発指示書
├── CHANGELOG.md         ← バージョン変更履歴
├── SECURITY.md          ← セキュリティ情報・脆弱性報告
├── .clasp.json          ← clasp設定（.gitignore対象）
├── .claspignore         ← clasp除外設定
├── .gitignore
└── docs/
    ├── SDD.md           ← 設計書 v1.11.3
    ├── HANDOVER.md      ← 本ドキュメント v1.11.3
    ├── ADR.md           ← アーキテクチャ判断記録
    ├── RUNBOOK.md       ← 運用手順書（デプロイ・障害対応）
    ├── RD.md            ← 要件定義
    └── Manual.md        ← 操作マニュアル v1.11.3
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
| 会議URL | Google Meet（Calendar API経由）/ Zoom API |
| デプロイ | clasp（`clasp push --force` 必須） |

### ⚠️ 絶対厳守

- **React 18.2.0 固定**: React 19系混在で `Minified React error #31` クラッシュ
- **clasp push --force**: `--force` なしだとサイレントにスキップされる場合がある
- **clasp pull 前に git commit**: ローカルファイルが上書きされる
- **案件リストシートへの書き込み禁止**: IMPORTRANGE 数式を破壊する

---

## 4. データモデル

### シート構成

| シート名 | 用途 |
|----------|------|
| 設定 | Key-Value形式の全設定値（A=キー, B=項目名, C=値, D=入力例, E=説明） |
| 案件リスト | Googleフォーム回答からIMPORTRANGEで取り込み（**書き込み禁止**） |
| 案件補正 | 管理者による案件情報手動補正（案件リストのIMPORTRANGE保護のため分離） |
| 案件手動追加 | 管理者がアプリから手動追加した案件 |
| サポート記録 | 各案件の対応記録（ステータス・担当者・日時・対応内容等、**19列**） |
| タダメンマスタ | スタッフ一覧（認証・権限管理） |
| メール履歴 | 送信メールの履歴 |
| 監査ログ | 管理者操作の監査ログ |
| メール下書き | 送信前メール下書き（v1.11.0追加、11列） |
| 予約送信キュー | 予約送信待機メール（v1.11.0追加、16列） |

### IDX定数（コード.js 約30行目）

```javascript
var IDX = {
  CASES:   { PK: 0, EMAIL: 1, OFFICE: 2, NAME: 3, DETAILS: 4, PREFECTURE: 5, SERVICE: 6 },
  RECORDS: { FK: 0, STATUS: 1, STAFF_EMAIL: 2, STAFF_NAME: 3, DATE: 4, COUNT: 5,
             METHOD: 6, BUSINESS: 7, CONTENT: 8, REMARKS: 9, HISTORY: 10,
             EVENT_ID: 11, MEET_URL: 12, THREAD_ID: 13, ATTACHMENTS: 14,
             CASE_LIMIT_OVERRIDE: 15, ANNUAL_LIMIT_OVERRIDE: 16,
             TOOLS: 17, SUB_STAFF: 18 },  // 19列
  STAFF:   { NAME: 1, EMAIL: 2, ROLE: 3, IS_ACTIVE: 4 },
  DRAFT:   { DRAFT_ID: 0, CASE_ID: 1, STAFF_EMAIL: 2, MODE: 3, THREAD_ID: 4,
             SUBJECT: 5, BODY: 6, CC: 7, BCC: 8, TOOLS: 9, UPDATED_AT: 10 },  // 11列
  SCHEDULED: { QUEUE_ID: 0, CASE_ID: 1, STAFF_EMAIL: 2, STAFF_NAME: 3, MODE: 4,
               THREAD_ID: 5, SUBJECT: 6, BODY: 7, CC: 8, BCC: 9, TOOLS: 10,
               SEND_AT: 11, STATUS: 12, ERROR: 13, CREATED_AT: 14, SENT_AT: 15 }  // 16列
};
```

詳細: `docs/SDD.md` §1

### 上限値の優先順位

- **案件回数上限**: `caseLimitOverride` → `masters.limits.caseSupport` → `3`
- **年間利用上限**: `annualLimitOverride` → `masters.limits.annual` → `10`

### ステータス遷移

```
unhandled → inProgress → completed → (reopen で inProgress に戻る、最大N回)
unhandled → rejected（回数超過時）
inProgress → cancelled
completed  → cancelled
```

---

## 5. バックエンド関数一覧（コード.js）

### 公開関数（google.script.run 経由）

| 関数 | 説明 |
|------|------|
| `doGet()` | Web App エントリポイント。初期データをHTML埋め込みで返す |
| `getInitialData()` | 起動時データ取得（cases/masters/draftCaseIds/scheduledCaseIds/forcedCc） |
| `getAllCasesJoined()` | 全案件結合データ取得 |
| `assignCase(caseId, user, tools)` | 案件アサイン（メール送信なし） |
| `assignAndSendEmail(...)` | アサイン＋初回メール送信 |
| `updateSupportRecord(recordData)` | 記録更新＋カレンダー連携＋添付更新 |
| `reopenCase(caseId, user)` | 案件再開 |
| `rollbackCurrentRound(caseId)` | 2回目以降の対応回を取り消し |
| `cancelCase(caseId)` | 案件キャンセル |
| `declineCase(...)` | 回数超過メール → rejected |
| `sendNewCaseEmail(...)` | 新規スレッドメール送信 |
| `sendCaseEmail(...)` | スレッド返信 |
| `getThreadMessages(caseId)` | スレッドグループ取得 |
| `getMasters()` | マスタデータ取得 |
| `getStaffByEmail(email)` | スタッフ情報取得 |
| `getAdminPanelData()` | 管理パネル初期データ |
| `upsertStaffMember(payload)` | 既存スタッフの権限更新 |
| `deactivateStaffMember(email)` | スタッフ無効化 |
| `updateSettingsAdmin(patch)` | 設定更新（許可キーのみ） |
| `reassignCaseAdmin(caseId, staffEmail)` | 管理者による再アサイン |
| `setCaseStatusAdmin(caseId, status)` | 管理者による任意ステータス変更 |
| `updateCaseDataAdmin(caseId, payload)` | 管理者による案件データ直接編集 |
| `addManualCase(payload)` | 管理者による新規案件手動追加 |
| `updateSubStaff(caseId, subStaffArray)` | サブ担当の追加・変更 |
| `updateMeetUrl(caseId, newUrl)` | Meet/Zoom URL変更＋カレンダー同期 |
| `updateSupportHistory(caseId, roundIndex, patch)` | 過去対応記録の編集 |
| `deleteCaseAdmin(caseId)` | 管理者による案件削除（ソフトデリート） |
| `createGoogleMeetEvent(...)` | Google Meetイベント作成 |
| `createZoomMeeting(...)` | Zoomミーティング作成 |
| `verifyCcDryRun()` | CC設定のドライラン検証 |
| `saveDraft(payload)` | メール下書き保存（v1.11.0） |
| `loadDraft(caseId, mode, threadId)` | 下書き読み込み（v1.11.0） |
| `deleteDraft(caseId, mode, threadId)` | 下書き削除（v1.11.0） |
| `listDraftsForCase(caseId)` | 案件の下書き一覧（v1.11.0） |
| `scheduleEmail(payload)` | メール予約送信登録（v1.11.0） |
| `cancelScheduledEmail(queueId)` | 予約送信キャンセル（v1.11.0） |
| `listScheduledForCase(caseId)` | 案件の予約一覧（v1.11.0） |
| `processScheduledEmails_()` | 予約送信トリガハンドラ（5分間隔・内部） |
| `setupScheduledEmailTrigger()` | 予約送信トリガ登録（初回手動実行） |
| `removeScheduledEmailTrigger()` | 予約送信トリガ削除 |
| `getScheduledEmailTriggerStatus()` | 予約送信トリガの状態確認 |

全関数の詳細仕様: `docs/SDD.md` §3

---

## 6. 設定管理

管理者が設定画面から編集可能なキー（`updateSettingsAdmin` のホワイトリスト）:

| キー | 説明 |
|------|------|
| `MAIL_FORCE_CC` | 全メールの CC に追加するアドレス |
| `ANNUAL_USAGE_LIMIT` | 年間利用上限 |
| `CASE_USAGE_LIMIT` | 案件ごと対応回数上限 |
| `MAIL_INITIAL_SUBJECT` / `MAIL_INITIAL_BODY` | 初回メールテンプレート |
| `MAIL_INITIAL_INCLUDE_DETAILS` | 初回メールに相談内容を含むか |
| `MAIL_DECLINED_SUBJECT` / `MAIL_DECLINED_BODY` | 回数超過メールテンプレート |
| `MAIL_NEW_SUBJECT` / `MAIL_NEW_BODY` | 新規メールテンプレート |
| `MAIL_SCHEDULE_SUBJECT` / `MAIL_SCHEDULE_BODY` | 日程確定メールテンプレート |
| `SHARED_CALENDAR_ID` | 共有カレンダーID |
| `ATTACHMENT_FOLDER_ID` | 添付ファイル保存先DriveフォルダID |
| `ZOOM_ACCOUNT_ID` / `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET` | Zoom API認証情報 |
| `SUPPORT_TOOLS` | 対応ツール一覧 |
| `TOOL_MONTHLY_LIMITS` | ツール月間上限 |

---

## 7. 既知の課題・制約

| 項目 | 状態 | 備考 |
|------|------|------|
| `ADMIN_EMAILS` | 後方互換 | 優先判定は `スタッフ` シートの `ROLE=admin` |
| Gmail Advanced Service | 手動有効化必要 | GASエディタで設定済み |
| Calendar Advanced Service | 手動有効化必要 | Meet URL作成に必要 |
| `ATTACHMENT_FOLDER_ID` | 未設定時は添付保存不可 | 設定シートにDriveフォルダIDを設定 |
| ファビコン | GAS制限で本番反映不可 | SVGデータURIで「T」アイコン（v1.9.99確定） |
| 新着バッジ | localStorage依存 | ブラウザをまたいだ既読状態は同期されない |
| ドキュメント | 更新済み | SDD/HANDOVER/Manual を v1.11.3 に更新（2026/05/10） |
| 予約送信トリガ | 手動登録必要 | 本番初回デプロイ後に `setupScheduledEmailTrigger()` を1回実行 |
| 予約送信の送信者 | USER_ACCESSING のため実行者のメールで送信 | キューに `staffEmail`/`staffName` を保存して From 表示に反映 |

---

## 8. リファクタリングロードマップ（#5 関数複雑度削減）

以下の関数は循環複雑度（CC）が推奨値（10）を超えている。**単体テスト整備後に**段階的にリファクタリングすること。

| 関数 | 推定 CC | 推奨分割方針 |
|------|:-------:|------------|
| `getAllCasesJoined()` | ≈18 | `buildRecordMap_()` / `buildFiscalYearCounts_()` / `mergeCase_()` に分割 |
| `updateSupportRecord()` | ≈15 | カレンダー処理 / 添付処理 / バッチ書き込みの3ブロックに分割 |
| `processScheduledEmails_()` | ≈12 | `extractPendingTargets_()` / `markAsSending_()` の責務分離 |

**注意:** これらの関数は現在正常動作しており、`tests/unit/` の単体テストが充実してから着手すること。

---

## 9. 開発の進め方

### ローカル開発

```bash
npx serve -s . -l 3000
# 代替: python -m http.server 3000 --directory .
```

モックデータ（14パターン）で全機能の UI を確認できる。新ステータスやフィールドを追加する場合はモックデータも更新すること。

### デプロイ手順

詳細: `docs/RUNBOOK.md` §3

```bash
# 1. 変更をコミット
git add <files> && git commit -m "feat: vX.X.X - 説明"

# 2. GASにプッシュ
clasp push --force

# 3. デプロイ更新
clasp deploy -i AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ -d "vX.X.X"
```

### 設計変更時の更新対象

1. `コード.js` — バックエンドロジック
2. `index.html` — フロントエンドUI + モックデータ
3. `docs/SDD.md` — 設計書（データモデル・関数仕様・UI仕様）
4. `docs/HANDOVER.md` — 本ドキュメント（機能一覧）
5. `CLAUDE.md` / `AGENTS.md` — AI開発指示書（IDX定数等の重要変更時）
6. `CHANGELOG.md` — 変更履歴

### バージョン管理ルール

- `コード.js` 先頭コメント・`setTitle`・SDD・HANDOVER のバージョンは常に一致させること
- 現行: **v1.11.3**

---

## 9. バージョン履歴

| バージョン | リリース日 | 主な変更内容 |
|:---|:---|:---|
| v1.8.1 | 2026/02/19 | 初版リリース。案件一覧4タブ、担当アサイン、日程確定、完了報告、添付機能、管理者モード基盤 |
| v1.8.2 | 2026/02/20 | 利用制限設定化、`setCaseStatusAdmin`/`updateCaseDataAdmin` 追加、案件単位上限特例 |
| v1.8.3 | 2026/02/20 | 管理モード復元。通常/閲覧/管理 3ボタン式、権限管理・設定管理分離、検索条件拡張 |
| v1.9.0 | 2026/02/23 | 検索UI刷新（常時表示・チップ型フィルタ・期間プリセット）、管理インライン編集、新着バッジ |
| v1.9.11〜v1.9.16 | — | カード並び順修正、案件リスト重複PK除去、新規案件手動追加、都道府県47拡張、URL自動リンク化 |
| v1.9.17〜v1.9.28 | — | 処理中スピナー、管理モード日時編集、完了報告日時なし対応、日付タイムゾーン修正 |
| v1.9.29〜v1.9.35 | — | 対応ツール機能（選択・フィルター・管理モード編集・設定管理） |
| v1.9.36〜v1.9.41 | — | 設定シート修復、「全て」タブ追加、キャンセルステータス追加 |
| v1.9.42〜v1.9.48 | — | CC/BCC任意追加、ツール月間上限、ツール月間バッジ |
| v1.9.49〜v1.9.57 | — | タブ並び順調整、完了案件実施日ソート、管理者編集フォーム拡張、データ抽出 |
| v1.9.58〜v1.9.63 | — | サブ担当（OJT）機能、CC自動設定、Meet/Zoom URLコピーボタン |
| v1.9.64〜v1.9.69 | — | パフォーマンス全面最適化、案件削除、スピナー表示 |
| v1.9.70〜v1.9.77 | — | 完了タブ日付形式変更、サブ担当スピナー、過去記録編集、カレンダー連動強化 |
| v1.9.78〜v1.9.84 | — | 当月依頼件数バッジ、Meet URL変更時カレンダー同期、アプリ内ヘルプ |
| v1.9.85〜v1.9.91 | — | ツール月間上限を申込日ベースに変更、管理者編集フォーム拡張、新規メール件名テンプレート |
| v1.9.92〜v1.9.96 | — | 未入力フィールド強調、データ抽出改行バグ修正、ロールバック機能、キャンセル機能拡張 |
| v1.9.97〜v1.9.99 | — | モーダルタイトル文字化け修正、ファビコン変更→GAS制限で元に戻し |
| **v1.10.0** | — | 完了報告時にサービス種別・都道府県を入力可能に、全モーダルにスクロール対応 |
| **v1.10.1** | — | カレンダーイベント作成時にアプリURLを説明欄に追記 |
| **v1.10.2** | 2026/04/18 | Zoom会議作成とカレンダーイベント作成を分離、Zoom API失敗時もカレンダー作成 |
| **v1.10.3** | 2026/04/18 | Zoom選択時にタダスク利用確認の注意メッセージを追加 |
| **v1.11.0** | 2026/04/20 | メール下書き保存＋予約送信機能を追加。LockService で並行実行防止、sending 状態の復旧対応。**本番デプロイ後 `setupScheduledEmailTrigger()` を1回手動実行必要。** |
| **v1.11.1** | 2026/04/20 | 新規案件追加モーダルでスマホから送信できない不具合を修正 |
| **v1.11.2** | 2026/04/20 | 下書き保存・予約送信ボタンの押下フィードバックを追加、MAIL_FORCE_CC を state に追加 |
| **v1.11.3** | 2026/04/20 | メール作成画面に自動CC（MAIL_FORCE_CC）の説明を追加 |

---

## 10. 次フェーズ候補

| ID | 内容 | 優先度 |
|----|------|--------|
| 7-1 | CSV/スプレッドシートエクスポート機能 | 中 |
| 7-2 | 案件中止フラグ（`cancelled` ステータスは実装済み） | 低（実質完了） |
| 7-3 | 検索のスマート化（条件保存等） | 低 |
