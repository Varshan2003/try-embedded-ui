## Why firmware uses fixed-width types

The C standard only promises minimum sizes. `int` is 16 bits on an 8-bit AVR and 32 bits on a Cortex-M, and `long` is 32 bits on a Cortex-M but 64 bits on a Linux PC. A register that is exactly 16 bits wide, or a protocol field that is exactly 4 bytes, cannot be described with a type whose size depends on the compiler.

`<stdint.h>` fixes that. Use `uint8_t`, `int16_t`, `uint32_t` and friends whenever the width matters, which in firmware is most of the time.

| Type | 8-bit AVR | 32-bit Cortex-M | 64-bit PC (Linux) |
|---|---|---|---|
| `char` | 1 | 1 | 1 |
| `short` | 2 | 2 | 2 |
| `int` | 2 | 4 | 4 |
| `long` | 4 | 4 | 8 |
| `long long` | 8 | 8 | 8 |
| pointer | 2 | 4 | 8 |

The examples on this page run on a simulated 32-bit little-endian microcontroller, so they print what a Cortex-M would.

```c run
#include <stdio.h>
#include <stdint.h>

int main(void) {
  printf("char=%u short=%u int=%u long=%u long long=%u pointer=%u\n",
         (unsigned)sizeof(char), (unsigned)sizeof(short), (unsigned)sizeof(int),
         (unsigned)sizeof(long), (unsigned)sizeof(long long), (unsigned)sizeof(void *));
  printf("uint8_t max=%u  int16_t min=%d  uint32_t max=%u\n", UINT8_MAX, INT16_MIN, UINT32_MAX);
  return 0;
}
```

> **Note:** Whether plain `char` is signed is also up to the platform. It is signed on x86 and unsigned in the Arm ABI. Use `uint8_t` for bytes and `char` only for text.

## Integer promotion

C never does arithmetic in a type narrower than `int`. Before almost any operator is applied, `uint8_t`, `int8_t`, `uint16_t` and `int16_t` operands are converted to `int`. This is called integer promotion, and it explains most surprising results with small types.

```c run
#include <stdio.h>
#include <stdint.h>

int main(void) {
  uint8_t a = 200, b = 100;
  uint8_t stored = a + b;        // the sum is 300 as an int, then truncated to 8 bits

  printf("a + b as an int: %d\n", a + b);
  printf("stored in a uint8_t: %u\n", stored);

  uint8_t x = 0xF0;
  printf("~x is 0x%X, not 0x0F\n", ~x);          // x was promoted to a 32-bit int first
  printf("(uint8_t)~x is 0x%02X\n", (uint8_t)~x);
  return 0;
}
```

Two consequences are worth memorising:

- Truncation happens at the assignment, not at the operator. `a + b > 255` can be true even though both are `uint8_t`.
- `~x == 0x0F` is never true for a `uint8_t x`, because `~x` has the upper 24 bits set. Cast the result back: `(uint8_t)~x`.

## Mixing signed and unsigned

When the two operands of an operator have different types, C converts both to a common type. If one is `unsigned int` and the other is `int`, the common type is `unsigned int`, so the signed value is reinterpreted. A negative number becomes a very large positive one.

```c run
#include <stdio.h>
#include <stdint.h>

int main(void) {
  int32_t temperature = -1;
  uint32_t limit = 10;

  if (temperature < limit) printf("below the limit\n");
  else printf("NOT below the limit: -1 was converted to %u\n", (uint32_t)temperature);
  return 0;
}
```

The run shows a warning for the comparison, the same one GCC gives with `-Wsign-compare`. Turn that warning on in real projects.

> **Pitfall:** `for (uint8_t i = 10; i >= 0; i--)` never ends. An unsigned value is always `>= 0`, and decrementing 0 wraps to 255.

## What happens on overflow

The rules differ by type, and the difference matters because compilers exploit it.

| Situation | Result |
|---|---|
| Unsigned arithmetic overflows | Defined: wraps modulo 2^N |
| Signed arithmetic overflows | Undefined behaviour |
| Out-of-range value converted to an unsigned type | Defined: wraps modulo 2^N |
| Out-of-range value converted to a signed type | Implementation-defined (wraps on every mainstream compiler) |
| Shift by a negative count, or by the width of the type or more | Undefined behaviour |
| Division by zero | Undefined behaviour |

