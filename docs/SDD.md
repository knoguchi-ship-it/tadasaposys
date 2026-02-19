# システム詳細設計書 (SDD) - タダサポ管理システム v1.8.1

**Version:** 1.8.1
**Date:** 2026/02/19
**Status:** Released

本ドキュメントは、システムが準拠すべき**仕様（Specification）**を定義する。実装およびテストは、本仕様を満たすことを目的とする。

---

## 1. データモデル仕様 (Data Specifications)

システムは単一のGoogleスプレッドシートを信頼できる唯一の情報源（Single Source of Truth）として扱う。

### S-00: 設定 (Settings)
*   **用途**: システム全体の運用設定値を管理するKey-Valueストア。コードへのハードコードを排除し、スプレッドシート上で設定を完結させる。
*   **制約**: A列の設定キーはシステムが参照する固定文字列であり、変更不可。C列の設定値のみ編集可能。
*   **シート構造**: A列=設定キー, B列=項目名（日本語表示）, C列=設定値, D列=入力例, E列=説明

| 設定キー | 設定値（例） | 必須 | 説明 |
| :--- | :--- | :--- | :--- |
| `ADMIN_EMAILS` | `admin@tadakayo.jp` | YES | 管理者メールアドレス（カンマ区切りで複数可） |
| `ZOOM_ACCOUNT_ID` | `xxxxxxxx` | NO* | Zoom Server-to-Server OAuth アカウントID |
| `ZOOM_CLIENT_ID` | `xxxxxxxx` | NO* | Zoom Client ID |
| `ZOOM_CLIENT_SECRET` | `xxxxxxxx` | NO* | Zoom Client Secret |
| `SHARED_CALENDAR_ID` | `xxx@group.calendar.google.com` | NO | 共有カレンダーID（空欄=デフォルトカレンダー） |
| `MAIL_INITIAL_SUBJECT` | `タダサポ｜ご相談を承りました` | NO | 初回メール件名テンプレート |
| `MAIL_INITIAL_BODY` | （デフォルト文あり） | NO | 初回メール本文テンプレート |
| `MAIL_DECLINED_SUBJECT` | `タダサポ｜ご利用回数上限のお知らせ` | NO | 回数超過メール件名テンプレート |
| `MAIL_DECLINED_BODY` | （デフォルト文あり） | NO | 回数超過メール本文テンプレート |
| `SPREADSHEET_URL` | `https://docs.google.com/...` | NO | 参考表示用（自動設定） |

\* Zoom連携を利用する場合は必須。

**テンプレートタグ**: `{{名前}}`, `{{事業所名}}`, `{{担当者名}}`, `{{相談内容}}`

**初回セットアップ**: GASエディタで `setupSettingsSheet` 関数を実行すると、テンプレート付きの「設定」シートが自動作成される。

---

### S-01: 案件リスト (Case List)
*   **用途**: 依頼の一次データ。Googleフォームの回答から `IMPORTRANGE` で取り込む。
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
| 1 | B列 | ステータス | `STATUS` | `unhandled` \| `inProgress` \| `completed` \| `rejected` | |
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
| 1 | B列 | 氏名 | `NICKNAME` | String | 画面表示名 |
| 2 | C列 | GWSアカウント | `EMAIL` | Email | **認証キー** |

### S-04: メール履歴 (Email History)
*   **用途**: 送信メールのバックアップ記録。Gmail APIが使えない場合のフォールバック表示にも使用。

| インデックス | 物理列 | 項目名 | 論理名 | 型 | 備考 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | A列 | 案件ID | `CASE_ID` | String | FK |
| 1 | B列 | 送信日時 | `SEND_DATE` | Date | |
| 2 | C列 | 送信者メール | `SENDER_EMAIL` | String | |
| 3 | D列 | 送信者名 | `SENDER_NAME` | String | |
| 4 | E列 | 宛先メール | `RECIPIENT_EMAIL` | String | |
| 5 | F列 | 件名 | `SUBJECT` | String | |
| 6 | G列 | 本文 | `BODY` | String | |

---

## 2. インターフェース仕様 (Function Specifications)

### F-01: getInitialData()
*   **概要**: アプリ起動時に必要な全データを取得する。
*   **出力**: `user`, `cases`, `masters`
*   **拡張仕様**:
    *   各 `CaseData` に対し、**`currentFiscalYearCount` (今年度累計利用回数)** を計算して付与する。
    *   **計算ロジック**:
        *   対象案件と同じ `EMAIL` を持つ案件のうち、`status` が `completed` または `inProgress` であるものの `supportCount` を合算する。
        *   年度定義: 4月1日開始。対象案件のタイムスタンプが属する年度で集計する。

