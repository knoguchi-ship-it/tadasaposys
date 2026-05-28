# Changelog

## [Unreleased]

### Documentation
- グランドルールに DRY 原則、影響範囲確認、コード/ドキュメント整合、セキュアコーディング5視点、ハードコーディング禁止、機密情報管理、HTML形式のER図/テーブル設計書、人間向けドキュメント維持、文字化け修正を追加
- バージョン同期対象に `index.html` を明記
- グランドルールを「判断基準 + 作業チェックリスト」の2層構造に再編
- プロジェクト共有の Codex 起動設定 `.codex/config.toml` とランチャー `codex-tadasaposys.ps1` を追加
- プロジェクト共有の Claude 起動設定 `.claude/settings.json` とランチャー `claude-tadasaposys.ps1` を追加
- ドライランテスト後は作成・更新したテストデータを必ず削除または復元し、テスト前状態へ戻すルールを追加
- `HANDOVER.md` を引継ぎ最終準備版に更新し、2026/05/28 の整備内容と次作業優先順位を反映

---

## [1.12.1] - 2026-05-28

### Removed
- **メール予約送信機能を廃止**
  - メール作成モーダルの「予約送信」ボタン、日時指定 UI、案件一覧の「予約あり」バッジ、案件詳細の予約送信一覧を撤去
  - `getInitialData()` の `scheduledCaseIds` 返却を廃止
  - 即時メール送信、スレッド返信、回数超過メール、下書き保存は継続

### Changed
- 旧予約送信 API は後方互換スタブ化し、新規予約登録・自動送信を行わない
- 残存する `processScheduledEmails_` トリガーが起動してもメール送信せず、未送信予約を `disabled` に更新
- `setupScheduledEmailTrigger()` は新規トリガーを作成せず、既存予約送信トリガーを削除する
- 未送信予約の明示的な無効化用に `disablePendingScheduledEmails()` を追加

### Reason
- Apps Script の時間主導トリガーは作成者アカウントで実行されるため、予約送信では Web アプリのアクセスユーザー本人からの Gmail 送信を保証できない。

---

## [1.12.0] - 2026-05-11

### Added — 日程確定刷新 Phase 4 / 仕上げ
- **「いつものタダスクID」（固定Zoom）モード追加**
  - method=Zoom 選択時に「新規発行 / いつものタダスクID」のラジオボタン表示
  - 固定モードでは Zoom API を呼ばず `ZOOM_FIXED_URL` を再利用（API節約・高速）
  - 設定未完了時はラジオが非活性化され注意書き表示
  - カレンダーイベント説明欄に「【いつものタダスクID】URL（ID/PASS）」をプレフィックス
- `getMasters()` に `zoomFixedConfigured` フラグ追加（フロントUI判定用）

### Changed
- v1.11.9-r2 修正取り込み：
  - 重複チェック発動条件を **method=Zoom 時のみ** に限定
  - カレンダー上の既存予定の文字色を白に変更（視認性向上）

### Documentation
- `Manual.md` を v1.12.0 に更新（日程確定の新フロー説明）
- `SDD.md` を v1.12.0 に更新（IDX定数・新キー・新関数）
- `HANDOVER.md` を v1.12.0 に更新（実装サマリ・運用注意点）
- `CLAUDE.md` の現行バージョンを v1.12.0 に更新

### Notes
- v1.11.7〜v1.12.0 は連続リリース（日程確定刷新の4フェーズ）
- 既存運用への影響は v1.11.8 の挙動変更のみ（Zoom時のチームカレンダー強制登録 + 重複ブロック）
- Phase 1〜4 すべてで Webapp URL は不変（同一 deploymentId へのバージョンアップ）

---

## [1.11.9] - 2026-05-11

### Added — 日程確定刷新 Phase 3（FullCalendar 埋込み）
- 日程確定モーダルに **FullCalendar 6.1.18 グローバルバンドル** を埋込み
  - importmap ではなく `<script>` タグで CDN 直リンク（React 18.2.0 制約と独立）
  - core / daygrid / timegrid / interaction が同梱
