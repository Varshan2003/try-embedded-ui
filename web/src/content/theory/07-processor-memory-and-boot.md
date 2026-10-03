# Processor, memory hardware and boot

## What is the role of the stack pointer?

The stack pointer (SP) is a CPU register holding the address of the top of the stack. Pushing data moves it one way and popping moves it back; on ARM and most CPUs the stack grows towards lower addresses.

The stack holds return addresses, saved registers, local variables and, when an interrupt occurs, the interrupted code's context. Each function call adjusts SP on entry to make room for its frame and restores it on exit.

On a Cortex-M the initial SP value is the first word of the vector table and is loaded by hardware at reset, which is why C code can run almost immediately. There are two stack pointers: MSP, used by exception handlers and at start-up, and PSP, which an RTOS uses to give each task its own stack.

## What is the role of the program counter?

The program counter (PC) holds the address of the next instruction to execute. After each instruction is fetched it advances; a branch, call, return or interrupt loads it with a new address.

- A **function call** saves the return address (in the link register on ARM, on the stack on other CPUs) and loads the PC with the function's address.
- A **return** puts the saved address back into the PC.
- An **interrupt** saves the PC with the rest of the context and loads the handler's address from the vector table.
- At **reset** the PC is loaded from the reset vector.

In debugging, the PC value stacked by a fault handler shows which instruction caused the fault, and the map file or debugger turns that address into a line of source.

## What is the role of the status register?

The CPU's status register records the outcome of the last operation and the current processor state. Conditional branches read it.

The condition flags:

| Flag | Set when |
|---|---|
| N (negative) | The result's top bit is 1 |
| Z (zero) | The result is zero |
| C (carry) | An unsigned operation overflowed or did not borrow |
| V (overflow) | A signed operation overflowed |

It also holds state bits such as the interrupt mask, the processor mode, and on Cortex-M the number of the exception being handled. On Cortex-M it is called the program status register (xPSR); on AVR it is SREG, which contains the global interrupt enable bit. The register is saved when an interrupt is taken and restored on return, so the interrupted code never notices.

Peripherals have status registers too, holding their event and error flags.

## What is the role of the system control register?

A system control register configures the processor core itself rather than a peripheral. On ARM Cortex-M these live in the System Control Block (SCB) at 0xE000ED00.

What they control:

- **VTOR**: where the vector table is, which a bootloader changes before starting the application.
- **AIRCR**: how priority bits are grouped, and the software reset request.
- **SCR**: sleep behaviour, such as deep sleep and sleep-on-exit.
- **CCR**: trapping of divide-by-zero and unaligned access, and stack alignment.
- **SHCSR and the fault status registers**: which fault handlers are enabled and what caused a fault.

```c
SCB->VTOR = APP_START_ADDRESS;                 // relocate the vector table
SCB->SCR |= SCB_SCR_SLEEPDEEP_Msk;             // the next WFI enters deep sleep
NVIC_SystemReset();                            // writes the reset request to AIRCR
```

On Cortex-A, the equivalent (SCTLR) enables the MMU and caches.

## What is the role of the reset vector?

The reset vector is the address the CPU starts executing from after any reset: power-on, the reset pin, a watchdog or a software reset. It is stored at a fixed place the hardware knows.

On a Cortex-M the first two words of the vector table are read by hardware at reset: word 0 is loaded into the stack pointer and word 1, the reset vector, into the program counter. Execution then begins in the reset handler.

```c
void Reset_Handler(void) {
  /* copy .data, clear .bss, set up clocks */
  main();
  for (;;) { }
}
```

If the reset vector is wrong or the flash is blank, the device does nothing at all, so it is the first thing to check when a board will not boot. In a system with a bootloader, the reset vector belongs to the bootloader, which then jumps to the application's own reset handler.

## What is the role of startup code?

Startup code runs between reset and `main`. It builds the environment that C code assumes exists.

