# システム詳細設計書 (SDD) — タダサポ管理システム v1.12.8

**Version:** 1.12.8
**Date:** 2026/06/11
**Status:** Released

> **v1.12.8 追補（S1 Stage4 有効化）**
> - Stage4（Read 切替）を本番有効化。設定 `CASE_KEY_READ_VIA_MAP` を設定管理ダイアログの boolean トグルとして公開（ON で `getAllCasesJoined` の結合を case_id 経由に。既定OFF・OFFで即ロールバック）。Backfill 済み（136案件）・診断クリア（duplicateRecordFk=0）。Stage5（Contract）は便益<リスクのため**見送り**、コードは温存。

> **v1.12.7 追補（S1: 案件キーのサロゲート化 Stage1〜3）**
> - エポックms基盤の決定的サロゲート `case_id`（`case_<epoch>`）と `案件キーマップ` シート（§S-09）を導入。Stage1=Expand 基盤、Stage2=Dual-write（7チョークポイントで `ensureCaseKeyMapping_`・読取/FK列不変）、Stage3=冪等 Backfill（`backfillCaseKeyMap_`・既定 dryRun／管理画面から実行可能）。`withScriptLock_` に再入ガードを追加。Stage4 Read 切替・Stage5 Contract は後続。

> **v1.12.6 追補（重複サポート記録による表示不整合の止血 / Stage 0）**
> - 事象: 管理アサイン後に完了しても画面が「未対応・担当者未設定」に戻る。根因はサポート記録に同一案件PKの**重複行**が生じた際、書き込み（`assignCase`/`reassignCaseAdmin`/`updateSupportRecord` の `for…break`＝**最初の一致行**）と表示（`getAllCasesJoined` の `recordMap`＝**最後の一致行**で上書き）が別行を指すこと。
> - 対策（スキーマ変更なし）: ①表示の `recordMap` を「最初の一致」採用に統一し書き込み経路と一致（重複FK検出時に整合性警告ログ）。②サポート記録への「検索→追記/更新」を新ヘルパー `withRecordWriteLock_`（`LockService`）で排他化し、競合・二重送信による重複行生成を防止。
> - 根治（不安定な日付PKのサロゲート `case_id` 化）は後続の expand-contract 移行で対応予定。ER設計案: `docs/er-before.dbml` / `docs/er-after.dbml`。

> **v1.12.5 追補（管理担当者インライン変更の不具合修正）**
> - 設計変更なし（バグ修正のみ）。管理モードの担当者インライン変更 `handleAdminReassignInline` が API 戻り値を捕捉せず `result is not defined`（ReferenceError）で失敗していた問題を、共通ヘルパー `applyCaseTransitionResult` への集約（DRY）で修正。デッドコード（未使用 `inlineStaff`・重複 `recalcFiscalYearCounts`）削除。回帰 E2E（`tests/e2e/06-admin-features.spec.ts`）を追加。

> **v1.12.4 追補（年度利用回数の管理者手動修正）**
> - 管理者が案件詳細の「今年度利用数」から、年度の利用回数（実数）を手動修正できるようにした。
> - 利用回数は派生値（同一メール+年度の対応回数合算）のため、`年間利用補正` シート（メール+年度→補正量）を新設し、**表示値 = 自動計算値(base) + 補正量** とする。入力は目的の絶対値で行い、内部では `補正量 = 目的値 − base` を保存する（その後に実案件が増えても加算が継続）。
> - 補正は同一メール+年度の全案件に一貫反映。新規バックエンド関数 `setAnnualUsageCountAdmin(caseId, desiredCount)`。実効値は 0 未満にしない。

> **v1.12.3 追補（手動追加案件の年間カウント合流）**
> - 管理者が手動追加した案件も、Googleフォーム申込と**同一メールアドレス（正規化: 大小文字・前後空白を無視）+ 同一年度**で年間利用回数を合算するよう修正。
> - 原因: 年度算出が案件PK文字列依存で、手動追加案件のPK `"manual_<エポックミリ秒>"` から年度を解決できず（0に落ち）合流していなかった。
> - 対応: `caseFiscalYear_()` / `annualUsageKey_()` を新設し、`getAllCasesJoined` の集計・表示の両方でキーを統一。フロント（`buildMockCaseList` / `recalcFiscalYearCounts`）も同一ロジックに統一。
> - 併せて、手動追加直後の楽観的表示で受付日が「manual_…」と表示される不具合を修正。

> **v1.12.2 追補（backup 統合・実害バグ修正）**
> - 送信メールの差出人(From)文字化けを修正。`sendInThread_` で From ヘッダを RFC 2047（`=?UTF-8?B?...?=`）で明示。表示名は新ヘルパー `getSenderInfo_()` がタダメンマスタから取得。
> - 日程確定モーダルで選択中スロットを「✓ 選択中」緑バー（FullCalendar イベント `__selected__`）として永続表示。
> - 日程確定カレンダーで `selectOverlap` を追加し、バッファ・既存予定の上に選択枠を被せられないよう制限（自分の選択枠の上のみ再ドラッグ可）。

