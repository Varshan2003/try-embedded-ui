## Structs and the padding inside them

A struct groups related values into one object. Its members are stored in declaration order, but not necessarily back to back. Each type has an alignment, usually equal to its size, and the compiler inserts padding so that every member starts at a multiple of its own alignment.

```c run
#include <stdio.h>
#include <stdint.h>
#include <stddef.h>

typedef struct {
  uint8_t flags;        // offset 0, then 3 bytes of padding
  uint32_t timestamp;   // offset 4
  uint8_t channel;      // offset 8, then 1 byte of padding
  uint16_t value;       // offset 10
} sample_t;

int main(void) {
  printf("sizeof = %u\n", (unsigned)sizeof(sample_t));
  printf("offsets: flags %u, timestamp %u, channel %u, value %u\n",
         (unsigned)offsetof(sample_t, flags), (unsigned)offsetof(sample_t, timestamp),
         (unsigned)offsetof(sample_t, channel), (unsigned)offsetof(sample_t, value));
  return 0;
}
```

The members add up to 8 bytes, yet the struct takes 12:

| Offset | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Content | flags | pad | pad | pad | timestamp | timestamp | timestamp | timestamp | channel | pad | value | value |

Two rules produce any layout:

1. Each member is placed at the next offset that is a multiple of its alignment.
2. The total size is rounded up to a multiple of the largest alignment in the struct, so that arrays of it stay aligned.

Ordering members from largest to smallest removes the interior padding. Try reordering the struct above to `timestamp`, `value`, `flags`, `channel` and run it again: it shrinks to 8 bytes.

> **Pitfall:** Padding bytes hold whatever was in memory. `memcmp` on two structs, or a CRC over one, can differ even when every member is equal. Compare member by member, or `memset` the struct to zero before filling it.

## Packing

When a struct must match an external layout exactly, such as a protocol header, padding can be switched off.

```c run
#include <stdio.h>
#include <stdint.h>
#include <string.h>

typedef struct __attribute__((packed)) {
  uint8_t type;
  uint16_t length;
  uint32_t sequence;
} header_t;

int main(void) {
  const uint8_t wire[7] = { 0x02, 0x10, 0x00, 0x78, 0x56, 0x34, 0x12 };
  header_t h;
  memcpy(&h, wire, sizeof h);
  printf("sizeof = %u, type %u, length %u, sequence 0x%08X\n", (unsigned)sizeof h, h.type, h.length, h.sequence);
  return 0;
}
```

`#pragma pack(push, 1)` before the struct and `#pragma pack(pop)` after it does the same job. Packing is not free:

- Members may sit at unaligned addresses, so the compiler accesses them byte by byte, which is slower and larger.
- Taking the address of a packed member gives a misaligned pointer that can fault when dereferenced.
- The layout still depends on the CPU's byte order.

Pack only the structs that mirror an external format, and prefer explicit serialisation for anything that must be portable.

## Byte order

A multi-byte value has to be stored in some order. Little-endian puts the least significant byte at the lowest address; big-endian puts the most significant byte there. Cortex-M, x86 and RISC-V are little-endian. Network protocols, and many sensors, are big-endian.

| Value `0x12345678` stored at address `A` | `A` | `A+1` | `A+2` | `A+3` |
|---|---|---|---|---|
| Little-endian | `78` | `56` | `34` | `12` |
| Big-endian | `12` | `34` | `56` | `78` |

```c run
#include <stdio.h>
#include <stdint.h>

static uint32_t read_be32(const uint8_t *p) {
  return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3];
}

static void write_le16(uint8_t *p, uint16_t v) {
  p[0] = (uint8_t)(v & 0xFF);
  p[1] = (uint8_t)(v >> 8);
}

int main(void) {
  uint32_t word = 0x12345678;
  const uint8_t *bytes = (const uint8_t *)&word;
  printf("in memory: %02X %02X %02X %02X\n", bytes[0], bytes[1], bytes[2], bytes[3]);

  const uint8_t packet[4] = { 0x12, 0x34, 0x56, 0x78 };
  printf("read as big-endian: 0x%08X\n", read_be32(packet));

  uint8_t out[2];
  write_le16(out, 0xABCD);
  printf("0xABCD little-endian: %02X %02X\n", out[0], out[1]);
  return 0;
}
```

Shifts and masks describe the format in terms of values, so the same code is correct on any CPU, at any alignment, with any padding. That is why it is preferred over casting a buffer to a struct pointer.

## Unions

A union stores all its members in the same bytes. Its size is that of its largest member. It has two uses.

**Reinterpreting bytes.** Write one member, read another:

```c run
#include <stdio.h>
#include <stdint.h>

typedef union {
  float f;
  uint32_t bits;
  uint8_t bytes[4];
} float_view_t;

int main(void) {
  float_view_t v;
  v.f = 1.0f;
  printf("1.0f is 0x%08X, bytes %02X %02X %02X %02X\n", v.bits, v.bytes[0], v.bytes[1], v.bytes[2], v.bytes[3]);
  return 0;
}
```

