/**
 * AppPage — タダサポ管理システム のメイン Page Object Model
 * Playwright POM ベストプラクティス準拠 (2026)
 * 参考: https://playwright.dev/docs/pom
 *
 * ⚠️ アーキテクチャ上の注意:
 *   - ステータスタブ: role="tab" → getByRole('tab') を使用
 *   - アクションボタン（担当する/回数超過/再開する等）: fixed bottom-6 のフローティングバーにある
 *     → .max-w-3xl の外側。page.getByRole('button') で検索
 *   - 管理モードのインライン編集ボタン: .max-w-3xl の内側
 */
import { type Page, type Locator, expect } from '@playwright/test';

export type TabKey = '未対応' | '対応中' | '完了' | 'キャンセル' | '対応不可' | '全て';
export type DisplayMode = '通常' | '閲覧' | '管理';

export class AppPage {
  readonly page: Page;

  readonly header:    Locator;
  readonly appTitle:  Locator;
  readonly userName:  Locator;
  readonly modeGroup: Locator;
  readonly tabList:   Locator;
  readonly searchInput:    Locator;
  readonly searchClearBtn: Locator;

  /** フローティングアクションバー（fixed bottom-6） */
  private get actionBar(): Locator {
    return this.page.locator('[class*="fixed"][class*="bottom-6"]');
  }

  constructor(page: Page) {
    this.page = page;

    this.header   = page.locator('header');
    this.appTitle = page.getByText('タダサポ管理');
    this.userName = page.getByText('テスト太郎');

    this.modeGroup = page.getByRole('group', { name: '表示モード' });
    this.tabList   = page.getByRole('tablist', { name: 'ステータス切替' });

    this.searchInput    = page.getByPlaceholder('事業所名・担当者名・内容を検索...');
    this.searchClearBtn = page.getByRole('button', { name: 'キーワードをクリア' });
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await this.waitForLoaded();
  }

  /**
   * アプリの初期化完了を確認する。
   * ⚠️ waitForLoadState('networkidle') は esm.sh の長期接続で永遠に待機するため使用しない。
   */
  async waitForLoaded(): Promise<void> {
    await this.tabList.waitFor({ state: 'visible', timeout: 60_000 });
    // 個々のタブ要素（role="tab"）が表示されるまで待機（mock data 300ms delay 完了の指標）
    await this.tabList.getByRole('tab').first().waitFor({ state: 'visible', timeout: 15_000 });
  }

  // ── 表示モード ────────────────────────────────────

  async getCurrentMode(): Promise<DisplayMode> {
    for (const mode of ['通常', '閲覧', '管理'] as DisplayMode[]) {
      const btn = this.modeGroup.getByRole('button', { name: mode });
      if (await btn.count() === 0) continue;
      if (await btn.getAttribute('aria-pressed') === 'true') return mode;
    }
    return '通常';
  }

  async switchMode(mode: DisplayMode): Promise<void> {
    const btn = this.modeGroup.getByRole('button', { name: mode });
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  }

  // ── タブ ─────────────────────────────────────────

  /** role="tab" を持つステータスタブをクリックする */
  async clickTab(tab: TabKey): Promise<void> {
    await this.tabList.getByRole('tab', { name: tab }).click();
  }

  getTab(tab: TabKey): Locator {
    return this.tabList.getByRole('tab', { name: tab });
  }

  // ── 検索 ─────────────────────────────────────────

  async search(keyword: string): Promise<void> {
    await this.searchInput.fill(keyword);
  }

  async clearSearch(): Promise<void> {
    await this.searchInput.clear();
  }

  // ── ケースカード（#case-list-panel 内の button） ──

  getCaseCards(): Locator {
    return this.page
      .locator('#case-list-panel button')
      .filter({ has: this.page.locator('h4') });
  }

  getCaseCardByOfficeName(officeName: string): Locator {
    return this.page
      .locator('#case-list-panel button')
      .filter({ has: this.page.locator('h4', { hasText: officeName }) });
  }

  async selectCase(officeName: string): Promise<void> {
    await this.getCaseCardByOfficeName(officeName).first().click();
    await this.page.locator('.max-w-3xl').waitFor({ state: 'visible', timeout: 5_000 });
  }

