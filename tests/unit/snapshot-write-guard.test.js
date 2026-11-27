/**
 * v1.14.0 書込の検知漏れを防ぐ（ADR-015）
 *
 * 完成品（スナップショット）は「書込のたびに世代を替える」ことで古いデータを配らない。
 * 書込を行う公開関数が runWrite_ で包まれていないと、書込が次の起動に反映されない（最大10分遅れる）。
 * そこで コード.js の公開関数（名前が _ で終わらない関数）をすべて
 *   ・書込: `function X() { return runWrite_(XImpl_, arguments); }` の形
 *   ・読むだけ（完成品に影響しない）: 下の READ_ONLY に理由つきで登録
 * のどちらかに分類させる。公開関数を追加したら、どちらかにすること。
 */
'use strict';

const { listTopLevelFunctions } = require('./src/extract-gas');

// 完成品（案件・マスタ・タダメンマスタ・設定）を変えない公開関数
const READ_ONLY = {
  doGet: 'HTML を返すだけ',
  diagnoseSheetsApiRead: '読込の比較（読むだけ）',
  keepWarm: '完成品を作り直す側',
  setupKeepWarmTrigger: 'トリガーの設定のみ',
  removeKeepWarmTrigger: 'トリガーの削除のみ',
  getInitialData: '完成品を配る側',
  getMyDraftCaseIds: '読むだけ',
  getFiscalYear: '計算のみ',
  getAllCasesJoined: '読むだけ',
  verifyCcDryRun: '設定の確認のみ',
  getThreadMessages: 'Gmail を読むだけ',
  createZoomMeeting: 'Zoom の会議作成のみ（シートへの記録は updateSupportRecord 等が行う）',
  createGoogleMeetEvent: 'カレンダー作成のみ（シートへの記録は updateSupportRecord 等が行う）',
  getScheduleAvailability: '読むだけ（ensureAdminSchema_ の補完は既定値と同じ意味）',
  checkScheduleConflict: '読むだけ',
  getStaffByEmail: '読むだけ',
  getMasters: '読むだけ',
  getAdminPanelData: '読むだけ（ensureAdminSchema_ の補完は既定値と同じ意味）',
  saveDraft: '下書きは完成品に含めない',
  loadDraft: '下書きは完成品に含めない',
  deleteDraft: '下書きは完成品に含めない',
  listDraftsForCase: '読むだけ',
  listScheduledForCase: '読むだけ（廃止機能）',
  setupScheduledEmailTrigger: 'トリガーの削除のみ（廃止機能）',
  removeScheduledEmailTrigger: 'トリガーの削除のみ（廃止機能）',
  getScheduledEmailTriggerStatus: '読むだけ（廃止機能）',
  runCaseKeyMigrationDiagnosis: '監査ログへの記録のみ',
};

const all = listTopLevelFunctions();
const publicFns = all.filter((f) => !f.name.endsWith('_'));
const names = new Set(all.map((f) => f.name));

describe('書込を行う公開関数は runWrite_ で包む（完成品の世代更新）', () => {
  test('公開関数はすべて「書込（runWrite_ で包む）」か「読むだけ（READ_ONLY）」に分類されている', () => {
    const unclassified = publicFns.filter((f) => {
      if (Object.prototype.hasOwnProperty.call(READ_ONLY, f.name)) return false;
      const wrapper = 'return runWrite_(' + f.name + 'Impl_, arguments); }';
      return f.firstLine.trim() !== wrapper;
    }).map((f) => f.name);
    expect(unclassified).toEqual([]);
  });

  test('包んだ公開関数の本体（XImpl_）が存在する', () => {
    const missing = publicFns
      .filter((f) => f.firstLine.includes('runWrite_('))
      .map((f) => f.name + 'Impl_')
      .filter((impl) => !names.has(impl));
    expect(missing).toEqual([]);
  });

  test('READ_ONLY に、もう存在しない関数が残っていない', () => {
    const stale = Object.keys(READ_ONLY).filter((n) => !names.has(n));
    expect(stale).toEqual([]);
  });

  test('主要な書込（担当・完了報告・補正・設定・メンバー）は包まれている', () => {
    const wrapped = new Set(publicFns.filter((f) => f.firstLine.includes('runWrite_(')).map((f) => f.name));
    ['assignCase', 'updateSupportRecord', 'updateCaseDataAdmin', 'updateSettingsAdmin',
      'upsertStaffMember', 'deactivateStaffMember', 'addManualCase', 'deleteCaseAdmin',
      'sendCaseEmail', 'sendNewCaseEmail', 'setAnnualUsageCountAdmin'].forEach((n) => {
      expect(wrapped.has(n)).toBe(true);
    });
  });
});
