# 運用手順書 (RUNBOOK) — タダサポ管理システム v1.12.0

**対象者:** 開発者・システム管理者
**最終更新:** 2026/05/11

---

## 🔒 グランドルール（絶対厳守）

### Webapp 設定（変更禁止）

`appsscript.json` の `webapp` セクションは以下に固定。逸脱はセキュリティホール。

| 項目 | 必ずこの値 |
|------|-----------|
| 次のユーザーとして実行 | **ウェブ アプリケーションにアクセスしているユーザー** (`USER_ACCESSING`) |
| アクセスできるユーザー | **NPO法人タダカヨ 内の全員** (`access: DOMAIN`) |

**禁止:** 実行=自分（`USER_DEPLOYING`） / アクセス=Googleアカウント全員（`ANYONE_WITH_GOOGLE_ACCOUNT`）

### デプロイ方式（URL不変原則）

**新規デプロイは禁止。** 必ず固定 deploymentId へ `-i` 付きでバージョンアップする。

- 固定 deploymentId: `AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ`
- ✅ 正: `clasp deploy -i AKfycbw...nuq0ZJHhhUQ -d "vX.X.X"`
- ❌ 禁: `-i` を省略したコマンド / GASエディタの「新しいデプロイ」ボタン

新規デプロイすると Webapp URL が変わり、タダメンに案内済みのブックマーク・QR・メールリンクが全失効する。

---

## 1. セットアップ（新規環境構築）

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

`.clasp.json` の形式:
```json
{
  "scriptId": "1UMg3CaTlbZW0YfjzgqbOwd-XOYdIsVELmGpsP7O-MrwFSiAJdS-ySLvP",
  "rootDir": "."
}
```

### 1-3. GASエディタでの設定

1. GASエディタ → 左側「サービス」の `+` をクリック
2. **Gmail API v1** を追加（`Gmail` として追加）
3. **Google Calendar API v3** を追加（`Calendar` として追加）
4. `コード.js` 上部の `SPREADSHEET_ID` を設定済みスプレッドシートIDに書き換える

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

### 1-5. 予約送信トリガの登録（v1.11.0以降必須）

GASエディタから以下を実行する（**初回のみ**。デプロイ後に実行すること）:

```
setupScheduledEmailTrigger()
```

5分間隔のトリガが登録される。トリガが正しく登録されたか確認:

```
getScheduledEmailTriggerStatus()
// → { active: true, triggerId: "..." } が返れば正常
```

---

## 2. 日常運用

### 2-1. トリガ状態の確認

予約送信が動作しない場合、まずトリガ状態を確認する:

GASエディタ → `getScheduledEmailTriggerStatus()` を実行 → `active: false` の場合は `setupScheduledEmailTrigger()` を再実行する。

### 2-2. スプレッドシートのメンテナンス

| シート | メンテナンス内容 | 頻度 |
|--------|----------------|------|
| 予約送信キュー | `sent`/`failed`/`skipped` 行のアーカイブ・削除 | 月次推奨 |
| メール下書き | 古い下書き行の確認・クリーンアップ | 必要時 |
| 監査ログ | ログの確認 | 必要時 |

### 2-3. 設定変更

管理者がアプリの「設定管理」ダイアログから変更可能（コードの修正不要）:
- メールテンプレート、CC アドレス、利用制限回数、対応ツール一覧等

---

## 3. デプロイ手順

### 3-1. 通常デプロイ

```bash
# Step 1: 必ず先にコミット（clasp pull でローカルが上書きされる対策）
git add index.html コード.js appsscript.json
git commit -m "feat: vX.X.X - 変更内容の説明"

# Step 2: GASにプッシュ（--force 必須）
clasp push --force

# Step 3: デプロイを更新
clasp deploy \
  -i AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ \
  -d "vX.X.X"

# Step 4: 動作確認
# 本番URLにアクセスして正常に動作することを確認
```