### F-02: assignCase(caseId, user)
*   **概要**: 案件を担当者にアサインする（メール送信なし）。
*   **振る舞い**: サポート記録が無ければ新規作成（`inProgress`, `supportCount=1`）、あれば更新。

### F-03: assignAndSendEmail(caseId, user, subject, body)
*   **概要**: 案件をアサインし、初回メールを送信する。
*   **振る舞い**: `assignCase` を呼び出し後、Gmail APIで送信。スレッドIDを保存。メール履歴に記録。

### F-04: updateSupportRecord(recordData)
*   **振る舞い**: 記録更新、カレンダー連携（GoogleMeet/Zoom）、ステータス変更。

### F-05: reopenCase(caseId, user)
*   **概要**: 完了済み案件を再開し、次回の対応を開始する。
*   **前提条件**: `status === 'completed'` かつ `supportCount < 3` かつ `currentFiscalYearCount < 10`。
*   **振る舞い**:
    1.  現在の回の記録を `HISTORY` 列にJSON保存する。
    2.  `SUPPORT_COUNT` を `+1` する。
    3.  `STATUS` を `inProgress` に変更する。
    4.  `DATE`, `METHOD`, `CONTENT`, `REMARKS`, `EVENT_ID`, `MEET_URL` をクリアする。
    5.  担当者（`STAFF_EMAIL`, `STAFF_NAME`）は維持する。
*   **エラー**: `supportCount >= 3` の場合は例外を送出し、再開を拒否する。

### F-06: declineCase(caseId, user, subject, body)
*   **概要**: 年間利用回数超過のため案件を対応不可にする。
*   **振る舞い**: 回数超過メールを送信し、ステータスを `rejected` に変更する。

### F-07: sendNewCaseEmail(caseId, user, subject, body)
*   **概要**: 案件に対して新規メールスレッドを作成して送信する。

### F-08: sendCaseEmail(caseId, user, subject, body, threadId)
*   **概要**: 案件の既存スレッドに返信する。

### F-09: getThreadMessages(caseId)
*   **概要**: 案件の全Gmailスレッドのメッセージを取得する。
*   **出力**: `[{ threadId, subject, messages: [{ sendDate, senderName, fromEmail, subject, body, isStaff }] }]`

### F-10: getMasters()
*   **概要**: マスタデータ（方法/種別/スタッフ/メールテンプレート）を取得する。

---

## 3. セキュリティ仕様 (Security Specifications)

### SEC-01: 認証 (Authentication)
*   実行ユーザーのメールアドレスが「タダメンマスタ」に存在しない場合、処理をブロックしエラーを返す。

### SEC-02: 管理者権限 (Authorization)
*   `ADMIN_EMAILS` に含まれるユーザーのみが、他者の担当案件に対する割り当て変更を許可される。

### SEC-03: アクセス制御と表示ロジック (Access Control)
*   **通常モード**: 自分の担当案件のみ表示。
*   **ダッシュボードモード**: 全案件を表示するが、操作（Write）は不可とする。

### SEC-04: 年間制限ガード (Annual Limit Guard)
*   **仕様**: `currentFiscalYearCount` が **10回以上** の案件に対し、以下の制限を適用する。
    *   UI: バッジや警告アイコンで「制限超過」を明示する。
    *   未対応: 「メール送信して担当」「担当する（メールなし）」ボタンを非表示とし、「回数超過」ボタンのみ表示する。
    *   完了: 「再開」ボタンを非表示とする。

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
*   ステータスタブ (`未対応`, `対応中`, `完了`, `対応不可`) によるフィルタリング。

### UI-02: ダッシュボード切替スイッチ
*   **配置**: ヘッダー上部。
*   **UIコンポーネント**: トグルボタン。
*   **挙動**:
    *   OFF: 通常モード（自分の案件のみ）。
    *   ON: ダッシュボードモード（全件表示・操作不可）。

### UI-03: 検索機能
*   **キーワード検索**: 事業所名、担当者名、メール、内容、種別、都道府県を横断検索。
*   **期間検索**: 開始日〜終了日でタイムスタンプフィルタ。
*   **アクセシビリティ**: WCAG 2.1 AA準拠。

### UI-04: 未対応案件のアクション
*   **年間制限内**: 「メール送信して担当」ボタンと「担当する（メールなし）」ボタンの2つを表示。
*   **年間制限超過**: 「回数超過」ボタンのみ表示。

---

## 5. 技術スタック制約 (Technical Constraints)

### TC-01: ライブラリバージョン固定
*   **React**: `v18.2.0` に固定すること。
*   **Lucide React**: 依存関係として `react@18.2.0` を明示的に指定すること。
*   **理由**: GAS環境下でのCDNロードにおいて、React 19系とのバージョン競合によるランタイムエラーを防ぐため。
