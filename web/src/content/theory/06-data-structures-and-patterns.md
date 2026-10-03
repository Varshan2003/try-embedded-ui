# Data structures and firmware patterns

## How do you implement a circular buffer?

A circular (ring) buffer is a fixed array used as a first-in, first-out queue. A head index marks where to write and a tail index where to read; both wrap to the start at the end of the array.

```c run
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>

#define RB_SIZE 8u                     // a power of two, so wrapping is a mask

typedef struct {
  uint8_t data[RB_SIZE];
  volatile uint32_t head;              // written only by the producer
  volatile uint32_t tail;              // written only by the consumer
} ring_t;

static bool rb_put(ring_t *rb, uint8_t byte) {
  if (rb->head - rb->tail == RB_SIZE) return false;     // full
  rb->data[rb->head & (RB_SIZE - 1u)] = byte;
  rb->head++;
  return true;
}
static bool rb_get(ring_t *rb, uint8_t *out) {
  if (rb->head == rb->tail) return false;               // empty
  *out = rb->data[rb->tail & (RB_SIZE - 1u)];
  rb->tail++;
  return true;
}

int main(void) {
  ring_t rb = { .head = 0, .tail = 0 };
  for (uint8_t i = 1; i <= 10; i++) if (!rb_put(&rb, i)) printf("full at %u\n", i);
  uint8_t v;
  while (rb_get(&rb, &v)) printf("%u ", v);
  printf("\n");
  return 0;
}
```

With one producer (say a UART ISR) and one consumer (the main loop), each index is written by only one side, so no lock is needed. Decide what happens when it is full: drop the new byte, overwrite the oldest, or apply flow control.

## How do you implement a finite state machine?

A state machine is in exactly one state at a time and moves between states in response to events. The simplest form is an enum for the state and a `switch`.

```c run
#include <stdio.h>

typedef enum { ST_IDLE, ST_RUNNING, ST_FAULT } state_t;
typedef enum { EV_START, EV_STOP, EV_ERROR, EV_RESET } event_t;

static state_t step(state_t s, event_t e) {
  switch (s) {
    case ST_IDLE:
      if (e == EV_START) return ST_RUNNING;
      break;
    case ST_RUNNING:
      if (e == EV_STOP) return ST_IDLE;
      if (e == EV_ERROR) return ST_FAULT;
      break;
    case ST_FAULT:
      if (e == EV_RESET) return ST_IDLE;
      break;
  }
  return s;                              // every other event is ignored
}

int main(void) {
  const event_t script[] = { EV_START, EV_ERROR, EV_START, EV_RESET, EV_START };
  state_t s = ST_IDLE;
  for (unsigned i = 0; i < sizeof script / sizeof script[0]; i++) {
    s = step(s, script[i]);
    printf("%d ", s);
  }
  printf("\n");
  return 0;
}
```

State machines suit protocol parsers, button handling, motor and mode control: any logic that waits. They are non-blocking, easy to draw and review, and every state and event combination has a defined answer.

## How do you implement a state transition table?

A table makes the machine data instead of code: each row says "in this state, on this event, run this action and go to that state". Adding behaviour means adding a row.

```c run
#include <stdio.h>

typedef enum { ST_IDLE, ST_RUNNING, ST_FAULT, ST_COUNT } state_t;
typedef enum { EV_START, EV_STOP, EV_ERROR, EV_COUNT } event_t;

static void motor_on(void)  { printf("on "); }
static void motor_off(void) { printf("off "); }
static void none(void)      { }

typedef struct { state_t next; void (*action)(void); } transition_t;

static const transition_t table[ST_COUNT][EV_COUNT] = {
  /*              START                   STOP                    ERROR              */
  [ST_IDLE]    = { { ST_RUNNING, motor_on }, { ST_IDLE, none },      { ST_FAULT, none } },
  [ST_RUNNING] = { { ST_RUNNING, none },     { ST_IDLE, motor_off }, { ST_FAULT, motor_off } },
  [ST_FAULT]   = { { ST_FAULT, none },       { ST_IDLE, none },      { ST_FAULT, none } },
};

int main(void) {
  state_t s = ST_IDLE;
  const event_t script[] = { EV_START, EV_ERROR, EV_STOP, EV_START, EV_STOP };
  for (unsigned i = 0; i < 5; i++) {
    const transition_t *t = &table[s][script[i]];
    t->action();
    s = t->next;
  }
  printf("-> state %d\n", s);
  return 0;
}
```

The table is `const`, so it lives in flash, and the compiler forces every state and event pair to be filled in. A `switch` is clearer for small machines; a table scales better.

## How do you implement a circular linked list?

In a circular list the last node points back to the first, so there is no end: starting anywhere and following `next` visits every node and returns to the start. Firmware allocates the nodes statically.

```c run
#include <stdio.h>
#include <stddef.h>

typedef struct node { int id; struct node *next; } node_t;

static node_t *insert_after(node_t *tail, node_t *n) {
  if (tail == NULL) { n->next = n; return n; }     // the first node points to itself
  n->next = tail->next;
  tail->next = n;
  return n;                                        // the new tail
}

int main(void) {
  static node_t nodes[3] = { { 1, NULL }, { 2, NULL }, { 3, NULL } };
  node_t *tail = NULL;
  for (int i = 0; i < 3; i++) tail = insert_after(tail, &nodes[i]);

  node_t *p = tail->next;                          // the head is tail->next
  for (int i = 0; i < 7; i++) { printf("%d ", p->id); p = p->next; }   // goes round and round
  printf("\n");
  return 0;
}
```

