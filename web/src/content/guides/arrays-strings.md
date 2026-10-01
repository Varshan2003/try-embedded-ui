## Arrays are not pointers, but they decay into them

An array is a block of elements with a size the compiler knows. In almost every expression, though, the array's name turns into a pointer to its first element. This is called decay, and it is why a function can never receive an array, only a pointer.

```c run
#include <stdio.h>
#include <stdint.h>

#define ARRAY_LEN(a) (sizeof(a) / sizeof((a)[0]))

static void takes_array(uint16_t samples[8]) {
  // The [8] is decoration: the parameter is really `uint16_t *samples`.
  printf("inside the function: sizeof = %u\n", (unsigned)sizeof samples);
}

int main(void) {
  uint16_t samples[8] = { 0 };
  printf("in main: sizeof = %u, elements = %u\n", (unsigned)sizeof samples, (unsigned)ARRAY_LEN(samples));
  takes_array(samples);
  return 0;
}
```

So every function that takes a buffer also takes its length. `ARRAY_LEN` works only where the real array is visible; applied to a pointer it silently gives a wrong answer.

## Bounds are your job

C does not check array indices. Writing `a[n]` on an array of `n` elements overwrites whatever comes next in memory: another variable, a return address, a heap header. On a microcontroller there is no operating system to stop it, so the symptom appears somewhere else, later.

The simulator used here does check. Run this and read the message.

```c run fails
#include <stdint.h>

int main(void) {
  uint8_t buffer[4];
  for (int i = 0; i <= 4; i++) buffer[i] = 0;   // i == 4 is one past the end
  return 0;
}
```

Then change `<=` to `<` and run it again.

> **Pitfall:** The classic off-by-one is `<=` in a loop over an array, or forgetting that a string of `n` characters needs `n + 1` bytes.

## Strings

A C string is an array of `char` ending in a zero byte, the terminator `'\0'`. Nothing stores the length; functions find the end by scanning for the zero.

| Declaration | What you get |
|---|---|
| `char s[] = "abc";` | A writable array of 4 bytes: `a`, `b`, `c`, `\0` |
| `const char *s = "abc";` | A pointer to a literal in read-only memory |
| `char s[8] = "abc";` | 8 bytes; the unused ones are zero |
| `char s[3] = "abc";` | 3 bytes and no terminator: not a string |

```c run
#include <stdio.h>
#include <string.h>

int main(void) {
  char name[] = "sensor";
  printf("sizeof = %u (capacity, includes the terminator)\n", (unsigned)sizeof name);
  printf("strlen = %u (characters before the terminator)\n", (unsigned)strlen(name));

  name[0] = 'S';                 // fine: this is our own array
  printf("%s\n", name);
  return 0;
}
```

String literals live in flash on a microcontroller. Writing to one is undefined behaviour, so point at them with `const char *`.

## Copying safely

Most buffer overflows in C are string copies. Know what each function does when the source is too long.

| Function | Bounded | Always terminates | Notes |
|---|---|---|---|
| `strcpy(dst, src)` | No | Yes | Overflows `dst` if `src` is longer |
| `strncpy(dst, src, n)` | Yes | No | Leaves `dst` unterminated when `src` has `n` or more characters; pads with zeros otherwise |
| `snprintf(dst, n, "%s", src)` | Yes | Yes | Returns the length it wanted to write, so truncation is detectable |
| `memcpy(dst, src, n)` | Yes | Not a string function | For known lengths; regions must not overlap |

```c run
#include <stdio.h>
#include <string.h>

int main(void) {
  char small[6];
  const char *input = "temperature";

  int wanted = snprintf(small, sizeof small, "%s", input);
  printf("stored \"%s\", needed %d characters, truncated: %s\n",
         small, wanted, wanted >= (int)sizeof small ? "yes" : "no");

  char risky[6];
  strncpy(risky, input, sizeof risky);          // fills all 6 bytes, no terminator
  risky[sizeof risky - 1] = '\0';               // the line people forget
  printf("after strncpy and a manual terminator: \"%s\"\n", risky);
  return 0;
}
```

## Parsing input you do not trust

Anything that arrives over a UART, from a file or from a network is untrusted. A parser must reject what it does not understand instead of guessing. `atoi` cannot report an error: it returns 0 for `"abc"` and has undefined behaviour on overflow.

