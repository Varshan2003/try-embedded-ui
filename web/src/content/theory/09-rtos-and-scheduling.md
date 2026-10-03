# RTOS and scheduling

## What is a real-time operating system (RTOS)?

An RTOS is a small operating system kernel whose purpose is to run several tasks so that each meets its deadline. Its defining property is predictability: the time to respond to an event is bounded and known.

What it provides:

- **Tasks** (threads), each with its own stack and priority.
- **A scheduler**, usually pre-emptive and priority-based: the highest-priority ready task always runs.
- **Synchronisation and communication**: mutexes, semaphores, queues, event flags.
- **Time services**: delays, timeouts, software timers.

Examples are FreeRTOS, Zephyr, ThreadX and RTEMS. Compared with a general-purpose OS such as Linux, an RTOS is far smaller (kilobytes), has no virtual memory, and favours determinism over throughput. Use one when a super-loop can no longer meet the timing or has become hard to maintain.

## How do you handle multi-threading in embedded C?

C has no built-in threads on a microcontroller; the RTOS supplies them as tasks. Each task is a function with an endless loop and its own stack.

```c
void sensor_task(void *arg) {
  (void)arg;
  for (;;) {
    reading_t r = sensor_read();
    xQueueSend(readings, &r, portMAX_DELAY);     // hand the data to another task
    vTaskDelay(pdMS_TO_TICKS(100));              // sleep; other tasks run meanwhile
  }
}

xTaskCreate(sensor_task, "sensor", 256, NULL, 2, NULL);   // stack size in words, priority 2
vTaskStartScheduler();
```

What to get right:

- Size each stack from measurement (the kernel can report the high-water mark).
- Protect shared data with a mutex, or better, pass it through queues.
- Every task must block somewhere, or lower-priority tasks never run.
- Use only re-entrant functions from more than one task.
- Assign priorities by deadline: the shorter the deadline, the higher the priority.

## How do you handle multi-tasking in embedded C?

Multi-tasking means making progress on several jobs at once on one CPU. There are three levels:

1. **Super-loop with state machines.** Each job is a non-blocking function called in turn. No kernel, one stack.
2. **Cooperative scheduling.** A table of tasks with periods; a tick decides which are due, and each runs to completion. Simple and free of most race conditions, but a long task delays the others.
3. **Pre-emptive scheduling with an RTOS.** The kernel switches tasks on a tick or an event, so a high-priority task runs as soon as it is ready. Responsive, but shared data must be protected.

```c
typedef struct { void (*run)(void); uint32_t period_ms, last_ms; } task_t;

static task_t tasks[] = { { read_sensors, 10, 0 }, { update_display, 100, 0 }, { blink, 500, 0 } };

void scheduler_run(void) {                       // cooperative: call from the main loop
  for (size_t i = 0; i < sizeof tasks / sizeof tasks[0]; i++) {
    if (millis() - tasks[i].last_ms >= tasks[i].period_ms) {
      tasks[i].last_ms += tasks[i].period_ms;
      tasks[i].run();
    }
  }
}
```

## What is real-time scheduling?

Real-time scheduling decides which task runs next so that every task meets its deadline, and lets that be proved in advance.

The main policies:

- **Fixed-priority pre-emptive**: each task has a static priority; the highest-priority ready task runs. This is what almost every RTOS implements.
- **Rate-monotonic (RMS)**: a rule for assigning those priorities: the shorter the period, the higher the priority. It is optimal among fixed-priority schemes.
- **Earliest deadline first (EDF)**: priorities are dynamic; the task with the nearest deadline runs. It can use the CPU fully but is harder to implement and degrades unpredictably under overload.
- **Time-triggered (cyclic executive)**: a fixed timetable, common in safety-critical systems.

Schedulability is checked with CPU utilisation, `U = sum(Ci / Ti)` (execution time over period). For RMS with `n` tasks, deadlines are guaranteed if `U <= n(2^(1/n) - 1)`, which tends to 69%; for EDF the bound is 100%.

## How do you implement a priority-based scheduler?

Keep the ready tasks grouped by priority and always run the highest. With a bitmap of which priorities have ready tasks, finding the highest is one instruction.

```c
#define PRIORITIES 32
static tcb_t *ready[PRIORITIES];          // a list of ready tasks per priority
static uint32_t ready_bits;               // bit n set = priority n has a ready task

static tcb_t *pick_next(void) {
  if (ready_bits == 0) return &idle_task;
  int top = 31 - __builtin_clz(ready_bits);      // the highest set bit
  return ready[top];
}

void make_ready(tcb_t *t) {
  list_append(&ready[t->priority], t);
  ready_bits |= 1u << t->priority;
  if (t->priority > current->priority) request_context_switch();   // pre-empt
}
```

The scheduler runs whenever the ready set changes: a task blocks, a task is woken by an ISR or another task, or the tick expires a delay. Tasks of equal priority share by round-robin. The design must also deal with priority inversion, and an idle task must always be ready.

## How do you implement a round-robin scheduler?