> **v1.12.1 追補（予約送信廃止）**
> - メール予約送信機能を廃止。即時送信と下書き保存は継続。
> - 旧予約送信トリガーはメール送信せず、未送信キューを `disabled` に更新する互換処理に変更。
> - クリーンアップ関数 `disablePendingScheduledEmails()` を追加。

> **v1.12.0 追補（日程確定刷新 Phase 1〜4）**
> - 設定シートに6キー追加: `TEAM_CALENDAR_ID` / `DISPLAY_CALENDARS_JSON` / `SCHEDULE_BUFFER_MIN` / `ZOOM_FIXED_URL` / `ZOOM_FIXED_ID` / `ZOOM_FIXED_PASS`
> - バックエンド関数追加: `getScheduleAvailability(rangeStart, rangeEnd)` / `checkScheduleConflict(start, dur, excludeId)` / `createTeamCalendarEvent_()` / 純粋関数 `eventsOverlap_()` / `computeBufferedWindow_()` / `parseDisplayCalendarsJson_()`
> - 自動マイグレーション: `addScheduleZoomSettings()` を `ensureAttachmentSchema_()` から自動呼出し（SCHEMA_VERSION_=6）
> - フロント: `ScheduleAvailabilityCalendar` コンポーネント新設（FullCalendar 6.1.18 グローバルバンドル）。`conflictState` / `zoomMode` ステート追加。
> - 仕様変更: 方法=Zoom 時はチームカレンダー（TEAM_CALENDAR_ID）への登録が必須化（重複防止）。重複検知は方法=Zoom 時のみ発動し、検知時は送信ブロック。固定Zoomモード（zoomMode='fixed'）で `ZOOM_FIXED_URL` を再利用可能。
> - getMasters 戻り値: `zoomFixedConfigured: boolean` 追加

本ドキュメントは、システムが準拠すべき**仕様（Specification）**を定義する。実装およびテストは、本仕様を満たすことを目的とする。

---

## 1. データモデル仕様 (Data Specifications)

システムは単一の Google スプレッドシートを信頼できる唯一の情報源（Single Source of Truth）として扱う。

### シート一覧

| シート名 | 定数 `SHEET_NAMES` | 用途 |
|---------|-------------------|------|
| 設定 | `SETTINGS` | Key-Value 形式の全設定値 |
| 案件リスト | `CASES` | フォーム回答 IMPORTRANGE（**書き込み禁止**） |
| 案件補正 | `CASES_OVERRIDE` | 管理者による案件情報手動補正 |
| 案件手動追加 | `CASES_MANUAL` | アプリから手動追加した案件 |
| サポート記録 | `RECORDS` | 対応ステータス・担当者・日時等（メイン） |
| タダメンマスタ | `STAFF` | スタッフ一覧・認証・権限管理 |
| メール履歴 | `EMAIL_HISTORY` | 送信メールのバックアップ記録 |
| 監査ログ | `AUDIT_LOG` | 管理者操作の監査証跡 |
| メール下書き | `EMAIL_DRAFTS` | 送信前メール一時保存（v1.11.0） |
| 予約送信キュー | `EMAIL_SCHEDULED` | 予約送信は v1.12.1 で廃止。既存キュー履歴・無効化確認用に保持 |
| 年間利用補正 | `ANNUAL_ADJUST` | 管理者による年度利用回数の手動補正（メール+年度→補正量。列: メールアドレス/年度/補正値/更新者/更新日時）（v1.12.4） |
| 案件キーマップ | `CASE_KEY_MAP` | 案件の不変サロゲートID(case_id)と自然キーの対応表。S1 Stage1 で新設（Expand 基盤・未接続） |

---

### S-00: 設定 (Settings)

**用途:** システム全体の運用設定値を管理する Key-Value ストア。
**制約:** A 列の設定キーは変更不可。C 列の設定値のみ編集可能。
**シート構造:** A=設定キー, B=項目名, C=設定値, D=入力例, E=説明

| 設定キー | 必須 | 説明 |
|---------|------|------|
| `ADMIN_EMAILS` | YES | 管理者メールアドレス（後方互換。現在は STAFF シートの `ROLE=admin` を優先） |
| `ZOOM_ACCOUNT_ID` / `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET` | NO* | Zoom Server-to-Server OAuth 認証情報 |
| `SHARED_CALENDAR_ID` | NO | 共有カレンダーID（空欄=デフォルトカレンダー） |
| `ATTACHMENT_FOLDER_ID` | YES* | 添付ファイル保存先 DriveフォルダID |
| `MAIL_FORCE_CC` | NO | 全メールに自動付与する CC（カンマ区切り） |
| `ANNUAL_USAGE_LIMIT` | NO | 年間利用上限（デフォルト 10） |
| `CASE_USAGE_LIMIT` | NO | 1案件あたり対応上限（デフォルト 3） |
| `MAIL_DRY_RUN` | NO | `true` で外部送信せずドライラン |
| `MAIL_INITIAL_SUBJECT` / `MAIL_INITIAL_BODY` | NO | 初回メールテンプレート |
| `MAIL_INITIAL_INCLUDE_DETAILS` | NO | 初回メールに相談内容を含むか（true/false） |
| `MAIL_DECLINED_SUBJECT` / `MAIL_DECLINED_BODY` | NO | 回数超過メールテンプレート |
| `MAIL_NEW_SUBJECT` / `MAIL_NEW_BODY` | NO | 新規メールテンプレート |
| `MAIL_SCHEDULE_SUBJECT` / `MAIL_SCHEDULE_BODY` | NO | 日程確定メールテンプレート |
| `SUPPORT_TOOLS` | NO | 対応ツール一覧（カンマ区切り） |
| `TOOL_MONTHLY_LIMITS` | NO | ツール月間上限（`ツール名:上限数` カンマ区切り） |
| `DELETED_CASE_IDS` | NO | ソフトデリート済み案件IDリスト（カンマ区切り） |

