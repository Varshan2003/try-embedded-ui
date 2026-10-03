# Keywords, types and qualifiers

## What data types are used in C for embedded systems?

The built-in types have sizes that depend on the target: `int` is 16 bits on an AVR and 32 bits on an ARM Cortex-M. Firmware therefore uses the fixed-width types from `<stdint.h>` whenever the width matters.

| Type | Width | Typical use |
|---|---|---|
| `uint8_t`, `int8_t` | 8 bits | Bytes, buffers, small registers |
| `uint16_t`, `int16_t` | 16 bits | ADC samples, 16-bit registers |
| `uint32_t`, `int32_t` | 32 bits | Registers on 32-bit MCUs, tick counters |
| `uint64_t`, `int64_t` | 64 bits | Wide intermediates, timestamps |
| `bool` | 1 byte | Flags (`<stdbool.h>`) |
| `float`, `double` | 32, 64 bits | Used sparingly without an FPU |
| `size_t` | Pointer-sized | Sizes and array indices |

There are also derived types: arrays, pointers, structs, unions, enums and function pointers. Prefer unsigned types for bit patterns and registers.

## How do you declare a constant in embedded C?

Three ways, each with a different effect:

```c
#define BUFFER_SIZE 64u                 // text substitution: no type, no storage
enum { MAX_CHANNELS = 8 };              // a true integer constant: usable as an array size
static const uint16_t baud_table[] = { 9600, 19200, 38400 };   // a typed, read-only object
```

- `#define` is replaced by the preprocessor. It has no scope and no type checking, but it is a constant expression.
- An `enum` constant is an `int` constant expression that obeys scope and shows up in the debugger.
- A `const` object has a type and an address. At file scope it is normally placed in flash, which saves RAM. In C it is not a constant expression, so it cannot size a file-scope array or label a `case`.

## What is the `volatile` keyword used for?

`volatile` tells the compiler that a variable can change, or have an effect, outside the code it can see, so every read and write in the source must really happen. Without it the optimiser may read once and reuse the value, or remove writes it thinks are redundant.

Use it for:

- **Memory-mapped registers**, which hardware changes.
- **Variables shared between an ISR and the main code.**
- **Variables shared between tasks** when not otherwise protected.

```c
volatile bool data_ready;                       // set in an ISR

void wait_for_data(void) {
  while (!data_ready) { }   // without volatile, the optimiser can turn this into an endless loop
}

#define UART_SR (*(volatile uint32_t *)0x40011000u)
```

`volatile` does not make an access atomic. `counter++` on a volatile variable is still a read, an add and a write, and an interrupt can land in between.

## Can a variable be both `const` and `volatile`?

Yes, and it is common. `const` means this code may not write it; `volatile` means it can change anyway. Together they describe a read-only hardware register:

```c
#define ADC_DATA (*(const volatile uint16_t *)0x4001204Cu)

uint16_t sample = ADC_DATA;   // reads the hardware every time
// ADC_DATA = 0;              // compile error: the register is read-only
```

Other examples are a status register and a value in memory shared with another processor that only the other side writes.

## What does the `const` keyword do?

`const` promises that the code will not modify an object through that name. The compiler enforces it, and for file-scope objects it usually places the data in flash, which saves RAM.

With pointers, read the declaration from right to left:

```c
const uint8_t *p;          // pointer to const data: *p cannot be written, p can move
uint8_t *const q = &x;     // const pointer: q cannot move, *q can be written
const uint8_t *const r = &x;   // neither can change
```

Uses in firmware:

- Lookup tables and strings kept in flash.
- Function parameters: `size_t len(const char *s)` documents that the function only reads.
- Read-only registers, combined with `volatile`.

Casting `const` away and writing to an object that was defined `const` is undefined behaviour.

## What are the three uses of the `static` keyword?

1. **On a local variable**: the variable keeps its value between calls. It lives in `.data` or `.bss`, not on the stack, and is initialised once.
2. **On a file-scope variable**: the name is visible only inside that source file (internal linkage).
3. **On a function**: the function is visible only inside that source file.

```c
static uint32_t ticks;                  // private to this file

static void advance(void) { ticks++; }  // private helper

uint32_t next_id(void) {
  static uint32_t id;                   // keeps its value; starts at 0
  return ++id;
}
```

Uses 2 and 3 are how C does encapsulation: everything is `static` unless the header exposes it. A function with a static local is not re-entrant.

## What is the significance of the `extern` keyword?

`extern` declares that a variable or function is defined somewhere else. It introduces the name and type without allocating storage, so several source files can share one object.

