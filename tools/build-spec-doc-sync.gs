/**
 * BUILD_SPEC.md → 固定 Google ドキュメントの「先頭タブのみ」変換同期（スタンドアロン GAS）
 * ---------------------------------------------------------------------------
 * 目的:
 *   Drive デスクトップで共有ドライブに同期済みの docs/BUILD_SPEC.md（生 Markdown）を、
 *   1つの Google ドキュメントの「一番上のタブ」にだけ取り込み・整形して上書きする。
 *   他のタブには一切干渉しない。ドキュメントIDは変えないため URL は不変（バージョンアップ運用）。
 *
 * 方式:
 *   - Drive の「ファイル全体の取り込み変換」は使わない（全タブを上書きしてしまうため）。
 *   - Google Docs API（documents.get / documents.batchUpdate）で、先頭タブ(tabId)の本文だけを
 *     削除→再挿入する。すべての編集リクエストに tabId を付け、対象を先頭タブに限定する。
 *   - Markdown は簡易整形（見出し/太字/インラインコード/箇条書き/番号/コードブロック）に変換。
 *     表はテキスト化（セルを " | " で連結、ヘッダ行は太字）。
 *
 * 認証情報: 不要（実行ユーザー自身の Google 権限）。
 * 注意: 本番の業務 GAS（コード.js）とは別の独立プロジェクトで動かすこと。
 *
 * セットアップ手順は tools/README-doc-sync.md を参照。
 */

// ===================== 設定（ここだけ編集） =====================
// Drive 上の BUILD_SPEC.md の fileId（setUp_findSource() で取得して貼り付け）
var SRC_MD_FILE_ID = '';
// 対象 Google ドキュメントの ID（その「先頭タブ」だけが書き換わる。URL は不変）
var TARGET_DOC_ID  = '';
// コードブロック/インラインコードに使うフォント
var CODE_FONT = 'Consolas';
// ==============================================================

/**
 * 補助: 同期済みの BUILD_SPEC.md を Drive 内から探し、fileId と URL をログ出力する。
 */
function setUp_findSource() {
  var found = false;
  var it = DriveApp.getFilesByName('BUILD_SPEC.md');
  while (it.hasNext()) {
    var f = it.next();
    found = true;
    Logger.log('name=%s\n  id=%s\n  url=%s', f.getName(), f.getId(), f.getUrl());
  }
  if (!found) Logger.log('BUILD_SPEC.md が見つかりません。Drive デスクトップの同期を確認してください。');
}

/**
 * 補助: 対象ドキュメントのタブ一覧（tabId・タイトル）をログ出力する。
 * 「一番上のタブ」が想定どおりか確認するのに使う。
 */
function setUp_listTabs() {
  if (!TARGET_DOC_ID) throw new Error('TARGET_DOC_ID が未設定です。');
  var doc = docsGet_(TARGET_DOC_ID);
  if (!doc.tabs || !doc.tabs.length) { Logger.log('タブ情報が取得できません。'); return; }
  doc.tabs.forEach(function (t, i) {
    var tp = t.tabProperties || {};
    Logger.log('[%s] %s  tabId=%s%s', i, (tp.title || '(無題)'), tp.tabId, (i === 0 ? '  ← 先頭タブ（更新対象）' : ''));
  });
}

/**
 * 本処理: BUILD_SPEC.md を読み、先頭タブの本文だけを再構築する。他タブには触れない。
 * 更新のたびにこの関数を実行する。
 */
