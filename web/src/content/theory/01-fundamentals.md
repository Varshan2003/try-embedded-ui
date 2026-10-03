# Fundamentals

## What is embedded C?

Embedded C is ordinary C used to program a microcontroller or other dedicated hardware, usually with no operating system underneath. The language is the same; the environment is different:

- Hardware is controlled directly through registers at fixed addresses.
- RAM and flash are measured in kilobytes, so memory use is planned, not assumed.
- The program starts at reset and never returns from `main`.
- Timing matters: a correct answer that arrives late is a failure.

Compilers add a few extensions (interrupt attributes, section placement, packed structs), and ISO/IEC TR 18037 defines optional extras such as fixed-point types, but most firmware is written in plain C99 or C11.

## What is an embedded system?

A computer built into a product to do one job, as opposed to a general-purpose computer that runs whatever the user installs. A washing machine controller, an engine control unit, a pacemaker and a Wi-Fi router are all embedded systems.

Typical characteristics:

- A dedicated function, fixed when the product ships.
- Tight limits on memory, processing power, energy and cost.
- Direct interaction with the physical world through sensors and actuators.
- Real-time requirements: it must respond within a known time.
- Long unattended operation, so reliability and recovery from faults matter.

## What is the difference between a microprocessor and a microcontroller?

| | Microprocessor | Microcontroller |
|---|---|---|
| What is on the chip | The CPU only | CPU, flash, RAM and peripherals |
| External parts needed | Memory, clocking, I/O chips | Very few |
| Typical memory | Megabytes to gigabytes, external | Kilobytes to a few megabytes, internal |
| Typical software | A full operating system | Bare metal or an RTOS |
| Power and cost | Higher | Lower |
| Examples | Cortex-A, x86 | Cortex-M, AVR, PIC, ESP32 |

A microprocessor is chosen for computing power, a microcontroller for a small, cheap, low-power control task. A system-on-chip blurs the line by putting an application-class CPU and peripherals in one package.

## What are the basic differences between C and embedded C?

The language is the same. The differences are in how it is used:

| | Hosted C (a PC) | Embedded C |
|---|---|---|
| Runs on | An operating system | Bare metal or an RTOS |
| Start and end | The OS calls `main`; `main` returns | Startup code calls `main`; it never returns |
| Memory | Large, virtual, with a heap | Small, fixed; the heap is often avoided |
| I/O | Files and streams | Registers and interrupts |
| Library | The full standard library | A subset; often no `printf` or `malloc` |
| Build | Native compiler | Cross-compiler, linker script, flashing tool |
| Debugging | On the same machine | Through a debug probe |

Firmware also leans on fixed-width types, `volatile`, bit manipulation and compiler extensions for interrupts and memory placement.

## What does portability mean in embedded C, and how do you achieve it?

Portable code can be moved to another compiler or microcontroller with little change. Firmware can never be fully portable, because registers differ between chips, so the aim is to keep the non-portable part small.

- Use `<stdint.h>` types (`uint8_t`, `int32_t`) instead of assuming the size of `int`.
- Put all register access behind a hardware abstraction layer; application code calls `uart_send()`, not `USART1->DR`.
- Do not depend on byte order, struct padding, bit-field layout or the signedness of `char`.
- Serialise data byte by byte instead of copying structs onto the wire.
- Hide compiler extensions behind macros (`#define PACKED __attribute__((packed))`).
- Avoid undefined and implementation-defined behaviour, and build with warnings on.

## How do you handle errors in embedded C?

There are no exceptions, so errors travel as values and every caller decides what to do.

```c
typedef enum { ERR_OK, ERR_TIMEOUT, ERR_CRC, ERR_BUSY } err_t;

err_t sensor_read(uint16_t *out) {
  if (!bus_ready()) return ERR_BUSY;
  if (!wait_for_data(10 /* ms */)) return ERR_TIMEOUT;
  *out = read_data();
  return ERR_OK;
}
```

The usual tools:

- **Return codes**, with the result passed back through a pointer.
- **Timeouts** on every wait for hardware, so a dead peripheral cannot hang the system.
- **Retries** for transient faults, such as a noisy bus.
- **Assertions** for programming errors during development.
- **A safe state** for faults that cannot be recovered: outputs off, error logged, then reset.
- **The watchdog** as the last line of defence when the code itself is stuck.

## How do you perform input and output in embedded C?

There are no files or streams by default. I/O means reading and writing peripheral registers:

- **GPIO**: set a pin's direction, then write the output register or read the input register.
- **Serial peripherals** (UART, SPI, I2C): write a byte to a data register, read the status register to learn when it has gone.
- **Analog**: start an ADC conversion and read the result; write a DAC or PWM compare register.

