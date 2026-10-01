import { useEffect, useMemo, useRef } from 'react';
import { highlight } from '../highlight';

interface Props {
  value: string;
  onChange: (value: string) => void;
  label: string;
  errorLine?: number | null;
  // A request to move the caret to a line; `tick` changes on every request so the same line can be asked for twice.
  focusLine?: { line: number; tick: number } | null;
  // Grow with the content up to this many lines instead of filling the parent.
  maxLines?: number;
  onRun?: () => void;
  onSubmit?: () => void;
}

const LINE = 20, PAD = 20, INDENT = '  ';

// A plain textarea with a highlighted copy of the text behind it.
export function CodeEditor({ value, onChange, label, errorLine, focusLine, maxLines, onRun, onSubmit }: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const pre = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const html = useMemo(() => highlight(value), [value]);
  const lineCount = useMemo(() => value.split('\n').length, [value]);

  useEffect(() => {
    const el = textarea.current;
    if (!focusLine || !el) return;
    const lines = el.value.split('\n');
    let pos = 0;
    for (let i = 0; i < focusLine.line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    el.focus();
    el.setSelectionRange(pos, pos + (lines[focusLine.line - 1] || '').length);
    el.scrollTop = Math.max(0, (focusLine.line - 6) * LINE);
  }, [focusLine]);

  const syncScroll = () => {
    const el = textarea.current;
    if (!el) return;
    if (pre.current) { pre.current.scrollTop = el.scrollTop; pre.current.scrollLeft = el.scrollLeft; }
    if (gutter.current) gutter.current.scrollTop = el.scrollTop;
  };

  // Replaces the selection and puts the caret after the inserted text.
  const insert = (el: HTMLTextAreaElement, text: string) => {
    const start = el.selectionStart;
    onChange(el.value.slice(0, start) + text + el.value.slice(el.selectionEnd));
    // The caret can only be placed once React has written the new value back.
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + text.length; });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) onSubmit?.(); else onRun?.();
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      insert(el, INDENT);
    } else if (e.key === 'Enter') {
      // Keep the indentation of the current line, one level deeper after an opening brace.
      const before = el.value.slice(0, el.selectionStart);
      const line = before.slice(before.lastIndexOf('\n') + 1);
      const indent = /^[ \t]*/.exec(line)![0] + (/\{\s*$/.test(line) ? INDENT : '');
      if (!indent) return;
      e.preventDefault();
      insert(el, '\n' + indent);
    } else if (e.key === '}') {
      // Typing a closing brace on an otherwise blank line steps back one level.
      const before = el.value.slice(0, el.selectionStart);
      const lineStart = before.lastIndexOf('\n') + 1;
      const line = before.slice(lineStart);
      if (!/^[ \t]+$/.test(line) || !line.endsWith(INDENT)) return;
      e.preventDefault();
      const start = el.selectionStart - INDENT.length;
      onChange(el.value.slice(0, start) + '}' + el.value.slice(el.selectionEnd));
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 1; });
    }
  };

  const style = maxLines ? { height: Math.min(lineCount, maxLines) * LINE + PAD } : undefined;

  return (
    <div className="ce" style={style}>
      <div className="ce-gutter" ref={gutter} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, i) => <div key={i} className={errorLine === i + 1 ? 'err' : undefined}>{i + 1}</div>)}
      </div>
      <div className="ce-area">
        <pre className="ce-hl" ref={pre} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
        <textarea
          className="ce-input" ref={textarea} value={value} spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off"
          aria-label={label} onChange={e => onChange(e.target.value)} onScroll={syncScroll} onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}
