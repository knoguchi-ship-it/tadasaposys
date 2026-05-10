/**
 * カスタム Fixture — AppPage を自動セットアップ
 * 参考: https://playwright.dev/docs/test-fixtures
 * test.extend() でテストファイル側が AppPage を直接受け取れる
 */
import { test as base } from '@playwright/test';
import { AppPage } from '../pages/app.page';

/** fixture 型定義 */
type AppFixtures = {
  appPage: AppPage;
};

/** goto 済みの AppPage を提供する fixture */
export const test = base.extend<AppFixtures>({
  appPage: async ({ page }, use) => {
    const appPage = new AppPage(page);
    await appPage.goto();
    await use(appPage);
    // teardown: 不要（ブラウザコンテキストは自動クリーンアップ）
  },
});

export { expect } from '@playwright/test';
