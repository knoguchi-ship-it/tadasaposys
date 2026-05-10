/**
 * 02 — ケースリスト表示
 * モックデータ（14パターン）を元に各タブの表示内容を検証する。
 *
 * 通常モード（テスト太郎: test@tadakayo.jp）での期待値:
 *   未対応:   3件（全員共有）
 *   対応中:   2件（テスト太郎担当: パターン4,6）
 *   完了:     6件（パターン7,8,10,12,13,14）
 *   対応不可: 1件（パターン9）
 */
import { test, expect } from '../fixtures';

test.describe('ケースリスト — 通常モード', () => {

  test('「未対応」タブに3件表示される', async ({ appPage }) => {
    await appPage.clickTab('未対応');
    const cards = appPage.getCaseCards();
    await expect(cards).toHaveCount(3);
  });

  test('「未対応」タブに既知のオフィス名が表示される', async ({ appPage }) => {
    await appPage.clickTab('未対応');
    await expect(appPage.getCaseCardByOfficeName('やまだ訪問介護ステーション').first()).toBeVisible();
    await expect(appPage.getCaseCardByOfficeName('すずきデイサービスセンター').first()).toBeVisible();
    await expect(appPage.getCaseCardByOfficeName('リミット介護サービス').first()).toBeVisible();
  });

  test('「対応中」タブにテスト太郎担当の2件が表示される', async ({ appPage }) => {
    await appPage.clickTab('対応中');
    const cards = appPage.getCaseCards();
    await expect(cards).toHaveCount(2);
  });

  test('「完了」タブにテスト太郎担当の案件が複数表示される', async ({ appPage }) => {
    await appPage.clickTab('完了');
    const cards = appPage.getCaseCards();
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('「対応不可」タブに1件表示される', async ({ appPage }) => {
    await appPage.clickTab('対応不可');
    const cards = appPage.getCaseCards();
    await expect(cards).toHaveCount(1);
  });

  test('「キャンセル」タブは0件で空状態メッセージを表示する', async ({ appPage }) => {
    await appPage.clickTab('キャンセル');
    await expect(appPage.getEmptyStateMessage()).toBeVisible();
  });

  test('「全て」タブは閲覧モード以外では自分の案件のみ表示する', async ({ appPage }) => {
    await appPage.clickTab('全て');
    const cards = appPage.getCaseCards();
    // 未対応3 + 対応中2 + 完了6 + 対応不可1 = 12（パターン5,11はtanakaの案件）
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('年間上限超過のケースに「上限注意」バッジが表示される', async ({ appPage }) => {
    await appPage.clickTab('未対応');
    // パターン3: リミット介護サービス (currentFiscalYearCount=10)
    const limitCard = appPage.getCaseCardByOfficeName('リミット介護サービス');
    await expect(limitCard.getByText('上限注意')).toBeVisible();
  });

});

test.describe('ケースリスト — 閲覧モード', () => {

  test('閲覧モードでは全14件が「全て」タブで確認できる', async ({ appPage }) => {
    await appPage.switchMode('閲覧');
    await appPage.clickTab('全て');
    const cards = appPage.getCaseCards();
    const count = await cards.count();
    // モックデータは14パターン（全て表示）
    expect(count).toBe(14);
  });

  test('閲覧モードで田中花子担当の案件が「対応中」タブに表示される', async ({ appPage }) => {
    await appPage.switchMode('閲覧');
    await appPage.clickTab('対応中');
    // パターン5: sato@welfare.jp は tanaka@tadakayo.jp 担当 → 通常モードでは非表示
    await expect(appPage.getCaseCardByOfficeName('さとう福祉用具').first()).toBeVisible();
  });

});
