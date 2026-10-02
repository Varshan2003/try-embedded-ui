## Why functions

A program written as one long list of statements quickly becomes impossible to follow. Functions let you give a name to a piece of work, write it once and use it wherever it is needed.

A function has four parts.

```c
int add(int a, int b) {     // result type, name, parameters
  return a + b;             // body
}
```

| Part | In the example | Meaning |
|---|---|---|
| Result type | `int` | The kind of value it hands back |
| Name | `add` | What you write to use it |
| Parameters | `int a, int b` | The inputs, each with a type and a name |
| Body | `return a + b;` | The statements that do the work |

## Calling a function

To use a function, write its name followed by the values for its parameters. Those values are called arguments.

```c run
#include <stdio.h>

int square(int x) {
  return x * x;
}

int main(void) {
  int side = 6;
  int area = square(side);
  printf("area = %d\n", area);
  printf("%d\n", square(3) + square(4));
  return 0;
}
```

A call can be used anywhere a value can. The call runs the function, and the returned value takes its place in the expression.

## Parameters are copies

When you call a function, each argument is copied into the matching parameter. The function works on its own copies. Whatever it does to them, the caller's variables are not affected.

```c run
#include <stdio.h>

void try_to_change(int value) {
  value = 99;                        // changes only this function's copy
  printf("inside: %d\n", value);
}

int main(void) {
  int number = 5;
  try_to_change(number);
  printf("outside: %d\n", number);
  return 0;
}
```

This is called passing by value. A function hands information back through its return value. The last guide in this track shows the other way, pointers.

## return

`return` ends the function immediately and hands back a value. Nothing after it in that function runs.

```c run
#include <stdio.h>

int larger(int a, int b) {
  if (a > b) {
    return a;        // leaves the function here
  }
  return b;          // reached only when the if was false
}

int main(void) {
  printf("%d\n", larger(8, 3));
  printf("%d\n", larger(2, 9));
  return 0;
}
```

A function that hands nothing back is declared `void`. It can still use a bare `return;` to leave early.

Functions that answer a question return `bool`, which holds `true` or `false`.

```c
bool is_overheating(int temperature) {
  return temperature > 80;       // the comparison is already true or false
}
```

## Declare before use

The compiler reads a file from top to bottom. When it meets a call, it must already know that the function exists. So either define the function above the code that calls it, or tell the compiler about it first with a declaration.

A declaration, also called a prototype, is the first line of the function followed by a semicolon.

```c run
#include <stdio.h>

int triple(int x);               // declaration: "this exists, the body comes later"

int main(void) {
  printf("%d\n", triple(7));
  return 0;
}

int triple(int x) {              // definition
  return x * 3;
}
```

Delete the declaration line and run it again to see the error. This is also what `#include <stdio.h>` is for. That file contains the declaration of `printf`.

## Where a variable lives

A variable exists only inside the braces where it is declared. This region is called its **scope**.

- A variable declared inside a function is **local**. It is created when the function is called and disappears when the function returns. Other functions cannot see it.
- A variable declared outside all functions is **global**. It exists for the whole run, and every function can read and change it.

```c run
#include <stdio.h>

int total_presses = 0;           // global: shared by every function

void button_pressed(void) {
  int bonus = 1;                 // local: exists only during this call
  total_presses += bonus;
}

int main(void) {
  button_pressed();
  button_pressed();
  button_pressed();
  printf("presses: %d\n", total_presses);
  return 0;
}
```

Globals are convenient and risky, because any function anywhere can change them. Keep them few, and prefer passing values in and returning results.

## Remembering between calls with static

Sometimes one function needs to remember something between calls, and nothing else should touch it. A local variable marked `static` does that. It is created once and keeps its value.

```c run
#include <stdio.h>

int next_id(void) {
  static int id = 0;             // set up once, then kept between calls
  id++;
  return id;
}

int main(void) {
  printf("%d ", next_id());
  printf("%d ", next_id());
  printf("%d\n", next_id());
  return 0;
}
```

Remove the word `static` and run it again. Every call now starts from 0, so the function always returns 1.

| Kind | Where declared | Lives | Who can use it |
|---|---|---|---|
| Local | Inside a function | During one call | That function |
| Static local | Inside a function, with `static` | The whole run | That function |
| Global | Outside all functions | The whole run | Every function |

## Writing good functions

- **One job each.** If you need the word "and" to describe a function, it is probably two functions.
- **Name it after what it does.** `read_temperature`, `is_valid`, `set_speed`.
- **Keep it short.** A function you can see all at once is a function you can check.
- **Build on helpers.** `distance(a, b)` can call `absolute(a - b)` and stay one line long.

Small functions can be tested one at a time. That is exactly what the practice problems do. Each test calls one function and checks one answer.

## Common mistakes

- Forgetting `return` in a function that should hand back a value.
- Expecting a function to change the variable you passed in.
- Calling a function before the compiler has seen it.
- Using a global where a parameter and a return value would do.
- Printing a result when the caller needed it returned.

```quiz
Q: `void reset(int x) { x = 0; }` is called as `reset(count);` with `count` equal to 7. What is `count` afterwards?
- 0
* 7
- It is undefined
Why: The function receives a copy of `count`. Setting the copy to 0 does not affect the original.
```

```quiz
Q: What does `static` do to a variable declared inside a function?
- Makes it visible to every function
- Stops it from ever changing
* Makes it keep its value between calls
Why: A static local is created once and persists, while remaining visible only inside its function.
```

```ask
Q: What is the difference between declaring and defining a function?
A: A declaration, or prototype, states the function's name, parameter types and result type and ends with a semicolon. It tells the compiler the function exists. A definition includes the body and is the actual code. There may be many declarations and exactly one definition. Header files hold declarations so that several source files can call the same function.
```
