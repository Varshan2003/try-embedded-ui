# Interrupts, timers and concurrency

## What is an interrupt and how is it handled?

An interrupt is a signal from hardware (or software) that makes the CPU suspend what it is doing and run a specific function, the interrupt service routine (ISR), then carry on where it left off.

What happens on a Cortex-M:

1. A peripheral raises its interrupt request.
2. If that interrupt is enabled and its priority is high enough, the CPU finishes the current instruction and pushes a set of registers onto the stack.
3. It reads the handler's address from the vector table and jumps to it.
4. The ISR clears the source of the interrupt and does its work.
5. On return the registers are popped and the interrupted code continues.

```c
volatile bool rx_ready;
volatile uint8_t rx_byte;

void USART1_IRQHandler(void) {
  if (USART1->SR & USART_SR_RXNE) {
    rx_byte = (uint8_t)USART1->DR;   // reading the data register clears the flag
    rx_ready = true;                 // tell the main loop; do the real work there
  }
}
```

To use one: write the handler, enable the interrupt in the peripheral, enable it in the interrupt controller, and make sure global interrupts are on.

## What is the difference between polling and interrupt-driven I/O?

| | Polling | Interrupt-driven |
|---|---|---|
| How an event is noticed | The code checks a flag repeatedly | Hardware calls the ISR |
| CPU use while waiting | Wasted, or the loop must be fast | None; the CPU can sleep |
| Response time | Up to one pass of the loop | A few microseconds, bounded |
| Complexity | Simple, sequential | Shared data and timing must be handled |
| Good for | Fast, frequent or very simple devices; start-up code | Rare or urgent events; low power |

```c
while (!(UART->SR & RXNE)) { }       // polling: blocks until a byte arrives
uint8_t b = (uint8_t)UART->DR;
```

Neither is always better. At very high event rates the overhead of entering an ISR for each event can exceed the cost of polling, which is why fast paths often use DMA or poll in a burst.

## What is the role of an interrupt service routine?

An ISR is the function the CPU runs in response to one interrupt. Its job is to deal with the hardware event quickly and get out:

- Find out what caused the interrupt, by reading the status flags.
- Clear the cause, or the ISR will run again immediately.
- Do the minimum that cannot wait: read the received byte, start the next transfer, capture a timestamp.
- Hand the rest to the main loop or a task, by setting a flag, writing to a ring buffer or giving a semaphore.

An ISR takes no arguments and returns nothing. It is called by hardware, not by code, so it can run between any two instructions of the main program.

## What rules should an ISR follow?

- **Keep it short.** While it runs, interrupts of the same or lower priority wait.
- **Never block.** No delays, no waiting on a flag, no waiting for a mutex.
- **Avoid non-re-entrant functions**: `printf`, `malloc` and most library I/O.
- **Avoid floating point** unless the FPU context is saved.
- **Clear the interrupt flag**, in the way the datasheet specifies.
- **Declare shared variables `volatile`**, and protect any multi-step access to them in the main code.
- **Under an RTOS, use only the "from ISR" API calls** and request a context switch on exit if a higher-priority task was woken.
- **Use little stack**; ISRs nest on top of whatever was running.

The standard pattern is: capture the data in the ISR, process it outside.

## What is interrupt latency?

Interrupt latency is the time from the interrupt request being asserted to the first instruction of its ISR executing. Interrupt response time adds the time for the ISR to do its job.

What makes it longer:

- **Interrupts being disabled**: the longest critical section in the system is the dominant term.
- **A higher or equal priority ISR already running.**
- **The instruction in progress**, if it is long and cannot be interrupted.
- **Saving context**, more so with FPU registers.
- **Hardware effects**: flash wait states, cache misses, waking from a sleep mode.

To reduce it: keep critical sections and ISRs short, assign priorities deliberately, and use nesting so urgent interrupts pre-empt slow ones. A Cortex-M takes 12 cycles from request to handler when nothing delays it. Measure by toggling a pin at the start of the ISR and comparing with the trigger on an oscilloscope.

## What is the interrupt vector table?

The vector table is an array of addresses, one per exception or interrupt. When an interrupt is taken, the CPU uses its number as an index into the table and jumps to the address found there.

On a Cortex-M the table sits at the start of flash:

| Entry | Contents |
|---|---|
| 0 | Initial value of the main stack pointer |
| 1 | Reset handler |
| 2 | NMI handler |
| 3 | HardFault handler |
| ... | Other system exceptions |
| 16 onwards | Peripheral interrupts (IRQ0, IRQ1, ...) |

```c
__attribute__((section(".isr_vector")))
void (*const vector_table[])(void) = {
  (void (*)(void))&_estack,
  Reset_Handler,
  NMI_Handler,
  HardFault_Handler,
  /* ... */
};
```