"Undefined" does not mean "wraps on my board". It means the optimiser may assume it never happens, and delete code that only matters if it does. A check written as `if (a + b < a)` for signed values is routinely removed at `-O2`.

The safe pattern is to check before the operation:

```c run
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>

// Unsigned: wrap-around is well defined, so it can be detected after the fact.
static bool add_u32(uint32_t a, uint32_t b, uint32_t *sum) {
  *sum = a + b;
  return *sum >= a;              // false if the addition wrapped
}

// Signed: the check has to come first.
static bool add_i32(int32_t a, int32_t b, int32_t *sum) {
  if (b > 0 && a > INT32_MAX - b) return false;
  if (b < 0 && a < INT32_MIN - b) return false;
  *sum = a + b;
  return true;
}

int main(void) {
  uint32_t u;
  int32_t s = 0;
  printf("%d %u\n", add_u32(4000000000u, 500000000u, &u), u);
  printf("%d %d\n", add_i32(INT32_MAX, 1, &s), s);
  printf("%d %d\n", add_i32(-5, 3, &s), s);
  return 0;
}
```

## Constants have types too

An unsuffixed constant such as `1` is an `int`. That matters in two common places.

- `1 << 31` shifts a 1 into the sign bit of an `int`, which is undefined. Write `1u << 31`.
- On a 16-bit target, `60 * 1000` overflows because both constants are 16-bit `int`s. Write `60UL * 1000`.

| Suffix | Type | Example |
|---|---|---|
| none | `int` (or wider if the value needs it) | `100` |
| `u` | `unsigned int` | `1u << 31` |
| `l`, `ul` | `long`, `unsigned long` | `60UL * 1000` |
| `ll`, `ull` | `long long`, `unsigned long long` | `1ULL << 40` |

Multiply before you divide to keep precision, and make sure the intermediate result fits:

```c run
#include <stdio.h>
#include <stdint.h>

int main(void) {
  uint16_t raw = 3000;                              // 12-bit ADC reading
  uint32_t wrong = raw / 4095 * 3300;               // the division gives 0 first
  uint32_t right = (uint32_t)raw * 3300 / 4095;     // widen, multiply, then divide
  printf("divide first: %u mV, multiply first: %u mV\n", wrong, right);
  return 0;
}
```

## Common mistakes

- Using `int` for a value that must be exactly 8, 16 or 32 bits.
- Comparing a signed variable with `sizeof`, `strlen` or any other unsigned value.
- Assuming a `uint8_t` expression stays 8 bits wide in the middle of a calculation.
- Printing a 64-bit value with `%d`. Use `%lld`, or the `PRId64` macros from `<inttypes.h>`.
- Relying on signed overflow wrapping, or on `1 << 31`.

```quiz
Q: `uint8_t a = 250, b = 10;` What does `if (a + b > 255)` evaluate to?
- False, because a `uint8_t` cannot exceed 255
* True, because both operands are promoted to `int` and the sum is 260
- It is undefined behaviour
Why: The addition is carried out in `int`. Nothing is truncated until the result is stored in a `uint8_t`.
```

```quiz
Q: Which of these is undefined behaviour?
- `uint32_t x = 0; x--;`
- `uint8_t y = 300;`
* `int32_t z = INT32_MAX; z++;`
Why: Unsigned arithmetic wraps and conversion to an unsigned type wraps, both by definition. Signed overflow is undefined.
```

```ask
Q: Why does embedded code use `uint32_t` instead of `unsigned long`?
A: Because the width is part of the meaning. A hardware register or a protocol field has a fixed number of bits, while `unsigned long` is 32 bits on a Cortex-M and 64 bits on a 64-bit Linux build of the same code. Fixed-width types make the code portable between targets and make host-side unit tests behave like the device.
```

```ask
Q: What is the difference between undefined and implementation-defined behaviour?
A: Implementation-defined means the compiler must pick a behaviour and document it, for example the result of right-shifting a negative number. Undefined means the standard places no requirement at all, so the compiler may assume the situation never occurs and optimise on that assumption. Signed overflow, out-of-range shifts and out-of-bounds access are undefined.
```
