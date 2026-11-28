# タダサポ管理システム — AI エージェント共通指示（AI_RULES.md）

> **Claude Code・OpenAI Codex など、すべての AI エージェント共通の開発指示の正本。**
> `CLAUDE.md`（Claude Code）と `AGENTS.md`（Codex）は入口だけで、このファイルを読ませる。**ルールの追加・変更はこのファイルだけで行う**（DRY。2026-11-25 一本化）。`docs/RUNBOOK.md` など人間向け文書はルール本文を書き写さず、このファイルを参照する。
> コードを触る前に必ずこのファイルを確認すること。詳細仕様は各ドキュメントを参照。

---

## プロジェクト概要

介護事業所向け無料 IT サポート管理システム。GAS 上の React SPA で、Google スプレッドシートをデータストアとして使用。

- **現行バージョン:** v1.14.0
- **詳細設計（仕様の正本）:** `docs/SDD.md`
- **引き継ぎ書:** `docs/HANDOVER.md`
- **運用手順:** `docs/RUNBOOK.md`
- **ステージング環境:** 設けない（2026-11-25 決定）。検証はローカル（モックデータ）＋単体テスト＋E2E で行い、本番反映後に本番URLで動作確認する

---

## ファイル構成（厳守）

```
index.html      — フロントエンドの原本（React SPA、モックデータ含む単一ファイル。開発時はブラウザ内 Babel で動く）
gas/            — バックエンド（GAS サーバーサイド）。役割別の「2桁番号_名前.js」12ファイル（ADR-016）。00_管理者メニュー.js は GAS エディタから手で実行する関数だけ
appsscript.json — GASマニフェスト
dist/           — 本番ビルド成果物（npm run build が生成。Git 対象外。clasp はここを push。ADR-013）
tools/          — ビルド・デプロイ・同期チェック（build.js / deploy.js / check-sync.js）
AI_RULES.md     — 本ファイル（AI 共通ルールの正本）
CLAUDE.md / AGENTS.md — 各エージェントの入口（本ファイルを読ませるだけ。ルールを書かない）
```

- `src/` フォルダは廃止済み。**絶対に作らないこと**。アプリの原本は `index.html` 1ファイルのまま（分割しない）
- 新規ファイル追加は原則不要。`index.html` と `gas/` の該当ファイルを編集する。`gas/` は役割で選ぶ（各ファイル先頭のコメント参照）。GAS エディタから手で実行する関数は `gas/00_管理者メニュー.js` に置き、画面から呼ぶ関数は置かない
- `gas/` のトップレベルの `const`/`let` はリテラルだけで初期化する（GAS は全ファイルを同じグローバル空間で名前順に評価するため、他ファイルの値を参照すると読込順で壊れる）。同じ名前を2つのファイルで宣言しない
- `dist/` は手で編集しない（毎回 `npm run build` で作り直す）
- 原本 `index.html` の目印コメント（`build:dev-only`・`build:css`・`build:app`）を消さない。開発専用の CDN・Babel・importmap は `build:dev-only` の内側に置く
- `temp/` 配下はローカルバックアップ・GAS上の残存スタブ確認用。**Git追跡・clasp push対象から除外し、今後追わないこと**

---

## 作業の進め方（全エージェント共通）

### 作業前レビュー（必須）

初めて扱う、または前回確認後に他者（ユーザー・別エージェント・別セッション）が変更した既存のコード・文書・設定は、作業前に「正本（SDD・ADR）・実装・テスト・引継ぎ書」の矛盾を確認する。キャッチアップでも構成の要約だけで済ませない。

- 引継ぎ書の記述（版数・デプロイ番号・テスト件数・残作業）は、実物（git log・ファイル・テスト実行結果）と照合してから信用する
- 既存テストの合格だけでレビュー済みと判定しない。同じ版・範囲をこのセッションで確認済みなら結果を再利用し、新しい差分と影響先だけ確認する
- 見つけた矛盾は、今回の作業範囲外でも報告する（または直す）
- レビューのみの依頼で本体を無断修正しない

**照合項目（キャッチアップ・作業開始時に毎回すべて行う。「矛盾を確認する」の範囲はこれ以上・以下にしない）:**

Claude Code では、1〜7 の結果がセッション開始時に SessionStart フックで自動的に文脈へ渡される（`npm run check --session`）。その結果を最初の報告に含める。Codex など他のエージェントは自分で `npm run check` を実行する。