```c
// config.h
extern uint32_t system_clock_hz;      // declaration: no storage

// config.c
uint32_t system_clock_hz = 16000000u; // the one definition

// uart.c
#include "config.h"
uint32_t divisor(uint32_t baud) { return system_clock_hz / (16u * baud); }
```

Put the `extern` declaration in a header and the definition in exactly one `.c` file. Function declarations are `extern` by default. Startup code also uses `extern` to refer to symbols the linker script creates, such as the start and end of `.bss`.

## What is the purpose of the `inline` keyword?

`inline` suggests that the compiler replace a call with the body of the function, removing the call overhead. It suits small, frequently called functions such as register accessors.

```c
static inline void led_on(void) { GPIOA->BSRR = 1u << 5; }
```

Points to know:

- It is a hint. The compiler may ignore it, and may inline functions that are not marked.
- Write `static inline` in a header so each file gets its own copy and there are no linker errors.
- Inlining trades code size for speed; a large function inlined in many places grows the image.
- Unlike a macro, an inline function is type-checked, evaluates each argument once, and can be stepped through in a debugger.
- `__attribute__((always_inline))` and `noinline` override the compiler's choice when it matters.

## What is the difference between a macro and an inline function?

| | Macro | Inline function |
|---|---|---|
| Handled by | The preprocessor, as text | The compiler |
| Type checking | None | Full |
| Arguments | Pasted in, possibly evaluated several times | Evaluated once |
| Scope | None | Normal C scope |
| Debugging | Invisible | Can be stepped into |
| Can do | Stringify, paste tokens, work for any type | Only what a function can |

```c run
#include <stdio.h>

#define SQUARE(x) ((x) * (x))
static inline int square(int x) { return x * x; }

int main(void) {
  int a = 3, b = 3;
  printf("%d ", SQUARE(a++));   // a++ is pasted twice: undefined behaviour
  printf("%d\n", square(b++));  // evaluated once: 9
  return 0;
}
```

Always parenthesise every macro parameter and the whole body, and never pass an argument with side effects.

## What is the significance of the `restrict` keyword?

`restrict` on a pointer is a promise from the programmer: for the lifetime of that pointer, the object it points to is accessed only through it. With no aliasing to worry about, the compiler can keep values in registers and vectorise loops.

```c
void add(int *restrict dst, const int *restrict a, const int *restrict b, size_t n) {
  for (size_t i = 0; i < n; i++) dst[i] = a[i] + b[i];
}
```

Without `restrict`, the compiler must assume that writing `dst[i]` could change `a` or `b` and reload them every iteration. The standard library uses it: `memcpy` takes `restrict` pointers and so must not be given overlapping buffers, while `memmove` does not. Breaking the promise is undefined behaviour; the compiler does not check it.

## What is the role of the `typedef` keyword?

`typedef` gives an existing type a new name. It creates an alias, not a new type.

```c
typedef struct {
  uint8_t id;
  uint16_t value;
} reading_t;

typedef void (*callback_t)(uint8_t event);   // makes function-pointer types readable

typedef uint32_t tick_t;                     // one place to change if the tick widens

callback_t handlers[4];
reading_t latest;
```

It improves readability, hides complicated declarations, and aids portability: `<stdint.h>` itself is a set of typedefs that each compiler maps to the right built-in type.

## What is the difference between `typedef` and `#define` for naming a type?

`typedef` is handled by the compiler and creates a real type alias. `#define` is text substitution.

```c
typedef char *string_t;
#define STRING char *

string_t a, b;   // both are char *
STRING c, d;     // expands to: char *c, d;   so d is a plain char
```

A `typedef` also obeys scope, works for function pointers and arrays, and appears in debugger output. Use `typedef` for types and keep `#define` for constants and conditional compilation.

## What are the storage classes in C?

| Keyword | Lifetime | Visibility | Stored in |
|---|---|---|---|
| `auto` (the default for locals) | Until the block ends | The block | Stack or a register |
| `register` | Until the block ends | The block | A hint to use a register; its address cannot be taken |
| `static` (local) | The whole program | The block | `.data` or `.bss` |
| `static` (file scope) | The whole program | That source file | `.data` or `.bss` |
| `extern` | The whole program | Every file that declares it | `.data` or `.bss`, defined elsewhere |

`register` is ignored by modern compilers, which allocate registers better themselves. Objects with static lifetime are zero-initialised when no initialiser is given; automatic locals are not.

## What is the difference between a declaration and a definition?

A **declaration** tells the compiler that a name exists and what its type is. A **definition** also creates the thing: it allocates storage for a variable or provides the body of a function.

