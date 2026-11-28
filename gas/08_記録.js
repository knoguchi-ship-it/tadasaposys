// ======================================================================
// 記録 — 添付ファイル・サポート記録の更新（完了報告など）・過去の対応記録の編集
//   GAS では全ファイルが同じグローバル空間を共有する。手で実行する関数は 00_管理者メニュー に置く。
// ======================================================================

function parseJsonArray_(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    let parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function buildKeepAttachmentIdMap_(keepAttachmentIds) {
  let map = {};
  (keepAttachmentIds || []).forEach(function(id) {
    let key = String(id || '').trim();
    if (key) map[key] = true;
  });
  return map;
}

function getAttachmentFolder_() {
  let folderId = getSetting_('ATTACHMENT_FOLDER_ID', '');
  if (!folderId) throw new Error('添付ファイル保存先が未設定です。設定シートの ATTACHMENT_FOLDER_ID を入力してください。');
  try {
    return DriveApp.getFolderById(folderId);
  } catch (e) {
    throw new Error('ATTACHMENT_FOLDER_ID が無効です。設定シートを確認してください。');
  }
}

function saveNewAttachments_(caseId, user, newAttachments) {
  let files = newAttachments || [];
  if (!files.length) return [];

  let folder = getAttachmentFolder_();
  let uploaded = [];
  for (let i = 0; i < files.length; i++) {
    let f = files[i] || {};
    let fileName = String(f.name || ('attachment_' + (i + 1)));
    let mimeType = String(f.mimeType || 'application/octet-stream');
    let base64Data = String(f.base64Data || '');
    if (!base64Data) continue;

    let blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
    let file = folder.createFile(blob);
    uploaded.push({
      fileId: file.getId(),
      name: file.getName(),
      url: file.getUrl(),
      mimeType: mimeType,
      size: Number(f.size) || file.getSize() || 0,
      uploadedAt: new Date().toISOString(),
      uploadedBy: user && user.email ? user.email : ''
    });
  }
  return uploaded;
}

function trashRemovedAttachments_(existingAttachments, keepIdMap) {
  (existingAttachments || []).forEach(function(att) {
    let fileId = String(att && att.fileId ? att.fileId : '');
    if (!fileId || keepIdMap[fileId]) return;
    try {
      DriveApp.getFileById(fileId).setTrashed(true);
    } catch (e) {
      // 既に削除済み・権限なしは無視して更新を継続
    }
  });
}

// ======================================================================
// サポート記録の更新（方法別: Meet / Zoom / その他）
// ======================================================================
function updateSupportRecord() { return runWrite_(updateSupportRecordImpl_, arguments); }
function updateSupportRecordImpl_(recordData) {
  let actor = getActor_();
  ensureCaseEditableByActor_(recordData.timestamp, actor, false);

  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  let data = sheet.getDataRange().getValues();
  let rowIndex = -1;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][IDX.RECORDS.FK]) === String(recordData.timestamp)) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) {
    // 管理者が unhandled 案件の日時を設定する場合など、レコード行が未作成のケースに対応
    if (!actor.isAdmin) throw new Error('レコードが見つかりません ID: ' + recordData.timestamp);
    rowIndex = ensureRecordRowForCase_(sheet, recordData.timestamp);
    // 行を新規作成したので data を再取得
    data = sheet.getDataRange().getValues();
  }

  let before = {
    status: data[rowIndex - 1][IDX.RECORDS.STATUS],
    scheduledDateTime: data[rowIndex - 1][IDX.RECORDS.DATE],
    method: data[rowIndex - 1][IDX.RECORDS.METHOD],
    content: data[rowIndex - 1][IDX.RECORDS.CONTENT]
  };

  let currentMeetUrl = data[rowIndex - 1][IDX.RECORDS.MEET_URL];
  let currentAttachments = parseJsonArray_(data[rowIndex - 1][IDX.RECORDS.ATTACHMENTS]);
  let eventTitle = '【タダサポ】' + recordData.officeName + ' 様';

  // サーバー生成データを追跡
  let newMeetUrl = null;
  let newEventId = null;

  let currentEventId = data[rowIndex - 1][IDX.RECORDS.EVENT_ID];

  // v1.11.9-r2: 重複検知は方法=Zoom 時のみ実行（Zoom以外はチェックなし）
  // skipConflictCheck=true でバイパス可能。
  let needsConflictCheck = recordData.scheduledDateTime && !currentMeetUrl && recordData.method === 'Zoom';
  if (needsConflictCheck && !recordData.skipConflictCheck) {
    let confDur = (recordData.duration && Number(recordData.duration) > 0) ? Number(recordData.duration) : 60;
    let conflictResult = checkScheduleConflict(recordData.scheduledDateTime, confDur, currentEventId || null);
    if (conflictResult.hasConflict) {
      throw new Error(formatScheduleConflictMessage_(conflictResult));
    }
  }

  if (recordData.scheduledDateTime && !currentMeetUrl) {
    if (recordData.method === 'Zoom') {
      // v1.11.8: チームカレンダーへ強制登録 + 個人カレンダーは useCalendar に従う
      // v1.12.0: zoomMode = 'new'（既定 / 新規発行）または 'fixed'（固定ZoomID使用）
      let zDur = (recordData.duration && Number(recordData.duration) > 0) ? Number(recordData.duration) : 60;
      let zStart = new Date(recordData.scheduledDateTime);
      let appUrl = ScriptApp.getService().getUrl() || '';
      let zoomMode = String(recordData.zoomMode || 'new').toLowerCase();

      if (zoomMode === 'fixed') {
        // 固定Zoom: ZOOM_FIXED_URL を使用（API 呼び出しなし）
        let fixedUrl = String(getSetting_('ZOOM_FIXED_URL', '') || '').trim();
        let fixedId = String(getSetting_('ZOOM_FIXED_ID', '') || '').trim();
        let fixedPass = String(getSetting_('ZOOM_FIXED_PASS', '') || '').trim();
        if (fixedUrl) {
          newMeetUrl = fixedUrl;
        } else {
          throw new Error('「いつものタダスクID」が設定されていません。設定シートの ZOOM_FIXED_URL を入力するか、新規発行モードに切替えてください。');
        }
        // ID/PASS は description に追記
        var fixedExtra = [];
        if (fixedId) fixedExtra.push('ID: ' + fixedId);
        if (fixedPass) fixedExtra.push('PASS: ' + fixedPass);
        var fixedSuffix = fixedExtra.length ? '（' + fixedExtra.join(' / ') + '）' : '';
        var fixedHeader = '【いつものタダスクID】 ' + fixedUrl + fixedSuffix + '\n\n';
        // zDesc は下で組み立てるので、ここで先行ヘッダだけ保持
        var zoomLeadingDesc = fixedHeader;
      } else {
        // 新規発行: 既存ロジック維持
        try {
          let zoomResult = createZoomMeeting_(eventTitle, recordData.scheduledDateTime, zDur);
          newMeetUrl = zoomResult.joinUrl;
        } catch(e) { console.error('Zoom会議作成エラー（カレンダーのみ作成します）: ' + e.message); }
        var zoomLeadingDesc = newMeetUrl ? 'Zoom URL: ' + newMeetUrl + '\n\n' : '';
      }

      let zDesc = zoomLeadingDesc +
                  (recordData.details || '') +
                  (appUrl ? '\n\nタダサポ管理: ' + appUrl : '');

      // チームカレンダーへ強制登録（重複防止のため必須）
      let teamEvent = createTeamCalendarEvent_(eventTitle, zStart, zDur, zDesc);
      if (teamEvent.eventId) {
        newEventId = teamEvent.eventId;
      } else {
        // チームカレンダー未設定/アクセス不可時は SHARED_CALENDAR_ID にフォールバック
        try {
          let zSharedCalId = getSetting_('SHARED_CALENDAR_ID', '');
          let zCalFb = (zSharedCalId && zSharedCalId !== 'primary') ? CalendarApp.getCalendarById(zSharedCalId) : null;
          if (!zCalFb) zCalFb = CalendarApp.getDefaultCalendar();
          let zEnd = new Date(zStart.getTime() + zDur * 60 * 1000);
          let zEvent = zCalFb.createEvent(eventTitle, zStart, zEnd, { description: zDesc });
          newEventId = zEvent.getId();
        } catch(e) { console.error('Zoom用フォールバックカレンダー作成エラー: ' + e.message); }
      }

      // useCalendar=true の場合、個人/共有カレンダー（SHARED_CALENDAR_ID）にも追加登録
      // ただし TEAM_CALENDAR_ID と同一の場合は二重登録を避けるためスキップ
      if (!recordData.skipCalendar) {
        try {
          let teamId = getTeamCalendarId_();
          let zSharedCalId = getSetting_('SHARED_CALENDAR_ID', '');
          let zCal = (zSharedCalId && zSharedCalId !== 'primary') ? CalendarApp.getCalendarById(zSharedCalId) : null;
          if (!zCal) zCal = CalendarApp.getDefaultCalendar();
          let personalCalId = zCal ? zCal.getId() : '';
          if (zCal && personalCalId && personalCalId !== teamId) {
            let zEnd = new Date(zStart.getTime() + zDur * 60 * 1000);
            zCal.createEvent(eventTitle, zStart, zEnd, { description: zDesc });
            // eventId はチーム側を維持（更新時の追跡対象）
          }
        } catch(e) { console.error('個人カレンダー登録エラー: ' + e.message); }
      }
    } else if (recordData.method === 'GoogleMeet' && !recordData.skipCalendar) {
      try {
        let meetResult = createGoogleMeetEvent_(eventTitle, recordData.scheduledDateTime, recordData.details, recordData.duration);
        newEventId = meetResult.eventId;
        newMeetUrl = meetResult.meetUrl;
      } catch(e) { console.error('Google Meet作成エラー: ' + e.message); }
    }
  } else if (recordData.scheduledDateTime && currentEventId && !recordData.skipCalendar) {
    // 既存カレンダーイベントの日時を更新
    updateCalendarEventDateTime_(currentEventId, recordData.scheduledDateTime, recordData.duration);
  }

  // 添付ファイル処理（バッチ書き込みの前に解決）
  let finalAttachments = null;
  let attachmentsValue = data[rowIndex - 1][IDX.RECORDS.ATTACHMENTS];
  let hasAttachmentUpdate = recordData.keepAttachmentIds !== undefined || recordData.newAttachments !== undefined;
  if (hasAttachmentUpdate) {
    let keepIds = Array.isArray(recordData.keepAttachmentIds)
      ? recordData.keepAttachmentIds
      : currentAttachments.map(function(a) { return a.fileId; });
    let keepIdMap = buildKeepAttachmentIdMap_(keepIds);
    let keptAttachments = currentAttachments.filter(function(a) {
      return !!(a && a.fileId && keepIdMap[String(a.fileId)]);
    });
    let uploadedAttachments = saveNewAttachments_(recordData.timestamp, recordData.user || null, recordData.newAttachments || []);
    let mergedAttachments = keptAttachments.concat(uploadedAttachments);

    if (mergedAttachments.length > 5) {
      throw new Error('添付ファイルは1回の報告につき最大5件です。');
    }

    trashRemovedAttachments_(currentAttachments, keepIdMap);
    attachmentsValue = JSON.stringify(mergedAttachments);
    finalAttachments = mergedAttachments;
  }

  // STATUS(1)～TOOLS(17) を一括書き込み（既存値を保持しつつ変更箇所を上書き）
  let curRow = data[rowIndex - 1];
  let batchRow = [
    recordData.status,                                                          // STATUS(1)
    curRow[IDX.RECORDS.STAFF_EMAIL],                                            // STAFF_EMAIL(2)
    curRow[IDX.RECORDS.STAFF_NAME],                                             // STAFF_NAME(3)
    recordData.scheduledDateTime ? new Date(recordData.scheduledDateTime) : null, // DATE(4)
    curRow[IDX.RECORDS.COUNT],                                                  // COUNT(5)
    recordData.method,                                                          // METHOD(6)
    curRow[IDX.RECORDS.BUSINESS],                                               // BUSINESS(7)
    sanitizeForSheet_(recordData.content),                                      // CONTENT(8)
    curRow[IDX.RECORDS.REMARKS],                                                // REMARKS(9)
    curRow[IDX.RECORDS.HISTORY],                                                // HISTORY(10)
    newEventId || curRow[IDX.RECORDS.EVENT_ID],                                 // EVENT_ID(11)
    newMeetUrl || curRow[IDX.RECORDS.MEET_URL],                                 // MEET_URL(12)
    curRow[IDX.RECORDS.THREAD_ID],                                              // THREAD_ID(13)
    attachmentsValue,                                                           // ATTACHMENTS(14)
    curRow[IDX.RECORDS.CASE_LIMIT_OVERRIDE],                                    // CASE_LIMIT_OVERRIDE(15)
    curRow[IDX.RECORDS.ANNUAL_LIMIT_OVERRIDE],                                  // ANNUAL_LIMIT_OVERRIDE(16)
    recordData.tools !== undefined ? (Array.isArray(recordData.tools) ? JSON.stringify(recordData.tools) : '[]') : curRow[IDX.RECORDS.TOOLS]  // TOOLS(17)
  ];
  sheet.getRange(rowIndex, IDX.RECORDS.STATUS + 1, 1, batchRow.length).setValues([batchRow]);

  // ── 都道府県・サービス種別の案件情報更新（完了報告時など） ──
  let hasCaseInfoUpdate = (recordData.prefecture !== undefined && recordData.prefecture !== null) ||
                          (recordData.serviceType !== undefined && recordData.serviceType !== null);
  if (hasCaseInfoUpdate) {
    let caseId = recordData.timestamp;
    let caseSheet = ss.getSheetByName(SHEET_NAMES.CASES);
    let caseRowIdx = getCaseRowIndex_(caseSheet, caseId);
    let isManual = false;
    let manualSh = null;
    let manualRowIdx = -1;
    if (caseRowIdx === -1) {
      manualSh = ss.getSheetByName(SHEET_NAMES.CASES_MANUAL);
      if (manualSh) manualRowIdx = getCaseRowIndex_(manualSh, caseId);
      if (manualRowIdx !== -1) isManual = true;
    }
    if (isManual && manualSh) {
      // 手動案件: CASES_MANUAL シートに直接書き込み
      if (recordData.prefecture !== undefined && recordData.prefecture !== null) {
        manualSh.getRange(manualRowIdx, IDX.CASES.PREFECTURE + 1).setValue(sanitizeForSheet_(String(recordData.prefecture).trim()));
      }
      if (recordData.serviceType !== undefined && recordData.serviceType !== null) {
        manualSh.getRange(manualRowIdx, IDX.CASES.SERVICE + 1).setValue(sanitizeForSheet_(String(recordData.serviceType).trim()));
      }
    } else if (caseRowIdx !== -1) {
      // 通常案件: 案件補正シートに書き込み
      let ovrSheet = ensureCasesOverrideSheet_(ss);
      let ovrRowIdx = getOrCreateOverrideRowIndex_(ovrSheet, caseId);
      if (recordData.prefecture !== undefined && recordData.prefecture !== null) {
        ovrSheet.getRange(ovrRowIdx, IDX.CASES_OVERRIDE.PREFECTURE + 1).setValue(sanitizeForSheet_(String(recordData.prefecture).trim()));
      }
      if (recordData.serviceType !== undefined && recordData.serviceType !== null) {
        ovrSheet.getRange(ovrRowIdx, IDX.CASES_OVERRIDE.SERVICE + 1).setValue(sanitizeForSheet_(String(recordData.serviceType).trim()));
      }
    }
  }

  appendAuditLog_(actor, 'update_support_record', 'case', recordData.timestamp, before, {
    status: recordData.status,
    scheduledDateTime: recordData.scheduledDateTime || null,
    method: recordData.method || null
  });
  return { meetUrl: newMeetUrl, eventId: newEventId, attachments: finalAttachments };
}

