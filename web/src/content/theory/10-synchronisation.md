# Task synchronisation

## What is real-time task synchronisation?

Synchronisation is how tasks coordinate: either to keep out of each other's way when using shared data (mutual exclusion) or to wait for each other (signalling). In a real-time system it must also be **bounded**: the time a task can be held up waiting has a known maximum.

That is what separates real-time primitives from ordinary ones:

- Waiters are woken in priority order, not arrival order.
- Mutexes support priority inheritance or a priority ceiling, which bounds priority inversion.
- Every blocking call accepts a timeout.
- There are variants that can be called from an ISR and never block.

The failure modes to design against are race conditions, deadlock, priority inversion and starvation.

## How do semaphores synchronise tasks?

A semaphore is a counter with two operations: **take** (wait) decrements it and blocks if it is zero; **give** (signal) increments it and wakes a waiter.

- A **binary semaphore** (0 or 1) signals an event, typically from an ISR to a task.
- A **counting semaphore** tracks how many of something are available, or how many events are pending.

```c
static SemaphoreHandle_t data_ready;       // created with xSemaphoreCreateBinary()

void ADC_IRQHandler(void) {
  BaseType_t woken = pdFALSE;
  xSemaphoreGiveFromISR(data_ready, &woken);     // signal; never blocks
  portYIELD_FROM_ISR(woken);                     // switch at once if a higher-priority task woke
}

void processing_task(void *arg) {
  for (;;) {
    if (xSemaphoreTake(data_ready, pdMS_TO_TICKS(100)) == pdTRUE) process_samples();
    else report_timeout();
  }
}
```

A semaphore has no owner: any context may give it. That makes it right for signalling and wrong for protecting data, which is a mutex's job.

## How do mutexes synchronise tasks?

A mutex (mutual exclusion lock) lets one task at a time into a section of code. A task locks it before using the shared resource and unlocks it after; another task that tries to lock it meanwhile blocks.

```c
static SemaphoreHandle_t i2c_mutex;        // created with xSemaphoreCreateMutex()

err_t sensor_read(uint8_t reg, uint8_t *value) {
  if (xSemaphoreTake(i2c_mutex, pdMS_TO_TICKS(50)) != pdTRUE) return ERR_BUSY;
  err_t result = i2c_read_register(SENSOR_ADDRESS, reg, value);   // the protected section
  xSemaphoreGive(i2c_mutex);
  return result;
}
```

How it differs from a binary semaphore:

- It has an **owner**; only the task that locked it may unlock it.
- It supports **priority inheritance**.
- It must **not be used from an ISR**, because an ISR cannot block and has no task identity.

Rules: hold it briefly, never block for long while holding it, always release on every path, and take multiple mutexes in a fixed order.

## How do message queues synchronise tasks?

A queue is a thread-safe FIFO of fixed-size messages. Sending copies a message in; receiving copies one out and blocks while the queue is empty. It synchronises and transfers data in one step: the receiver sleeps until there is work.

```c
typedef struct { uint8_t source; int16_t value; } reading_t;
static QueueHandle_t readings;             // xQueueCreate(8, sizeof(reading_t))

void sensor_task(void *arg) {
  for (;;) {
    reading_t r = { .source = 1, .value = read_temperature() };
    xQueueSend(readings, &r, 0);                   // do not block if full; drop instead
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}
void logger_task(void *arg) {
  reading_t r;
  for (;;) if (xQueueReceive(readings, &r, portMAX_DELAY) == pdTRUE) log_reading(&r);
}
```

Design choices: the queue length (sized for the worst burst), what the sender does when it is full (block, drop or overwrite), and whether to copy the data or queue a pointer to a pool buffer. ISRs use the `FromISR` variants.

## How do event flags synchronise tasks?

An event group is a set of bits, each standing for one event. Tasks and ISRs set bits; a task can wait for **any** of a chosen set of bits or for **all** of them.

```c
#define EV_NETWORK_UP  (1u << 0)
#define EV_TIME_SYNCED (1u << 1)
static EventGroupHandle_t events;

void uploader_task(void *arg) {
  for (;;) {
    // Wait until both conditions hold; leave the bits set for other tasks.
    EventBits_t bits = xEventGroupWaitBits(events, EV_NETWORK_UP | EV_TIME_SYNCED, pdFALSE, pdTRUE, pdMS_TO_TICKS(5000));
    if ((bits & (EV_NETWORK_UP | EV_TIME_SYNCED)) == (EV_NETWORK_UP | EV_TIME_SYNCED)) upload();
  }
}

void on_link_up(void) { xEventGroupSetBits(events, EV_NETWORK_UP); }
```

They suit conditions that combine ("network up AND time known") and events that several tasks care about, since setting a bit wakes every waiter. They carry no data and do not count: setting a bit twice is the same as setting it once.

## How do condition variables synchronise tasks?

A condition variable lets a task sleep until some condition on shared data becomes true. It is always used with a mutex that protects that data.

