/**
 * 12 — 申込通知チャットへのリンク（v1.12.13）
 *
 * 申込通知 bot（回答スプシの onFormSubmit）が Webhook 投稿時のスレッド名を
 * 「チャット連携」シートへ記録し、バックエンドが案件と突合して chatThreadUrl を返す。
 * 案件詳細の「相談内容」見出し横に「チャットを開く」リンクを出し、挙手・担当調整の
 * スレッドへ直接飛べるようにする。
 *
 * ローカルモック: やまだ訪問介護ステーション（未対応）/ たなかヘルパーセンター（対応中）に
 * chatThreadUrl あり。すずきデイサービスセンターはなし（実装前の申込・手動追加案件相当）。
 */
import { test, expect } from '../fixtures';

test.describe('申込通知チャットへのリンク', () => {

  test('スレッドが紐づく案件では「チャットを開く」リンクが新しいタブで開く設定で表示される', async ({ appPage }) => {
    await appPage.clickTab('未対応');
    await appPage.selectCase('やまだ訪問介護ステーション');

    const link = appPage.page.locator('.max-w-3xl').getByRole('link', { name: /チャットを開く/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://chat.google.com/room/MOCKSPACE/mockThread001/mockThread001');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
  });

  test('対応中の案件でもリンクが表示される', async ({ appPage }) => {
    await appPage.clickTab('対応中');
    await appPage.selectCase('たなかヘルパーセンター');

    await expect(appPage.page.locator('.max-w-3xl').getByRole('link', { name: /チャットを開く/ }))
      .toHaveAttribute('href', 'https://chat.google.com/room/MOCKSPACE/mockThread004/mockThread004');
  });

  test('スレッドが紐づかない案件ではリンクを表示しない', async ({ appPage }) => {
    await appPage.clickTab('未対応');
    await appPage.selectCase('すずきデイサービスセンター');

    await expect(appPage.page.locator('.max-w-3xl').getByText('相談内容')).toBeVisible();
    await expect(appPage.page.locator('.max-w-3xl').getByRole('link', { name: /チャットを開く/ })).toHaveCount(0);
  });

});
