## Hardware is just memory

A microcontroller's peripherals are controlled through registers: fixed addresses that the hardware watches. Writing to address `0x40020014` on an STM32F4 does not store a value in RAM. It drives the pins of port A. Reading `0x40020010` returns the voltage levels on those pins.

This is called memory-mapped I/O. C reaches a register by turning its address into a pointer and dereferencing it.

```c run
#include <stdio.h>
#include <stdint.h>

#define GPIOA_ODR (*(volatile uint32_t *)0x40020014u)

int main(void) {
  GPIOA_ODR = 0;
  GPIOA_ODR |= (1u << 5);       // drive PA5 high
  printf("ODR = 0x%08X\n", GPIOA_ODR);
  GPIOA_ODR &= ~(1u << 5);      // drive PA5 low
  printf("ODR = 0x%08X\n", GPIOA_ODR);
  return 0;
}
```

Read the macro from the inside out: `0x40020014u` is a number, the cast makes it a pointer to a `volatile uint32_t`, and the outer `*` dereferences it. The result behaves like a variable that lives at that address. In this simulator the peripheral region is plain readable and writable memory, so you can exercise register code and inspect what it wrote.

## Why volatile

The compiler assumes that memory only changes when your code changes it. For a register that is false in both directions: hardware changes it, and writing it has effects the compiler cannot see. `volatile` tells the compiler that every read and every write in the source must happen, in order, exactly once.

Without `volatile`, an optimiser is entitled to make these transformations:

| You wrote | The optimiser may produce | Consequence |
|---|---|---|
| `while (!(STATUS & READY)) { }` | Read `STATUS` once, then loop forever or never | Hangs, or skips the wait |
| `DATA = 0x01; DATA = 0x02;` | Only the second write | The device never sees the first byte |
| `(void)STATUS;` to clear a flag by reading | Nothing | The flag is never cleared |

Three kinds of object need `volatile`:

1. Memory-mapped registers.
2. Variables shared between an interrupt handler and the main code.
3. Variables modified by something outside the program flow, such as a debugger or DMA.

> **Pitfall:** `volatile` does not make an operation atomic. `counter++` on a volatile variable is still a read, an add and a write, and an interrupt can run in the middle.

`const volatile` is meaningful and common: a read-only status register that the hardware changes. The program may not write it, and every read must really happen.

## Describing a peripheral with a struct

A peripheral has several registers at consecutive addresses. Rather than one macro per register, lay a struct over the block and point it at the base address. This is how the CMSIS headers shipped by every Arm vendor are written.

```c run
#include <stdio.h>
#include <stdint.h>
#include <stddef.h>

typedef struct {
  volatile uint32_t MODER;    // 0x00
  volatile uint32_t OTYPER;   // 0x04
  volatile uint32_t OSPEEDR;  // 0x08
  volatile uint32_t PUPDR;    // 0x0C
  volatile uint32_t IDR;      // 0x10
  volatile uint32_t ODR;      // 0x14
  volatile uint32_t BSRR;     // 0x18
} gpio_t;

#define GPIOA ((gpio_t *)0x40020000u)

int main(void) {
  GPIOA->MODER = (GPIOA->MODER & ~(3u << 10)) | (1u << 10);   // PA5 as an output
  GPIOA->ODR |= (1u << 5);

  printf("ODR is at offset 0x%02X\n", (unsigned)offsetof(gpio_t, ODR));
  printf("MODER = 0x%08X, ODR = 0x%08X\n", GPIOA->MODER, GPIOA->ODR);
  return 0;
}
```

The struct only works if each member lands on the documented offset. When the datasheet skips addresses, fill the gap with a reserved member, and pin the layout down so a mistake fails to compile:

```c
typedef struct {
  volatile uint32_t CR1;     // 0x00
  volatile uint32_t CR2;     // 0x04
  uint32_t RESERVED0[2];     // 0x08, 0x0C
  volatile uint32_t SR;      // 0x10
} timer_regs_t;

_Static_assert(offsetof(timer_regs_t, SR) == 0x10, "SR offset");
```

## Read-modify-write and how it goes wrong

`reg |= mask` is three operations: read the register, change the value, write it back. Two problems follow.

**Lost updates.** If an interrupt changes the same register between the read and the write, the write puts back the old value of the bits the interrupt changed. Its update is lost. This is the most common race condition in firmware, and it is intermittent, because it depends on an interrupt arriving in a window a few instructions wide.

