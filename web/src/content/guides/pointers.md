## A pointer is an address with a type

A pointer holds the address of an object. Its type says what kind of object lives there, which decides how many bytes a dereference reads and how far `+ 1` moves.

| Syntax | Meaning |
|---|---|
| `int *p;` | `p` can hold the address of an `int` |
| `p = &x;` | `&` takes the address of `x` |
| `*p` | The object `p` points to (dereference) |
| `p->member` | Shorthand for `(*p).member` |
| `NULL` | A pointer that points at nothing |

```c run
#include <stdio.h>
#include <stdint.h>

static void increment(int32_t *value) {
  (*value)++;                   // changes the caller's variable
}

int main(void) {
  int32_t count = 41;
  int32_t *p = &count;

  increment(p);
  printf("count = %d, *p = %d\n", count, *p);
  printf("the pointer itself is %u bytes and holds %p\n", (unsigned)sizeof p, (void *)p);
  return 0;
}
```

C passes arguments by value, so a function that must modify its caller's variable, or return more than one result, takes a pointer to it. The address printed is in RAM, which starts at `0x20000000` on this target, just as on a Cortex-M.

## Pointer arithmetic

Adding 1 to a pointer advances it by one element, not one byte. `p + n` is `n * sizeof(*p)` bytes further on. Subtracting two pointers into the same array gives the number of elements between them.

```c run
#include <stdio.h>
#include <stdint.h>

int main(void) {
  uint32_t data[4] = { 10, 20, 30, 40 };
  uint32_t *p = data;           // an array name decays to a pointer to its first element
  uint8_t *bytes = (uint8_t *)data;

  printf("p + 1 is %u bytes on, bytes + 1 is %u byte on\n",
         (unsigned)((uint8_t *)(p + 1) - (uint8_t *)p), (unsigned)((bytes + 1) - bytes));
  printf("*(p + 2) = %u, p[2] = %u\n", *(p + 2), p[2]);

  uint32_t *end = data + 4;     // one past the end: valid to form, not to dereference
  uint32_t sum = 0;
  for (uint32_t *q = data; q != end; q++) sum += *q;
  printf("sum = %u, elements = %d\n", sum, (int)(end - data));
  return 0;
}
```

`a[i]` is defined as `*(a + i)`. Indexing and pointer arithmetic are the same operation.

> **Pitfall:** `*p++` is `*(p++)`: it reads the object, then advances the pointer. `(*p)++` increments the object. Postfix operators bind tighter than `*`.

## const and pointers

There are two things that can be const: the data and the pointer. Read the declaration from right to left.

| Declaration | Reads as | You may not |
|---|---|---|
| `const uint8_t *p` | pointer to const data | write `*p` |
| `uint8_t *const p` | const pointer to data | change `p` |
| `const uint8_t *const p` | const pointer to const data | do either |

Use `const` on every pointer parameter the function only reads. It documents the interface, lets callers pass constant data, and lets the linker put tables in flash instead of RAM.

```c
size_t count_zeros(const uint8_t *data, size_t n);   // promises not to modify the buffer
```

## void pointers

`void *` is a pointer with no element type. It converts to and from any object pointer without a cast, which makes it the type for generic interfaces such as `memcpy` or a callback's context argument. Because it has no size, it cannot be dereferenced or used in arithmetic until it is converted to a real type.

```c run
#include <stdio.h>
#include <stdint.h>
#include <stddef.h>

// Works for any type: it only ever looks at bytes.
static void fill(void *dst, uint8_t value, size_t n) {
  uint8_t *p = dst;
  while (n--) *p++ = value;
}

int main(void) {
  uint32_t word;
  uint16_t pair[2];
  fill(&word, 0xAB, sizeof word);
  fill(pair, 0x11, sizeof pair);
  printf("0x%08X 0x%04X 0x%04X\n", word, pair[0], pair[1]);
  return 0;
}
```

`unsigned char` (or `uint8_t`) is the type to use for looking at the bytes of any object.

## Pointers to pointers