```c
extern uint32_t _sidata, _sdata, _edata, _sbss, _ebss;   // symbols from the linker script

void Reset_Handler(void) {
  uint32_t *src = &_sidata, *dst = &_sdata;
  while (dst < &_edata) *dst++ = *src++;     // copy initialised data from flash to RAM
  for (dst = &_sbss; dst < &_ebss; ) *dst++ = 0;   // zero the .bss section
  SystemInit();                               // clocks, FPU, vector table location
  __libc_init_array();                        // static constructors, library setup
  main();
  for (;;) { }                                // main must not return
}
```

It also provides the vector table and default handlers. Without it, initialised globals would hold garbage and zero-initialised ones would not be zero. It is usually supplied by the chip vendor, in assembly or C, and paired with a linker script.

## What is the role of a bootloader?

A bootloader is a small program that runs first after reset and decides what to run next. Its main purpose is to let the application be replaced in the field without a debug probe.

What it does:

1. Initialises the minimum hardware it needs.
2. Decides whether to stay in update mode: a button held, a flag left by the application, or no valid application present.
3. If updating, receives a new image over UART, USB, CAN or a radio link, and writes it to flash.
4. Verifies the application (a CRC or a cryptographic signature).
5. Hands over: sets the vector table location and stack pointer to the application's, and jumps to its reset handler.

Good designs make the update fail-safe (two image slots, or a bootloader that is never overwritten), authenticate the image, and can roll back if the new firmware does not start.

## What is the role of the linker?

The linker combines the object files and libraries produced by the compiler into one executable image.

It does three things:

- **Symbol resolution**: every reference to a function or variable in one file is matched to its definition in another. "Undefined reference" and "multiple definition" errors come from here.
- **Section placement**: following the linker script, it gathers `.text`, `.rodata`, `.data` and `.bss` from all files and assigns them addresses in flash and RAM.
- **Relocation**: it patches the code with the final addresses.

It also discards unused sections when asked (`--gc-sections`) and writes a map file showing the address and size of everything, which is the first place to look when flash or RAM runs out.

## What is a linker script?

A linker script tells the linker what memory the target has and where each section goes. A microcontroller project needs one because there is no operating system to load the program.

```text
MEMORY {
  FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = 256K
  RAM   (rwx) : ORIGIN = 0x20000000, LENGTH = 64K
}
SECTIONS {
  .isr_vector : { KEEP(*(.isr_vector)) } > FLASH
  .text       : { *(.text*) *(.rodata*) } > FLASH
  .data       : { _sdata = .; *(.data*) _edata = .; } > RAM AT > FLASH
  .bss        : { _sbss = .; *(.bss*) _ebss = .; } > RAM
  _estack = ORIGIN(RAM) + LENGTH(RAM);
}
```

`> RAM AT > FLASH` means `.data` runs in RAM but its initial values are stored in flash. The symbols it defines (`_sdata`, `_ebss`, `_estack`) are what the startup code uses. It is also where a bootloader and application are given separate regions and where special sections are placed at fixed addresses.

## What is cache memory, and how does it affect embedded systems?

A cache is a small, fast memory between the CPU and slower main memory that keeps copies of recently used instructions and data. A hit is served quickly; a miss costs a full memory access. Simple microcontrollers have none; faster ones (Cortex-M7, Cortex-A) do.

Effects on firmware:

- **Timing becomes variable.** The same code is fast when cached and slow when not, which complicates worst-case analysis.
- **DMA and peripherals bypass the cache.** After a DMA receive, the CPU may read stale cached data; before a DMA transmit, the data may still be only in the cache. Buffers must be cache-line aligned and invalidated or flushed at the right moments, or placed in non-cached memory.
- **Self-modifying code and bootloaders** must flush the instruction cache after writing code.
- **Data layout matters**: data used together should sit together.

## What is the role of the memory management unit?

