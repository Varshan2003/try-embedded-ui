# Bits, registers and memory-mapped I/O

## How do you perform bitwise operations?

C has six bitwise operators: `&` (AND), `|` (OR), `^` (XOR), `~` (NOT), `<<` and `>>` (shifts). Four idioms built on a mask cover almost all register code.

```c run
#include <stdio.h>
#include <stdint.h>

int main(void) {
  uint8_t reg = 0x00;

  reg |= (1u << 3);                    // set bit 3
  reg |= (1u << 0) | (1u << 7);        // set several
  reg &= (uint8_t)~(1u << 0);          // clear bit 0
  reg ^= (1u << 7);                    // toggle bit 7
  printf("0x%02X bit3=%d\n", reg, (reg & (1u << 3)) != 0);   // test bit 3

  // A multi-bit field: 3 bits at position 4
  reg = (uint8_t)((reg & ~(0x7u << 4)) | ((5u & 0x7u) << 4));   // clear the field, then insert
  printf("0x%02X field=%u\n", reg, (reg >> 4) & 0x7u);
  return 0;
}
```

Use unsigned operands (`1u`, not `1`), and cast the result of `~` back to the narrow type, because integer promotion widens it to `int`.

## What are the advantages of bit manipulation?

- **It is how hardware is controlled.** Each bit of a register enables, selects or reports something, and one bit must be changed without disturbing its neighbours.
- **Memory.** Eight flags fit in one byte instead of eight.
- **Speed.** Bitwise operations are single instructions. Shifts replace multiplication and division by powers of two, and `x & (n - 1)` replaces `x % n` when `n` is a power of two.
- **Compact protocols.** Fields are packed into bytes to save bandwidth.
- **Algorithms.** Checksums, CRCs, parity, bitmaps of free resources and set operations are all built on it.

The cost is readability, so wrap the operations in named macros or inline functions.

## How do you perform memory-mapped I/O?

On most microcontrollers the peripheral registers appear at fixed addresses in the same address space as memory. Reading or writing that address reads or writes the hardware. In C, cast the address to a pointer to a `volatile` type and dereference it.

```c run
#include <stdio.h>
#include <stdint.h>

#define GPIOA_ODR (*(volatile uint32_t *)0x40020014u)   // one register

typedef struct {                                         // a whole peripheral
  volatile uint32_t MODER, OTYPER, OSPEEDR, PUPDR, IDR, ODR;
} gpio_t;
#define GPIOA ((gpio_t *)0x40020000u)

int main(void) {
  GPIOA_ODR |= (1u << 5);          // set pin 5
  GPIOA->ODR &= ~(1u << 0);        // the same register through the struct
  printf("0x%08X\n", GPIOA->ODR);
  return 0;
}
```

`volatile` is essential: it stops the compiler from caching a read or dropping a write. The addresses and bit meanings come from the device's reference manual; vendors ship headers that define them.

## What are memory-mapped peripherals?

A memory-mapped peripheral is a hardware block (a timer, a UART, a GPIO port) whose control, status and data registers are reached at addresses in the processor's normal address space. The same load and store instructions used for RAM are used for the hardware.

The alternative is port-mapped I/O, where devices sit in a separate I/O address space reached with special instructions (`in` and `out` on x86). ARM, RISC-V and most microcontrollers are memory-mapped only.

Each peripheral has a base address, and its registers are at fixed offsets from it:

| Region (a typical Cortex-M) | Start address |
|---|---|
| Flash | 0x0800 0000 |
| SRAM | 0x2000 0000 |
| Peripherals | 0x4000 0000 |
| Core peripherals (NVIC, SysTick) | 0xE000 0000 |

## What is direct addressing of a memory-mapped register?

Direct addressing means the register's address is a constant known at compile time, written into the code.

```c
#define TIM2_CNT (*(volatile uint32_t *)0x40000024u)

uint32_t now = TIM2_CNT;      // the compiler emits a load from a fixed address
```

It is the fastest form, since the address is a literal, and it is what vendor headers produce. Its limit is that the code is tied to one instance of the peripheral: a function written against `TIM2_CNT` cannot serve `TIM3`. That is what indirect addressing solves.

## What is indirect addressing of a memory-mapped register?

Indirect addressing reaches the register through a pointer held in a variable, so the same code can serve any instance of a peripheral.

```c
typedef struct { volatile uint32_t SR, DR, BRR, CR1; } usart_t;

#define USART1 ((usart_t *)0x40011000u)
#define USART2 ((usart_t *)0x40004400u)

void uart_send(usart_t *port, uint8_t byte) {      // works for every UART
  while (!(port->SR & (1u << 7))) { }              // wait until the transmit register is empty
  port->DR = byte;
}

uart_send(USART2, 'A');
```

The CPU holds the base address in a register and adds a fixed offset for each member. This is the basis of reusable drivers: the driver takes a pointer to the peripheral, usually inside a handle struct.

## What is bank switching?

Bank switching extends a small address space by mapping different blocks ("banks") of memory or registers into the same address range, selected by writing a bank-select register. It is found on 8-bit microcontrollers such as PIC and 8051 families and in some paged flash and external memory schemes.

```c
BANK_SELECT = 1;          // map bank 1 into the window
value = WINDOW[0x10];     // this address now means "bank 1, offset 0x10"
BANK_SELECT = 0;          // restore
```

Points to watch: the same address means different things depending on the selected bank, so an interrupt that changes the bank must save and restore it, and code that forgets to switch reads the wrong data silently. 32-bit microcontrollers have a flat address space and do not need it.

## How do you access memory-mapped registers safely?