Round-robin gives each ready task a fixed time slice in turn. When the slice ends, the running task goes to the back of the queue and the next one runs. It is fair and simple, with no priorities.

```c run
#include <stdio.h>

#define TASKS 3
#define SLICE 2          // ticks per turn

int main(void) {
  int remaining[TASKS] = { 5, 3, 4 };     // work left for each task, in ticks
  int current = 0, done = 0;

  for (int tick = 0; done < TASKS; ) {
    if (remaining[current] > 0) {
      int run = remaining[current] < SLICE ? remaining[current] : SLICE;
      remaining[current] -= run;
      tick += run;
      printf("t=%2d task %d ran %d%s\n", tick, current, run, remaining[current] ? "" : " (finished)");
      if (remaining[current] == 0) done++;
    }
    current = (current + 1) % TASKS;      // move to the next task in the circle
  }
  return 0;
}
```

In a real kernel the tick interrupt counts down the slice and triggers a context switch. A short slice improves responsiveness but spends more time switching. Most RTOSes use round-robin only among tasks of the same priority.

## How do you implement a task scheduler?

A minimal scheduler needs three things: a record per task, a rule for choosing the next task, and a way to switch.

```c
typedef enum { READY, RUNNING, BLOCKED } task_state_t;

typedef struct {
  uint32_t *stack_pointer;     // where this task's saved context is
  task_state_t state;
  uint8_t priority;
  uint32_t wake_tick;          // when a delayed task becomes ready again
} tcb_t;                       // task control block

void tick_handler(void) {
  now++;
  for (int i = 0; i < task_count; i++)
    if (tasks[i].state == BLOCKED && (int32_t)(now - tasks[i].wake_tick) >= 0) tasks[i].state = READY;
  schedule();                  // choose the next task; switch if it differs from the current one
}
```

The **context switch** saves the running task's registers on its stack, stores the stack pointer in its control block, loads the next task's stack pointer and restores its registers. On Cortex-M this is done in the PendSV exception, the lowest-priority one, so it never delays a real interrupt. For a cooperative scheduler none of that is needed: a table of functions and periods is enough.

## How do you implement a real-time scheduler?

A real-time scheduler adds guarantees to an ordinary one: every operation has bounded time, and the timing of tasks can be analysed.

Requirements:

- **Pre-emptive and priority-driven**, so the most urgent ready task runs within a bounded delay.
- **Constant-time decisions**: choosing the next task must not depend on how many tasks exist (a priority bitmap achieves this).
- **Bounded interrupt-disable time** inside the kernel.
- **A precise time base** for periodic release; tasks should wake at absolute times, not "now plus a delay", or their period drifts.
- **Priority inheritance or ceiling** on mutexes.
- **Deadline monitoring**: detect and report a task that overruns.

```c
void control_task(void *arg) {
  TickType_t next = xTaskGetTickCount();
  for (;;) {
    vTaskDelayUntil(&next, pdMS_TO_TICKS(10));   // exactly every 10 ms, no drift
    control_step();
  }
}
```

Assign priorities by rate-monotonic or deadline-monotonic rules, then verify with response-time analysis and measurement.

## How do you implement a real-time operating system kernel?

A minimal kernel has these parts:

1. **Task control blocks and stacks.** Each new task's stack is filled with a fake saved context so that the first switch into it "returns" into the task function.
2. **A scheduler** that picks the highest-priority ready task.
3. **A context switch**, written in assembly: save registers, swap stack pointers, restore registers.
4. **A tick interrupt** from a hardware timer, to run delays and time slicing.
5. **Blocking primitives**: delay, semaphore, mutex, queue. Each moves the caller from the ready list to a wait list and calls the scheduler; the matching "give" moves a waiter back.
6. **Critical sections** protecting the kernel's own lists.
7. **An idle task** that runs when nothing else can, and puts the CPU to sleep.

The hard parts are correctness under interrupts (every list operation can be interrupted), keeping interrupt-disable time short, and getting the port-specific switch exactly right. In practice use an existing kernel; writing one is a learning exercise.

## How do you handle inter-process communication in embedded C?

On a microcontroller the "processes" are tasks and ISRs sharing one address space. The mechanisms:

| Mechanism | Carries | Typical use |
|---|---|---|
| Queue (message queue) | Copies of data | Passing readings or commands between tasks |
| Semaphore | A signal or a count | An ISR telling a task that work is ready |
| Mutex | Ownership | Protecting a shared resource |
| Event flags | Several independent bits | Waiting for any or all of a set of events |
| Task notification | One value to one task | The lightest signal in FreeRTOS |
| Stream or message buffer | A byte stream | A UART ISR feeding a parser task |
| Shared memory | Anything | Large data, guarded by one of the above |

Prefer message passing to shared memory: it keeps ownership clear. On multi-core or multi-processor systems the same ideas are carried over a mailbox, shared memory with inter-processor interrupts, or a framework such as RPMsg. On embedded Linux, processes use pipes, sockets, message queues and shared memory.