**Registers that are not plain storage.** Read-modify-write assumes that writing back what you read is harmless. For many registers it is not.

| Access type | Behaviour | Correct way to clear bit `n` |
|---|---|---|
| Read/write (`rw`) | Stores what you write | `reg &= ~(1u << n)` |
| Write 1 to clear (`rc_w1`) | Writing 1 clears the flag; writing 0 does nothing | `reg = (1u << n)` |
| Write 0 to clear (`rc_w0`) | Writing 0 clears; writing 1 does nothing | `reg = ~(1u << n)` |
| Read to clear | Reading the register clears it | Read it once and keep the value |
| Write only | Reads return zero or garbage | Never use `\|=` or `&=` |

```c run
#include <stdio.h>
#include <stdint.h>

int main(void) {
  // Pretend this is a write-1-to-clear status register with four flags pending.
  uint32_t written;

  uint32_t sr = 0x0F;
  sr |= (1u << 1);              // WRONG: writes 1 to every pending flag
  written = sr;
  printf("with |= the bus sees 0x%02X: all four flags are acknowledged\n", written);

  sr = (1u << 1);               // RIGHT: a single 1, zeros elsewhere
  written = sr;
  printf("with =  the bus sees 0x%02X: only flag 1 is acknowledged\n", written);
  return 0;
}
```

## Atomic set and clear registers

To avoid read-modify-write on outputs, many MCUs provide registers where only the 1 bits act. On STM32, writing a 1 to bit `n` of `BSRR` sets pin `n`, and writing a 1 to bit `n + 16` resets it. Zeros do nothing.

```c
GPIOA->BSRR = (1u << 5);        // set PA5: one write, nothing to interrupt
GPIOA->BSRR = (1u << (5 + 16)); // reset PA5
```

There is no read, so there is nothing to lose. Use these registers whenever a port is shared between interrupt and main code.

## Waiting for hardware

Hardware takes time, so drivers wait for status bits. Every wait needs an exit, or one faulty peripheral hangs the product.

```c run
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>

#define UART_SR  (*(volatile uint32_t *)0x40011000u)
#define UART_TXE (1u << 7)

static bool wait_tx_ready(uint32_t max_polls) {
  while (max_polls--) {
    if (UART_SR & UART_TXE) return true;
  }
  return false;                 // let the caller decide what a timeout means
}

int main(void) {
  UART_SR = 0;
  printf("never ready: %d\n", wait_tx_ready(1000));
  UART_SR = UART_TXE;
  printf("ready:       %d\n", wait_tx_ready(1000));
  return 0;
}
```

A poll count is a crude timeout, because its duration depends on the clock and the optimisation level. Production code compares a tick counter instead; the timing guide shows how to do that safely.

## Common mistakes

- Forgetting `volatile` on a register or on a flag shared with an interrupt.
- Using `|=` on a write-1-to-clear or write-only register.
- Writing a field in two steps (clear, then set) so the register briefly holds an invalid value.
- Configuring a peripheral before its clock is enabled. Writes to an unclocked peripheral are ignored.
- Assuming a register reads back what was written. Many bits are reserved, self-clearing or read-only.

```quiz
Q: A status register is write-1-to-clear and currently reads `0x05`. Which statement clears only bit 0?
- `SR &= ~1u;`
- `SR |= 1u;`
* `SR = 1u;`
Why: `&=` writes back `0x04`, which clears bit 2 and leaves bit 0 set. `|=` writes `0x05` and clears both. A plain assignment writes a single 1.
```

```quiz
Q: What does `volatile` guarantee?
* Every read and write in the source is performed, in order
- The access is atomic
- The variable is stored in RAM rather than a register
Why: `volatile` only stops the compiler from removing, merging or reordering accesses. It says nothing about atomicity.
```

```ask
Q: Explain `*(volatile uint32_t *)0x40021000 = 1;` piece by piece.
A: `0x40021000` is an integer. `(volatile uint32_t *)` casts it to a pointer to a 32-bit unsigned value that may change outside the compiler's knowledge. The leading `*` dereferences that pointer, so the assignment performs one 32-bit write of the value 1 to that address. `volatile` guarantees the write is emitted even if the compiler cannot see anything reading it.
```

```ask
Q: Can a variable be both `const` and `volatile`? Give an example.
A: Yes. `const` means this code may not write it; `volatile` means its value can change anyway and every read must be performed. A read-only hardware status register is the standard example: `#define STATUS (*(const volatile uint32_t *)0x40011000u)`.
```
