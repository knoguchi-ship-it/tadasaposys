// ======================================================================
// 初期データ — Webアプリの入口 doGet・起動時データ getInitialData・案件一覧の結合 getAllCasesJoined_・年度計算・マスタ
//   GAS では全ファイルが同じグローバル空間を共有する。手で実行する関数は 00_管理者メニュー に置く。
// ======================================================================

// ======================================================================
// Webアプリ エントリポイント
// ======================================================================
function doGet() {
  // v1.13.0（ADR-013）: シートを読まずに HTML を即座に返す。初期データはページ先頭のスクリプトが
  // google.script.run で取りに行き、画面資源の読込・初期化と並行して進む（以前は全シート読込が
  // 終わるまで HTML が返らず、その後に CDN 取得・JSX 変換が直列で走っていた）。
  // テンプレート評価も不要なため createHtmlOutputFromFile を使う。
  // XFrameOptions は既定（他サイトへの埋め込み不可）。埋め込み利用がないため、クリックジャッキング対策として ALLOWALL をやめた。
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('タダサポ管理')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ======================================================================
// 初期データ取得
// ======================================================================
/**
 * 起動時データ（F-02）。v1.14.0〜 完成品（スナップショット）が使えれば DB を開かずに返す（ADR-015）。
 * forceRefresh === true（画面の「最新に更新」）のときは完成品を使わず作り直す。
 * 下書きバッジは利用者ごとに違うため含めない（getMyDraftCaseIds で別に取る）。
 */
function getInitialData(forceRefresh) {
  // 区間ごとの処理時間を計測し、実行ログ（Cloud Logging）と画面のコンソールに出す
  let t0 = Date.now();
  let perf = {};
  let lap = function(name) { let now = Date.now(); perf[name] = now - t0; t0 = now; };
  let force = forceRefresh === true;

  let props = getScriptProps_();
  let snap = force ? null : loadSnapshot_(String(props[SNAPSHOT_GEN_PROP_] || ''), Date.now(), snapshotMaxAgeMs_(props));
  let source = 'cache';
  lap('snapshotRead');
  if (!snap) {
    let detail = {};
    snap = rebuildSnapshot_(force ? 'manual' : 'miss', detail);
    source = 'rebuild';
    lap('rebuild');
    perf.rebuildDetail = detail;
  }
  primeFromSnapshot_(snap);

  let userEmail = normalizeEmail_(Session.getActiveUser().getEmail());
  let staff = getStaffByEmail_(userEmail);
  if (!staff) {
    throw new Error('アクセス権限がありません。管理者によりタダメンマスタへの登録が必要です。');
  }
  let role = getStaffRoleByEmail_(userEmail) || (isAdminEmail_(userEmail) ? 'admin' : 'staff');
  let isAdmin = role === 'admin';
  lap('auth');
  console.log(JSON.stringify({ perf: 'getInitialData', source: source, ms: perf, cases: snap.cases.length }));

  return {
    _perf: perf,
    user: { name: staff.name, email: userEmail, isAdmin: isAdmin, role: role },
    cases: snap.cases,
    masters: snap.masters,
    forcedCc: snap.forcedCc || '',
    snapshot: { builtAt: snap.builtAt, source: source, readMode: snap.readMode }
  };
}

/** ログイン中メンバーの下書きを持つ案件IDの一覧（F-02b・下書きバッジ用。画面表示後に取得する） */
function getMyDraftCaseIds() {
  let actor = getActor_();
  return listDraftCaseIdsForUser_(actor.email);
}

// ======================================================================
// 年度計算
// ======================================================================
function getFiscalYear_(dateObj) {
  let d = new Date(dateObj);
  if (isNaN(d.getTime())) return 0;
  return d.getMonth() < 3 ? d.getFullYear() - 1 : d.getFullYear();
}

// 案件PKから年度を求める。手動追加案件のPK "manual_<エポックミリ秒>" にも対応する。
// （フォーム案件のPKは日時、手動追加案件は文字列のため new Date() が無効になり
//   年度が 0 に落ちて年間カウントが合流しない問題を防ぐ — v1.12.3）
function caseFiscalYear_(pkRaw) {
  if (pkRaw && typeof pkRaw.getTime === 'function') return getFiscalYear_(pkRaw);
  let s = String(pkRaw);
  if (s.indexOf('manual_') === 0) {
    let epoch = Number(s.replace('manual_', ''));
    return getFiscalYear_(isFinite(epoch) ? new Date(epoch) : new Date(NaN));
  }
  return getFiscalYear_(s);
}

// 年間利用回数の集計キー。メール正規化（大小文字・前後空白を無視）+ 案件PKの年度で構成する。
// フォーム申込と管理者の手動追加案件を、同一メールアドレス + 同一年度で合算するために使用する（v1.12.3）。
function annualUsageKey_(email, pkRaw) {
  return normalizeEmail_(email) + '_' + caseFiscalYear_(pkRaw);
}

// ======================================================================
// v1.12.13: 申込通知チャットのスレッドリンク
//   申込通知 bot（回答スプシの onFormSubmit）が Webhook 投稿時に返る
//   スレッド名を「チャット連携」シートへ記録し、本スプシへ IMPORTRANGE で取り込む。
//   案件とは「申込日時（壁時計・秒まで）+ 正規化メール」で突合する。
//   ※壁時計で突合するのは、両スプシのタイムゾーンが異なっても一致させるため。
//   ※テスト同期先: tests/unit/src/pure-functions.js
// ======================================================================

// 申込日時を 'yyyy/MM/dd HH:mm:ss' の壁時計文字列へ正規化する。
// Date は指定タイムゾーンで整形、文字列は区切り・ゼロ埋めの表記ゆれを吸収する。解釈不能は ''。
function normalizeSubmittedAtLabel_(value, timeZone) {
  if (value && typeof value.getTime === 'function') {
    if (isNaN(value.getTime())) return '';
    return Utilities.formatDate(value, timeZone, 'yyyy/MM/dd HH:mm:ss');
  }
  let m = String(value == null ? '' : value).trim()
    .match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return '';
  let pad = function(v) { return ('0' + v).slice(-2); };
  return m[1] + '/' + pad(m[2]) + '/' + pad(m[3]) + ' ' + pad(m[4]) + ':' + pad(m[5]) + ':' + pad(m[6] || '0');
}

// 突合キー（申込日時ラベル + '|' + 正規化メール）。日時が解釈不能なら ''（突合しない）。
function chatLinkKey_(submittedAt, email, timeZone) {
  let label = normalizeSubmittedAtLabel_(submittedAt, timeZone);
  return label ? label + '|' + normalizeEmail_(email) : '';
}

// スレッド名 "spaces/<space>/threads/<thread>" から Google Chat のスレッドURLを組み立てる。
// 形式が不正な値（シート改ざん・数式エラー等）は null を返し、リンクを出さない。
function buildChatThreadUrl_(threadName) {
  let m = String(threadName == null ? '' : threadName).trim()
    .match(/^spaces\/([A-Za-z0-9_-]+)\/threads\/([A-Za-z0-9_-]+)$/);
  return m ? 'https://chat.google.com/room/' + m[1] + '/' + m[2] + '/' + m[2] : null;
}

// チャット連携シートを読み、突合キー → スレッドURL のマップを返す。
// シート未作成・IMPORTRANGE 未接続でも案件表示は止めない（空マップ）。同一キーは後勝ち。
function getChatLinkMap_(timeZone) {
  let map = {};
  try {
    let data = readSheetValues_(SHEET_NAMES.CHAT_LINKS);
    if (!data || data.length < 2) return map;
    for (let i = 1; i < data.length; i++) {
      let url = buildChatThreadUrl_(data[i][IDX.CHAT_LINK.THREAD_NAME]);
      let key = chatLinkKey_(data[i][IDX.CHAT_LINK.SUBMITTED_AT], data[i][IDX.CHAT_LINK.EMAIL], timeZone);
      if (url && key) map[key] = url;
    }
  } catch (e) {
    console.warn('getChatLinkMap_ failed (non-fatal): ' + e.message);
  }
  return map;
}

// ======================================================================
// データ結合取得
// ======================================================================
/** 案件一覧（画面の再読込用・公開）。タダメンだけが呼べる */
function getAllCasesJoined() {
  getActor_();
  return getAllCasesJoined_();
}

function getAllCasesJoined_(perfOut) {
  // v1.13.0: perfOut（任意）に区間ごとの処理時間を書き込む（getInitialData の _perf.casesDetail）
  let t0 = Date.now();
  let lap = function(name) { if (!perfOut) return; let now = Date.now(); perfOut[name] = now - t0; t0 = now; };
  // v1.14.0: 読込は readSheetValues_ 経由（完成品の作り直しでは Sheets API の一括読込の値を使える）
  // スプレッドシートのタイムゾーンを取得（dateLabel の整形に使用）
  let ssTimeZone = getSpreadsheetTimeZone_();
  lap('open');

  let caseData = readSheetValues_(SHEET_NAMES.CASES);
  if (!caseData) throw new Error('「' + SHEET_NAMES.CASES + '」シートが見つかりません。');
  lap('caseList');
  let recordData = readSheetValues_(SHEET_NAMES.RECORDS);
  if (!recordData) throw new Error('「' + SHEET_NAMES.RECORDS + '」シートが見つかりません。');
  lap('records');

  // 手動追加案件シートを読み込み、案件リストとマージ（ヘッダ行を除いた行配列を結合）
  let manualData = readSheetValues_(SHEET_NAMES.CASES_MANUAL);
  let manualRows = (manualData && manualData.length > 1) ? manualData.slice(1) : [];
  lap('manual');
  let allCaseRows = caseData.slice(1).concat(manualRows);

  // 削除済み案件を除外
  let deletedRaw = getSetting_('DELETED_CASE_IDS', '');
  if (deletedRaw) {
    let deletedSet = {};
    deletedRaw.split(',').forEach(function(id) { if (id) deletedSet[id.trim()] = true; });
    allCaseRows = allCaseRows.filter(function(r) { return !deletedSet[String(r[IDX.CASES.PK])]; });
  }

  // S1 Stage4: 読み取り結合を case_id 経由へ切替えるフラグ（既定OFF=従来どおり String(PK)）。
  // Backfill 完了・監視後に CASE_KEY_READ_VIA_MAP=true で切替える（ロールバックは false に戻すだけ）。
  let readViaMap = parseBoolean_(getSetting_('CASE_KEY_READ_VIA_MAP', 'false'), false);
  lap('settings');

  // 案件補正マップを読み込む（管理者が修正した値を案件リストに上書き表示するため）
  let overrideMap = getCasesOverrideMap_();
  // Stage4: フラグON時は補正マップのキーも結合キー（case_id）へ正準化して引けるようにする
  let overrideLookup = overrideMap;
  if (readViaMap) {
    overrideLookup = {};
    Object.keys(overrideMap).forEach(function(k) { overrideLookup[joinKeyForRead_(k, true)] = overrideMap[k]; });
  }

  // 年間利用補正マップ（管理者が手動修正した利用回数の補正量。キー=正規化メール+'_'+年度）— v1.12.4
  lap('override');
  let annualAdjustMap = getAnnualAdjustmentMap_();
  lap('annualAdjust');

  // 申込通知チャットのスレッドリンク（v1.12.13。フォーム案件のみ・取得失敗時は空）
  let chatLinkMap = getChatLinkMap_(ssTimeZone);
  lap('chatLink');

  // v1.13.0: メール履歴（本文つき）の全件読込を廃止。joined の emails はフロントで未使用だった
  // （案件ごとのメール表示は getThreadMessages が担う）。起動時の読込と送信量・データ露出を削減。

  let recordMap = {};
  let fiscalYearCounts = {};
  let duplicateFkCount = 0;

  for (let i = 1; i < recordData.length; i++) {
    let r = recordData[i];
    let fkKey = joinKeyForRead_(r[IDX.RECORDS.FK], readViaMap);
    // v1.12.6 Stage0: 重複FK行は「最初の行」を採用する。
    // 書込経路（assignCase/reassignCaseAdmin/updateSupportRecord）は for…break で
    // 最初の一致行へ書くため、表示側も最初の一致に揃えて読み書きのズレを解消する。
    if (recordMap.hasOwnProperty(fkKey)) { duplicateFkCount++; continue; }
    let historyStr = r[IDX.RECORDS.HISTORY] ? String(r[IDX.RECORDS.HISTORY]) : '[]';
    let parsedHistory = [];
    try { parsedHistory = JSON.parse(historyStr); } catch(e) { parsedHistory = []; }
    let attachmentsStr = r[IDX.RECORDS.ATTACHMENTS] ? String(r[IDX.RECORDS.ATTACHMENTS]) : '[]';
    let parsedAttachments = [];
    try { parsedAttachments = JSON.parse(attachmentsStr); } catch(e) { parsedAttachments = []; }
    let toolsStr = r[IDX.RECORDS.TOOLS] ? String(r[IDX.RECORDS.TOOLS]) : '[]';
    let parsedTools = [];
    try { parsedTools = JSON.parse(toolsStr); } catch(e) { parsedTools = []; }
    let subStaffStr = r[IDX.RECORDS.SUB_STAFF] ? String(r[IDX.RECORDS.SUB_STAFF]) : '[]';
    let parsedSubStaff = [];
    try { parsedSubStaff = JSON.parse(subStaffStr); } catch(e) { parsedSubStaff = []; }
    recordMap[fkKey] = {
      status: r[IDX.RECORDS.STATUS],
      staffEmail: r[IDX.RECORDS.STAFF_EMAIL],
      staffName: r[IDX.RECORDS.STAFF_NAME],
      scheduledDateTime: r[IDX.RECORDS.DATE] ? new Date(r[IDX.RECORDS.DATE]).toISOString() : null,
      supportCount: r[IDX.RECORDS.COUNT],
      method: r[IDX.RECORDS.METHOD],
      businessType: r[IDX.RECORDS.BUSINESS],
      content: r[IDX.RECORDS.CONTENT],
      remarks: r[IDX.RECORDS.REMARKS],
      meetUrl: r[IDX.RECORDS.MEET_URL],
      eventId: r[IDX.RECORDS.EVENT_ID],
      threadId: r[IDX.RECORDS.THREAD_ID] || null,
      caseLimitOverride: (function(v) {
        let n = Number(v);
        return isFinite(n) && n > 0 ? Math.floor(n) : null;
      })(r[IDX.RECORDS.CASE_LIMIT_OVERRIDE]),
      annualLimitOverride: (function(v) {
        let n = Number(v);
        return isFinite(n) && n > 0 ? Math.floor(n) : null;
      })(r[IDX.RECORDS.ANNUAL_LIMIT_OVERRIDE]),
      supportHistory: parsedHistory,
      attachments: parsedAttachments,
      tools: parsedTools,
      subStaff: parsedSubStaff
    };
  }
  if (duplicateFkCount > 0) {
    console.warn('[整合性警告] サポート記録に重複FK行 ' + duplicateFkCount + ' 件を検出。表示は最初の行を採用（要データ修復）。');
  }

  for (let j = 0; j < allCaseRows.length; j++) {
    let c = allCaseRows[j];
    let ts = String(c[IDX.CASES.PK]);
    if (!ts) continue;
    let joinKey = joinKeyForRead_(c[IDX.CASES.PK], readViaMap); // Stage4: 結合キー（表示idは ts のまま）
    // 補正シートにメールアドレスの補正があればそちらを使う（年度集計の正確性のため）
    let ovr = overrideLookup[joinKey] || {};
    let email = ovr.email !== null && ovr.email !== undefined ? ovr.email : String(c[IDX.CASES.EMAIL]);
    let record = recordMap[joinKey] || { status: 'unhandled' };
    if (record.status === 'inProgress' || record.status === 'completed') {
      // 手動追加案件もフォーム案件と同一メール+年度で合算する（manual_PKの年度を正しく解決）
      let key = annualUsageKey_(email, c[IDX.CASES.PK]);
      fiscalYearCounts[key] = (fiscalYearCounts[key] || 0) + (Number(record.supportCount) || 1);
    }
  }

  let joinedCases = [];
  let seenPks = {};
  for (let j = 0; j < allCaseRows.length; j++) {
    let c = allCaseRows[j];
    let ts = String(c[IDX.CASES.PK]);
    if (!ts) continue;
    if (seenPks[ts]) continue; // 重複PKをスキップ
    seenPks[ts] = true;
    let joinKey = joinKeyForRead_(c[IDX.CASES.PK], readViaMap); // Stage4: 結合キー（表示idは ts のまま）
    let record = recordMap[joinKey] || { status: 'unhandled', supportCount: 1 };
    // 案件補正マップを適用（補正値が存在する場合は上書き、null は補正なし）
    let ovr = overrideLookup[joinKey] || {};
    let email       = ovr.email         !== null && ovr.email         !== undefined ? ovr.email         : String(c[IDX.CASES.EMAIL]);
    let officeName  = ovr.officeName    !== null && ovr.officeName    !== undefined ? ovr.officeName    : c[IDX.CASES.OFFICE];
    let reqName     = ovr.requesterName !== null && ovr.requesterName !== undefined ? ovr.requesterName : c[IDX.CASES.NAME];
    let details     = ovr.details       !== null && ovr.details       !== undefined ? ovr.details       : c[IDX.CASES.DETAILS];
    let prefecture  = ovr.prefecture    !== null && ovr.prefecture    !== undefined ? ovr.prefecture    : (c[IDX.CASES.PREFECTURE] || null);
    let serviceType = ovr.serviceType   !== null && ovr.serviceType   !== undefined ? ovr.serviceType   : c[IDX.CASES.SERVICE];
    // 自動計算（base）+ 管理者補正（v1.12.4）。負値にはしない。
    let usageKey = annualUsageKey_(email, c[IDX.CASES.PK]);
    let count = (fiscalYearCounts[usageKey] || 0) + (annualAdjustMap[usageKey] || 0);
    if (count < 0) count = 0;
    // タイムスタンプをJST日付文字列に変換
    // c[IDX.CASES.PK] は GAS が Sheet から読んだ Date オブジェクトのため、
    // String() → new Date() の往復変換を避けて直接 formatDate に渡す
    let pkRaw = c[IDX.CASES.PK];
    let pkDate;
    if (pkRaw && typeof pkRaw.getTime === 'function') {
      pkDate = pkRaw;
    } else if (typeof pkRaw === 'string' && pkRaw.indexOf('manual_') === 0) {
      // 手動追加案件: "manual_" + エポックミリ秒 から日付を復元
      let epoch = Number(pkRaw.replace('manual_', ''));
      pkDate = isFinite(epoch) ? new Date(epoch) : new Date(NaN);
    } else {
      pkDate = new Date(pkRaw);
    }
    let dateLabel = isNaN(pkDate.getTime()) ? '' : Utilities.formatDate(pkDate, ssTimeZone, 'yyyy/MM/dd');
    // bot はフォーム回答の生メールで記録するため、補正前のメールで突合する（手動追加案件は対象外）
    let chatKey = (pkRaw && typeof pkRaw.getTime === 'function')
      ? chatLinkKey_(pkRaw, c[IDX.CASES.EMAIL], ssTimeZone) : '';

    joinedCases.push({
      id: ts, timestamp: ts, dateLabel: dateLabel, email: email,
      officeName: officeName, requesterName: reqName,
      details: details, serviceType: serviceType,
      prefecture: prefecture,
      hasOverride: Object.keys(ovr).some(function(k) { return ovr[k] !== null; }),
      status: record.status, staffEmail: record.staffEmail, staffName: record.staffName,
      scheduledDateTime: record.scheduledDateTime, supportCount: record.supportCount,
      method: record.method, businessType: record.businessType,
      content: record.content, remarks: record.remarks,
      meetUrl: record.meetUrl, eventId: record.eventId,
      threadId: record.threadId || null,
      caseLimitOverride: record.caseLimitOverride || null,
      annualLimitOverride: record.annualLimitOverride || null,
      supportHistory: record.supportHistory || [],
      attachments: record.attachments || [],
      tools: record.tools || [],
      subStaff: record.subStaff || [],
      currentFiscalYearCount: count,
      chatThreadUrl: (chatKey && chatLinkMap[chatKey]) || null
    });
  }

  let sorted = joinedCases.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
  lap('join');
  return sorted;
}

// ======================================================================
// マスタデータ（完成品に入る。画面の選択肢・上限・テンプレート等）
// ======================================================================
function getMasters_() {
  let zoomEnabled = !!getSetting_('ZOOM_ACCOUNT_ID');
  let zoomFixedConfigured = !!getSetting_('ZOOM_FIXED_URL'); // v1.12.0: 固定ID使用可能フラグ
  let attachmentFolderConfigured = !!getSetting_('ATTACHMENT_FOLDER_ID');
  let methods = ['GoogleMeet', 'メール等', '電話等', '対面'];
  if (zoomEnabled) methods.splice(1, 0, 'Zoom');
  let allStaff = [];
  try {
    {
      let rows = getStaffRows_(); // v1.13.0: 1実行1回の読込
      for (let i = 1; i < rows.length; i++) {
        let em = normalizeEmail_(rows[i][IDX.STAFF.EMAIL]);
        if (!em) continue;
        let active = parseBoolean_(rows[i][IDX.STAFF.IS_ACTIVE], true);
        if (!active) continue;
        allStaff.push({
          name: String(rows[i][IDX.STAFF.NAME] || ''),
          email: em,
          role: String(rows[i][IDX.STAFF.ROLE] || 'staff').toLowerCase()
        });
      }
    }
  } catch (e) {
    allStaff = [];
  }

  return {
    methods: methods,
    businessTypes: ['訪問介護', '通所介護', '居宅介護支援', '福祉用具貸与', '小規模多機能', '有料老人ホーム', 'その他'],
    prefectures: [
      '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
      '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
      '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
      '静岡県', '愛知県', '三重県',
      '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
      '鳥取県', '島根県', '岡山県', '広島県', '山口県',
      '徳島県', '香川県', '愛媛県', '高知県',
      '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
      'その他'
    ],
    allStaff: allStaff,
    spreadsheetUrl: spreadsheetUrlFromId_(getSpreadsheetId_()), // v1.14.0: DB を開かない
    limits: {
      annual: getAnnualUsageLimit_(),
      caseSupport: getCaseUsageLimit_()
    },
    attachmentFolderConfigured: attachmentFolderConfigured,
    zoomFixedConfigured: zoomFixedConfigured,
    supportTools: (function() {
      let raw = getSetting_('SUPPORT_TOOLS', '');
      if (!raw) return null; // nullのときフロントエンドでデフォルトにフォールバック
      return raw.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
    })(),
    toolMonthlyLimits: (function() {
      let raw = getSetting_('TOOL_MONTHLY_LIMITS', '');
      if (!raw) return {};
      let result = {};
      raw.split(',').forEach(function(pair) {
        let parts = pair.split(':');
        if (parts.length === 2) {
          let name = parts[0].trim();
          let limit = parseInt(parts[1].trim(), 10);
          if (name && !isNaN(limit) && limit > 0) result[name] = limit;
        }
      });
      return result;
    })(),
    emailTemplates: {
      initialSubject: getSetting_('MAIL_INITIAL_SUBJECT', 'タダサポ｜ご相談を承りました'),
      initialBody: getSetting_('MAIL_INITIAL_BODY', '{{名前}} 様\n\nこの度はタダサポへご相談いただきありがとうございます。\n担当させていただきます{{担当者名}}と申します。\n\n以下の内容で受付いたしました。\n\n----------------\n【ご相談内容】\n{{相談内容}}\n----------------\n\n追ってサポート日時のご連絡をさせていただきます。\n\n何かご不明な点がございましたら、お気軽にお問い合わせください。\n\n今後ともよろしくお願いいたします。'),
      includeDetails: getSetting_('MAIL_INITIAL_INCLUDE_DETAILS', 'true'),
      declinedSubject: getSetting_('MAIL_DECLINED_SUBJECT', 'タダサポ｜ご利用回数上限のお知らせ'),
      declinedBody: getSetting_('MAIL_DECLINED_BODY', '{{名前}} 様\n\nいつもタダサポをご利用いただきありがとうございます。\n\n誠に恐れ入りますが、{{事業所名}} 様の今年度のご利用回数が上限（10回）に達しております。\nそのため、今回のご相談につきましては対応を見送らせていただくこととなりました。\n\n大変申し訳ございませんが、何卒ご理解くださいますようお願い申し上げます。\n次年度のご利用をお待ちしております。'),
      newSubject: getSetting_('MAIL_NEW_SUBJECT', ''),
      newBody: getSetting_('MAIL_NEW_BODY', '{{名前}} 様\n\n\n\n{{担当者名}}'),
      closingSubject: getSetting_('MAIL_CLOSING_SUBJECT', 'タダサポ｜サポート完了のお知らせ'),
      closingBody: getSetting_('MAIL_CLOSING_BODY', '{{名前}} 様\n\nこの度はタダサポをご利用いただき、誠にありがとうございました。\n{{事業所名}} 様へのサポートは今回をもちまして完了とさせていただきます。\n\nまたお困りごとがございましたら、いつでもお気軽にご相談ください。\n今後ともタダサポをよろしくお願いいたします。\n\n{{担当者名}}'),
      scheduleSubject: getSetting_('MAIL_SCHEDULE_SUBJECT', 'タダサポ｜サポート日程のご連絡'),
      scheduleBody: getSetting_('MAIL_SCHEDULE_BODY', '{{名前}} 様\n\nいつもお世話になっております。\nタダサポ担当の{{担当者名}}です。\n\nサポート日程が決まりましたのでご連絡いたします。\n\n----------------\n【サポート日程】\n日時：{{日程}}\n方法：{{対応方法}}\n{{URL}}\n----------------\n\n当日はどうぞよろしくお願いいたします。\nご不明な点がございましたらお気軽にご連絡ください。')
    }
  };
}
