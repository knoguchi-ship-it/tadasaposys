/**
 * 11 — サポート終了メール（v1.12.11 機能 / v1.12.12 で「送信前に編集」方式へ）
 *
 * 完了報告モーダルに「サポート終了メールを送信する」チェック（既定ON）を追加。
 * v1.12.12 以降は、完了報告のあと**テンプレートを入れたメール作成モーダル**を開き、
 * ログイン中のメンバーが件名・本文をその場で書き換えて送信する（既存スレッドへ返信／
 * 無ければ新規）。送信しない場合は×で閉じる。本テンプレ初期値は管理設定で編集可能
 * （MAIL_CLOSING_SUBJECT / MAIL_CLOSING_BODY）。
 *
 * ローカルモック（sendCaseEmail/sendNewCaseEmail, IS_LOCAL）は backend 同様に
 * 既存スレッドへ返信追記する。emailTemplates.closing* と MOCK_SETTINGS で再現。
 */
import { test, expect } from '../fixtures';

test.describe('サポート終了メール', () => {

  test('完了報告ONで終了メール作成画面が開き、編集してその場で送信できる', async ({ appPage }) => {
    // たなかヘルパーセンター: 対応中 / 既存スレッド（mock-thread-1）あり
    await appPage.clickTab('対応中');
    await appPage.openReportModal('たなかヘルパーセンター');

    // チェックは既定ON
    await expect(appPage.getClosingEmailCheckbox()).toBeChecked();

    await appPage.fillReportContent('Excel支援を実施。完了。');
    await appPage.submitReport();

    // 完了報告が保存され、続けて「サポート終了メール送信」モーダルが開く（編集可能）
    await expect(appPage.getToast('完了報告を保存しました')).toBeVisible();
    await expect(appPage.getEmailModalHeading()).toBeVisible();
    await expect(appPage.getEmailSubjectInput()).toHaveValue(/サポート完了/);

    // その場で送信（壊れたコードでは終了メールモーダルが開かず送信できない）
    await appPage.getEmailSendButton().click();
    await expect(appPage.getToast('サポート終了メールを送信しました')).toBeVisible();
  });

  test('チェックOFFなら終了メール作成画面は開かない', async ({ appPage }) => {
    // もり小規模多機能ホーム: 対応中
    await appPage.clickTab('対応中');
    await appPage.openReportModal('もり小規模多機能ホーム');

    await appPage.getClosingEmailCheckbox().uncheck();
    await appPage.fillReportContent('完了（終了メールは送らない）。');
    await appPage.submitReport();

    await expect(appPage.getToast('完了報告を保存しました')).toBeVisible();
    // 終了メール作成モーダルは開かない
    await expect(appPage.getEmailModalHeading()).toHaveCount(0);
  });

});
