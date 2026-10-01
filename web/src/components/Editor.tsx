import { useEffect, useMemo, useRef } from 'react';
import { highlight } from '../highlight';
import { useStore } from '../store';

export function Editor() {
  const store = useStore();
  const code = store.project.code;
  const errorLine = store.session.errorLine;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const pre = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);

  const html = useMemo(() => highlight(code), [code]);
  const lineCount = useMemo(() => code.split('\n').length, [code]);

  const focusLine = store.focusLine;
  useEffect(() => {
    const el = textarea.current;
    if (!focusLine || !el) return;
    const lines = el.value.split('\n');
    let pos = 0;
    for (let i = 0; i < focusLine.line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    el.focus();
    el.setSelectionRange(pos, pos + (lines[focusLine.line - 1] || '').length);
    el.scrollTop = Math.max(0, (focusLine.line - 6) * 20);
  }, [focusLine]);

  const syncScroll = () => {
    const el = textarea.current;
    if (!el) return;
    if (pre.current) { pre.current.scrollTop = el.scrollTop; pre.current.scrollLeft = el.scrollLeft; }
    if (gutter.current) gutter.current.scrollTop = el.scrollTop;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart;
    store.setCode(el.value.slice(0, start) + '  ' + el.value.slice(el.selectionEnd));
    // The caret can only be placed once React has written the new value back.
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2; });
  };

  return (
    <div className="pane">
      <div className="pane-head"><span>sketch.ino</span><span className="spacer" /><span>{lineCount} lines</span></div>
      <div className="editor-wrap">
        <div id="gutter" ref={gutter} aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => <div key={i} className={errorLine === i + 1 ? 'err' : undefined}>{i + 1}</div>)}
        </div>
        <div className="code-area">
          <pre id="highlight" ref={pre} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
          <textarea
            id="code" ref={textarea} value={code} spellCheck={false} autoComplete="off" autoCapitalize="off"
            aria-label="Arduino source code"
            onChange={e => store.setCode(e.target.value)} onScroll={syncScroll} onKeyDown={onKeyDown}
          />
        </div>
      </div>
    </div>
  );
}
