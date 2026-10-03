# Pointers, memory and data layout

## How do you declare and use a pointer?

A pointer is a variable that holds the address of another object. `&` takes an address, `*` follows one.

```c run
#include <stdio.h>
#include <stdint.h>

static void scale(uint16_t *value, uint16_t factor) { *value = (uint16_t)(*value * factor); }

int main(void) {
  uint16_t reading = 21;
  uint16_t *p = &reading;      // p holds the address of reading

  *p = 42;                     // write through the pointer
  scale(&reading, 2);          // let a function change the caller's variable
  printf("%u\n", reading);

  uint8_t buf[4] = { 1, 2, 3, 4 };
  uint8_t *b = buf;            // an array name decays to a pointer to its first element
  printf("%u %u\n", *(b + 2), b[3]);   // arithmetic moves in units of the pointed-to type
  return 0;
}
```

In firmware, pointers are used to pass buffers without copying, to return more than one result, to walk arrays, to call functions indirectly, and to reach registers at fixed addresses. Always initialise a pointer and check it before use if it can be `NULL`.

## What is a pointer to a function, and where is it used?

A function pointer holds the address of a function, so the function to call can be chosen at run time.

```c run
#include <stdio.h>

typedef void (*handler_t)(int);

static void on_start(int arg) { printf("start %d\n", arg); }
static void on_stop(int arg)  { printf("stop %d\n", arg); }

static const handler_t handlers[] = { on_start, on_stop };   // a dispatch table

int main(void) {
  handler_t h = on_start;
  h(1);                          // same as (*h)(1)
  for (unsigned i = 0; i < 2; i++) handlers[i](10 + (int)i);
  return 0;
}
```

Uses in firmware: interrupt vector tables, callbacks registered with a driver, command and state-machine dispatch tables, and driver interfaces (a struct of function pointers that each device fills in). Check for `NULL` before calling through one.

## What is a structure and how is it used?

A structure groups related variables of different types under one name.

```c
typedef struct {
  uint8_t  id;
  uint16_t raw;
  int16_t  temperature_c10;   // tenths of a degree
} sensor_t;

sensor_t s = { .id = 3, .raw = 512 };
s.temperature_c10 = 235;          // member access with .

void update(sensor_t *p) { p->raw = adc_read(p->id); }   // through a pointer with ->
```