A robust parser checks three things: that there is at least one digit, that every character is valid, and that the value stays in range as it accumulates.

```c run
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>

static bool parse_u8(const char *s, uint8_t *out) {
  if (*s == '\0') return false;                 // empty input
  unsigned value = 0;
  for (; *s; s++) {
    if (*s < '0' || *s > '9') return false;     // not a digit
    value = value * 10 + (unsigned)(*s - '0');
    if (value > 255) return false;              // out of range: stop before it can wrap
  }
  *out = (uint8_t)value;
  return true;
}

int main(void) {
  const char *inputs[] = { "42", "255", "256", "12a", "" };
  for (int i = 0; i < 5; i++) {
    uint8_t v = 0;
    bool ok = parse_u8(inputs[i], &v);
    printf("\"%s\" -> %s", inputs[i], ok ? "ok" : "rejected");
    if (ok) printf(" (%u)", v);
    printf("\n");
  }
  return 0;
}
```

## Formatting without printf

`printf` pulls in several kilobytes of code and may use the heap, which a bootloader or a small MCU cannot afford. Converting a number to text by hand takes a few lines: peel off digits with `% 10`, which produces them in reverse, then write them out backwards.

```c run
#include <stdio.h>
#include <stdint.h>

static void u32_to_str(uint32_t v, char *out) {
  char tmp[10];
  int n = 0;
  do {                           // do-while so that 0 produces "0"
    tmp[n++] = (char)('0' + v % 10);
    v /= 10;
  } while (v);
  while (n) *out++ = tmp[--n];
  *out = '\0';
}

int main(void) {
  char text[11];
  u32_to_str(0, text);          printf("%s\n", text);
  u32_to_str(4294967295u, text); printf("%s\n", text);
  return 0;
}
```

For hexadecimal, index a lookup string with each nibble: `"0123456789ABCDEF"[v >> 4]` and `[v & 0x0F]`.

## Splitting a line in place

Text protocols such as NMEA and AT commands are comma-separated. The memory-free way to split them is to overwrite each delimiter with a terminator and keep a pointer to the start of each field. The fields then are ordinary strings inside the original buffer.

Avoid `strtok` for this. It treats consecutive delimiters as one, so empty fields vanish, and it keeps hidden static state, so it is not safe to use from an interrupt and the main loop at the same time.

## Common mistakes

- Forgetting the byte for the terminator when sizing a buffer.
- `sizeof` of a pointer parameter, expecting the array's size.
- Comparing strings with `==`, which compares addresses. Use `strcmp`, which returns 0 when equal.
- `s[strlen(s) - 1]` on an empty string, which reads the byte before the buffer.
- Calling `strlen` in a loop condition, making an O(n) loop O(n^2).

```quiz
Q: `char buf[4]; strncpy(buf, "abcdef", sizeof buf);` What is true afterwards?
- `buf` holds the string "abc"
* `buf` holds `a`, `b`, `c`, `d` with no terminator
- The call overflows `buf`
Why: `strncpy` writes at most `n` bytes and does not add a terminator when the source is that long or longer. Printing `buf` as a string would read past the array.
```

```quiz
Q: Inside `void f(uint8_t data[16])`, what is `sizeof data` on a 32-bit target?
- 16
- 1
* 4
Why: An array parameter is adjusted to a pointer, so `sizeof` gives the size of a pointer.
```

```ask
Q: How does `strlen` differ from `sizeof` on a string?
A: `sizeof` is evaluated at compile time and gives the storage size of the array, including the terminator, or the size of a pointer if applied to one. `strlen` runs at run time and counts characters up to the first zero byte. For `char s[16] = "hi"`, `sizeof s` is 16 and `strlen(s)` is 2.
```

```ask
Q: You must copy a string into a fixed 32-byte field. Which function do you use and why?
A: `snprintf(dst, sizeof dst, "%s", src)` if printf is available: it never overflows, always terminates and its return value reveals truncation. Without printf, a small `strlcpy`-style helper that copies at most `size - 1` characters and then writes the terminator. Not `strcpy`, which is unbounded, and not bare `strncpy`, which can leave the field unterminated.
```