**テンプレートタグ:** `{{名前}}` `{{事業所名}}` `{{担当者名}}` `{{相談内容}}` `{{日程}}` `{{対応方法}}` `{{URL}}`

---

### S-01: 案件リスト (Cases)

**用途:** 依頼の一次データ。Google フォーム回答から IMPORTRANGE で取り込む。
**制約:** このシートへの `setValue` 等は IMPORTRANGE 数式を破壊するため**絶対禁止**。管理者による補正は S-06 で行う。

| IDX | 物理列 | 論理名 | 型 | 備考 |
|-----|--------|-------|----|------|
| 0 | A | `PK` | Date/String | **主キー**（タイムスタンプ） |
| 1 | B | `EMAIL` | String | 依頼者メール |
| 2 | C | `OFFICE` | String | 介護事業所名 |
| 3 | D | `NAME` | String | 依頼者氏名 |
| 4 | E | `DETAILS` | String | 相談内容 |
| 5 | F | `PREFECTURE` | String | 都道府県 |
| 6 | G | `SERVICE` | String | サービス種別 |

---

### S-02: サポート記録 (Records)

**用途:** タダサポ側の対応ステータス管理。案件リストと 1:0-1 対応。
**重要:** 全 **19 列**（IDX 0〜18）。左詰め、ギャップなし。

| IDX | 物理列 | 論理名 | 型 | 備考 |
|-----|--------|-------|----|------|
| 0 | A | `FK` | String | **外部キー**（Cases.PK） |
| 1 | B | `STATUS` | String | `unhandled` / `inProgress` / `completed` / `rejected` / `cancelled` |
| 2 | C | `STAFF_EMAIL` | String | 担当者メール |
| 3 | D | `STAFF_NAME` | String | 担当者名 |
| 4 | E | `DATE` | Date | 実施予定日時 |
| 5 | F | `COUNT` | Number | 対応回数（1〜上限値） |
| 6 | G | `METHOD` | String | 対応方法（GoogleMeet / Zoom / 電話等 / 対面 / メール等） |
| 7 | H | `BUSINESS` | String | 事業種別 |
| 8 | I | `CONTENT` | String | 実施内容 |
| 9 | J | `REMARKS` | String | 備考 |
| 10 | K | `HISTORY` | String | 過去回の記録 JSON |
| 11 | L | `EVENT_ID` | String | カレンダーイベントID |
| 12 | M | `MEET_URL` | String | Meet/Zoom URL |
| 13 | N | `THREAD_ID` | String | GmailスレッドID（カンマ区切りで複数） |
| 14 | O | `ATTACHMENTS` | String | 現在回の添付ファイル JSON（最大5件） |
| 15 | P | `CASE_LIMIT_OVERRIDE` | Number\|null | 案件ごとの対応回数上限特例。null=全体設定 |
| 16 | Q | `ANNUAL_LIMIT_OVERRIDE` | Number\|null | 案件ごとの年間利用上限特例。null=全体設定 |
| 17 | R | `TOOLS` | String | 対応ツール JSON（`["Word・Excel","LINEWORKS"]` 等） |
| 18 | S | `SUB_STAFF` | String | サブ担当 JSON（`[{"email":"...","name":"..."}]`、最大1名） |

**ステータス遷移:**
```
unhandled → inProgress → completed → (reopen → inProgress、最大N回)
unhandled → rejected（回数超過メール送信後）
inProgress → cancelled（担当者・管理者がキャンセル）
completed  → cancelled（完了後キャンセル）
```

**HISTORY JSON 構造（1エントリ）:**
```json
{
  "round": 1,
  "scheduledDateTime": "ISO8601",
  "method": "GoogleMeet",
  "content": "実施内容",
  "remarks": "備考",
  "meetUrl": "https://...",
  "attachments": [...],
  "tools": [...],
  "staffName": "担当者名",
  "staffEmail": "mail@example.com"
}
```

---

### S-03: タダメンマスタ (Staff)

| IDX | 物理列 | 論理名 | 型 | 備考 |
|-----|--------|-------|----|------|
| 0 | A | `STAFF_ID` | String | 一意識別子 |
| 1 | B | `NAME` | String | 表示名 |
| 2 | C | `EMAIL` | String | **認証キー** |
| 3 | D | `ROLE` | String | `admin` / `staff` |
| 4 | E | `IS_ACTIVE` | Boolean(String) | `true` / `false` |

---

### S-04: メール履歴 (Email History)