- Declare them `volatile`, with the exact width (`uint32_t` on a 32-bit peripheral bus).
- Respect each register's access type from the datasheet:

| Type | Meaning | Consequence |
|---|---|---|
| Read/write | Normal | `\|=` and `&=` are fine |
| Read-only | Status | Writes are ignored |
| Write-only | Reads return nothing useful | Never use `\|=`; keep a shadow copy |
| Write-1-to-clear | Writing 1 clears a flag | Write only the bits to clear, with `=` |
| Clear-on-read | Reading clears flags | Read once into a variable |

- A read-modify-write is not atomic. If an ISR touches the same register, protect the sequence or use the device's set/clear registers.
- Keep reserved bits at their reset value.
- Use named masks, not magic numbers.

## How do you access memory-mapped ports?

A port is a group of pins controlled together through a few registers: a direction or mode register, an output register and an input register.

```c
typedef struct { volatile uint32_t MODER, OTYPER, OSPEEDR, PUPDR, IDR, ODR, BSRR; } gpio_t;
#define GPIOB ((gpio_t *)0x40020400u)

GPIOB->MODER = (GPIOB->MODER & ~(3u << (2 * 7))) | (1u << (2 * 7));   // pin 7 as output
GPIOB->ODR = (GPIOB->ODR & ~0xFFu) | 0x5Au;                           // write 8 pins at once
uint16_t inputs = (uint16_t)GPIOB->IDR;                               // read the whole port
```

Writing a whole port at once updates several pins at the same instant, which matters for parallel buses. On an 8-bit AVR the same idea uses `DDRx`, `PORTx` and `PINx`.

## How do you access memory-mapped devices in a generic way?

Describe each device by a base address and a register layout, and write the driver against a pointer to that layout. The board file supplies the addresses.

```c
typedef struct { volatile uint32_t CTRL, STATUS, DATA; } dev_regs_t;

typedef struct {
  dev_regs_t *regs;     // where this instance lives
  uint8_t irq;          // its interrupt number
} device_t;

static const device_t sensor_a = { (dev_regs_t *)0x40010000u, 12 };

uint32_t device_read(const device_t *dev) {
  while (!(dev->regs->STATUS & 1u)) { }
  return dev->regs->DATA;
}
```

On a system with an MMU and an operating system, physical addresses are not directly reachable: a driver maps the device into virtual memory first (`ioremap` in a Linux kernel driver, `mmap` of a device file from user space).

## How do you work with memory-mapped buffers?

Some peripherals expose a block of memory rather than a few registers: a display frame buffer, a CAN or USB message RAM, or a FIFO window. It is reached through a pointer to a `volatile` array.

```c
#define RX_FIFO ((volatile uint8_t *)0x40030000u)
#define RX_LEVEL (*(volatile uint32_t *)0x40030100u)

uint32_t drain(uint8_t *out, uint32_t max) {
  uint32_t n = RX_LEVEL < max ? RX_LEVEL : max;
  for (uint32_t i = 0; i < n; i++) out[i] = RX_FIFO[i];   // copy element by element
  return n;
}
```

Do not use `memcpy` on a device buffer unless the documentation allows it: the library may use access widths or an order the hardware does not expect. For buffers shared with DMA, respect alignment and cache rules.

## How do memory-mapped files relate to embedded systems?

A memory-mapped file is an operating-system feature: `mmap` makes the contents of a file appear as a region of memory, so the file is read and written with pointers instead of `read` and `write` calls. It needs an MMU and a virtual memory system, so it exists on embedded Linux and similar systems, not on bare-metal microcontrollers.

```c
int fd = open("/data/log.bin", O_RDWR);
uint8_t *p = mmap(NULL, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
p[0] = 0x42;                 // changes the file
msync(p, size, MS_SYNC);     // force it to storage
munmap(p, size);
close(fd);
```

On a microcontroller the nearest equivalents are execute-in-place flash, where a QSPI flash chip is mapped into the address space and read like memory, and a file system library accessed through function calls.

## How do you use memory-mapped files to reach hardware on embedded Linux?

On Linux a user program cannot touch physical addresses directly. Mapping a device file gives it a pointer to the hardware.

```c
int fd = open("/dev/mem", O_RDWR | O_SYNC);
volatile uint32_t *gpio = mmap(NULL, 4096, PROT_READ | PROT_WRITE, MAP_SHARED, fd, GPIO_BASE);
gpio[OUTPUT_SET / 4] = 1u << 17;       // drive a pin
munmap((void *)gpio, 4096);
close(fd);
```

`/dev/mem` needs root and bypasses the kernel's drivers, so it is suitable for bring-up and experiments only. The supported routes are a kernel driver, the UIO framework (which exposes one device's registers and interrupt to user space), or the standard interfaces such as the GPIO character device, `spidev` and `i2c-dev`.

## What is the risk in a read-modify-write of a register?

`reg |= mask` is three steps: read the register, change the value, write it back. If an interrupt runs between the read and the write and changes the same register, the write puts back the stale value and the interrupt's change is lost.

```c
GPIOA->ODR |= (1u << 5);     // main code
// an ISR that does GPIOA->ODR |= (1u << 6) here can be undone by the write above
```

Fixes:

- Use the atomic set and clear registers many devices provide (`BSRR` on STM32 GPIO), which change only the bits written as 1.
- Disable interrupts around the sequence.
- Use bit-banding where the core supports it.

A related trap is the write-1-to-clear status register: `STATUS |= FLAG` reads all the pending flags and writes them all back as 1, clearing every one. Write `STATUS = FLAG` instead.