| # | 照合すること | 方法 |
|---|---|---|
| 1 | 版数が同期対象（グランドルール6）すべてで一致 | `npm run check` |
| 2 | HANDOVER の現在地（版・@nn・単体/E2E 件数）と §1・§8 が、package.json・テストの実数と一致 | `npm run check` |
| 3 | `gas/01_定数と設定.js` の `const IDX` が、本ファイルのデータモデル節と `docs/SDD.md` §1 の各シート表と一致 | `npm run check` |
| 4 | ADR の件数が索引（`ADR-001〜NNN`）と一致 | `npm run check` |
| 5 | 「仕組み」欄で導入済みの物が実在する（`.claspignore`・`.gitignore`・CI・`appsscript.json`） | `npm run check` |
| 6 | 本番識別子・個人名の残存件数（移行中のため警告。件数の増減を報告する） | `npm run check` |
| 7 | origin との差（未 push・未取込） | `npm run check`（必要なら先に `git fetch`） |
| 8 | 単体テスト・E2E が実際に合格する | `npm run test:unit` / `npm test` |
| 9 | 前回以降の差分（`git log` / `git diff`）が触れた仕様・権限・データ・画面について、SDD・ADR の記述と実装が食い違っていない | 差分を読んで目視 |

- `npm run check`（`tools/check-sync.js`）の終了コードと、エラー・警告の要旨を報告する。エラーは今回の作業範囲外でも報告する
- 9 は機械化できないため必ず目視し、何を確認したかを報告に書く
- `npm run check` の検査項目は、本ファイルのルール（同期対象・IDX・仕組み欄）を変えたら合わせて直す

### 変更手順（必須）

仕様・権限・業務ルール・画面・API・シート列を変える開発は、次の順で行う。実装を先に書いて後から文書を合わせない。

**① 合意 → ② 仕様（`docs/SDD.md`）→ ③ 関連文書の矛盾訂正 → ④ 実装 → ⑤ テスト → ⑥ 同期・版 → ⑦ 検査 → ⑧ 報告**

- ① 依頼・前提・期待結果を箇条書きにし、曖昧な点は実装前に質問する（グランドルール5）
- ② `docs/SDD.md` の該当節を先に更新する。設計判断を伴う場合は `docs/ADR.md` に記録する
- ③ 変更のキーワード（関数名・項目名・画面名）で `docs/`・本ファイル・`SECURITY.md` を検索し、ヒットをすべて確認する
- ⑤ 単体テスト・E2E を追加し、「壊れたコードで失敗・正しいコードで合格」を一時改変で確認して改変は戻す。`npm run test:unit` と `npm test` を実行し、終了コードを隠さない
- ⑥ CHANGELOG・版数・HANDOVER を同期する（グランドルール6）
- ⑦ 下記「仕組み」欄の検査を通す（未導入の検査は目視で代替し、その旨を報告する）
- ⑧ 変更した仕様・文書・コード・テスト件数と結果・未実施事項を報告する
- 純粋なバグ修正（仕様どおりに直すだけ）は②③を「該当なし」と報告して省略してよい

### コマンド実行ポリシー

**AI が確認なしに実行してよい**（ローカルで完結し、取り消せる操作）:

```bash
git status / git diff / git log / git show      # 読み取り
git fetch / git branch / git blame など          # その他の読み取り専用 git（リモートへ書き込まないもの）
npm run check                                    # ドキュメント同期チェック
npm run test:unit / npm test                     # テスト
npx serve -s . -l 3000                           # ローカルプレビュー
git add / git commit                             # ローカルの記録（push しない限り外部に出ない）
```

**ユーザー確認なしに実行しない**（本番・外部公開に影響する操作）:

```bash
clasp push            # 本番 GAS のコードを書き換える
npm run deploy        # 上記をまとめて実行する（人が端末で実行する）
clasp deploy          # 本番 Webapp を更新する
git push              # 公開リポジトリ（GitHub PUBLIC）へ出す
```

**禁止**（ユーザーの明示指示があっても、理由とリスクを説明し再確認してから）:

```bash
clasp deploy（-i <固定deploymentId> なし）   # 新しい URL が発行される
git push --force / git push -f              # 共有履歴の破壊
git commit --no-verify                      # コミット前検査の回避
git reset --hard / git clean -f             # 未コミット作業の消失
clasp pull（未コミット差分がある状態で）      # ローカルの上書き
```

- 上の2つのリストにないコマンドは、ローカルで完結する読み取りなら実行してよい。外部（本番 GAS・GitHub・Google リソース）へ書き込むものは確認を求める
- 確認は「何を・どこへ・何が変わるか」を示して求める。一度の承認は、その操作1回分に限る（次のデプロイには改めて確認する）
- Claude Code は確認省略モード（`bypassPermissions`）で起動するため、上記は**ルールとして守る**。禁止リストは PreToolUse フックが機械的に拒否する（グランドルール1「仕組み」）。要確認リストはフックが確認（ask）を求めるが、確認省略モードで確認画面が出る保証はないため、AI 自身が確認を取ってから実行する

