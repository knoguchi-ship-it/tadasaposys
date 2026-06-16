/**
 * 11 — サポート終了メール（v1.12.11 回帰ガード）
 *
 * 完了報告モーダルに「サポート終了メールを送信する」チェック（既定ON）を追加し、
 * 完了と同時に相談者へ終了連絡メールを既存スレッドへ返信送信する機能を保護する。
 * 件名・本文は管理設定（MAIL_CLOSING_SUBJECT / MAIL_CLOSING_BODY）で編集可能。
 *
 * ローカルモック（sendCaseEmail/sendNewCaseEmail, IS_LOCAL）は backend と同様に
 * 既存スレッドへ返信追記する。emailTemplates.closing* と MOCK_SETTINGS により
 * テンプレ取得・タグ置換・設定画面表示を再現する。
 */
import { test, expect } from '../fixtures';

test.describe('サポート終了メール', () => {

  test('完了報告でサポート終了メールを送信する（既定ON）', async ({ appPage }) => {
    // たなかヘルパーセンター: 対応中 / 既存スレッド（mock-thread-1）あり
    await appPage.clickTab('対応中');
    await appPage.openReportModal('たなかヘルパーセンター');

    // チェックは既定ON
    await expect(appPage.getClosingEmailCheckbox()).toBeChecked();

    await appPage.fillReportContent('Excel支援を実施。完了。');
    await appPage.submitReport();

    // 完了報告＋終了メール送信の両方のトーストが出る（壊れたコードでは終了メールが送られない）
    await expect(appPage.getToast('完了報告を保存しました')).toBeVisible();
    await expect(appPage.getToast('サポート終了メールを送信しました')).toBeVisible();
  });

  test('チェックOFFならサポート終了メールは送信されない', async ({ appPage }) => {
    // もり小規模多機能ホーム: 対応中
    await appPage.clickTab('対応中');
    await appPage.openReportModal('もり小規模多機能ホーム');

    await appPage.getClosingEmailCheckbox().uncheck();
    await appPage.fillReportContent('完了（終了メールは送らない）。');
    await appPage.submitReport();

    await expect(appPage.getToast('完了報告を保存しました')).toBeVisible();
    // 終了メールのトーストは出ない
    await expect(appPage.getToast('サポート終了メールを送信しました')).toHaveCount(0);
  });

});
