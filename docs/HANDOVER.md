# 開発者向け引継ぎ資料 (HANDOVER.md)

**Project:** タダサポ管理システム
**Version:** 1.8.1（現行リリース）
**Date:** 2026/02/20
**Author:** Development Team

---

## 1. 現行システムの状態

### 本番稼働中
- **URL**: `https://script.google.com/a/macros/tadakayo.jp/s/AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ/exec`
- **デプロイ**: GAS Version 7、`executeAs: USER_DEPLOYING`、`access: ANYONE`
- **認証**: タダメンマスタ（B列=氏名, C列=メールアドレス）で認証
- **案件数**: 28件（未対応）が稼働中

### 実装済み機能
| 機能 | 状態 |
|------|------|
| 案件一覧（4タブ: 未対応/対応中/完了/対応不可） | ✅ |
| 担当アサイン（メール付き / メールなし の2方式） | ✅ |
| 日程確定（カレンダー連携 + Meet/Zoom URL自動発行） | ✅ |
| 完了報告・記録修正 | ✅ |
| 案件再開（最大3回、履歴JSON保存） | ✅ |
| 年間利用制限（10回/年度） | ✅ |
| 回数超過メール送信 → 対応不可 | ✅ |
| メール機能（初回/新規/返信/回数超過 の4モード） | ✅ |
| ダッシュボード（全件閲覧・操作不可） | ✅ |
| キーワード検索 + 期間検索 | ✅ |
| 完了報告/記録修正でのファイル添付（D&D対応、1回最大5件） | ✅ |
| 管理者機能（スタッフ管理/設定編集/再アサイン/監査ログ） | ✅ |
| 管理者モード切替（ON時のみ管理UI表示） | ✅ |

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
    ├── SDD.md           ← 設計書 v1.8.1（データモデル・関数仕様・UI仕様）
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

### IDX定数（コード.js 28行目）
```javascript
var IDX = {
  CASES: { PK: 0, EMAIL: 1, OFFICE: 2, NAME: 3, DETAILS: 4, PREFECTURE: 5, SERVICE: 6 },
  RECORDS: { FK: 0, STATUS: 1, STAFF_EMAIL: 2, STAFF_NAME: 3, DATE: 4, COUNT: 5,
             METHOD: 6, BUSINESS: 7, CONTENT: 8, REMARKS: 9, HISTORY: 10,
             EVENT_ID: 11, MEET_URL: 12, THREAD_ID: 13, ATTACHMENTS: 14 },
  STAFF: { NAME: 1, EMAIL: 2, ROLE: 3, IS_ACTIVE: 4 },
  EMAIL: { CASE_ID: 0, SEND_DATE: 1, SENDER_EMAIL: 2, SENDER_NAME: 3,
           RECIPIENT_EMAIL: 4, SUBJECT: 5, BODY: 6 }
};
```

### ステータス遷移
```
unhandled → inProgress → completed → (reopenで inProgress に戻る、最大3回)
unhandled → rejected（回数超過時）
```

---

## 5. バックエンド関数一覧（コード.js）

| 関数 | 説明 |
|------|------|
| `getInitialData()` | 起動時データ取得。各案件に `currentFiscalYearCount` を付与 |
| `getAllCasesJoined()` | 全案件結合データ取得 |
| `assignCase(caseId, user)` | 案件アサイン（メール送信なし） |
| `assignAndSendEmail(caseId, user, subject, body)` | アサイン＋初回メール送信 |
| `updateSupportRecord(recordData)` | 記録更新＋カレンダー連携＋添付更新（最大5件） |
| `reopenCase(caseId, user)` | 案件再開（履歴保存→フィールドクリア） |
| `declineCase(caseId, user, subject, body)` | 回数超過メール→rejected |
| `sendNewCaseEmail(caseId, user, subject, body)` | 新規スレッドメール送信 |
| `sendCaseEmail(caseId, user, subject, body, threadId)` | スレッド返信 |
| `getThreadMessages(caseId)` | スレッドグループ取得 |
| `getMasters()` | マスタデータ取得 |
| `getAdminPanelData()` | 管理パネル初期データ取得 |
| `upsertStaffMember(payload)` | 既存スタッフの権限更新（管理者、新規追加不可） |
| `deactivateStaffMember(email)` | スタッフ無効化（管理者） |
| `updateSettingsAdmin(patch)` | 設定更新（管理者、許可キーのみ） |
| `reassignCaseAdmin(caseId, staffEmail)` | 管理者による再アサイン |

---

## 6. 既知の課題・制約

| 項目 | 状態 | 備考 |
|------|------|------|
| ADMIN_EMAILS | 後方互換 | 優先判定は `スタッフ` シートの `ROLE=admin` |
| Gmail Advanced Service | 手動有効化必要 | GASエディタで設定済み |
| `Session.getActiveUser()` | ドメイン外で空文字リスク | `executeAs: USER_DEPLOYING` + `access: ANYONE` の制約 |
| `ATTACHMENT_FOLDER_ID` | 未設定時は添付保存不可 | 設定シートにDriveフォルダIDを設定 |
| 全機能テスト | 未実施 | 基本起動・認証のみ確認済み |

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

### 7-3. 検索機能のスマート化

**目的**: 現在のキーワード＋期間検索をより実用的にする。

