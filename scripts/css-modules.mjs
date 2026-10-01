// Перенос статичных стилей прототипа в CSS-модули: style={css('…')} → className с классом модуля.
//   node scripts/css-modules.mjs components/app/X.tsx [...]
// Правило — :where(.класс) { … !important }: нулевая специфичность и !important повторяют приоритет атрибута style
// (сильнее обычных правил, слабее чужих !important — например .only-narrow). Динамические css(a + b) не трогаются.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const IMPORT = 'sty';

// Глобальные правила, которые находят элементы по тексту атрибута style (app/globals.css), — им нужны классы-метки.
const MARKERS = [
  [t => t.includes('--font-heading'), 'fh'],
  [t => t.includes('--placeholder-color'), 'ph-accent'],
  [t => t.includes('height: 100%') && t.includes('overflow: auto'), 'scroll-pane']
];

function decls(text) {
  return text.split(';').map(d => d.trim()).filter(Boolean).map(d => {
    const i = d.indexOf(':');
    const prop = d.slice(0, i).trim(), value = d.slice(i + 1).trim();
    return prop && value ? '  ' + prop + ': ' + (/!important$/.test(value) ? value : value + ' !important') + ';' : '';
  }).filter(Boolean);
}

for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, 'utf8');
  if (new RegExp('\\b' + IMPORT + '\\b').test(src)) { console.error('пропуск (имя ' + IMPORT + ' занято):', file); continue; }
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  const rules = new Map();
  const visit = (n) => {
    if (ts.isJsxAttribute(n) && n.name.getText(sf) === 'style' && n.initializer && ts.isJsxExpression(n.initializer)) {
      const call = n.initializer.expression;
      // Только HTML-элементы и Link: свой компонент может принимать style, но не className.
      const tag = n.parent.parent.tagName.getText(sf);
      const intrinsic = /^[a-z]/.test(tag) || tag === 'Link';
      if (intrinsic && call && ts.isCallExpression(call) && call.expression.getText(sf) === 'css' && call.arguments.length === 1 &&
          (ts.isStringLiteral(call.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(call.arguments[0]))) {
        const text = call.arguments[0].text;
        const cls = 'c' + crypto.createHash('sha1').update(text).digest('hex').slice(0, 7);
        rules.set(cls, decls(text));
        const marks = MARKERS.filter(([test]) => test(text)).map(([, m]) => m);
        const ref = marks.length ? "'" + marks.join(' ') + " ' + " + IMPORT + '.' + cls : IMPORT + '.' + cls;
        const cn = n.parent.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(sf) === 'className');
        if (!cn) edits.push([n.getStart(sf), n.end, 'className={' + ref + '}']);
        else {
          edits.push([n.getFullStart(), n.end, '']);
          const init = cn.initializer;
          const repl = ts.isStringLiteral(init) ? "{'" + init.text + " ' + " + ref + '}' : '{(' + init.expression.getText(sf) + ") + ' ' + " + ref + '}';
          edits.push([init.getStart(sf), init.end, repl]);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!rules.size) { console.log('нечего переносить:', file); continue; }
  let out = src;
  for (const [a, b, t] of edits.sort((x, y) => y[0] - x[0])) out = out.slice(0, a) + t + out.slice(b);
  const base = path.basename(file).replace(/\.tsx$/, '');
  const imports = [...out.matchAll(/^import .*;$/gm)];
  const at = imports.length ? imports.at(-1).index + imports.at(-1)[0].length : 0;
  out = out.slice(0, at) + "\nimport " + IMPORT + " from './" + base + ".module.css';" + out.slice(at);
  // css больше не нужен — убираем из импорта.
  if (!/\bcss\(/.test(out)) out = out.replace(/^import \{ css \} from '@\/lib\/css';\n/m, '');
  const cssFile = path.join(path.dirname(file), base + '.module.css');
  const head = '/* Статичные стили прототипа (scripts/css-modules.mjs): :where — специфичность атрибута style, !important — его приоритет. */\n';
  const prev = fs.existsSync(cssFile) ? fs.readFileSync(cssFile, 'utf8') : head;
  const body = [...rules].filter(([c]) => !prev.includes('(.' + c + ')')).map(([c, d]) => ':where(.' + c + ') {\n' + d.join('\n') + '\n}').join('\n');
  fs.writeFileSync(cssFile, prev + body + '\n');
  fs.writeFileSync(file, out);
  console.log(file + ': ' + edits.length + ' правок, ' + rules.size + ' классов');
}
