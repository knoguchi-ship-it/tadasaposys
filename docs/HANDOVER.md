# 開発者向け引継ぎ資料 (HANDOVER.md)

**Project:** タダサポ管理システム
**Version:** 1.10.1（現行リリース）
**Date:** 2026/04/18
**Author:** Development Team

---

## 1. 現行システムの状態

### 本番稼働中
- **URL**: `https://script.google.com/a/macros/tadakayo.jp/s/AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ/exec`
- **デプロイ**: GAS `executeAs: USER_DEPLOYING`、`access: ANYONE`
- **認証**: タダメンマスタ（B列=氏名, C列=メールアドレス）で認証

### 実装済み機能
| 機能 | 状態 | 追加バージョン |
|------|------|--------------|
| 案件一覧（6タブ: 未対応/対応中/完了/キャンセル/対応不可/全て） | ✅ | v1.8.1〜v1.9.38 |
| 担当アサイン（メール付き / メールなし の2方式） | ✅ | v1.8.1 |
| 日程確定（カレンダー連携 + Meet/Zoom URL自動発行） | ✅ | v1.8.1 |
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
| 管理者メールCC自動追加 | ✅ | v1.9.72 |
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
| 案件削除（管理者専用） | ✅ | v1.9.68 |
| Meet/Zoom URL コピーボタン＋編集機能 | ✅ | v1.9.62〜v1.9.73 |
| カレンダー連動強化（Meet/Zoom URL変更時にカレンダー同期） | ✅ | v1.9.73〜v1.9.82 |
| カレンダーイベント作成時にアプリURLを説明欄に追記 | ✅ | v1.10.1 |
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
├── index.html          ← フロントエンド（React SPA、単一ファイル）
├── コード.js            ← バックエンド（GAS）
├── appsscript.json      ← GASマニフェスト
├── CLAUDE.md            ← AI開発指示書
├── .clasp.json          ← clasp設定（.gitignore対象）
├── .claspignore         ← clasp除外設定
├── .gitignore
└── docs/
    ├── SDD.md           ← 設計書 v1.9.0
    ├── HANDOVER.md      ← 本ドキュメント
    ├── ADR.md           ← アーキテクチャ判断記録
    ├── RD.md            ← 要件定義
    └── Manual.md        ← 操作マニュアル
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
- **clasp push --force**: `--force` なしだとサイレントにスキップされる
- **clasp pull 前に git commit**: ローカルファイルが上書きされる

---

## 4. データモデル

### シート構成
| シート名 | 用途 |
|----------|------|
| 設定 | Key-Value形式の全設定値（A=キー, B=項目名, C=値, D=入力例, E=説明） |
| 案件リスト | Googleフォーム回答からIMPORTRANGEで取り込み（**書き込み禁止**） |
| 案件補正 | 管理者による案件情報手動補正（案件リストのIMPORTRANGE保護のため分離） |
| 案件手動追加 | 管理者がアプリから手動追加した案件（案件リストとは別シートで整合性を保護） |
| サポート記録 | 各案件の対応記録（ステータス・担当者・日時・対応内容等） |
| タダメンマスタ | スタッフ一覧（認証・権限管理） |
| メール履歴 | 送信メールの履歴 |
| 監査ログ | 管理者操作の監査ログ |

### IDX定数（コード.js 約31行目）
```javascript
var IDX = {
  CASES:   { PK: 0, EMAIL: 1, OFFICE: 2, NAME: 3, DETAILS: 4, PREFECTURE: 5, SERVICE: 6 },
  CASES_OVERRIDE: { PK: 0, EMAIL: 1, OFFICE: 2, NAME: 3, DETAILS: 4, PREFECTURE: 5, SERVICE: 6 },
  RECORDS: { FK: 0, STATUS: 1, STAFF_EMAIL: 2, STAFF_NAME: 3, DATE: 4, COUNT: 5,
             METHOD: 6, BUSINESS: 7, CONTENT: 8, REMARKS: 9, HISTORY: 10,
             EVENT_ID: 11, MEET_URL: 12, THREAD_ID: 13, ATTACHMENTS: 14,
             CASE_LIMIT_OVERRIDE: 15, ANNUAL_LIMIT_OVERRIDE: 16,
             TOOLS: 17, SUB_STAFF: 18 },  // 19列
  STAFF:   { NAME: 1, EMAIL: 2, ROLE: 3, IS_ACTIVE: 4 },
  EMAIL:   { CASE_ID: 0, SEND_DATE: 1, SENDER_EMAIL: 2, SENDER_NAME: 3,
             RECIPIENT_EMAIL: 4, SUBJECT: 5, BODY: 6 }
};
```

