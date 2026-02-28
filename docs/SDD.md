# システム詳細設計書 (SDD) - タダサポ管理システム v1.9.0

**Version:** 1.9.0
**Date:** 2026/02/22
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
| `ATTACHMENT_FOLDER_ID` | `1AbCdEfGh...` | YES* | 完了報告/記録修正でアップロードした添付ファイルの保存先DriveフォルダID |
| `MAIL_FORCE_CC` | `cc@example.com` | NO | 送信メールに追加するCC（カンマ区切り、任意） |
| `ANNUAL_USAGE_LIMIT` | `10` | NO | 年間利用回数上限（未設定時: 10）。管理者が設定画面から変更可 |
| `CASE_USAGE_LIMIT` | `3` | NO | 1案件あたりの対応回数上限（未設定時: 3）。管理者が設定画面から変更可 |
| `MAIL_DRY_RUN` | `false` | NO | `true`時は外部送信せずドライランとして処理 |
| `MAIL_INITIAL_SUBJECT` | `タダサポ｜ご相談を承りました` | NO | 初回メール件名テンプレート |
| `MAIL_INITIAL_BODY` | （デフォルト文あり） | NO | 初回メール本文テンプレート |
| `MAIL_DECLINED_SUBJECT` | `タダサポ｜ご利用回数上限のお知らせ` | NO | 回数超過メール件名テンプレート |
| `MAIL_DECLINED_BODY` | （デフォルト文あり） | NO | 回数超過メール本文テンプレート |
| `SPREADSHEET_URL` | `https://docs.google.com/...` | NO | 参考表示用（自動設定） |

\* 機能利用時に必須（Zoom連携時は Zoom 設定、添付機能利用時は `ATTACHMENT_FOLDER_ID`）。

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
| 14 | O列 | 添付ファイルJSON | `ATTACHMENTS` | String | 現在回の添付ファイル情報（最大5件） |
| 15 | P列 | 案件上限特例 | `CASE_LIMIT_OVERRIDE` | Number \| null | 案件ごとの対応回数上限上書き値。null=全体設定を使用 |
| 16 | Q列 | 年度上限特例 | `ANNUAL_LIMIT_OVERRIDE` | Number \| null | 案件ごとの年間利用回数上限上書き値。null=全体設定を使用 |

### S-03: タダメンマスタ (Staff Master)
*   **用途**: 認証および担当者候補リスト。

| インデックス | 物理列 | 項目名 | 論理名 | 型 | 備考 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | A列 | タダメンID | `STAFF_ID` | String | 一意識別子 |
| 1 | B列 | 氏名 | `NICKNAME` | String | 画面表示名 |
| 2 | C列 | GWSアカウント | `EMAIL` | Email | **認証キー** |
| 3 | D列 | ロール | `ROLE` | String | `admin` / `staff` |
| 4 | E列 | 有効フラグ | `IS_ACTIVE` | Boolean(String) | `true` / `false` |

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

### S-05: 監査ログ (Audit Log)
*   **用途**: 管理者操作・重要な更新操作の監査証跡。

| インデックス | 物理列 | 項目名 | 論理名 | 型 | 備考 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | A列 | 時刻 | `TIMESTAMP` | Date | |
| 1 | B列 | 操作者メール | `ACTOR_EMAIL` | String | |
| 2 | C列 | 操作者名 | `ACTOR_NAME` | String | |
| 3 | D列 | 操作 | `ACTION` | String | `upsert_staff` 等 |
| 4 | E列 | 対象種別 | `TARGET_TYPE` | String | `case` / `staff` / `settings` |
| 5 | F列 | 対象ID | `TARGET_ID` | String | |
| 6 | G列 | 変更前 | `BEFORE_JSON` | String | JSON |
| 7 | H列 | 変更後 | `AFTER_JSON` | String | JSON |

### S-06: 案件補正 (Case Override)
*   **用途**: 管理者による案件情報（連絡先・事業所名・相談内容等）の手動補正値を保持する。
*   **設計方針**: 「案件リスト」シートはGoogleフォームの回答をIMPORTRANGEで取り込んでいる。そのシートに直接書き込むとIMPORTRANGE数式が破壊されるため、補正値を本シートで管理し、`getAllCasesJoined()` でマージして表示する。
*   **制約**:
    *   各行は案件リストの PK（タイムスタンプ）を A列に持つ。
    *   値が空文字のフィールドは「補正なし（案件リストの値をそのまま使用）」を意味する。
    *   本シートが存在しない場合、初回 `updateCaseDataAdmin` 実行時に自動作成される。