  // ── 詳細パネル（.max-w-3xl 内） ──────────────────

  async isDetailPanelOpen(): Promise<boolean> {
    return this.page.locator('.max-w-3xl').isVisible();
  }

  /**
   * アクションボタンを取得する。
   * ⚠️ アクションボタンは fixed bottom-6 のフローティングバーにあり、
   *    .max-w-3xl の外側に配置されている。
   */
  getActionButton(label: string | RegExp): Locator {
    return this.actionBar.getByRole('button', { name: label });
  }

  async hasDeclineButton(): Promise<boolean> {
    return this.getActionButton('回数超過').isVisible();
  }

  async hasAssignButtons(): Promise<boolean> {
    const noMail   = await this.getActionButton('担当する（メールなし）').isVisible();
    const withMail = await this.getActionButton('メール送信して担当').isVisible();
    return noMail || withMail;
  }

  /** インライン編集ドロップダウン（absolute z-50）を取得 */
  getInlineEditDropdown(): Locator {
    return this.page.locator('.absolute.z-50');
  }

  /** 担当者バッジ（管理モードでクリックして担当者を変更）。title 属性で一意に特定する。 */
  getStaffBadge(): Locator {
    return this.page.locator('button[title="クリックして担当者を変更"]');
  }

  /** トースト通知（メッセージ部分一致）を取得する。fixed top-4 right-4 の通知領域に限定。 */
  getToast(message: string | RegExp): Locator {
    return this.page.locator('.fixed.top-4.right-4').getByText(message);
  }

  getEmptyStateMessage(): Locator {
    return this.page.locator('#case-list-panel [role="status"]');
  }

  // ── 日程確定モーダル（T1 / v1.11.7〜v1.12.0） ──────
  // schedule モーダルは max-w-4xl（report/edit/cancel は max-w-lg）で区別できる。

  /** 日程確定モーダル本体（max-w-4xl のダイアログ） */
  getScheduleModal(): Locator {
    return this.page.locator('[class*="max-w-4xl"]');
  }

  /**
   * 対応中/未対応(管理) の案件詳細から日程確定モーダルを開く。
   * ボタンラベルは scheduledDateTime の有無で「日時変更/日時決定」と変わるため
   * 正規表現で吸収する。
   */
  async openScheduleModal(officeName: string): Promise<void> {
    await this.selectCase(officeName);
    await this.getActionButton(/日時(変更|決定|設定)/).click();
    await this.getScheduleModal().getByText('日程の確定・変更').waitFor({ state: 'visible', timeout: 5_000 });
  }

  /** 日時入力（datetime-local）。値は `YYYY-MM-DDTHH:mm`。 */
  getScheduleDateTimeInput(): Locator {
    return this.getScheduleModal().locator('input[type="datetime-local"]');
  }

  /** 対応方法 select（GoogleMeet / Zoom / 対面 / 電話等）。Zoom option を持つ select で一意特定。 */
  getMethodSelect(): Locator {
    return this.getScheduleModal()
      .locator('select')
      .filter({ has: this.page.getByRole('option', { name: 'Zoom' }) });
  }

  /** 日程確定の送信ボタン（重複/チェック中は disabled） */
  getScheduleSubmitButton(): Locator {
    return this.getScheduleModal().getByRole('button', { name: '日時を確定してカレンダー作成' });
  }

  /** 重複検知バナーの状態を文言で取得する */
  getConflictBanner(): Locator {
    return this.getScheduleModal().getByText('重複する予定があります');
  }

  getAvailableBanner(): Locator {
    return this.getScheduleModal().getByText('この時間帯は空いています');
  }

  /** Zoom 強制カレンダー登録の警告（method=Zoom 時のみ表示） */
  getZoomForcedCalendarWarning(): Locator {
    return this.getScheduleModal().getByText('Zoom時はチームタダカヨカレンダーへ自動登録');
  }

  /** Zoom URL 発行モードのラジオ（'new' = 新規発行 / 'fixed' = いつものタダスクID） */
  getZoomModeRadio(mode: 'new' | 'fixed'): Locator {
    return this.getScheduleModal().locator(`input[type="radio"][name="zoomMode"][value="${mode}"]`);
  }

