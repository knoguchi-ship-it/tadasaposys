/**
 * 09 — 管理機能ステータス遷移（T2 / v1.11.6 回帰ガード）
 *
 * v1.11.6 で adminTransitionStatus_() を新設し、管理者のステータス変更が
 * STATUS 列だけでなく付随する DB 操作（HISTORY 保存・supportCount 調整・
 * フィールドクリア）を確実に実行するようになった。本スペックはその遷移結果が
 * UI に正しく反映されることを保護する。
 *
 * ローカルモック（setCaseStatusAdmin / IS_LOCAL）は backend の
 * adminTransitionStatus_() と同等の挙動を再現している:
 *   - completed → inProgress : HISTORY 追加 + supportCount+1 + 実施情報クリア
 *   - → unhandled            : 担当・実施情報クリア + supportCount=1
 *   - その他（→ cancelled 等）: STATUS のみ変更
 */
import { test, expect } from '../fixtures';

test.describe('管理者ステータスインライン遷移', () => {

  test.beforeEach(async ({ appPage }) => {
    await appPage.switchMode('管理');
  });

  test('完了 → 対応中（再開）で回数が +1 され実施情報がクリアされる', async ({ appPage }) => {
    // なかむらグループホーム: 完了 / supportCount=1 / 上限デフォルト3
    await appPage.clickTab('完了');
    await appPage.selectCase('なかむらグループホーム');

    await expect(appPage.getStatusBadge()).toContainText('完了');
    await expect(appPage.getCaseCountBadge()).toContainText('1 / 3');

    await appPage.changeStatusInline('対応中');

    await expect(appPage.getToast('ステータスを変更しました。')).toBeVisible();
    await expect(appPage.getStatusBadge()).toContainText('対応中');
    // 再開で supportCount が 1 → 2 に増える（壊れたコードでは 1 のまま）
    await expect(appPage.getCaseCountBadge()).toContainText('2 / 3');
  });

  test('完了 → 未対応（リセット）で担当・回数バッジがクリアされる', async ({ appPage }) => {
    // いとう在宅ケアセンター: 完了 / supportCount=3
    await appPage.clickTab('完了');
    await appPage.selectCase('いとう在宅ケアセンター');

    await expect(appPage.getStatusBadge()).toContainText('完了');
    await expect(appPage.getCaseCountBadge()).toBeVisible();

    await appPage.changeStatusInline('未対応');

    await expect(appPage.getToast('ステータスを変更しました。')).toBeVisible();
    await expect(appPage.getStatusBadge()).toContainText('未対応');
    // 未対応では案件回数バッジが非表示になる（supportCount=1 にリセット済み）
    await expect(appPage.getCaseCountBadge()).toHaveCount(0);
  });

  test('対応中 → キャンセル（単純遷移）でステータスのみ変わる', async ({ appPage }) => {
    // もり小規模多機能ホーム: 対応中 / supportCount=3
    await appPage.clickTab('対応中');
    await appPage.selectCase('もり小規模多機能ホーム');

    await expect(appPage.getStatusBadge()).toContainText('対応中');

    await appPage.changeStatusInline('キャンセル');

    await expect(appPage.getToast('ステータスを変更しました。')).toBeVisible();
    await expect(appPage.getStatusBadge()).toContainText('キャンセル');
    // 単純遷移では回数はクリアされない（supportCount 維持）
    await expect(appPage.getCaseCountBadge()).toContainText('3 / 3');
  });

});
