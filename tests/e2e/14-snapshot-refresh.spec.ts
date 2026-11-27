/**
 * 14 — 初期データの完成品と「最新に更新」（v1.14.0・ADR-015）
 *
 * サーバーは組み立て済みの完成品（スナップショット）を返し、画面右上に「HH:MM 時点」を出す。
 * IMPORTRANGE で入るフォーム申込やシートの直接編集は、5分ごとの作り直しか「最新に更新」で反映する。
 * 下書きバッジは利用者ごとに違うため完成品に含めず、画面表示後・更新後に getMyDraftCaseIds で取り直す。
 *
 * 本スペックは次を保護する:
 *   - 起動後に「HH:MM 時点」と「最新に更新」ボタンが表示される
 *   - 「最新に更新」で作り直したデータを受け取り、一覧・詳細の表示が保たれる
 *   - 更新後も下書きバッジ（下書き一覧）が消えない（下書きの取り直しが働く）
 */
import { test, expect } from '../fixtures';

test.describe('初期データの完成品と「最新に更新」', () => {

  test('起動後にデータの時点と「最新に更新」ボタンが表示される', async ({ appPage }) => {
    const page = appPage.page;
    await expect(page.getByRole('button', { name: '最新に更新' })).toBeVisible();
    await expect(page.getByTestId('snapshot-time')).toHaveText(/^\d{2}:\d{2} 時点$/);
  });

  test('「最新に更新」で作り直したデータを受け取り、選択中の案件の詳細が保たれる', async ({ appPage }) => {
    const page = appPage.page;
    await appPage.clickTab('未対応');
    await appPage.selectCase('やまだ訪問介護ステーション');

    const button = page.getByRole('button', { name: '最新に更新' });
    await button.click();
    await expect(appPage.getToast('最新のデータに更新しました')).toBeVisible();
    await expect(button).toBeEnabled();

    // 一覧と詳細は更新後も表示されたまま
    await expect(page.locator('.max-w-3xl').getByText('相談内容')).toBeVisible();
    await expect(page.getByTestId('snapshot-time')).toHaveText(/^\d{2}:\d{2} 時点$/);
  });

  test('更新後も下書き一覧が消えない（下書きは利用者ごとに取り直す）', async ({ appPage }) => {
    await appPage.clickTab('対応中');
    await appPage.selectCase('たなかヘルパーセンター');

    await appPage.openThreadReply();
    await appPage.saveDraftInModal();
    await appPage.closeEmailModal();
    await expect(appPage.getDraftListHeading()).toContainText('下書き (1件)');

    await appPage.page.getByRole('button', { name: '最新に更新' }).click();
    await expect(appPage.getToast('最新のデータに更新しました')).toBeVisible();

    // 一覧の「下書きあり」バッジと、詳細の下書き一覧が残っている
    await expect(appPage.page.getByText('下書きあり').first()).toBeVisible();
    await expect(appPage.getDraftListHeading()).toContainText('下書き (1件)');
  });

});
