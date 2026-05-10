/**
 * 03 — 表示モード切替
 * 通常 / 閲覧 / 管理 の3モード切替を検証する。
 */
import { test, expect } from '../fixtures';

test.describe('表示モード切替', () => {

  test('初期状態は「通常」モード (aria-pressed=true)', async ({ appPage }) => {
    const btn = appPage.modeGroup.getByRole('button', { name: '通常' });
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  test('「閲覧」ボタンをクリックすると閲覧モードに切り替わる', async ({ appPage }) => {
    await appPage.switchMode('閲覧');
    const dashBtn = appPage.modeGroup.getByRole('button', { name: '閲覧' });
    await expect(dashBtn).toHaveAttribute('aria-pressed', 'true');
    const normalBtn = appPage.modeGroup.getByRole('button', { name: '通常' });
    await expect(normalBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('「管理」ボタンをクリックすると管理モードに切り替わる（管理者）', async ({ appPage }) => {
    await appPage.switchMode('管理');
    const adminBtn = appPage.modeGroup.getByRole('button', { name: '管理' });
    await expect(adminBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('「通常」→「管理」→「通常」で元に戻せる', async ({ appPage }) => {
    await appPage.switchMode('管理');
    await appPage.switchMode('通常');
    const mode = await appPage.getCurrentMode();
    expect(mode).toBe('通常');
  });

  test('閲覧モードに切替後、モードを「通常」に戻すと自分の案件のみ表示される', async ({ appPage }) => {
    await appPage.switchMode('閲覧');
    await appPage.clickTab('対応中');
    const allCount = await appPage.getCaseCards().count();

    await appPage.switchMode('通常');
    await appPage.clickTab('対応中');
    const myCount = await appPage.getCaseCards().count();

    // 通常モードは自分の案件のみ → 閲覧モードより少ないか同等
    expect(myCount).toBeLessThanOrEqual(allCount);
  });

});