| インデックス | 物理列 | 項目名 | 論理名 | データ型 | 備考 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | A列 | タイムスタンプ（案件ID） | `PK` | String | **FK** → 案件リスト.PK |
| 1 | B列 | メールアドレス | `EMAIL` | String | 空＝補正なし |
| 2 | C列 | 介護事業所名 | `OFFICE_NAME` | String | 空＝補正なし |
| 3 | D列 | お名前 | `REQUESTER_NAME` | String | 空＝補正なし |
| 4 | E列 | 困りごと詳細 | `DETAILS` | String | 空＝補正なし |
| 5 | F列 | 都道府県 | `PREFECTURE` | String | 空＝補正なし |
| 6 | G列 | サービス種別 | `SERVICE_TYPE` | String | 空＝補正なし |

**マージ優先順位**: 案件補正（値あり）＞ 案件リスト（IMPORTRANGE元データ）

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
*   **振る舞い**: 記録更新、カレンダー連携（GoogleMeet/Zoom）、ステータス変更、添付ファイル更新。
*   **添付仕様**:
    *   1回の報告（現在回）につき最大5件。
    *   新規添付は `ATTACHMENT_FOLDER_ID` で指定されたDriveフォルダへ保存。
    *   記録編集時は保持対象と新規添付を組み合わせて入れ替え可能。

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
*   **概要**: マスタデータ（方法/種別/スタッフ/メールテンプレート/上限設定）を取得する。
*   **出力**: `{ methods, businessTypes, prefectures, allStaff, limits: { annual, caseSupport }, mailTemplates, ... }`
    *   `limits.annual`: 年間利用回数上限（`ANNUAL_USAGE_LIMIT` 設定値、デフォルト10）
    *   `limits.caseSupport`: 1案件あたり対応回数上限（`CASE_USAGE_LIMIT` 設定値、デフォルト3）

### F-11: getAdminPanelData()
*   **概要**: 管理者パネル初期表示用データ（スタッフ一覧、編集可能設定、監査ログ）を返す。
*   **制約**: 管理者のみ実行可能。

### F-12: upsertStaffMember(payload)
*   **概要**: 既存スタッフの権限（ロール）更新を行う。
*   **入力**: `{email, role}`（`isActive` は任意で維持運用）。
*   **制約**: 管理者のみ実行可能。`role` は `admin` / `staff`。**新規メンバー追加は不可**。

### F-13: deactivateStaffMember(email)
*   **概要**: スタッフを論理無効化する（`IS_ACTIVE=false`）。
*   **制約**: 管理者のみ実行可能。

### F-14: updateSettingsAdmin(patch)
*   **概要**: 編集許可された設定キーのみ更新する。
*   **制約**: 管理者のみ実行可能。ホワイトリスト外キーは拒否。

### F-15: reassignCaseAdmin(caseId, staffEmail)
*   **概要**: 管理者が案件担当を再割り当てする。
*   **制約**: 管理者のみ実行可能。対象スタッフは有効ユーザーのみ。

### F-16: setCaseStatusAdmin(caseId, status)
*   **概要**: 管理者が案件のステータスを任意に変更する。
*   **入力**: `caseId`（タイムスタンプ文字列）、`status`（`unhandled` / `inProgress` / `completed` / `rejected`）
*   **振る舞い**: レコードが存在しなければ新規作成。ステータスを直接上書きし監査ログに記録する。
*   **制約**: 管理者のみ実行可能。

### F-17: updateCaseDataAdmin(caseId, payload)
*   **概要**: 管理者が案件基本情報・サポート記録を直接編集する。
*   **入力**: `payload: { casePatch?: {...}, recordPatch?: {...} }`
    *   `casePatch`: 案件リストの更新フィールド（officeName, requesterName, email, serviceType, prefecture, details）
    *   `recordPatch`: サポート記録の更新フィールド（supportCount, content, remarks, caseLimitOverride, annualLimitOverride）
*   **振る舞い**: `hasOwnProperty` チェックによるスパース更新（指定フィールドのみ更新）。`caseLimitOverride` / `annualLimitOverride` に `null` を指定すると空欄（全体設定に戻す）。監査ログに記録する。
*   **制約**: 管理者のみ実行可能。

---

## 3. セキュリティ仕様 (Security Specifications)

