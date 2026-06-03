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

  test('管理モードで今年度利用数（実数）を手動修正できる（v1.12.4）', async ({ appPage }) => {
    await appPage.clickTab('対応中');
    await appPage.selectCase('さとう福祉用具');
    // 今年度利用数バッジ（title で一意）を開く。初期は base のみ（"2 / 10"）。
    const annualBtn = appPage.page.locator('button[title="クリックして利用回数・上限を変更"]');
    await expect(annualBtn).toContainText('2 / 10');
    await annualBtn.click();
    // 実数入力（min=0 が今年度利用数の入力。上限入力は min=1）
    const countInput = appPage.page.locator('input[type="number"][min="0"]');
    await countInput.fill('4');
    await appPage.page.getByRole('button', { name: '利用回数を保存' }).click();
    // 補正 +2 が反映され "4 / 10" になる
    await expect(annualBtn).toContainText('4 / 10');
  });

});

test.describe('管理者専用ボタン', () => {

  test('管理モードにヘッダーに管理者用ボタンが表示される', async ({ appPage }) => {
    await appPage.switchMode('管理');
    const toolbar = appPage.page.getByRole('toolbar', { name: '表示モード切替' });
    await expect(toolbar).toBeVisible();
  });

});
