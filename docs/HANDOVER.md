# 開発者向け引継ぎ資料 (HANDOVER.md)

**Project:** タダサポ管理システム
**Version:** 1.8.0
**Date:** 2026/02/16
**Author:** Development Team

---

## 1. プロジェクト概要

介護事業所向けの無料ITサポート管理システム。Google Apps Script (GAS) 上で動作するReact SPAで、Googleスプレッドシートをデータストアとして使用する。

---

## 2. ファイル構成

```
tadasaposys/
├── index.html          ← フロントエンド（React SPA、Babel in-browser）
├── コード.js            ← バックエンド（GAS サーバーサイド）
├── appsscript.json      ← GAS マニフェスト（Gmail Advanced Service有効）
├── .clasp.json          ← clasp 設定
├── .claspignore         ← clasp 除外設定
├── docs/
│   ├── SDD.md           ← システム詳細設計書 v1.7
│   ├── HANDOVER.md      ← 本ドキュメント
│   ├── ADR.md           ← アーキテクチャ判断記録
│   ├── SOW.md           ← 作業範囲定義
│   ├── RD.md            ← 要件定義
│   └── Manual.md        ← 操作マニュアル
```

**重要**: `src/` フォルダ構成は廃止済み。現在はルート直下の `index.html` + `コード.js` の2ファイル構成。

---

## 3. 技術スタック

| 項目 | 技術 | 備考 |
|------|------|------|
| フロントエンド | React 18.2.0 + Babel standalone | CDN経由、importmap使用 |
| アイコン | lucide-react 0.330.0 | `?deps=react@18.2.0` 必須 |
| CSS | Tailwind CSS (CDN) | `cdn.tailwindcss.com` |
| バックエンド | Google Apps Script (V8) | `コード.js` |
| データストア | Google スプレッドシート | 単一ソース |
| メール | Gmail Advanced Service (API v1) | スレッド対応 |
| カレンダー | Google Calendar API | Meet URL 自動発行 |
| ビデオ会議 | Google Meet / Zoom（条件付き） | 設定シートで制御 |
| デプロイ | clasp | `clasp push && clasp deploy` |

### ⚠️ React バージョン固定（絶対厳守）
```json
"imports": {
  "react": "https://esm.sh/react@18.2.0",
  "react-dom/client": "https://esm.sh/react-dom@18.2.0/client?deps=react@18.2.0",
  "lucide-react": "https://esm.sh/lucide-react@0.330.0?deps=react@18.2.0"
}
```
React 19 を混在させると `Minified React error #31` でクラッシュする。

---

## 4. ローカル開発

```bash
# 静的サーバー起動（npx serve 等）
npx serve -s . -l 3000
# → http://localhost:3000 でプレビュー
```

`typeof google === 'undefined'` でローカル判定し、モックデータで動作する。

---

## 5. データモデル（スプレッドシート列マッピング）

### IDX定数（コード.js 30行目付近）
```javascript
var IDX = {
  CASES: { PK: 0, EMAIL: 1, OFFICE: 2, NAME: 3, DETAILS: 4, PREFECTURE: 6, SERVICE: 8 },
  RECORDS: { FK: 0, STATUS: 1, STAFF_EMAIL: 2, STAFF_NAME: 3, DATE: 4, COUNT: 5,
             METHOD: 6, BUSINESS: 7, CONTENT: 8, REMARKS: 9, HISTORY: 10,
             EVENT_ID: 13, MEET_URL: 14, THREAD_ID: 15 },
  STAFF: { NAME: 5, EMAIL: 6 },
  EMAIL: { CASE_ID: 0, SEND_DATE: 1, SENDER_EMAIL: 2, SENDER_NAME: 3,
           RECIPIENT_EMAIL: 4, SUBJECT: 5, BODY: 6 }
};
```

### 主要列の説明
| 列 | シート | 用途 |
|----|--------|------|
| RECORDS.COUNT (F列) | サポート記録 | 案件ごとの対応回数 (1〜3) |
| RECORDS.HISTORY (K列) | サポート記録 | 過去回の記録JSON配列 |
| RECORDS.THREAD_ID (P列) | サポート記録 | GmailスレッドID（カンマ区切りで複数） |

### HISTORY列のJSON形式
```json
[
  {
    "round": 1,
    "scheduledDateTime": "2025-10-05T13:00:00",
    "method": "GoogleMeet",
    "content": "実施内容...",
    "remarks": null,
    "meetUrl": "https://meet.google.com/...",
    "staffName": "テスト太郎",
    "staffEmail": "test@tadakayo.jp"
  }
]
```

---

