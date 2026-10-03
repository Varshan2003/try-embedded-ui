// The theory interview questions. Each Markdown file in content/theory is one section: a `# Title`
// line, then one `## Question` heading per question with its answer underneath.
import { slug } from '../md';

export interface TheoryQuestion {
  id: string;
  number: number;       // 1-based position across all sections
  question: string;
  answer: string;       // Markdown
  hasCode: boolean;
}

export interface TheorySection {
  id: string;
  title: string;
  questions: TheoryQuestion[];
}

const files = import.meta.glob<string>('../content/theory/*.md', { query: '?raw', import: 'default', eager: true });

function parse(): TheorySection[] {
  let number = 0;
  return Object.keys(files).sort().map(path => {
    const [head, ...parts] = files[path].replace(/\r/g, '').split(/^## /m);
    const title = /^# (.*)$/m.exec(head)?.[1].trim() ?? path;
    const questions = parts.map(part => {
      const end = part.indexOf('\n');
      const question = part.slice(0, end).trim();
      const answer = part.slice(end + 1).trim();
      return { id: slug(question), number: ++number, question, answer, hasCode: answer.includes('```') };
    });
    return { id: slug(title), title, questions };
  });
}

export const THEORY: TheorySection[] = parse();
export const THEORY_COUNT = THEORY.reduce((n, s) => n + s.questions.length, 0);
