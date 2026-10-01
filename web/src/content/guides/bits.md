## The four operations

Hardware is configured one bit at a time, and C gives you exactly the operators needed. Almost every line of driver code is one of four idioms, each built on a mask: a value with 1s in the positions you care about.

| Goal | Idiom | Why it works |
|---|---|---|
| Set bits | `reg \|= mask` | OR with 1 gives 1; OR with 0 keeps the bit |
| Clear bits | `reg &= ~mask` | AND with 0 gives 0; AND with 1 keeps the bit |
| Toggle bits | `reg ^= mask` | XOR with 1 flips; XOR with 0 keeps the bit |
| Test bits | `(reg & mask) != 0` | AND isolates the bits of interest |

A single-bit mask is `1u << n`, where bit 0 is the least significant.

```c run
#include <stdio.h>
#include <stdint.h>

int main(void) {
  uint8_t reg = 0x00;

  reg |= (1u << 3);              // set bit 3
  printf("after set:    0x%02X\n", reg);
  reg |= (1u << 0) | (1u << 7);  // set bits 0 and 7 together
  printf("after set:    0x%02X\n", reg);
  reg &= (uint8_t)~(1u << 3);    // clear bit 3
  printf("after clear:  0x%02X\n", reg);
  reg ^= (1u << 0);              // toggle bit 0
  printf("after toggle: 0x%02X\n", reg);
  printf("bit 7 is %s\n", (reg & (1u << 7)) ? "set" : "clear");
  return 0;
}
```

> **Pitfall:** Write `1u`, not `1`. The constant `1` is a signed `int`, and `1 << 31` shifts into the sign bit, which is undefined behaviour.

## Reading the result of a test correctly

`reg & mask` is not 0 or 1. It is 0 or the mask. That matters when the result is stored in something narrow or compared with 1.

```c run
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>

int main(void) {
  uint32_t status = 0x00000100;        // bit 8 is set

  uint8_t wrong = status & (1u << 8);  // 0x100 does not fit in 8 bits
  bool as_bool = status & (1u << 8);   // conversion to bool gives 1 for any non-zero value
  uint8_t shifted = (status >> 8) & 1u;

  printf("narrowed: %u, bool: %d, shift-then-mask: %u\n", wrong, as_bool, shifted);
  printf("status & mask == 1 is %d\n", (status & (1u << 8)) == 1);
  return 0;
}
```

Either shift the bit down to position 0 and mask with 1, or compare with zero.

## Multi-bit fields

Registers pack several settings into one word. A field is described by its position (the index of its lowest bit) and its width.

- Mask for a field of width `w`: `(1u << w) - 1`, so width 3 gives `0b111`.
- Read: shift down, then mask. `(reg >> pos) & mask`.
- Write: clear the field, then OR in the new value. `reg = (reg & ~(mask << pos)) | ((value & mask) << pos)`.

```c run
#include <stdio.h>
#include <stdint.h>

#define MODE_POS  4u
#define MODE_MASK 0x7u          // 3 bits wide

int main(void) {
  uint32_t ctrl = 0xFFFFFFFF;

  uint32_t mode = (ctrl >> MODE_POS) & MODE_MASK;
  printf("mode was %u\n", mode);

  ctrl = (ctrl & ~(MODE_MASK << MODE_POS)) | ((5u & MODE_MASK) << MODE_POS);
  printf("ctrl is now 0x%08X, mode %u\n", ctrl, (ctrl >> MODE_POS) & MODE_MASK);
  return 0;
}
```

> **Pitfall:** OR alone cannot write a field. OR-ing mode 1 (`001`) over an existing mode 2 (`010`) gives mode 3 (`011`). Always clear first.

Mask the new value as well. Without `& MODE_MASK`, a value that is too large spills into the neighbouring field.

## Shifts

| Expression | Result |
|---|---|
| `x << n` | Multiplies by 2^n; bits shifted out are lost |
| `x >> n` on an unsigned value | Divides by 2^n; zeros shift in |
| `x >> n` on a negative signed value | Implementation-defined; in practice the sign bit is copied (arithmetic shift) |
| Shift by a negative count or by the width or more | Undefined behaviour |

The last row is the one that causes bugs. `(1u << width) - 1` is fine for widths 1 to 31 and undefined for 32. A rotate written as `(x << n) | (x >> (32 - n))` is undefined when `n` is 0.

