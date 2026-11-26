/**
 * 本番ビルド（tools/build.js）とデプロイ事前検査（tools/deploy.js）の単体テスト — ADR-013
 */

'use strict';

const { stripDevOnly, extractApp, escapeInline, assertAscii, assertNoAstral, assertNoScriptTagInJs } = require('../../tools/build');
const { preflight } = require('../../tools/deploy');

describe('本番ビルド', () => {
  test('build:dev-only ブロックを除去し、それ以外は残す', () => {
    const html = [
      '<head>',
      '  <!-- build:dev-only:start（説明） -->',
      '  <script src="https://cdn.tailwindcss.com"></script>',
      '  <!-- build:dev-only:end -->',
      '  <link rel="preconnect" href="https://fonts.googleapis.com">',
      '</head>',
    ].join('\n');
    const out = stripDevOnly(html);
    expect(out).not.toContain('cdn.tailwindcss.com');
    expect(out).toContain('fonts.googleapis.com');
  });

  test('start/end の対応が崩れていたらビルドを止める', () => {
    expect(() => stripDevOnly('<!-- build:dev-only:start -->\n<script></script>')).toThrow('対応が崩れている');
  });

  test('build:app 目印直後の text/babel スクリプトの中身を取り出す', () => {
    const html = '<body>\n<!-- build:app -->\n<script type="text/babel" data-type="module">const a = <b/>;</script>\n</body>';
    const app = extractApp(html);
    expect(app.code).toBe('const a = <b/>;');
    expect(html.slice(app.start, app.end)).toMatch(/^<!-- build:app -->[\s\S]*<\/script>$/);
  });

  test('インライン埋め込みで </script> と <!-- を無害化する', () => {
    expect(escapeInline('x</script>y<!--z', 'script')).toBe('x<\\/script>y<\\!--z');
    expect(escapeInline('a</STYLE>b', 'style')).toBe('a<\\/style>b');
  });

  test('JS 内の <script（開始タグの形）を \\x3Cscript にし、評価結果は元の文字列と同じ（GAS の nonce 付与で壊れない）', () => {
    const src = 'e.innerHTML="<script><\\/script>";var r=/<SCRIPT/i;var t=`<script>`;';
    const out = escapeInline(src, 'script');
    expect(out).not.toMatch(/<\/?script/i);
    expect(() => assertNoScriptTagInJs(out)).not.toThrow();
    const run = (code) => { const e = {}; return new Function('e', code + 'return [e.innerHTML, r.source, t];')(e); };
    expect(run(out)).toEqual([ '<script></script>', '\\x3CSCRIPT', '<script>' ]);
    expect(run(out)[0]).toBe(run(src)[0]);
    expect(new RegExp(run(out)[1], 'i').test('<script')).toBe(true);
  });

  test('JS に <script / </script の形が残っていたらビルドを止める', () => {
    expect(() => assertNoScriptTagInJs('x="<script>"')).toThrow('<script');
    expect(() => assertNoScriptTagInJs('x="</SCRIPT>"')).toThrow('</SCRIPT');
  });

  test('インライン JS/CSS に ASCII 以外の文字が残っていたらビルドを止める（GAS 配信で壊れるため）', () => {
    expect(assertAscii('const a="\\u3042";', 'JS')).toBe('const a="\\u3042";');
    expect(() => assertAscii('const a="あ";', 'JS')).toThrow('ASCII 以外');
    expect(() => assertAscii('x="\u{1F512}"', 'JS')).toThrow('ASCII 以外');
  });

  test('HTML 部分に BMP 外の文字（絵文字）があればビルドを止める。日本語（BMP 内）は通す', () => {
    expect(assertNoAstral('<title>タダサポ ⚠</title>')).toBe('<title>タダサポ ⚠</title>');
    expect(() => assertNoAstral('<p>\n\u{1F512} 保存済み</p>')).toThrow('2 行目に BMP 外の文字');
  });

  test('本番ビルドのアプリ本体は ASCII だけになる（日本語・絵文字は \\u エスケープ）', () => {
    const { build } = require('../../tools/build');
    build();
    const html = require('fs').readFileSync(require('path').join(__dirname, '../../dist/index.html'), 'utf8');
    const a = html.indexOf('<script>(()=>');
    expect(a).toBeGreaterThan(0);
    const js = html.slice(a, html.indexOf('</script>', a));
    expect(/[^\x00-\x7f]/.test(js)).toBe(false);
    expect(js).toContain('\\u30BF\\u30C0\\u30B5\\u30DD'); // 「タダサポ」
    expect(js).toContain('\\u{1F512}'); // 🔒 は \u{...} エスケープになる（ASCII だけ）
    expect(() => assertNoAstral(html)).not.toThrow();
    expect(js.slice('<script>'.length)).not.toMatch(/<\/?script/i); // React 同梱の "<script><\/script>" も無害化済み
    expect(js).toContain('\\x3Cscript');
  }, 120000);
});

describe('デプロイ事前検査', () => {
  const ok = {
    manifest: { webapp: { executeAs: 'USER_ACCESSING', access: 'DOMAIN' }, executionApi: { access: 'MYSELF' } },
    claspJson: { scriptId: 'dummy', rootDir: 'dist' },
    deployJson: { production: 'AKfycb' + 'x'.repeat(40) }, // 実在しないダミー（実行時に組み立てる）
    gitStatus: '',
  };

  test('すべて満たせば合格', () => {
    expect(preflight(ok)).toEqual([]);
  });

  test('Webapp 設定・executionApi・rootDir・deploymentId・未コミット変更をそれぞれ検出する', () => {
    const errs = preflight({
      manifest: { webapp: { executeAs: 'USER_DEPLOYING', access: 'ANYONE' }, executionApi: { access: 'ANYONE' } },
      claspJson: { rootDir: '.' },
      deployJson: {},
      gitStatus: ' M index.html',
    });
    expect(errs).toEqual(expect.arrayContaining([
      expect.stringContaining('未コミット'),
      expect.stringContaining('USER_ACCESSING / DOMAIN'),
      expect.stringContaining('executionApi'),
      expect.stringContaining('rootDir'),
      expect.stringContaining('production'),
    ]));
  });
});