function syncBuildSpecDoc() {
  if (!SRC_MD_FILE_ID) throw new Error('SRC_MD_FILE_ID が未設定です。setUp_findSource() で取得して設定してください。');
  if (!TARGET_DOC_ID)  throw new Error('TARGET_DOC_ID が未設定です。対象ドキュメントの ID を設定してください。');

  // 1) Markdown を読み込む
  var md = DriveApp.getFileById(SRC_MD_FILE_ID).getBlob().getDataAsString('UTF-8');

  // 2) 先頭タブの tabId と本文末尾インデックスを取得
  var doc = docsGet_(TARGET_DOC_ID);
  if (!doc.tabs || !doc.tabs.length) {
    throw new Error('対象ドキュメントのタブを取得できません。Google ドキュメントであること、アクセス権を確認してください。');
  }
  var firstTab = doc.tabs[0];
  var tabId = firstTab.tabProperties && firstTab.tabProperties.tabId;
  var content = firstTab.documentTab && firstTab.documentTab.body && firstTab.documentTab.body.content;
  if (!tabId || !content) throw new Error('先頭タブの本文を取得できません。');
  var contentEndIndex = content[content.length - 1].endIndex; // 末尾（通常は終端改行の後）

  // 3) Markdown を「プレーンテキスト＋整形情報」に変換
  var model = mdToModel_(md);

  // 4) 先頭タブ限定の編集リクエストを構築（削除→挿入→段落整形→文字整形）
  var requests = [];
  if (contentEndIndex > 2) {
    requests.push({ deleteContentRange: { range: rangeT_(1, contentEndIndex - 1, tabId) } });
  }
  requests.push({ insertText: { location: locT_(1, tabId), text: model.text } });

  var base = 1; // 挿入後、オフセット o は doc インデックス base+o
  model.paras.forEach(function (p) {
    var range = rangeT_(base + p.start, base + p.end, tabId);
    if (p.type === 'heading') {
      requests.push({ updateParagraphStyle: { range: range, paragraphStyle: { namedStyleType: 'HEADING_' + p.level }, fields: 'namedStyleType' } });
    } else if (p.type === 'bullet') {
      requests.push({ createParagraphBullets: { range: range, bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE' } });
    } else if (p.type === 'ordered') {
      requests.push({ createParagraphBullets: { range: range, bulletPreset: 'NUMBERED_DECIMAL_ALPHA_ROMAN' } });
    }
  });
  model.runs.forEach(function (r) {
    var range = rangeT_(base + r.start, base + r.end, tabId);
    if (r.kind === 'bold') {
      requests.push({ updateTextStyle: { range: range, textStyle: { bold: true }, fields: 'bold' } });
    } else if (r.kind === 'code') {
      requests.push({ updateTextStyle: { range: range, textStyle: { weightedFontFamily: { fontFamily: CODE_FONT } }, fields: 'weightedFontFamily' } });
    }
  });

  // 5) batchUpdate 実行（先頭タブのみが対象）
  docsBatchUpdate_(TARGET_DOC_ID, requests);
  Logger.log('✅ 先頭タブのみ更新しました（他タブ・URL は不変）: https://docs.google.com/document/d/%s/edit', TARGET_DOC_ID);
}

/** 任意: 1 時間ごとに自動同期するトリガーを設置する。 */
function installHourlyTrigger() {
  removeSyncTriggers();
  ScriptApp.newTrigger('syncBuildSpecDoc').timeBased().everyHours(1).create();
  Logger.log('時間トリガー（1 時間ごと）を設置しました。');
}

/** 自動同期トリガーを削除する。 */
function removeSyncTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncBuildSpecDoc') ScriptApp.deleteTrigger(t);
  });
  Logger.log('syncBuildSpecDoc のトリガーを削除しました（無ければ何もしません）。');
}

// ======================================================================
// Docs REST ヘルパー（UrlFetchApp + OAuth トークン）
// ======================================================================
function docsGet_(docId) {
  var url = 'https://docs.googleapis.com/v1/documents/' + encodeURIComponent(docId) + '?includeTabsContent=true';
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('documents.get 失敗 (HTTP ' + res.getResponseCode() + '): ' + res.getContentText());
  return JSON.parse(res.getContentText());
}

function docsBatchUpdate_(docId, requests) {
  var url = 'https://docs.googleapis.com/v1/documents/' + encodeURIComponent(docId) + ':batchUpdate';
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ requests: requests }),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('documents.batchUpdate 失敗 (HTTP ' + res.getResponseCode() + '): ' + res.getContentText());
  return JSON.parse(res.getContentText());
}

function rangeT_(startIndex, endIndex, tabId) { return { startIndex: startIndex, endIndex: endIndex, tabId: tabId }; }
function locT_(index, tabId) { return { index: index, tabId: tabId }; }

// ======================================================================
// Markdown → モデル（プレーンテキスト＋段落整形＋文字整形）への簡易変換
// ======================================================================
/**
 * @return {{text:string, paras:Array, runs:Array}}
 *   paras: [{start,end,type('heading'|'bullet'|'ordered'|'normal'),level}]  (offset は text 内)
 *   runs : [{start,end,kind('bold'|'code')}]
 */
