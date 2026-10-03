# Peripherals and drivers

## How do you write a hardware driver?

A driver is the code that operates one peripheral and hides its registers behind a small interface.

Steps:

1. **Read the datasheet**: the register map, the required initialisation order, timing, and errata.
2. **Define the interface** in a header: `init`, `read`, `write`, and little else. Nothing in it should mention a register.
3. **Bring up the hardware**: enable the peripheral's clock, configure its pins, set its mode.
4. **Implement the data path**: polling first to prove the hardware, then interrupts or DMA.
5. **Handle errors**: timeouts on every wait, and the error flags the peripheral reports.
6. **Test** with a logic analyser against the datasheet's timing diagrams.

```c
// uart.h: what the rest of the program sees
typedef struct { uint32_t baud; } uart_config_t;
err_t  uart_init(const uart_config_t *config);
size_t uart_write(const uint8_t *data, size_t length);
size_t uart_read(uint8_t *data, size_t max_length);
```

## What is a device driver, and how is one structured?

A device driver is the software layer between a device and the code that uses it. It turns "send these bytes" into the register operations that particular hardware needs.

A typical structure:

| Layer | Contents |
|---|---|
| Public API | `open`/`init`, `read`, `write`, `control`, `close` |
| Driver logic | State, buffers, protocol and error handling |
| Interrupt handlers | Move data between the hardware and the buffers |
| Hardware access | Register definitions and low-level accessors |

Good practice: keep the driver's state in a handle struct so several instances can exist; never block in an ISR; return error codes; put a timeout on every wait; and keep board-specific details (which pins, which instance) in configuration, not in the driver.

On an operating system a driver also registers with the kernel and follows its driver model.

## How do you design a device driver framework?

A framework gives every driver of one kind the same interface, so application code can use any device without knowing which one it is. In C that interface is a struct of function pointers.

```c
typedef struct device device_t;

typedef struct {
  int (*init)(device_t *dev);
  int (*read)(device_t *dev, uint8_t *buf, size_t len);
  int (*write)(device_t *dev, const uint8_t *buf, size_t len);
  int (*ioctl)(device_t *dev, int request, void *arg);
} driver_ops_t;

struct device {
  const char *name;
  const driver_ops_t *ops;     // which driver implements it
  void *config;                // base address, pins, speed
  void *state;                 // run-time data
};

static inline int device_write(device_t *dev, const uint8_t *buf, size_t len) {
  return dev->ops->write(dev, buf, len);
}
```

Around that core a framework adds a registry to find devices by name, a defined initialisation order, power-management hooks (suspend and resume), and a common error convention. Zephyr's device model and the Linux driver model follow this shape.

## How do you control GPIO pins through memory-mapped registers?

Each port has registers for mode, output and input. The steps are: enable the port's clock, set the pin's mode, then write or read.

```c run
#include <stdio.h>
#include <stdint.h>

typedef struct { volatile uint32_t MODER, OTYPER, OSPEEDR, PUPDR, IDR, ODR, BSRR; } gpio_t;
#define GPIOA ((gpio_t *)0x40020000u)

static void pin_output(gpio_t *port, unsigned pin) {
  port->MODER = (port->MODER & ~(3u << (2 * pin))) | (1u << (2 * pin));   // 01 = output
}
static void pin_write(gpio_t *port, unsigned pin, int high) {
  if (high) port->ODR |= (1u << pin); else port->ODR &= ~(1u << pin);
}
static int pin_read(gpio_t *port, unsigned pin) { return (port->IDR >> pin) & 1u; }

int main(void) {
  pin_output(GPIOA, 5);
  pin_write(GPIOA, 5, 1);
  printf("MODER=0x%08X ODR=0x%08X in=%d\n", GPIOA->MODER, GPIOA->ODR, pin_read(GPIOA, 0));
  return 0;
}
```

On real hardware prefer the set/reset register (`BSRR`) for outputs, since it changes pins atomically. Inputs usually need a pull-up or pull-down, and an input can raise an interrupt on an edge.

## How do you use a memory-mapped UART?

Configure the baud rate and frame format, enable the transmitter and receiver, then move bytes through the data register while watching the status flags.

```c
typedef struct { volatile uint32_t SR, DR, BRR, CR1; } usart_t;
#define USART2 ((usart_t *)0x40004400u)
#define SR_RXNE (1u << 5)
#define SR_TXE  (1u << 7)

void uart_init(uint32_t clock_hz, uint32_t baud) {
  USART2->BRR = (clock_hz + baud / 2u) / baud;        // divisor, rounded
  USART2->CR1 = (1u << 13) | (1u << 3) | (1u << 2);   // enable UART, transmitter, receiver
}
void uart_putc(uint8_t c) {
  while (!(USART2->SR & SR_TXE)) { }                  // wait for room
  USART2->DR = c;
}
uint8_t uart_getc(void) {
  while (!(USART2->SR & SR_RXNE)) { }                 // wait for a byte
  return (uint8_t)USART2->DR;
}
```

