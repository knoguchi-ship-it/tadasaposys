# セキュリティ情報 (SECURITY.md)

**Project:** タダサポ管理システム
**最終更新:** 2026/05/10（v1.11.4 対応済み）

---

## 脆弱性の報告

このシステムで脆弱性を発見した場合は、**GitHub Issues ではなく** 以下の連絡先に直接報告してください。

- **報告先:** k.noguchi@care-dx-platform.com
- **件名:** `[SECURITY] タダサポ管理システム - 脆弱性報告`
- **期待する応答時間:** 3営業日以内に確認の返信を行います

公開 Issue での脆弱性報告はお控えください。悪用防止のため、修正リリースまで非公開で対応します。

---

## サポート対象バージョン

| バージョン | サポート状態 |
|-----------|------------|
| v1.11.x（最新） | ✅ セキュリティ修正あり |
| v1.10.x 以前 | ❌ サポート終了 |

---

## アーキテクチャ上のセキュリティ制約

このシステムは Google Apps Script (GAS) 上で動作しており、以下の制約・特性があります。

### 認証

- **認証方式:** Google OAuth（GAS の `executeAs: USER_ACCESSING` による）
- **アクセス制限:** `access: DOMAIN`（tadakayo.jp ドメイン限定）
- **認可チェック:** タダメンマスタシートのメールアドレス照合 + ロール確認
- **セッション管理:** Google のセッション管理に委託（GAS の制約上、独自セッション管理は不要・不可）

### 既知の制約と対処

| 制約 | 詳細 | 対処 |
|------|------|------|
| Webapp URL の固定 | デプロイIDが URL に含まれる。URL 漏えいでもドメイン制限とGoogle認証により不正アクセスを防止 | DOMAIN アクセス制限 + タダメンマスタ認証の二重ガード |
| スプレッドシートへの直接アクセス | スプレッドシートの共有設定次第で直接閲覧される可能性 | スプレッドシートのアクセス権限を最小限に設定すること |
| GAS の実行ログ | `Logger.log()` の内容はGASエディタから参照可能 | 機密情報（パスワード等）をログに出力しない |
| Zoom API 認証情報 | ~~`ZOOM_CLIENT_SECRET` 等を設定シートに保存（組織内の誰でも読める・監査ログにも平文）~~ | **v1.13.0 で修正**: スクリプトプロパティに書込専用で保存（画面・監査ログに値を出さない）。移行後に Client Secret を再発行すること（ADR-014・RUNBOOK §2-3-1） |
| MAIL_DRY_RUN フラグ | `true` の場合メールが送信されない | 本番環境では `false`（または未設定）であることを確認 |
| 添付ファイルの保存先 | `ATTACHMENT_FOLDER_ID` で指定した DriveフォルダにアップロードされたファイルはGAS経由でアクセス可能 | Drive フォルダのアクセス権限を適切に設定すること |
| ~~スプレッドシート数式インジェクション~~ | ~~ユーザー入力文字列が数式として実行される可能性~~ | **v1.11.4 で修正済み**: `sanitizeForSheet_()` により無害化 |
| CDN 依存（esm.sh / Tailwind / Babel） | ~~実行時に外部 CDN からスクリプトを読み込む（esm.sh・Tailwind は SRI 不可）~~ | **v1.13.0 で解消**: 本番はビルドで React・Tailwind を同梱し、実行時に esm.sh・unpkg・Tailwind CDN を読まない。FullCalendar は SRI 付き遅延読込（ADR-013） |
| 他サイトへの埋め込み | ~~`XFrameOptionsMode.ALLOWALL` で任意サイトに iframe 埋め込み可能（クリックジャッキング）~~ | **v1.13.0 で修正**: 既定（埋め込み不可）に変更 |
| Apps Script API 実行 | ~~`executionApi.access: ANYONE`~~ | **v1.13.0 で修正**: `MYSELF` |

### バックエンドのセキュリティ実装

- **二重ガード（ADR-001）:** フロントエンドの UI 制御 + バックエンドの権限チェックを両方実施
- **管理者操作の監査ログ:** 全管理者操作を「監査ログ」シートに記録
- **スパース更新:** `updateCaseDataAdmin` は `hasOwnProperty` チェックにより、送信されたフィールドのみを更新（意図しない上書きを防止）
- **案件リストシートへの書き込み禁止:** IMPORTRANGE 数式の破壊を防ぐため、コードレベルで書き込みを行わない設計

### OAuth スコープ

`appsscript.json` で宣言しているスコープと用途:

| スコープ | 用途 |
|---------|------|
| `https://mail.google.com/` | Gmail でのメール送受信 |
| `https://www.googleapis.com/auth/calendar` | Google カレンダーへの予定作成・編集 |
| `https://www.googleapis.com/auth/drive` | 添付ファイルの Drive 保存 |
| `https://www.googleapis.com/auth/spreadsheets` | スプレッドシートの読み書き |
| `https://www.googleapis.com/auth/userinfo.email` | ログインユーザーのメール取得（認証用） |
| `https://www.googleapis.com/auth/script.external_request` | Zoom API への外部リクエスト |
| `https://www.googleapis.com/auth/script.scriptapp` | 時間主導トリガの登録・管理 |
| `openid` | OpenID Connect 認証 |

---

## セキュリティ上の推奨事項

### スプレッドシートの権限設定

- Google リソース（タダサポDB・回答シート・添付フォルダ・カレンダー・Chat・GAS）の共有範囲は `AI_RULES.md` グランドルール3の「共有範囲の基準」表に従うこと（タダサポDB は USER_ACCESSING のため組織内で編集者。直接編集できることは受容リスクとして記載）
- Zoom API キー等の秘密情報は設定シートに置かない（v1.13.0〜 スクリプトプロパティ・書込専用。ADR-014）。設定シートは組織内の誰でも読める前提で扱う

### 定期確認

- [ ] タダメンマスタの無効化済みスタッフ（`IS_ACTIVE=false`）が正しく設定されているか
- [ ] 監査ログに不審な操作（想定外のステータス変更等）が記録されていないか
- [ ] 予約送信キューに `pending` / `sending` 行が残っていないか。残っている場合は `disablePendingScheduledEmails()` で無効化