The three ways to drive them are polling (loop on a status flag), interrupts (the peripheral calls the code) and DMA (hardware moves the data). `printf` works only after it has been retargeted, which means supplying the low-level write function that sends each character to a UART or debug channel.

## How do you debug embedded C code?

- **Debug probe** (SWD or JTAG): halt the CPU, set breakpoints and watchpoints, single-step, and inspect variables, memory and peripheral registers.
- **Logging** over a UART, SWO or RTT. Simple and works in the field, but it changes timing.
- **A GPIO pin and an oscilloscope or logic analyser** for timing. Toggle the pin on entry and exit of the code under study; it costs almost nothing.
- **A logic analyser with protocol decoding** to see what is really on an SPI, I2C or UART bus.
- **Assertions and a fault handler** that records the stacked program counter, so a crash points at a line.
- **Unit tests on a PC** for logic that does not touch hardware.

A good first move on any bug is to decide whether the hardware or the software is wrong, by measuring the signal.

## How do you optimise embedded C code?

Measure first. Guessing which code is slow or large is usually wrong; use a timer, a toggled pin or the linker map file.

- Let the compiler work: `-O2` for speed, `-Os` for size, link-time optimisation, and remove unused sections.
- Choose a better algorithm or data structure before tuning lines.
- Replace computation with a lookup table when flash is cheaper than time.
- Use fixed-point instead of floating point on a CPU without an FPU.
- Use the natural word size for loop counters and locals; use small types for stored data.
- Move loop-invariant work out of loops, and keep ISRs short.
- Mark data `const` so it stays in flash instead of being copied to RAM.
- Order struct members from largest to smallest to cut padding.

Speed, code size and RAM trade against each other, so know which one the product is short of.

## How do you handle floating-point arithmetic in embedded C?

First ask whether it is needed. On a microcontroller without an FPU, every floating-point operation is a library call that costs tens to hundreds of cycles and pulls kilobytes of code into flash.

- **Prefer fixed-point** or scaled integers (store millivolts, not volts).
- **If the chip has an FPU**, enable it in startup code and use `float` with the hard-float ABI. Write constants as `1.5f`; a bare `1.5` is a `double` and forces slow double-precision maths.
- **Never compare floats with `==`**; compare against a tolerance.
- **Avoid floats in ISRs** unless FPU context saving is configured, since it lengthens interrupt entry.
- **Watch `printf("%f")`**: it brings in a large formatting library.

## How do you perform fixed-point arithmetic in embedded C?

Store a real number as an integer scaled by a power of two. In Q16.16 the stored value is the real value times 65536.

```c run
#include <stdio.h>
#include <stdint.h>

typedef int32_t q16_t;                      // Q16.16
#define Q16(x) ((q16_t)((x) * 65536.0))

static q16_t q16_mul(q16_t a, q16_t b) { return (q16_t)(((int64_t)a * b) >> 16); }
static q16_t q16_div(q16_t a, q16_t b) { return (q16_t)(((int64_t)a << 16) / b); }

int main(void) {
  q16_t a = Q16(3.5), b = Q16(1.25);
  printf("sum  = %d/65536\n", a + b);                 // add and subtract need no scaling
  printf("prod = %d (whole part %d)\n", q16_mul(a, b), q16_mul(a, b) >> 16);
  printf("quot = %d thousandths\n", (q16_div(a, b) * 1000) >> 16);
  return 0;
}
```

Rules: addition and subtraction work directly when both operands have the same scale; multiplication needs a wider intermediate and a shift back; division shifts the dividend up first. Decide how to round and whether to saturate on overflow.

## How do you create a delay in embedded C?

Three ways, from worst to best:

1. **A busy loop** (`for (volatile int i = 0; i < N; i++);`). The length depends on the compiler, optimisation level and clock, and it blocks everything. Acceptable only for crude start-up delays.
2. **A hardware timer, blocking**: program a timer and wait for its flag. Accurate, but still blocks.
3. **Non-blocking, from a tick counter**: record the start time and check elapsed time on each pass through the main loop.

```c
static uint32_t last;

void blink_task(void) {
  if (millis() - last >= 500u) {   // unsigned subtraction is safe across rollover
    last += 500u;
    led_toggle();
  }
}
```

Under an RTOS, call the kernel's delay function, which lets other tasks run while this one sleeps.

## What is hardware-software co-design?

Designing the hardware and the software of a product together, instead of finishing the board and then handing it to the firmware team. The two are specified, modelled and traded off against each other from the start: which functions go in software, which in dedicated logic, how they communicate, and what each choice costs in speed, power, price and time.

