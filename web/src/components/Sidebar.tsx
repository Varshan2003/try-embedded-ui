import { COMPONENTS, boardSpec, type ComponentType } from '@try-embedded/simulator';
import { STARTERS } from '../starters';
import { displayName, useStore } from '../store';

export function Sidebar() {
  const store = useStore();
  const sorted = store.projects.slice().sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <aside className="sidebar" aria-label="Projects and parts">
      <div className="side-head"><span>sketches</span>
        <span>
          <button className="icon-btn small" title="New sketch" aria-label="New sketch" onClick={() => store.newSketch()}>+</button>
          <button className="icon-btn small" title="Save sketch (Ctrl+S)" aria-label="Save sketch" onClick={() => store.save()}>⤓</button>
        </span>
      </div>
      <div id="project-list">
        {sorted.map(p => (
          <div key={p.id} className={'project-row' + (p.id === store.project.id ? ' active' : '')}>
            <button className="project-open" onClick={() => { if (p.id !== store.project.id) store.open(p); }}>
              <span className="project-title">{displayName(p)}</span>
              <span className="project-meta">{p.challengeId ? 'challenge' : boardSpec(p.board).name.replace('Arduino ', '')} · {p.components.length} parts</span>
            </button>
            <button className="icon-btn small" title="Duplicate sketch" aria-label={`Duplicate ${displayName(p)}`} onClick={() => store.duplicate(p)}>⧉</button>
            <button className="icon-btn small danger" title="Delete sketch" aria-label={`Delete ${displayName(p)}`} onClick={() => store.remove(p)}>×</button>
          </div>
        ))}
      </div>

      <div className="side-head"><span>challenges</span></div>
      <div id="challenge-list">
        {store.apiAvailable === false && <p className="hint">Challenges need the Try Embedded API, which is not reachable right now.</p>}
        {store.challenges.map(c => {
          const done = store.progress.get(c.id)?.passed;
          return (
            <button key={c.id} className={'template-btn challenge-btn' + (store.project.challengeId === c.id ? ' active' : '')} title={c.summary} onClick={() => store.openChallenge(c.id)}>
              <span>{c.title}</span>
              <span className="challenge-meta">{c.topic} · {c.difficulty}{done ? ' · passed' : ''}</span>
            </button>
          );
        })}
      </div>

      <div className="side-head"><span>templates</span></div>
      <div id="template-list">
        {STARTERS.map(t => <button key={t.name} className="template-btn" onClick={() => store.openTemplate(t)}>{t.name}</button>)}
      </div>

      <div className="side-head"><span>parts</span></div>
      <div id="palette">
        {(Object.keys(COMPONENTS) as ComponentType[]).map(type => (
          <button key={type} className="palette-btn" title={`Add ${COMPONENTS[type].label} to the canvas`} onClick={() => store.addComponent(type)}>{COMPONENTS[type].label}</button>
        ))}
      </div>

      <div className="side-head"><span>transfer</span></div>
      <div className="transfer">
        <button className="btn small" title="Copy a shareable link to the clipboard" onClick={() => store.share()}>Share link</button>
        <button className="btn small" title="Copy this project as JSON" onClick={() => store.exportJson()}>Export</button>
        <button className="btn small" title="Paste project JSON" onClick={() => store.openDialog('import')}>Import</button>
      </div>
      <p className="hint" id="autosave">{store.savedLabel}</p>
    </aside>
  );
}
