/**
 * 本番ビルド（tools/build.js）とデプロイ事前検査（tools/deploy.js）の単体テスト — ADR-013
 */

'use strict';

const { stripDevOnly, extractApp, escapeInline } = require('../../tools/build');
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