## 6. 実装済み機能一覧 (v1.8)

### コア機能
| 機能 | 概要 |
|------|------|
| 認証 | タダメンマスタのメールアドレスで認証 |
| 案件一覧 | ステータスタブ (未対応/対応中/完了/対応不可) |
| ダッシュボード | 全件閲覧モード（操作不可） |
| 担当アサイン | 未対応→対応中 + 初回メール送信 |
| 日程確定 | カレンダー連携 + Meet/Zoom URL自動発行 |
| 完了報告 | 実施記録入力 + ステータス変更 |
| 記録修正 | 完了案件の記録・ステータス編集 |

### メール機能（Gmail API）
| 機能 | モード | 説明 |
|------|--------|------|
| 初回メール | `initial` | アサインと同時にテンプレートメール送信 |
| 新規メール | `new` | 新しいスレッドを作成して送信 |
| スレッド返信 | `reply` | 既存スレッド内で返信 |
| 回数超過通知 | `decline` | 設定シートのテンプレートで送信→対応不可 |

- スレッドは案件ごとに複数保持可能（カンマ区切り）
- UI上でスレッド単位で折りたたみ表示、最新メッセージ順

### 案件回数管理
| ルール | 実装 |
|--------|------|
| 案件ごと最大3回 | `supportCount` で管理。完了後に再開ボタンで2回目/3回目開始 |
| 年間最大10回 | 同一メールアドレス＋年度で `supportCount` を合算 |
| 再開時の履歴保存 | `reopenCase` で現在の回の記録を `HISTORY` 列にJSON追記 |
| 過去記録の閲覧 | 詳細画面で `<details>` 展開式で各回の記録を表示 |

### 年間制限 (10回) の振る舞い
| ステータス | 年間 >= 10 の場合 |
|------------|-------------------|
| 未対応 | 「担当する」非表示 →「回数超過」ボタン表示 |
| 対応中 | そのまま対応可能（既に受けている） |
| 完了 | 再開ボタン非表示（2回目/3回目不可） |

### 検索機能
- キーワード検索: 事業所名、担当者名、メール、内容、種別、都道府県を横断検索
- 期間検索: 開始日〜終了日でタイムスタンプフィルタ
- WCAG 2.1 AA準拠のアクセシビリティ対応

### Zoom条件付き表示
- 設定シートの `ZOOM_ACCOUNT_ID` が存在する場合のみ方法選択肢に「Zoom」を追加
- 未設定時は「GoogleMeet / 電話等 / 対面」の3択

---

## 7. 設定シート（S-00）テンプレート

| キー | 用途 |
|------|------|
| `ADMIN_EMAILS` | 管理者メール（カンマ区切り） |
| `ZOOM_ACCOUNT_ID` | Zoom OAuth ID（空欄=Zoom無効） |
| `ZOOM_CLIENT_ID` | Zoom Client ID |
| `ZOOM_CLIENT_SECRET` | Zoom Client Secret |
| `SHARED_CALENDAR_ID` | 共有カレンダーID |
| `MAIL_DECLINED_SUBJECT` | 回数超過メール件名テンプレート |
| `MAIL_DECLINED_BODY` | 回数超過メール本文テンプレート |

テンプレートタグ: `{{名前}}`, `{{事業所名}}`, `{{担当者名}}`, `{{相談内容}}`

---

## 8. バックエンド主要関数（コード.js）

| 関数 | 説明 |
|------|------|
| `getInitialData()` | 起動時データ取得（user/cases/masters） |
| `getAllCasesJoined()` | 全案件結合データ取得 |
| `assignCase(caseId, user)` | 案件アサイン |
| `assignAndSendEmail(caseId, user, subject, body)` | アサイン＋初回メール |
| `updateSupportRecord(recordData)` | 記録更新＋カレンダー連携 |
| `reopenCase(caseId, user)` | 案件再開（履歴保存→フィールドクリア） |
| `declineCase(caseId, user, subject, body)` | 回数超過メール送信→rejected |
| `sendNewCaseEmail(caseId, user, subject, body)` | 新規スレッドメール送信 |
| `sendCaseEmail(caseId, user, subject, body, threadId)` | スレッド返信メール |
| `getThreadMessages(caseId)` | スレッドグループ取得 |
| `getMasters()` | マスタデータ（方法/種別/スタッフ/テンプレート） |

---

## 9. フロントエンド構造（index.html）

