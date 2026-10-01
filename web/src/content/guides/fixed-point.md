## Why not just use float?

Many microcontrollers, including every Cortex-M0 and M3, have no floating-point unit. On those cores each `float` operation is a library call costing tens to hundreds of cycles, and the library itself adds kilobytes of flash. `double` is slower still, and on a core with a single-precision FPU it silently falls back to software.

Fixed-point arithmetic does the same job with integers. The idea is to store a value multiplied by a known scale factor, and keep track of that factor yourself.

| Quantity | Stored as | Scale |
|---|---|---|
| 23.5 degrees | `235` | tenths of a degree |
| 3.300 V | `3300` | millivolts |
| 0.5 as a fraction | `16384` | Q15: divided by 32768 |
| A gain of 2.0 | `512` | scaled by 256 |

Choosing a decimal scale, such as millivolts, keeps the numbers readable. Choosing a power of two makes rescaling a shift.

## Scaling without losing precision

Three rules cover most conversions.

1. **Multiply before you divide.** Integer division discards the fraction, so dividing first throws away precision you can never get back.
2. **Make the intermediate wide enough.** The product must fit. Widen an operand before the multiplication, not after.
3. **Round deliberately.** Integer division truncates toward zero. To round to nearest, add half the divisor first.

```c run
#include <stdio.h>
#include <stdint.h>

// 12-bit ADC reading to millivolts.
static uint32_t adc_to_mv_truncating(uint16_t raw, uint32_t vref_mv) {
  return (uint32_t)raw * vref_mv / 4095u;
}
static uint32_t adc_to_mv_rounded(uint16_t raw, uint32_t vref_mv) {
  return ((uint32_t)raw * vref_mv + 2047u) / 4095u;
}

int main(void) {
  printf("divide first:  %u mV\n", (uint32_t)(1000 / 4095 * 3300));
  printf("truncating:    %u mV\n", adc_to_mv_truncating(1, 3300));
  printf("rounded:       %u mV\n", adc_to_mv_rounded(1, 3300));
  printf("full scale:    %u mV\n", adc_to_mv_rounded(4095, 3300));
  return 0;
}
```

> **Pitfall:** Adding half the divisor rounds negative numbers the wrong way, because C division truncates toward zero. For a negative numerator, subtract half the divisor instead.

```c run
#include <stdio.h>
#include <stdint.h>

static int32_t div_round(int32_t n, int32_t d) {     // d > 0
  return (n >= 0 ? n + d / 2 : n - d / 2) / d;
}

int main(void) {
  printf(" 7 / 2 ->  %d\n", div_round(7, 2));
  printf("-7 / 2 -> %d (plain division gives %d)\n", div_round(-7, 2), -7 / 2);
  printf("-9 / 5 -> %d (plain division gives %d)\n", div_round(-9, 5), -9 / 5);
  return 0;
}
```

## Q formats

A Q format is a binary fixed-point convention. `Qm.n` means `m` integer bits and `n` fractional bits; the stored integer is the real value multiplied by 2^n. Q15 (strictly Q1.15) is the common format for signal processing: a 16-bit signed integer representing a fraction from -1.0 to just under +1.0.

| Operation | Rule | Example in Q15 |
|---|---|---|
| Add, subtract | Both operands must have the same format; the result keeps it | `a + b` |
| Multiply | Fractional bits add: Q15 x Q15 gives Q30 | `((int32_t)a * b) >> 15` |
| Divide | Fractional bits subtract: pre-shift the numerator | `((int32_t)a << 15) / b` |
| Convert from a real number | Multiply by 2^n and round | `0.5` becomes `16384` |

```c run
#include <stdio.h>
#include <stdint.h>

static int16_t q15_mul(int16_t a, int16_t b) {
  int32_t p = ((int32_t)a * b) >> 15;
  return (int16_t)(p > INT16_MAX ? INT16_MAX : p);   // -1.0 * -1.0 is the one overflow
}

int main(void) {
  int16_t half = 16384, three_quarters = 24576;
  int16_t product = q15_mul(half, three_quarters);
  printf("0.5 * 0.75 = %d, which is %d/32768 = 0.375\n", product, product);
  printf("-1.0 * -1.0 saturates to %d\n", q15_mul(-32768, -32768));
  return 0;
}
```

## Wrap or saturate

When a result does not fit, there are two things it can do. Integer arithmetic in C wraps. For a counter or a timestamp that is exactly right. For a signal it is a disaster: a sum that slightly exceeds the maximum becomes a large negative number, which in audio is a loud click and in a motor controller is a command in the wrong direction.

Saturating arithmetic clamps at the limit instead.

```c run
#include <stdio.h>
#include <stdint.h>

static int16_t sat_add16(int16_t a, int16_t b) {
  int32_t sum = (int32_t)a + b;
  if (sum > INT16_MAX) return INT16_MAX;
  if (sum < INT16_MIN) return INT16_MIN;
  return (int16_t)sum;
}

int main(void) {
  int16_t a = 30000, b = 10000;
  printf("wrapping:   %d\n", (int16_t)(a + b));
  printf("saturating: %d\n", sat_add16(a, b));
  return 0;
}
```

