## Why firmware avoids the heap

Desktop programs call `malloc` freely. Firmware usually does not, for reasons that all come from running for years without a restart:

- **Fragmentation.** After many allocations and frees of different sizes, free memory is split into pieces too small to use, and an allocation fails even though enough bytes are free in total.
- **Unpredictable timing.** How long `malloc` takes depends on the state of the heap, which is unacceptable in a control loop.
- **Failure at run time.** A fixed buffer that is too small is found during testing. A heap that runs out is found in the field.

So firmware builds its data structures on memory whose size is fixed at compile time. The structures on this page are the ones you will meet in every code base.

## The ring buffer

A ring buffer is a fixed array used as a queue. A write index and a read index chase each other around the array, wrapping at the end. It is the standard way to pass bytes between an interrupt and the main loop, because neither side ever has to move data.

```text
index:    0    1    2    3    4    5    6    7
        +----+----+----+----+----+----+----+----+
data:   |    |    | 12 | 34 | 56 |    |    |    |
        +----+----+----+----+----+----+----+----+
                    ^              ^
                    tail (read)    head (write)
```

```c run
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>

#define RB_SIZE 8                    // a power of two, so the wrap is a mask

typedef struct {
  uint8_t data[RB_SIZE];
  uint8_t head;                      // next write position
  uint8_t tail;                      // next read position
  uint8_t count;
} ring_t;

static bool ring_put(ring_t *r, uint8_t v) {
  if (r->count == RB_SIZE) return false;          // full: the caller decides what to drop
  r->data[r->head] = v;
  r->head = (r->head + 1) & (RB_SIZE - 1);
  r->count++;
  return true;
}

static bool ring_get(ring_t *r, uint8_t *v) {
  if (r->count == 0) return false;                // empty
  *v = r->data[r->tail];
  r->tail = (r->tail + 1) & (RB_SIZE - 1);
  r->count--;
  return true;
}

int main(void) {
  ring_t r = { 0 };
  for (uint8_t i = 1; i <= 10; i++) {
    if (!ring_put(&r, i)) printf("dropped %u (buffer full)\n", i);
  }
  uint8_t v;
  while (ring_get(&r, &v)) printf("%u ", v);
  printf("\n");
  return 0;
}
```

### Full or empty?

With only two indices, `head == tail` is ambiguous: it describes both an empty and a completely full buffer. There are three standard answers.

| Approach | Capacity | Cost |
|---|---|---|
| Keep a `count`, as above | all `N` slots | `count` is written by both sides, so it needs protecting |
| Leave one slot unused: full when `(head + 1) % N == tail` | `N - 1` slots | none; each index has a single writer |
| Free-running indices, size a power of two: used `= head - tail` | all `N` slots | relies on unsigned wrap-around |

The second and third are lock-free for one producer and one consumer, because the producer only writes `head` and the consumer only writes `tail`. That is what you want between an interrupt and the main loop.

> **Pitfall:** `count++` in the interrupt and `count--` in the main loop are both read-modify-write operations on the same variable. If the interrupt fires in the middle of the main loop's update, one of the two changes is lost and the buffer's bookkeeping is wrong forever.

### Overwriting variant

A log or a trace buffer wants the opposite policy when full: discard the oldest entry and keep the newest. The write always succeeds, and only the count stops growing. The oldest entry is then `count` positions behind the write index.

## Stacks and queues on arrays

A stack needs one index. Push writes at `top` and increments; pop decrements and reads. Check for overflow before a push and for underflow before a pop, and decide what failure means: a `bool` return is the usual answer.

```c
bool stack_push(istack_t *s, int32_t v) {
  if (s->top == STACK_DEPTH) return false;
  s->items[s->top++] = v;
  return true;
}
```

The CPU's own call stack works the same way, with one difference: nothing checks it. A stack overflow on a microcontroller silently overwrites whatever lies below, usually global variables. Projects measure stack use by filling the stack with a pattern at start-up and looking for how much of it survives.

## Linked lists without malloc

A linked list does not need the heap. The nodes can be a static array, or the link can be embedded in the objects themselves, which is called an intrusive list. Kernels and RTOSes use intrusive lists for timers and ready queues because inserting and removing costs no allocation.

```c run
#include <stdio.h>
#include <stdint.h>
#include <stddef.h>

typedef struct node {
  int32_t deadline;
  struct node *next;
} node_t;

// Inserts in ascending order. The pointer-to-pointer removes the special case for the head.
static void insert_sorted(node_t **head, node_t *item) {
  node_t **link = head;
  while (*link != NULL && (*link)->deadline <= item->deadline) link = &(*link)->next;
  item->next = *link;
  *link = item;
}

int main(void) {
  node_t timers[4] = { { 500, NULL }, { 100, NULL }, { 300, NULL }, { 50, NULL } };
  node_t *head = NULL;
  for (int i = 0; i < 4; i++) insert_sorted(&head, &timers[i]);
  for (node_t *n = head; n; n = n->next) printf("%d ", n->deadline);
  printf("\n");
  return 0;
}
```

