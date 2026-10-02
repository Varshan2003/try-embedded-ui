## Why hardware counts in twos

Inside a chip, every wire is either at a high voltage or a low one. There is nothing in between. So a chip stores everything as a row of two-state switches, each one either 1 or 0. One such digit is a **bit**. Eight bits make a **byte**.

To work with hardware you need to read numbers the way the hardware stores them. This takes an hour to learn and you will use it every day.

## Binary

Decimal has ten digits, and each position is worth ten times the one to its right. Binary has two digits, and each position is worth twice the one to its right.

| Bit position | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
|---|---|---|---|---|---|---|---|---|
| Worth | 128 | 64 | 32 | 16 | 8 | 4 | 2 | 1 |

To read a binary number, add up the worth of every position that holds a 1. Take `0010 0101`. The ones are in positions 5, 2 and 0, so the value is 32 + 4 + 1 = 37.

Positions are numbered from the right, starting at 0. Bit 0 is called the least significant bit, because it is worth the least. The leftmost one is the most significant bit.

C lets you write a number in binary by starting it with `0b`.

```c run
#include <stdio.h>

int main(void) {
  printf("%d\n", 0b00100101);
  printf("%d\n", 0b11111111);
  printf("%d\n", 0b10000000);
  return 0;
}
```

## How much fits

With `n` bits you can write 2 to the power `n` different patterns. Counting from zero, the largest value is one less than that.

| Bits | Patterns | Largest value | C type |
|---|---|---|---|
| 8 | 256 | 255 | `uint8_t` |
| 16 | 65,536 | 65,535 | `uint16_t` |
| 32 | 4,294,967,296 | 4,294,967,295 | `uint32_t` |

These numbers are worth recognising. A sensor whose readings stop at 1023 is giving you 10 bits. One that stops at 4095 is giving you 12.

When a value goes past the largest one its type can hold, it wraps around to zero, like a car's mileage counter rolling over.

```c run
#include <stdio.h>
#include <stdint.h>

int main(void) {
  uint8_t counter = 254;
  for (int i = 0; i < 4; i++) {
    printf("%u\n", counter);
    counter++;
  }
  return 0;
}
```

## Hexadecimal

Binary is exact, and long. Thirty-two ones and zeros are hard to read and easy to mistype. Hexadecimal, or hex, is a shorthand. It has sixteen digits, `0` to `9` and then `A` to `F` for ten to fifteen.

The reason it is used is this table. **One hex digit stands for exactly four bits.**

| Decimal | Binary | Hex | | Decimal | Binary | Hex |
|---|---|---|---|---|---|---|
| 0 | `0000` | `0` | | 8 | `1000` | `8` |
| 1 | `0001` | `1` | | 9 | `1001` | `9` |
| 2 | `0010` | `2` | | 10 | `1010` | `A` |
| 3 | `0011` | `3` | | 11 | `1011` | `B` |
| 4 | `0100` | `4` | | 12 | `1100` | `C` |
| 5 | `0101` | `5` | | 13 | `1101` | `D` |
| 6 | `0110` | `6` | | 14 | `1110` | `E` |
| 7 | `0111` | `7` | | 15 | `1111` | `F` |

So a byte is always two hex digits, and you can convert in your head one digit at a time. `0xA7` is `1010` then `0111`. Going the other way, split the bits into groups of four from the right and replace each group.

In C, a number starting with `0x` is hex. `printf` prints hex with `%X`, and `%02X` pads it to two digits.

```c run
#include <stdio.h>

int main(void) {
  printf("%d\n", 0xFF);              // hex in the source, printed as decimal
  printf("%d\n", 0x10);
  printf("0x%X\n", 255);             // decimal in the source, printed as hex
  printf("0x%02X 0x%02X\n", 7, 167);
  return 0;
}
```

Each position in hex is worth sixteen times the one to its right. So `0x2A` is 2 × 16 + 10 = 42.

> **Note:** `0x10` is sixteen, not ten. Read it aloud as "hex one zero".

A group of four bits, one hex digit, is called a **nibble**. The same value can be written three ways and the chip sees no difference.

| Decimal | Binary | Hex |
|---|---|---|
| 37 | `0b00100101` | `0x25` |
| 255 | `0b11111111` | `0xFF` |
| 128 | `0b10000000` | `0x80` |

You will see hex everywhere, in memory addresses such as `0x20000000`, in register values and in the bytes of a message. It is used because it shows you the bits.

## Negative numbers

Bits have no minus sign, so negative numbers need a convention. Every modern chip uses **two's complement**. The top half of the range is used for the negative values.

For 8 bits, the patterns 0 to 127 mean what you expect. The patterns 128 to 255 stand for -128 to -1.

| Bits | Read as unsigned | Read as signed |
|---|---|---|
| `0000 0000` | 0 | 0 |
| `0000 0001` | 1 | 1 |
| `0111 1111` | 127 | 127 |
| `1000 0000` | 128 | -128 |
| `1111 1110` | 254 | -2 |
| `1111 1111` | 255 | -1 |

The most significant bit tells you the sign. If it is 1, the number is negative.

```c run
#include <stdio.h>
#include <stdint.h>

int main(void) {
  uint8_t as_unsigned = 0xFF;
  int8_t as_signed = (int8_t)0xFF;
  printf("the same bits: %u and %d\n", as_unsigned, as_signed);
  return 0;
}
```

The bits are identical. The type decides how they are read. That is why choosing between `int8_t` and `uint8_t` matters.

## Characters are numbers too

A `char` stores a small number, and a standard table called ASCII says which number stands for which character. You do not need to learn the table, only two facts about it. The digits `'0'` to `'9'` are stored in order, and so are the letters.

```c run
#include <stdio.h>

int main(void) {
  char c = 'A';
  printf("'%c' is stored as %d\n", c, c);
  printf("the next letter is '%c'\n", c + 1);

  char digit = '7';
  int value = digit - '0';           // turn a digit character into its number
  printf("'%c' as a number is %d\n", digit, value);
  return 0;
}
```

Because the digits are in order, subtracting `'0'` from a digit character gives its value. This small trick is how text such as `"123"` is turned into the number 123.

## Common mistakes

- Reading `0x10` as ten. It is sixteen.
- Counting bit positions from 1 or from the left. They start at 0, on the right.
- Forgetting that an 8-bit value wraps round after 255.
- Confusing the character `'7'` with the number 7. The character is stored as 55.
- Assuming a pattern of bits is a negative number, or a positive one, without knowing its type.

```quiz
Q: What is `0b1010` in decimal?
- 5
* 10
- 12
Why: The ones are in positions 3 and 1, which are worth 8 and 2.
```

```quiz
Q: What is `0x3F` in binary?
- `0011 0111`
* `0011 1111`
- `1111 0011`
Why: Convert one digit at a time. `3` is `0011` and `F` is `1111`.
```

```ask
Q: Why do embedded engineers use hexadecimal instead of decimal?
A: Because each hex digit corresponds to exactly four bits, so a hex number shows the bit pattern directly. Looking at `0x80` you can see at once that only the top bit of a byte is set, which the decimal form 128 hides. Register values, masks and memory addresses are all about individual bits, so hex is the natural way to write them.
```