```c run
#include <stdio.h>
#include <stdint.h>

// Works for every count, including 0 and multiples of 32.
static uint32_t rotl32(uint32_t x, unsigned n) {
  n &= 31;
  return (x << n) | (x >> ((32 - n) & 31));
}

int main(void) {
  printf("0x%08X\n", rotl32(0x80000001, 1));
  printf("0x%08X\n", rotl32(0x12345678, 0));
  printf("0x%08X\n", rotl32(0x12345678, 36));
  return 0;
}
```

Change the function to the naive version and run it with a count of 0. The simulator reports the undefined shift instead of returning whatever the hardware would.

## Tricks worth knowing

These come up constantly in interviews. Each follows from one observation: subtracting 1 flips the lowest set bit and every bit below it.

| Expression | Meaning |
|---|---|
| `x & (x - 1)` | `x` with its lowest set bit cleared |
| `x != 0 && (x & (x - 1)) == 0` | `x` is a power of two |
| `x & -x` | Only the lowest set bit of `x` |
| `x & (n - 1)` | `x % n` when `n` is a power of two |
| `(x + n - 1) & ~(n - 1)` | `x` rounded up to a multiple of `n`, a power of two |
| `a ^ b` | The bits in which `a` and `b` differ |

```c run
#include <stdio.h>
#include <stdint.h>

static unsigned popcount(uint32_t x) {
  unsigned n = 0;
  while (x) {         // one iteration per set bit
    x &= x - 1;
    n++;
  }
  return n;
}

int main(void) {
  printf("popcount(0xF0F0) = %u\n", popcount(0xF0F0));
  printf("64 is a power of two: %d, 96 is: %d\n", (64 & 63) == 0, (96 & 95) == 0);
  printf("lowest set bit of 0x58 = 0x%X\n", 0x58 & -0x58);
  printf("13 rounded up to a multiple of 8 = %u\n", (13u + 7u) & ~7u);
  return 0;
}
```

## Macros for bits

Bit macros keep driver code readable, and they are easy to get wrong because macro expansion is textual. Parenthesise every parameter and the whole body.

```c
#define BIT(n)                 (1u << (n))
#define SET_BITS(reg, mask)    ((reg) |= (mask))
#define CLEAR_BITS(reg, mask)  ((reg) &= ~(mask))
#define READ_FIELD(reg, mask, pos)  (((reg) & (mask)) >> (pos))
```

Without the inner parentheses, `CLEAR_BITS(r, A | B)` expands to `r &= ~A | B`, which clears `A` and then sets `B`.

## Common mistakes

- `1 << n` instead of `1u << n`, especially for `n` equal to 31.
- Setting a field with OR without clearing it first.
- Comparing `reg & mask` with 1 instead of with 0.
- Forgetting that `~` promotes: `~(uint8_t)0x0F` is `0xFFFFFFF0`.
- Operator precedence: `==` binds tighter than `&`, so `reg & mask == 0` means `reg & (mask == 0)`.

```quiz
Q: `uint8_t r = 0x0F;` After `r &= ~(1u << 2);` what is `r`?
- `0x04`
* `0x0B`
- `0x0F`
Why: `~(1u << 2)` has every bit set except bit 2, so the AND clears bit 2 only: `0x0F` becomes `0x0B`.
```

```quiz
Q: What is wrong with `if (flags & 0x10 == 0x10)`?
- Nothing
- `0x10` should be written `1u << 4`
* `==` is evaluated before `&`, so it tests `flags & 1`
Why: `0x10 == 0x10` is 1, and the condition becomes `flags & 1`. Write `(flags & 0x10) == 0x10`.
```

```ask
Q: How would you count the set bits in a 32-bit word on a core with no popcount instruction?
A: The simple answer is `while (x) { x &= x - 1; n++; }`, which loops once per set bit. For constant time, use a 256-entry lookup table per byte (fast, costs 256 bytes of flash) or the parallel "SWAR" method that sums bits in pairs, nibbles and bytes with masks. Say which trade-off suits the target: flash is usually cheaper than cycles in an interrupt, and the loop is fine for occasional use.
```

```ask
Q: Why is `reg |= (1u << 5)` not atomic, and when does it matter?
A: It compiles to a load, an OR and a store. If an interrupt modifies the same register between the load and the store, the store writes back a stale value and the interrupt's change is lost. It matters whenever a register or variable is modified from both the main code and an interrupt. The fixes are a dedicated set/clear register (such as `BSRR`), bit-banding, or a short critical section.
```