// ======================================================================
// 過去の対応記録（supportHistory）の編集
// ======================================================================

/**
 * supportHistory 配列内の指定 roundIndex の記録を更新する。
 * 編集可能フィールド: scheduledDateTime, method, content, remarks, tools
 * @param {string} caseId - 案件ID
 * @param {number} roundIndex - 履歴配列内のインデックス（0始まり）
 * @param {object} patch - 更新するフィールド
 * @returns {object} 更新後の supportHistory 配列
 */
function updateSupportHistory() { return runWrite_(updateSupportHistoryImpl_, arguments); }
function updateSupportHistoryImpl_(caseId, roundIndex, patch) {
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
  let historyJson = row[IDX.RECORDS.HISTORY] ? String(row[IDX.RECORDS.HISTORY]) : '[]';
  let history = [];
  try { history = JSON.parse(historyJson); } catch(e) { history = []; }

  let idx = Number(roundIndex);
  if (!isFinite(idx) || idx < 0 || idx >= history.length) {
    throw new Error('指定された履歴インデックスが範囲外です: ' + roundIndex);
  }

  let before = JSON.parse(JSON.stringify(history[idx]));

  // 編集可能フィールドのみ更新
  if (patch.hasOwnProperty('scheduledDateTime')) {
    history[idx].scheduledDateTime = patch.scheduledDateTime || null;
  }
  if (patch.hasOwnProperty('method')) {
    history[idx].method = patch.method || null;
  }
  if (patch.hasOwnProperty('content')) {
    history[idx].content = patch.content || null;
  }
  if (patch.hasOwnProperty('remarks')) {
    history[idx].remarks = patch.remarks || null;
  }
  if (patch.hasOwnProperty('tools')) {
    history[idx].tools = Array.isArray(patch.tools) ? patch.tools : [];
  }

  sheet.getRange(rowIndex, IDX.RECORDS.HISTORY + 1).setValue(JSON.stringify(history));
  appendAuditLog_(actor, 'update_support_history', 'case', caseId, { roundIndex: idx, before: before }, { roundIndex: idx, after: history[idx] });
  return { supportHistory: history };
}