### SEC-01: 認証 (Authentication)
*   実行ユーザーのメールアドレスが「タダメンマスタ」に存在しない場合、処理をブロックしエラーを返す。

### SEC-02: 管理者権限 (Authorization)
*   権限判定はバックエンドで強制する。
*   `ROLE=admin` を優先し、後方互換として `ADMIN_EMAILS` も管理者判定に利用する。
*   管理者以外は、自分の担当案件（または未担当案件への初回アサイン）以外の更新を拒否する。
*   管理者操作は監査ログへ記録する。

### SEC-03: アクセス制御と表示ロジック (Access Control)
*   **通常モード** (`isDashboardMode=false`): 自分の担当案件のみ表示（未対応は全員共有）。
*   **閲覧モード** (`isDashboardMode=true, isAdminMode=false`): 全案件を表示するが、操作（Write）は不可。
*   **管理モード** (`isDashboardMode=true, isAdminMode=true`): 全案件を表示し、管理者操作が可能。

### SEC-04: 年間制限ガード (Annual Limit Guard)
*   **上限値**: `annualLimitOverride`（案件特例）→ `masters.limits.annual`（全体設定）→ `10`（ハードコードデフォルト）の優先順で決定。
*   **仕様**: `currentFiscalYearCount` が上限値以上の案件に対し、以下の制限を適用する。
    *   UI: バッジや警告アイコンで「制限超過」を明示する。
    *   未対応: 「メール送信して担当」「担当する（メールなし）」ボタンを非表示とし、「回数超過」ボタンのみ表示する。
    *   完了: 「再開」ボタンを非表示とする。

### SEC-05: 案件回数制限 (Per-Case Limit)
*   **上限値**: `caseLimitOverride`（案件特例）→ `masters.limits.caseSupport`（全体設定）→ `3`（ハードコードデフォルト）の優先順で決定。
*   **仕様**: 1つの案件に対する対応は上限値までとする。
    *   `supportCount` が上限に達した案件は再開不可とする。
    *   UI: 案件詳細に「n回目 / 上限」を常時表示する（管理モードでクリックして特例上限を変更可能）。
    *   `completed` かつ `supportCount < 上限` の場合のみ「再開する」ボタンを表示する。
    *   `supportCount === 上限` の完了案件には「上限到達」バッジを表示する。
    *   特例上限が設定されている場合、UI に「特例」バッジを表示する。

---

## 4. UI仕様 (UI Specifications)

### UI-00: 表記ガイドライン (Language Guidelines)
*   **基本ルール**: ユーザーが目にするラベル、ボタン名、メッセージ、ツールチップ等は原則として**日本語**で実装する。

### UI-01: リスト表示
*   ステータスタブ (`未対応`, `対応中`, `完了`, `対応不可`) によるフィルタリング。

### UI-02: 表示モード切替
*   **配置**: ヘッダー上部（3ボタン式セグメントコントロール）。
*   **モード**:
    *   **通常**: `isDashboardMode=false, isAdminMode=false`。自分担当案件のみ表示・全操作可能。
    *   **閲覧**: `isDashboardMode=true, isAdminMode=false`。全件表示・操作（Write）不可。
    *   **管理**: `isDashboardMode=true, isAdminMode=true`。管理者のみ表示。全件表示＋管理操作可能。

### UI-03: 検索機能
*   **キーワード検索**: 事業所名、担当者名、メール、内容、種別、都道府県を横断検索。常時表示（サイドバー上部）。
*   **アクティブフィルタチップ**: 適用中の絞り込み条件をpill形式で一覧表示し、個別削除可能。
*   **詳細フィルタ（折りたたみパネル）**:
    *   期間プリセット: 今月 / 先月 / 今年度 / 前年度（ローカル時間基準で日付計算）。
    *   カスタム期間: 開始日〜終了日。
    *   都道府県 / サービス種別 / 並び順（最新順 / 古い順）。
    *   管理モードのみ: 担当者フィルタ（全件 / 未割当 / 個別担当）。
*   **フィルタ件数バッジ**: 詳細フィルタボタンに適用中条件数をバッジ表示。

### UI-04: 未対応案件のアクション
*   **年間制限内**: 「メール送信して担当」ボタンと「担当する（メールなし）」ボタンの2つを表示。
*   **年間制限超過**: 「回数超過」ボタンのみ表示。