### 3-2. デプロイ後の確認チェックリスト

- [ ] 本番URLにアクセスしてアプリが起動する
- [ ] ログインできる（タダメンマスタに登録済みのアカウントで）
- [ ] 案件一覧が表示される
- [ ] 予約送信トリガが生きている（必要に応じて `getScheduledEmailTriggerStatus()` 確認）

### 3-3. バックエンドのみの変更（`コード.js` だけ変更した場合）

フロントエンドに変更がない場合でも手順は同じ。`clasp push --force` でコード.js の最新版が反映される。

---

## 4. ロールバック手順

### 4-1. GASコードのロールバック

GAS のデプロイはバージョン管理されている。GASエディタから以下で旧バージョンに戻せる:

1. GASエディタ → 「デプロイ」→「デプロイを管理」
2. 対象のデプロイを選択 → 「バージョンを編集」
3. 以前のバージョン番号を選択して保存

### 4-2. git を使ったロールバック

```bash
# 特定コミットの内容を確認
git log --oneline -20

# 特定コミットの状態に戻す（ローカルのみ）
git checkout <commit-hash> -- index.html コード.js

# GASに反映
clasp push --force

# デプロイ更新（ロールバック用のバージョン説明を付ける）
clasp deploy \
  -i AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ \
  -d "rollback to vX.X.X"

# ロールバック後、作業ブランチを元に戻す
git checkout HEAD -- index.html コード.js
```

---

## 5. インシデント対応

### 5-1. アプリが起動しない

**症状:** 本番URLにアクセスして白画面・エラー画面

**確認手順:**
1. GASエディタで「実行」→ `doGet` を直接実行してエラーを確認
2. `getInitialData()` を直接実行して認証・スプレッドシート接続エラーを確認
3. `コード.js` の `SPREADSHEET_ID` が正しいか確認

**よくある原因:**
- スプレッドシートIDが間違っている
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

**予約送信が動作しない場合:**
1. `getScheduledEmailTriggerStatus()` でトリガが `active: true` か確認
2. `active: false` の場合は `setupScheduledEmailTrigger()` を再実行
3. 予約送信キューシートで対象行の `STATUS` が `pending` のままか確認
4. GASエディタ → 「トリガー」から `processScheduledEmails_` のトリガーを直接確認

### 5-4. カレンダー連携が動作しない

**確認手順:**
1. Calendar Advanced Service が有効化されているか確認
2. 設定シートの `SHARED_CALENDAR_ID` が正しいか確認（空の場合はデフォルトカレンダーを使用）
3. デプロイユーザーが対象カレンダーの編集権限を持っているか確認

### 5-5. 予約送信がスタックした

**症状:** 予約送信キューシートで `STATUS` が `sending` のまま長時間経過

**対処:** 自動復旧機能あり。`sending` のまま 10 分以上経過した行は次のトリガサイクル（最大5分後）で自動再処理される。

手動で対処する場合:
1. 予約送信キューシートで対象行の `STATUS` を `pending` に手動変更
2. 次のトリガサイクルで再処理される

---

## 6. 本番環境情報

| 項目 | 値 |
|-----|----|
| Webapp URL | `https://script.google.com/a/macros/tadakayo.jp/s/AKfycby.../exec` |
| GAS プロジェクト ID | `1UMg3CaTlbZW0YfjzgqbOwd-XOYdIsVELmGpsP7O-MrwFSiAJdS-ySLvP` |
| スプレッドシート ID | `1hllLdETiK0sk0xW_y0V6vOmnlK7kIkHBjntYiCTom4w` |
| デプロイ ID | `AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ` |
| Webapp 設定 | `executeAs: USER_ACCESSING` / `access: DOMAIN` |
| タイムゾーン | `Etc/GMT-9`（JST） |
| 予約送信トリガ間隔 | 5分 |
| スキーマバージョン | `SCHEMA_VERSION_ = '5'`（コード.js 内） |