---

## 絶対厳守の制約

### React 18.2.0 固定（ADR-004）

React 19系を混在させると `Minified React error #31` でクラッシュする。本番は `package.json` の版固定（`react@18.2.0`・`react-dom@18.2.0`・`lucide-react@0.330.0`、`--save-exact`）でビルドに同梱する。版を上げる変更は ADR を伴う。開発用の原本の importmap では、CDN ライブラリに必ず `?deps=react@18.2.0` を付与。

```json
"imports": {
  "react":           "https://esm.sh/react@18.2.0",
  "react-dom/client":"https://esm.sh/react-dom@18.2.0/client?deps=react@18.2.0",
  "lucide-react":    "https://esm.sh/lucide-react@0.330.0?deps=react@18.2.0"
}
```

### ローカル/本番判定

```javascript
const isLocal = typeof google === 'undefined';
```

### 案件リストシートへの書き込み禁止

IMPORTRANGE 数式を破壊する。管理者による補正は「案件補正」シート経由で行う。

---

## グランドルール実行チェック

各ルールは「判断基準（本文）」「作業チェック」「仕組み」の3層で扱う。チェックだけで判断せず、本文の禁止事項・理由・例外条件を必ず読む。「仕組み」欄は、そのルールを機械的に支えるものを **導入済み／導入予定** で示す。導入予定のものは、導入されるまで人（AI）がチェックで代替する。仕組みを導入・変更したら、この欄を更新する。

### 1. 本番安全

Webapp 設定は **`executeAs: USER_ACCESSING` / `access: DOMAIN` 固定**。アクセスした本人の権限で実行されるため、実行者がそのまま監査主体になり、権限境界が構造的に守られる。`USER_DEPLOYING`（実行=自分）は監査・権限境界が崩壊し、`ANYONE_WITH_GOOGLE_ACCOUNT` / `ANYONE` はドメイン外流出になるため禁止（過去に「実行=自分 / アクセス=Googleアカウント全員」で運用された事故あり。介護事業所の個人情報を扱うため再発禁止）。

`appsscript.json` の `executionApi.access` は **`MYSELF`** とする（v1.13.0 で是正済み）。

デプロイは新規作成せず、**固定 deploymentId への `-i` 付き更新のみ**。新規デプロイは Webapp URL を変え、タダメンに案内済みのブックマーク・QR・メールリンクを全て失効させる。GAS エディタでも「新しいデプロイ」ではなく「デプロイを管理 → 既存デプロイの ✏️ 編集 → バージョン: 新バージョン」を使う。

作業チェック:
- [ ] `appsscript.json` の `webapp` が `USER_ACCESSING` / `DOMAIN`、`executionApi` が `MYSELF`
- [ ] デプロイ時は固定 deploymentId に `-i` 付き
- [ ] `clasp push` / `clasp deploy` の前にユーザーの確認を得た
- [ ] デプロイ前に `appsscript.json` の差分を確認、デプロイ後に GAS デプロイ管理画面で Webapp 設定を目視確認（CLI では確認不可）

仕組み:
- 導入済み: Claude Code の PreToolUse フック（`.claude/hooks/guard.js`。Bash・PowerShell・MCP の git ツールが対象）。禁止リスト（`-i` なしの `clasp deploy`・`clasp create-deployment`・force push・`--no-verify`・`git reset --hard`・`git clean -f`・未コミット差分がある状態の `clasp pull`）を拒否（exit 2）し、要確認リスト（`clasp push`・`clasp deploy -i`・`git push`）は確認（ask）を求める。文字列照合だけの軽量な判定で、引用符内・ヒアドキュメント本文は対象外。判定は単体テスト `tests/unit/guard.test.js` で保証する
- 導入済み: デプロイ用スクリプト `npm run deploy`（`tools/deploy.js`）。`webapp`=USER_ACCESSING/DOMAIN・`executionApi`=MYSELF・作業ツリーがクリーン・`.clasp.json` の `rootDir`=`dist`・テスト合格（単体・check・E2E）を検査し、`dist/` をビルドして、deploymentId は `.clasp.deploy.json` から読んで必ず `-i` 付きで実行する。確認省略オプションはなく、端末で「deploy」と手入力しないと進まない（AI からは実行できない）。PreToolUse フックも `npm run deploy` に確認を求める
- 導入予定: GitHub `master` のブランチ保護（CI 合格を必須にする）

