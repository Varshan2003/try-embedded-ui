## Functions have addresses too

A function pointer holds the address of a function, so the function to call can be chosen at run time. That one idea is behind interrupt vector tables, callbacks, driver interfaces and state machines.

The declaration syntax is the hard part. Read it from the name outwards: `int (*op)(int, int)` says `op` is a pointer to a function taking two `int`s and returning `int`. A `typedef` makes it readable.

```c run
#include <stdio.h>
#include <stdint.h>

typedef int32_t (*binary_op_t)(int32_t, int32_t);

static int32_t add(int32_t a, int32_t b) { return a + b; }
static int32_t sub(int32_t a, int32_t b) { return a - b; }

static int32_t apply(binary_op_t op, int32_t a, int32_t b) {
  return op(a, b);              // call through the pointer
}

int main(void) {
  binary_op_t op = add;         // a function name decays to its address
  printf("%d\n", apply(op, 7, 3));
  op = sub;
  printf("%d\n", apply(op, 7, 3));
  return 0;
}
```

`add` and `&add` are the same value, and `op(a, b)` and `(*op)(a, b)` are the same call.

> **Pitfall:** Without the parentheses, `int *op(int, int)` declares a function that returns `int *`. The parentheses around `*op` are what make it a pointer.

## Callbacks

A callback is a function you hand to another module so that it can call you back when something happens. The module does not need to know who is listening, which keeps drivers independent of application code.

```c run
#include <stdio.h>
#include <stdint.h>
#include <stddef.h>

typedef void (*rx_callback_t)(uint8_t byte, void *context);

static rx_callback_t on_rx;
static void *on_rx_context;

static void uart_set_callback(rx_callback_t cb, void *context) {
  on_rx = cb;
  on_rx_context = context;
}

// Stands in for the receive interrupt.
static void uart_isr(uint8_t byte) {
  if (on_rx != NULL) on_rx(byte, on_rx_context);
}

typedef struct { uint32_t count; uint32_t sum; } stats_t;

static void count_bytes(uint8_t byte, void *context) {
  stats_t *s = context;
  s->count++;
  s->sum += byte;
}

int main(void) {
  stats_t stats = { 0, 0 };
  uart_set_callback(count_bytes, &stats);
  uart_isr(10);
  uart_isr(20);
  uart_isr(30);
  printf("%u bytes, sum %u\n", stats.count, stats.sum);
  return 0;
}
```

Two details are worth copying:

- **Check for `NULL` before calling.** Jumping through a null function pointer on a Cortex-M ends in a HardFault.
- **Pass a context pointer.** The `void *` lets the callback reach its own state without a global variable, so the same callback can serve two UARTs. It is C's substitute for a closure.

## Dispatch tables

An array of function pointers indexed by a number replaces a long `switch`. The table is data: it can be `const`, so it lives in flash, and adding an entry does not touch the dispatch code.

```c run
#include <stdio.h>
#include <stdint.h>

static void cmd_status(void) { printf("status: ok\n"); }
static void cmd_reset(void)  { printf("resetting\n"); }
static void cmd_version(void) { printf("v1.2.0\n"); }

typedef void (*handler_t)(void);

static const handler_t handlers[] = { cmd_status, cmd_reset, cmd_version };
#define HANDLER_COUNT (sizeof handlers / sizeof handlers[0])

static void dispatch(uint8_t opcode) {
  if (opcode >= HANDLER_COUNT) {          // never index a table with an unchecked value
    printf("unknown opcode %u\n", opcode);
    return;
  }
  handlers[opcode]();
}

int main(void) {
  dispatch(2);
  dispatch(0);
  dispatch(9);
  return 0;
}
```

An unchecked index into a table of function pointers is a jump to an arbitrary address, so the bounds check is not optional. The interrupt vector table at the start of a Cortex-M image is exactly this structure, indexed by exception number.

A table of structs pairs each function with its metadata. This is the usual shape of a command-line shell:

```c
typedef struct {
  const char *name;
  int (*handler)(int argc, char **argv);
  const char *help;
} command_t;
```

## State machines

Most firmware is a set of state machines: a protocol parser, a button, a motor controller, a connection. The states, the events and the transitions are worth drawing before any code is written.

### The switch form

A state variable and a `switch`. Simple, fast and easy to step through in a debugger. It gets unwieldy when there are many states.