Startup code usually defines every handler as a weak alias of a default handler, so application code overrides one by defining a function with the right name. A bootloader relocates the table for the application by writing the vector table offset register (VTOR).

## What is the role of the interrupt controller?

The interrupt controller sits between the peripherals and the CPU and manages all the interrupt requests. On a Cortex-M it is the NVIC (nested vectored interrupt controller); on Cortex-A it is the GIC.

It provides:

- **Enable and disable** for each interrupt line.
- **Pending state**, so a request that arrives while it cannot be served is remembered.
- **Priority** per interrupt, and selection of the highest-priority pending one.
- **Nesting**: a higher-priority interrupt pre-empts a running lower-priority ISR.
- **Vectoring**: it supplies the interrupt number so the CPU jumps straight to the right handler.

```c
NVIC_SetPriority(USART1_IRQn, 5);   // on Cortex-M a lower number is a higher priority
NVIC_EnableIRQ(USART1_IRQn);
```

## How does exception handling work in embedded C?

C has no `try` and `catch`. "Exception" in embedded work usually means a CPU exception: an event that diverts execution to a handler. Interrupts are one kind; faults are another.

Fault exceptions on a Cortex-M:

- **HardFault**: the catch-all, and where other faults escalate.
- **MemManage**: an MPU violation.
- **BusFault**: an access to an address that does not respond.
- **UsageFault**: an undefined instruction, a divide by zero (if trapping is enabled), or an unaligned access.

A useful fault handler records the stacked program counter and fault status registers, stores them where they survive a reset, puts the outputs in a safe state, and resets.

For software errors, C code uses return codes, and `setjmp`/`longjmp` in rare cases where unwinding out of deep code is needed. `longjmp` skips clean-up, so it is banned by most coding standards.

## What is nested interrupt handling and interrupt priority?

Each interrupt has a priority. If a higher-priority interrupt arrives while a lower-priority ISR is running, the CPU suspends that ISR and runs the new one first: the interrupts are nested. An interrupt of equal or lower priority stays pending until the running ISR returns.

On Cortex-M the priority field is split into a **pre-emption priority**, which decides whether one interrupt can interrupt another, and a **sub-priority**, which only orders interrupts that are pending at the same time. A lower number means a higher priority.

Guidelines: give the highest priority to the interrupt with the tightest deadline, keep those ISRs shortest, and allow for the extra stack that nesting needs. Under an RTOS, interrupts above a configured priority level must not call kernel functions.

## How do you program a timer?

A hardware timer is a counter driven by a clock. Three settings define its timing: the **clock source**, a **prescaler** that divides it, and a **reload** (period) value.

```c
// 1 ms periodic interrupt from a 16 MHz timer clock
TIM2->PSC = 16 - 1;            // 16 MHz / 16 = 1 MHz, one count per microsecond
TIM2->ARR = 1000 - 1;          // overflow every 1000 counts
TIM2->DIER |= TIM_DIER_UIE;    // interrupt on overflow
TIM2->CR1 |= TIM_CR1_CEN;      // start
NVIC_EnableIRQ(TIM2_IRQn);

void TIM2_IRQHandler(void) {
  TIM2->SR = ~TIM_SR_UIF;      // clear the flag (write 0 to clear on this device)
  tick_ms++;
}
```

The update rate is `clock / ((PSC + 1) * (ARR + 1))`. Besides periodic interrupts, timers do **input capture** (timestamp an edge), **output compare** (act at a set count) and **PWM** (compare against a duty value).

## What is the role of the system timer?

The system timer produces the periodic tick that gives firmware its sense of time. On Cortex-M it is SysTick, a 24-bit down-counter in the core itself, so it is the same on every vendor's chip.

It is used for:

- The millisecond counter behind delays and timeouts.
- The RTOS tick: on each tick the kernel updates delays and decides whether to switch tasks.
- Software timers and periodic housekeeping.

```c
volatile uint32_t ms;

void SysTick_Handler(void) { ms++; }

SysTick_Config(SystemCoreClock / 1000u);   // 1 kHz tick

bool expired(uint32_t start, uint32_t timeout) { return ms - start >= timeout; }   // safe across rollover
```

For low power, a "tickless" kernel stops the periodic tick while idle and programs a timer for the next real deadline.

## What is the role of a watchdog timer?

A watchdog is an independent hardware timer that resets the system unless the software restarts ("kicks" or "feeds") it at regular intervals. If the firmware hangs in a loop, deadlocks or crashes, the kicks stop, the timer expires and the device restarts instead of staying dead.

It protects against faults nobody predicted: a software bug, a corrupted variable, an electrical glitch. For a device that runs unattended it is essential.

Variants:

- **Independent watchdog**: runs from its own oscillator, so it works even if the main clock fails.
- **Window watchdog**: must be kicked inside a time window, not too early and not too late, which also catches code running too fast.
- **External watchdog**: a separate chip, for the highest integrity.

