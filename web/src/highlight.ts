const KEYWORDS = /\b(if|else|for|while|do|return|break|continue|switch|case|default|void|int|long|float|double|char|bool|boolean|byte|unsigned|const|static|volatile|String|word|uint8_t|uint16_t|uint32_t|size_t|Servo)\b/g;
const BUILTINS = /\b(pinMode|digitalWrite|digitalRead|analogWrite|analogRead|delay|delayMicroseconds|millis|micros|map|constrain|random|tone|noTone|attachInterrupt|detachInterrupt|digitalPinToInterrupt|Serial|Wire|SPI|setup|loop|min|max|abs|sqrt|pow)\b/g;
const CONSTANTS = /\b(HIGH|LOW|INPUT|OUTPUT|INPUT_PULLUP|LED_BUILTIN|A0|A1|A2|A3|A4|A5|true|false|CHANGE|RISING|FALLING|DEC|HEX|BIN)\b/g;

// Returns HTML. The source is escaped first, so the only markup in the result is our own spans.
export function highlight(src: string): string {
  const esc = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts: string[] = [];
  let out = esc.replace(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|#[^\n]*)/g, m => {
    const cls = m.startsWith('//') || m.startsWith('/*') ? 'c' : m.startsWith('#') ? 'p' : 's';
    parts.push(`<span class="hl-${cls}">${m}</span>`);
    return `\u0000${parts.length - 1}\u0000`;
  });
  out = out
    .replace(CONSTANTS, '<span class="hl-n">$1</span>')
    .replace(KEYWORDS, '<span class="hl-k">$1</span>')
    .replace(BUILTINS, '<span class="hl-b">$1</span>')
    .replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-num">$1</span>');
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => parts[+i]);
  return out + '\n';
}
