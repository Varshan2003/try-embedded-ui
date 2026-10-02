## What a microcontroller is

A microcontroller is a complete small computer on a single chip. It sits inside washing machines, car keys, thermostats, drones and toothbrushes. It usually costs less than a cup of coffee and does one job for years without being switched off.

Inside the chip there are four things you will hear about constantly.

| Part | What it does | Everyday comparison |
|---|---|---|
| Processor (CPU) | Carries out instructions, one after another | The person following a recipe |
| Flash memory | Stores your program. Keeps it when the power is off | The recipe book |
| RAM | Holds the values the program is working with. Emptied when the power goes off | The kitchen counter |
| Peripherals | Circuits that touch the outside world, such as pins, timers and serial ports | The oven, the tap, the timer |

The pins are the metal legs of the chip. A program can switch a pin on to light an LED, or read a pin to see whether a button is pressed. Everything a product does comes down to reading some pins and driving others.

**Embedded C** is the C language used to write programs for these chips. It is ordinary C. What makes it "embedded" is what it is used for, namely small memory, no screen or keyboard, and direct control of hardware.

## From text to a running program

You write a program as text. The chip cannot run text, so there are a few steps in between.

1. **Write** the program in C.
2. **Compile** it. A program called a compiler checks your text and translates it into the numeric instructions the processor understands. If it finds a mistake, it stops and tells you.
3. **Flash** it. The translated program is copied into the chip's flash memory.
4. **Run** it. When the chip gets power, it starts executing your program from the beginning.

On this site, steps 2 to 4 happen when you press **Run**. Your code runs on a simulated microcontroller in the browser, so you can experiment freely. Nothing can be damaged.

## Your first program

Press Run on this example. Then change the text between the quotes and run it again.

```c run
#include <stdio.h>

int main(void) {
  printf("Hello, board!\n");
  return 0;
}
```

Every part has a job.

| Line | Meaning |
|---|---|
| `#include <stdio.h>` | Brings in the standard input and output tools, which include `printf` |
| `int main(void)` | Starts the function named `main`. Every C program begins running here |
| `{` and `}` | Mark where the body of the function starts and ends |
| `printf("Hello, board!\n");` | Prints text. `\n` means "start a new line" |
| `return 0;` | Ends `main`. Zero means "finished without a problem" |

Each instruction is called a **statement**, and each statement ends with a semicolon. Statements run in order, from top to bottom.

```c run
#include <stdio.h>

int main(void) {
  printf("first\n");
  printf("second\n");
  printf("third\n");
  return 0;
}
```

## Comments

Anything after `//` on a line is a comment. The compiler ignores it. Comments are notes for people, including you in three months.

```c
// Switch the heater off above 80 degrees.
printf("heater off\n");   // a comment can also follow a statement
```

Good comments say why the code does something. The code itself already says what it does.

## Printing values

`printf` can print numbers as well as fixed text. Inside the quotes, `%d` is a placeholder. It is replaced by the number you give after the text.

```c run
#include <stdio.h>

int main(void) {
  printf("The answer is %d\n", 42);
  printf("%d plus %d is %d\n", 2, 3, 2 + 3);
  return 0;
}
```

The placeholders are filled in from left to right, so there must be one value for each. On a real board `printf` usually sends its text over a serial cable to your computer, and it is the first tool everyone uses to see what their program is doing.

## Functions

A function is a named block of code. `main` is one, and you can write your own. A function can take inputs and hand back a result.

```c run
#include <stdio.h>

int add(int a, int b) {
  return a + b;
}

int main(void) {
  printf("%d\n", add(2, 3));
  printf("%d\n", add(10, 20));
  return 0;
}
```

Read the first line of `add` piece by piece.

| Piece | Meaning |
|---|---|
| `int` (at the start) | The function hands back a whole number |
| `add` | Its name |
| `(int a, int b)` | It takes two whole numbers, which it calls `a` and `b` |
| `return a + b;` | It hands back their sum |

Writing `add(2, 3)` is called **calling** the function. The call is replaced by the value that comes back, so `printf` receives 5.

Some functions only do something and hand nothing back. They are declared `void`, which means "nothing".

```c run
#include <stdio.h>

void greet(void) {
  printf("Hello!\n");
}

int main(void) {
  greet();
  greet();
  return 0;
}
```

> **Note:** The word `void` inside the parentheses means the function takes no inputs.

## When the compiler complains

Everyone makes typing mistakes, and the compiler catches many of them. Run this example. It is broken on purpose.

```c run fails
#include <stdio.h>

int main(void) {
  printf("almost right\n")
  return 0;
}
```

The message says what was expected and gives a line number. Add the missing semicolon and run it again.

Three habits make errors easy to deal with.

- Read the message. It usually says exactly what is wrong.
- Go to the line it names. If that line looks fine, look at the line above it.
- Fix the first error only, then run again. One mistake often causes several messages.

The mistakes beginners make most often are a missing semicolon, a missing closing brace, a misspelled name and a quote that was opened and never closed.

## How practice works here

Each practice problem gives you a function to complete. You do not write `main`. The tests supply their own `main`, call your function with different inputs and compare what comes out.

- **Run** tries your code on the examples shown in the problem. It happens instantly, in your browser.
- **Submit** also runs hidden tests, which check the unusual cases.
- **Hints** are there when you are stuck. Open them one at a time.

Getting a problem wrong is normal and it is how the learning happens. Read what the test expected, compare it with what your code produced and adjust.

## Common mistakes

- Forgetting the semicolon at the end of a statement.
- Forgetting `\n`, so that everything prints on one line.
- Using `%d` without giving a value for it.
- Mixing up printing a value with returning it. Tests that check a result need it returned.
- Changing a function's name or inputs in a practice problem, so the tests can no longer call it.

```quiz
Q: Where does a C program start running?
- At the first line of the file
* At the function called `main`
- At the first `printf`
Why: Execution always begins at `main`, wherever it appears in the file.
```

```quiz
Q: What does `printf("%d apples\n", 3);` print?
- `%d apples`
* `3 apples`
- `apples 3`
Why: The placeholder `%d` is replaced by the value given after the text.
```

```ask
Q: What is the difference between flash memory and RAM in a microcontroller?
A: Flash holds the program and keeps its contents when the power is removed. RAM holds the values the program is working on while it runs, and is lost at power-off. A microcontroller has far more flash than RAM, often 64 KB of flash and only 8 KB of RAM, so firmware is careful about how much data it keeps.
```
