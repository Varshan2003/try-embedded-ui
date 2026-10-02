## Memory is a row of numbered boxes

Every variable lives somewhere in the chip's memory. Picture memory as a very long row of boxes, each holding one byte and each with a number. That number is the box's **address**.

When you declare `int count = 5;` the compiler picks some boxes for `count` and puts 5 in them. Normally you never need to know which boxes. Sometimes it is exactly what you need.

A **pointer** is a variable that holds an address. That is all it is. Instead of holding a temperature or a count, it holds the location of another variable.

## Two new operators

| Operator | Read it as | Meaning |
|---|---|---|
| `&x` | "address of x" | Where `x` lives |
| `*p` | "the value p points to" | The variable at the address stored in `p` |

```c run
#include <stdio.h>

int main(void) {
  int count = 5;
  int *p = &count;                   // p holds the address of count

  printf("count is %d\n", count);
  printf("count lives at %p\n", (void *)p);
  printf("the value at that address is %d\n", *p);

  *p = 9;                            // store 9 at that address
  printf("count is now %d\n", count);
  return 0;
}
```

Read the declaration `int *p` as "p is a pointer to an int". After `p = &count`, the names `*p` and `count` refer to the same boxes. Changing one changes the other, because there is only one variable.

| Name | Holds | Example value |
|---|---|---|
| `count` | a number | 9 |
| `p` | the address of `count` | `0x2000FFE8` |
| `*p` | whatever is at that address | 9 |

The address printed is in RAM, which starts at `0x20000000` on this simulated chip. You never choose these numbers yourself.

## What pointers are for

In the Functions guide you saw that a function receives copies of its arguments and cannot change the caller's variables. Pointers are the way round that. Give the function the address of a variable, and it can reach the original.

```c run
#include <stdio.h>

void set_to_zero_wrong(int value) {
  value = 0;                         // changes a copy
}

void set_to_zero(int *value) {
  *value = 0;                        // changes the variable at that address
}

int main(void) {
  int a = 7, b = 7;
  set_to_zero_wrong(a);
  set_to_zero(&b);                   // pass the address of b
  printf("a = %d, b = %d\n", a, b);
  return 0;
}
```

The second function has `int *` as its parameter type, and the caller passes `&b`. Those two go together. If a function wants a pointer, you give it an address.

## Returning more than one result

`return` hands back a single value. A function that needs to produce two takes the addresses of two variables and fills them in. Parameters used like this are called output parameters.

```c run
#include <stdio.h>

void divide(int total, int parts, int *quotient, int *remainder) {
  *quotient = total / parts;
  *remainder = total % parts;
}

int main(void) {
  int q = 0, r = 0;
  divide(17, 5, &q, &r);
  printf("17 divided by 5 is %d remainder %d\n", q, r);
  return 0;
}
```

## The pointer that points to nothing

A pointer can hold the special value `NULL`, meaning "this does not point at anything". Functions return it to say "not found", and careful code sets unused pointers to it.

Following a `NULL` pointer is an error. On a microcontroller the program stops dead. Run this to see what the simulator reports.

```c run fails
#include <stdio.h>

int main(void) {
  int *p = NULL;
  printf("%d\n", *p);                // there is nothing at this address
  return 0;
}
```

So a function that is handed a pointer checks it first.

```c run
#include <stdio.h>

int value_or(const int *p, int fallback) {
  if (p == NULL) {
    return fallback;
  }
  return *p;
}

int main(void) {
  int reading = 42;
  printf("%d\n", value_or(&reading, -1));
  printf("%d\n", value_or(NULL, -1));
  return 0;
}
```

The word `const` in `const int *p` promises that the function only reads through the pointer and does not change the variable.

## Arrays were pointers all along

In the last guide you saw that an array is not copied when it is passed to a function. Here is why. Passing an array really passes the address of its first element. The function receives a pointer.

That is also why a function cannot know how long an array is. It has been told where the array starts and nothing more.

```c run
#include <stdio.h>

int first_element(const int *values) {
  return *values;                    // the value at the start of the array
}

int main(void) {
  int data[3] = { 10, 20, 30 };
  int *p = data;                     // the array's name gives the address of data[0]

  printf("%d %d\n", first_element(data), *p);
  printf("%d\n", p[2]);              // a pointer can be indexed like an array
  return 0;
}
```

`&data[1]` is the address of one particular element, so a function can also hand back a pointer into an array.

## One trap to remember

The `*` and `++` operators interact in a way that catches everyone once.

| Expression | What it does |
|---|---|
| `(*p)++` | Adds one to the value `p` points to |
| `*p++` | Moves the pointer `p` along, and leaves the value alone |

When you mean "increase the value", write the parentheses, or write `*p += 1`.

## Where this leads

You now know enough to read almost any C code. The hardware itself is reached through pointers. A peripheral's control register sits at a fixed address, and firmware switches a pin by writing through a pointer to that address. That is where the next part of this course begins.

## Common mistakes

- Using a pointer that was never given an address. Set it to something real, or to `NULL`.
- Following a `NULL` pointer without checking it.
- Forgetting the `&` when calling a function that wants an address.
- Forgetting the `*` when you want the value rather than the address.
- Writing `*p++` when you meant `(*p)++`.

```quiz
Q: After `int x = 3; int *p = &x; *p = 8;` what is `x`?
- 3
* 8
- An address
Why: `p` points at `x`, so storing through `*p` changes `x` itself.
```

```quiz
Q: A function is declared `void reset(int *value);`. How do you call it for a variable `count`?
- `reset(count);`
- `reset(*count);`
* `reset(&count);`
Why: The function wants an address, and `&count` is the address of `count`.
```

```ask
Q: Why does C need pointers at all?
A: For three reasons. Functions receive copies of their arguments, so a pointer is the only way for a function to change a caller's variable or return several results. Large data such as arrays and structures would be expensive to copy, and passing an address is cheap. And hardware registers live at fixed memory addresses, so reading a sensor or driving a pin means reading or writing through a pointer to that address.
```
