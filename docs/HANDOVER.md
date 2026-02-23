# 開発者向け引継ぎ資料 (HANDOVER.md)

**Project:** タダサポ管理システム
**Version:** 1.9.0（現行リリース）
**Date:** 2026/02/23
**Author:** Development Team

---

## 1. 現行システムの状態

### 本番稼働中
- **URL**: `https://script.google.com/a/macros/tadakayo.jp/s/AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ/exec`
- **デプロイ**: GAS Version 14、`executeAs: USER_DEPLOYING`、`access: ANYONE`
- **認証**: タダメンマスタ（B列=氏名, C列=メールアドレス）で認証

### 実装済み機能
| 機能 | 状態 |
|------|------|
| 案件一覧（4タブ: 未対応/対応中/完了/対応不可） | ✅ |
| 担当アサイン（メール付き / メールなし の2方式） | ✅ |
| 日程確定（カレンダー連携 + Meet/Zoom URL自動発行） | ✅ |
| 完了報告・記録修正 | ✅ |
| 案件再開（最大N回、履歴JSON保存） | ✅ |
| 年間利用制限（設定値/年度、デフォルト10回） | ✅ |
| 案件ごと対応回数制限（設定値、デフォルト3回） | ✅ |
| 案件・年度ごとの上限特例設定（管理者） | ✅ |
| 回数超過メール送信 → 対応不可 | ✅ |
| メール機能（初回/新規/返信/回数超過 の4モード） | ✅ |
| 表示モード切替（通常/閲覧/管理 の3ボタン式） | ✅ |
| 検索UI（常時表示キーワード・チップ型フィルタ・期間プリセット・並び順） | ✅ |
| 完了報告/記録修正でのファイル添付（D&D対応、1回最大5件） | ✅ |
| 管理者機能（スタッフ管理/設定編集/再アサイン/監査ログ） | ✅ |
| 管理モード インライン編集（ステータス・担当者・上限をクリック変更） | ✅ |
| 新着バッジ（タブごとの未読件数、管理モードでON/OFF可能） | ✅ |

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
    ├── SDD.md           ← 設計書 v1.9.0（データモデル・関数仕様・UI仕様）
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
| カレンダー | Google Calendar API |
| デプロイ | clasp（`clasp push --force` 必須） |

### ⚠️ 絶対厳守
- **React 18.2.0 固定**: React 19系混在で `Minified React error #31` クラッシュ
- **clasp push --force**: `--force` なしだとサイレントにスキップされる
- **clasp pull 前に git commit**: ローカルファイルが上書きされる

---

## 4. データモデル

### IDX定数（コード.js 約30行目）
```javascript
var IDX = {
  CASES:   { PK: 0, EMAIL: 1, OFFICE: 2, NAME: 3, DETAILS: 4, PREFECTURE: 5, SERVICE: 6 },
  RECORDS: { FK: 0, STATUS: 1, STAFF_EMAIL: 2, STAFF_NAME: 3, DATE: 4, COUNT: 5,
             METHOD: 6, BUSINESS: 7, CONTENT: 8, REMARKS: 9, HISTORY: 10,
             EVENT_ID: 11, MEET_URL: 12, THREAD_ID: 13, ATTACHMENTS: 14,
             CASE_LIMIT_OVERRIDE: 15, ANNUAL_LIMIT_OVERRIDE: 16 },  // 17列
  STAFF:   { NAME: 1, EMAIL: 2, ROLE: 3, IS_ACTIVE: 4 },
  EMAIL:   { CASE_ID: 0, SEND_DATE: 1, SENDER_EMAIL: 2, SENDER_NAME: 3,
             RECIPIENT_EMAIL: 4, SUBJECT: 5, BODY: 6 }
};
```

### 上限値の優先順位
- **案件回数上限**: `caseLimitOverride`（案件特例）→ `masters.limits.caseSupport`（全体設定）→ `3`（デフォルト）
- **年間利用上限**: `annualLimitOverride`（案件特例）→ `masters.limits.annual`（全体設定）→ `10`（デフォルト）

### ステータス遷移
```
unhandled → inProgress → completed → (reopenで inProgress に戻る、最大N回)
unhandled → rejected（回数超過時）
```

---

## 5. バックエンド関数一覧（コード.js）