`link` always points at the pointer that would need to change: first the head, then each node's `next`. Inserting at the front, in the middle and at the end become the same two assignments.

## Memory pools

When objects really must be allocated at run time, a pool of fixed-size blocks avoids every problem of a general heap. All blocks are the same size, so there is no fragmentation, and allocation and release take constant time.

```c run
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#define POOL_BLOCKS 3
#define BLOCK_SIZE 32

static uint8_t storage[POOL_BLOCKS][BLOCK_SIZE];
static bool used[POOL_BLOCKS];

static void *pool_alloc(void) {
  for (size_t i = 0; i < POOL_BLOCKS; i++) {
    if (!used[i]) { used[i] = true; return storage[i]; }
  }
  return NULL;                       // exhausted: the caller must handle it
}

static void pool_free(void *block) {
  size_t i = (size_t)((uint8_t *)block - &storage[0][0]) / BLOCK_SIZE;
  if (i < POOL_BLOCKS) used[i] = false;
}

int main(void) {
  void *a = pool_alloc(), *b = pool_alloc(), *c = pool_alloc();
  printf("fourth allocation: %s\n", pool_alloc() ? "ok" : "NULL");
  pool_free(b);
  printf("after freeing one: %s\n", pool_alloc() == b ? "same block reused" : "different block");
  (void)a; (void)c;
  return 0;
}
```

Production pools keep a free list threaded through the unused blocks, so finding a free one is O(1) too. An even simpler allocator is the arena, or bump allocator: move an offset forward for each allocation and free everything at once. It suits memory that is set up at start-up and never released.

## Bitmaps

A bitmap stores one flag per bit, so 256 flags take 32 bytes instead of 256. Bit `n` lives in byte `n / 8` at position `n % 8`.

```c
static inline void bitmap_set(uint8_t *map, size_t bit)   { map[bit / 8] |= (uint8_t)(1u << (bit % 8)); }
static inline void bitmap_clear(uint8_t *map, size_t bit) { map[bit / 8] &= (uint8_t)~(1u << (bit % 8)); }
static inline bool bitmap_test(const uint8_t *map, size_t bit) { return (map[bit / 8] >> (bit % 8)) & 1u; }
```

Allocators, file systems and RTOS schedulers use them. With 32-bit words and a count-trailing-zeros instruction, finding the first free slot or the highest-priority ready task takes constant time.

## Choosing a structure

| Need | Structure | Insert | Remove | Extra memory |
|---|---|---|---|---|
| Bytes between an ISR and a task | Ring buffer | O(1) | O(1) | two indices |
| Last-in, first-out | Array stack | O(1) | O(1) | one index |
| Ordered by time or priority, few items | Sorted array or list | O(n) | O(1) | none, or one pointer per item |
| Objects created and destroyed at run time | Block pool | O(1) | O(1) | one flag or link per block |
| Many yes/no flags | Bitmap | O(1) | O(1) | one bit each |

## Common mistakes

- Sizing a ring buffer that is not a power of two and then wrapping with a mask.
- Forgetting that the "one slot unused" design holds `N - 1` items.
- Sharing a `count` between an interrupt and the main loop without protection.
- Unsigned index arithmetic that goes below zero: `(head - 1) % N` is wrong for `head == 0`; write `(head + N - 1) % N`.
- Treating a full buffer as impossible instead of deciding what to drop.

```quiz
Q: A ring buffer has 8 slots and uses "one slot unused" to tell full from empty. How many items can it hold?
- 8
* 7
- 6
Why: The buffer is full when advancing the write index would make it equal to the read index, which leaves one slot empty.
```

```quiz
Q: Why is a fixed-block pool preferred to `malloc` in long-running firmware?
- It is always faster to write
* It cannot fragment and its timing is constant
- It needs no memory
Why: Equal-sized blocks can always be reused for any request, and allocation is a simple lookup with a bounded cost.
```

```ask
Q: How would you make a ring buffer safe between a UART receive interrupt and the main loop without disabling interrupts?
A: Use a single-producer, single-consumer design in which each index has exactly one writer: the interrupt only writes `head`, the main loop only writes `tail`, and neither keeps a shared count. Store the data before publishing the new `head`, so the consumer never sees an index for a byte that is not there yet. The indices must be a type the CPU can read and write in one instruction, and they should be `volatile` because they change outside the reader's flow of control.
```

```ask
Q: Reverse a singly linked list. Which version would you write for an MCU and why?
A: The iterative one: walk the list with three pointers (previous, current, next), re-pointing each link as you go. It uses constant stack. The recursive version is shorter but needs one stack frame per node, which is a risk when the stack is a few hundred bytes and the list length is not bounded.
```