A UART is asynchronous: there is no clock line, so both ends must agree on the baud rate and frame (commonly 8 data bits, no parity, 1 stop bit). Production drivers receive by interrupt or DMA into a ring buffer and check the overrun, framing and parity error flags.

## How do you use a memory-mapped SPI controller?

SPI is a synchronous, full-duplex bus with a clock (SCK), data out (MOSI), data in (MISO) and one chip-select line per device. Every byte sent clocks a byte in.

```c
uint8_t spi_transfer(uint8_t out) {
  while (!(SPI1->SR & SPI_SR_TXE)) { }
  *(volatile uint8_t *)&SPI1->DR = out;          // an 8-bit write sends 8 bits
  while (!(SPI1->SR & SPI_SR_RXNE)) { }
  return *(volatile uint8_t *)&SPI1->DR;         // reading also clears RXNE
}

uint8_t sensor_read_register(uint8_t reg) {
  cs_low();                                      // select the device
  spi_transfer(reg | 0x80u);                     // address, with the read bit
  uint8_t value = spi_transfer(0x00);            // clock out a dummy byte to read
  cs_high();
  return value;
}
```

Configuration must match the device: the clock mode (polarity CPOL and phase CPHA, giving modes 0 to 3), the bit order, and a clock no faster than the device allows. Chip select is usually a GPIO driven by the driver.

## How do you use a memory-mapped I2C controller?

I2C is a two-wire bus (SDA and SCL, open-drain with pull-up resistors) on which a controller addresses many devices by a 7-bit address. A transaction is: start, address plus read/write bit, acknowledged bytes, stop.

Reading one register from a device:

```c
err_t i2c_read_register(uint8_t address, uint8_t reg, uint8_t *value) {
  if (i2c_start()) return ERR_BUS;
  if (i2c_send((uint8_t)(address << 1) | 0u)) return ERR_NACK;   // address + write
  if (i2c_send(reg)) return ERR_NACK;                            // which register
  if (i2c_start()) return ERR_BUS;                               // repeated start
  if (i2c_send((uint8_t)(address << 1) | 1u)) return ERR_NACK;   // address + read
  *value = i2c_receive(false);                                   // NACK the last byte
  i2c_stop();
  return ERR_OK;
}
```

Each helper writes the controller's control and data registers and waits on a status flag, with a timeout. A driver must handle a missing acknowledge (no device at that address), arbitration loss, clock stretching, and a bus stuck low after a reset, which is recovered by clocking SCL manually.

## How do UART, SPI and I2C compare?

| | UART | SPI | I2C |
|---|---|---|---|
| Wires | 2 (TX, RX) | 4, plus one chip select per device | 2 (SDA, SCL) |
| Clock | None; agreed baud rate | Driven by the controller | Driven by the controller |
| Topology | Point to point | One controller, several devices | Many devices, addressed |
| Duplex | Full | Full | Half |
| Typical speed | Up to a few Mbit/s | Tens of Mbit/s | 100 kbit/s to 3.4 Mbit/s |
| Acknowledge | None | None | After every byte |
| Typical use | Debug console, modules, GPS | Flash, displays, fast ADCs | Sensors, EEPROMs, PMICs |

Choose SPI for speed, I2C for many slow devices on few pins, and UART to talk to another processor or a PC. For long or noisy links use a differential bus such as RS-485 or CAN.

## How do you use a memory-mapped ADC?

An ADC converts a voltage into a number. With `n` bits of resolution and reference `Vref`, a reading of `raw` means `raw * Vref / (2^n - 1)` volts.

```c
uint16_t adc_read(uint8_t channel) {
  ADC1->SQR3 = channel;                     // which input
  ADC1->CR2 |= ADC_CR2_SWSTART;             // start a conversion
  while (!(ADC1->SR & ADC_SR_EOC)) { }      // wait for end of conversion
  return (uint16_t)ADC1->DR;                // reading clears the flag
}

uint32_t to_millivolts(uint16_t raw) { return (uint32_t)raw * 3300u / 4095u; }   // 12-bit, 3.3 V
```

Set-up involves enabling the clock, putting the pin in analog mode, and choosing a sample time long enough for the source impedance. For regular sampling, trigger conversions from a timer and collect them with DMA. For accuracy: calibrate at start-up, average or filter, and remember the result is only as good as the reference voltage.

## How do you use a memory-mapped DAC?

A DAC converts a number into a voltage: `Vout = code * Vref / 2^n`.

