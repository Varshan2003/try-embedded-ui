## From bytes to messages

A UART, an SPI bus or a radio delivers a stream of bytes. Turning that stream into messages you can trust takes three steps, and every protocol is some combination of them:

1. **Framing:** finding where a message starts and ends.
2. **Integrity:** detecting that the message was corrupted on the way.
3. **Encoding:** agreeing on what the bytes mean, including byte order.

## Byte order on the wire

A protocol document fixes the order in which the bytes of a multi-byte field are sent. Network protocols use big-endian (most significant byte first). Many device protocols, including USB and Bluetooth LE, use little-endian. The CPU's own byte order should never leak into the format.

```c run
#include <stdio.h>
#include <stdint.h>

static void put_be16(uint8_t *p, uint16_t v) { p[0] = (uint8_t)(v >> 8); p[1] = (uint8_t)v; }
static void put_le32(uint8_t *p, uint32_t v) {
  for (int i = 0; i < 4; i++) p[i] = (uint8_t)(v >> (8 * i));
}
static uint16_t get_be16(const uint8_t *p) { return (uint16_t)((p[0] << 8) | p[1]); }

int main(void) {
  uint8_t frame[6];
  put_be16(frame, 0x1234);
  put_le32(frame + 2, 0xAABBCCDD);
  for (int i = 0; i < 6; i++) printf("%02X ", frame[i]);
  printf("\nfirst field read back: 0x%04X\n", get_be16(frame));
  return 0;
}
```

Building and reading fields with shifts works on any CPU, at any alignment. Casting the buffer to a struct pointer does not.

## Checksums

A checksum is a short value computed from the data and sent with it. The receiver recomputes it and compares.

