/**
 * 13 — 秘密情報の書込専用設定（v1.13.0 / ADR-014）
 *
 * Zoom 連携の秘密情報（ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET / ZOOM_FIXED_URL / ZOOM_FIXED_PASS）は
 * スクリプトプロパティに保存し、管理画面へ値を返さない（入力欄は password・常に空・状態だけ表示）。
 * 設定シートに平文で残っている場合は警告と「秘密情報をプロパティへ移行」ボタンを出す。
 *
 * ローカルモック: mockSecretStatus（ACCOUNT/CLIENT_ID/SECRET = 'sheet'、FIXED_URL = 'property'、FIXED_PASS = 'none'）。
 */
import { test, expect } from '../fixtures';

async function openIntegrationSettings(appPage: import('../pages/app.page').AppPage) {
  await appPage.switchMode('管理');
  await appPage.page.getByRole('button', { name: '設定管理' }).click();
  await appPage.page.getByRole('button', { name: '連携', exact: true }).click();
}

test.describe('秘密情報の書込専用設定', () => {

  test('秘密情報は password 入力で値を表示せず、シート残存の警告と移行ボタンが出る', async ({ appPage }) => {
    await openIntegrationSettings(appPage);
    const page = appPage.page;

    const secret = page.getByTestId('secret-ZOOM_CLIENT_SECRET');
    const input = secret.getByLabel('Zoom Client Secret（書込専用）');
    await expect(input).toHaveAttribute('type', 'password');
    await expect(input).toHaveValue('');
    await expect(secret).toContainText('設定シートに平文で残っています');

    // プロパティ保存済みの項目は「保存済み」表示
    await expect(page.getByTestId('secret-ZOOM_FIXED_URL')).toContainText('スクリプトプロパティに保存済み');

    await expect(page.getByRole('button', { name: '秘密情報をプロパティへ移行' })).toBeVisible();
  });

  test('移行ボタンでシート残存が解消し、警告と移行ボタンが消える', async ({ appPage }) => {
    await openIntegrationSettings(appPage);
    const page = appPage.page;

    await page.getByRole('button', { name: '秘密情報をプロパティへ移行' }).click();
    await expect(page.getByText('移行 3件')).toBeVisible();
    await expect(page.getByTestId('secret-ZOOM_CLIENT_SECRET')).toContainText('スクリプトプロパティに保存済み');
    await expect(page.getByRole('button', { name: '秘密情報をプロパティへ移行' })).toHaveCount(0);
  });

  test('新しい値を保存すると保存済みになり、入力欄は空に戻る（値は画面に返らない）', async ({ appPage }) => {
    await openIntegrationSettings(appPage);
    const page = appPage.page;

    const pass = page.getByTestId('secret-ZOOM_FIXED_PASS');
    await expect(pass).toContainText('未設定');
    await pass.getByLabel('固定Zoomパスコード（書込専用）').fill('dummy-pass-123');
    await page.getByRole('button', { name: '設定を保存' }).click();

    await expect(page.getByText('設定を保存しました。')).toBeVisible();
    await expect(pass).toContainText('スクリプトプロパティに保存済み');
    await expect(pass.getByLabel('固定Zoomパスコード（書込専用）')).toHaveValue('');
    await expect(page.locator('body')).not.toContainText('dummy-pass-123');
  });

});