| IDX | 物理列 | 論理名 | 型 | 備考 |
|-----|--------|-------|----|------|
| 0 | A | `CASE_ID` | String | FK |
| 1 | B | `SEND_DATE` | Date | 送信日時 |
| 2 | C | `SENDER_EMAIL` | String | 送信者メール |
| 3 | D | `SENDER_NAME` | String | 送信者名 |
| 4 | E | `RECIPIENT_EMAIL` | String | 宛先メール |
| 5 | F | `SUBJECT` | String | 件名 |
| 6 | G | `BODY` | String | 本文 |

---

### S-05: 監査ログ (Audit Log)

| IDX | 物理列 | 論理名 | 型 | 備考 |
|-----|--------|-------|----|------|
| 0 | A | `TIMESTAMP` | Date | 操作日時 |
| 1 | B | `ACTOR_EMAIL` | String | 操作者メール |
| 2 | C | `ACTOR_NAME` | String | 操作者名 |
| 3 | D | `ACTION` | String | 操作種別（例: `assign_case`） |
| 4 | E | `TARGET_TYPE` | String | `case` / `staff` / `settings` |
| 5 | F | `TARGET_ID` | String | 対象ID |
| 6 | G | `BEFORE_JSON` | String | 変更前の値（JSON） |
| 7 | H | `AFTER_JSON` | String | 変更後の値（JSON） |

---

### S-06: 案件補正 (Cases Override)

**設計方針:** 案件リストは IMPORTRANGE 保護のため直接書き込み不可。補正値を本シートで管理し `getAllCasesJoined()` でマージして返す。
**制約:** 値が空のフィールドは「補正なし（元の値をそのまま使用）」を意味する。

| IDX | 物理列 | 論理名 | 備考 |
|-----|--------|-------|----|
| 0 | A | `PK` | FK → 案件リスト.PK |
| 1〜6 | B〜G | `EMAIL` 〜 `SERVICE` | 空欄=補正なし（S-01 と同一列構造） |

**マージ優先順位:** 案件補正（値あり）> 案件リスト（IMPORTRANGE元データ）

---

### S-07: メール下書き (Email Drafts) ※v1.11.0追加

**用途:** 送信前のメール下書きを担当者ごとに一時保存する。
**複合キー:** `CASE_ID + STAFF_EMAIL + MODE + THREAD_ID`（同一複合キーで上書き）
**全 11 列。**

| IDX | 物理列 | 論理名 | 型 | 備考 |
|-----|--------|-------|----|------|
| 0 | A | `DRAFT_ID` | String | UUID（`draft-` プレフィックス） |
| 1 | B | `CASE_ID` | String | FK → 案件リスト.PK |
| 2 | C | `STAFF_EMAIL` | String | 担当者メール |
| 3 | D | `MODE` | String | `initial` / `new` / `reply` / `schedule` / `decline` |
| 4 | E | `THREAD_ID` | String | 返信先スレッドID（新規の場合は空文字） |
| 5 | F | `SUBJECT` | String | 件名 |
| 6 | G | `BODY` | String | 本文 |
| 7 | H | `CC` | String | CC メールアドレス |
| 8 | I | `BCC` | String | BCC メールアドレス |
| 9 | J | `TOOLS` | String | 対応ツール JSON |
| 10 | K | `UPDATED_AT` | Date | 最終更新日時 |

---

### S-08: 予約送信キュー (Email Scheduled) ※v1.12.1廃止

**用途:** v1.11.0 で追加された予約送信メールのキュー履歴。時間主導トリガーでは作成者アカウントから送信され、アクセスユーザー本人からの送信を保証できないため v1.12.1 で廃止。
**現行動作:** 新規登録・自動送信は行わない。既存の `pending` / `sending` 行は `disablePendingScheduledEmails()` または残存トリガー互換の `processScheduledEmails_()` により `disabled` に更新する。
**PK:** `QUEUE_ID`（UUID、`sch-` プレフィックス）
**全 16 列。**

| IDX | 物理列 | 論理名 | 型 | 備考 |
|-----|--------|-------|----|------|
| 0 | A | `QUEUE_ID` | String | PK（UUID） |
| 1 | B | `CASE_ID` | String | FK |
| 2 | C | `STAFF_EMAIL` | String | 予約登録者メール |
| 3 | D | `STAFF_NAME` | String | 予約登録者名 |
| 4 | E | `MODE` | String | `initial` / `new` / `reply` / `schedule` / `decline` |
| 5 | F | `THREAD_ID` | String | 返信先スレッドID |
| 6 | G | `SUBJECT` | String | 件名 |
| 7 | H | `BODY` | String | 本文 |
| 8 | I | `CC` | String | CC |
| 9 | J | `BCC` | String | BCC |
| 10 | K | `TOOLS` | String | 対応ツール JSON |
| 11 | L | `SEND_AT` | Date | 送信予定日時（1分以上先） |
| 12 | M | `STATUS` | String | 旧値: `pending` / `sending` / `sent` / `failed` / `cancelled` / `skipped`。廃止後の未送信無効化: `disabled` |
| 13 | N | `ERROR` | String | 失敗時または廃止無効化時のメッセージ |
| 14 | O | `CREATED_AT` | Date | キュー登録日時 |
| 15 | P | `SENT_AT` | Date | 実際の送信完了日時 |

**廃止後のステータス更新:**
```
pending/sending → disabled（予約送信機能廃止により未送信のまま無効化）
```

---