- `ScheduleAvailabilityCalendar` コンポーネント新規追加
  - 週ビュー / 月ビュー切替
  - チームカレンダー（黄色） + 表示専用カレンダー（赤色）でカテゴリ色分け
  - **ドラッグで時間枠を選択** → `editFormData.scheduledDateTime` と `duration` が自動反映
  - 既存予定の前後 `SCHEDULE_BUFFER_MIN` 分は **斜線パターン** でバッファ表示
  - 自分の編集対象（excludeEventId）は表示から除外
  - `nowIndicator` で現在時刻を視覚化
- モーダル幅を schedule モード時のみ `max-w-lg` → `max-w-4xl` に拡大
- 既存の `datetime-local` 入力も併存（A11y / キーボード操作互換）
- `Api.getScheduleAvailability(rangeStart, rangeEnd)` 追加（IS_LOCAL モック付き）

### Internal
- カスタムCSS追加（`.schedule-cal`, `.buffer-bg`, `.draft-bg`）
- view 切替時に events を再フェッチ（FullCalendar 標準の events 関数経由）

### Notes
- 既存運用への影響: なし（純粋追加機能）
- バンドルサイズ: ~200KB 増（CDN キャッシュ後は問題なし）
- Phase 4 で固定Zoomラジオ + ドキュメント更新の上、v1.12.0 リリース予定

---

## [1.11.8] - 2026-05-10

### Added — 日程確定刷新 Phase 2（重複検知 + Zoom チームカレンダー強制登録）
- **日程重複検知（バッファ込み）**
  - 日程確定モーダルにライブ重複検知（500ms debounce）
  - チームカレンダー＋表示専用カレンダー（タダスク等）と前後 `SCHEDULE_BUFFER_MIN` 分のバッファ込みで判定
  - 重複時は赤帯バナーで重複先を一覧表示し、Submitボタンを `disabled` 化（送信ブロック）
  - サーバー側でも書込み直前に再チェック（楽観ロック）
  - 編集時は自分自身の `eventId` を除外して誤判定を防止
- **method=Zoom 時のチームカレンダー強制登録**
  - useCalendar チェックボックスの状態に関わらず、`TEAM_CALENDAR_ID` に必ず登録
  - 個人/共有カレンダーへの登録は useCalendar=ON 時に追加（チームと同一ID時は二重登録回避）
  - Zoom URL も S2S OAuth で自動発行（既存ロジック維持）
- **UI改修**
  - method=Zoom 時に専用の説明バナー表示（「チームカレンダーへ自動登録（必須）」）
  - チェックボックスのラベルを動的変更（Zoom時=「個人/共有カレンダーにも登録する」）
  - 検知中/OK/重複/エラーの4状態をビジュアル化

### Internal
- `createTeamCalendarEvent_()`: チームカレンダー登録ヘルパー
- `formatScheduleConflictMessage_()`: 重複エラーメッセージ整形
- `Api.checkScheduleConflict()`: フロント用ライブチェック（ローカルモック対応）
- `conflictState` 状態を `App` に追加（`idle`/`checking`/`ok`/`conflict`/`error`）

### Notes
- **既存挙動の変更点**
  - method=Zoom + useCalendar=OFF: 旧→何もしない / 新→チームカレンダーには登録（重複防止）
  - 重複検知された日程: 旧→そのまま登録 / 新→送信ブロック
- GoogleMeet/電話/対面/メール等は変更なし
- Phase 3 で FullCalendar を埋込み、視覚的な空き状況確認を追加予定

---

## [1.11.7] - 2026-05-10

### Added — 日程確定・変更の刷新（Phase 1: バックエンド土台）
- 設定シートに6キー追加（既存環境向けマイグレーション関数 `addScheduleZoomSettings()`）
  - `TEAM_CALENDAR_ID`: チームカレンダーID（書込み先）
  - `DISPLAY_CALENDARS_JSON`: 重複監視する読取専用カレンダー（JSON配列）
  - `SCHEDULE_BUFFER_MIN`: 予約前後インターバル（分、デフォ30）
  - `ZOOM_FIXED_URL` / `ZOOM_FIXED_ID` / `ZOOM_FIXED_PASS`: 「いつものタダスクID」用固定Zoom
- バックエンド関数追加（`コード.js`）
  - `getScheduleAvailability(rangeStart, rangeEnd)`: チーム+表示専用カレンダーのイベント統合取得（Phase3で利用）
  - `checkScheduleConflict(start, durationMin, excludeEventId)`: バッファ込み重複判定
  - 純粋関数 `eventsOverlap_()` / `computeBufferedWindow_()` / `parseDisplayCalendarsJson_()`
  - 設定ヘルパー `getScheduleBufferMin_()` / `getTeamCalendarId_()` / `getDisplayCalendars_()`
