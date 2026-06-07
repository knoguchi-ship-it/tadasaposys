# BUILD_SPEC.md → Google ドキュメント「先頭タブのみ」同期（手順）

`docs/BUILD_SPEC.md` を、1つの Google ドキュメントの**一番上のタブ**にだけ取り込み・整形して上書きする仕組み。
**他のタブには一切干渉しません。** ドキュメントID（＝URL）は変えないため、更新は「バージョンアップ」運用になります。

- スクリプト本体: `tools/build-spec-doc-sync.gs`
- 認証情報: **不要**（実行ユーザー自身の Google 権限）
- 対象: **BUILD_SPEC.md のみ**／**先頭タブのみ**
- 前提: `docs/BUILD_SPEC.md` が Drive デスクトップで共有ドライブに同期済みであること

> ⚠️ **本番の業務 GAS（コード.js）とは別の、独立したスタンドアロン GAS プロジェクト**として作成・運用してください。`tools/` は `.claspignore` で本番 GAS への push 対象から除外済みです。

---

## 仕組み

- Drive の「ファイル全体の取り込み変換」は**使いません**（それだと全タブを上書きしてしまうため）。
- 代わりに **Google Docs API** で、先頭タブ（`tabId` 指定）の本文だけを「削除 → 再挿入」します。すべての編集命令に `tabId` を付けるので、対象は先頭タブに限定されます。
- ドキュメントIDは不変なので **URL は永続**します。

### 整形について（簡易整形）
| Markdown | Google ドキュメントでの表現 |
|----------|--------------------------|
| 見出し `#`〜`######` | 見出し1〜6 |
| `**太字**` | 太字 |
| `` `コード` `` / コードブロック | 等幅フォント |
| `- ` 箇条書き / `1. ` 番号 | 箇条書き / 番号リスト |
| 表 `| a | b |` | テキスト化（セルを ` | ` 連結、**ヘッダ行は太字**） |
| `[text](url)` | `text（url）` |

> 表は罫線付きの表ではなくテキストになります（方式B＝簡易整形）。原本はあくまで `docs/BUILD_SPEC.md` です。

---

## セットアップ（初回のみ）

### 1. スタンドアロン GAS プロジェクトを作る
1. [script.google.com](https://script.google.com/) →「新しいプロジェクト」。
2. 名前を「BUILD_SPEC Doc Sync」等にする。
3. 既定の `Code.gs` の中身を消し、`tools/build-spec-doc-sync.gs` の内容を貼り付ける。

### 2. マニフェスト（appsscript.json）にスコープを設定
プロジェクト設定（⚙）→「`appsscript.json` をエディタで表示」を ON にし、`oauthScopes` を以下にする：
```json
{
  "timeZone": "Etc/GMT-9",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/script.external_request"
  ]
}
```

### 3. 変換元（BUILD_SPEC.md）の fileId を設定
1. `setUp_findSource` を実行（初回は認可ダイアログを許可）。
2. ログの `id=...` を `SRC_MD_FILE_ID` に貼る。

### 4. 対象ドキュメントを用意し、先頭タブを決める
1. 共有ドライブの任意の場所に **Google ドキュメント**を1つ作る（または既存を使う）。
2. 必要なら**タブを追加**する（Docs の左側のタブ機能）。**一番上のタブが BUILD_SPEC 用**になります。他タブは自由に使えます（このスクリプトは触りません）。
3. その Doc を開き、URL の `/d/` と `/edit` の間の ID を `TARGET_DOC_ID` に貼る。**この URL が恒久 URL**です。
4. （確認）`setUp_listTabs` を実行すると、タブ一覧と「先頭タブ（更新対象）」がログに出ます。想定どおりか確認してください。

### 5. 初回同期
`syncBuildSpecDoc` を実行 → 先頭タブに BUILD_SPEC.md の内容が整形されて入る（他タブは不変）。

---

## 更新運用（2 回目以降）

1. `docs/BUILD_SPEC.md` を更新する。
2. Drive デスクトップが共有ドライブへ `.md` を同期するのを待つ（通常は数秒〜）。
3. GAS で **`syncBuildSpecDoc` を実行**する。→ **先頭タブの中身だけ**が最新に置き換わる（他タブ・URL は不変）。

### 自動化したい場合
- `installHourlyTrigger` を一度実行すると 1 時間ごとに自動同期。停止は `removeSyncTriggers`。

---

## 注意・既知の制約

- **先頭タブ＝`tabs[0]`（一番上のトップレベルタブ）**を更新対象とします。タブを並べ替えて BUILD_SPEC 用タブを先頭に置いてください。
- 表は**テキスト化**されます（罫線付きの表が必要なら方式 C への切り替えが必要）。
- 同期前に `.md` が Drive へ同期済みであること（Drive デスクトップ稼働中の PC が必要）。
- 対象は **Google ドキュメント（ネイティブ）**であること。
- 失敗時はログの HTTP コードとメッセージを確認（スコープ不足・ID 誤り・未同期が主因）。`documents.get`/`batchUpdate` のエラー本文に原因が出ます。
- 既存ドキュメントにタブが1つしかない場合、その唯一のタブ（＝先頭タブ）が対象になります。
