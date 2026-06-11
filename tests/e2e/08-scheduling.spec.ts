/**
 * 08 — 日程確定刷新（T1 / v1.11.7〜v1.12.0）
 *
 * 日程確定モーダルの以下を保護する E2E:
 *   - FullCalendar 埋込み（Phase 3 / v1.11.9）
 *   - method=Zoom 時のチームカレンダー強制登録の警告（Phase 2 / v1.11.8）
 *   - Zoom URL 発行モード（新規発行 / いつものタダスクID）（Phase 4 / v1.12.0）
 *   - 重複検知バナーと送信ブロック（Phase 2 / v1.11.8、Zoom 時のみ）
 *
 * ローカルモック（IS_LOCAL）の挙動:
 *   - checkScheduleConflict: 開始時刻が 14:00 ちょうどのときだけ重複扱い
 *   - 重複チェックは method=Zoom 時のみ有効（GoogleMeet/対面/電話等はチェックなし）
 *   - masters.zoomFixedConfigured = true（固定Zoom 設定済みとして扱う）
 */
import { test, expect } from '../fixtures';

// 対応中・scheduledDateTime あり（ボタンは「日時変更」）。method 初期値は GoogleMeet。
const IN_PROGRESS_CASE = 'たなかヘルパーセンター';

test.describe('日程確定モーダル', () => {

  test.beforeEach(async ({ appPage }) => {
    await appPage.clickTab('対応中');
    await appPage.openScheduleModal(IN_PROGRESS_CASE);
  });

  test('日時・方法・FullCalendar が表示される', async ({ appPage }) => {
    await expect(appPage.getScheduleDateTimeInput()).toBeVisible();
    await expect(appPage.getMethodSelect()).toBeVisible();
    // FullCalendar グローバルバンドル（CDN）の初期化に余裕を持たせる
    await expect(appPage.getFullCalendar()).toBeVisible({ timeout: 20_000 });
  });

  test('方法=Zoom でチームカレンダー強制登録の警告と URL 発行モードが表示される', async ({ appPage }) => {
    await appPage.getMethodSelect().selectOption('Zoom');

    await expect(appPage.getZoomForcedCalendarWarning()).toBeVisible();
    // URL 発行モードのラジオが両方表示される
    await expect(appPage.getZoomModeRadio('new')).toBeVisible();
    await expect(appPage.getZoomModeRadio('fixed')).toBeVisible();
    // 「新規発行」が初期選択
    await expect(appPage.getZoomModeRadio('new')).toBeChecked();
    // zoomFixedConfigured=true なので「いつものタダスクID」は有効（選択できる）
    await expect(appPage.getZoomModeRadio('fixed')).toBeEnabled();
    await appPage.getZoomModeRadio('fixed').check();
    await expect(appPage.getZoomModeRadio('fixed')).toBeChecked();
  });

  test('方法=Zoom かつ 14:00 で重複検知され送信がブロックされる', async ({ appPage }) => {
    await appPage.getMethodSelect().selectOption('Zoom');
    // 14:00 ちょうど → モックが重複ありを返す
    await appPage.getScheduleDateTimeInput().fill('2026-07-15T14:00');

    await expect(appPage.getConflictBanner()).toBeVisible({ timeout: 10_000 });
    // 重複中は確定ボタンが無効化される（壊れたコードでは送信が通ってしまう）
    await expect(appPage.getScheduleSubmitButton()).toBeDisabled();
  });

  test('方法=Zoom かつ重複しない時間では空き表示で送信可能', async ({ appPage }) => {
    await appPage.getMethodSelect().selectOption('Zoom');
    // 15:30 → 重複なし
    await appPage.getScheduleDateTimeInput().fill('2026-07-15T15:30');

    await expect(appPage.getAvailableBanner()).toBeVisible({ timeout: 10_000 });
    await expect(appPage.getConflictBanner()).toHaveCount(0);
    await expect(appPage.getScheduleSubmitButton()).toBeEnabled();
  });

  test('方法=GoogleMeet では Zoom 警告も重複チェックも無効', async ({ appPage }) => {
    // 既定 method=GoogleMeet のまま 14:00 にしても重複チェックは走らない
    await appPage.getMethodSelect().selectOption('GoogleMeet');
    await appPage.getScheduleDateTimeInput().fill('2026-07-15T14:00');

    await expect(appPage.getZoomForcedCalendarWarning()).toHaveCount(0);
    // Zoom 以外は needsConflictCheck=false のため重複バナーは出ず、送信可能
    await expect(appPage.getConflictBanner()).toHaveCount(0);
    await expect(appPage.getScheduleSubmitButton()).toBeEnabled();
  });

  // R3: 虚偽UI文言の修正ガード。useCalendar は既定 ON。
  test('方法=対面（非Meet/Zoom）では「カレンダー登録は行われない」旨を正しく注記する', async ({ appPage }) => {
    const modal = appPage.getScheduleModal();
    await appPage.getMethodSelect().selectOption('対面');

    // 修正後: 登録されない旨の注記が出る
    await expect(modal.getByText('この方法ではカレンダーへの予定登録は行われません')).toBeVisible();
    // 旧・虚偽文言は出ない（壊れたコード＝旧文言ならここで失敗する）
    await expect(modal.getByText('カレンダーに予定を登録します。')).toHaveCount(0);
  });

  test('方法=GoogleMeet では Meet 自動発行の正しい案内が出る', async ({ appPage }) => {
    const modal = appPage.getScheduleModal();
    await appPage.getMethodSelect().selectOption('GoogleMeet');
    await expect(modal.getByText('Meet URLが自動発行されカレンダーに登録されます')).toBeVisible();
  });

});