**想定スコープ**:
- 担当者フィルタ（ドロップダウン選択）
- ステータス横断検索（現在はタブ内のみ）
- 期間プリセット（今月/先月/今年度/前年度）
- 検索条件の保存・呼び出し
- 検索結果件数の表示

**実装上のポイント**:
- 現在の検索はフロントエンドのみで完結（`searchWord`, `searchDateFrom`, `searchDateTo` state変数）
- タブを横断する検索は `activeTab` フィルタの前に検索フィルタを適用する設計変更が必要
- 期間プリセットはフロントエンドのみで実装可能（`searchDateFrom/To` にプリセット値をセット）

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

### バージョン管理ルール
- コード（`コード.js` コメント・`setTitle`）、SDD、HANDOVER のバージョンは常に一致させること
- 現行: **v1.8.1**（全ファイルで統一済み）

## 追記: v1.8.2 引き継ぎメモ
- 新設定キー: `ANNUAL_USAGE_LIMIT`, `CASE_USAGE_LIMIT`（管理画面から編集可）。
- 追加API:
  - `setCaseStatusAdmin(caseId, status)`
  - `updateCaseDataAdmin(caseId, payload)`
- 管理者カードで実行可能になった操作:
  - 担当者変更（既存機能）
  - 任意ステータス変更（新規）
  - 案件データ直接編集（新規）
- 管理者カードのUI制御:
  - 担当者選択の初期値は現在担当者。
  - 担当者変更は担当者が変わった場合のみ実行可能。
  - 状態変更は状態が変わった場合のみ実行可能。
- 案件データ直接編集モーダルを3タブ構成へ変更:
  - 基本情報
  - 対応記録
  - 上限設定
  - 各入力項目に「何を編集する項目か」の説明文を追加。
- 検索の詳細フィルタを強化:
  - 全ユーザーで利用可: 表示範囲（現在タブ/全ステータス横断）、上限警告、都道府県、サービス種別、並び順
  - 管理者モードのみ: 担当者（全件/未割当/個別）
  - 閲覧モードでも全フィルタを反映
- 権限管理（管理者パネル）を大量メンバー前提に改善:
  - メンバー名/メールの検索入力を追加
  - ロール・有効状態でのフィルタを追加
  - 検索結果件数を表示し、候補一覧から選択して権限更新
- 管理者パネルを見やすく分離:
  - 権限管理は専用ダイアログへ分離
  - 設定管理も専用ダイアログへ分離
  - 設定管理はカテゴリ切替（上限/メール/連携/その他）でスクロール負荷を軽減
- 権限管理ステータスは 3 種類に統一:
  - 管理者
  - タダメン
  - 無効
- 設定管理のカテゴリは実データに応じて表示:
  - 「連携」「その他」は項目がなければ表示しない
  - メール設定は「初回」「回数超過」「共通（CC）」で分けて表示
- 再開制限・年度制限は `masters.limits` を参照して判定/表示。
- 案件単位の特例上限を追加: `caseLimitOverride` / `annualLimitOverride`（管理者の案件直接編集で設定）。
- 判定は「案件上書き値があれば優先、なければ全体設定」を使用。

## v1.9.0 引き継ぎ追記（検索UI刷新・管理インライン編集・新着バッジ）

### 検索機能
- キーワード検索を常時表示（サイドバー上部）
- アクティブフィルタをチップ（pill）形式で表示・個別削除
- 詳細フィルタ: 期間プリセット（今月/先月/今年度/前年度）、並び順トグル
- 日付計算のタイムゾーンバグ修正（`toISOString` → ローカル時間フォーマット `getDateRange()` ヘルパー）

### 管理モード インライン編集
- ステータスバッジをクリックして直接変更（`setCaseStatusAdmin`）
- 担当者バッジをクリックして変更（100名以上対応の名前/メール検索絞り込み付き）（`reassignCaseAdmin`）
- 案件回数・今年度利用数をクリックして上限を特例変更（`updateCaseDataAdmin` の sparse payload）
- 「特例」バッジで上書き中を可視化、空欄でリセット
- Escapeキーでポップオーバーを閉じる

### 新着バッジ
- タブごとの新着件数を `+N` バッジで表示
- 「最後にタブをクリックした時点のケースIDセット」をlocalStorageに保存し差分計算
- 通常モード: 自分担当ケースのみカウント（未対応は全員共有）
- 管理モード: 全件カウント、BellボタンでバッジOFF/ON（localStorage永続）
- 閲覧モード: バッジ非表示
- localStorage キー: `tadasapo_seenIds_{userEmail}`、`tadasapo_showNewBadge`

### デプロイ情報
- GAS Version: 14（`clasp deploy -i ... -d "v1.9.0"`）

## v1.8.3 引き継ぎ追記（管理モード復元）
- `index.html` の管理モード切替・管理者UIを再実装。
- 失われていた管理者向け検索条件を復元（都道府県/サービス種別/担当状況/担当者）。
- 権限管理と設定管理を専用ダイアログへ再分離。
- 権限ステータスは `管理者 / タダメン / 無効` の3種で運用。
- 自分自身の権限変更は禁止。
- 管理者の案件操作（担当者変更、状態直接変更、案件データ直接編集）を案件詳細最下部に再配置。
- 設定管理では `管理者メールアドレス` と `メールドライラン` を表示対象外とし、カテゴリタブで編集。
