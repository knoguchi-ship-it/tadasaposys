# 運用手順書 (RUNBOOK) — タダサポ管理システム v1.12.13

**対象者:** 開発者・システム管理者
**最終更新:** 2026/11/25

---

## 🔒 グランドルール（絶対厳守）

グランドルール（本番安全・データ保全・セキュリティ・実装品質・既存機能保護・ドキュメント）と、コマンド実行ポリシー・作業前レビュー・変更手順の**正本はリポジトリ直下の `AI_RULES.md`**。本書には書き写さない（二重管理によるずれを防ぐため。2026-11-25 一本化）。

運用者が特に押さえる点（詳細・理由は `AI_RULES.md`）:
- Webapp は `executeAs: USER_ACCESSING` / `access: DOMAIN` 固定。デプロイは固定 deploymentId への `-i` 付き更新のみ
- `clasp push` / `clasp deploy` / `git push` は、AI が実行する場合もユーザーの確認を得てから
- 本番の識別子・認証情報・個人名は、公開リポジトリ（文書・コード・テスト）に書かない
- ステージング環境は設けない。検証はローカル＋テストで行い、反映後に本番URLで確認する

---

## 1. セットアップ（新規環境構築）

### 1-0. Codex 起動設定

このリポジトリでは、プロジェクト共有の Codex 起動方針を `.codex/config.toml` に保存する。Codex CLI は任意のリポジトリ設定を自動読込しないため、開発時は以下のランチャーを使う。

```powershell
.\codex-tadasaposys.ps1
```

このランチャーは、作業ディレクトリを本リポジトリに固定し、`workspace-write` / `on-request` / `approvals_reviewer=auto_review` を付与して Codex を起動する。

### 1-0-1. Claude 起動設定

このリポジトリでは、プロジェクト共有の Claude Code 起動方針を `.claude/settings.json` に保存する。`--dangerously-skip-permissions` フラグそのものをリポジトリ設定だけで自動付与できる保証はないため、開発時は以下のランチャーを使う。

```powershell
.\claude-tadasaposys.ps1
```

このランチャーは、作業ディレクトリを本リポジトリに固定し、`--dangerously-skip-permissions` を付与して Claude を起動する。

### 1-1. スプレッドシート準備

1. 新しいスプレッドシートを作成し、以下のシート名を設定する:
   - `案件リスト`（Google フォーム回答の IMPORTRANGE を設定）
   - `サポート記録`
   - `タダメンマスタ`
2. `タダメンマスタ` に管理者を追加する（B=氏名, C=メール, D=`admin`, E=`true`）
3. `案件リスト` は IMPORTRANGE を設定する。**このシートへの直接書き込みは禁止**

### 1-2. GASプロジェクト初期化

```bash
# clasp でログイン
clasp login

# クローン済みのリポジトリに .clasp.json を配置
# .clasp.json に scriptId を設定する（.gitignore 対象のため手動作成）
```

`.clasp.json` の形式（v1.13.0〜 `rootDir` は `dist`。clasp はビルド成果物を push する。ADR-013）:
```json
{
  "scriptId": "<SCRIPT_ID>",
  "rootDir": "dist"
}
```

`.clasp.deploy.json` の形式（固定 deploymentId。Git 対象外。`npm run deploy` が読む）:
```json
{ "production": "<DEPLOYMENT_ID>" }
```

依存パッケージを入れる（ビルド用。git の pre-commit も自動設定される）:
```bash
npm ci
```

### 1-3. GASエディタでの設定

1. GASエディタ → 左側「サービス」の `+` をクリック
2. **Gmail API v1** を追加（`Gmail` として追加）
3. **Google Calendar API v3** を追加（`Calendar` として追加）
4. 「プロジェクトの設定 → スクリプト プロパティ」に `SPREADSHEET_ID` = タダサポDB のスプレッドシートID を追加する（v1.13.0〜。コードには書かない。ADR-014）。ID は URL の `/d/` と `/edit` の間の部分。URL をそのまま貼っても動く。`SCHEMA_VERSION_APPLIED` はアプリが自動で書くので手入力しない

### 1-4. 初期セットアップ関数の実行

GASエディタの実行ボタンから以下を順番に実行する:

```
1. setupSettingsSheet()        — 「設定」シートを作成
2. addEmailTemplates()         — メールテンプレート設定を追加
3. addForcedCcSetting()        — MAIL_FORCE_CC 設定を追加
4. addMailDryRunSetting()      — MAIL_DRY_RUN 設定を追加
5. addUsageLimitSettings()     — 利用制限設定を追加
6. addAttachmentFolderSetting()— 添付フォルダ設定を追加
```

