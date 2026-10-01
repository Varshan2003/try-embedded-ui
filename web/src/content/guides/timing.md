## Time is a counter that wraps

Firmware measures time by counting ticks: a hardware timer raises an interrupt every millisecond, and the handler increments a counter. That counter has a fixed width, so it wraps. A 32-bit millisecond counter returns to zero after about 49.7 days; a 16-bit one after 65 seconds.

Code that compares timestamps directly works in every test and fails in the field, weeks later. The fix is one rule.

**Compare durations, not timestamps.** `now - start` is the elapsed time, and unsigned subtraction gives the right answer even when the counter has wrapped in between, as long as less than one full wrap has passed.

```c run
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>

static bool expired_wrong(uint32_t now, uint32_t start, uint32_t timeout) {
  return now >= start + timeout;          // the deadline can wrap past zero
}

static bool expired_right(uint32_t now, uint32_t start, uint32_t timeout) {
  return now - start >= timeout;          // elapsed time, correct across rollover
}

int main(void) {
  uint32_t start = 0xFFFFFF00;            // 256 ms before the counter wraps
  uint32_t timeout = 0x200;               // 512 ms
  uint32_t now = 0xFFFFFFFF;              // only 255 ms later

  printf("elapsed: %u ms\n", now - start);
  printf("wrong test says expired: %d\n", expired_wrong(now, start, timeout));
  printf("right test says expired: %d\n", expired_right(now, start, timeout));
  return 0;
}
```

The wrong version computes a deadline of `0x100`, which has wrapped to a small number, so the timeout appears to fire immediately.

## Do not block

`delay(500)` is the first thing most people write and the first thing to remove. While the CPU sits in a delay loop it cannot read a button, service a protocol or feed a watchdog. Firmware that does several things at once is written so that nothing waits.

The pattern is a main loop that runs continuously, where each activity checks whether it is time to act and returns immediately if not.

```c run
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>

typedef struct { uint32_t start, period; } soft_timer_t;

static bool timer_poll(soft_timer_t *t, uint32_t now) {
  if (now - t->start < t->period) return false;
  t->start += t->period;                 // advance by the period: no drift
  return true;
}

int main(void) {
  soft_timer_t blink = { 0, 250 }, report = { 0, 400 };

  for (uint32_t now = 0; now <= 1000; now += 50) {   // stands in for the main loop
    if (timer_poll(&blink, now)) printf("%4u ms: toggle LED\n", now);
    if (timer_poll(&report, now)) printf("%4u ms: send report\n", now);
  }
  return 0;
}
```

Two activities with different periods share one loop and neither delays the other.

> **Pitfall:** Rescheduling with `start = now` adds every bit of lateness to the next period, so the rate drifts. `start += period` keeps the long-term rate exact.

## Interrupts

An interrupt stops the main program between two instructions, runs a handler, and resumes. It is how the hardware gets attention within microseconds. The price is that the handler can run at any point in your main code, including halfway through a statement.

Rules for interrupt handlers:

- **Keep them short.** Capture the data or set a flag, and do the work in the main loop. While a handler runs, others of equal or lower priority wait.
- **Never block.** No delays, no waiting on a flag that another interrupt would set.
- **Avoid non-reentrant functions.** `printf`, `malloc` and `strtok` use shared state and are not safe to call from a handler.
- **Clear the interrupt source.** Otherwise the handler is re-entered the moment it returns.

Data shared with a handler must be `volatile`, so the compiler re-reads it:

```c
static volatile bool data_ready;           // set in the ISR, cleared in the main loop

void uart_rx_isr(void) {
  last_byte = UART_DR;                     // reading the data register clears the flag
  data_ready = true;
}
```

## Race conditions

`volatile` makes the compiler re-read a variable. It does not make an update atomic. `counter++` is three steps: load, add, store. If an interrupt modifies `counter` after the load and before the store, its change is overwritten and lost.

The window is a few instructions wide, so the bug shows up once in millions of iterations, never in the debugger and always in the field.

There are three ways to make shared data safe:

| Technique | How | Cost |
|---|---|---|
| Critical section | Disable interrupts around the access, then restore | Adds to worst-case interrupt latency |
| Single-writer design | Each variable is written by only one context, such as the head and tail of a ring buffer | None, if it fits the problem |
| Atomic access | Use a type the CPU reads and writes in one instruction, or an atomic instruction | Only works for a single read or write, not read-modify-write |

A critical section must restore the previous interrupt state, not simply enable interrupts. Otherwise a function that is called with interrupts already disabled would turn them back on.

```c run
#include <stdio.h>
#include <stdint.h>

// Stand-ins for the CPU's interrupt mask.
static uint32_t irq_disabled;
static uint32_t irq_save(void) { uint32_t old = irq_disabled; irq_disabled = 1; return old; }
static void irq_restore(uint32_t state) { irq_disabled = state; }

static volatile uint32_t shared_counter;

static void counter_add(uint32_t amount) {
  uint32_t state = irq_save();            // remember how things were
  shared_counter += amount;               // read-modify-write, now uninterruptible
  irq_restore(state);                     // put them back exactly
}

int main(void) {
  counter_add(5);
  printf("counter %u, interrupts disabled afterwards: %u\n", shared_counter, irq_disabled);

  irq_disabled = 1;                        // the caller is already in a critical section
  counter_add(5);
  printf("counter %u, interrupts disabled afterwards: %u\n", shared_counter, irq_disabled);
  return 0;
}
```

