// A small Markdown renderer for lesson and problem text. It builds React elements directly, so
// content can never inject markup. Supported: headings, paragraphs, lists, tables, block quotes,
// fenced code, and inline code, bold, italic and links.
import { Fragment, type ReactNode } from 'react';
import { highlight } from './highlight';

export type Block =
  | { kind: 'heading'; level: number; text: string; id: string }
  | { kind: 'para'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; lang: string; flags: string[]; code: string }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'quote'; text: string };

export const slug = (text: string) => text.toLowerCase().replace(/`/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const LIST_ITEM = /^\s*(?:[-*]|(\d+)\.)\s+(.*)$/;
// Cells are separated by '|'; a backslash before the pipe makes it literal, which C code needs often.
const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = /^```(.*)$/.exec(line);
    if (fence) {
      const [lang = 'text', ...flags] = fence[1].trim().split(/\s+/);
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i]);
      i++;
      blocks.push({ kind: 'code', lang: lang || 'text', flags, code: body.join('\n') });
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2], id: slug(heading[2]) });
      i++;
      continue;
    }

    if (line.startsWith('|') && /^\|[\s:|-]+\|?$/.test(lines[i + 1] || '')) {
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].startsWith('|'); i++) rows.push(cells(lines[i]));
      blocks.push({ kind: 'table', head, rows });
      continue;
    }

    if (line.startsWith('>')) {
      const body: string[] = [];
      for (; i < lines.length && lines[i].startsWith('>'); i++) body.push(lines[i].replace(/^>\s?/, ''));
      blocks.push({ kind: 'quote', text: body.join(' ') });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      const ordered = item[1] !== undefined;
      const items: string[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]);
        if (m) items.push(m[2]);
        // An indented line continues the item above it.
        else if (items.length && /^\s{2,}\S/.test(lines[i])) items[items.length - 1] += ' ' + lines[i].trim();
        else break;
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    const para: string[] = [];
    for (; i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|>|\|)/.test(lines[i]) && !LIST_ITEM.test(lines[i]); i++) para.push(lines[i].trim());
    blocks.push({ kind: 'para', text: para.join(' ') });
  }
  return blocks;
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/g;
// Links may point inside the app or to an https page, never to a script or data URL.
const safeHref = (href: string) => (/^(#\/|https:\/\/)/.test(href) ? href : undefined);

export function Inline({ text }: { text: string }): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    last = m.index + m[0].length;
    const key = m.index;
    if (m[1]) out.push(<code key={key}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key}><Inline text={m[2].slice(2, -2)} /></strong>);
    else if (m[3]) out.push(<em key={key}>{m[3].slice(1, -1)}</em>);
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(m[4])!;
      const href = safeHref(link[2]);
      out.push(href
        ? <a key={key} href={href} {...(href.startsWith('https') ? { target: '_blank', rel: 'noreferrer' } : {})}><Inline text={link[1]} /></a>
        : link[1]);
    }
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

export function CodeBlock({ code, lang = 'c' }: { code: string; lang?: string }) {
  if (lang !== 'c') return <pre className="md-code"><code>{code}</code></pre>;
  return <pre className="md-code"><code dangerouslySetInnerHTML={{ __html: highlight(code).replace(/\n$/, '') }} /></pre>;
}

const CALLOUT = /^\*\*(Note|Tip|Pitfall|Interview)[:.]?\*\*:?\s*/;

interface Props {
  source: string;
  // Lets a page render its own fenced blocks (runnable code, quizzes); return undefined for the default.
  renderCode?: (block: Extract<Block, { kind: 'code' }>, index: number) => ReactNode | undefined;
}

export function Markdown({ source, renderCode }: Props) {
  return (
    <div className="md">
      {parseMarkdown(source).map((b, i) => {
        switch (b.kind) {
          case 'heading': {
            const Tag = (b.level <= 2 ? 'h2' : b.level === 3 ? 'h3' : 'h4') as 'h2';
            return <Tag key={i} id={b.id}><Inline text={b.text} /></Tag>;
          }
          case 'para': return <p key={i}><Inline text={b.text} /></p>;
          case 'list': {
            const items = b.items.map((it, n) => <li key={n}><Inline text={it} /></li>);
            return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
          }
          case 'table': return (
            <div key={i} className="md-table-wrap">
              <table>
                <thead><tr>{b.head.map((h, n) => <th key={n}><Inline text={h} /></th>)}</tr></thead>
                <tbody>{b.rows.map((r, n) => <tr key={n}>{r.map((c, k) => <td key={k}><Inline text={c} /></td>)}</tr>)}</tbody>
              </table>
            </div>
          );
          case 'quote': {
            const m = CALLOUT.exec(b.text);
            const kind = m ? m[1].toLowerCase() : 'note';
            return (
              <aside key={i} className={`md-callout md-callout-${kind}`}>
                <span className="md-callout-label">{m ? m[1] : 'Note'}</span>
                <p><Inline text={m ? b.text.slice(m[0].length) : b.text} /></p>
              </aside>
            );
          }
          case 'code': {
            const custom = renderCode?.(b, i);
            return <Fragment key={i}>{custom !== undefined ? custom : <CodeBlock code={b.code} lang={b.lang} />}</Fragment>;
          }
        }
      })}
    </div>
  );
}