```c
void dac_init(void) {
  RCC->APB1ENR |= RCC_APB1ENR_DACEN;        // clock
  DAC->CR |= DAC_CR_EN1;                    // enable channel 1; the pin must be in analog mode
}
void dac_write_millivolts(uint32_t mv) {
  DAC->DHR12R1 = (mv * 4095u) / 3300u;      // 12-bit right-aligned data register
}
```

To generate a waveform, store one period in a table and have a timer trigger the DAC at the sample rate, with DMA feeding the table. The output frequency is the sample rate divided by the table length. The output is a staircase, so a reconstruction filter follows it, and the output buffer has limited drive strength. When a chip has no DAC, a filtered PWM signal is a common substitute.

## How do you generate PWM with a memory-mapped timer?

PWM is a square wave whose duty cycle (the fraction of the period spent high) carries the value. A timer counts from 0 to a reload value; a compare register sets the point at which the output changes.

```c
// 20 kHz PWM from a 16 MHz timer clock
TIM3->PSC  = 0;
TIM3->ARR  = 800 - 1;                        // period: 16 MHz / 800 = 20 kHz
TIM3->CCR1 = 200;                            // duty: 200 / 800 = 25%
TIM3->CCMR1 = (6u << 4) | (1u << 3);         // PWM mode 1, with preload
TIM3->CCER |= TIM_CCER_CC1E;                 // drive the pin
TIM3->CR1  |= TIM_CR1_CEN;

void set_duty_percent(uint32_t percent) { TIM3->CCR1 = (TIM3->ARR + 1u) * percent / 100u; }
```

The frequency is `clock / ((PSC + 1) * (ARR + 1))`, and the resolution is the number of steps in ARR, so high frequency and fine resolution trade against each other. Preload makes a new duty value take effect at the start of a period, avoiding glitches. Uses: motor speed, LED brightness, servos, switching converters, and audio.

## How do you access memory-mapped timers?

A timer peripheral is a counter with supporting registers: control, prescaler, reload, the count itself, status, and capture/compare channels.

```c
typedef struct { volatile uint32_t CR1, CR2, SMCR, DIER, SR, EGR, CCMR1, CCMR2, CCER, CNT, PSC, ARR; } tim_t;
#define TIM2 ((tim_t *)0x40000000u)

void stopwatch_start(void) {
  TIM2->PSC = 16 - 1;             // 1 MHz from 16 MHz: one count per microsecond
  TIM2->ARR = 0xFFFFFFFFu;        // free-running
  TIM2->EGR = 1;                  // load the prescaler now
  TIM2->CR1 |= 1u;                // enable
}
uint32_t stopwatch_us(void) { return TIM2->CNT; }
```

Modes worth knowing: periodic interrupt, free-running time base, **input capture** (latch the count when a pin changes, to measure period or pulse width), **output compare** (change a pin at a set count), PWM, and encoder mode. Subtract timestamps with unsigned arithmetic so that counter rollover does not matter.

## How do you drive a memory-mapped display?

Displays are driven in two ways:

- **A frame buffer in the microcontroller's memory.** An LCD controller peripheral reads the buffer continuously and generates the panel's timing signals. Drawing is just writing memory.
- **A display with its own controller**, reached over SPI, I2C or a parallel bus. Firmware sends commands and pixel data.

```c
#define WIDTH 480
#define HEIGHT 272
static uint16_t framebuffer[WIDTH * HEIGHT];           // RGB565

static inline void set_pixel(int x, int y, uint16_t colour) {
  if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) framebuffer[y * WIDTH + x] = colour;
}
#define RGB565(r, g, b) ((uint16_t)((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3)))
```

The frame buffer is large (the example needs 261 kB), which often decides whether external RAM is needed. To avoid tearing, draw into a second buffer and swap during vertical blanking. For SPI displays, send only the region that changed and use DMA.

## How do you read memory-mapped sensors?

A sensor reaches the firmware in one of three ways: as an analog voltage on an ADC, as a digital device on I2C or SPI with its own register map, or as a block built into the microcontroller (such as an internal temperature sensor).

The driver pattern is the same in each case:

1. **Identify**: read the device's ID register and check it.
2. **Configure**: range, output data rate, filtering, interrupt pin.
3. **Read**: wait for data-ready (by polling a flag or by an interrupt), then read the raw registers in one burst so the bytes belong to the same sample.
4. **Convert**: assemble the bytes with the right byte order, then apply the datasheet's scale and calibration constants.

```c
int16_t raw = (int16_t)((buf[0] << 8) | buf[1]);       // big-endian, signed
int32_t milli_g = (int32_t)raw * 1000 / 16384;         // sensitivity from the datasheet
```

Also handle start-up time, communication errors and out-of-range values, and filter noisy readings.
