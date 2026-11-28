/**
 * ドキュメント同期チェック（tools/check-sync.js）の単体テスト
 * 実ファイルではなく、読み込み関数を差し替えたダミー文書で検査ロジックを確かめる。
 */

'use strict';

const {
  parseCodeIdx, parseRulesIdx, parseSddSection, countTests,
  checkVersions, checkIdx, checkHandover, checkAdr, createReport, ID_PATTERNS,
} = require('../../tools/check-sync');

const errorsOf = (r) => r.items.filter((i) => i.level === 'error').map((i) => i.msg);

/** 版数がすべて v のダミー文書一式 */
function versionFiles(v, overrides = {}) {
  return {
    'package.json': JSON.stringify({ version: v }),
    'gas/01_定数と設定.js': `/**\n * タダサポ管理システム - Backend Logic (v${v})\n */`,
    'index.html': `<title>x</title>\n<meta name="app-version" content="${v}">`,
    'CHANGELOG.md': `# Changelog\n\n## [Unreleased]\n\n## [${v}] - 2026-01-01\n`,
    'AI_RULES.md': `- **現行バージョン:** v${v}\n`,
    'docs/SDD.md': `# SDD\n\n**Version:** ${v}\n`,
    'docs/HANDOVER.md': `# HANDOVER\n**Version:** ${v}（現行リリース）\n`,
    'docs/Manual.md': `# タダサポ管理システム 操作マニュアル v${v}\n`,
    ...overrides,
  };
}
const reader = (files) => (f) => {
  if (!(f in files)) throw new Error(`no fixture: ${f}`);
  return files[f];
};

describe('版数の同期', () => {
  test('全ファイルが package.json と同じ版なら合格', () => {
    const r = createReport();
    expect(checkVersions(r, reader(versionFiles('1.2.3')))).toBe('1.2.3');
    expect(errorsOf(r)).toEqual([]);
  });

  test('1ファイルだけ古い版ならそのファイルをエラーにする', () => {
    const r = createReport();
    checkVersions(r, reader(versionFiles('1.2.3', { 'docs/Manual.md': '操作マニュアル v1.2.2\n' })));
    expect(errorsOf(r)).toEqual([expect.stringContaining('docs/Manual.md: v1.2.2')]);
  });

  test('版数の記載自体がなければエラーにする（index.html の meta 欠落など）', () => {
    const r = createReport();
    checkVersions(r, reader(versionFiles('1.2.3', { 'index.html': '<title>x</title>' })));
    expect(errorsOf(r)).toEqual([expect.stringContaining('index.html: 版数の記載が見つからない')]);
  });
});

describe('IDX 定数の照合', () => {
  const code = `const X = 1;\nconst IDX = {\n  CASES: { PK: 0, EMAIL: 1 },\n  // コメント\n  STAFF: { NAME: 1, EMAIL: 2 }\n};\nfunction f() {}`;

  test('バックエンドの const IDX を入れ子のまま取り出す', () => {
    expect(parseCodeIdx(code)).toEqual({ CASES: { PK: 0, EMAIL: 1 }, STAFF: { NAME: 1, EMAIL: 2 } });
  });

  test('AI_RULES.md のデータモデル節から複数行の定義を読む', () => {
    const md = '## データモデル\n\n```javascript\nCASES: { PK:0,\n         EMAIL:1 }  // 2列\nSTAFF: { NAME:1, EMAIL:2 }\n```\n';
    expect(parseRulesIdx(md)).toEqual({ CASES: { PK: 0, EMAIL: 1 }, STAFF: { NAME: 1, EMAIL: 2 } });
  });

  test('SDD の2種類の表の書式を読む', () => {
    const md = [
      '### S-01: 案件',
      '| IDX | 物理列 | 論理名 |',
      '| 0 | A | `PK` | 主キー |',
      '| 1 | B | `EMAIL` | メール |',
      '### S-10: チャット',
      '| 物理列 | IDX | 論理名 |',
      '| A | `SUBMITTED_AT`: 0 | 申込日時 |',
    ].join('\n');
    expect(parseSddSection(md, 'S-01')).toEqual({ PK: 0, EMAIL: 1 });
    expect(parseSddSection(md, 'S-10')).toEqual({ SUBMITTED_AT: 0 });
    expect(parseSddSection(md, 'S-99')).toBeNull();
  });

  test('AI_RULES にないシート・列番号のずれをエラーにする', () => {
    const files = {
      'gas/01_定数と設定.js': 'const IDX = {\n  CASES: { PK: 0, EMAIL: 1 },\n  CHAT_LINK: { SUBMITTED_AT: 0 }\n};',
      'AI_RULES.md': '## データモデル\n```javascript\nCASES: { PK:0, EMAIL:2 }\n```\n',
      'docs/SDD.md': '',
    };
    const r = createReport();
    checkIdx(r, reader(files));
    const errs = errorsOf(r);
    expect(errs).toEqual(expect.arrayContaining([
      expect.stringContaining('AI_RULES.md データモデル節に CHAT_LINK がない'),
      expect.stringContaining('AI_RULES.md の CASES がコードと不一致: EMAIL: コード=1 / 文書=2'),
    ]));
  });
});

