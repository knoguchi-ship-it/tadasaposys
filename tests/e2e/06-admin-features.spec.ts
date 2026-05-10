/**
 * 06 — 管理者機能
 * 管理モードでのインライン編集UIと管理者専用ボタンを検証する。
 * モックユーザー（テスト太郎）は isAdmin=true。
 */
import { test, expect } from '../fixtures';

test.describe('管理モード', () => {

  test.beforeEach(async ({ appPage }) => {
    await appPage.switchMode('管理');
  });

  test('管理モード切替後、管理ボタンが aria-pressed=true になる', async ({ appPage }) => {
    const adminBtn = appPage.modeGroup.getByRole('button', { name: '管理' });
    await expect(adminBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('管理モードで全ての案件が「全て」タブに表示される', async ({ appPage }) => {
    await appPage.clickTab('全て');
    const count = await appPage.getCaseCards().count();
    expect(count).toBe(14);
  });

  test('管理モードで案件詳細のステータスバッジがクリック可能（インライン編集）', async ({ appPage }) => {
    await appPage.clickTab('未対応');
    await appPage.selectCase('やまだ訪問介護ステーション');
    // 管理モードではステータスバッジがボタン（Edit アイコン付き）になる
    // .max-w-3xl 内の未対応ステータスバッジ
    const statusBtn = appPage.page.locator('.max-w-3xl').locator('button').filter({
      hasText: '未対応',
    }).first();
    await expect(statusBtn).toBeVisible();
    await expect(statusBtn).toBeEnabled();
  });

  test('ステータスバッジをクリックするとドロップダウンが開く', async ({ appPage }) => {
    await appPage.clickTab('未対応');
    await appPage.selectCase('やまだ訪問介護ステーション');
    const statusBtn = appPage.page.locator('.max-w-3xl').locator('button').filter({
      hasText: '未対応',
    }).first();
    await statusBtn.click();
    // ドロップダウン（absolute z-50）が表示される
    const dropdown = appPage.getInlineEditDropdown();
    await expect(dropdown).toBeVisible();
  });

  test('管理モードで案件回数「n / 上限」テキストが表示される', async ({ appPage }) => {
    await appPage.clickTab('対応中');
    await appPage.selectCase('たなかヘルパーセンター');
    // 管理モードでは案件回数がクリック可能ボタンとして表示される（"1 / 3" 形式）
    const countBtn = appPage.page.locator('.max-w-3xl').locator('button').filter({
      hasText: /\d+ \/ \d+/,
    }).first();
    await expect(countBtn).toBeVisible();
  });

});

test.describe('管理者専用ボタン', () => {

  test('管理モードにヘッダーに管理者用ボタンが表示される', async ({ appPage }) => {
    await appPage.switchMode('管理');
    const toolbar = appPage.page.getByRole('toolbar', { name: '表示モード切替' });
    await expect(toolbar).toBeVisible();
  });

});
