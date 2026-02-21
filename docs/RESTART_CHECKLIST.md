# 開発再開チェックリスト（v1.8.1）

最終更新: 2026/02/20

## 1. 事前確認（開始前5分）
1. `git status` が想定どおりか確認する（未コミット変更の把握）。
2. `docs/HANDOVER.md` と `docs/SDD.md` のバージョンが `1.8.1` で一致していることを確認する。
3. 作業対象が `index.html` / `コード.js` / `docs/SDD.md` / `docs/HANDOVER.md` のどれかを明確にする。

## 2. 環境確認（初日）
1. GAS 側で `SPREADSHEET_ID` が正しいことを確認する。
2. `setupSettingsSheet` を実行済みか確認し、未実施なら実行する。
3. 「設定」シートの `ADMIN_EMAILS` を設定する。
4. GAS のサービスで `Google Calendar API` と `Gmail API` が有効か確認する。
5. 添付機能を使う場合は `ATTACHMENT_FOLDER_ID` を設定する。

## 3. ローカル確認
1. `npx serve -s . -l 3000` で画面を起動する。
2. 以下を最低限確認する。
- タブ切替（未対応/対応中/完了/対応不可）
- 担当操作（メールあり/なし）
- 回数超過時の「回数超過」導線
- 完了案件の再開（3回上限）
- ダッシュボード閲覧専用モード

## 4. 実装時の固定ルール
1. React は `18.2.0` 固定。`lucide-react` には `?deps=react@18.2.0` を付与する。
2. `clasp push` は必ず `clasp push --force` を使う。
3. `clasp pull` の前に必ずコミットする（ローカル上書き対策）。
4. データ列定義は `IDX` を唯一の参照元として扱う。

## 5. 変更完了時（PR/デプロイ前）
1. 仕様変更がある場合、以下4ファイルの更新漏れを確認する。
- `コード.js`
- `index.html`
- `docs/SDD.md`
- `docs/HANDOVER.md`
2. 画面文言は日本語表記ルールに沿っているか確認する。
3. 年間制限（10回）と案件上限（3回）に関する回帰確認を行う。

## 6. デプロイ手順
1. `git add <files> && git commit -m "..."`  
2. `clasp push --force`  
3. `clasp deploy -i AKfycbwEhK-pEBSOS4Rjti9lhU2fn1cFQ0ON9E4vh-XSS3bMB3KzSbHPipqcQ65nuq0ZJHhhUQ -d "vX.X.X"`  

## 7. 次開発の優先順（HANDOVER準拠）
1. 管理者機能（`ADMIN_EMAILS` 前提）
2. エクスポート機能（CSV）
3. 案件中止フラグ（`cancelled`）
4. 検索機能スマート化
