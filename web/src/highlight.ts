const KEYWORDS = new Set(['if', 'else', 'for', 'while', 'do', 'return', 'break', 'continue', 'switch', 'case', 'default', 'goto', 'sizeof',
  'void', 'int', 'long', 'short', 'float', 'double', 'char', 'bool', 'boolean', 'byte', 'word', 'unsigned', 'signed', 'const', 'static', 'volatile',
  'extern', 'inline', 'register', 'struct', 'union', 'enum', 'typedef', 'String', 'Servo', 'size_t', 'ptrdiff_t', 'uintptr_t', 'intptr_t',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t']);
const BUILTINS = new Set(['pinMode', 'digitalWrite', 'digitalRead', 'analogWrite', 'analogRead', 'delay', 'delayMicroseconds', 'millis', 'micros',
  'map', 'constrain', 'random', 'tone', 'noTone', 'attachInterrupt', 'detachInterrupt', 'digitalPinToInterrupt', 'Serial', 'Wire', 'SPI', 'setup', 'loop',
  'min', 'max', 'abs', 'sqrt', 'pow', 'printf', 'snprintf', 'sprintf', 'puts', 'putchar', 'memcpy', 'memmove', 'memset', 'memcmp', 'strlen', 'strcpy',
  'strncpy', 'strcmp', 'strncmp', 'strcat', 'strchr', 'malloc', 'calloc', 'realloc', 'free', 'offsetof', 'assert']);
const CONSTANTS = new Set(['HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'LED_BUILTIN', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'true', 'false',
  'CHANGE', 'RISING', 'FALLING', 'DEC', 'HEX', 'BIN', 'NULL']);

// One pass over the source, so text inside a comment or a string is never looked at again.
const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)|(^[ \t]*#[^\n]*)|\b(0[xX][0-9a-fA-F]+[uUlL]*|0[bB][01]+[uUlL]*|\d+\.?\d*(?:[eE][+-]?\d+)?[uUlLfF]*)\b|([A-Za-z_]\w*)/gm;

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (cls: string, text: string) => `<span class="hl-${cls}">${escape(text)}</span>`;

// Returns HTML. Every piece of source text is escaped, so the only markup in the result is our own spans.
export function highlight(src: string): string {
  let out = '', last = 0;
  for (const m of src.matchAll(TOKEN)) {
    out += escape(src.slice(last, m.index));
    last = m.index + m[0].length;
    const [text, comment, str, directive, num, word] = m;
    if (comment) out += span('c', text);
    else if (str) out += span('s', text);
    else if (directive) out += span('p', text);
    else if (num) out += span('num', text);
    else if (KEYWORDS.has(word)) out += span('k', text);
    else if (BUILTINS.has(word)) out += span('b', text);
    else if (CONSTANTS.has(word) || /^[A-Z][A-Z0-9_]{2,}$/.test(word)) out += span('n', text);
    else out += escape(text);
  }
  return out + escape(src.slice(last)) + '\n';
}
