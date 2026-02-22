# アーキテクチャ意思決定記録 (ADR)

本プロジェクトにおける重要な技術選定および設計判断の記録。

## ADR-001: 認証・認可の二重ガード (Security)
### ステータス
承認済み (Approved)
（内容は既存通り）

---

## ADR-002: React on GAS (Frontend Architecture)
### ステータス
承認済み (Approved)
（内容は既存通り）

---

## ADR-003: タイムスタンプによる主キー管理 (Data Modeling)
### ステータス
承認済み (Approved)
（内容は既存通り）

---

## ADR-004: ライブラリバージョンの固定 (Dependency Management)
### ステータス
承認済み (Approved)

### コンテキスト
`esm.sh` などのCDNを利用してライブラリを読み込む際、バージョン指定が緩い（例: `^18.2.0` や指定なし）と、依存関係解決の過程で意図せず最新版（React 19など）が読み込まれる場合がある。
これにより、アプリケーション本体が参照するReactと、UIライブラリが参照するReactが別インスタンスとなり、`Minified React error #31` 等のクリティカルなエラーが発生した。

### 決定事項
**すべての外部ライブラリの読み込みにおいて、バージョンを完全固定し、かつ依存関係（deps）を明示する。**

*   **悪い例**: `https://esm.sh/lucide-react`
*   **良い例**: `https://esm.sh/lucide-react@0.330.0?deps=react@18.2.0`

### 影響
*   ライブラリのアップデート時は、手動でURLを書き換える必要がある。
*   予期せぬ破壊的変更によるシステムダウンを確実に防ぐことができる。

---

## ADR-005: インライン編集UIパターン（Popover + Overlay）
### ステータス
承認済み (Approved) — v1.9.0

### コンテキスト
管理者が案件のステータス・担当者・上限値を変更する際、従来はページ下部の専用フォームへスクロールして操作する必要があった。UX改善として「該当箇所をクリックして直接変更する」インライン編集が求められた。

### 決定事項
**`fixed inset-0 z-40` の透明オーバーレイ + 相対配置のポップオーバー**パターンを採用する。

*   バッジ/値をクリック → `inlineEditField` state で開くポップオーバーを制御
*   オーバーレイ（透明・全画面）をクリックで閉じる
*   `useEffect` + `keydown` リスナーで Escape キーによるクローズ
*   案件切替時は `useEffect([selectedCaseId])` で自動クリア
*   担当者ドロップダウンは `staffDropdownSearch` state + `filteredStaffForDropdown` useMemo で100名以上に対応

### 理由
*   モーダル（dialog）は既存の完了報告・メール送信等で使用済み。軽微な値変更には重すぎる。
*   ページ内スクロールのポップオーバーは z-index 競合が起きやすいため、`fixed` 配置を採用。

### 影響
*   `inlineEditField: null | 'status' | 'staff' | 'caseLimit' | 'annualLimit'` の state 管理が増加する。
*   ポップオーバーが複数同時に開かないよう、state は単一値で管理する（排他制御）。

---

## ADR-006: 新着バッジの実装方式（ID差分方式 vs タイムスタンプ方式）
### ステータス
承認済み (Approved) — v1.9.0

### コンテキスト
「最後に閲覧した時点から新しい案件が追加・移動した場合にタブにバッジ表示する」機能を実装するにあたり、方式を検討した。

### 選択肢

**A. タイムスタンプ比較方式**: `lastViewed[tab]` (ISO時刻) を保存し、`case.timestamp > lastViewed` でカウント。
*   問題: `case.timestamp` は案件作成日であり、ステータス変更日ではない。別タブに移動した案件は検出不可。

**B. ケースIDセット差分方式**: `lastViewed[tab]` として「その時点でタブに存在したケースIDの配列」を保存し、現在のIDセットとの差分でカウント。
*   利点: ステータス変更による案件移動も正確に検出できる。タイムスタンプに依存しない。

### 決定事項
**B. ケースIDセット差分方式**を採用する。

### 実装詳細
*   localStorage キー: `tadasapo_seenIds_{userEmail}` → `{ unhandled: [...ids], inProgress: [...ids], ... }`
*   タブクリック時に `getTabCases(tabKey).map(c => c.id)` を保存
*   `newCaseCounts` useMemo で `seenIds` に存在しないIDをカウント
*   管理モードのBellボタンで `showNewBadge` (localStorage: `tadasapo_showNewBadge`) をトグル

### 影響
*   初回ロード（localStorageが空）時は全ケースが新着として表示されるが、これは期待された動作。
*   データが静的なローカル開発環境でもタブクリックによる既読化が動作確認できる。