A memory management unit (MMU) translates the virtual addresses a program uses into physical addresses, using page tables set up by the operating system. It is found on application processors such as Cortex-A, not on small microcontrollers.

It provides:

- **Virtual memory**: each process sees its own private address space.
- **Protection**: a process cannot read or write another's memory or the kernel's; a violation raises a fault.
- **Permissions per page**: read-only, no-execute, user or privileged.
- **Paging and swapping, shared libraries and memory-mapped files.**

An MMU is what makes it possible to run Linux. The cost is the translation overhead (reduced by the TLB, a cache of recent translations), page-table memory and less predictable timing.

## What is the role of the memory protection unit?

A memory protection unit (MPU) enforces access permissions on regions of memory without translating addresses. It is the microcontroller's lighter alternative to an MMU, available on most Cortex-M cores.

Software defines a handful of regions (typically 8 or 16), each with a base, a size and permissions: read, write, execute, privileged-only. An access that breaks the rules raises a fault at the offending instruction.

Uses:

- Catch stack overflow with a no-access guard region below each stack.
- Make flash and constant data read-only, and RAM non-executable.
- Isolate RTOS tasks so a bug in one cannot corrupt another or the kernel.
- Catch null-pointer dereferences by protecting address 0.

It turns silent memory corruption into an immediate, debuggable fault, and safety standards expect it to be used.

## What is the role of a memory controller?

A memory controller is the hardware that manages access to a memory device, hiding its timing and protocol from the CPU.

Examples in embedded systems:

- **Flash controller**: sequences erase and program operations on internal flash, sets wait states for the clock speed, and enforces write protection.
- **External memory controller** (FSMC/FMC on STM32): generates the address, data and control signals for external SRAM, NOR, NAND or SDRAM, including SDRAM refresh.
- **QSPI/OSPI controller**: drives serial flash and can map it into the address space for execute-in-place.
- **DRAM controller** on application processors: performs initialisation, training and refresh.

Firmware configures it at start-up with the timing parameters from the memory's datasheet; a wrong value typically shows up as occasional data corruption.

## What is direct memory access (DMA)?

DMA lets a peripheral and memory exchange data without the CPU moving each byte. The CPU sets up a transfer (source, destination, length, direction) and the DMA hardware carries it out, raising an interrupt when it is finished.

Without DMA, a 1000-byte UART reception means 1000 interrupts. With DMA it means one.

Benefits: far less CPU load, higher sustained data rates, no risk of missing data because an ISR was late, and the CPU can sleep during the transfer.

Typical uses: ADC sampling into a buffer, audio streams, SPI displays, fast UARTs, and memory-to-memory copies. Circular mode with half-transfer and full-transfer interrupts gives continuous streaming.

Things to get right: the buffer must stay valid for the whole transfer (not a local on the stack), and on cores with a data cache the buffer needs cache maintenance.

## What is the role of the DMA controller?

The DMA controller is the peripheral that performs DMA transfers. It has several channels or streams, each of which can be connected to a peripheral's request line.

For each channel firmware programs:

- The peripheral address (for example a UART data register) and the memory address.
- The number of items and the width of each.
- The direction, and whether each address increments.
- Normal or circular mode, and the channel's priority.
- Which interrupts to raise: half transfer, transfer complete, error.

```c
DMA1_Channel5->CPAR  = (uint32_t)&USART1->DR;     // peripheral side
DMA1_Channel5->CMAR  = (uint32_t)rx_buffer;       // memory side
DMA1_Channel5->CNDTR = sizeof rx_buffer;
DMA1_Channel5->CCR   = DMA_CCR_MINC | DMA_CCR_CIRC | DMA_CCR_TCIE | DMA_CCR_EN;
USART1->CR3 |= USART_CR3_DMAR;                    // let the UART raise DMA requests
```

When requests collide, the controller arbitrates by priority, and it takes the bus from the CPU for each item moved.