### 1-5. 予約送信トリガの削除（v1.12.1以降）

予約送信は v1.12.1 で廃止。デプロイ後、旧トリガーや未送信キューが残っている場合は GAS エディタから以下を実行する:

```
disablePendingScheduledEmails()
setupScheduledEmailTrigger()
```

`disablePendingScheduledEmails()` は `pending` / `sending` 行を `disabled` に更新し、メール送信は行わない。`setupScheduledEmailTrigger()` は新規トリガーを作成せず、既存の `processScheduledEmails_` トリガーを削除する。削除後の確認:

```
getScheduledEmailTriggerStatus()
// → { active: false } が返れば正常
```

---

## 2. 日常運用

### 2-1. 旧予約送信キューの確認

予約送信は廃止済み。旧トリガーが残っていないことを `getScheduledEmailTriggerStatus()` で確認し、`active: true` の場合は `setupScheduledEmailTrigger()` を実行して削除する。

### 2-2. スプレッドシートのメンテナンス

| シート | メンテナンス内容 | 頻度 |
|--------|----------------|------|
| 予約送信キュー | 廃止前の履歴確認。`pending`/`sending` があれば `disablePendingScheduledEmails()` で `disabled` 化 | 必要時 |
| メール下書き | 古い下書き行の確認・クリーンアップ | 必要時 |
| 監査ログ | ログの確認 | 必要時 |

### 2-3. 設定変更

管理者がアプリの「設定管理」ダイアログから変更可能（コードの修正不要）:
- メールテンプレート、CC アドレス、利用制限回数、対応ツール一覧等
- Zoom 連携の秘密情報（Account ID・Client ID・Client Secret・固定 Zoom の URL とパスコード）は「連携」タブで**書込専用**（値は表示されない。空欄で保存=変更なし、「削除」で消去）。スクリプトプロパティに保存され、設定シートには入力しない（ADR-014）

#### 2-3-1. 秘密情報の移行（v1.13.0 デプロイ後に1回）

1. 管理者でアプリを開き、管理モード →「設定管理」→「連携」タブ
2. 赤い「秘密情報をプロパティへ移行」が出ていれば押す（設定シートの値をスクリプトプロパティへ移し、シートのセルと過去の監査ログの平文を消す）
3. 各項目が「🔒 スクリプトプロパティに保存済み」になったことを確認
4. **Zoom Marketplace で Client Secret を再発行（ローテーション）し**、新しい値を「連携」タブで入力して保存する（シートに置かれていた間に組織内へ露出していたため）
5. 日程確定で「Zoom」を選び、URL が発行されることを確認

### 2-4. GAS 上の残存スタブファイル（`temp/`）の削除（R4・一度きりのクリーンアップ）

過去の `clasp push` 事故で、GAS プロジェクト側に `temp/index.html`・`temp/コード.js` のスタブが残存している。`doGet` 等の関数定義は除去済みで**動作影響はない**が、混乱防止のため削除を推奨する。

> ⚠️ **`clasp push` では消えない**: `clasp push` は既存リモートファイルを削除しない（追加・更新のみ）。さらにローカルは `.gitignore`(`temp/`)・`.claspignore`(`temp/**`) で push 対象外のため、push 操作では一切変化しない。**削除は GAS エディタからの手動操作が必須**。

手順:
1. GAS エディタを開く（プロジェクト ID `<SCRIPT_ID>`）。
2. 左のファイル一覧で `temp/index` と `temp/コード`（拡張子なし表示）を探す。
3. 各ファイルの「︙」メニュー →「削除」。
4. **削除後に再デプロイは不要**（本番の動作には無関係なスタブのため）。念のため Web アプリ URL を開き、通常どおり起動することだけ確認する。

> 補足: 残存有無の確認だけなら `clasp pull` で取得したローカルの `temp/` 配下を見るか、GAS エディタのファイル一覧を目視する。削除作業自体は破壊的操作ではないが、対象が `temp/` 配下のスタブであることを必ず確認してから行う。

---

## 3. デプロイ手順

### 3-1. 通常デプロイ（v1.13.0〜 `npm run deploy` に一本化）

前提（初回のみ）: §1-2 の `.clasp.json`（`rootDir: "dist"`）・`.clasp.deploy.json`、§1-3 のスクリプトプロパティ `SPREADSHEET_ID`。