### S-09: 案件キーマップ (Case Key Map) ※S1 Stage1 で新設

**用途:** 案件の不変サロゲートID `case_id` と自然キーの対応を一元管理し、サポート記録／案件補正／メール履歴／メール下書きの結合キーを安定化する。「管理アサイン後に完了しても未対応に戻る」バグの**根治**（不安定な日付PK `String(Date)` のTZ/型ブレ → 重複行 → 書込/表示のズレ）に向けた **expand-contract 移行の Expand 基盤**。

**現行状態（Stage1）:** シート・ヘルパー・診断・テストのみ導入。**どの既存経路からも呼ばれない（未接続）／本番挙動ゼロ変化**。Dual-write 接続は Stage2、本番データへの Backfill は Stage3（破壊的ステップのため実行前に必ず停止）。

**PK:** `案件ID`（`case_<epoch>`・決定的）
**全 5 列。**

| 物理列 | 論理名 | 型 | 備考 |
|--------|-------|----|------|
| A | 案件ID | String | `case_<epoch>`。同じ自然キーから常に同じID（決定的＝冪等バックフィル可） |
| B | 種別 | String | `form`（フォーム） / `manual`（手動追加） |
| C | 自然キー_正準化 | String | フォーム=`getTime()` の epoch 文字列 / 手動=`manual_<epoch>` |
| D | 正規化メール | String | `normalizeEmail_`（小文字化＋trim）。照会属性 |
| E | 作成日時 | Date | 登録日時 |

**一意制約:** `(種別, 自然キー_正準化)` を一意キーとする。スプレッドシートは UNIQUE を強制できないため、以下3点を**コードで強制**する。
1. 単一の `getOrCreateCaseId_(pkRaw, emailRaw)` に採番を集約（find-or-create）
2. `withScriptLock_`（LockService の単一グローバルロック）で find-or-create を不可分化
3. 重複検出・衝突解決を監査ログに記録（クロス種別epoch衝突時は連番サフィックス `_1` 等で回避）

**関連ヘルパー:** `canonicalNaturalKey_(pkRaw)`（正準化・パース不能は `null` で安全停止） / `buildCaseId_(epoch)` / `getOrCreateCaseKeyMapSheet_()` / 読み取り専用診断 `diagnoseCaseKeyMigration_()`（Backfill 前のリコンサイル基準）。

**Stage2 Dual-write（実装済・本番挙動ゼロ変化）:** 書込チョークポイント（`assignCase`/`reassignCaseAdmin`/`ensureRecordRowForCase_`/`recordEmail_`/`saveDraft`/`getOrCreateOverrideRowIndex_`/`addManualCase`）から `ensureCaseKeyMapping_(caseId, opt)`（非致死）を呼び、`resolveCaseNaturalSource_` で案件本体の生PK（フォーム=Date オブジェクト／手動=`manual_<epoch>`）と依頼者メールを権威解決して採番・登録する。`withScriptLock_` は再入ガード `_scriptLockHeld` を持ち、ロック内チョークポイントからの採番ネスト呼び出しでデッドロックしない。読み取り・FK列は不変。

**Stage3 Backfill（実装済・本番未実行）:** `backfillCaseKeyMap_(options)` が全既存案件をマップへ冪等投入する。既定 `dryRun:true` は計画のみ（書込ゼロ）。計画ロジック `planBackfill_` が既登録スキップ・バッチ内重複自然キー dedup・case_id 衝突の連番回避を行い、再実行しても重複行を作らない。実行（`dryRun:false`）は破壊的（本番データ追記）のため**実行前に必ず停止・ドライラン・復元手順確認**。管理画面（設定管理>メンテナンス）の公開エントリ `runCaseKeyMigrationDiagnosis()` / `runCaseKeyBackfill(dryRun)` から実行する。

**Stage4 Read 切替（実装済・フラグ既定OFF）:** 設定 `CASE_KEY_READ_VIA_MAP`（既定 `false`）で `getAllCasesJoined` の内部結合キーを `joinKeyForRead_(raw, viaMap)` 経由に切替える。ON 時は記録FK／メールCASE_ID／補正PK／案件PK を正準 `case_id` に揃えて結合し、日付PKの表記ブレによる結合ズレを解消する。表示用 `id`/`timestamp` は `String(PK)` のままで書込経路の FK 一致を壊さない。OFF では完全に従来挙動（ロールバックは `false` に戻すだけ）。Backfill 完了・監視後に有効化する。

**Stage5 Contract（未着手）:** 各シートの FK 列を `case_id` へ移行し、旧 `String(PK)` 突合・`joinKeyForRead_` のフォールバックを撤去する（破壊的）。

---

## 2. 上限値の優先順位

```
案件回数上限:  caseLimitOverride（案件特例）> masters.limits.caseSupport（全体設定）> 3（ハードコード）
年間利用上限: annualLimitOverride（案件特例）> masters.limits.annual（全体設定）> 10（ハードコード）
```

---

## 3. インターフェース仕様 (Function Specifications)

### F-01: `doGet()`
HTML を返す Web App エントリポイント。`getInitialData()` の結果を `window.__INITIAL_DATA__` として HTML に埋め込み、初回通信往復を削減する。