- 単体テスト 21件追加（合計34→55）
  - `parseDisplayCalendarsJson` / `eventsOverlap` / `computeBufferedWindow` / `parseScheduleBufferMin`
- `getEditableSettingsKeys_()` に6キーを追加し、管理者設定ダイアログから編集可能に
- `setupSettingsSheet()` に「#日程・予約管理」カテゴリを追加（新規セットアップ時）

### Notes
- Phase 1 では Zoom 発行ロジックは未変更。Phase 2 で `createZoomMeeting_()` を強化し、固定IDモードと統合予定
- 既存運用の影響なし（新キーは未参照、新関数は未呼出し）
- **自動マイグレーション**: SCHEMA_VERSION_ を 5→6 にアップ、`ensureAttachmentSchema_()` から `addScheduleZoomSettings()` を自動呼出し。次回アプリ起動時に設定シートへ自動追加される（手動実行不要）

---

## [1.11.6] - 2026-05-10

### Fixed
- **管理機能ステータス遷移バグ完全修正**（11件の致命的・重大バグ）
  - `adminTransitionStatus_()` を新設し、全管理者経由のSTATUS変更を統一処理
  - `completed → inProgress`: HISTORY保存 + supportCount+1 + フィールドクリア（reopenCase相当）
  - `→ unhandled`: STAFF/DATE/METHOD/CONTENT/REMARKS/MEET_URL/ATTACHMENTS/TOOLS/SUB_STAFF を全クリア
  - `reassignCaseAdmin`: unhandled以外では STATUS を変更しない（旧: 常にinProgressに強制）
  - `updateCaseDataAdmin` の `status`: `adminTransitionStatus_()` 経由に変更
  - `scheduledDateTime`: フロントで空欄時はpayloadから除外（日程の誤消去防止）
  - `supportCount`: フロントで空欄時はpayloadから除外（誤リセット防止）
  - `applyCaseTransitionResult()` 追加: API戻り値で全フィールドを正確に楽観的更新

### Added
- `completed → inProgress`（管理者経由）で上限超過時は `caseLimitOverride` を自動 +1
- `adminTransitionStatus_()` が戻り値で全変更フィールドのサマリを返す

### Fixed (インフラ)
- `.claspignore` に `node_modules/`・テスト関連ファイルを追加（clasp push エラー修正）

---

## [1.11.5] - 2026-05-10

### Added
- **GitHub Actions CI**: `.github/workflows/playwright.yml` を追加（ubuntu-latest / Node22 / 失敗時アーティファクト保存）
- **Jest 単体テスト（34テスト）**: `getFiscalYear` / `sanitizeForSheet_` / `parseNullablePositiveInteger_` / `normalizeEmail_` / `parseBoolean_` 等のビジネスロジック

### Fixed
- **WCAG 2.1 AA color-contrast 全違反修正**: `text-slate-400→text-slate-500`（91件）、新着バッジ `bg-rose-500→bg-rose-600`、月間件数バッジ等
- `07-a11y.spec.ts` から `disableRules(['color-contrast'])` を削除（8/8 PASS 確認）

### Changed
- `コード.js`: 関数内 `var` 795件を `let` に移行（top-level GAS グローバル 10件は `var` 維持）
- `docs/HANDOVER.md`: リファクタリングロードマップ（§8）を追記

---

## [1.11.4] - 2026-05-10

### Security
- **数式インジェクション対策** (OWASP A03:2025): `sanitizeForSheet_()` ヘルパーを追加。`=` `+` `-` `@` で始まる文字列に先頭アポストロフィを付与し、スプレッドシート数式として実行されることを防止。影響範囲: `updateSupportRecord` / `addManualCase` / `updateCaseDataAdmin` / `updateSettingsAdmin`
- **Babel CDN バージョン固定 + SRI**: `@babel/standalone` を未バージョン指定から `@7.29.4` に固定し、SRI (sha384) ハッシュと `crossorigin` 属性を追加

### Fixed
- `コード.js` ヘッダーコメントのバージョン表記を v1.11.1 → v1.11.3 に修正

---

