/**
 * 05 — ケース詳細パネル
 * ケースカードをクリックして詳細パネルが開くことを検証する。
 * アクションボタンの表示条件（通常 vs 年間上限超過）も確認する。
 */
import { test, expect } from '../fixtures';

test.describe('ケース詳細パネル', () => {

  test('未対応のケースをクリックすると詳細パネルが開く', async ({ appPage }) => {
    await appPage.clickTab('未対応');
    await appPage.selectCase('やまだ訪問介護ステーション');
    expect(await appPage.isDetailPanelOpen()).toBe(true);
  });

  test('詳細パネルにオフィス名が表示される', async ({ appPage }) => {
    await appPage.clickTab('未対応');
    await appPage.selectCase('やまだ訪問介護ステーション');
    // 詳細パネル内の見出し
    await expect(appPage.page.locator('.max-w-3xl').getByText('やまだ訪問介護ステーション')).toBeVisible();
  });

  test('通常の未対応ケースに「担当する」ボタンが表示される', async ({ appPage }) => {
    await appPage.clickTab('未対応');
    await appPage.selectCase('やまだ訪問介護ステーション');
    expect(await appPage.hasAssignButtons()).toBe(true);
    expect(await appPage.hasDeclineButton()).toBe(false);
  });

  test('年間上限超過ケースに「回数超過」ボタンのみ表示される', async ({ appPage }) => {
    await appPage.clickTab('未対応');
    // パターン3: リミット介護サービス (currentFiscalYearCount=10)
    await appPage.selectCase('リミット介護サービス');
    expect(await appPage.hasDeclineButton()).toBe(true);
    expect(await appPage.hasAssignButtons()).toBe(false);
  });

  test('対応中のケース詳細に担当者名が表示される', async ({ appPage }) => {
    await appPage.clickTab('対応中');
    await appPage.selectCase('たなかヘルパーセンター');
    // 担当者名はヘッダーの担当者バッジに表示される。
    // メールスレッド本文にも「テスト太郎 様」が含まれ strict locator が複数一致するため、
    // DOM 上先頭（担当者バッジ）に .first() で限定する。
    await expect(appPage.page.locator('.max-w-3xl').getByText('テスト太郎').first()).toBeVisible();
  });

  test('完了ケースに「N回目を開始」ボタンが表示される（supportCount < 上限）', async ({ appPage }) => {
    await appPage.clickTab('完了');
    // パターン7: yamada 2回目で完了 → 「3回目を開始」ボタンが表示される
    await appPage.selectCase('やまだ訪問介護ステーション');
    // ボタンテキストは "{supportCount+1}回目を開始" の形式
    const reopenBtn = appPage.getActionButton(/\d+回目を開始/);
    await expect(reopenBtn).toBeVisible();
  });

  test('完了ケース（3回目 & 上限）には「N回目を開始」ボタンが表示されない', async ({ appPage }) => {
    await appPage.clickTab('完了');
    // パターン8: ito supportCount=3（上限 = 3回目完了）→ ボタン非表示
    await appPage.selectCase('いとう在宅ケアセンター');
    const reopenBtn = appPage.getActionButton(/\d+回目を開始/);
    await expect(reopenBtn).not.toBeVisible();
  });

});
