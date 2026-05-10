/**
 * 04 — 検索・フィルタ
 * キーワード検索と空状態メッセージを検証する。
 */
import { test, expect } from '../fixtures';

test.describe('キーワード検索', () => {

  test.beforeEach(async ({ appPage }) => {
    // 全件表示の「全て」タブから検索
    await appPage.switchMode('閲覧');
    await appPage.clickTab('全て');
  });

  test('事業所名でフィルタされる', async ({ appPage }) => {
    await appPage.search('やまだ');
    const cards = appPage.getCaseCards();
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
    // 他の事業所が消えていることを確認
    await expect(appPage.getCaseCardByOfficeName('すずきデイサービスセンター')).toHaveCount(0);
  });

  test('担当者名でフィルタされる', async ({ appPage }) => {
    await appPage.search('田中花子');
    const cards = appPage.getCaseCards();
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('都道府県名でフィルタされる', async ({ appPage }) => {
    await appPage.search('福岡');
    const cards = appPage.getCaseCards();
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('存在しないキーワードでは空状態メッセージが表示される', async ({ appPage }) => {
    await appPage.search('存在しないキーワード12345xyz');
    await expect(appPage.getEmptyStateMessage()).toBeVisible();
    await expect(appPage.page.getByText('検索条件に一致する案件がありません')).toBeVisible();
  });

  test('検索をクリアすると全件が戻る', async ({ appPage }) => {
    await appPage.search('やまだ');
    const filteredCount = await appPage.getCaseCards().count();

    await appPage.clearSearch();
    const allCount = await appPage.getCaseCards().count();

    expect(allCount).toBeGreaterThan(filteredCount);
  });

  test('検索ボックスに入力後、クリアボタンで消去できる', async ({ appPage }) => {
    await appPage.search('テスト');
    await expect(appPage.searchClearBtn).toBeVisible();
    await appPage.searchClearBtn.click();
    await expect(appPage.searchInput).toHaveValue('');
  });

});
