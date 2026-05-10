/**
 * 01 — アプリ初期化・基本レイアウト
 */
import { test, expect } from '../fixtures';

test.describe('アプリ初期化', () => {

  test('ページタイトルとヘッダーが表示される', async ({ appPage }) => {
    await expect(appPage.appTitle).toBeVisible();
    await expect(appPage.header).toBeVisible();
  });

  test('ログインユーザー名が表示される', async ({ appPage }) => {
    await expect(appPage.userName).toBeVisible();
  });

  test('表示モードグループが表示される', async ({ appPage }) => {
    await expect(appPage.modeGroup).toBeVisible();
    await expect(appPage.modeGroup.getByRole('button', { name: '通常' })).toBeVisible();
    await expect(appPage.modeGroup.getByRole('button', { name: '閲覧' })).toBeVisible();
    await expect(appPage.modeGroup.getByRole('button', { name: '管理' })).toBeVisible();
  });

  test('デフォルトモードは「通常」', async ({ appPage }) => {
    const mode = await appPage.getCurrentMode();
    expect(mode).toBe('通常');
  });

  test('ステータスタブ一覧が表示される（role="tab"）', async ({ appPage }) => {
    await expect(appPage.tabList).toBeVisible();
    // タブは role="tab" を持つ
    for (const tab of ['未対応', '対応中', '完了', 'キャンセル', '対応不可', '全て'] as const) {
      await expect(appPage.getTab(tab)).toBeVisible();
    }
  });

  test('検索ボックスが表示される', async ({ appPage }) => {
    await expect(appPage.searchInput).toBeVisible();
  });

  test('document.title がアプリ名を含む', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/タダサポ/);
  });

});