In practice it means shared models or virtual prototypes so that firmware can be written before the board exists, early agreement on register maps and interfaces, and co-simulation to test both halves together. The benefit is finding integration problems early, when they are cheap to fix.

## What is hardware/software partitioning?

Partitioning is the decision, made during co-design, of which functions are implemented in hardware (an FPGA, an ASIC block, a dedicated peripheral) and which in software on the CPU.

| Put it in hardware when | Put it in software when |
|---|---|
| It must be very fast or exactly timed | Timing is relaxed |
| It runs constantly and dominates power | It runs rarely |
| The function is fixed and well understood | It is likely to change |
| Volume justifies the development cost | Development cost and time must stay low |

Example: a motor controller generates PWM and captures encoder edges in timer hardware, and runs the control loop and communication in software.

## What are real-time constraints?

A real-time constraint is a deadline: the system is correct only if it responds within a stated time. Real-time means predictable, not fast.

Useful terms:

- **Deadline**: the latest acceptable completion time.
- **Period**: how often a recurring job must run.
- **Response time**: from the event to the completed reaction.
- **Jitter**: variation in when something happens.
- **Worst-case execution time (WCET)**: the longest a piece of code can take.

A design is sound when the worst-case response time of every job is shorter than its deadline, not when the average is.

## How do you meet real-time constraints in firmware?

- Write down each deadline, then design to the **worst case**, not the average.
- Keep ISRs short: capture the event and defer the work to a task or the main loop.
- Give the most urgent work the highest priority; under an RTOS use pre-emptive priority scheduling.
- Bound everything: no unbounded loops, no `malloc` at run time, timeouts on every wait.
- Keep critical sections short, since disabling interrupts adds directly to latency.
- Use priority inheritance on mutexes to prevent priority inversion.
- Let hardware do the exact timing: timers, PWM, input capture, DMA.
- Measure worst-case timing with a pin and an oscilloscope under stress, and check stack use.

## What is the difference between hard, firm and soft real-time systems?

| Kind | A missed deadline means | Examples |
|---|---|---|
| Hard | System failure, possibly danger | Airbag, brake controller, pacemaker |
| Firm | That result is useless, but the system continues | A video frame decoded too late, a sample missed in a control loop |
| Soft | Quality degrades gradually | A user interface, audio streaming |

The classification belongs to the requirement, not the hardware. One product often contains all three: a drone has a hard real-time motor loop, firm telemetry and a soft status display.

## What are the stages of building a C program for a microcontroller?

1. **Preprocessing**: `#include` files are inserted, macros are expanded and conditional code is removed.
2. **Compilation**: each translation unit becomes assembly for the target CPU.
3. **Assembly**: the assembly becomes an object file (`.o`) with code, data and unresolved symbols.
4. **Linking**: object files and libraries are combined, symbols are resolved, and the linker script places each section at an address in flash or RAM. The result is an ELF file, plus a map file listing what went where.
5. **Conversion**: `objcopy` turns the ELF into a `.hex` or `.bin` image.
6. **Flashing**: a programmer or bootloader writes the image to the device.

The compiler runs on a PC but produces code for another CPU, which is why it is called a cross-compiler.

## What is MISRA C and why is it used?

MISRA C is a set of coding guidelines for C in safety-related and high-reliability systems. It began in the automotive industry and is now common in medical, aerospace and industrial work.

C allows many things that are undefined, implementation-defined or simply easy to get wrong. MISRA restricts the language to a safer subset. Typical rules: no dynamic memory after initialisation, no recursion, no implicit narrowing conversions, every `switch` has a `default`, every non-void function's return value is used.

Rules are classed as mandatory, required or advisory, compliance is checked with static analysis tools, and a rule may be broken only with a documented deviation. In an interview, show that you know why a rule exists, not just that it does.

## What is the difference between undefined, unspecified and implementation-defined behaviour?

- **Implementation-defined**: the compiler chooses and must document the choice. Examples: the size of `int`, whether `char` is signed, the result of right-shifting a negative value.
- **Unspecified**: the compiler chooses from a set of allowed behaviours and need not document it or be consistent. Example: the order in which function arguments are evaluated.
- **Undefined**: the standard places no requirement at all. The program may crash, appear to work, or behave differently at another optimisation level. Examples: signed integer overflow, reading an uninitialised local, dereferencing a null pointer, writing past the end of an array, shifting by the width of the type or more.

Undefined behaviour matters most, because the optimiser assumes it never happens and can delete the code that was meant to detect it.