### 2. データ保全

`案件リスト` は IMPORTRANGE 保護のため直接書き込み禁止。補正は `案件補正` 経由。IDX/シート列は左詰め・ギャップなし。`temp/` はバックアップ・スタブ隔離先であり、Git追跡・clasp push・レビュー対象に含めない。

ドライランテストで作成・更新したテストデータは、テスト完了後に必ず削除または復元し、ドライラン実施前の状態へ戻す。削除・復元できないドライランは実施しない。ステージング環境はないため、本番データでの試験変更は原則行わない。

作業チェック:
- [ ] `案件リスト` に直接書き込んでいない
- [ ] IDX/列変更時に `docs/SDD.md` と関連文書を同期
- [ ] `temp/` を差分・デプロイ対象に含めていない
- [ ] ドライランテストで作成/更新したテストデータを削除または復元した

仕組み:
- 導入済み: `.claspignore`（`temp/**`・`tests/**`・`docs/**` 等を push 対象外）、`.gitignore`（`temp/` を Git 対象外）

### 3. セキュリティ

セキュアコーディングは、認証・認可、入力検証/出力無害化、機密情報管理、データ保護/最小権限、監査性/エラー処理の5視点で行う。ハードコーディングは原則禁止。

**機密情報・識別情報の扱い（2026-11-25 明確化）:** 本リポジトリは **GitHub で公開（PUBLIC）** されている。次のものは、操作者の許可があってもコード・ドキュメント・テスト・コミットメッセージに書かない。

- 認証情報（トークン・Webhook URL・API キー・パスワード）
- 本番の識別子: deploymentId・Webapp URL・GAS スクリプト ID・スプレッドシート ID・フォーム ID・Drive フォルダ ID・カレンダー ID・Chat スペース ID
- 個人名・個人のメールアドレス（利用者・相談者・メンバー。役割名で書く）

扱い方:
- ドキュメントでは `<DEPLOYMENT_ID>` `<WEBAPP_URL>` `<SCRIPT_ID>` `<SPREADSHEET_ID>` `<FORM_SHEET_ID>` `<TEAM_CALENDAR_ID>` 等のプレースホルダで表す
- 実値は Git 対象外のローカルファイル（`.clasp.json`・`.clasp.deploy.json`）、PropertiesService、または設定シートで管理する
- テストでは実在しないダミー値を使う
- **既存の文書・コード・テストに残る実値は、順次除去する（移行中）**。Git 履歴には残るため、実際の防御は下記「共有範囲の基準」で行う

**Google リソースの共有範囲の基準（2026-11-25 確認済みの現状を基準とする）:**

| リソース | あるべき共有範囲 | 備考 |
|---|---|---|
| タダサポDB（スプレッドシート） | 組織内で編集者 | USER_ACCESSING のため利用者本人に書込権限が必要。**受容リスク:** 組織内メンバーはアプリを通さずシートを直接編集でき、サーバー側権限チェック・監査ログを経由しない |
| フォーム回答シート（チャット連携シート含む） | 組織内で閲覧者 | |
| 添付ファイル保存フォルダ | 組織内で閲覧者 | 親フォルダからのリンク共有の継承もないこと |
| チームカレンダー（`TEAM_CALENDAR_ID`） | 非公開（必要なメンバーにのみ共有） | アプリが案件の予定（事業所名を含む）を書き込む。**一般公開しない**。日程確定するメンバーには予定の変更権限が必要 |
| 共有カレンダー（`SHARED_CALENDAR_ID`。チームカレンダーの代替書込先） | 一般公開しない | 同上 |
| タダスクカレンダー（`DISPLAY_CALENDARS_JSON`） | 一般公開（タダスク側の運用方針。編集は限定メンバー） | アプリは**重複検知のための読み取りのみ**。このカレンダーを書込先（`TEAM_CALENDAR_ID`・`SHARED_CALENDAR_ID`）に設定しない。書込処理を追加しない |
| Google Chat スペース（申込通知） | 外部メンバー不可・組織内のみ | |
| GAS プロジェクト（本体・申込通知 bot） | 制限付き（開発担当者のみ） | |

作業チェック:
- [ ] UI制御だけでなくサーバー側権限チェックがある
- [ ] 外部入力・シート値・HTML出力・GAS書き込み値を検証/無害化している（`sanitizeForSheet_`）
- [ ] 認証情報・本番の識別子・個人名を、コード・ドキュメント・テスト・コミットメッセージに入れていない
- [ ] 固定値は設定化できないか確認した
- [ ] 管理操作の監査性と失敗時の安全停止を確認した
- [ ] Google リソース（シート・フォルダ・カレンダー・Chat・GAS）を追加・変更したら、共有範囲の基準に合っているか確認し、基準表を更新した
- [ ] カレンダーへの書込処理を追加・変更した場合、書込先が一般公開カレンダーにならないことを確認した

