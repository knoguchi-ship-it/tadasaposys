# セキュリティ情報 (SECURITY.md)

**Project:** タダサポ管理システム
**最終更新:** 2026/05/10

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
| Zoom API 認証情報 | `ZOOM_CLIENT_SECRET` 等を設定シートに保存 | スプレッドシートのアクセス権限を管理者のみに制限すること |
| MAIL_DRY_RUN フラグ | `true` の場合メールが送信されない | 本番環境では `false`（または未設定）であることを確認 |
| 添付ファイルの保存先 | `ATTACHMENT_FOLDER_ID` で指定した DriveフォルダにアップロードされたファイルはGAS経由でアクセス可能 | Drive フォルダのアクセス権限を適切に設定すること |

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

- タダサポDB（`1hllLdETiK0sk0xW_y0V6vOmnlK7kIkHBjntYiCTom4w`）の共有設定は「制限付き」または「ドメイン内の特定ユーザーのみ」に設定すること
- 設定シートには Zoom API キー等の機密情報が含まれるため、アクセス権限を管理者のみに絞ることを推奨

### 定期確認

- [ ] タダメンマスタの無効化済みスタッフ（`IS_ACTIVE=false`）が正しく設定されているか
- [ ] 監査ログに不審な操作（想定外のステータス変更等）が記録されていないか
- [ ] 予約送信キューの `failed` 行に機密情報が含まれていないか