### F-02: `getInitialData()`
起動時データ取得。`user` / `cases` / `masters` / `draftCaseIds` / `forcedCc` を返す。`ensureAttachmentSchema_()` でスキーマ自動マイグレーションを実行する。

### F-03: `getAllCasesJoined()`
案件リスト + 案件手動追加 + 案件補正 + サポート記録 + メール履歴を結合し、削除済み案件を除外して返す。各案件に `currentFiscalYearCount`（今年度累計利用回数）を付与する。

**年度計算:** 4月1日始まり。同一 `EMAIL`（正規化）かつ同一年度の `inProgress`/`completed` 案件の `supportCount` を合算。集計キーは `annualUsageKey_(email, pk)` = `normalizeEmail_(email) + '_' + caseFiscalYear_(pk)` で統一。`caseFiscalYear_()` は手動追加案件のPK `manual_<エポックミリ秒>` も申込日年度へ正しく解決するため、**Googleフォーム申込と管理者の手動追加案件が同一メール+年度で合算される**（v1.12.3）。

### F-04: `assignCase(caseId, user, tools)`
案件アサイン（メール送信なし）。サポート記録が無ければ新規作成（`inProgress`, `supportCount=1`）、あれば更新。

### F-05: `assignAndSendEmail(caseId, user, subject, body, cc, bcc, tools)`
アサイン + 初回メール送信。Gmail API でスレッドを開始しスレッドIDを保存。メール履歴に記録。

### F-06: `updateSupportRecord(recordData)`
記録更新。カレンダー連携（Meet/Zoom）、ステータス変更、添付ファイル更新（最大5件）。

### F-07: `reopenCase(caseId, user)`
完了案件の再開。現在回の記録を HISTORY に保存 → `supportCount+1` → `inProgress` に変更 → DATE/METHOD/CONTENT/REMARKS/EVENT_ID/MEET_URL/ATTACHMENTS をクリア。`supportCount >= caseLimit` の場合はエラー。

### F-08: `rollbackCurrentRound(caseId)`
2回目以降の対応回を取り消し、前回の完了状態に復元。1回目はエラー。担当者・サブ担当・管理者が実行可能。

### F-09: `cancelCase(caseId)`
案件をキャンセル（`cancelled`）。担当者・サブ担当・管理者が実行可能。未アサイン案件は管理者のみ。

### F-10: `declineCase(caseId, user, subject, body, cc, bcc)`
回数超過メール送信 → ステータスを `rejected` に変更。

### F-11: `sendNewCaseEmail(caseId, user, subject, body, cc, bcc)`
新規スレッドを開始してメール送信。

### F-12: `sendCaseEmail(caseId, user, subject, body, threadId, cc, bcc)`
既存スレッドに返信。`threadId` 未指定の場合は新規スレッドとして保存。

### F-13: `getThreadMessages(caseId)`
案件の全 Gmail スレッドのメッセージを取得。スレッドIDが無い場合はメール履歴シートからフォールバック表示。
戻り値: `[{ threadId, subject, messages: [{ sendDate, senderName, fromEmail, subject, body, isStaff }] }]`

### F-14: `getMasters()`
マスタデータ取得。`methods`, `businessTypes`, `prefectures`, `allStaff`, `limits`, `supportTools`, `toolMonthlyLimits`, `emailTemplates`, `attachmentFolderConfigured`, `spreadsheetUrl` を返す。

### F-15: `getStaffByEmail(email)`
メールアドレスからスタッフ情報を取得。

### F-16: `getAdminPanelData()`
管理パネル用初期データ（スタッフ一覧・編集可能設定・監査ログ）。管理者のみ実行可能。

### F-17: `upsertStaffMember(payload)`
既存スタッフのロール更新。`{ email, role }` を受け取る。管理者のみ。新規追加は不可（タダメンマスタは外部管理）。

### F-18: `deactivateStaffMember(email)`
スタッフを論理無効化（`IS_ACTIVE=false`）。管理者のみ。

### F-19: `updateSettingsAdmin(patch)`
許可された設定キーのみ更新。ホワイトリスト外のキーは拒否。管理者のみ。

### F-20: `reassignCaseAdmin(caseId, staffEmail)`
管理者による再アサイン。有効なスタッフのみ指定可能。

### F-21: `setCaseStatusAdmin(caseId, status)`
管理者による任意ステータス直接変更。レコードが存在しなければ新規作成。監査ログに記録。

### F-22: `updateCaseDataAdmin(caseId, payload)`
管理者による案件データ直接編集。`hasOwnProperty` チェックによるスパース更新。`caseLimitOverride` / `annualLimitOverride` に `null` を指定すると全体設定に戻す。監査ログに記録。

### F-23: `addManualCase(payload)`
管理者による新規案件手動追加。PK は `manual_` + エポックミリ秒。

### F-23b: `setAnnualUsageCountAdmin(caseId, desiredCount)`（v1.12.4）
管理者による「今年度利用数（実数）」の手動修正。`caseId` から メール+年度 を解決し、`補正量 = desiredCount − base`（base は補正抜きの自動計算値）を `年間利用補正` シートへ upsert する。同一メール+年度の全案件の表示に反映。`desiredCount` は0以上の整数。監査ログ（`set_annual_usage_count`）に記録。