```c
pthread_mutex_lock(&lock);
while (count == 0)                         // always a loop: recheck after waking
  pthread_cond_wait(&not_empty, &lock);    // atomically unlocks, sleeps, and relocks on wake
item = buffer[--count];
pthread_mutex_unlock(&lock);

// the producer
pthread_mutex_lock(&lock);
buffer[count++] = item;
pthread_cond_signal(&not_empty);           // wake one waiter
pthread_mutex_unlock(&lock);
```

The key property is that `wait` releases the mutex and goes to sleep in one atomic step, so a signal cannot be missed between checking the condition and sleeping. The `while` loop is required because a waiter can wake when the condition is not true (another task got there first, or a spurious wake-up).

They exist in POSIX systems and some RTOSes (Zephyr, ThreadX). FreeRTOS has none; the same pattern is built from a mutex with a semaphore, event group or task notification.

## What is priority inversion?

Priority inversion is when a high-priority task is forced to wait for a lower-priority one, for longer than the low-priority task's short critical section.

The classic sequence with three tasks, L (low), M (medium) and H (high):

1. L locks a mutex.
2. H becomes ready, pre-empts L, and tries to lock the same mutex. It blocks.
3. M becomes ready. M has a higher priority than L, so it pre-empts L and runs for as long as it likes.
4. H is now waiting for M, a task it has nothing to do with. The delay is unbounded.

This is what repeatedly reset the Mars Pathfinder lander in 1997: a high-priority bus task was blocked on a mutex held by a low-priority task that medium-priority work kept pre-empting, and the watchdog fired.

A semaphore used as a lock has no owner and so cannot be protected against inversion. The fixes are a mutex with priority inheritance or a priority ceiling, or avoiding the shared lock altogether.

## What is priority inheritance?

Priority inheritance is the usual cure for priority inversion. While a high-priority task is blocked on a mutex, the task holding that mutex temporarily runs at the waiter's priority. Medium-priority tasks can no longer pre-empt it, so it finishes its critical section quickly, releases the mutex, and drops back to its own priority.

In the three-task example: when H blocks on the mutex held by L, L is raised to H's priority. M cannot pre-empt it. L unlocks, returns to low priority, and H runs. H's delay is now bounded by the length of L's critical section.

Points to know:

- It is a property of **mutexes**, not semaphores; in FreeRTOS, `xSemaphoreCreateMutex` has it and binary semaphores do not.
- Inheritance is transitive across chains of mutexes.
- It bounds inversion but does not prevent deadlock, and a task can still be blocked once for each mutex it uses.

## What is the priority ceiling protocol?

Each mutex is given a **ceiling**: the priority of the highest-priority task that will ever lock it. There are two forms.

- **Immediate ceiling (priority ceiling emulation, or highest locker)**: a task's priority is raised to the mutex's ceiling the moment it locks it. No task that could want that mutex can then pre-empt it. This is simple and is what most kernels and POSIX (`PTHREAD_PRIO_PROTECT`) implement.
- **Original priority ceiling protocol**: a task may lock a mutex only if its priority is higher than the ceilings of all mutexes currently locked by other tasks; the holder inherits priority when it blocks others.

Compared with priority inheritance:

- A task is blocked **at most once**, by one lower-priority critical section.
- **Deadlock cannot occur** among the mutexes it covers.
- The cost is that ceilings must be worked out in advance, and a task's priority is raised even when nobody is contending.

## What are spinlocks, and when are they used?

A spinlock is a lock on which a waiter does not sleep: it loops ("spins"), testing the lock until it is free.

```c
typedef struct { atomic_flag locked; } spinlock_t;

static inline void spin_lock(spinlock_t *l) {
  while (atomic_flag_test_and_set_explicit(&l->locked, memory_order_acquire)) { /* spin */ }
}
static inline void spin_unlock(spinlock_t *l) { atomic_flag_clear_explicit(&l->locked, memory_order_release); }
```

It makes sense only on **multi-core** systems, for critical sections shorter than the cost of a context switch, and in contexts that cannot sleep, such as interrupt handlers. The holder is running on another core and will release it shortly.

On a single core a spinlock is useless: the waiter spins while the holder cannot run. There, disabling interrupts does the job. On multi-core, a spinlock used by an ISR must be taken with local interrupts disabled, or the ISR can deadlock against the code it interrupted. Never sleep or block while holding one.

## What are reader-writer locks?

A reader-writer lock allows either any number of readers at once or exactly one writer. It suits data that is read often and changed rarely, such as a configuration table or a routing table.

```c
pthread_rwlock_rdlock(&config_lock);     // many tasks may hold this at once
uint32_t rate = config.sample_rate;
pthread_rwlock_unlock(&config_lock);

pthread_rwlock_wrlock(&config_lock);     // exclusive
config.sample_rate = new_rate;
pthread_rwlock_unlock(&config_lock);
```

Trade-offs:

- A policy is needed for who goes next. Favouring readers can starve writers; favouring writers can delay readers.
- It costs more than a mutex, so it only pays when reads are frequent and not trivially short.
- Priority inheritance is hard to apply, because there may be many readers to boost.

Many small RTOSes do not provide one. Alternatives: a plain mutex, or copying a consistent snapshot of the data so readers need no lock.

