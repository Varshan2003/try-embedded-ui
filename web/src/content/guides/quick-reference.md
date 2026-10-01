## Type sizes

Use `<stdint.h>` types whenever the width matters. The sizes of the basic types depend on the target.

| Type | 8-bit AVR | 32-bit Cortex-M | 64-bit Linux |
|---|---|---|---|
| `char` | 1 | 1 | 1 |
| `short` | 2 | 2 | 2 |
| `int` | 2 | 4 | 4 |
| `long` | 4 | 4 | 8 |
| `long long` | 8 | 8 | 8 |
| pointer | 2 | 4 | 8 |

| Type | Range |
|---|---|
| `uint8_t` | 0 to 255 |
| `int8_t` | -128 to 127 |
| `uint16_t` | 0 to 65535 |
| `int16_t` | -32768 to 32767 |
| `uint32_t` | 0 to 4294967295 |
| `int32_t` | -2147483648 to 2147483647 |

## Bit idioms

| Goal | Code |
|---|---|
| Set bit `n` | `reg \|= (1u << n);` |
| Clear bit `n` | `reg &= ~(1u << n);` |
| Toggle bit `n` | `reg ^= (1u << n);` |
| Test bit `n` | `(reg >> n) & 1u` |
| Mask of width `w` (1 to 31) | `(1u << w) - 1` |
| Read a field | `(reg >> pos) & mask` |
| Write a field | `reg = (reg & ~(mask << pos)) \| ((val & mask) << pos);` |
| Lowest set bit | `x & -x` |
| Clear the lowest set bit | `x & (x - 1)` |
| Power of two? | `x && !(x & (x - 1))` |
| Modulo a power of two | `x & (n - 1)` |
| Round up to a power-of-two multiple | `(x + n - 1) & ~(n - 1)` |
| Swap the bytes of a 16-bit value | `(uint16_t)((v << 8) \| (v >> 8))` |

## Operator precedence that bites

From tightest to loosest. When in doubt, add parentheses.

| Level | Operators | Trap |
|---|---|---|
| 1 | `()` `[]` `->` `.` `x++` `x--` | `*p++` is `*(p++)` |
| 2 | `!` `~` `++x` `--x` `-x` `*x` `&x` `(type)` `sizeof` | |
| 3 | `*` `/` `%` | |
| 4 | `+` `-` | `1 << 2 + 1` is `1 << 3` |
| 5 | `<<` `>>` | |
| 6 | `<` `<=` `>` `>=` | |
| 7 | `==` `!=` | `x & mask == 0` is `x & (mask == 0)` |
| 8 | `&` | |
| 9 | `^` | |
| 10 | `\|` | |
| 11 | `&&` | |
| 12 | `\|\|` | |
| 13 | `?:` | |
| 14 | `=` `+=` `\|=` and the rest | |

## Declarations

| Declaration | Meaning |
|---|---|
| `const uint8_t *p` | Pointer to read-only data |
| `uint8_t *const p` | Read-only pointer to data |
| `volatile uint32_t *reg` | Pointer to a value that can change by itself |
| `const volatile uint32_t *sr` | Read-only register that hardware changes |
| `int *a[4]` | Array of four pointers to `int` |
| `int (*a)[4]` | Pointer to an array of four `int`s |
| `void (*fn)(int)` | Pointer to a function taking `int`, returning nothing |
| `void (*table[4])(int)` | Array of four such function pointers |
| `static` on a local | Keeps its value between calls |
| `static` at file scope | Visible only in this file |
| `extern` | Declared here, defined in another file |

## Registers

```c
#define REG32(addr)   (*(volatile uint32_t *)(addr))

typedef struct {
  volatile uint32_t CR;      // 0x00
  volatile uint32_t SR;      // 0x04
  uint32_t RESERVED[2];      // 0x08, 0x0C
  volatile uint32_t DR;      // 0x10
} uart_t;
#define UART1 ((uart_t *)0x40011000u)
```

| Register access type | To clear bit `n` |
|---|---|
| Read/write | `reg &= ~(1u << n);` |
| Write 1 to clear | `reg = (1u << n);` |
| Write-only set/reset (for example `BSRR`) | `reg = (1u << (n + 16));` |

## Undefined behaviour to know by heart

- Signed integer overflow.
- Shifting by a negative count, or by the width of the type or more.
- Left-shifting into the sign bit: write `1u << 31`, not `1 << 31`.
- Dividing by zero.
- Reading or writing outside an array, or through a pointer to an object that no longer exists.
- Dereferencing `NULL`.
- Writing to a string literal.
- Reading an uninitialised local variable.
- Modifying a variable twice in one expression, as in `i = i++`.
- Overlapping `memcpy`. Use `memmove`.

## Memory layout

| Where | What lives there | Lifetime |
|---|---|---|
| Flash (`.text`, `.rodata`) | Code, `const` data, string literals | Permanent |
| `.data` | Initialised globals and statics; copied from flash at start-up | Whole program |
| `.bss` | Zero-initialised globals and statics | Whole program |
| Heap | `malloc` | Until `free` |
| Stack | Locals, return addresses; grows downward on Arm | Until the function returns |

Struct layout: each member is placed at a multiple of its alignment, and the size is rounded up to a multiple of the largest alignment. Order members from largest to smallest to avoid padding.

## Byte order

| | Lowest address holds | Used by |
|---|---|---|
| Little-endian | Least significant byte | Cortex-M, x86, RISC-V, USB, Bluetooth LE |
| Big-endian | Most significant byte | Network protocols, many sensors |

```c
uint32_t be = ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3];
uint16_t le = (uint16_t)(p[0] | (p[1] << 8));
```

## Time

| Rule | Code |
|---|---|
| Elapsed time, safe across rollover | `now - start` |
| Timeout | `if (now - start >= timeout)` |
| Periodic without drift | `start += period;` |
| Never | `if (now >= start + timeout)` |

## printf conversions

| Type | Conversion |
|---|---|
| `int`, `int8_t`, `int16_t`, `int32_t` | `%d` |
| `unsigned`, `uint8_t`, `uint16_t`, `uint32_t` | `%u`, `%x`, `%X` |
| `int64_t`, `uint64_t` | `%lld`, `%llu`, `%llx` |
| `size_t` | `%zu`, or cast to `unsigned` and use `%u` |
| `char`, string | `%c`, `%s` |
| pointer | `%p` |
| Two hex digits with leading zero | `%02X` |
| Eight hex digits | `%08X` |

## The questions interviewers always ask

- What does `volatile` do, and when is it needed? Can a variable be `const volatile`?
- What does `static` mean on a local, on a global and on a function?
- What is the difference between a macro and an inline function?
- What is `sizeof` this struct, and why?
- Is this CPU little-endian or big-endian? How would you check?
- What is wrong with this interrupt handler?
- Why does this loop over a `uint8_t` never end?
- How do you set bit 5 of a register without disturbing the others, and is that atomic?
- What happens to this pointer after the function returns?
- How would you detect and handle overflow here?