Cortex-M4 and above have saturating instructions, and CMSIS-DSP exposes them. On other cores the compare-and-clamp is the portable form.

## Filters

Real signals are noisy. Two filters cover most needs, and both are a few lines of integer code.

**Moving average.** Average the last N samples. Keep a running sum so each update is O(1): subtract the sample leaving the window, add the one arriving. With N a power of two, the division is a shift.

**Exponential moving average.** `y += (x - y) / 2^k`. It needs no history, only the previous output. To avoid losing the fraction on every step, keep the state scaled up by 2^k.

```c run
#include <stdio.h>
#include <stdint.h>

#define SHIFT 2                       // smoothing factor 1/4

int main(void) {
  int32_t state = 0;                  // filter output multiplied by 2^SHIFT
  const int16_t input[] = { 100, 100, 100, 100, 100, 100, 0, 0, 0 };

  for (int i = 0; i < 9; i++) {
    state += input[i] - (state >> SHIFT);
    printf("%d ", (int)(state >> SHIFT));
  }
  printf("\n");
  return 0;
}
```

The output climbs towards 100 and then decays. A larger shift smooths more and responds more slowly.

| | Moving average | Exponential moving average |
|---|---|---|
| Memory | N samples | 1 value |
| Response to a step | Exactly N samples, then settled | Approaches gradually, never quite arrives |
| Good at | Rejecting a specific period, such as mains hum | General smoothing with almost no cost |

## Hysteresis

A single threshold chatters when the input hovers near it. Two thresholds, with the state unchanged in between, fix that. The same pattern debounces an analog comparison, a low-battery warning or a thermostat.

```c
if (temp < on_below) heating = true;
else if (temp > off_above) heating = false;
// between the two thresholds: leave `heating` as it was
```

The gap must be wider than the noise on the measurement.

## A control loop in integers

A PI controller computes its output from the error and from the accumulated error. In fixed point, the gains are scaled integers and the result is divided back down.

```c run
#include <stdio.h>
#include <stdint.h>

static int32_t clamp(int32_t v, int32_t lo, int32_t hi) { return v < lo ? lo : v > hi ? hi : v; }

int main(void) {
  const int32_t kp = 128, ki = 64;    // 0.5 and 0.25, scaled by 256
  int32_t integral = 0, temperature = 20;

  for (int step = 0; step < 6; step++) {
    int32_t error = 50 - temperature;                  // setpoint is 50
    integral = clamp(integral + error, -200, 200);     // anti-windup
    int32_t output = clamp((kp * error + ki * integral) / 256, 0, 100);
    temperature += output / 4;                         // a crude model of the heater
    printf("error %3d  output %3d  temperature %d\n", error, output, temperature);
  }
  return 0;
}
```

The clamp on the integral is anti-windup. Without it, the integral keeps growing for as long as the output is saturated, and when the error finally reverses, the controller overshoots until all of it has been unwound.

## Common mistakes

- Dividing before multiplying, which rounds an intermediate result to zero.
- A product that overflows because the operands were widened after the multiplication.
- Rounding negative values by adding half the divisor.
- Forgetting that multiplying two Q15 numbers gives Q30.
- Letting a signal wrap where it should saturate.
- Using `double` constants such as `0.5` in an expression, which silently pulls in software floating point. Write `0.5f`, or avoid float altogether.

```quiz
Q: `uint16_t raw = 2000;` What is `raw / 4095 * 3300`?
* 0
- 1611
- 1612
Why: The division happens first and truncates to 0. Multiply first: `(uint32_t)raw * 3300 / 4095` is 1611.
```

```quiz
Q: In Q15, what does the stored value 8192 represent?
- 0.5
* 0.25
- 8192.0
Why: The value is the stored integer divided by 32768, and 8192 / 32768 is 0.25.
```

```ask
Q: How do you multiply two Q15 numbers, and what can go wrong?
A: Widen to 32 bits, multiply, and shift right by 15: the product of two Q15 values is Q30, and the shift returns it to Q15. Adding `1 << 14` before the shift rounds to nearest. The single overflow case is -1.0 times -1.0, which gives +1.0, a value Q15 cannot represent, so the result must be saturated to 32767. Forgetting to widen before multiplying overflows a 16-bit `int` on small targets.
```

```ask
Q: When is floating point acceptable in firmware?
A: When the core has an FPU for the type you use, the code is not in a hot path or an interrupt whose context-save cost matters, and the numerical behaviour has been thought through. A Cortex-M4F handles `float` well; `double` on the same core is software and slow. Even then, fixed point is often chosen for determinism, for bit-exact results across platforms, and to keep interrupt entry cheap.
```