仕組み:
- 導入済み: `.gitignore`（`.clasp.json`・`.clasp.*.json`・認証情報ファイル・`.private-terms.local.txt`）
- 導入済み: `npm run check` が本番識別子の形式と、ローカルの `.clasp.json`・`.clasp.deploy.json`・`.private-terms.local.txt`（個人名など1行1語。Git 対象外）に書かれた実値の混入を検出する（移行中は警告、`--strict` でエラー）
- 導入済み: 上記はコミット前検査（pre-commit）でも実行される（移行中は警告のみ）
- 導入済み: `SPREADSHEET_ID` と秘密情報はスクリプトプロパティ（ADR-014）。秘密情報は書込専用（管理画面・監査ログに値を出さない）
- 導入済み: 単体テスト `tests/unit/public-auth-guard.test.js`（v1.14.0・SDD SEC-01b）。`gas/` の公開関数（画面から誰でも呼べる）が、すべてタダメン確認（`getActor_`）か管理者確認（`requireAdmin_`・`runAdminWrite_`）を行うか、理由つきの例外であることを検査する。内部専用の関数は名前を `_` で終えて公開しない
- 導入予定: 残存ゼロを確認したら pre-commit・CI を `--strict` にする（v1.13.0 でコード上の残存は解消。過去のコミット履歴には残る）

### 4. 実装品質

DRY原則を守り、共通化できる処理を重複実装しない。新設処理も既存ヘルパー・既存パターンを確認してから追加する。React は 18.2.0 固定、日付フォーマットは UTC ずれを避ける。

作業チェック:
- [ ] 既存ヘルパー・既存パターンを確認した
- [ ] 重複実装ではなく共通化を検討した
- [ ] React 18.2.0 固定と importmap の依存指定を壊していない
- [ ] 日付処理で `toISOString()` による日付ずれを起こしていない

仕組み:
- 導入済み: 単体テスト（Jest）・E2E（Playwright）
- 導入済み: CI で Jest も実行する

### 5. 既存機能保護

既存機能への影響範囲を必ず確認し、破壊しないことを関連コード確認・差分確認・テストで保証する。

**新機能搭載時は E2E 回帰テストの実施を必須とする。** 新機能・新規操作経路を追加したら、その操作経路を検証する E2E テスト（`tests/e2e/`）を追加し、「壊れたコードでは失敗し、正しいコードでは合格する」ことを確認する。既存の E2E スイートも実行し、回帰がないことを保証してからデプロイする。テストコードは `.claspignore` の `tests/**` で本番 GAS push 対象外（再デプロイ不要）。

ユーザーからの依頼・情報が不明瞭、抽象的、掘り下げが必要、または想像に任せないと作業できない場合は、実装や変更に入る前に必ずユーザーへ質問し、前提を明らかにしてから進める。

作業チェック:
- [ ] 依頼内容・前提・期待結果に曖昧さがない（曖昧な点は作業前に質問して明確化した）
- [ ] 影響する画面/API/シート/モック/テストを洗い出した
- [ ] 既存フローの回帰リスクを確認した
- [ ] 新機能・新規操作経路には E2E 回帰テストを追加し、壊れたコードで失敗・正しいコードで合格を確認した
- [ ] `npm run test:unit` と `npm test`（E2E 全体）を実行し回帰がないことを確認した
- [ ] ドライランテスト後に本番データが実施前状態へ戻っている

仕組み:
- 導入済み: GitHub Actions（`.github/workflows/playwright.yml`）が push / PR で単体テスト・`npm run check`・E2E を実行
- 導入済み: 単体テスト `tests/unit/snapshot-write-guard.test.js`（v1.14.0・ADR-015）。`gas/` の公開関数が、すべて「書込＝`runWrite_` で包む（完成品の世代を更新）」か「読むだけ」に分類されていることを検査する。書込を行う公開関数を追加したら包む（包み忘れると、その書込が次の起動に最大10分反映されない）
- 導入済み: 単体テスト `tests/unit/backend-layout.test.js`（v1.14.0・ADR-016）。`gas/` のファイル名・宣言の重複なし・トップレベル定数がリテラルだけ・管理者メニューに手で実行する関数だけがあり漏れもないことを検査する。`snapshot-flow.test.js` は GAS と同じくファイルごとに名前順で評価する
- 導入予定: `master` のブランチ保護で CI 合格を必須にする