| 関数 | 説明 |
|------|------|
| `getInitialData()` | 起動時データ取得。各案件に `currentFiscalYearCount` を付与 |
| `getAllCasesJoined()` | 全案件結合データ取得（`caseLimitOverride`/`annualLimitOverride` 含む） |
| `assignCase(caseId, user)` | 案件アサイン（メール送信なし） |
| `assignAndSendEmail(caseId, user, subject, body)` | アサイン＋初回メール送信 |
| `updateSupportRecord(recordData)` | 記録更新＋カレンダー連携＋添付更新（最大5件） |
| `reopenCase(caseId, user)` | 案件再開（履歴保存→フィールドクリア） |
| `declineCase(caseId, user, subject, body)` | 回数超過メール→rejected |
| `sendNewCaseEmail(caseId, user, subject, body)` | 新規スレッドメール送信 |
| `sendCaseEmail(caseId, user, subject, body, threadId)` | スレッド返信 |
| `getThreadMessages(caseId)` | スレッドグループ取得 |
| `getMasters()` | マスタデータ取得（`limits: { annual, caseSupport }` 含む） |
| `getAdminPanelData()` | 管理パネル初期データ取得 |
| `upsertStaffMember(payload)` | 既存スタッフの権限更新（管理者、新規追加不可） |
| `deactivateStaffMember(email)` | スタッフ無効化（管理者） |
| `updateSettingsAdmin(patch)` | 設定更新（管理者、許可キーのみ） |
| `reassignCaseAdmin(caseId, staffEmail)` | 管理者による再アサイン |
| `setCaseStatusAdmin(caseId, status)` | 管理者による任意ステータス直接変更 |
| `updateCaseDataAdmin(caseId, payload)` | 管理者による案件データ直接編集（sparse更新対応） |

---

## 6. 既知の課題・制約

| 項目 | 状態 | 備考 |
|------|------|------|
| ADMIN_EMAILS | 後方互換 | 優先判定は `スタッフ` シートの `ROLE=admin` |
| Gmail Advanced Service | 手動有効化必要 | GASエディタで設定済み |
| `Session.getActiveUser()` | ドメイン外で空文字リスク | `executeAs: USER_DEPLOYING` + `access: ANYONE` の制約 |
| `ATTACHMENT_FOLDER_ID` | 未設定時は添付保存不可 | 設定シートにDriveフォルダIDを設定 |
| 全機能テスト | 未実施 | 基本起動・認証のみ確認済み |
| 新着バッジ | localStorage依存 | ブラウザをまたいだ既読状態は同期されない |

---

## 7. 次フェーズ開発ロードマップ

### 7-1. スプレッドシートへエクスポート機能

**目的**: 案件データをCSV/スプレッドシート形式でエクスポートし、外部報告や集計に活用する。

**想定スコープ**:
- 現在表示中の案件一覧をCSVダウンロード
- フィルタ条件（ステータス・期間・担当者）を反映したエクスポート
- 年度別の実績レポート出力

**実装上のポイント**:
- GAS側: `exportCases(filters)` 関数を新設、CSV文字列を返却
- フロントエンド側: Blob + ダウンロードリンクで実装（GAS環境では `google.script.run` 経由）
- ローカルモック: モックデータをCSV化して返す

### 7-2. 案件中止フラグ（キャンセル処理）

**目的**: 依頼者都合やその他の理由で中止になった案件を、「対応不可（rejected）」とは区別して管理する。

**想定スコープ**:
- 新ステータス `cancelled` の追加（または既存ステータスにフラグ追加）
- 中止理由の記録フィールド
- UIに「中止」タブまたは「対応不可」タブ内でのサブ分類
- 中止案件は年間利用回数にカウントしない

**実装上のポイント**:
- `S-02` の STATUS 値域に `cancelled` を追加するか、REMARKS列に中止理由を記録するか設計判断が必要
- `cancelled` を追加する場合: `getAllCasesJoined()` のステータスマッピング、フロントのタブフィルタ、年間回数計算ロジック（`getFiscalYear` 周辺）の全てに影響
- 年間回数計算から除外する場合: `getInitialData()` 内の `currentFiscalYearCount` 計算ロジックを修正

---

## 8. 開発の進め方

### ローカル開発
```bash
npx serve -s . -l 3000
```
モックデータ（14件）で全機能のUIを確認できる。新ステータスやフィールドを追加する場合はモックデータも更新すること。

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
- 現行: **v1.9.0**（全ファイルで統一済み）

---

## 9. バージョン履歴

| バージョン | リリース日 | GAS Version | 主な変更内容 |
|:---|:---|:---|:---|
| v1.8.1 | 2026/02/19 | 7 | 初版リリース。案件一覧4タブ、担当アサイン、日程確定、完了報告、添付機能、管理者モード基盤 |
| v1.8.2 | 2026/02/20 | 8〜 | `ANNUAL_USAGE_LIMIT`/`CASE_USAGE_LIMIT` 設定化、`setCaseStatusAdmin`/`updateCaseDataAdmin` 追加、案件単位上限特例追加 |
| v1.8.3 | 2026/02/20 | 〜13 | 管理モード復元。通常/閲覧/管理 3ボタン式、権限管理・設定管理ダイアログ分離、検索条件拡張 |
| **v1.9.0** | **2026/02/23** | **14** | 検索UI刷新（常時表示・チップ型フィルタ・期間プリセット）、管理インライン編集（ステータス・担当者・上限クリック変更）、新着バッジ（タブ別ID差分方式、管理ON/OFF対応） |
