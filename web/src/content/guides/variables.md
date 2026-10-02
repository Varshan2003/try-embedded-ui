## Variables

A variable is a named place in memory that holds a value. You create one by stating its type and its name, and you can give it a starting value at the same time.

```c run
#include <stdio.h>

int main(void) {
  int temperature = 21;
  printf("temperature is %d\n", temperature);

  temperature = 25;                  // store a new value
  printf("temperature is now %d\n", temperature);

  temperature = temperature + 1;     // use the old value to make the new one
  printf("and now %d\n", temperature);
  return 0;
}
```

The `=` sign does not mean "equals" as in mathematics. It means "store the value on the right into the variable on the left". That is why `temperature = temperature + 1` makes sense. Work out the right side first, then store the result.

> **Pitfall:** Always give a variable a value before you read it. A variable that has never been set holds whatever happened to be in memory.

## Types

The type says what kind of value a variable holds and how much memory it takes. You will meet these first.

| Type | Holds | Example |
|---|---|---|
| `int` | Whole numbers, positive or negative | `int count = -5;` |
| `unsigned` | Whole numbers that are never negative | `unsigned total = 40000;` |
| `char` | One character | `char grade = 'A';` |
| `bool` | `true` or `false` | `bool ready = true;` |
| `float` | Numbers with a fraction | `float volts = 3.3f;` |

Firmware uses whole numbers almost everywhere. Many small microcontrollers have no hardware for fractions, which makes `float` slow, so you will mostly work with `int` and its relatives.

Because the exact size of `int` depends on the chip, embedded code usually uses types that state their size. `uint8_t` is an unsigned 8-bit number and `int16_t` is a signed 16-bit one. You will see these everywhere from the next guides onwards, and they behave just like `int`.

A name for a value that never changes is written with `const`.

```c
const int MAX_SPEED = 120;   // the compiler will not let anything change this
```

## Arithmetic

| Operator | Meaning | Example | Result |
|---|---|---|---|
| `+` | add | `7 + 2` | 9 |
| `-` | subtract | `7 - 2` | 5 |
| `*` | multiply | `7 * 2` | 14 |
| `/` | divide | `7 / 2` | 3 |
| `%` | remainder | `7 % 2` | 1 |

Two of these surprise everyone.

**Division of whole numbers throws away the fraction.** `7 / 2` is 3, not 3.5. The result is not rounded, it is cut off.

**`%` gives the remainder.** `7 % 2` is 1, because 7 is three twos with 1 left over.

```c run
#include <stdio.h>

int main(void) {
  int total_seconds = 200;
  int minutes = total_seconds / 60;
  int seconds = total_seconds % 60;
  printf("%d seconds is %d min %d s\n", total_seconds, minutes, seconds);

  printf("1 / 4 * 100 = %d\n", 1 / 4 * 100);
  printf("1 * 100 / 4 = %d\n", 1 * 100 / 4);
  return 0;
}
```

The last two lines show the rule that will save you many times. **Multiply first, divide last.** `1 / 4` is 0, and 0 times 100 is still 0.

## Order of operations

C follows the order you learned at school. Multiplication, division and remainder happen before addition and subtraction. Parentheses come first of all.

```c run
#include <stdio.h>

int main(void) {
  printf("%d\n", 10 + 20 / 2);     // division first, so 10 + 10
  printf("%d\n", (10 + 20) / 2);   // parentheses first, so 30 / 2
  return 0;
}
```

When you are not sure, add parentheses. They cost nothing and make your intention clear to the next reader.

## Shortcuts

Changing a variable based on its own value is so common that C has short forms for it.

| Short form | Same as |
|---|---|
| `x += 5;` | `x = x + 5;` |
| `x -= 5;` | `x = x - 5;` |
| `x *= 2;` | `x = x * 2;` |
| `x /= 2;` | `x = x / 2;` |
| `x++;` | `x = x + 1;` |
| `x--;` | `x = x - 1;` |

## Comparing values

A comparison asks a question and produces an answer. In C the answer is a number, 1 for true and 0 for false.

| Operator | Question |
|---|---|
| `==` | are they equal? |
| `!=` | are they different? |
| `<` | is the left one smaller? |
| `>` | is the left one larger? |
| `<=` | smaller or equal? |
| `>=` | larger or equal? |

```c run
#include <stdio.h>

int main(void) {
  int battery = 15;
  printf("battery < 20 is %d\n", battery < 20);
  printf("battery == 100 is %d\n", battery == 100);
  printf("battery != 0 is %d\n", battery != 0);
  return 0;
}
```

> **Pitfall:** One `=` stores a value. Two, `==`, compares. Writing `=` where you meant `==` is the most famous bug in C.

## Combining conditions

Three logical operators join questions together.

| Operator | Meaning | True when |
|---|---|---|
| `&&` | and | both sides are true |
| `\|\|` | or | at least one side is true |
| `!` | not | the thing after it is false |

```c run
#include <stdio.h>

int main(void) {
  int temperature = 30;
  int door_open = 0;

  printf("in range: %d\n", temperature >= 10 && temperature <= 40);
  printf("alarm: %d\n", temperature > 80 || door_open);
  printf("door closed: %d\n", !door_open);
  return 0;
}
```

To test whether a value lies in a range, write two comparisons joined by `&&`. The mathematical form `10 <= t <= 40` compiles and gives the wrong answer.

## Common mistakes

- Expecting `5 / 2` to be 2.5.
- Dividing before multiplying in a formula.
- Using `=` where `==` was meant.
- Reading a variable before giving it a value.
- Writing a range test as `0 <= x <= 10`.

```quiz
Q: What is the value of `17 / 5` in C?
* 3
- 3.4
- 4
Why: Both numbers are whole numbers, so the fraction is cut off. The remainder, 2, is what `17 % 5` gives.
```

```quiz
Q: After `int x = 4; x += 3; x++;` what is `x`?
- 7
* 8
- 12
Why: `x += 3` makes it 7, and `x++` adds one more.
```

```ask
Q: Why does firmware avoid floating-point numbers where it can?
A: Many small microcontrollers have no hardware for floating-point arithmetic. Each operation then becomes a call into a software library, which is slow and adds several kilobytes to the program. Whole-number arithmetic is fast on every chip, so values are stored scaled up instead, for example a temperature in tenths of a degree or a voltage in millivolts.
```