### F-24: `deleteCaseAdmin(caseId)`
管理者による案件ソフトデリート。`DELETED_CASE_IDS` 設定にIDを追記。

### F-25: `updateSubStaff(caseId, subStaffArray)`
サブ担当（OJT）の追加・変更（最大1名）。

### F-26: `updateMeetUrl(caseId, newUrl)`
Meet/Zoom URL 変更 + カレンダーイベントの説明欄を同期更新。

### F-27: `updateSupportHistory(caseId, roundIndex, patch)`
過去回（HISTORY JSON 内）の記録を編集。

### F-28: `createGoogleMeetEvent(title, startTime, description, durationMinutes)`
Google カレンダーに Meet 付きイベントを作成。説明欄にアプリ URL を追記。

### F-29: `createZoomMeeting(title, startTime, durationMinutes)`
Zoom Server-to-Server OAuth でミーティングを作成。Zoom API 失敗時もカレンダー作成は続行する（分離設計）。

### F-30: `verifyCcDryRun()`
CC 設定のドライラン検証。`MAIL_DRY_RUN=true` が前提。

### F-31: `saveDraft(payload)` ※v1.11.0
メール下書きを保存（`CASE_ID + STAFF_EMAIL + MODE + THREAD_ID` の複合キーで上書き）。

### F-32: `loadDraft(caseId, mode, threadId)` ※v1.11.0
下書きを読み込む。該当なしの場合は `null` を返す。

### F-33: `deleteDraft(caseId, mode, threadId)` ※v1.11.0
指定した下書きを削除する。

### F-34: `listDraftsForCase(caseId)` ※v1.11.0
案件に紐づく下書き一覧を返す（現在ユーザー分のみ）。

### F-35: `scheduleEmail(payload)` ※v1.12.1廃止
予約送信機能は廃止済み。呼び出された場合はエラーを返し、キュー登録しない。

### F-36: `cancelScheduledEmail(queueId)` ※v1.12.1廃止
予約送信機能は廃止済み。フロントエンドからは呼び出さない。

### F-37: `listScheduledForCase(caseId)` ※v1.12.1廃止
後方互換のため空配列を返す。

### F-38: `processScheduledEmails_()` ※v1.12.1互換
旧時間主導トリガーが残存していてもメール送信しない。`disablePendingScheduledEmails_()` を呼び、未送信キューを `disabled` に更新する。

### F-39: `setupScheduledEmailTrigger()` ※v1.12.1廃止
新規トリガーは作成しない。既存の `processScheduledEmails_` トリガーを削除する。

### F-40: `disablePendingScheduledEmails()` ※v1.12.1追加
既存の `pending` / `sending` 予約を `disabled` に更新するクリーンアップ関数。メール送信・案件ステータス更新は行わない。

---

## 4. セキュリティ仕様 (Security Specifications)

### SEC-01: 認証
実行ユーザーのメールアドレスがタダメンマスタに存在しない・無効の場合、全処理をブロックしエラーを返す。

### SEC-02: 管理者権限
権限判定はバックエンドで強制する。`ROLE=admin` を優先し、後方互換として `ADMIN_EMAILS` も管理者判定に利用。管理者操作は監査ログへ記録する。

### SEC-03: アクセス制御
- **通常モード:** 自分の担当案件のみ表示・操作可能（未対応は全員共有）
- **閲覧モード:** 全案件を表示するが書き込み操作不可
- **管理モード:** 全案件表示 + 管理者専用操作が可能

### SEC-04: 年間制限ガード
`currentFiscalYearCount` が年間上限以上の案件に対し、アサインボタンを非表示にして「回数超過」ボタンのみ表示する。

### SEC-05: 案件回数制限
`supportCount` が案件上限に達した案件は再開不可。上限到達バッジを表示する。

### SEC-06: スレッド操作権限
`ensureCaseEditableByActor_()` により、担当者・サブ担当・管理者以外による更新を拒否する。

---

## 5. UI仕様 (UI Specifications)

### UI-01: 表示モード切替（3ボタン式）

| モード | `isDashboardMode` | `isAdminMode` | 表示範囲 | 操作 |
|--------|------------------|---------------|---------|------|
| 通常 | false | false | 自分担当のみ（未対応は全員） | 全操作可能 |
| 閲覧 | true | false | 全案件 | 読み取りのみ |
| 管理 | true | true | 全案件（管理者のみ） | 全操作 + 管理専用 |

### UI-02: 案件一覧タブ（6タブ）

`未対応` / `対応中` / `完了` / `キャンセル` / `対応不可` / `全て`

各タブに新着バッジ（`+N`）を表示。ID差分方式（ADR-006参照）。

### UI-03: 検索・フィルタ

- キーワード検索（常時表示）: 事業所名・担当者名・メール・内容・種別・都道府県の横断検索
- アクティブフィルタチップ: 適用中の条件を pill 形式で一覧表示・個別削除可能
- 詳細フィルタ（アコーディオン）: 期間プリセット（今月/先月/今年度/前年度）・カスタム期間・都道府県・サービス種別・並び順・担当者フィルタ（管理モード）・対応ツールフィルタ

**日付変換注意:** `toISOString()` はUTC変換でJST+9ずれが発生する。`getFullYear()/getMonth()/getDate()` でローカル時間フォーマットを使用すること。