```c
extern int count;          // declaration
int count = 0;             // definition

int add(int a, int b);     // declaration (prototype)
int add(int a, int b) { return a + b; }   // definition

struct node;               // declaration of an incomplete type
```

A name can be declared many times but defined only once across the whole program. Headers hold declarations; source files hold definitions. Defining a variable in a header gives every file that includes it its own copy and causes a "multiple definition" link error.

## What is integer promotion, and why does it cause bugs?

In an expression, any integer type narrower than `int` is converted to `int` before the operation. Then, if the two operands still differ, the "usual arithmetic conversions" convert both to a common type, and when one is `unsigned int` the signed one is converted to unsigned.

```c run
#include <stdio.h>
#include <stdint.h>

int main(void) {
  uint8_t a = 200, b = 100;
  uint8_t sum = a + b;            // computed as int 300, then truncated to 44
  printf("%d %d\n", a + b, sum);

  uint8_t x = 0x0F;
  printf("%d\n", ~x == 0xF0);     // 0: ~x is the int 0xFFFFFFF0, not 0xF0

  int i = -1;
  unsigned u = 1;
  printf("%d\n", i < u);          // 0: -1 becomes 4294967295
  return 0;
}
```

Fixes: cast the result back (`(uint8_t)~x`), avoid mixing signed and unsigned in comparisons, and enable `-Wsign-compare` and `-Wconversion`.

## Why should you not assume the size of `int`?

The standard only guarantees minimums: `char` at least 8 bits, `short` and `int` at least 16, `long` at least 32, `long long` at least 64. An `int` is 16 bits on an 8-bit AVR and 32 bits on a Cortex-M; `long` is 32 bits on a Cortex-M and 64 bits on 64-bit Linux.

Code that assumes a size breaks when it moves: `int counter` overflows at 32767 on one target and not another, and a struct meant to match a register or packet has the wrong layout.

Use `<stdint.h>` types where the width matters, `size_t` for sizes, and `sizeof` instead of a number. A compile-time check documents an assumption:

```c
_Static_assert(sizeof(int) == 4, "this driver assumes a 32-bit int");
```

## How large is an `enum`, and why does it matter?

Enumeration constants have type `int`. The enumerated type itself has an implementation-defined size: the compiler may choose any integer type that holds all the values. GCC for ARM normally uses 4 bytes, but with `-fshort-enums` it uses the smallest type that fits, which can be 1 byte.

That matters whenever an enum is part of a layout: a struct sent over a wire, stored in flash, or shared with code built with different options. For those cases store a fixed-width integer and use the enum only for the names:

```c
typedef enum { MODE_IDLE, MODE_RUN, MODE_FAULT } mode_t;

typedef struct {
  uint8_t mode;      // holds a mode_t value, with a known size
  uint16_t speed;
} status_packet_t;
```

## What are header guards and why are they needed?

A header guard stops the contents of a header from being processed twice in one translation unit, which would cause "redefinition" errors for types and macros when headers include each other.

```c
#ifndef UART_H
#define UART_H

#include <stdint.h>

typedef struct { uint32_t baud; } uart_config_t;
void uart_init(const uart_config_t *config);

#endif /* UART_H */
```

`#pragma once` does the same in one line and is supported by every mainstream compiler, though it is not standard. A guard prevents double inclusion in one file; it does not prevent a variable defined in a header from being defined once in every file that includes it.

## Does `volatile` make a variable safe to share with an interrupt?

No. `volatile` only forces the compiler to perform every read and write. It does not make a sequence of operations atomic.

```c
volatile uint32_t count;       // incremented in an ISR

void main_loop(void) {
  count--;                     // load, subtract, store: the ISR can run in between
}
```

If the ISR increments `count` between the load and the store, its update is lost. The same applies to reading a variable wider than the CPU word on an 8-bit or 16-bit processor: the ISR can change it between the byte reads.

The fix is to make the access atomic: disable interrupts briefly around it, use an atomic type or instruction, or design the data so that only one side writes it (as in a single-producer ring buffer).

## How do `#define`, `const` and `enum` compare for defining constants?

| | `#define` | `const` object | `enum` |
|---|---|---|---|
| Has a type | No | Yes | `int` |
| Obeys scope | No | Yes | Yes |
| Occupies memory | No | Usually, in flash | No |
| Usable as an array size or `case` label | Yes | No (in C) | Yes |
| Visible in the debugger | No | Yes | Yes |
| Can be any type | Any literal | Any type | Integers only |

A reasonable rule: `enum` for related integer constants, `static const` for typed values and tables, and `#define` for conditional compilation and for constants needed by the preprocessor.