A cast would not do this: `(uint32_t)1.0f` converts the value and gives 1. Reading a union member other than the one last written is allowed in C. `memcpy` is the other correct way, and the only one that is also valid in C++.

**Saving memory with a tagged union.** When an object holds one of several kinds of data, a tag says which union member is valid. This is how a fixed-size queue item carries different message types.

```c run
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>

typedef enum { MSG_TEMP, MSG_BUTTON } msg_type_t;

typedef struct {
  msg_type_t type;
  union {
    int16_t temp_tenths;
    struct { uint8_t id; bool pressed; } button;
  } data;
} message_t;

static void handle(const message_t *m) {
  switch (m->type) {
    case MSG_TEMP:   printf("temperature %d.%d\n", m->data.temp_tenths / 10, m->data.temp_tenths % 10); break;
    case MSG_BUTTON: printf("button %u %s\n", m->data.button.id, m->data.button.pressed ? "down" : "up"); break;
    default:         printf("unknown message\n"); break;
  }
}

int main(void) {
  message_t a = { .type = MSG_TEMP, .data.temp_tenths = 235 };
  message_t b = { .type = MSG_BUTTON, .data.button = { 2, true } };
  handle(&a);
  handle(&b);
  printf("sizeof(message_t) = %u\n", (unsigned)sizeof(message_t));
  return 0;
}
```

## Bit-fields

A bit-field is a struct member with a width in bits. Overlaid on a register with a union, it gives named access to each field.

```c run
#include <stdio.h>
#include <stdint.h>

typedef union {
  uint8_t raw;
  struct {
    uint8_t enable    : 1;   // bit 0
    uint8_t mode      : 3;   // bits 3..1
    uint8_t prescaler : 2;   // bits 5..4
    uint8_t           : 1;   // bit 6, reserved
    uint8_t irq       : 1;   // bit 7
  } bits;
} ctrl_t;

int main(void) {
  ctrl_t c = { .raw = 0 };
  c.bits.enable = 1;
  c.bits.mode = 5;
  c.bits.irq = 1;
  printf("raw = 0x%02X\n", c.raw);

  c.raw = 0x34;
  printf("mode = %u, prescaler = %u\n", c.bits.mode, c.bits.prescaler);
  return 0;
}
```

Bit-fields read well, and they come with caveats that every interviewer expects you to know:

- The order in which fields are allocated within a unit, and whether a field may cross a unit boundary, are implementation-defined. The layout above is what GCC and Clang produce for little-endian Arm; another compiler may differ.
- You cannot take the address of a bit-field.
- Assigning one is still a read-modify-write of the whole unit, so it is not atomic, and it is wrong for write-1-to-clear registers.

For these reasons portable drivers, including CMSIS, use masks and shifts for hardware registers and keep bit-fields for internal data.

## Passing structs around

Structs are copied when assigned, passed or returned by value. A 4-byte struct travels in a register and costs nothing. A 200-byte struct is copied onto the stack on every call, and a small MCU may have only a few hundred bytes of stack.

Pass a pointer, and make it `const` if the function only reads:

```c
void motor_configure(const motor_config_t *config);   // no copy, cannot modify
```

C allows `a = b` for structs, and nothing else: there is no `==`. Compare the members yourself.

## Common mistakes

- Assuming `sizeof(struct)` is the sum of its members.
- Sending a struct over a link with `memcpy`, which bakes padding, byte order and one compiler's layout into the protocol.
- Using a bit-field layout on a different compiler or a big-endian target.
- Reading the wrong member of a tagged union.
- Forgetting that `sizeof` a struct with a flexible array member excludes the array.

```quiz
Q: What is `sizeof(struct { uint8_t a; uint32_t b; uint8_t c; })` on a 32-bit target?
- 6
- 8
* 12
Why: `a` at 0, three bytes of padding, `b` at 4, `c` at 8, then three bytes of tail padding so the size is a multiple of 4.
```

```quiz
Q: A `uint32_t` holding `0x0A0B0C0D` is stored on a little-endian CPU. Which byte is at the lowest address?
- `0x0A`
* `0x0D`
- It depends on the alignment
Why: Little-endian stores the least significant byte first.
```

```ask
Q: How do you find out at run time whether the CPU is little-endian?
A: Store a known multi-byte value and look at its first byte: `uint16_t x = 1; bool little = *(uint8_t *)&x == 1;`. Inspecting an object through an `unsigned char` pointer is always allowed. In practice the byte order is known at compile time, and well-written code avoids depending on it by serialising with shifts.
```

```ask
Q: When would you use a packed struct, and what are the risks?
A: When a struct must match an externally defined layout byte for byte, such as a file header or a wire format on a known architecture. The risks are unaligned member access (slower code, and a fault if a member's address is taken and dereferenced on a core that requires alignment), dependence on the host's byte order, and reliance on a compiler extension. For portable code, serialise each field explicitly.
```
