/**
 * 10 — メール下書き一覧（v1.12.10 回帰ガード）
 *
 * これまで保存済みのメール下書きは「下書きあり」バッジが出るだけで、案件詳細から
 * 一覧表示・再編集・送信する導線が無く、既存スレッドへの返信下書きが事実上開けない
 * 不具合があった（HANDOVER 報告）。v1.12.10 で案件詳細に「下書き一覧」を新設し、
 * 「開く」で該当メールモーダルを復元（再編集・送信）、「削除」で破棄できるようにした。
 *
 * 本スペックは次を保護する:
 *   - 返信下書きを保存すると案件詳細に「下書き (N件)」が表示される
 *   - 「開く」でモーダルが復元され、そのまま送信できる（送信後は一覧から消える）
 *   - 「削除」で下書きが一覧から消える
 *
 * ローカルモック（saveDraft/loadDraft/deleteDraft/listDraftsForCase, IS_LOCAL）は
 * backend と同形状（caseId|mode|threadId キー）でメモリ保持し挙動を再現する。
 */
import { test, expect } from '../fixtures';

test.describe('メール下書き一覧', () => {

  test('返信下書きが案件詳細に一覧表示され、「開く」で復元して送信できる', async ({ appPage }) => {
    // たなかヘルパーセンター: 対応中 / 既存スレッド（mock-thread-1）あり
    await appPage.clickTab('対応中');
    await appPage.selectCase('たなかヘルパーセンター');

    // 保存前は下書き一覧セクションが無い
    await expect(appPage.getDraftListHeading()).toHaveCount(0);

    // 既存スレッドへの返信を開いて下書き保存
    await appPage.openThreadReply();
    await appPage.saveDraftInModal();
    await appPage.closeEmailModal();

    // 案件詳細に「下書き (1件)」が表示され、種別ラベルが「スレッド返信」
    await expect(appPage.getDraftListHeading()).toContainText('下書き (1件)');
    await expect(appPage.getDraftListSection()).toContainText('スレッド返信');

    // 「開く」で返信モーダルが復元される（件名は Re: で始まる）
    await appPage.getDraftOpenButton().click();
    await expect(appPage.getEmailModalHeading()).toBeVisible();
    await expect(appPage.getEmailSubjectInput()).toHaveValue(/^Re:/);

    // そのまま送信でき、送信後は下書き一覧が消える
    await appPage.getEmailSendButton().click();
    await expect(appPage.getToast('メールを送信しました')).toBeVisible();
    await expect(appPage.getDraftListHeading()).toHaveCount(0);
  });

  test('「削除」で下書きが一覧から消える', async ({ appPage }) => {
    await appPage.clickTab('対応中');
    await appPage.selectCase('たなかヘルパーセンター');

    await appPage.openThreadReply();
    await appPage.saveDraftInModal();
    await appPage.closeEmailModal();

    await expect(appPage.getDraftListHeading()).toContainText('下書き (1件)');

    await appPage.getDraftDeleteButton().click();
    await expect(appPage.getToast('下書きを削除しました')).toBeVisible();
    await expect(appPage.getDraftListHeading()).toHaveCount(0);
  });

});
