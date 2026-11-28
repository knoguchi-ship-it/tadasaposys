// ======================================================================
// 日程と会議 — 日程の設定値・Zoom・Google Meet・チームカレンダー・空き状況と重複検知・会議 URL の更新
//   GAS では全ファイルが同じグローバル空間を共有する。手で実行する関数は 00_管理者メニュー に置く。
// ======================================================================

// ── 日程・カレンダー関連の設定ヘルパー（v1.11.7）─────────────
function getScheduleBufferMin_() {
  let raw = String(getSetting_('SCHEDULE_BUFFER_MIN', '30') || '').trim();
  let num = Number(raw);
  if (!isFinite(num) || num < 0) return 30;
  return Math.floor(num);
}

function getTeamCalendarId_() {
  let id = String(getSetting_('TEAM_CALENDAR_ID', '') || '').trim();
  if (id) return id;
  let fallback = String(getSetting_('SHARED_CALENDAR_ID', '') || '').trim();
  return fallback || '';
}

function parseDisplayCalendarsJson_(raw) {
  if (!raw) return [];
  let parsed;
  try { parsed = JSON.parse(String(raw)); } catch (e) { return []; }
  if (!Array.isArray(parsed)) return [];
  let result = [];
  for (let i = 0; i < parsed.length; i++) {
    let item = parsed[i] || {};
    let name = String(item.name || '').trim();
    let id = String(item.id || '').trim();
    if (id) result.push({ name: name || id, id: id });
  }
  return result;
}

function getDisplayCalendars_() {
  return parseDisplayCalendarsJson_(getSetting_('DISPLAY_CALENDARS_JSON', ''));
}

// ======================================================================
// Zoom API
// ======================================================================
// v1.13.0: Zoom のアクセストークン（有効1時間）を ScriptCache に50分保持し、毎回の取得往復を省く。
// キーにクライアントIDのハッシュを含め、認証情報の差し替え時は clearZoomTokenCache_ で破棄する。
const ZOOM_TOKEN_CACHE_SEC_ = 3000;

function zoomTokenCacheKey_(clientId) {
  let digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(clientId || ''));
  return 'zoom_token_' + Utilities.base64EncodeWebSafe(digest).slice(0, 16);
}

function clearZoomTokenCache_() {
  try {
    let clientId = getSecret_('ZOOM_CLIENT_ID');
    if (clientId) CacheService.getScriptCache().remove(zoomTokenCacheKey_(clientId));
  } catch (e) { /* キャッシュ不可でも致命ではない */ }
}

function getZoomAccessToken_(forceRefresh) {
  let accountId = getSetting_('ZOOM_ACCOUNT_ID');
  let clientId = getSetting_('ZOOM_CLIENT_ID');
  let clientSecret = getSetting_('ZOOM_CLIENT_SECRET');

  if (!accountId || !clientId || !clientSecret) {
    throw new Error('Zoom API の設定が不足しています。管理画面の設定管理「連携」で ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET を設定してください（スクリプトプロパティに書込専用で保存されます）。');
  }

  let cacheKey = zoomTokenCacheKey_(clientId);
  let cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }
  if (cache && !forceRefresh) {
    let cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  let credentials = Utilities.base64Encode(clientId + ':' + clientSecret);
  let response = UrlFetchApp.fetch('https://zoom.us/oauth/token', {
    method: 'post',
    headers: { 'Authorization': 'Basic ' + credentials, 'Content-Type': 'application/x-www-form-urlencoded' },
    payload: 'grant_type=account_credentials&account_id=' + accountId,
    muteHttpExceptions: true
  });

  let result = JSON.parse(response.getContentText());
  if (result.access_token) {
    if (cache) {
      let ttl = Math.min(ZOOM_TOKEN_CACHE_SEC_, Math.max(60, (Number(result.expires_in) || 3600) - 300));
      try { cache.put(cacheKey, result.access_token, ttl); } catch (e) { /* 致命ではない */ }
    }
    return result.access_token;
  }
  // 認証失敗の応答本文には秘密が含まれないが、念のため reason のみ返す
  throw new Error('Zoom認証エラー: ' + (result.reason || ('HTTP ' + response.getResponseCode())));
}

