# システム詳細設計書 (SDD) - タダサポ管理システム v1.7

**Version:** 1.7.0
**Date:** 2026/02/14
**Status:** Released

本ドキュメントは、システムが準拠すべき**仕様（Specification）**を定義する。実装およびテストは、本仕様を満たすことを目的とする。

---

## 1. データモデル仕様 (Data Specifications)

システムは単一のGoogleスプレッドシートを信頼できる唯一の情報源（Single Source of Truth）として扱う。

### S-00: 設定 (Settings)
*   **用途**: システム全体の運用設定値を管理するKey-Valueストア。コードへのハードコードを排除し、スプレッドシート上で設定を完結させる。
*   **制約**: A列の設定キーはシステムが参照する固定文字列であり、変更不可。B列の設定値のみ編集可能。

| 設定キー | 設定値（例） | 必須 | 説明 |
| :--- | :--- | :--- | :--- |
| `ADMIN_EMAILS` | `admin@tadakayo.jp` | YES | 管理者メールアドレス（カンマ区切りで複数可） |
| `ZOOM_ACCOUNT_ID` | `xxxxxxxx` | NO* | Zoom Server-to-Server OAuth アカウントID |
| `ZOOM_CLIENT_ID` | `xxxxxxxx` | NO* | Zoom Client ID |
| `ZOOM_CLIENT_SECRET` | `xxxxxxxx` | NO* | Zoom Client Secret |
| `SHARED_CALENDAR_ID` | `xxx@group.calendar.google.com` | NO | 共有カレンダーID（空欄=デフォルトカレンダー） |
| `SPREADSHEET_URL` | `https://docs.google.com/...` | NO | 参考表示用（自動設定） |

\* Zoom連携を利用する場合は必須。

**初回セットアップ**: GASエディタで `setupSettingsSheet` 関数を実行すると、テンプレート付きの「設定」シートが自動作成される。

---

### S-01: 案件リスト (Case List)
*   **用途**: 依頼の一次データ。
*   **制約**: `TIMESTAMP` は一意であり、システム全体の主キー（CaseID）として機能しなければならない。

| インデックス | 物理列 | 項目名 | 論理名 | データ型 | 必須 | 備考 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | A列 | タイムスタンプ | `TIMESTAMP` | Date | YES | **PK** (ISO8601) |
| 1 | B列 | メールアドレス | `EMAIL` | String | YES | |
| 2 | C列 | 介護事業所名 | `OFFICE_NAME` | String | YES | |
| 3 | D列 | お名前 | `REQUESTER_NAME` | String | YES | |
| 4 | E列 | 困りごと詳細 | `DETAILS` | String | YES | |
| 5 | F列 | 都道府県 | `PREFECTURE` | String | NO | 事業所の所在地域 |
| 6 | G列 | サービス種別 | `SERVICE_TYPE` | String | NO | |

### S-02: サポート記録 (Support Records)
*   **用途**: タダサポ側の対応ステータス管理。
*   **制約**: 案件リストのレコードと1対1または0対1で対応する。

| インデックス | 物理列 | 項目名 | 論理名 | 値域/型 | 備考 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | A列 | 案件ID | `CASE_ID` | String | **FK** (Case List.TIMESTAMP) |
| 1 | B列 | ステータス | `STATUS` | `unhandled` \| `inProgress` \| `completed` | |
| 2 | C列 | 担当者メール | `STAFF_EMAIL` | String | |
| 3 | D列 | 担当者名 | `STAFF_NAME` | String | |
| 4 | E列 | 日時 | `DATE` | Date | 実施予定日時 |
| 5 | F列 | 対応回数 | `SUPPORT_COUNT` | Number | 現在の対応回数（1〜3）。初回担当時に `1` を設定 |
| 6 | G列 | 方法 | `METHOD` | String | GoogleMeet / Zoom / 訪問 等 |
| 7 | H列 | 事業種別 | `BUSINESS_TYPE` | String | 案件リストのサービス種別を引き継ぐ |
| 8 | I列 | 実施内容 | `CONTENT` | String | |
| 9 | J列 | 備考 | `REMARKS` | String | |
| 10 | K列 | 履歴JSON | `HISTORY` | String | 過去回の記録JSON |
| 11 | L列 | EventID | `EVENT_ID` | String | カレンダー連携ID |
| 12 | M列 | Meet URL | `MEET_URL` | String | 自動発行URL |
| 13 | N列 | スレッドID | `THREAD_ID` | String | GmailスレッドID（カンマ区切りで複数） |

### S-03: タダメンマスタ (Staff Master)
*   **用途**: 認証および担当者候補リスト。