  /** FullCalendar 埋込みのルート要素（.fc）が描画されているか */
  getFullCalendar(): Locator {
    return this.getScheduleModal().locator('.fc');
  }

  // ── 管理モード ステータスインライン編集（T2 / v1.11.6） ──

  /** 詳細パネルのステータスバッジ（管理モードでクリックして遷移） */
  getStatusBadge(): Locator {
    return this.page.locator('button[title="クリックしてステータスを変更"]');
  }

  /** ステータス変更ドロップダウンから対象ステータスを選ぶ */
  async changeStatusInline(label: TabKey): Promise<void> {
    await this.getStatusBadge().click();
    const dropdown = this.page.locator('.absolute.z-50');
    await dropdown.getByRole('button', { name: label, exact: true }).click();
  }

  /** 案件回数バッジ（"n / 上限"）。status!==unhandled のときのみ表示。 */
  getCaseCountBadge(): Locator {
    return this.page.locator('button[title="クリックして上限を変更"]');
  }

  // ── メールスレッド / 下書き一覧（v1.12.10） ────────

  /** 案件詳細の最初のメールスレッドサマリーを展開する */
  async expandFirstThread(): Promise<void> {
    const summary = this.page
      .locator('.max-w-3xl')
      .getByRole('button')
      .filter({ hasText: '最新:' })
      .first();
    await summary.click();
  }

  /** スレッド内の最初のメッセージを展開し、「返信する」を押して返信モーダルを開く */
  async openThreadReply(): Promise<void> {
    await this.expandFirstThread();
    // スレッド内メッセージ（"送信"/"受信" バッジを含む）を1件展開。
    // スレッドサマリーも "最新: 受信" を含むため hasNotText で除外する。
    const msg = this.page
      .locator('.max-w-3xl')
      .getByRole('button')
      .filter({ hasText: /受信|送信/, hasNotText: '最新:' })
      .first();
    await msg.click();
    await this.page.getByRole('button', { name: '返信する' }).first().click();
    await this.getEmailModalHeading().waitFor({ state: 'visible', timeout: 5_000 });
  }

  /** メールモーダル本体（z-[110] のオーバーレイ。見出しで一意特定） */
  getEmailModal(): Locator {
    return this.page.locator('div.fixed.inset-0').filter({ has: this.getEmailModalHeading() });
  }

  /** メールモーダルの見出し（スレッド返信 / 新規メール送信 等） */
  getEmailModalHeading(): Locator {
    return this.page.getByRole('heading', { name: /スレッド返信|新規メール送信|初回メール送信|日程確定メール送信|回数超過の連絡/ });
  }

  /** モーダル内の件名 input（CC/BCC/件名 の順で最後の text input） */
  getEmailSubjectInput(): Locator {
    return this.getEmailModal().locator('input[type="text"]').last();
  }

  /** モーダル内の送信実行ボタン（reply=返信する / new=送信する） */
  getEmailSendButton(): Locator {
    return this.getEmailModal().getByRole('button', { name: /返信する|送信する|送信して担当する/ });
  }

  async saveDraftInModal(): Promise<void> {
    await this.getEmailModal().getByRole('button', { name: '下書き保存' }).click();
    await this.getToast('下書きを保存しました').waitFor({ state: 'visible', timeout: 5_000 });
  }

  async closeEmailModal(): Promise<void> {
    await this.getEmailModal().getByRole('button', { name: '閉じる' }).click();
    await this.getEmailModalHeading().waitFor({ state: 'hidden', timeout: 5_000 });
  }

  /** 下書き一覧セクション（「下書き (N件)」見出しを持つ section） */
  getDraftListSection(): Locator {
    return this.page
      .locator('section')
      .filter({ has: this.page.getByRole('heading', { name: /下書き \(\d+件\)/ }) });
  }

  getDraftListHeading(): Locator {
    return this.page.getByRole('heading', { name: /下書き \(\d+件\)/ });
  }

  getDraftOpenButton(): Locator {
    return this.getDraftListSection().getByRole('button', { name: '開く' }).first();
  }

  getDraftDeleteButton(): Locator {
    return this.getDraftListSection().getByRole('button', { name: '削除' }).first();
  }
}