```bash
# Step 1: master を最新にする（変更は PR でマージ済みであること）
git switch master && git pull && npm ci

# Step 2: 検査付きデプロイ（人が端末で実行。AI は実行しない）
npm run deploy
#  - 検査: 作業ツリーがクリーン / Webapp=USER_ACCESSING・DOMAIN / executionApi=MYSELF /
#          rootDir=dist / .clasp.deploy.json に production
#  - テスト: 単体・npm run check・E2E（dist をビルドして検証）
#  - ビルド: dist/ を作り直す
#  - 確認: SPREADSHEET_ID を設定済みか（yes）→「deploy」と入力
#  - 反映: clasp push --force → clasp deploy -i <固定 deploymentId>（URL は変わらない）

# Step 3: 動作確認（§3-2）し、付いた @nn を HANDOVER の「現在地」と §1 に記録
```

`clasp push` / `clasp deploy` を手で打たない（原本の `index.html` を push したり、`-i` を付け忘れたりする事故を防ぐため）。

### 3-2. デプロイ後の確認チェックリスト

- [ ] GAS デプロイ管理画面で「実行=アクセスしているユーザー / アクセス=NPO法人タダカヨ 内の全員」
- [ ] 本番URLにアクセスしてアプリが起動する（ブラウザのコンソールに `[perf] initial data` が出る。`server` が各区間の ms）
- [ ] ログインできる（タダメンマスタに登録済みのアカウントで）
- [ ] 案件一覧が表示される
- [ ] 予約送信トリガが残っていない（必要に応じて `getScheduledEmailTriggerStatus()` 確認）

### 3-3. バックエンドのみの変更（`コード.js` だけ変更した場合）

フロントエンドに変更がない場合でも手順は同じ（`npm run deploy`）。

### 3-4. 申込通知 bot（チャット連携）の変更・初期設定（v1.12.13〜）

申込通知 bot はタダサポ本体とは**別の GAS プロジェクト**（回答スプシ `<FORM_SHEET_ID>` の「拡張機能 → Apps Script」、スクリプトID `<BOT_SCRIPT_ID>`）。コードは SDD 付録A。Webapp デプロイはなく、インストール型トリガー「フォーム送信時 → onFormSubmit」で動く。

1. **Webhook URL をスクリプトプロパティへ**: GAS エディタ「プロジェクトの設定 → スクリプト プロパティ」に `CHAT_WEBHOOK_URL` = Google Chat の Webhook URL（スペースの「アプリと統合 → Webhook」）。**コード・ドキュメント・GitHub・チャットに貼らない。** 未設定だと通知が止まる。
2. **コード反映**: GAS エディタに貼り替えて保存（または `clasp --user <bot用アカウント> push --force`）。
3. **再承認（必須）**: トリガーの作成者アカウントでエディタから任意の関数を一度実行し、追加された権限（このスプレッドシート・スクリプトプロパティ）を許可する。**作成者以外が承認しても効かない。** 未承認のままだとトリガー自体が失敗し、チャット通知が止まる。作成者は「トリガー」画面の「作成者」列で確認。手順1〜3は間を空けずに行う。
4. **タダサポ側の取込**: タダサポのスプシに「チャット連携」シートを作り、A1 に `=IMPORTRANGE("<FORM_SHEET_ID>","チャット連携!A:E")` を入れて「アクセスを許可」。回答スプシ側の「チャット連携」シートは最初の申込時に bot が自動作成するため、それまでは `#REF!` 表示で問題ない（案件表示は止まらない）。**タダサポ側のこのシートには書き込まない。**
5. **確認**: 次の実申込のあと、回答スプシ「チャット連携」に1行増え、タダサポの該当案件に「チャットを開く」が出て、押すと通知スレッドが開くこと。動作確認のためのテスト申込はしない（案件リストに実データが残るため）。

**トリガーの重複について**: 作成者の異なるトリガーが同時に残っていても、bot は同じ申込（回答シートの行）への通知を1回だけ送る（2回目以降は実行ログに「通知済みのためスキップ」）。ただし不要なトリガーは削除しておくこと（v1.12.13 の切替時、旧トリガーにも権限があり通知が二重化した実績あり）。

**障害時**: チャット通知が来ない → bot の「実行数」画面でエラー確認（`CHAT_WEBHOOK_URL が未設定` / 承認エラー）。リンクだけ出ない → bot 実行ログの「チャット連携の記録に失敗しました」、IMPORTRANGE の接続を確認。

---

## 4. ロールバック手順

### 4-1. GASコードのロールバック

GAS のデプロイはバージョン管理されている。GASエディタから以下で旧バージョンに戻せる:

1. GASエディタ → 「デプロイ」→「デプロイを管理」
2. 対象のデプロイを選択 → 「バージョンを編集」
3. 以前のバージョン番号を選択して保存

### 4-2. git を使ったロールバック

まず §4-1（GAS のバージョン選択）を優先する（最速・コード操作なし）。コードを戻して出し直す場合は、取り消しコミットを作ってから通常のデプロイを行う:

```bash
git log --oneline -20
git revert <commit-hash>      # 取り消しコミットを作る（履歴を壊さない）
npm run deploy                # 検査付きで反映（§3-1）
```

v1.13.0 より前（スクリプトプロパティ化以前）の版へ戻す場合、旧版は `SPREADSHEET_ID` をコードに持つため動作するが、秘密情報はシートを読む。移行済みでシートが空なら Zoom 連携は止まる点に注意。

---

## 5. インシデント対応

### 5-1. アプリが起動しない

**症状:** 本番URLにアクセスして白画面・エラー画面

**確認手順:**
1. GASエディタで「実行」→ `doGet` を直接実行してエラーを確認
2. `getInitialData()` を直接実行して認証・スプレッドシート接続エラーを確認
3. スクリプトプロパティ `SPREADSHEET_ID` が設定され、正しいか確認（未設定なら「スクリプトプロパティ SPREADSHEET_ID が未設定です」と出る）
4. ブラウザのコンソールでスクリプトの読込エラーがないか確認（`dist/` ではなく原本を push していないか＝`.clasp.json` の `rootDir`）

**よくある原因:**
- スクリプトプロパティ `SPREADSHEET_ID` の未設定・誤り
- 「設定」シートが存在しない → `setupSettingsSheet()` を実行
- Gmail API / Calendar API が有効化されていない

### 5-2. ログインできない

**症状:** 「アクセス権限がありません」が表示される

**確認手順:**
1. アクセスしているGoogleアカウントのメールを確認
2. スプレッドシートの `タダメンマスタ` C列にそのメールが登録されているか確認
3. D列（ROLE）が設定されているか確認（`admin` または `staff`）
4. E列（IS_ACTIVE）が `true` になっているか確認

### 5-3. メールが送信されない

**確認手順:**
1. 設定シートの `MAIL_DRY_RUN` が `true` になっていないか確認（`true` の場合は送信されない）
2. GASエディタの「実行ログ」でエラーを確認
3. Gmail Advanced Service が有効化されているか確認

**予約送信について:**
予約送信は v1.12.1 で廃止済み。メールは即時送信、後で送る文面は下書き保存を使用する。旧キューに `pending` / `sending` が残っている場合は `disablePendingScheduledEmails()` で `disabled` に更新する。

### 5-4. カレンダー連携が動作しない

**確認手順:**
1. Calendar Advanced Service が有効化されているか確認
2. 設定シートの `SHARED_CALENDAR_ID` が正しいか確認（空の場合はデフォルトカレンダーを使用）
3. デプロイユーザーが対象カレンダーの編集権限を持っているか確認

### 5-5. 旧予約送信キューに pending/sending が残っている

**症状:** 予約送信キューシートで `STATUS` が `pending` または `sending` のまま残っている

**対処:** GAS エディタで `disablePendingScheduledEmails()` を実行する。メール送信・案件ステータス更新は行われず、対象行は `disabled` になる。

---

## 6. 本番環境情報

実値は公開リポジトリに書かない（`AI_RULES.md` グランドルール3）。下表は値の置き場所。

| 項目 | 値の置き場所 |
|-----|----|
| Webapp URL `<WEBAPP_URL>` | GAS デプロイ管理画面 |
| GAS プロジェクト ID `<SCRIPT_ID>` | `.clasp.json`（Git 対象外） |
| スプレッドシート ID `<SPREADSHEET_ID>` | GAS のスクリプトプロパティ `SPREADSHEET_ID`（v1.13.0〜） |
| Zoom 連携の秘密情報 | GAS のスクリプトプロパティ（管理画面の設定管理「連携」から書込専用で設定） |
| デプロイ ID `<DEPLOYMENT_ID>` | `.clasp.deploy.json` の `production`（Git 対象外）・`clasp deployments` |
| フォーム回答シート ID `<FORM_SHEET_ID>` | 案件リストの IMPORTRANGE 数式 |
| 申込通知 bot スクリプト ID `<BOT_SCRIPT_ID>` | 回答スプシの「拡張機能 → Apps Script」 |
| Webapp 設定 | `executeAs: USER_ACCESSING` / `access: DOMAIN` |
| タイムゾーン | `Etc/GMT-9`（JST） |
| 予約送信トリガ間隔 | 廃止（v1.12.1以降は作成しない） |
| スキーマバージョン | `SCHEMA_VERSION_ = '6'`（コード.js 内）。適用済みの版はスクリプトプロパティ `SCHEMA_VERSION_APPLIED`（v1.13.0〜。削除すると次回起動時に移行確認を再実行） |