The same problem applies to reading a value wider than the CPU's word. On an 8-bit MCU, reading a 32-bit tick counter takes four instructions, and an interrupt between them yields a value that never existed. Either disable interrupts around the read, or read it twice and retry until both readings agree.

## Debouncing

A mechanical switch does not change state cleanly. Its contacts bounce for a few milliseconds, producing a burst of edges. Counting those as presses is the classic beginner bug.

The software fix is to sample the pin on a timer and accept a new state only after it has been seen for several consecutive samples.

```c run
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>

typedef struct { bool stable; uint8_t count; } debounce_t;

static bool debounce(debounce_t *d, bool raw, uint8_t threshold) {
  if (raw == d->stable) d->count = 0;
  else if (++d->count >= threshold) { d->stable = raw; d->count = 0; }
  return d->stable;
}

int main(void) {
  debounce_t button = { false, 0 };
  const char *raw = "0010110111111100101000000";   // one sample every 5 ms
  printf("raw:       %s\ndebounced: ", raw);
  for (const char *p = raw; *p; p++) putchar(debounce(&button, *p == '1', 4) ? '1' : '0');
  putchar('\n');
  return 0;
}
```

Sampling every 5 ms with a threshold of 4 gives a 20 ms debounce time. Sampling on a timer, instead of interrupting on every edge, also protects the CPU from an interrupt storm while the contact bounces.

## Super-loop or RTOS

A cooperative scheduler is a table of tasks and a loop that runs whichever are due. Each task runs to completion, so there is no preemption and almost no shared-data problem. Its limit is that one slow task delays all the others.

A preemptive RTOS gives each task its own stack and switches between them on a timer tick, so a high-priority task runs on time regardless of what the others are doing. The cost is RAM for the stacks and a new class of bugs.

| RTOS concept | What it is | Classic problem |
|---|---|---|
| Task | A function with its own stack and priority | Stack overflow |
| Queue | Thread-safe FIFO between tasks, or from an ISR to a task | Sending a pointer to data that has gone out of scope |
| Binary semaphore | A signal: "something happened" | Missed or doubled signals |
| Mutex | Ownership of a shared resource | Deadlock; priority inversion |
| Tick | The periodic interrupt that drives delays and time slicing | A delay of one tick lasts between zero and one tick period |

**Priority inversion** is the one to be able to explain. A low-priority task holds a mutex that a high-priority task needs. A medium-priority task, which needs nothing, preempts the low one, so the high-priority task is blocked by a task of lower priority for an unbounded time. Priority inheritance fixes it: while the low task holds the mutex, it runs at the priority of the highest task waiting for it.

## Watchdogs

A watchdog timer resets the processor unless the firmware restarts it regularly. It turns a hang into a recovery. Feed it from one place in the main loop, after the work is done, so that it proves the system is making progress. Feeding it from a timer interrupt proves only that interrupts still work, which is the one thing that keeps running when the main loop is stuck.

## Common mistakes

- Comparing `now` with a stored deadline instead of comparing elapsed time with a duration.
- `delay()` in a loop that should be doing other things.
- Forgetting `volatile` on a variable shared with an interrupt, so a waiting loop is optimised into an infinite one.
- Assuming `volatile` makes `x++` safe.
- A critical section that enables interrupts unconditionally on exit.
- Calling `printf` from an interrupt handler.

```quiz
Q: A 32-bit millisecond counter read `0xFFFFFFF0` at the start of an operation and reads `0x00000010` now. How many milliseconds have passed?
- 0, because now is less than start
* 32
- 4294967264
Why: `0x00000010 - 0xFFFFFFF0` in unsigned 32-bit arithmetic is `0x20`, which is 32.
```

```quiz
Q: `static volatile uint32_t ticks;` is incremented in a timer interrupt and read in the main loop on a 32-bit CPU. What does `volatile` provide?
- Atomic increments
- Protection from race conditions
* A fresh read from memory every time the main loop uses it
Why: `volatile` stops the compiler from caching the value. Atomicity is a separate question; a single aligned 32-bit read happens to be atomic on a 32-bit core.
```

```ask
Q: What should and should not be done inside an interrupt handler?
A: Do the minimum: read the data, clear the interrupt source, store the result in a buffer or set a flag, and return. Do not block or delay, do not call non-reentrant functions such as `printf` or `malloc`, and do not do long computations. Deferring work to the main loop or a task keeps the latency of other interrupts low. Data shared with the handler must be `volatile` and accessed with care for atomicity.
```

```ask
Q: Explain priority inversion and how an RTOS deals with it.
A: A high-priority task blocks on a mutex held by a low-priority task. A medium-priority task then preempts the low one, so the high-priority task waits for a task that is less important than itself, for as long as the medium task wants to run. Priority inheritance raises the mutex holder to the priority of the highest waiting task until it releases the mutex, which bounds the delay. Mars Pathfinder is the well-known real-world case.
```
