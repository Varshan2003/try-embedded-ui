## Many values under one name

A program that reads a sensor a hundred times needs somewhere to keep a hundred readings. Declaring a hundred variables is not an option. An **array** is a row of values of the same type, stored side by side under one name.

```c run
#include <stdio.h>

int main(void) {
  int readings[4] = { 20, 22, 19, 25 };

  printf("first:  %d\n", readings[0]);
  printf("last:   %d\n", readings[3]);

  readings[1] = 30;                  // change one element
  printf("second: %d\n", readings[1]);
  return 0;
}
```

The number in the declaration is how many elements the array has. The number in square brackets afterwards is the **index**, which says which element you mean.

> **Pitfall:** Indexes start at 0. An array of 4 elements has indexes 0, 1, 2 and 3. There is no element 4.

| Index | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| `readings` | 20 | 22 | 19 | 25 |

## Arrays and loops belong together

The index can be a variable, which means a loop can visit every element. This is why loops count from 0 while `i < n`. Those are exactly the valid indexes.

```c run
#include <stdio.h>

int main(void) {
  int readings[5] = { 20, 22, 19, 25, 24 };
  int total = 0;

  for (int i = 0; i < 5; i++) {
    total += readings[i];
  }
  printf("total = %d, average = %d\n", total, total / 5);
  return 0;
}
```

The same loop shape finds the largest value, counts the ones above a limit or searches for a particular one. Only the line inside changes.

```c run
#include <stdio.h>

int main(void) {
  int readings[5] = { 20, 22, 19, 25, 24 };
  int highest = readings[0];         // start from a real element

  for (int i = 1; i < 5; i++) {
    if (readings[i] > highest) {
      highest = readings[i];
    }
  }
  printf("highest = %d\n", highest);
  return 0;
}
```

## Staying inside the array

C does not check your indexes. If you write to `readings[5]` in an array of five, the write lands on whatever is stored next in memory, and the program carries on with damaged data. On a real board the result shows up later, somewhere unrelated. It is the most damaging mistake in C.

The simulator on this site does check. Run this.

```c run fails
#include <stdio.h>

int main(void) {
  int readings[4] = { 0, 0, 0, 0 };
  for (int i = 0; i <= 4; i++) {     // <= lets i reach 4, which is one too far
    readings[i] = 1;
  }
  return 0;
}
```

Change `<=` to `<` and run it again. Getting this habit right now will save you days of debugging later.

## How many elements?

Writing the size in two places invites mistakes. Give it a name once and use the name everywhere.

```c run
#include <stdio.h>

#define SAMPLE_COUNT 6

int main(void) {
  int samples[SAMPLE_COUNT] = { 3, 1, 4, 1, 5, 9 };

  for (int i = 0; i < SAMPLE_COUNT; i++) {
    printf("%d ", samples[i]);
  }
  printf("\n");
  return 0;
}
```

`#define SAMPLE_COUNT 6` tells the compiler to replace the name with 6 wherever it appears. Changing the size later means editing one line.

## Passing an array to a function

A function can work on an array, with one thing to remember. The function is not told how long the array is, so you pass the length as a second parameter.

```c run
#include <stdio.h>

int sum(const int values[], int n) {
  int total = 0;
  for (int i = 0; i < n; i++) {
    total += values[i];
  }
  return total;
}

void clear(int values[], int n) {
  for (int i = 0; i < n; i++) {
    values[i] = 0;
  }
}

int main(void) {
  int data[3] = { 5, 10, 15 };
  printf("sum = %d\n", sum(data, 3));
  clear(data, 3);
  printf("sum after clear = %d\n", sum(data, 3));
  return 0;
}
```

Two things are different from ordinary parameters.

- An array is **not copied** when it is passed. The function works on the caller's own array, which is why `clear` really does clear it.
- Writing `const` in front promises that the function only reads the array. Use it whenever that is true.

## Text is an array of characters

C has no separate type for text. A piece of text, called a **string**, is an array of `char` with a special character of value 0 at the end to mark where it stops. That marker is written `'\0'`.

| Index | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| `"hello"` | `h` | `e` | `l` | `l` | `o` | `\0` |

So the five-letter word needs six elements. Text in double quotes gets its end marker automatically.

```c run
#include <stdio.h>

int main(void) {
  char name[] = "sensor";            // the compiler counts: 6 letters + 1 marker

  printf("%s\n", name);              // %s prints a string
  printf("first letter: %c\n", name[0]);

  int length = 0;
  while (name[length] != '\0') {     // walk along until the end marker
    length++;
  }
  printf("length: %d\n", length);

  name[0] = 'S';
  printf("%s\n", name);
  return 0;
}
```

Nothing stores the length of a string. Every function that needs it walks along the characters until it finds the marker, exactly as the loop above does.

> **Note:** Single quotes make one character, such as `'a'`. Double quotes make a string, such as `"a"`, which is two elements, the letter and the end marker.

## Common mistakes

- Using index `n` in an array of `n` elements. The last valid index is `n - 1`.
- Writing `<=` in a loop over an array.
- Forgetting to pass the length along with the array.
- Forgetting that a string needs one extra element for its end marker.
- Comparing two strings with `==`. That compares where they are stored, not their contents.

```quiz
Q: `int a[5];` Which is the last valid element?
- `a[5]`
* `a[4]`
- `a[6]`
Why: Five elements are numbered 0 to 4.
```

```quiz
Q: How many elements does `char word[] = "cat";` have?
- 3
* 4
- 5
Why: Three letters plus the end marker `'\0'`.
```

```ask
Q: What happens in C if you write past the end of an array?
A: The language does not check, so the write goes into whatever memory follows the array. That might be another variable, or information the program needs to return from the current function. The program usually keeps running with corrupted data and fails later in a place that looks unrelated, which makes the bug hard to find. This is called a buffer overflow and it is also a major source of security holes. The defence is to always carry the length alongside the array and check every index against it.
```