### UI-04: 管理モード インライン編集

| クリック箇所 | 操作 | API |
|------------|------|-----|
| ステータスバッジ | ドロップダウンで変更 | `setCaseStatusAdmin` |
| 担当者バッジ | 検索絞り込みドロップダウン | `reassignCaseAdmin` |
| 案件回数（n/上限） | 特例上限を入力（空欄でリセット） | `updateCaseDataAdmin` |
| 今年度利用数（n/上限） | 利用回数（実数）を直接入力 + 年度上限特例を入力 | `setAnnualUsageCountAdmin` / `updateCaseDataAdmin` |

共通: `fixed inset-0 z-40` オーバーレイ。外側クリック・Escape で閉じる。案件切替で自動クリア。

### UI-05: メール下書き機能（v1.11.0）

- メール作成モーダルを開くと `loadDraft()` で下書きを確認し、存在する場合は復元プロンプトを表示
- 「下書き保存」ボタンで `saveDraft()` を呼び出し（case/mode/thread 単位で上書き）
- 送信成功後に `deleteDraft()` で下書きを自動削除
- 案件一覧に「下書きあり」バッジを表示（`draftCaseIds` セット）

### UI-06: メール予約送信機能（v1.12.1廃止）

- メール作成モーダルから「予約送信」ボタン、日時ピッカーを撤去
- 案件一覧の「予約あり」バッジ、案件詳細の予約送信一覧を撤去
- メール送信は即時送信のみ。送信前の一時保存は `UI-05` の下書き保存を使用する
- 旧予約キューの未送信行は `disablePendingScheduledEmails()` で `disabled` に更新する

### UI-07: 添付ファイル

- アップロード方式: ファイル選択 + ドラッグ&ドロップ
- 1回の報告（現在回）につき最大5件
- 記録編集時は既存添付の削除と新規追加を組み合わせ可能

### UI-08: 新着バッジ

- 計算方式: ID差分方式（ADR-006）。`localStorage` に保存した既読IDセットと現在IDセットの差分をカウント
- 通常モード: 自分担当ケースのみ。管理モード: 全件。閲覧モード: 非表示
- localStorage キー: `tadasapo_seenIds_{userEmail}` / `tadasapo_showNewBadge`

---

## 6. 技術スタック制約 (Technical Constraints)

### TC-01: ライブラリバージョン固定（ADR-004）

```json
{
  "react": "https://esm.sh/react@18.2.0",
  "react-dom/client": "https://esm.sh/react-dom@18.2.0/client?deps=react@18.2.0",
  "lucide-react": "https://esm.sh/lucide-react@0.330.0?deps=react@18.2.0"
}
```

React 19系混在で `Minified React error #31` が発生するため固定。

### TC-02: GAS 実行環境

- ランタイム: V8
- タイムゾーン: `Etc/GMT-9`（JST）
- 有効サービス: Gmail API v1 / Calendar API v3
- Webapp: `executeAs: USER_ACCESSING` / `access: DOMAIN`
- OAuth スコープ: mail / calendar / drive / spreadsheets / userinfo.email / script.external_request / script.scriptapp

### TC-03: Babel in-browser

- JSX を Babel standalone でブラウザ内トランスパイル
- ESM import は importmap 経由
- `type="text/babel" data-type="module" data-presets="react"`

---

## 7. バージョン履歴

| バージョン | 主な変更内容 |
|:----------|:-----------|
| v1.8.1 | 初版リリース。案件一覧4タブ、担当アサイン、日程確定、完了報告、添付機能、管理者モード基盤 |
| v1.8.2 | 利用制限設定化、`setCaseStatusAdmin` / `updateCaseDataAdmin` 追加、案件単位上限特例 |
| v1.8.3 | 通常/閲覧/管理 3モードボタン化、検索条件拡張、権限管理・設定管理ダイアログ分離 |
| v1.9.0 | 検索UI刷新（常時表示・チップ型フィルタ・期間プリセット）、管理インライン編集、新着バッジ |
| v1.9.x | 対応ツール機能、キャンセルステータス、サブ担当（OJT）、CC自動設定、パフォーマンス最適化、ロールバック機能 等 |
| v1.10.0 | 完了報告時にサービス種別・都道府県を入力可能に、全モーダルスクロール対応 |
| v1.10.1 | カレンダーイベント作成時にアプリURLを説明欄に追記 |
| v1.10.2 | Zoom会議作成とカレンダー作成を分離（Zoom API失敗時もカレンダー作成） |
| v1.10.3 | Zoom選択時にタダスク利用確認の注意メッセージを追加 |
| v1.11.0 | メール下書き保存（S-07）＋予約送信（S-08）機能を追加。LockService による並行実行防止 |
| v1.11.1 | 新規案件追加モーダルのスマホ送信バグ修正 |
| v1.11.2 | 下書き保存・予約送信ボタンの押下フィードバック追加、MAIL_FORCE_CC を state に追加 |
| **v1.11.3** | メール作成画面に自動CC（MAIL_FORCE_CC）の説明を追加 |
| **v1.12.1** | 予約送信機能を廃止。旧トリガー互換は未送信キューを `disabled` 化し、即時送信・下書き保存は継続 |