A function that must change a pointer belonging to its caller takes a pointer to that pointer. Parsers use this to advance a cursor, and linked lists use it to update a link.

```c run
#include <stdio.h>

static void skip_spaces(const char **cursor) {
  while (**cursor == ' ') (*cursor)++;
}

int main(void) {
  const char *line = "   SET 42";
  const char *p = line;
  skip_spaces(&p);
  printf("skipped %d characters, now at \"%s\"\n", (int)(p - line), p);
  return 0;
}
```

## Lifetime: where most crashes come from

A pointer is only as good as the object it points to. C has three storage durations, and mixing them up is the source of most hard faults.

| Storage | Declared as | Lives until | Typical bug |
|---|---|---|---|
| Automatic (stack) | local variable | the function returns | returning its address |
| Static | global, or `static` local | the program ends | none, but it is shared state |
| Allocated (heap) | `malloc` | `free` is called | use after free, leaks, double free |

Run this. On real hardware it prints garbage or appears to work, depending on what reuses the stack. The simulator checks every access and tells you what went wrong.

```c run fails
#include <stdio.h>
#include <stdint.h>

static const uint8_t *get_config(void) {
  uint8_t config[4] = { 1, 2, 3, 4 };   // lives in this function's stack frame
  return config;                        // the frame is gone when the function returns
}

int main(void) {
  const uint8_t *cfg = get_config();
  printf("%u\n", cfg[0]);
  return 0;
}
```

Now make the array `static const` and run it again. The data then has a permanent address, and can live in flash.

Other faults the simulator reports, each with the line that caused it:

- Dereferencing `NULL` or an uninitialised pointer.
- Reading or writing past the end of an array, on the stack, in a global or on the heap.
- Using heap memory after `free`, or freeing it twice.
- Writing to a string literal, which lives in read-only flash.

## Alignment

A 32-bit value is normally stored at an address that is a multiple of 4. Casting a byte pointer to `uint32_t *` and dereferencing it can therefore fail: a Cortex-M0 raises a HardFault on an unaligned access, and other cores silently take longer.

To read a multi-byte value from an arbitrary position in a buffer, assemble it from bytes or use `memcpy`:

```c
uint32_t value;
memcpy(&value, buffer + 3, sizeof value);   // correct at any alignment
```

## Common mistakes

- Using a pointer before it points at anything. Initialise pointers, to `NULL` if nothing better.
- Returning the address of a local variable.
- Off-by-one: an array of `n` elements has valid indices 0 to `n - 1`.
- `sizeof(pointer)` when you meant the size of the array it points into.
- Casting away `const` to write to data that lives in flash.

```quiz
Q: `uint16_t a[4]; uint16_t *p = a;` By how many bytes does `p + 3` differ from `p`?
- 3
* 6
- 12
Why: Pointer arithmetic is scaled by the size of the pointed-to type. Three `uint16_t` elements are 6 bytes.
```

```quiz
Q: Which declaration lets you change the pointer but not the data it points to?
* `const uint8_t *p`
- `uint8_t *const p`
- `const uint8_t *const p`
Why: Reading right to left, `p` is a pointer to a `uint8_t` that is const. The pointer itself is not const.
```

```ask
Q: What is the difference between a NULL pointer, a dangling pointer and a wild pointer?
A: A NULL pointer deliberately points at nothing and can be tested for. A dangling pointer once pointed at a valid object whose lifetime has ended: a returned local, or freed heap memory. A wild pointer was never initialised and holds whatever was in memory. Only the first can be detected in code, which is why pointers should be initialised and set to NULL after their object is freed.
```

```ask
Q: Why is casting a `uint8_t *` buffer to `uint32_t *` risky?
A: Three reasons. Alignment: the buffer may start at an odd address, and an unaligned 32-bit load faults on some cores. Byte order: the result depends on the CPU's endianness, not on the protocol's. Strict aliasing: the compiler may assume a `uint32_t *` and a `uint8_t` array do not overlap in the other direction and optimise accordingly. `memcpy` or explicit shifts avoid all three.
```