### ⚠️ 案件リスト (IMPORTRANGE) への書き込み禁止
「案件リスト」シートは Google フォーム回答から `IMPORTRANGE` で取り込んでいる。
このシートに `setValue` 等で書き込むと **IMPORTRANGE 数式が破壊される**。
管理者による案件情報の修正は「**案件補正**」シートに書き込み、`getAllCasesJoined()` でマージして返す。

### 上限値の優先順位
- **案件回数上限**: `caseLimitOverride`（案件特例）→ `masters.limits.caseSupport`（全体設定）→ `3`（デフォルト）
- **年間利用上限**: `annualLimitOverride`（案件特例）→ `masters.limits.annual`（全体設定）→ `10`（デフォルト）

### ステータス遷移
```
unhandled → inProgress → completed → (reopenで inProgress に戻る、最大N回)
unhandled → rejected（回数超過時）
inProgress → cancelled（キャンセル、理由を記録）
completed → cancelled（完了後キャンセル）
```

---

## 5. バックエンド関数一覧（コード.js）

### 公開関数（google.script.run 経由で呼び出し）
| 関数 | 説明 |
|------|------|
| `doGet()` | Web App エントリポイント。初期データをHTML埋め込みで返す |
| `getInitialData()` | 起動時データ取得。各案件に `currentFiscalYearCount` を付与 |
| `getAllCasesJoined()` | 全案件結合データ取得（案件リスト＋手動追加＋補正＋記録＋メール履歴を結合） |
| `assignCase(caseId, user, tools)` | 案件アサイン（メール送信なし、tools対応） |
| `assignAndSendEmail(caseId, user, subject, body, cc, bcc, tools)` | アサイン＋初回メール送信（CC/BCC対応） |
| `updateSupportRecord(recordData)` | 記録更新＋カレンダー連携＋添付更新（最大5件） |
| `reopenCase(caseId, user)` | 案件再開（履歴保存→フィールドクリア） |
| `rollbackCurrentRound(caseId)` | 2回目以降の対応回を取り消して前回完了状態に戻す |
| `cancelCase(caseId)` | 案件キャンセル（ソフトデリート） |
| `declineCase(caseId, user, subject, body, cc, bcc)` | 回数超過メール→rejected（CC/BCC対応） |
| `sendNewCaseEmail(caseId, user, subject, body, cc, bcc)` | 新規スレッドメール送信 |
| `sendCaseEmail(caseId, user, subject, body, threadId, cc, bcc)` | スレッド返信 |
| `getThreadMessages(caseId)` | スレッドグループ取得 |
| `getMasters()` | マスタデータ取得（limits, supportTools, toolMonthlyLimits, emailTemplates 含む） |
| `getStaffByEmail(email)` | メールアドレスからスタッフ情報取得 |
| `getAdminPanelData()` | 管理パネル初期データ取得 |
| `upsertStaffMember(payload)` | 既存スタッフの権限更新（管理者） |
| `deactivateStaffMember(email)` | スタッフ無効化（管理者） |
| `updateSettingsAdmin(patch)` | 設定更新（管理者、許可キーのみ） |
| `reassignCaseAdmin(caseId, staffEmail)` | 管理者による再アサイン |
| `setCaseStatusAdmin(caseId, status)` | 管理者による任意ステータス直接変更 |
| `updateCaseDataAdmin(caseId, payload)` | 管理者による案件データ直接編集（sparse更新対応） |
| `addManualCase(payload)` | 管理者による新規案件手動追加 |
| `updateSubStaff(caseId, subStaffArray)` | サブ担当（OJT）の追加・変更 |
| `updateMeetUrl(caseId, newUrl)` | Meet/Zoom URL変更＋カレンダー同期 |
| `updateSupportHistory(caseId, roundIndex, patch)` | 過去対応記録の編集 |
| `deleteCaseAdmin(caseId)` | 管理者による案件削除（ソフトデリート） |
| `createGoogleMeetEvent(title, startTime, description, durationMinutes)` | Google Meetイベント作成 |
| `createZoomMeeting(title, startTime, durationMinutes)` | Zoomミーティング作成 |
| `verifyCcDryRun()` | CC設定のドライラン検証 |