function mdToModel_(md) {
  var srcLines = String(md).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  var outLines = [];   // {text, type, level}
  var inFence = false;

  for (var i = 0; i < srcLines.length; i++) {
    var line = srcLines[i];

    // コードフェンス（``` ... ```）
    var fence = line.match(/^\s*```/);
    if (fence) { inFence = !inFence; continue; } // フェンス行自体は出力しない
    if (inFence) { outLines.push({ text: line, type: 'code', level: 0 }); continue; }

    // 水平線
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { outLines.push({ text: '', type: 'normal', level: 0 }); continue; }

    // 表（| で始まる連続行）
    if (/^\s*\|/.test(line)) {
      // 区切り行（|---|---|）はスキップ
      if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.indexOf('-') >= 0) continue;
      var cells = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); });
      outLines.push({ text: cells.join('   |   '), type: 'table', level: 0 });
      continue;
    }

    // 見出し
    var h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { outLines.push({ text: h[2], type: 'heading', level: Math.min(h[1].length, 6) }); continue; }

    // 引用（> ） → 通常段落として ">" を除去
    var bq = line.match(/^\s*>\s?(.*)$/);
    if (bq) { outLines.push({ text: bq[1], type: 'normal', level: 0 }); continue; }

    // 箇条書き
    var ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) { outLines.push({ text: ul[1], type: 'bullet', level: 0 }); continue; }

    // 番号付き
    var ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) { outLines.push({ text: ol[1], type: 'ordered', level: 0 }); continue; }

    // 通常段落
    outLines.push({ text: line, type: 'normal', level: 0 });
  }

  // 連続する空の通常段落は1つに圧縮（見やすさ）
  var compact = [];
  for (var j = 0; j < outLines.length; j++) {
    var cur = outLines[j];
    var prev = compact[compact.length - 1];
    if (cur.type === 'normal' && cur.text === '' && prev && prev.type === 'normal' && prev.text === '') continue;
    compact.push(cur);
  }
  outLines = compact;

  // テキスト組み立て＋インライン整形（太字・コード）の絶対オフセット収集
  var text = '';
  var paras = [];
  var runs = [];
  var tableRowSeen = {}; // 連続表ブロックの先頭行（ヘッダ）判定用
  var prevType = null;

  for (var k = 0; k < outLines.length; k++) {
    var o = outLines[k];
    var lineStart = text.length;
    var parsed;

    if (o.type === 'code') {
      // コードはインライン解釈せず、行全体を等幅に
      parsed = { plain: o.text, runs: [{ start: 0, end: o.text.length, kind: 'code' }] };
    } else if (o.type === 'table') {
      parsed = parseInline_(o.text);
      // 表ブロックの先頭行はヘッダとみなして太字
      var isHeader = (prevType !== 'table');
      if (isHeader) parsed.runs.push({ start: 0, end: o.text.length, kind: 'bold' });
    } else {
      parsed = parseInline_(o.text);
    }

    // 文字整形 run を絶対オフセットへ
    for (var r = 0; r < parsed.runs.length; r++) {
      runs.push({ start: lineStart + parsed.runs[r].start, end: lineStart + parsed.runs[r].end, kind: parsed.runs[r].kind });
    }

    var lineText = parsed.plain;
    text += lineText + '\n';

    // 段落整形（表は通常段落扱い、コードは通常段落＋等幅文字）
    var paraType = (o.type === 'heading' || o.type === 'bullet' || o.type === 'ordered') ? o.type : 'normal';
    paras.push({ start: lineStart, end: lineStart + lineText.length + 1, type: paraType, level: o.level });

    prevType = o.type;
  }

  return { text: text, paras: paras, runs: runs };
}

/**
 * 1行内のインライン Markdown（**太字**・`コード`・[text](url)）を解釈し、
 * マークアップを除去したプレーンテキストと、行内オフセットの整形 run を返す。
 */
function parseInline_(line) {
  var out = '';
  var runs = [];
  var i = 0;
  var n = line.length;
  while (i < n) {
    // 太字 **...**
    if (line.charAt(i) === '*' && line.charAt(i + 1) === '*') {
      var close = line.indexOf('**', i + 2);
      if (close > -1) {
        var inner = line.substring(i + 2, close);
        var s = out.length;
        out += inner;
        runs.push({ start: s, end: out.length, kind: 'bold' });
        i = close + 2;
        continue;
      }
    }
    // インラインコード `...`
    if (line.charAt(i) === '`') {
      var cclose = line.indexOf('`', i + 1);
      if (cclose > -1) {
        var code = line.substring(i + 1, cclose);
        var cs = out.length;
        out += code;
        runs.push({ start: cs, end: out.length, kind: 'code' });
        i = cclose + 1;
        continue;
      }
    }
    // リンク [text](url) → text（url）
    if (line.charAt(i) === '[') {
      var m = line.substring(i).match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (m) {
        out += m[1] + '（' + m[2] + '）';
        i += m[0].length;
        continue;
      }
    }
    out += line.charAt(i);
    i++;
  }
  return { plain: out, runs: runs };
}