| インデックス | 物理列 | 項目名 | 論理名 | 型 | 備考 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | A列 | タダメンID | `STAFF_ID` | String | 一意識別子 |
| 1 | B列 | ニックネーム | `NICKNAME` | String | 画面表示名 |
| 2 | C列 | GWSアカウント | `EMAIL` | Email | **認証キー** |

---

## 2. インターフェース仕様 (Function Specifications)

### F-01: getInitialData()
*   **概要**: アプリ起動時に必要な全データを取得する。
*   **出力**: `user`, `cases`, `masters`
*   **拡張仕様**:
    *   各 `CaseData` に対し、**`currentFiscalYearCount` (今年度累計利用回数)** を計算して付与する。
    *   **計算ロジック**:
        *   対象案件と同じ `EMAIL` を持つ案件のうち、`status` が `completed` または `inProgress` であるものをカウントする。
        *   年度定義: 4月1日開始。対象案件のタイムスタンプが属する年度で集計する。

### F-02: addNewCase(caseData, userInfo)
*   **振る舞い**: 案件リストとサポート記録への同時書き込み。

### F-03: updateSupportRecord(recordData)
*   **振る舞い**: 記録更新、カレンダー連携、メール送信。

### F-04: reopenCase(caseId, user)
*   **概要**: 完了済み案件を再開し、次回の対応を開始する。
*   **前提条件**: `status === 'completed'` かつ `supportCount < 3`。
*   **振る舞い**:
    1.  `SUPPORT_COUNT` を `+1` する。
    2.  `STATUS` を `inProgress` に変更する。
    3.  `SCHEDULED_DATE`, `EVENT_ID`, `MEET_URL` をクリアする（次回日程を新たに設定するため）。
    4.  `CONTENT` をクリアする（次回の記録用にリセット）。
    5.  担当者（`STAFF_EMAIL`, `STAFF_NAME`）は維持する。
*   **エラー**: `supportCount >= 3` の場合は例外を送出し、再開を拒否する。

---

## 3. セキュリティ仕様 (Security Specifications)

### SEC-01: 認証 (Authentication)
*   実行ユーザーのメールアドレスが「タダメンマスタ」に存在しない場合、処理をブロックしエラーを返す。

### SEC-02: 管理者権限 (Authorization)
*   `CONFIG.ADMIN_EMAILS` に含まれるユーザーのみが、他者の担当案件に対する割り当て変更を許可される。

### SEC-03: アクセス制御と表示ロジック (Access Control)
*   **通常モード**: 自分の担当案件のみ表示。
*   **ダッシュボードモード**: 全案件を表示するが、操作（Write）は不可とする。

### SEC-04: 年間制限ガード (Annual Limit Guard)
*   **仕様**: `currentFiscalYearCount` が **10回** を超えている案件に対し、以下の制限を適用する。
    *   UI: バッジや警告アイコンで「制限超過」を明示する。
    *   Action: 「担当する」ボタン押下時に警告を表示し、原則として対応をブロックする。

### SEC-05: 案件回数制限 (Per-Case Limit)
*   **仕様**: 1つの案件に対する対応は **最大3回** までとする。
    *   `supportCount` が 3 に達した案件は再開不可とする。
    *   UI: 案件詳細に「n回目 / 3回」を常時表示する。
    *   `completed` かつ `supportCount < 3` の場合のみ「再開する」ボタンを表示する。
    *   `supportCount === 3` の完了案件には「上限到達」バッジを表示する。

---

## 4. UI仕様 (UI Specifications)

### UI-00: 表記ガイドライン (Language Guidelines)
*   **基本ルール**: ユーザーが目にするラベル、ボタン名、メッセージ、ツールチップ等は原則として**日本語**で実装する。

### UI-01: リスト表示
*   ステータスタブ (`未対応`, `対応中`, `完了`) によるフィルタリング。

### UI-02: ダッシュボード切替スイッチ
*   **配置**: ヘッダーまたはサイドバー上部。
*   **UIコンポーネント**: トグルスイッチ（Switch）。
*   **挙動**:
    *   OFF: 通常モード（自分の案件のみ）。
    *   ON: ダッシュボードモード（全件表示・操作不可）。

---

## 5. 技術スタック制約 (Technical Constraints)

### TC-01: ライブラリバージョン固定
*   **React**: `v18.2.0` に固定すること。
*   **Lucide React**: 依存関係として `react@18.2.0` を明示的に指定すること。
*   **理由**: GAS環境下でのCDNロードにおいて、React 19系とのバージョン競合によるランタイムエラーを防ぐため。