本ドキュメントは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) 形式に準拠する。
バージョン番号は [Semantic Versioning](https://semver.org/) に基づく（Minor = 機能追加、Patch = バグ修正・改善）。

---

## [1.11.3] - 2026-04-20

### Changed
- メール作成画面に自動CC（`MAIL_FORCE_CC`）の説明テキストを追加

---

## [1.11.2] - 2026-04-20

### Added
- 下書き保存ボタン・予約送信ボタンに押下フィードバック（スピナー表示）を追加
- `MAIL_FORCE_CC`（自動CC）を React state に追加し、メール作成画面で参照可能に

---

## [1.11.1] - 2026-04-20

### Fixed
- 新規案件追加モーダルでスマートフォンから送信できない不具合を修正（`appsscript.json` に `script.scriptapp` スコープを追加）

---

## [1.11.0] - 2026-04-20

### Added
- **メール下書き保存機能**: メール作成モーダルで「下書き保存」ボタンを追加。`case/mode/thread` 単位でスプレッドシート（メール下書きシート・11列）に保存。モーダル再表示時に自動復元プロンプトを表示
- **メール予約送信機能**: 日時を指定してメールを予約送信できる機能を追加。スプレッドシートのキュー（予約送信キューシート・16列）に保存し、5分間隔のGASトリガ（`processScheduledEmails_`）で自動配信。`LockService` による並行実行防止を実装
- **スタック復旧**: `sending` 状態のまま10分以上経過した予約は自動再処理
- **バッジ表示**: 案件一覧に「下書きあり」「予約あり」バッジを追加
- `setupScheduledEmailTrigger()` / `removeScheduledEmailTrigger()` / `getScheduledEmailTriggerStatus()` 関数を追加

### Changed
- `getInitialData()` の戻り値に `draftCaseIds`・`scheduledCaseIds`・`forcedCc` を追加

---

## [1.10.3] - 2026-04-18

### Added
- 対応方法で「Zoom」を選択した際に、タダスク利用確認の注意メッセージを表示

---

## [1.10.2] - 2026-04-18

### Changed
- Zoom 会議作成とカレンダーイベント作成を分離。Zoom API が失敗してもカレンダーイベントは必ず作成される
- `eventId` にカレンダーイベントIDを使用するよう変更（Zoom ミーティングIDから変更）
- Zoom 選択時のUIメッセージを実態に合わせて修正

---

## [1.10.1] - 未記録

### Added
- カレンダーイベント作成時、説明欄にアプリ URL を自動追記

---

## [1.10.0] - 未記録

### Added
- 完了報告時にサービス種別・都道府県を入力・修正可能に

### Changed
- 全モーダルにスクロール対応を追加（長いコンテンツが画面内に収まるよう改善）

---

## [1.9.99] - 未記録

### Reverted
- ファビコンを元の「T」アイコン（SVGデータURI）に戻す（GAS制限でカスタムファビコンが本番反映不可のため）

---

## [1.9.98] - 未記録

### Changed
- ファビコンをヘッダーロゴの Activity アイコンに変更（後に Reverted）

---

## [1.9.97] - 未記録

### Fixed
- モーダルタイトルの文字化けを修正

---

## [1.9.96] - 未記録

### Added
- キャンセル時に理由を記録できるモーダルを追加
- 1回目のキャンセルのみキャンセルモーダルを表示するよう変更

---

## [1.9.95] - 未記録

### Changed
- 担当者・サブ担当もキャンセル操作が可能に（従来は管理者のみ）

---

## [1.9.94] - 未記録

### Added
- 2回目以降の対応回を取り消して前回完了状態に戻す「ロールバック」機能を追加（`rollbackCurrentRound`）

---

## [1.9.93] - 未記録

### Fixed
- データ抽出で改行を含むセルがレコード崩れを起こす問題を修正

---

## [1.9.92] - 未記録

### Changed
- サービス種別・都道府県が未入力の案件詳細で視覚的に強調表示

---

## [1.9.91] - 未記録

### Added
- 新規メール送信に件名テンプレート（`MAIL_NEW_SUBJECT`）を追加

---

## [1.9.85〜1.9.90] - 未記録

### Changed
- ツール月間上限のカウントを対応日ではなく申込日ベースに変更
- 管理者編集フォームに担当者サジェスト・対応時間フィールドを追加
- 設定管理メールタブの並び順をグループ化して整理

---

## [1.9.78〜1.9.84] - 未記録

### Added
- 当月の依頼件数バッジをケースリスト上部に追加
- アプリ内ヘルプ（操作マニュアル）を追加

### Fixed
- Meet URL 変更時のカレンダー同期
- ツール月間利用数カウントのバグ修正
- タブ配色を統一

---

## [1.9.70〜1.9.77] - 未記録

### Added
- 過去対応記録の編集機能
- カレンダー連動強化（日時・URL変更時の同期）

### Changed
- 完了タブの日付表示形式を変更

---

## [1.9.64〜1.9.69] - 未記録

### Added
- 案件削除機能（管理者専用、ソフトデリート）
- 操作中のグレーアウト＋スピナー表示

### Changed
- パフォーマンス全面最適化（楽観的更新・初期データHTML埋め込み・フロントメモ化）

---

## [1.9.58〜1.9.63] - 未記録

### Added
- サブ担当（OJT）機能（最大1名、検索サジェスト付き、`SUB_STAFF` 列）
- メール送信時にサブ担当⇔メイン担当を CC に自動設定
- Meet/Zoom URL のコピーボタン追加

---

## [1.9.49〜1.9.57] - 未記録

### Added
- 管理者向けデータ抽出機能（都道府県・事業所名、項目選択UI）

### Changed
- タブ並び順調整
- 完了案件の実施日ソート
- 管理者編集フォームを拡張

---

## [1.9.42〜1.9.48] - 未記録

### Added
- CC/BCC の任意追加機能
- ツール月間上限機能
- ツール月間利用数バッジ（サイドバー）

---

## [1.9.36〜1.9.41] - 未記録

### Added
- 「全て」タブを追加
- キャンセルステータス（`cancelled`）を追加
- 対応方法に「メール等」を追加

### Fixed
- 設定シート修復関数を追加

---

## [1.9.29〜1.9.35] - 未記録

### Added
- 対応ツール選択機能（`TOOLS` 列）
- 対応ツールフィルター
- 対応ツールの設定管理UI

---

## [1.9.17〜1.9.28] - 未記録

### Added
- 処理中スピナー表示
- 管理モードでの日時直接編集

### Fixed
- 完了報告で対応日時なしでも入力可能に
- 日付表示のタイムゾーンを JST 固定に修正（`toISOString()` のUTCずれを解消）

---

## [1.9.11〜1.9.16] - 未記録

### Added
- 新規案件の手動追加機能（管理モード）
- 都道府県を47都道府県に拡張
- 対応記録・備考内の URL 自動リンク化

### Fixed
- 案件リストの重複PK除去
- カード並び順の修正

---

## [1.9.0] - 2026-02-23

### Added
- 検索UI刷新（常時表示キーワード・チップ型フィルタ・期間プリセット・並び順）
- 管理モード インライン編集（ステータス・担当者・上限をクリック変更）
- 新着バッジ（タブごとの未読件数、ID差分方式、管理モードでON/OFF可能）

---

## [1.8.3] - 2026-02-20

### Added
- 表示モード切替（通常/閲覧/管理 の3ボタン式）
- 権限管理・設定管理の専用ダイアログ分離

### Changed
- 検索条件を都道府県・サービス種別・担当状況に拡張

---

## [1.8.2] - 2026-02-20

### Added
- 年間利用制限・案件回数制限を設定シートで変更可能に
- `setCaseStatusAdmin`（管理者による任意ステータス変更）
- `updateCaseDataAdmin`（管理者による案件データ直接編集）
- 案件・年度ごとの上限特例設定（`CASE_LIMIT_OVERRIDE` / `ANNUAL_LIMIT_OVERRIDE` 列）

---

## [1.8.1] - 2026-02-19

### Added
- 初版リリース
- 案件一覧（未対応/対応中/完了/対応不可 の4タブ）
- 担当アサイン（メール付き / メールなし）
- 日程確定（Google カレンダー連携 + Meet URL 発行）
- 完了報告・記録修正
- 完了報告/記録修正でのファイル添付（D&D対応、最大5件）
- 案件再開（最大N回、履歴JSON保存）
- 年間利用制限（10回/年度）・案件回数制限（3回）
- 回数超過メール送信 → 対応不可（`rejected`）
- メール機能（初回/日程確定 の2モード）
- 管理者モード基盤（スタッフ管理・設定編集・監査ログ）