Keeping a pointer to the tail gives the head for free and makes appending constant-time. The classic use is a round-robin scheduler's task list. When traversing, stop when the pointer returns to where it started, not on `NULL`.

## How do you implement a priority queue?

A priority queue always returns the highest-priority item next. For small fixed sizes a sorted array is enough; for larger ones a binary heap gives `O(log n)` insert and remove with no extra memory.

```c run
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>

#define CAPACITY 8

typedef struct { uint8_t items[CAPACITY]; uint8_t count; } pq_t;    // a max-heap in an array

static void swap(uint8_t *a, uint8_t *b) { uint8_t t = *a; *a = *b; *b = t; }

static bool pq_push(pq_t *q, uint8_t priority) {
  if (q->count == CAPACITY) return false;
  uint8_t i = q->count++;
  q->items[i] = priority;
  while (i > 0 && q->items[(i - 1) / 2] < q->items[i]) {     // sift up
    swap(&q->items[i], &q->items[(i - 1) / 2]);
    i = (uint8_t)((i - 1) / 2);
  }
  return true;
}
static bool pq_pop(pq_t *q, uint8_t *out) {
  if (q->count == 0) return false;
  *out = q->items[0];
  q->items[0] = q->items[--q->count];
  for (uint8_t i = 0;;) {                                    // sift down
    uint8_t l = (uint8_t)(2 * i + 1), r = (uint8_t)(l + 1), top = i;
    if (l < q->count && q->items[l] > q->items[top]) top = l;
    if (r < q->count && q->items[r] > q->items[top]) top = r;
    if (top == i) break;
    swap(&q->items[i], &q->items[top]);
    i = top;
  }
  return true;
}

int main(void) {
  pq_t q = { .count = 0 };
  const uint8_t in[] = { 20, 50, 10, 40, 30 };
  for (unsigned i = 0; i < 5; i++) pq_push(&q, in[i]);
  uint8_t v;
  while (pq_pop(&q, &v)) printf("%u ", v);
  printf("\n");
  return 0;
}
```

Uses: an RTOS ready list, a timer list ordered by expiry, and event queues. When there are only a few priority levels, a bitmap with one FIFO per level is faster still.

## How do you implement message passing?

Message passing lets contexts communicate by sending copies of data through a queue instead of sharing variables. The sender and receiver never touch the same memory at the same time, which removes most locking.

```c
typedef struct { uint8_t type; uint8_t length; uint8_t payload[14]; } message_t;

#define QUEUE_LENGTH 8u
static message_t queue[QUEUE_LENGTH];
static volatile uint32_t head, tail;

bool msg_send(const message_t *m) {              // called by the producer
  if (head - tail == QUEUE_LENGTH) return false;
  queue[head % QUEUE_LENGTH] = *m;               // copy the message in
  head++;
  return true;
}
bool msg_receive(message_t *out) {               // called by the consumer
  if (head == tail) return false;
  *out = queue[tail % QUEUE_LENGTH];
  tail++;
  return true;
}
```

Under an RTOS use its queue (`xQueueSend` and `xQueueReceive` in FreeRTOS), which also blocks the receiver until a message arrives and wakes it when one does. For large data, pass a pointer to a pool-allocated buffer and transfer ownership with it.

## How do you debounce a mechanical switch in software?

A mechanical contact bounces for a few milliseconds when it changes, producing a burst of edges. Debouncing accepts a new state only after the input has been stable for long enough.

```c run
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>

#define STABLE_SAMPLES 3

typedef struct { bool state; bool last_raw; uint8_t count; } debounce_t;

static bool debounce(debounce_t *d, bool raw) {       // call at a fixed rate, for example every 5 ms
  if (raw != d->last_raw) { d->last_raw = raw; d->count = 0; }      // it moved: start again
  else if (d->count < STABLE_SAMPLES && ++d->count == STABLE_SAMPLES) d->state = raw;
  return d->state;
}

int main(void) {
  debounce_t d = { false, false, 0 };
  const int samples[] = { 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0 };
  for (unsigned i = 0; i < 15; i++) printf("%d", debounce(&d, samples[i]));
  printf("\n");
  return 0;
}
```

Sample from a periodic timer rather than using an edge interrupt, which would fire on every bounce. An RC filter with a Schmitt-trigger input does the same job in hardware.

## What is the super-loop architecture, and when is it not enough?

A super-loop (bare-metal main loop) initialises the hardware and then calls each job in turn, forever. Interrupts handle urgent events and set flags for the loop to act on.

```c
int main(void) {
  board_init();
  for (;;) {
    if (rx_flag)       { rx_flag = false; handle_command(); }
    if (tick_10ms)     { tick_10ms = false; control_step(); }
    update_display();
    watchdog_kick();
  }
}
```

It is simple, uses one stack, and has no context-switch cost. It stops being enough when:

- One slow job delays everything after it, so response time equals the longest pass of the loop.
- Jobs have very different deadlines and need priorities.
- Blocking code (a network stack, a file system) is needed.

The next steps are a cooperative scheduler that runs jobs from a table at set periods, and then a pre-emptive RTOS.