| Check | How | Detects | Misses |
|---|---|---|---|
| Parity bit | XOR of the bits | Any odd number of flipped bits | Any even number |
| XOR of bytes | XOR every byte | Any single-bit error | Two errors in the same bit position; reordered bytes |
| Additive (sum, two's complement) | Sum of the bytes modulo 256 | Any single-bit error | Reordered bytes; errors that cancel |
| CRC | Polynomial division | All burst errors up to its width, and almost everything else | About 1 in 2^N random corruptions |

```c run
#include <stdio.h>
#include <stdint.h>
#include <stddef.h>

static uint8_t xor_checksum(const uint8_t *d, size_t n) {
  uint8_t c = 0;
  while (n--) c ^= *d++;
  return c;
}

static uint8_t sum_checksum(const uint8_t *d, size_t n) {
  uint8_t s = 0;
  while (n--) s = (uint8_t)(s + *d++);
  return (uint8_t)(0u - s);          // chosen so that data plus checksum sums to 0
}

int main(void) {
  const uint8_t good[] = { 0x10, 0x20, 0x30 };
  const uint8_t swapped[] = { 0x20, 0x10, 0x30 };      // two bytes exchanged in transit
  printf("xor: %02X vs %02X\n", xor_checksum(good, 3), xor_checksum(swapped, 3));
  printf("sum: %02X vs %02X\n", sum_checksum(good, 3), sum_checksum(swapped, 3));
  return 0;
}
```

Both simple checksums give the same result for the swapped data, so the error goes unnoticed. That is why real links use a CRC.

## CRC

A CRC treats the message as one long binary number and computes the remainder of dividing it by a fixed polynomial, using XOR in place of subtraction. In code it is a shift register: for each bit, shift, and XOR in the polynomial whenever a 1 falls out.

A CRC is not one algorithm but a family. Two implementations agree only if all of these match:

| Parameter | Meaning | CRC-8 (SMBus) | CRC-16 (Modbus) |
|---|---|---|---|
| Width | Bits in the result | 8 | 16 |
| Polynomial | The divisor | `0x07` | `0x8005`, used reflected as `0xA001` |
| Initial value | Starting contents of the register | `0x00` | `0xFFFF` |
| Reflection | Whether bits are processed LSB first | no | yes |
| Final XOR | Applied to the result | `0x00` | `0x0000` |
| Check value | CRC of the ASCII text `123456789` | `0xF4` | `0x4B37` |

```c run
#include <stdio.h>
#include <stdint.h>
#include <stddef.h>

static uint8_t crc8(const uint8_t *data, size_t n) {
  uint8_t crc = 0x00;
  for (size_t i = 0; i < n; i++) {
    crc ^= data[i];
    for (int bit = 0; bit < 8; bit++) {
      crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x07) : (uint8_t)(crc << 1);
    }
  }
  return crc;
}

int main(void) {
  const uint8_t msg[] = "123456789";
  uint8_t crc = crc8(msg, 9);
  printf("CRC-8 of \"123456789\" = 0x%02X\n", crc);

  uint8_t framed[10];
  for (int i = 0; i < 9; i++) framed[i] = msg[i];
  framed[9] = crc;
  printf("CRC over data plus its CRC = 0x%02X\n", crc8(framed, 10));
  return 0;
}
```

Two properties to remember. Every published CRC has a check value for the input `123456789`; if yours matches, the parameters are right. And running the CRC over the data followed by its own CRC gives a constant (zero for these variants), so a receiver can validate a whole frame in a single pass.

The bit-by-bit loop costs eight iterations per byte. A 256-entry lookup table reduces that to one XOR and one table read per byte, at the price of 256 or 512 bytes of flash. Many MCUs also have a CRC peripheral.

## Framing

The receiver needs to know where a message begins. These are the common schemes.

| Scheme | Example | Strength | Weakness |
|---|---|---|---|
| Delimiter characters | NMEA: `$` ... `*hh\r\n` | Human-readable, self-synchronising | Only for text |
| Start byte and length | `7E len payload checksum` | Simple and compact | A start byte inside the payload can cause a false sync |
| Byte stuffing | SLIP, HDLC, PPP | Delimiter never appears in the data | Worst-case size doubles |
| COBS | Many modern serial links | At most 1 byte of overhead per 254 | Slightly more code |
| Silence between frames | Modbus RTU (3.5 character times) | No overhead bytes | Needs accurate timing |

### Byte stuffing

If a reserved byte appears in the data, replace it with an escape sequence. SLIP uses `0xC0` as the end marker and `0xDB` as the escape:

```c run
#include <stdio.h>
#include <stdint.h>
#include <stddef.h>

#define END 0xC0
#define ESC 0xDB

static size_t slip_encode(const uint8_t *in, size_t n, uint8_t *out) {
  size_t w = 0;
  for (size_t i = 0; i < n; i++) {
    if (in[i] == END)      { out[w++] = ESC; out[w++] = 0xDC; }
    else if (in[i] == ESC) { out[w++] = ESC; out[w++] = 0xDD; }
    else out[w++] = in[i];
  }
  out[w++] = END;
  return w;
}

int main(void) {
  const uint8_t packet[] = { 0x01, 0xC0, 0x02, 0xDB };
  uint8_t out[10];
  size_t n = slip_encode(packet, sizeof packet, out);
  for (size_t i = 0; i < n; i++) printf("%02X ", out[i]);
  printf("\n");
  return 0;
}
```

## Parsing a stream one byte at a time

Bytes arrive one at a time, usually in an interrupt, and a frame may be split across any number of them. A parser therefore cannot be written as "read the header, then read the payload". It must be a state machine that takes one byte, updates its state and returns.

```c run
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>

#define MAX_PAYLOAD 8
typedef enum { WAIT_START, WAIT_LEN, READ_PAYLOAD, WAIT_CHECKSUM } state_t;
typedef struct { state_t state; uint8_t len, index, checksum, payload[MAX_PAYLOAD]; } parser_t;

static bool feed(parser_t *p, uint8_t byte) {
  switch (p->state) {
    case WAIT_START:
      if (byte == 0x7E) p->state = WAIT_LEN;
      break;
    case WAIT_LEN:
      if (byte > MAX_PAYLOAD) { p->state = WAIT_START; break; }   // never trust a length
      p->len = byte; p->index = 0; p->checksum = byte;
      p->state = byte ? READ_PAYLOAD : WAIT_CHECKSUM;
      break;
    case READ_PAYLOAD:
      p->payload[p->index++] = byte;
      p->checksum ^= byte;
      if (p->index == p->len) p->state = WAIT_CHECKSUM;
      break;
    case WAIT_CHECKSUM:
      p->state = WAIT_START;
      return byte == p->checksum;
  }
  return false;
}

int main(void) {
  parser_t p = { 0 };
  const uint8_t stream[] = { 0xFF, 0x7E, 0x02, 0xAA, 0xBB, 0x13, 0x7E, 0x01, 0x55, 0x00 };
  for (unsigned i = 0; i < sizeof stream; i++) {
    if (feed(&p, stream[i])) printf("frame of %u bytes accepted at stream byte %u\n", p.len, i);
  }
  printf("the second frame had a bad checksum and was dropped\n");
  return 0;
}
```

Notice what protects the buffer: the length is checked against `MAX_PAYLOAD` before a single payload byte is stored. A length field taken from the wire and used without a bounds check is the most common remote memory-corruption bug in embedded software.

A production parser adds a timeout that returns to `WAIT_START` when a frame stalls, so that one lost byte does not swallow the frame that follows.

## The serial buses in one table

| | UART | I2C | SPI |
|---|---|---|---|
| Wires | TX, RX | SDA, SCL | SCK, MOSI, MISO, one CS per device |
| Clock | None; both sides agree on a baud rate | Controller drives SCL | Controller drives SCK |
| Addressing | None; point to point | 7-bit address in the first byte | Chip-select line |
| Typical speed | 9600 to 1 Mbit/s | 100 kbit/s, 400 kbit/s | 1 to 50 Mbit/s |
| Error detection | Optional parity; framing errors | ACK/NACK per byte | None |
| Watch out for | Baud mismatch above about 2 percent | Missing pull-ups; shifted vs unshifted address | Clock polarity and phase (the four modes) |

A UART frame is a start bit (low), the data bits least significant first, an optional parity bit and a stop bit (high). The first byte of an I2C transfer is the 7-bit address shifted left by one, with the read/write flag in bit 0.

## Common mistakes

- Sending a struct with `memcpy` and calling it a protocol.
- Trusting a received length before checking it against the buffer.
- Computing a CRC with the right polynomial and the wrong initial value or bit order.
- Sending the two bytes of a 16-bit CRC in the wrong order.
- A parser with no way back to its idle state after a damaged frame.

```quiz
Q: Two bytes of a message are swapped in transit. Which check is guaranteed to notice?
- XOR of all bytes
- Sum of all bytes
* A CRC
Why: XOR and addition do not depend on the order of the bytes. A CRC does, because each byte's contribution depends on its position.
```

```quiz
Q: A parser receives a length byte of 200, but its payload buffer holds 64 bytes. What should it do?
- Store the first 64 bytes and ignore the rest
* Reject the frame and return to waiting for a start byte
- Allocate a bigger buffer
Why: A length that cannot be valid means the frame is corrupt or hostile. Dropping it and resynchronising is the only safe response.
```

```ask
Q: You get the wrong CRC for a known-good message. What do you check?
A: Run the algorithm on the ASCII string `123456789` and compare with the published check value for the variant. If it differs, one of the parameters is wrong: the polynomial (and whether it is the reflected form), the initial value, whether input and output are bit-reflected, or the final XOR. If the check value matches, the problem is in which bytes are covered or in the byte order in which the CRC is transmitted.
```

```ask
Q: Why is a start byte alone not enough for reliable framing?
A: The same byte value can occur inside the payload, so a receiver that joins mid-stream, or loses a byte, can lock on to a false start. Reliable schemes make the delimiter impossible in the data (byte stuffing or COBS), or combine a start byte with a length and a strong checksum and resynchronise when the check fails. A timeout is also needed, so a frame that never completes does not block the parser.
```