### コンポーネント構成
```
App
├── Toast（通知）
├── ConfirmDialog（確認ダイアログ）
├── Header（モード切替、ユーザー情報）
├── Sidebar
│   ├── StatusTabs（ステータスタブ）
│   ├── SearchPanel（検索パネル）
│   └── CaseList（案件リスト）
├── MainContent
│   ├── CaseHeader（ステータス/担当者/回数カウンター）
│   ├── RequesterInfo（事業所名/相談者名）
│   ├── InfoGrid（種別/メール/都道府県）
│   ├── LimitWarning（年間制限警告）
│   ├── CaseDetails（相談内容）
│   ├── CurrentRecord（現在の実施情報）
│   ├── SupportHistory（過去の対応記録）
│   └── ThreadGroups（メールスレッド一覧）
├── ActionBar（ステータス別アクションボタン）
├── EmailModal（メール作成/返信/回数超過通知）
└── EditModal（日程確定/完了報告/記録修正）
```

### 主要state変数
| 変数 | 型 | 用途 |
|------|-----|------|
| `activeTab` | string | 現在のステータスタブ |
| `selectedCaseId` | string | 選択中の案件ID |
| `isDashboardMode` | boolean | 全件閲覧モード |
| `searchOpen` | boolean | 検索パネル開閉 |
| `searchWord` | string | キーワード検索 |
| `searchDateFrom/To` | string | 期間検索 |
| `threadGroups` | array | メールスレッドグループ |
| `emailModal` | object | メールモーダル状態（mode: initial/new/reply/decline） |
| `modalMode` | string | 編集モーダル状態（schedule/report/edit） |

---

## 10. モックデータパターン（全14件）

| # | ステータス | 事業所 | 回数 | 年間 | 特徴 |
|---|-----------|--------|------|------|------|
| 1 | 未対応 | やまだ訪問介護 | 1/3 | 3 | 通常の新規案件 |
| 2 | 未対応 | すずきデイサービス | 1/3 | 1 | 初回利用 |
| 3 | 未対応 | リミット介護 | 1/3 | 10 | **年間上限 → 回数超過ボタン** |
| 4 | 対応中 | たなかヘルパー | 1/3 | 5 | 日程済み・メールスレッドあり |
| 5 | 対応中 | さとう福祉用具 | 2/3 | 8 | 1回目の履歴あり |
| 6 | 対応中 | もり小規模多機能 | 3/3 | 6 | 2回分の履歴・案件上限 |
| 7 | 完了 | やまだ訪問介護 | 2/3 | 3 | 再開可能・1回目履歴 |
| 8 | 完了 | いとう在宅ケア | 3/3 | 5 | 再開不可・2回分履歴 |
| 9 | 対応不可 | リミット介護 | — | 10 | 回数超過で拒否済み |
| 10-13 | 完了 | リミット介護 | 各種 | 10 | 年間10回分を構成する案件群 |
| 14 | 完了 | なかむらグループ | 1/3 | 2 | 再開可能 |

---

## 11. デプロイ手順

```bash
# 1. clasp でプッシュ
clasp push

# 2. GASエディタで確認
#    - 「サービス」に Gmail API v1 と Calendar API が追加されていること
#    - Gmail Advanced Service を有効化すること（エディタ左メニュー → サービス → Gmail API）

# 3. デプロイ
clasp deploy --description "v1.8.0"
```

### 初回セットアップ
1. GASエディタで `setupSettingsSheet` を実行 → 設定シート作成
2. 設定シートに `ADMIN_EMAILS` 等を記入
3. ウェブアプリとしてデプロイ

---

## 12. SDDとの差分（要更新箇所）

以下の項目は実装済みだがSDDに未反映:

| 項目 | 実装内容 | SDD反映 |
|------|----------|---------|
| HISTORY列 (K列, idx 10) | 過去回の記録をJSON保存 | ❌ S-02に追加必要 |
| `rejected` ステータス | 回数超過時の対応不可 | ❌ S-02のSTATUS値域に追加必要 |
| `declineCase` 関数 | 回数超過メール＋rejected設定 | ❌ F-05として追加必要 |
| 設定シート拡張 | `MAIL_DECLINED_*` テンプレート | ❌ S-00に追加必要 |
| 検索機能 | キーワード＋期間検索 | ❌ UI-03として追加必要 |
| F-04 再開条件 | `currentFiscalYearCount < 10` も必須 | ❌ 前提条件に追加必要 |

---

## 13. 既知の課題・今後の検討事項

- **SDD v1.8 更新**: 上記差分をSDDに反映する
- **Gmail API有効化**: 本番環境ではGASエディタで手動でGmail Advanced Serviceを有効にする必要がある
- **clasp push 未実施**: 今セッションのバックエンド変更はまだGASにプッシュされていない
- **テスト**: 本番環境での動作テストが未実施