### UI-05: 添付ファイル操作（完了報告/記録修正）
*   対象画面: 「実施記録・完了報告」「記録の修正」モーダル。
*   アップロード方式: ファイル選択 + ドラッグ＆ドロップ。
*   制限: 1回の報告（現在回）につき最大5件。
*   記録編集: 既存添付の削除と新規追加により入れ替え可能。

### UI-06: 管理者パネル
*   管理者ユーザーのみ「管理」モードボタンを表示する。
*   管理モードON時のみ、ヘッダーに権限管理・設定管理・新着通知トグルボタンを表示する。
*   スタッフ権限管理（既存メンバーのロール更新）、設定更新、監査ログ参照を提供する。
*   メンバー追加UIは提供しない（タダメンマスタは外部で管理）。
*   権限管理は大量メンバー前提（100名以上）として、名前/メール検索とロール・有効状態フィルタを提供する。
*   権限管理・設定管理は各々の専用ダイアログで操作する（管理パネルは入口のみ）。
*   設定管理はカテゴリ切替（上限/メール/連携/その他）で表示を分割する。
*   権限管理で扱うステータスは `管理者 / タダメン / 無効` の3種類とする。
*   自分自身の権限変更は禁止する。

### UI-07: 管理モード インライン編集
*   管理モード時、案件詳細の以下の要素をクリックすることで、モーダルを開かず直接編集できる。
*   **ステータスバッジ**: クリックでドロップダウン表示。全ステータスを選択可能（`setCaseStatusAdmin`）。
*   **担当者バッジ**: クリックで検索付きドロップダウン表示。名前/メールで絞り込み、件数表示（`reassignCaseAdmin`）。
*   **案件回数 (n / 上限)**: クリックで案件上限の特例値入力ポップオーバー表示（`updateCaseDataAdmin`）。空欄でリセット。特例設定中は「特例」バッジを表示。
*   **今年度利用数 (n / 上限)**: クリックで年度上限の特例値入力ポップオーバー表示（`updateCaseDataAdmin`）。空欄でリセット。
*   **共通挙動**: 背後に `fixed inset-0 z-40` オーバーレイを配置し、外側クリックで閉じる。Escapeキーでも閉じる。案件切替でも自動クリア。

### UI-08: 新着バッジ
*   **対象モード**: 通常モード・管理モード（閲覧モードは非表示）。
*   **表示**: ステータスタブのラベル右側に `+N` のバッジ（赤色）を表示する。
*   **計算方式**: 「最後にタブをクリックした時点のケースIDセット」をlocalStorageに保存し、現在のケースIDセットとの差分をカウントする（タイムスタンプ比較ではないためステータス変更による案件移動も検出可能）。
*   **通常モード**: 自分担当ケースのみカウント（未対応は全員共有）。
*   **管理モード**: 全件カウント。BellボタンでバッジOFF/ONを切り替え可能（localStorageに永続）。
*   **初回ロード**: seenIdsが未設定の場合、全ケースが新着として表示される。タブクリックで既読化。
*   **localStorage**: `tadasapo_seenIds_{userEmail}`（タブ別ケースIDセット）、`tadasapo_showNewBadge`（バッジ表示フラグ）。

---

## 5. 技術スタック制約 (Technical Constraints)

### TC-01: ライブラリバージョン固定
*   **React**: `v18.2.0` に固定すること。
*   **Lucide React**: 依存関係として `react@18.2.0` を明示的に指定すること。
*   **理由**: GAS環境下でのCDNロードにおいて、React 19系とのバージョン競合によるランタイムエラーを防ぐため。

---

## 6. バージョン履歴

| バージョン | 主な変更内容 |
|:---|:---|
| v1.8.1 | 初版リリース。案件一覧4タブ、担当アサイン、日程確定、完了報告、添付機能、管理者モード基盤 |
| v1.8.2 | 管理者機能拡張: `ANNUAL_USAGE_LIMIT` / `CASE_USAGE_LIMIT` 設定化、`setCaseStatusAdmin` / `updateCaseDataAdmin` API追加、案件単位上限特例（`caseLimitOverride` / `annualLimitOverride`）追加 |
| v1.8.3 | 管理モード復元: 通常/閲覧/管理 3モードボタン化、検索条件拡張（都道府県/サービス種別/担当状況）、権限管理・設定管理の専用ダイアログ分離 |
| **v1.9.0** | **検索UI刷新**（常時表示・チップ型フィルタ・期間プリセット・並び順）、**管理インライン編集**（ステータス・担当者・上限のクリック編集）、**新着バッジ**（タブ別ID差分方式、管理モードでON/OFF可能） |