### 6. ドキュメント・文字コード

コード更新時は毎回、コード・ドキュメント・テスト・モックデータの整合性を確認する。ER図・テーブル設計書は HTML で `docs/` 配下に保存する。AI向け指示だけでなく、人間が読める Markdown/HTML も維持する。文字化けは放置せず UTF-8 として読める状態に修正する。

**バージョン同期対象:** `gas/01_定数と設定.js` 先頭コメント・`index.html`（`<meta name="app-version">`）・`package.json`・`CHANGELOG.md`・本ファイル（`AI_RULES.md`）・`docs/SDD.md`・`docs/HANDOVER.md`・`docs/Manual.md`

**HANDOVER の現在地:** 版・本番デプロイ番号・テスト件数は、`docs/HANDOVER.md` 冒頭の1行「**現在地:** vX.Y.Z / 本番 @nn / 単体 N件 / E2E N件」だけに書く（DRY）。リポジトリの版が本番より新しい（未反映）間は「本番 @nn（vA.B.C）」と本番の版を併記する。本文の他の箇所に件数・現行版を書き写さず「冒頭の現在地を参照」とする。例外として §1「本番デプロイバージョン: @nn（vX.Y.Z）」と §8 のスペック別件数一覧は維持し、`npm run check` が現在地・実テストと照合する。

**デプロイ記録:** 本番へ反映したら、現在地の行と §1 本番デプロイバージョンを更新する。テストを追加・削除したら、現在地の件数と §8 のスペック一覧を更新する。

作業チェック:
- [ ] バージョン同期対象と CHANGELOG / HANDOVER / Manual の必要箇所を同期
- [ ] `npm run check` がエラー0（警告は内容を報告）
- [ ] ER図・テーブル設計書の作成/更新が必要な場合は HTML で保存
- [ ] 人間向けドキュメントも更新
- [ ] ルールを変えたときは本ファイルだけを編集した（CLAUDE.md / AGENTS.md / RUNBOOK に書き写していない）
- [ ] 文字化けがないことを確認

仕組み:
- 導入済み: `npm run check`（`tools/check-sync.js`。版数・HANDOVER 現在地・IDX・ADR 件数・仕組みの実在・識別子の残存・origin との差を検査）
- 導入済み: 自動実行は3か所に限る — git の pre-commit（`.githooks/pre-commit`。エラーでコミットを止める。`npm install` 時に `core.hooksPath` を自動設定）、Claude Code の SessionStart フック（`startup`/`clear` 時に結果を文脈へ渡すだけで止めない）、CI
- 採用しない: Stop フック（応答のたびに走り重くなる。pre-commit と SessionStart で足りる）。フックは「強制が必要な場面に必要最小限」とし、追加するときは実行頻度と所要時間を確認して本欄に理由を書く
- 導入予定: コード変更時の CHANGELOG / テスト未更新の検出

---

## データモデル（`gas/01_定数と設定.js` の `const IDX`）

全シート左詰め、ギャップなし。IDX を変更したら、`docs/SDD.md` §1 と本節の両方を同じコミットで更新する（`npm run check` が照合する。行番号ではなく定義名で指す）。

```javascript
RECORDS: { FK:0, STATUS:1, STAFF_EMAIL:2, STAFF_NAME:3, DATE:4, COUNT:5,
           METHOD:6, BUSINESS:7, CONTENT:8, REMARKS:9, HISTORY:10,
           EVENT_ID:11, MEET_URL:12, THREAD_ID:13, ATTACHMENTS:14,
           CASE_LIMIT_OVERRIDE:15, ANNUAL_LIMIT_OVERRIDE:16,
           TOOLS:17, SUB_STAFF:18 }   // 19列

DRAFT:     { DRAFT_ID:0, CASE_ID:1, STAFF_EMAIL:2, MODE:3, THREAD_ID:4,
             SUBJECT:5, BODY:6, CC:7, BCC:8, TOOLS:9, UPDATED_AT:10 }  // 11列

SCHEDULED: { QUEUE_ID:0, CASE_ID:1, STAFF_EMAIL:2, STAFF_NAME:3, MODE:4,
             THREAD_ID:5, SUBJECT:6, BODY:7, CC:8, BCC:9, TOOLS:10,
             SEND_AT:11, STATUS:12, ERROR:13, CREATED_AT:14, SENT_AT:15 }  // 16列・予約送信はv1.12.1で廃止、既存キュー確認用

STAFF:     { NAME:1, EMAIL:2, ROLE:3, IS_ACTIVE:4 }
CASES:     { PK:0, EMAIL:1, OFFICE:2, NAME:3, DETAILS:4, PREFECTURE:5, SERVICE:6 }
CASES_OVERRIDE: { PK:0, EMAIL:1, OFFICE:2, NAME:3, DETAILS:4, PREFECTURE:5, SERVICE:6 }  // 案件補正（CASES と同一列構造。空欄=補正なし）

EMAIL:     { CASE_ID:0, SEND_DATE:1, SENDER_EMAIL:2, SENDER_NAME:3,
             RECIPIENT_EMAIL:4, SUBJECT:5, BODY:6 }  // メール履歴 7列

ANNUAL_ADJUST: { EMAIL:0, FISCAL_YEAR:1, ADJUSTMENT:2, UPDATED_BY:3, UPDATED_AT:4 }  // v1.12.4 年間利用補正（メール+年度→補正量）
CHAT_LINK: { SUBMITTED_AT:0, EMAIL:1, THREAD_NAME:2, MESSAGE_NAME:3, RECORDED_AT:4 }  // v1.12.13 チャット連携（IMPORTRANGE・参照のみ）
```

