## Making decisions with if

So far every statement has run, in order. An `if` statement runs a block of code only when a condition is true.

```c run
#include <stdio.h>

int main(void) {
  int temperature = 85;

  if (temperature > 80) {
    printf("Too hot. Switching the heater off.\n");
  }
  printf("Done.\n");
  return 0;
}
```

Change 85 to 60 and run it again. The first message disappears, and the second still prints, because it sits outside the braces.

Add `else` to say what should happen otherwise.

```c run
#include <stdio.h>

int main(void) {
  int button_pressed = 0;

  if (button_pressed) {
    printf("LED on\n");
  } else {
    printf("LED off\n");
  }
  return 0;
}
```

A condition is true when it is not zero. That is why a variable holding 1 or 0 can be used directly as a condition.

## More than two choices

Chain conditions with `else if`. They are tried from the top, and only the first one that is true runs.

```c run
#include <stdio.h>

int main(void) {
  int battery = 35;

  if (battery > 60) {
    printf("green\n");
  } else if (battery > 20) {
    printf("yellow\n");
  } else {
    printf("red\n");
  }
  return 0;
}
```

> **Pitfall:** A semicolon straight after the parentheses, as in `if (x > 5);`, ends the `if` there and then. The block that follows always runs.

## Choosing between fixed values with switch

When one value is compared against many fixed possibilities, `switch` is tidier than a long chain.

```c run
#include <stdio.h>

int main(void) {
  int command = 2;

  switch (command) {
    case 1:
      printf("start\n");
      break;
    case 2:
      printf("stop\n");
      break;
    default:
      printf("unknown command\n");
      break;
  }
  return 0;
}
```

Execution jumps to the matching `case` and runs downwards until it meets a `break`. If you leave the `break` out, it carries straight on into the next case. `default` handles every value that has no case of its own, and you should always include it.

## Repeating with while

A loop repeats a block of code. A `while` loop keeps going as long as its condition is true, and it checks before every pass.

```c run
#include <stdio.h>

int main(void) {
  int count = 3;

  while (count > 0) {
    printf("%d\n", count);
    count--;
  }
  printf("liftoff\n");
  return 0;
}
```

Something inside the loop must eventually make the condition false. If you forget `count--`, the loop never ends. Try removing it and running the example. The simulator stops a runaway program and tells you so, where a real board would simply hang.

## Counting with for

Most loops count. A `for` loop puts the three parts of counting on one line.

```c run
#include <stdio.h>

int main(void) {
  for (int i = 0; i < 5; i++) {
    printf("i is %d\n", i);
  }
  return 0;
}
```

| Part | In the example | When it runs |
|---|---|---|
| Start | `int i = 0` | Once, before the loop begins |
| Condition | `i < 5` | Before every pass. The loop ends when it is false |
| Step | `i++` | After every pass |

The loop above runs with `i` equal to 0, 1, 2, 3 and 4. That is five passes. Starting from 0 and continuing while `i < n` is the standard C loop, and it runs exactly `n` times.

Here a loop adds up the numbers from 1 to 10, keeping a running total in a variable declared before the loop.

```c run
#include <stdio.h>

int main(void) {
  int total = 0;
  for (int i = 1; i <= 10; i++) {
    total += i;
  }
  printf("total = %d\n", total);
  return 0;
}
```

## do ... while

A `do ... while` loop checks its condition after each pass, so the body always runs at least once.

```c
do {
  reading = read_sensor();
} while (reading == 0);    // try again until we get a real reading
```

| Loop | Use it when |
|---|---|
| `for` | You know how many times to repeat |
| `while` | You repeat until something happens, possibly zero times |
| `do ... while` | The body must run at least once |

## Leaving a loop early

`break` leaves the loop at once. `continue` skips the rest of the current pass and goes on to the next one.

```c run
#include <stdio.h>

int main(void) {
  for (int i = 1; i <= 10; i++) {
    if (i % 2 == 0) {
      continue;            // skip even numbers
    }
    if (i > 7) {
      break;               // stop completely
    }
    printf("%d ", i);
  }
  printf("\n");
  return 0;
}
```

## The loop that never ends

On a desktop, a program finishes and returns to the operating system. A microcontroller has nothing to return to. Its program sets things up once and then repeats the same work for as long as there is power.

```c
int main(void) {
  setup_hardware();

  while (1) {              // 1 is always true, so this never ends
    read_buttons();
    update_display();
  }
}
```

This is called the main loop or super-loop, and nearly every firmware project is built around one.

## Common mistakes

- `if (x = 5)` instead of `if (x == 5)`. The first stores 5 and is always true.
- A semicolon after `if (...)` or `while (...)`.
- A loop that runs one time too many or too few. Check the first and last values.
- Forgetting to change the loop variable, so the loop never ends.
- Forgetting `break` in a `switch`.

```quiz
Q: How many times does the body of `for (int i = 0; i < 4; i++)` run?
- 3
* 4
- 5
Why: `i` takes the values 0, 1, 2 and 3. When it reaches 4 the condition is false and the loop ends.
```

```quiz
Q: A `switch` case has no `break` at the end. What happens after its statements run?
- The switch ends
* Execution continues into the next case
- The program stops with an error
Why: Without `break`, execution falls through to the statements of the following case.
```

```ask
Q: Why does almost every embedded program contain `while (1)`?
A: A microcontroller has no operating system to return to, so `main` must never finish. The program initialises the hardware once and then repeats its work forever in a main loop, reading inputs, updating state and driving outputs. If `main` did return, the chip would run into whatever code follows it, which is usually a trap that simply halts.
```