## How do you implement a watchdog properly?

```c
void watchdog_init(void) {
  IWDG->KR = 0x5555;     // unlock
  IWDG->PR = 4;          // prescaler
  IWDG->RLR = 1000;      // timeout
  IWDG->KR = 0xCCCC;     // start; it cannot be stopped
}

static inline void watchdog_kick(void) { IWDG->KR = 0xAAAA; }

int main(void) {
  watchdog_init();
  for (;;) {
    read_inputs();
    control();
    write_outputs();
    if (all_tasks_healthy()) watchdog_kick();    // one place, after proof of health
  }
}
```

Rules:

- Kick in one place, and only when the system has shown it is healthy. Under an RTOS, each task reports in and a supervisor kicks only if all have.
- Never kick from a timer ISR: the interrupt keeps running while the main code is stuck.
- Choose a timeout longer than the worst-case loop time, with margin.
- At start-up, read the reset-cause register and log watchdog resets.

## How do you handle concurrency issues?

Concurrency problems arise when two execution contexts (main code and an ISR, or two tasks) use the same data and one can interrupt the other part-way through.

```c
volatile uint32_t events;        // incremented in an ISR

uint32_t take_events(void) {
  uint32_t primask = __get_PRIMASK();
  __disable_irq();               // critical section: the ISR cannot run here
  uint32_t n = events;
  events = 0;
  __set_PRIMASK(primask);        // restore, rather than blindly enabling
  return n;
}
```

Techniques, from lightest to heaviest:

- Do not share: give each datum one owner and pass messages.
- Make the access atomic: a single word write, or an atomic type.
- Use a lock-free single-producer, single-consumer ring buffer between an ISR and the main code.
- Disable interrupts briefly around the access.
- Under an RTOS, use a mutex between tasks and a queue or semaphore from ISRs.

## How do you handle synchronisation issues?

Synchronisation means making contexts cooperate correctly, either by excluding each other from shared data or by signalling that something has happened.

| Need | Tool |
|---|---|
| Protect data shared with an ISR | A short critical section (interrupts off) |
| Protect data shared between tasks | A mutex |
| Tell a task that an event occurred | A binary semaphore, task notification or event flag |
| Pass data between contexts | A queue or ring buffer |
| Count available resources | A counting semaphore |

The problems to avoid: **race conditions** (unprotected access), **deadlock** (two tasks each hold what the other needs; prevent it by always taking locks in the same order), **priority inversion** (use a mutex with priority inheritance) and **starvation**. Keep every locked region as short as possible.

## How do you handle resource contention?

Contention is several tasks or interrupts needing the same resource at once: a bus, a buffer, a peripheral, CPU time.

- **Serialise access with a mutex**, held for as short a time as possible.
- **Give the resource a single owner**: one "gatekeeper" task owns the UART or the SPI bus, and others send it requests through a queue. No locks are needed and ordering is explicit.
- **Use a counting semaphore** when there are several identical resources, such as buffers in a pool.
- **Always use timeouts** when waiting, so that a stuck holder produces an error, not a hang.
- **Order lock acquisition** consistently to prevent deadlock.
- **Use priority inheritance** so a low-priority holder cannot delay a high-priority waiter indefinitely.

## What is a re-entrant function?

A function is re-entrant if it can be interrupted part-way through, called again from another context, and still give correct results in both calls. That is required of any function called from both an ISR and the main code, or from more than one task.

A re-entrant function:

- Uses only its parameters and local (stack) variables.
- Does not use static or global data, unless every access is protected.
- Does not call non-re-entrant functions.
- Does not touch hardware in a way a second call would disturb.

```c
char *bad_format(int v) {
  static char buf[12];            // shared between all callers: not re-entrant
  snprintf(buf, sizeof buf, "%d", v);
  return buf;
}

void good_format(int v, char *buf, size_t size) { snprintf(buf, size, "%d", v); }   // the caller supplies storage
```

`strtok`, `rand` and (in many libraries) `printf` and `malloc` are not re-entrant.

## What is a critical section, and how do you make an operation atomic?

A critical section is a piece of code that must not be interrupted by anything else that uses the same data. An atomic operation is one that completes entirely or not at all from the point of view of other contexts.

Ways to get atomicity on a microcontroller:

- **Disable interrupts** around the code, saving and restoring the previous state so that nested use works. Keep it to a few instructions, because it adds to interrupt latency.
- **Raise the priority mask** (BASEPRI on Cortex-M) to block only interrupts up to a given priority.
- **Rely on a single instruction**: a load or store of one machine word is atomic; `x++` is not.
- **Use C11 atomics** or the exclusive load/store instructions for lock-free updates.
- **Under an RTOS**, use a mutex between tasks, or suspend the scheduler when only tasks are involved.