```c run
#include <stdio.h>

typedef enum { ST_IDLE, ST_RUNNING, ST_FAULT } state_t;
typedef enum { EV_START, EV_STOP, EV_OVERCURRENT, EV_RESET } event_t;

static state_t step(state_t s, event_t e) {
  switch (s) {
    case ST_IDLE:    return e == EV_START ? ST_RUNNING : s;
    case ST_RUNNING: return e == EV_STOP ? ST_IDLE : e == EV_OVERCURRENT ? ST_FAULT : s;
    case ST_FAULT:   return e == EV_RESET ? ST_IDLE : s;     // latched until reset
  }
  return s;
}

int main(void) {
  static const char *names[] = { "IDLE", "RUNNING", "FAULT" };
  const event_t events[] = { EV_START, EV_OVERCURRENT, EV_START, EV_RESET };
  state_t s = ST_IDLE;
  for (int i = 0; i < 4; i++) {
    s = step(s, events[i]);
    printf("%s\n", names[s]);
  }
  return 0;
}
```

### The table form

The transitions become a two-dimensional array indexed by state and event. Every combination is visible at once, which makes missing transitions obvious, and the table can be reviewed against the diagram.

```c
static const state_t next[3][4] = {
  /*              START       STOP      OVERCURRENT  RESET   */
  /* IDLE    */ { ST_RUNNING, ST_IDLE,  ST_IDLE,     ST_IDLE },
  /* RUNNING */ { ST_RUNNING, ST_IDLE,  ST_FAULT,    ST_RUNNING },
  /* FAULT   */ { ST_FAULT,   ST_FAULT, ST_FAULT,    ST_IDLE },
};
```

### The function-pointer form

Each state is a function, and the object stores a pointer to its current state's handler. Dispatching an event is a single indirect call. Each handler contains only the events that state cares about, and adding a state does not touch the others.

```c run
#include <stdio.h>
#include <stdint.h>

typedef enum { EV_TICK, EV_BUTTON } event_t;
typedef struct blinker blinker_t;
typedef void (*state_fn)(blinker_t *self, event_t ev);

struct blinker {
  state_fn state;
  uint8_t ticks;
};

static void state_off(blinker_t *self, event_t ev);
static void state_on(blinker_t *self, event_t ev);

static void state_off(blinker_t *self, event_t ev) {
  if (ev == EV_BUTTON) {
    printf("LED on\n");
    self->ticks = 0;
    self->state = state_on;
  }
}

static void state_on(blinker_t *self, event_t ev) {
  if (ev == EV_TICK && ++self->ticks == 3) {   // switch off by itself after 3 ticks
    printf("LED off\n");
    self->state = state_off;
  }
}

int main(void) {
  blinker_t b = { state_off, 0 };
  const event_t events[] = { EV_TICK, EV_BUTTON, EV_TICK, EV_TICK, EV_TICK, EV_TICK };
  for (int i = 0; i < 6; i++) b.state(&b, events[i]);
  return 0;
}
```

| Form | Good for | Watch out for |
|---|---|---|
| `switch` | A handful of states | Grows into one enormous function |
| Table | Many states, few actions; safety reviews | Actions need a second table or extra code |
| Function per state | States with rich behaviour; several instances | One indirect call per event; harder to see the whole machine at once |

Whichever form you choose, keep the transition logic free of I/O where you can. A pure `next = step(state, event)` function can be unit-tested on a PC, which is how the practice problems test yours.

## Common mistakes

- Calling a function pointer that may be `NULL`.
- Indexing a dispatch table with a value that came from outside without checking its range.
- A callback type that does not match the function assigned to it. Calling through a mismatched pointer is undefined behaviour.
- Doing long work inside a callback that runs in interrupt context.
- A state machine with no default: an unexpected event should be ignored or handled deliberately, never left to chance.

```quiz
Q: What does `void (*table[4])(int);` declare?
- A function returning a pointer to an array of four `void`
- A pointer to a function that takes an array of four `int`s
* An array of four pointers to functions that take an `int` and return nothing
Why: Start at the name: `table` is an array of 4 (`[4]`) of pointers (`*`) to functions taking `int` and returning `void`.
```

```quiz
Q: Why do callback interfaces usually include a `void *context` parameter?
- To make the call faster
* So the callback can reach its own state without global variables
- Because C requires it for function pointers
Why: The registering code supplies the context and gets it back on every call, which lets one function serve several instances.
```

```ask
Q: What are the trade-offs between a switch-based and a table-driven state machine?
A: A switch is the most direct translation of the diagram, easy to debug, and lets each transition run arbitrary code, but with many states it becomes long and it is easy to forget a combination. A table makes every state and event pair explicit, lives in flash, and is easy to review or even generate from a specification; actions need extra machinery, and the indirection makes it slightly harder to follow in a debugger. For a small machine use a switch; for a large or safety-relevant one, a table.
```

```ask
Q: How does a microcontroller know which function to run when an interrupt occurs?
A: Through the vector table, an array of function addresses at a fixed location, normally the start of flash. Each exception and interrupt number indexes one entry. When the interrupt is taken, the CPU saves context, loads the address from the table and jumps to it. The first two entries on a Cortex-M are the initial stack pointer and the reset handler, which is how the device starts running your code.
```