describe('HANDOVER の現在地', () => {
  const counts = { unit: 10, e2e: 5, perSpec: { '01-app-load': 3, '02-case-list': 2 } };
  const handover = (line, specs) => [
    line,
    '- **本番デプロイバージョン**: @20（v1.2.3、2026/01/01 デプロイ）',
    ...specs,
  ].join('\n');

  test('現在地・§1・§8 が実数と一致すれば合格', () => {
    const md = handover('> **現在地:** v1.2.3 / 本番 @20 / 単体 10件 / E2E 5件',
      ['- `01-app-load`: 初期化（3件）', '- `02-case-list`: 一覧（2件）']);
    const r = createReport();
    checkHandover(r, '1.2.3', counts, reader({ 'docs/HANDOVER.md': md }));
    expect(errorsOf(r)).toEqual([]);
  });

  test('本番未反映のときは「本番 @nn（vA.B.C）」の本番の版で §1 と照合する', () => {
    const md = handover('> **現在地:** v1.3.0 / 本番 @20（v1.2.3） / 単体 10件 / E2E 5件',
      ['- `01-app-load`: 初期化（3件）', '- `02-case-list`: 一覧（2件）']);
    const r = createReport();
    checkHandover(r, '1.3.0', counts, reader({ 'docs/HANDOVER.md': md }));
    expect(errorsOf(r)).toEqual([]);
  });

  test('件数の書き忘れ・§8 のスペック漏れ・§1 の @ ずれをエラーにする', () => {
    const md = handover('> **現在地:** v1.2.3 / 本番 @21 / 単体 9件 / E2E 5件',
      ['- `01-app-load`: 初期化（2件）']);
    const r = createReport();
    checkHandover(r, '1.2.3', counts, reader({ 'docs/HANDOVER.md': md }));
    expect(errorsOf(r)).toEqual(expect.arrayContaining([
      expect.stringContaining('現在地の単体 9件 ≠ 実テスト 10件'),
      expect.stringContaining('§1 本番デプロイバージョン @20'),
      expect.stringContaining('§8 01-app-load: 記載 2件 ≠ 実テスト 3件'),
      expect.stringContaining('§8 スペック一覧に 02-case-list がない'),
    ]));
  });

  test('テスト件数は test( / it( の行を静的に数える', () => {
    const files = {
      'tests/e2e/01-a.spec.ts': "test.describe('x', () => {\n  test('a', () => {});\n  test('b', () => {});\n});",
      'tests/unit/a.test.js': "describe('x', () => {\n  it('a', () => {});\n  test('b', () => {});\n});",
    };
    const list = (d) => Object.keys(files).filter((f) => f.startsWith(d + '/')).map((f) => f.slice(d.length + 1));
    expect(countTests(reader(files), list)).toEqual({ unit: 2, e2e: 2, perSpec: { '01-a': 2 }, dynamic: [] });
  });

  test('パラメータ化（each）を使うファイルは静的に数えられないため報告対象にする', () => {
    const files = {
      'tests/e2e/01-a.spec.ts': "test('a', () => {});",
      // 本ファイル自体が検出されないよう、実行時に組み立てる
      'tests/unit/a.test.js': 'test' + ".each([[1], [2]])('%s', () => {});",
    };
    const list = (d) => Object.keys(files).filter((f) => f.startsWith(d + '/')).map((f) => f.slice(d.length + 1));
    expect(countTests(reader(files), list).dynamic).toEqual(['tests/unit/a.test.js']);
  });
});

describe('ADR と識別子', () => {
  test('ADR 索引の番号が実際の最終番号と違えばエラーにする', () => {
    const files = {
      'docs/ADR.md': '## ADR-001: a\n## ADR-002: b\n## ADR-003: c\n',
      'AI_RULES.md': '| `docs/ADR.md` | 判断記録（ADR-001〜002） |',
      'docs/HANDOVER.md': '（ADR-001〜003）',
      'docs/build-from-scratch.html': '<li>ADR-001〜003</li>',
    };
    const r = createReport();
    checkAdr(r, reader(files));
    expect(errorsOf(r)).toEqual([expect.stringContaining('AI_RULES.md: 「ADR-001〜002」')]);
  });

  test('deploymentId 形式は検出し、短い文字列は検出しない', () => {
    const p = ID_PATTERNS.find((x) => x.label.startsWith('GAS deploymentId'));
    const dummy = 'AKfycb' + 'x'.repeat(40); // 実在しないダミー値（ファイル自体が検出されないよう実行時に組み立てる）
    expect(`clasp deploy -i ${dummy}`.match(p.re)).toHaveLength(1);
    expect('clasp deploy -i <DEPLOYMENT_ID>'.match(p.re)).toBeNull();
    p.re.lastIndex = 0;
  });
});