詳細（各シートの全列定義・制約）: `docs/SDD.md` §1

---

## ビジネスルール

- 案件ごと最大3回（`supportCount`、設定値で変更可）
- 年間最大10回（同一メール + 年度、設定値で変更可）
- 上限優先順: 案件特例 > 全体設定 > ハードコードデフォルト
- 未対応 + 年間>=上限 → 「回数超過」ボタンのみ表示
- 完了 + 年間>=上限 → 再開ボタン非表示
- `rejected`: 回数超過メール送信後に設定
- 年度計算: 4月開始。`inProgress`/`completed` の `supportCount` を合算

詳細（全ビジネスルール・ステータス遷移）: `docs/SDD.md` §2〜3

---

## ローカル開発・テスト

```bash
npx serve -s . -l 3000          # → http://localhost:3000（原本・ブラウザ内 Babel・モックデータ14パターン）
                                 # 代替: python -m http.server 3000 --directory .
npm run build                    # 本番ビルド → dist/（npx serve -s dist -l 3000 で本番相当を確認）
npm run test:unit                # Jest 単体テスト
npm test                         # Playwright E2E（既定で dist/ をビルドして検証。原本は E2E_TARGET=src）
npm run check                    # ドキュメント同期チェック
```

---

## デプロイ

### 🔒 デプロイは必ずバージョンアップ（URL 不変原則）

- 固定 deploymentId: `<DEPLOYMENT_ID>`（実値は Git 対象外のローカルファイル `.clasp.deploy.json` の `production`。`clasp deployments` でも確認できる）
- ✅ 正: `clasp deploy -i <DEPLOYMENT_ID> -d "vX.X.X"`
- ❌ 禁: `clasp deploy -d "vX.X.X"` / `clasp deploy`（新URL発行）

### 🔒 Webapp 設定（絶対厳守）

| 項目 | 必ずこの値 |
|------|-----------|
| 次のユーザーとして実行 | **ウェブ アプリケーションにアクセスしているユーザー** (`executeAs: USER_ACCESSING`) |
| アクセスできるユーザー | **NPO法人タダカヨ 内の全員** (`access: DOMAIN`) |

理由と禁止設定はグランドルール1を参照。

### デプロイ手順（v1.13.0〜 `npm run deploy` に一本化。ADR-013）

本番反映は人が端末で `npm run deploy` を実行する（AI は実行しない。`clasp push` / `clasp deploy` を個別に打たない）。初回だけ次の準備が要る。

```bash
# 準備（初回のみ・各自の手元）
#  a. .clasp.json に "rootDir": "dist" を設定（Git 対象外のローカルファイル）
#  b. .clasp.deploy.json に {"production": "<DEPLOYMENT_ID>"}（Git 対象外）
#  c. GAS「プロジェクトの設定 → スクリプト プロパティ」に SPREADSHEET_ID（ADR-014）

# 1. master を最新にし、作業ツリーをクリーンにする（未コミットがあると止まる）
git switch master && git pull && npm ci

# 2. 検査付きデプロイ（単体・check・E2E → ビルド → 確認入力 → clasp push --force → clasp deploy -i）
npm run deploy

# 3. ブラウザの GAS デプロイ管理画面で「実行=アクセスしているユーザー / アクセス=NPO法人タダカヨ 内の全員」を目視確認
# 4. 本番URLで変更箇所の動作を確認し（コンソールに [perf] initial data）、HANDOVER に @nn を記録（グランドルール6）
```