### 内部ヘルパー関数（主要なもの）
| 関数 | 説明 |
|------|------|
| `getSpreadsheet_()` | SSキャッシュ付きスプレッドシート取得 |
| `loadSettings_()` / `getSetting_()` / `saveSetting_()` | 設定の読み書き |
| `getActor_()` / `requireAdmin_()` | 認証・権限チェック |
| `appendAuditLog_()` | 監査ログ記録 |
| `getFiscalYear(dateObj)` | 年度計算（4月始まり） |
| `ensureCasesOverrideSheet_()` / `getCasesOverrideMap_()` | 案件補正シート操作 |
| `ensureCasesManualSheet_()` | 手動追加案件シート操作 |
| `ensureAttachmentSchema_()` | 添付機能スキーマ確認 |
| `recordEmail_()` | メール履歴記録 |
| `storeThreadId_()` / `getThreadIdsForCase_()` | スレッドID管理 |
| `getApiCalendarId_()` | カレンダーID取得 |
| `updateCalendarEventDateTime_()` / `updateCalendarEventDescription_()` | カレンダーイベント更新 |
| `getAttachmentFolder_()` / `saveNewAttachments_()` / `trashRemovedAttachments_()` | 添付ファイル管理 |

### セットアップ関数（初期構築時のみ使用）
| 関数 | 説明 |
|------|------|
| `setupSettingsSheet()` | 設定シート初期作成 |
| `addEmailTemplates()` | メールテンプレート設定追加 |
| `addForcedCcSetting()` | 強制CC設定追加 |
| `addMailDryRunSetting()` | メールドライラン設定追加 |
| `addUsageLimitSettings()` | 利用制限設定追加 |
| `addAttachmentFolderSetting()` | 添付フォルダ設定追加 |
| `addAttachmentsColumnToRecords()` | 添付列追加 |
| `addCaseLimitOverrideColumnsToRecords()` | 上限特例列追加 |
| `addToolsColumnToRecords()` | 対応ツール列追加 |
| `addSubStaffColumnToRecords()` | サブ担当列追加 |
| `fixSettingsSheet()` | 設定シート修復 |

---

## 6. 設定管理

### 管理者が編集可能な設定キー
| キー | 説明 |
|------|------|
| `MAIL_FORCE_CC` | メール送信時の強制CCアドレス |
| `ANNUAL_USAGE_LIMIT` | 年間利用上限（デフォルト10） |
| `CASE_USAGE_LIMIT` | 案件ごと対応回数上限（デフォルト3） |
| `MAIL_INITIAL_SUBJECT` / `MAIL_INITIAL_BODY` | 初回メールテンプレート |
| `MAIL_INITIAL_INCLUDE_DETAILS` | 初回メールに相談内容を含むか |
| `MAIL_DECLINED_SUBJECT` / `MAIL_DECLINED_BODY` | 回数超過メールテンプレート |
| `MAIL_NEW_SUBJECT` / `MAIL_NEW_BODY` | 新規メールテンプレート |
| `MAIL_SCHEDULE_SUBJECT` / `MAIL_SCHEDULE_BODY` | 日程確定メールテンプレート |
| `SHARED_CALENDAR_ID` | 共有カレンダーID |
| `ATTACHMENT_FOLDER_ID` | 添付ファイル保存先DriveフォルダID |
| `ZOOM_ACCOUNT_ID` / `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET` | Zoom API認証情報 |
| `SUPPORT_TOOLS` | 対応ツール一覧（カンマ区切り） |
| `TOOL_MONTHLY_LIMITS` | ツール月間上限（`ツール名:上限数` カンマ区切り） |

---

## 7. 既知の課題・制約

| 項目 | 状態 | 備考 |
|------|------|------|
| ADMIN_EMAILS | 後方互換 | 優先判定は `スタッフ` シートの `ROLE=admin` |
| Gmail Advanced Service | 手動有効化必要 | GASエディタで設定済み |
| Calendar Advanced Service | 手動有効化必要 | Meet URL作成に必要 |
| `Session.getActiveUser()` | ドメイン外で空文字リスク | `executeAs: USER_DEPLOYING` + `access: ANYONE` の制約 |
| `ATTACHMENT_FOLDER_ID` | 未設定時は添付保存不可 | 設定シートにDriveフォルダIDを設定 |
| ファビコン | GAS制限で本番反映不可 | SVGデータURIで「T」アイコンを設定（v1.9.99で元に戻し） |
| 新着バッジ | localStorage依存 | ブラウザをまたいだ既読状態は同期されない |
| ドキュメント | v1.9.0時点 | SDD.md / Manual.md は v1.9.0 から未更新 |

---

## 8. 開発の進め方