## What is multi-core processing in embedded systems?

A multi-core device has two or more CPU cores in one chip, to raise performance or to separate functions.

- **Symmetric (SMP)**: identical cores run one operating system that schedules tasks across them. Common on Cortex-A parts running Linux.
- **Asymmetric (AMP)**: each core runs its own software, often different kinds of core in one chip: an application core running Linux beside a microcontroller core running real-time firmware, or a radio core beside an application core.

What changes for the programmer:

- Code truly runs in parallel, so disabling interrupts on one core no longer protects shared data; spinlocks or atomic operations are needed.
- The cores communicate through shared memory and inter-processor interrupts, usually wrapped in a mailbox or message library.
- Cache coherence, boot order and debugging all become harder.

## What is the role of the power management unit?

The power management unit (PMU, or a separate PMIC chip) supplies and controls power for the system.

It typically provides:

- **Voltage regulators** (LDOs and switching converters) for the core, I/O and analog supplies.
- **Power sequencing**: bringing the rails up and down in the required order.
- **Supervision**: power-on reset, brown-out detection and low-voltage warnings.
- **Low-power mode control**: switching off power domains and regulators in sleep, and deciding what can wake the system.
- **Battery functions** on a PMIC: charging, fuel gauging and choosing between power sources.

Firmware configures it through registers (or over I2C for an external PMIC): which sleep mode to enter, which domains stay powered, the brown-out threshold and the wake-up sources.

## How do you handle power management in firmware?

The goal is to spend as little time and energy awake as possible.

- **Sleep whenever idle.** End the main loop or idle task with a wait-for-interrupt instruction, and let interrupts wake the CPU.
- **Use the deepest sleep mode** that still allows the needed wake-up source and wake-up time.
- **Gate clocks**: enable a peripheral's clock only while it is in use.
- **Lower the clock frequency or voltage** when full speed is not needed.
- **Be event-driven**: replace polling with interrupts, and use DMA and autonomous peripherals.
- **Manage the outside world**: power down sensors and radios, and do not leave pins floating or driving into loads.

```c
for (;;) {
  process_pending_events();
  __disable_irq();
  if (!events_pending()) __WFI();    // sleep until any interrupt; it wakes even with interrupts masked
  __enable_irq();
}
```

Measure with a current probe; average current is what determines battery life.

## How do you design a power management scheme?

1. **Set the budget.** From the battery capacity and required lifetime, work out the allowed average current.
2. **Profile the activity.** List each state (measuring, transmitting, idle), its current and how long the system spends in it. Average current is the sum of current times duty cycle.
3. **Define power states** and the transitions between them: run, idle, sleep, deep sleep, shutdown.
4. **Choose wake-up sources** for each state: RTC alarm, pin change, radio event.
5. **Give drivers suspend and resume functions**, so every peripheral is put into its low-power state before sleeping and restored after.
6. **Decide what must be retained**: which RAM, which registers, the RTC.
7. **Use a tickless scheduler** so the periodic tick does not wake the CPU needlessly.
8. **Measure and iterate** with real hardware.

Most of the savings come from duty cycling: a sensor node that wakes for 10 ms every 10 s is asleep 99.9% of the time.

## What is the role of a peripheral controller?

A peripheral controller is the hardware block that implements an interface and presents it to the CPU as a set of registers. A UART controller, an SPI controller, a USB controller and an Ethernet MAC are examples.

It handles everything that software would be too slow or imprecise to do: generating the clock, shifting bits in and out with exact timing, detecting start and stop conditions, calculating CRCs, buffering bytes in a FIFO, and raising interrupts or DMA requests when attention is needed.

To the firmware, each controller looks the same in outline:

- **Control registers** to configure and enable it.
- **Status registers** with event and error flags.
- **Data registers** or a FIFO.
- **Interrupt and DMA request lines.**

A device driver is the software that operates those registers and offers the rest of the program a simple interface.