Uses: configuration records, messages and packets, driver state, nodes of lists, and register maps (a struct whose members line up with a peripheral's registers). Pass a large struct by pointer to avoid copying it. The compiler may insert padding between members, so `sizeof` can be more than the sum of the members.

## What are bit fields?

A bit field is a struct member with a width in bits, so several small values share one storage unit.

```c run
#include <stdio.h>
#include <stdint.h>

typedef union {
  uint8_t raw;
  struct {
    uint8_t enable   : 1;
    uint8_t mode     : 3;
    uint8_t priority : 4;
  } f;
} control_t;

int main(void) {
  control_t c = { .raw = 0 };
  c.f.enable = 1;
  c.f.mode = 5;
  c.f.priority = 0xA;
  printf("0x%02X\n", c.raw);
  return 0;
}
```

They read well and save RAM, but the order of the bits within the unit, whether a plain `int` field is signed, and how fields straddle units are all implementation-defined. A bit-field write is also a read-modify-write of the whole unit. For hardware registers and wire formats that must be portable, prefer explicit shifts and masks.

## What is a union and how is it used?

A union's members all share the same memory, so it is as large as its largest member and holds one of them at a time.

```c run
#include <stdio.h>
#include <stdint.h>

typedef union {
  uint32_t word;
  uint8_t  bytes[4];
} word_t;

typedef struct {
  enum { MSG_KEY, MSG_TEMP } kind;        // the tag says which member is valid
  union { uint8_t key; int16_t temp_c10; } data;
} message_t;

int main(void) {
  word_t w = { .word = 0x11223344 };
  printf("%02X %02X\n", w.bytes[0], w.bytes[3]);   // 44 11 on a little-endian target

  message_t m = { .kind = MSG_TEMP, .data.temp_c10 = 235 };
  if (m.kind == MSG_TEMP) printf("%d\n", m.data.temp_c10);
  return 0;
}
```

Uses: viewing the same data as a word or as bytes, tagged unions that carry one of several message types, and overlaying bit fields on a raw register value. The byte view depends on byte order.

## What is memory alignment, and how do you control it?

Most types must sit at an address that is a multiple of their alignment (often their size): a `uint32_t` on a 4-byte boundary. Unaligned access is slower on some CPUs and a fault on others. To keep members aligned, the compiler inserts padding inside structs and at the end.

```c run
#include <stdio.h>
#include <stdint.h>
#include <stddef.h>

typedef struct { uint8_t a; uint32_t b; uint8_t c; } loose_t;    // 1 + 3 pad + 4 + 1 + 3 pad
typedef struct { uint32_t b; uint8_t a; uint8_t c; } tight_t;    // 4 + 1 + 1 + 2 pad
typedef struct __attribute__((packed)) { uint8_t a; uint32_t b; uint8_t c; } packed_t;

int main(void) {
  printf("%u %u %u\n", (unsigned)sizeof(loose_t), (unsigned)sizeof(tight_t), (unsigned)sizeof(packed_t));
  printf("offset of b: %u\n", (unsigned)offsetof(loose_t, b));
  return 0;
}
```

Controls: order members from largest to smallest; `__attribute__((packed))` or `#pragma pack` to remove padding (at the cost of unaligned access); `_Alignas` or `__attribute__((aligned(n)))` to raise alignment, for example for DMA buffers.

## What is structure padding, and when should you pack a struct?

Padding is the unused bytes the compiler adds so that each member is aligned and so that the struct's size is a multiple of its largest alignment (which keeps arrays of it aligned).

Pack a struct only when its layout must match something external byte for byte, such as a protocol header or a file format, and even then prefer writing the bytes out one at a time, which is portable and has no alignment risk.

Costs of packing:

- Access to a misaligned member is slower, and on some CPUs it faults.
- Taking the address of a packed member gives a misaligned pointer.
- It still does not fix byte order.

To save RAM without packing, reorder the members. Never compare padded structs with `memcmp`, because the padding bytes are not defined.

## What is the difference between little-endian and big-endian byte order?

Endianness is the order in which the bytes of a multi-byte value are stored in memory.

- **Little-endian**: the least significant byte is at the lowest address.
- **Big-endian**: the most significant byte is at the lowest address.

For `0x12345678` stored at address 0x100:

| Address | 0x100 | 0x101 | 0x102 | 0x103 |
|---|---|---|---|---|
| Little-endian | 78 | 56 | 34 | 12 |
| Big-endian | 12 | 34 | 56 | 78 |

ARM Cortex-M, x86 and RISC-V are little-endian in practice. Network protocols (TCP/IP) use big-endian, called network byte order. Endianness only matters when multi-byte data crosses a boundary: a communication link, a file, or a cast between pointer types.

## How do you handle endianness issues?

Never copy a multi-byte value straight between memory and a wire or file. Define the byte order of the format and build or parse the value with shifts, which works on any CPU.

```c run
#include <stdio.h>
#include <stdint.h>

static uint32_t read_be32(const uint8_t *p) {
  return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3];
}
static void write_le16(uint8_t *p, uint16_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); }

int main(void) {
  const uint8_t frame[] = { 0x12, 0x34, 0x56, 0x78 };
  uint8_t out[2];
  write_le16(out, 0xABCD);
  printf("0x%08X %02X %02X\n", read_be32(frame), out[0], out[1]);

  uint16_t probe = 1;                       // a run-time check of this CPU
  printf("%s-endian\n", *(uint8_t *)&probe ? "little" : "big");
  return 0;
}
```

Other tools: `htons`/`ntohl` where a network library exists, and `__builtin_bswap32` for a fast swap. Avoid sending structs or bit fields directly.

## What is the difference between static and dynamic memory allocation?

| | Static | Dynamic |
|---|---|---|
| When the size is fixed | At compile or link time | At run time |
| Where it lives | `.data`, `.bss` or the stack | The heap |
| How | Declaring variables and arrays | `malloc`, `calloc`, `realloc`, `free` |
| Speed | No cost at run time | A search of the heap; time varies |
| Failure | Found at link time | Can fail at run time, after months |
| Fragmentation | None | Possible |

Firmware favours static allocation: the worst-case memory use is known before the product ships, and nothing can fail or fragment in the field. When flexibility is needed, a fixed-block memory pool gives it without the heap's unpredictability.

## How do you perform dynamic memory allocation, and what are the risks?

```c
uint8_t *buf = malloc(len);
if (buf == NULL) {
  return ERR_NO_MEMORY;        // always check: the heap is small
}
memcpy(buf, src, len);
/* ... */
free(buf);
buf = NULL;                    // avoid using it again by accident
```

Risks on a microcontroller:

- **Fragmentation**: after many allocations and frees of different sizes, free memory is split into pieces too small to use, and an allocation fails although the total is sufficient.
- **Non-deterministic time**: `malloc` may search a long list, which hurts real-time behaviour.
- **Leaks**: a device that runs for years exposes even a tiny leak.
- **Not safe in ISRs**, and it needs a lock under an RTOS.

Common policy: allocate only during initialisation and never free, or use fixed-size pools. Safety standards such as MISRA forbid dynamic allocation after start-up.

## What is a memory pool, and how do you implement one?

A memory pool is a set of equal-sized blocks set aside in advance. Allocating takes a block off a free list and freeing puts it back, so both take constant time and nothing can fragment.

```c run
#include <stdio.h>
#include <stdint.h>
#include <stddef.h>

#define BLOCK_SIZE 32
#define BLOCK_COUNT 4

typedef union block { union block *next; uint8_t data[BLOCK_SIZE]; } block_t;

static block_t pool[BLOCK_COUNT];
static block_t *free_list;

static void pool_init(void) {
  for (int i = 0; i < BLOCK_COUNT - 1; i++) pool[i].next = &pool[i + 1];
  pool[BLOCK_COUNT - 1].next = NULL;
  free_list = &pool[0];
}
static void *pool_alloc(void) {
  block_t *b = free_list;
  if (b) free_list = b->next;
  return b;                         // NULL when the pool is empty
}
static void pool_free(void *p) {
  block_t *b = p;
  b->next = free_list;
  free_list = b;
}

int main(void) {
  pool_init();
  void *a = pool_alloc(), *b = pool_alloc();
  printf("%d\n", (int)((uint8_t *)b - (uint8_t *)a));
  pool_free(a);
  printf("%d\n", pool_alloc() == a);   // the freed block is reused
  return 0;
}
```

The free list is stored inside the free blocks themselves, so it costs no extra memory. Protect `alloc` and `free` with a critical section if they are called from more than one context.

## How do you perform fixed-size memory allocation?

Fixed-size allocation hands out blocks that are all the same size, from a pool reserved at build time. It is the memory-pool technique above: a static array of blocks plus a free list (or a bitmap of used blocks).

Why firmware uses it instead of `malloc`:

- Allocation and release take constant time.
- There is no external fragmentation, because every free block fits every request.
- The worst case is known: when the pool is empty, allocation fails immediately and visibly.
- It is easy to make safe for ISRs with a short critical section.

The cost is internal waste when a request is smaller than the block. Systems with varied sizes use several pools (for example 16, 64 and 256 bytes) and pick the smallest that fits. RTOSes provide this ready-made as block or partition pools.

## How do you implement a memory management scheme?

Choose the simplest scheme the product can live with:

1. **Static only**: every buffer is a global or static array. Nothing can fail at run time. This is the default for small and safety-related firmware.
2. **Allocate at start-up, never free**: a "bump" allocator that moves a pointer through a block of RAM. Flexible configuration, no fragmentation.
3. **Fixed-size pools**: for objects created and destroyed at run time, such as message buffers.
4. **A general heap**: only when sizes really vary, and preferably an allocator with bounded time such as TLSF.

Whatever the choice, define where each region lives in the linker script, add guard patterns or MPU regions to catch overruns, track the high-water mark of each pool and stack, and decide what the system does when memory runs out.

## What makes a memory management scheme suitable for real-time use?

Two properties: allocation and release take a **bounded, known time**, and the scheme cannot degrade through **fragmentation** over a long run.

- A general `malloc` fails both: its time depends on the state of the heap.
- **Fixed-block pools** satisfy both and are the standard answer.
- **TLSF** (two-level segregated fit) is a general allocator with constant-time operations and low fragmentation, used when block sizes must vary.
- **Stack or arena allocation** is constant-time and is released all at once.

A real-time design also keeps allocation out of ISRs or makes it interrupt-safe, sizes the pools for the worst case, and treats exhaustion as a handled error rather than something that cannot happen.

## What types of memory are found in embedded systems?

| Memory | Volatile | Typical use |
|---|---|---|
| Flash (NOR) | No | Program code and constants; erased in blocks, limited write cycles |
| Flash (NAND) | No | Bulk storage; needs error correction and bad-block handling |
| EEPROM | No | Small amounts of configuration; byte-erasable |
| FRAM | No | Frequent writes, such as counters and logs |
| ROM / OTP | No | Factory boot code, keys |
| SRAM | Yes | Variables, stack, heap; fast, needs no refresh |
| DRAM | Yes | Large memory on application processors; needs refresh |
| Cache | Yes | Small, fast copy of recently used memory |

A microcontroller usually has flash and SRAM on the chip. External memory is added over SPI, QSPI or a parallel bus when more is needed.

## Where are variables stored in a C program?

The linker places each kind of object in a section, and the linker script places the sections in flash or RAM.

| Section | Contents | Lives in |
|---|---|---|
| `.text` | Code | Flash |
| `.rodata` | `const` data, string literals | Flash |
| `.data` | Globals and statics with a non-zero initialiser | RAM, with the initial values stored in flash |
| `.bss` | Globals and statics that start at zero | RAM |
| Stack | Local variables, return addresses, saved registers | RAM |
| Heap | `malloc` memory | RAM |

```c
uint32_t counter = 5;            // .data
uint32_t total;                  // .bss
const uint8_t table[] = {1, 2};  // .rodata
void f(void) {
  int local;                     // stack
  static int calls;              // .bss
}
```

Startup code copies `.data` from flash to RAM and zeroes `.bss` before `main` runs.

## What is the difference between the stack and the heap, and how do you detect a stack overflow?

The **stack** holds local variables, function arguments, return addresses and interrupt context. It is managed automatically, grows and shrinks with calls, and is fast. The **heap** holds memory requested with `malloc`; it is managed by the program and lasts until freed.

A stack overflow happens when calls nest too deep, a local array is too large, or interrupts nest. The stack then overwrites whatever is below it, and the failure appears somewhere unrelated.

Detection:

- Fill the stack with a known pattern at start-up and check how much is untouched (the high-water mark).
- Put a guard word at the end of the stack and check it periodically; RTOSes do this per task.
- Use an MPU guard region or the stack-limit register on newer Cortex-M cores to fault at the moment of overflow.
- Use the compiler's static stack-usage report (`-fstack-usage`).

Avoid recursion and large local arrays.

## What are null, dangling and wild pointers?

- **Null pointer**: deliberately points to nothing (`NULL`). Dereferencing it is undefined behaviour; on a microcontroller address 0 is often readable, so the bug may be silent.
- **Wild pointer**: never initialised, so it holds whatever was in memory.
- **Dangling pointer**: still holds the address of an object that no longer exists, because it was freed or was a local of a function that has returned.

```c
int *wild;                       // uninitialised
int *dangling(void) {
  int local = 5;
  return &local;                 // local is gone when the function returns
}
char *p = malloc(16);
free(p);
p[0] = 'x';                      // use after free
```

Prevention: initialise every pointer (to `NULL` if nothing else), set it to `NULL` after `free`, never return the address of a local, and check for `NULL` at module boundaries.

## How do you implement a software stack?

A stack is last-in, first-out. In firmware it is a fixed array and an index, with every push and pop checked.

```c run
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>

#define STACK_SIZE 4

typedef struct { int32_t items[STACK_SIZE]; uint8_t top; } stack_t;

static bool push(stack_t *s, int32_t v) {
  if (s->top == STACK_SIZE) return false;      // full
  s->items[s->top++] = v;
  return true;
}
static bool pop(stack_t *s, int32_t *out) {
  if (s->top == 0) return false;               // empty
  *out = s->items[--s->top];
  return true;
}

int main(void) {
  stack_t s = { .top = 0 };
  for (int i = 1; i <= 5; i++) printf("push %d: %d\n", i, push(&s, i));
  int32_t v;
  while (pop(&s, &v)) printf("%d ", v);
  printf("\n");
  return 0;
}
```

Uses: expression evaluation, undo, parsing nested structures, and replacing recursion with an explicit stack whose depth is bounded.