function createZoomMeeting_(title, startTime, durationMinutes) {
  let startISO = Utilities.formatDate(new Date(startTime), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss");
  let post = function(token) {
    return UrlFetchApp.fetch('https://api.zoom.us/v2/users/me/meetings', {
      method: 'post',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload: JSON.stringify({
        topic: title, type: 2, start_time: startISO,
        duration: durationMinutes || 60, timezone: 'Asia/Tokyo',
        settings: { join_before_host: true, waiting_room: false, auto_recording: 'none' }
      }),
      muteHttpExceptions: true
    });
  };
  let response = post(getZoomAccessToken_());
  // v1.13.0: キャッシュしたトークンが失効・取消されていた場合は1回だけ取り直して再試行
  if (response.getResponseCode() === 401) response = post(getZoomAccessToken_(true));

  let result = JSON.parse(response.getContentText());
  if (result.join_url) return { joinUrl: result.join_url, meetingId: String(result.id) };
  throw new Error('Zoom会議作成エラー: ' + (result.message || response.getContentText()));
}

// ======================================================================
// Google Meet カレンダー予定作成
// ======================================================================
/**
 * Google Calendar + Google Meet イベント作成
 * Calendar Advanced Service (Events.insert) でイベントと Meet を同時作成する。
 * conferenceDataVersion: 1 を指定することで、Google Meet が自動発行される。
 */
function createGoogleMeetEvent_(title, startTime, description, durationMinutes) {
  let start = new Date(startTime);
  let dur = (durationMinutes && Number(durationMinutes) > 0) ? Number(durationMinutes) : 60;
  let end = new Date(start.getTime() + dur * 60 * 1000);
  let apiCalId = getApiCalendarId_();

  // アプリURLをdescriptionに追記
  let appUrl = ScriptApp.getService().getUrl();
  let descWithApp = (description || '') + (appUrl ? '\n\nタダサポ管理: ' + appUrl : '');

  // Calendar Advanced Service で直接イベント+Meet を作成
  let eventResource = {
    summary: title,
    description: descWithApp,
    start: {
      dateTime: Utilities.formatDate(start, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss"),
      timeZone: 'Asia/Tokyo'
    },
    end: {
      dateTime: Utilities.formatDate(end, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss"),
      timeZone: 'Asia/Tokyo'
    },
    conferenceData: {
      createRequest: {
        requestId: Utilities.getUuid(),
        conferenceSolutionKey: { type: 'hangoutsMeet' }
      }
    }
  };

  try {
    let created = Calendar.Events.insert(eventResource, apiCalId, { conferenceDataVersion: 1 });
    let meetUrl = '';
    if (created.conferenceData && created.conferenceData.entryPoints) {
      let videoEntry = created.conferenceData.entryPoints.find(function(ep) { return ep.entryPointType === 'video'; });
      if (videoEntry) meetUrl = videoEntry.uri;
    }
    if (meetUrl) {
      // descriptionにもMeet URLを記載（カレンダーの説明欄からもアクセス可能に）
      Calendar.Events.patch({
        description: 'Google Meet URL: ' + meetUrl + '\n\n' + (description || '') + (appUrl ? '\n\nタダサポ管理: ' + appUrl : '')
      }, apiCalId, created.id);
      console.log('Google Meet作成成功: ' + meetUrl + ' eventId=' + created.id);
    } else {
      console.warn('conferenceData.entryPoints にvideoが見つかりません eventId=' + created.id);
    }
    return { meetUrl: meetUrl, eventId: created.id };
  } catch(e) {
    console.error('Calendar Events.insert エラー: ' + e.message + ' (apiCalId=' + apiCalId + ')');
    // フォールバック: CalendarApp でイベントだけ作成（Meetなし）
    try {
      let sharedCalId = getSetting_('SHARED_CALENDAR_ID', '');
      let cal = (sharedCalId && sharedCalId !== 'primary') ? CalendarApp.getCalendarById(sharedCalId) : null;
      if (!cal) cal = CalendarApp.getDefaultCalendar();
      let fallback = cal.createEvent(title, start, end, { description: descWithApp });
      console.log('フォールバック: CalendarAppでイベント作成 eventId=' + fallback.getId());
      return { meetUrl: '', eventId: fallback.getId() };
    } catch(e2) {
      console.error('CalendarApp フォールバックも失敗: ' + e2.message);
      return { meetUrl: '', eventId: '' };
    }
  }
}

// ======================================================================
// 日程の確定・変更：空き状況取得 ＆ 重複検知（v1.11.7）
// ======================================================================
/**
 * 2つの時間帯が重なるか判定する（端点接触は重なり扱いにしない）
 * pure: テスト容易。境界値: aEnd === bStart の場合は false
 */
function eventsOverlap_(aStart, aEnd, bStart, bEnd) {
  let as = (aStart instanceof Date) ? aStart.getTime() : new Date(aStart).getTime();
  let ae = (aEnd instanceof Date) ? aEnd.getTime() : new Date(aEnd).getTime();
  let bs = (bStart instanceof Date) ? bStart.getTime() : new Date(bStart).getTime();
  let be = (bEnd instanceof Date) ? bEnd.getTime() : new Date(bEnd).getTime();
  return as < be && ae > bs;
}

/**
 * 開始時刻と継続分から「バッファ込み占有時間帯」を返す。pure。
 * 戻り値: { start: Date, end: Date }
 */
function computeBufferedWindow_(start, durationMin, bufferMin) {
  let s = (start instanceof Date) ? new Date(start.getTime()) : new Date(start);
  let dur = Math.max(0, Number(durationMin) || 0);
  let buf = Math.max(0, Number(bufferMin) || 0);
  let plain = new Date(s.getTime() + dur * 60000);
  return {
    start: new Date(s.getTime() - buf * 60000),
    end: new Date(plain.getTime() + buf * 60000),
    plainStart: s,
    plainEnd: plain
  };
}

/**
 * 期間内のチームカレンダー＋表示専用カレンダーのイベントを返す。
 * 日程確定モーダル内のカレンダーUI（Phase3）で利用。
 * @param {string} rangeStartIso ISO日時
 * @param {string} rangeEndIso   ISO日時
 * @returns {{events: Array, settings: {bufferMin: number, teamCalendarId: string, displayCalendars: Array}}}
 */
function getScheduleAvailability(rangeStartIso, rangeEndIso) {
  getActor_();
  ensureAdminSchema_();
  let start = rangeStartIso ? new Date(rangeStartIso) : new Date();
  let end = rangeEndIso ? new Date(rangeEndIso) : new Date(start.getTime() + 30 * 24 * 3600 * 1000);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('期間の指定が不正です。');
  }

  let teamId = getTeamCalendarId_();
  let displays = getDisplayCalendars_();
  let bufferMin = getScheduleBufferMin_();

  let result = { events: [], errors: [], settings: { bufferMin: bufferMin, teamCalendarId: teamId, displayCalendars: displays } };

  let fetchFrom = function(calendarId, label, isEditable) {
    if (!calendarId) return [];
    let cal;
    try { cal = CalendarApp.getCalendarById(calendarId); } catch (e) { cal = null; }
    if (!cal) {
      result.errors.push((label || calendarId) + ' にアクセスできませんでした');
      return [];
    }
    let events;
    try { events = cal.getEvents(start, end); } catch (e) {
      result.errors.push((label || calendarId) + ' のイベント取得に失敗しました');
      return [];
    }
    let mapped = [];
    for (let i = 0; i < events.length; i++) {
      let ev = events[i];
      mapped.push({
        id: ev.getId(),
        calendarId: calendarId,
        calendarName: label || calendarId,
        title: ev.getTitle() || '(無題)',
        start: ev.getStartTime().toISOString(),
        end: ev.getEndTime().toISOString(),
        isEditable: !!isEditable
      });
    }
    return mapped;
  };

  if (teamId) result.events.push.apply(result.events, fetchFrom(teamId, 'チームカレンダー', true));
  for (let i = 0; i < displays.length; i++) {
    result.events.push.apply(result.events, fetchFrom(displays[i].id, displays[i].name, false));
  }
  return result;
}

/**
 * 指定日時帯がチーム＋表示専用カレンダーと重複していないか判定する。
 * バッファ込みで判定し、重複があれば一覧を返す。
 * @param {string} startIso             希望開始時刻（ISO）
 * @param {number} durationMin          希望継続時間（分）
 * @param {string} [excludeEventId]     除外したいイベントID（編集中の自分自身）
 * @returns {{hasConflict: boolean, conflicts: Array, bufferMin: number}}
 */
function checkScheduleConflict(startIso, durationMin, excludeEventId) {
  getActor_();
  if (!startIso) throw new Error('開始日時が必要です。');
  let bufferMin = getScheduleBufferMin_();
  let win = computeBufferedWindow_(new Date(startIso), durationMin, bufferMin);
  if (isNaN(win.start.getTime()) || isNaN(win.end.getTime())) {
    throw new Error('日時のパースに失敗しました。');
  }

  let teamId = getTeamCalendarId_();
  let displays = getDisplayCalendars_();
  let allCals = [];
  if (teamId) allCals.push({ id: teamId, name: 'チームカレンダー' });
  for (let i = 0; i < displays.length; i++) allCals.push({ id: displays[i].id, name: displays[i].name });

  let exclude = String(excludeEventId || '');
  let conflicts = [];

  for (let c = 0; c < allCals.length; c++) {
    let cal;
    try { cal = CalendarApp.getCalendarById(allCals[c].id); } catch (e) { cal = null; }
    if (!cal) continue;
    let events;
    try { events = cal.getEvents(win.start, win.end); } catch (e) { continue; }
    for (let i = 0; i < events.length; i++) {
      let ev = events[i];
      if (exclude && ev.getId() === exclude) continue;
      let evWin = computeBufferedWindow_(ev.getStartTime(), Math.round((ev.getEndTime().getTime() - ev.getStartTime().getTime()) / 60000), bufferMin);
      if (eventsOverlap_(win.start, win.end, evWin.start, evWin.end)) {
        conflicts.push({
          calendarName: allCals[c].name,
          title: ev.getTitle() || '(無題)',
          start: ev.getStartTime().toISOString(),
          end: ev.getEndTime().toISOString()
        });
      }
    }
  }

  return { hasConflict: conflicts.length > 0, conflicts: conflicts, bufferMin: bufferMin };
}

/**
 * チームカレンダー（TEAM_CALENDAR_ID）にイベントを作成する。
 * v1.11.8: method=Zoom 時の強制登録に使用。フォールバックで SHARED_CALENDAR_ID 経由。
 * @returns {{eventId: string|null, calendarId: string|null}}
 */
function createTeamCalendarEvent_(title, startTime, durationMinutes, description) {
  let teamId = getTeamCalendarId_();
  if (!teamId) {
    console.warn('TEAM_CALENDAR_ID 未設定のためチームカレンダー登録をスキップ');
    return { eventId: null, calendarId: null };
  }
  let cal;
  try { cal = CalendarApp.getCalendarById(teamId); } catch (e) { cal = null; }
  if (!cal) {
    console.error('チームカレンダーにアクセスできません: ' + teamId);
    return { eventId: null, calendarId: null };
  }
  let dur = (durationMinutes && Number(durationMinutes) > 0) ? Number(durationMinutes) : 60;
  let start = new Date(startTime);
  let end = new Date(start.getTime() + dur * 60 * 1000);
  try {
    let event = cal.createEvent(title, start, end, { description: String(description || '') });
    return { eventId: event.getId(), calendarId: teamId };
  } catch (e) {
    console.error('チームカレンダーイベント作成失敗: ' + e.message);
    return { eventId: null, calendarId: null };
  }
}

/**
 * 重複検知のエラーメッセージを組み立てる
 */
function formatScheduleConflictMessage_(conflictResult) {
  let lines = conflictResult.conflicts.map(function(c) {
    let s = new Date(c.start);
    let e = new Date(c.end);
    let m = (s.getMonth() + 1);
    let d = s.getDate();
    let hh = String(s.getHours()).padStart(2, '0');
    let mm = String(s.getMinutes()).padStart(2, '0');
    let eh = String(e.getHours()).padStart(2, '0');
    let em = String(e.getMinutes()).padStart(2, '0');
    return '・[' + c.calendarName + '] ' + c.title + '（' + m + '/' + d + ' ' + hh + ':' + mm + '〜' + eh + ':' + em + '）';
  });
  return 'スケジュール重複：以下の予定と被っています（前後' + conflictResult.bufferMin + '分のバッファを含む）。\n' + lines.join('\n');
}

// ======================================================================
// 既存カレンダーイベントの日時を更新
// ======================================================================
function getApiCalendarId_() {
  let sharedCalId = getSetting_('SHARED_CALENDAR_ID', '');
  return (sharedCalId && sharedCalId !== 'primary') ? sharedCalId : 'primary';
}

function updateCalendarEventDateTime_(eventId, newStartTime, durationMinutes) {
  if (!eventId) return;
  try {
    let apiCalId = getApiCalendarId_();
    let cleanId = String(eventId).replace('@google.com', '');
    let start = new Date(newStartTime);
    let dur = (durationMinutes && Number(durationMinutes) > 0) ? Number(durationMinutes) : 60;
    let end = new Date(start.getTime() + dur * 60 * 1000);
    Calendar.Events.patch({
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() }
    }, apiCalId, cleanId);
    console.log('カレンダーイベント日時更新成功: eventId=' + cleanId);
  } catch(e) {
    console.error('カレンダーイベント日時更新エラー: ' + e.message + ' (eventId=' + eventId + ')');
  }
}

// ======================================================================
// 既存カレンダーイベントのdescriptionを更新
// ======================================================================
function updateCalendarEventDescription_(eventId, newDescription) {
  if (!eventId) return;
  try {
    let apiCalId = getApiCalendarId_();
    let cleanId = String(eventId).replace('@google.com', '');
    Calendar.Events.patch({ description: newDescription }, apiCalId, cleanId);
    console.log('カレンダーイベント説明更新成功: eventId=' + cleanId);
  } catch(e) {
    console.error('カレンダーイベント説明更新エラー: ' + e.message + ' (eventId=' + eventId + ')');
  }
}

// ======================================================================
// Meet/Zoom URL の更新
// ======================================================================

/**
 * 案件のMeet/Zoom URLを更新する。カレンダーイベントのdescriptionも同期更新。
 * @param {string} caseId - 案件ID
 * @param {string} newUrl - 新しいURL（空文字で削除）
 * @returns {object} { meetUrl }
 */
function updateMeetUrl() { return runWrite_(updateMeetUrlImpl_, arguments); }
function updateMeetUrlImpl_(caseId, newUrl) {
  let actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, false);

  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  let data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][IDX.RECORDS.FK]) === String(caseId)) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) throw new Error('レコードが見つかりません: ' + caseId);

  let row = data[rowIndex - 1];
  let beforeUrl = row[IDX.RECORDS.MEET_URL] || '';
  let eventId = row[IDX.RECORDS.EVENT_ID];
  let url = (newUrl || '').trim();

  // MEET_URL 列を更新
  sheet.getRange(rowIndex, IDX.RECORDS.MEET_URL + 1).setValue(url);

  // カレンダーイベントのdescription + conferenceData（「Meetに参加する」ボタン）を更新
  if (eventId) {
    try {
      let apiCalId = getApiCalendarId_();
      let cleanId = String(eventId).replace('@google.com', '');
      let event = Calendar.Events.get(apiCalId, cleanId);
      let existingDesc = event.description || '';

      // 既存のURL行（"...URL: http..."）を除去
      let urlLinePattern = /^(Google Meet URL|Zoom URL|URL)\s*[:：]\s*https?:\/\/\S+\s*/gm;
      let stripped = existingDesc.replace(urlLinePattern, '');
      stripped = stripped.replace(/^\n+/, '');

      // 新しいURL行を先頭に挿入
      let newDesc;
      if (url) {
        let label = url.indexOf('zoom.us') !== -1 ? 'Zoom URL' : url.indexOf('meet.google') !== -1 ? 'Google Meet URL' : 'URL';
        newDesc = label + ': ' + url + (stripped ? '\n\n' + stripped : '');
      } else {
        newDesc = stripped;
      }

      // patch用オブジェクトを構築
      let patchBody = { description: newDesc };

      // 「Google Meetに参加する」ボタン（conferenceData）の更新
      let isMeetUrl = url && url.indexOf('meet.google.com/') !== -1;
      if (isMeetUrl) {
        // Meet URLからミーティングコードを抽出（例: abc-defg-hij）
        let meetCode = url.replace(/.*meet\.google\.com\//, '').replace(/[?#].*$/, '');
        patchBody.conferenceData = {
          conferenceId: meetCode,
          conferenceSolution: {
            key: { type: 'hangoutsMeet' },
            name: 'Google Meet'
          },
          entryPoints: [
            { entryPointType: 'video', uri: url, label: meetCode }
          ]
        };
      } else if (event.conferenceData) {
        // Meet以外のURL or URL削除 → conferenceDataをクリア（古いボタンが残らないように）
        patchBody.conferenceData = null;
      }

      Calendar.Events.patch(patchBody, apiCalId, cleanId, { conferenceDataVersion: 1 });
      console.log('カレンダーイベント更新成功: eventId=' + cleanId + ' url=' + url);
    } catch (e) {
      console.error('カレンダーURL差し替えエラー: ' + e.message + ' (eventId=' + eventId + ')');
    }
  }

  appendAuditLog_(actor, 'update_meet_url', 'case', caseId, { meetUrl: beforeUrl }, { meetUrl: url });
  return { meetUrl: url };
}