**v1.12.1 以降:** 予約送信は廃止。デプロイ後は必要に応じて GAS エディタで `disablePendingScheduledEmails()` を実行し、未送信予約を無効化する。`setupScheduledEmailTrigger()` は既存トリガー削除のみ行う。

詳細手順・ロールバック・インシデント対応: `docs/RUNBOOK.md`

---

## 本番環境

| 項目 | 値の置き場所 |
|-----|----|
| GAS プロジェクト ID | `<SCRIPT_ID>` — ローカルの `.clasp.json`（Git 対象外） |
| スプレッドシート ID | `<SPREADSHEET_ID>` — GAS のスクリプトプロパティ `SPREADSHEET_ID`（v1.13.0〜・ADR-014） |
| Zoom 連携の秘密情報 | スクリプトプロパティ（管理画面の設定管理から書込専用で設定・ADR-014） |
| デプロイ ID | `<DEPLOYMENT_ID>` — ローカルの `.clasp.deploy.json`（Git 対象外） |
| Webapp 設定 | `executeAs: USER_ACCESSING` / `access: DOMAIN` |

---

## コーディング規約

- 日本語コメント推奨
- フロントエンドは Tailwind CSS でスタイリング
- ESM import は原本では importmap 経由（ブラウザ内 Babel）、本番はビルドで同梱（ADR-013）。新しい外部ライブラリを足すときは `package.json` に版固定で追加し、原本の importmap と揃える
- Tailwind のクラス名は文字列連結で組み立てない（本番ビルドは静的走査のため欠ける）。完全なクラス名を書く
- 外部 CDN から実行時に読むスクリプトには SRI（`integrity`）を付ける
- 絵文字など BMP 外の文字（U+10000 以上）は JS の文字列内だけで使い、HTML 部分には書かない。日本語を含む正規表現はリテラルでなく `new RegExp('…')` で書く（GAS 配信で壊れるため。本番ビルドが検査して止める。ADR-013）
- GAS 関数呼び出しは `google.script.run` 経由（ローカルではモック）
- 日付フォーマット: `toISOString()` は UTC ずれが出るため `getFullYear()/getMonth()/getDate()` を使用
- DRY原則を守る。新規処理追加時も既存ヘルパー・既存パターンとの共通化を先に検討する
- ハードコーディングは原則禁止。機密情報・本番の識別子はグランドルール3に従う

---

## エージェント別の補足

### Claude Code

- 入口は `CLAUDE.md`（`@AI_RULES.md` で本ファイルを自動読込）
- 起動方針は `.claude/settings.json`（`permissionMode: bypassPermissions`）。`--dangerously-skip-permissions` をリポジトリ設定から自動付与できる保証はないため、ランチャーで起動する

```powershell
.\claude-tadasaposys.ps1     # = claude --dangerously-skip-permissions
```

- 確認省略モードのため、コマンド実行ポリシーは AI 自身が守る。個人用の `.claude/settings.local.json` の許可設定は、ポリシーより優先されない

### OpenAI Codex

- 入口は `AGENTS.md`（作業前に本ファイルを最後まで読む）
- 起動方針は `.codex/config.toml`。Codex CLI はリポジトリ設定を自動読込しないため、ランチャーで起動する

```powershell
.\codex-tadasaposys.ps1      # = codex --sandbox workspace-write --ask-for-approval on-request -c approvals_reviewer=auto_review
```

---

## ドキュメント索引

| ファイル | 用途 | 対象 |
|---------|------|------|
| `AI_RULES.md`（本ファイル） | AI エージェント共通の開発指示（正本） | AI |
| `CLAUDE.md` / `AGENTS.md` | Claude Code / Codex の入口（本ファイルを読ませるだけ） | AI |
| `docs/SDD.md` | システム詳細設計書（仕様の正本） | AI・開発者 |
| `docs/HANDOVER.md` | 引き継ぎ書（現在地・残作業） | 開発者 |
| `docs/ADR.md` | アーキテクチャ判断記録（ADR-001〜016） | AI・開発者 |
| `docs/RUNBOOK.md` | 運用手順書（デプロイ・障害対応） | 開発者・運用者 |
| `docs/Manual.md` | 操作マニュアル | エンドユーザー |
| `docs/RD.md` | 要件定義 | 参照用 |
| `docs/BUILD_SPEC.md` | 総合仕様書 BSD-001（単独完結・人間可読） | 開発者・運用者・検収担当 |
| `docs/build-from-scratch.html` | ゼロから構築ガイド | 開発者・運用者 |
| `CHANGELOG.md` | 変更履歴 v1.8.1〜 | 全員 |
| `SECURITY.md` | セキュリティ情報・脆弱性報告 | 全員 |