## What is a rendezvous in message passing?

A rendezvous is synchronous message passing with no buffer. The sender blocks until a receiver is ready to take the message, the receiver blocks until a sender arrives, and when both are present the data is handed over and both continue. In many forms the sender also waits for a reply.

It is the model of Ada's tasking and of QNX's send/receive/reply.

Properties:

- No queue to size and no data sitting in a buffer.
- The sender knows the message was received, and when.
- The two tasks are tightly coupled in time: a slow receiver stalls the sender.
- Deadlock is possible if two tasks send to each other.

In an RTOS without it, the same effect comes from a queue of length one plus an acknowledgement semaphore or a reply queue. In a send/receive/reply kernel, the server inherits the client's priority while it works on the request, which keeps inversion bounded.

## How do priority-based spinlocks work?

An ordinary spinlock grants the lock to whichever waiter happens to win the race when it is released, so a high-priority task on one core can wait behind low-priority tasks on others. A priority-based spinlock orders the waiters.

Approaches:

- **Queued or ticket spinlocks** grant the lock in arrival order. This is fair and bounds the wait to the number of contending cores, and is the usual choice.
- **Priority-ordered spinlocks** keep the waiters sorted and hand the lock to the highest-priority one.

In real-time multi-core kernels, the essential rules matter more than the ordering: the holder runs with pre-emption (and usually interrupts) disabled so that it cannot be descheduled while others spin, and critical sections are kept to a few instructions. With both in place, the worst-case wait is bounded by the number of cores times the longest critical section.

## How do priority-based semaphores work?

When several tasks are blocked on a semaphore and it is given, the kernel must choose which one to wake. A priority-based semaphore wakes the **highest-priority waiter**, with first-come order among equal priorities. The alternative, plain FIFO order, is fairer but lets a low-priority task go ahead of an urgent one.

Real-time kernels use priority order by default (FreeRTOS, ThreadX) or let it be chosen when the semaphore is created (VxWorks).

Remember that waking order does not solve priority inversion. A semaphore has no owner, so the kernel cannot boost whoever is "holding" it. If the semaphore is being used to guard a resource, replace it with a mutex; keep semaphores for signalling and counting.

## How do priority-based condition variables work?

When a condition variable is signalled, a real-time implementation wakes the **highest-priority** waiting task rather than the one that has waited longest. POSIX specifies this for threads under the real-time scheduling policies `SCHED_FIFO` and `SCHED_RR`.

Two further details matter for real-time behaviour:

- The woken task must reacquire the mutex before it continues, so that mutex should use priority inheritance or a ceiling. Otherwise the wake-up can itself suffer priority inversion.
- `broadcast` wakes every waiter and they then compete for the mutex in priority order. Use `signal` when only one waiter can make progress, to avoid a burst of pointless wake-ups.

As always, the waiter rechecks its condition in a `while` loop after waking.

## How do priority-based mutexes work?

A priority-based mutex combines two things:

1. **Priority-ordered waiting**: when it is unlocked, the highest-priority waiting task gets it next.
2. **A protocol against priority inversion**: priority inheritance (the holder is boosted to the highest waiter's priority) or a priority ceiling (the holder is boosted to a preset ceiling on locking).

```c
pthread_mutexattr_t attr;
pthread_mutexattr_init(&attr);
pthread_mutexattr_setprotocol(&attr, PTHREAD_PRIO_INHERIT);    // or PTHREAD_PRIO_PROTECT with a ceiling
pthread_mutex_init(&bus_lock, &attr);
```

In FreeRTOS, mutexes created with `xSemaphoreCreateMutex` already behave this way. The result is that the time a task can be blocked by lower-priority work is bounded by the length of those tasks' critical sections, which is what makes response-time analysis possible.

## How do priority-based reader-writer locks work?

A real-time reader-writer lock decides who enters by priority, not just by arrival:

- A reader is admitted only if no writer of equal or higher priority is waiting. This stops a stream of low-priority readers from holding out an urgent writer.
- When the lock is released, the highest-priority waiter goes next, whether reader or writer.

The difficulty is priority inversion. With one writer holding the lock, inheritance works as for a mutex. With many readers holding it, the kernel would have to boost all of them, which is costly, so some real-time systems limit the lock to one reader at a time under contention, or bound the number of concurrent readers.

Because of that complexity, real-time designs often avoid the lock: readers take a consistent snapshot, or the writer prepares a new copy and swaps a pointer atomically.

## How does a priority-based rendezvous work?

In a priority-based rendezvous, the server takes pending requests in order of the **clients' priority**, not arrival order, and runs at the priority of the client it is serving.

QNX works this way: messages queue on a channel in priority order, and while the server handles a request it inherits the sender's priority. The effect is that a low-priority server cannot be pre-empted by medium-priority tasks while it works for a high-priority client, so the client's wait is bounded. The server's priority drops again when it replies.

Ada's real-time annex offers the same idea: entry queues can be ordered by priority, and a rendezvous executes at the higher of the two tasks' priorities.

The design consequence is that a shared server need not be given a high fixed priority; it takes on the urgency of whoever it is working for.
