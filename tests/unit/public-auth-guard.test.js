/**
 * v1.14.0 公開関数のサーバー側権限チェック（SEC-01・グランドルール3）
 *
 * GAS では名前が _ で終わらないトップレベル関数は、画面の google.script.run から誰でも呼べる
 * （アクセス=組織内の全員）。そこで gas/ の公開関数はすべて、本体（または XImpl_）で
 *   ・タダメン確認: getActor_() / getStaffByEmail_()
 *   ・管理者確認:   requireAdmin_() / runAdminWrite_()
 * のどれかを行うか、下の EXEMPT に理由つきで登録することを検査する。
 * 内部からしか使わない関数は、公開せず名前を _ で終わらせる。
 */
'use strict';

const { listTopLevelFunctions, extractFunctionSource, readSource } = require('./src/extract-gas');

// 権限チェックをしない公開関数（理由つき）
const EXEMPT = {
  doGet: 'HTML を返すだけ（データは getInitialData がタダメン確認のうえ返す）',
  keepWarm: '時間主導トリガー用。完成品を作り直すだけで、データを返さない',
  setupSettingsSheet: '初回構築用。設定シートが無いときだけ作る（タダメンマスタが無い段階でも実行できる必要がある）',
};

const AUTH_CALLS = ['getActor_(', 'getStaffByEmail_(', 'requireAdmin_(', 'runAdminWrite_('];

const src = readSource();
const all = listTopLevelFunctions();
const names = new Set(all.map((f) => f.name));
const publicFns = all.filter((f) => !f.name.endsWith('_'));

function bodyWithImpl(name) {
  let body = extractFunctionSource(src, name);
  if (names.has(name + 'Impl_')) body += extractFunctionSource(src, name + 'Impl_');
  return body;
}

describe('公開関数はサーバー側で権限を確認する', () => {
  test('公開関数はすべて権限確認を行うか、EXEMPT に理由つきで登録されている', () => {
    const unchecked = publicFns
      .filter((f) => !Object.prototype.hasOwnProperty.call(EXEMPT, f.name))
      .filter((f) => {
        const body = bodyWithImpl(f.name);
        return !AUTH_CALLS.some((c) => body.includes(c));
      })
      .map((f) => f.name);
    expect(unchecked).toEqual([]);
  });

  test('EXEMPT に、もう存在しない関数が残っていない', () => {
    const stale = Object.keys(EXEMPT).filter((n) => !names.has(n));
    expect(stale).toEqual([]);
  });

  test('内部専用の関数は公開しない（名前が _ で終わる）', () => {
    ['getStaffByEmail', 'getMasters', 'getFiscalYear', 'createZoomMeeting', 'createGoogleMeetEvent'].forEach((n) => {
      expect(names.has(n)).toBe(false);
      expect(names.has(n + '_')).toBe(true);
    });
  });

  test('管理者用の保守関数は runAdminWrite_ で包む（内部の移行は XImpl_ を直接呼び、一般のタダメンの操作を止めない）', () => {
    const ensure = extractFunctionSource(src, 'ensureAttachmentSchema_');
    ['addForcedCcSetting', 'addAttachmentsColumnToRecords', 'addScheduleZoomSettings'].forEach((n) => {
      const f = all.find((x) => x.name === n);
      expect(f.firstLine.trim()).toBe('return runAdminWrite_(' + n + 'Impl_, arguments); }');
      expect(ensure).toContain(n + 'Impl_();');
      expect(ensure).not.toContain('  ' + n + '();');
    });
  });
});