### ローカル開発
```bash
npx serve -s . -l 3000
```
モックデータで全機能のUIを確認できる。新ステータスやフィールドを追加する場合はモックデータも更新すること。

`npx serve` が起動できない環境では以下で代替可能:
```bash
python -m http.server 3000 --directory .
```

### デプロイ手順
```bash
# 1. 変更をコミット（clasp pull 対策）
git add <files> && git commit -m "description"

# 2. GASにプッシュ
clasp push --force

# 3. デプロイ更新
clasp deploy -i AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ -d "vX.X.X"
```

### 設計変更時の更新対象
1. `コード.js` — バックエンドロジック
2. `index.html` — フロントエンドUI + モックデータ
3. `docs/SDD.md` — 設計書（データモデル・関数仕様・UI仕様）
4. `docs/HANDOVER.md` — 本ドキュメント（機能一覧・ロードマップ）
5. `CLAUDE.md` — AI開発指示書（データモデル等の重要な変更時）

### バージョン管理ルール
- `コード.js` 先頭コメント・`setTitle`・SDD・HANDOVER のバージョンは常に一致させること
- 現行: **v1.10.1**（全ファイルで統一すべき）

---

## 9. バージョン履歴

| バージョン | リリース日 | 主な変更内容 |
|:---|:---|:---|
| v1.8.1 | 2026/02/19 | 初版リリース。案件一覧4タブ、担当アサイン、日程確定、完了報告、添付機能、管理者モード基盤 |
| v1.8.2 | 2026/02/20 | 利用制限設定化、`setCaseStatusAdmin`/`updateCaseDataAdmin` 追加、案件単位上限特例 |
| v1.8.3 | 2026/02/20 | 管理モード復元。通常/閲覧/管理 3ボタン式、権限管理・設定管理分離、検索条件拡張 |
| v1.9.0 | 2026/02/23 | 検索UI刷新（常時表示・チップ型フィルタ・期間プリセット）、管理インライン編集、新着バッジ |
| v1.9.11〜v1.9.16 | — | カード並び順修正、案件リスト重複PK除去、新規案件手動追加、都道府県47拡張、URL自動リンク化、担当者サジェスト |
| v1.9.17〜v1.9.24 | — | 処理中スピナー、管理モード日時編集、完了報告日時なし対応、管理モード担当者「未割当」戻し |
| v1.9.25〜v1.9.28 | — | 日付表示タイムゾーン修正（JST固定） |
| v1.9.29〜v1.9.35 | — | 対応ツール機能（選択・フィルター・管理モード編集・設定管理・配色変更） |
| v1.9.36〜v1.9.41 | — | 設定シート修復、「全て」タブ追加、キャンセルステータス追加、手動追加初回メール修正、「メール等」追加 |
| v1.9.42〜v1.9.48 | — | CC/BCC任意追加、ツール月間上限、ツール月間バッジ、管理画面日付入力、完了カード実施日表示 |
| v1.9.49〜v1.9.57 | — | タブ並び順調整、手動追加案件修正、完了案件実施日ソート、管理者編集フォーム拡張、備考表示、データ抽出 |
| v1.9.58〜v1.9.63 | — | サブ担当（OJT）機能（最大1名、サジェスト付き）、CC自動設定、Meet/Zoom URLコピーボタン |
| v1.9.64〜v1.9.69 | — | パフォーマンス全面最適化（楽観的更新、初期データ埋め込み、キャッシュ化）、案件削除、スピナー表示 |
| v1.9.70〜v1.9.77 | — | 完了タブ日付形式変更、サブ担当スピナー、過去記録編集、カレンダー連動強化、ツール月間上限バグ修正 |
| v1.9.78〜v1.9.84 | — | 当月依頼件数バッジ、月間カウント修正、Meet URL変更時カレンダー同期、アプリ内ヘルプ、タブ配色統一 |
| v1.9.85〜v1.9.91 | — | ツール月間上限を申込日ベースに変更、管理者編集フォーム拡張（担当者サジェスト・対応時間）、新規メール件名テンプレート |
| v1.9.92〜v1.9.96 | — | 未入力フィールド強調、データ抽出改行バグ修正、ロールバック機能、キャンセル機能拡張（理由モーダル） |
| v1.9.97 | — | モーダルタイトル文字化け修正 |
| v1.9.98〜v1.9.99 | — | ファビコン変更→GAS制限で元に戻し |
| **v1.10.0** | — | 完了報告時にサービス種別・都道府県を入力可能に、全モーダルにスクロール対応 |
| **v1.10.1** | — | カレンダーイベント作成時にアプリURLを説明欄に追記 |
