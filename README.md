# Try Embedded

Try Embedded is an interview-first embedded systems learning platform. Its core
experience combines guided lessons, realistic hardware simulation, debugging
practice, and timed interview challenges in one browser-based workspace.

The current prototype is branded **SiliconLab** inside the app. SiliconLab is
the simulation lab; Try Embedded is the complete learning platform.

## Product goal

Help a learner go from “I can write embedded code” to “I can design, debug, and
clearly explain an embedded system in an interview.”

The central learning loop is:

**Learn -> Build -> Break -> Debug -> Explain -> Interview**

For the complete simulator, interview-platform, architecture, and delivery
backlog, see [IMPROVEMENTS.md](IMPROVEMENTS.md).

## Architecture

Try Embedded is two services in two repositories, plus one shared library.

| Piece | Where | What it owns |
|---|---|---|
| Frontend | this repo, [web/](web/) | React app: editor, circuit canvas, live simulation, challenge UI |
| Simulator | this repo, [simulator/](simulator/) | Arduino interpreter, board models, circuit logic, the C interpreter for the Embedded C section, and a headless runner |
| Backend | `try-embedded-backend` repo | Python (FastAPI): accounts, projects, challenges, grading, progress |

The interactive simulation runs entirely in the browser. To grade a challenge
the backend runs the same simulator package headlessly through
[simulator/bin/run.mjs](simulator/bin/run.mjs), so hidden tests never reach the
client and both sides agree on behaviour.

## Embedded C section

`#/embedded-c` holds the lessons and the practice problems for embedded C.

- **Guides.** Eleven lessons and a quick reference, written in Markdown in
  [web/src/content/guides/](web/src/content/guides/) and listed in
  [web/src/embedded-c/guides.ts](web/src/embedded-c/guides.ts). A code block
  fenced as `c run` becomes an editable example with a Run button, `quiz` a
  knowledge check and `ask` an interview question with a folded answer. Guides
  work with no backend.
- **Practice.** The problems come from the API (`/api/c/problems`). Run executes
  the visible examples in the browser; Submit sends the code to the API, which
  also runs the hidden tests. A guide and a practice topic share an id, so each
  guide lists its own problems.
- **Playground.** A scratch file at `#/embedded-c/playground`.

All three run code in the C interpreter in
[simulator/src/c/](simulator/src/c/). It models a 32-bit little-endian
microcontroller: `int`, `long` and pointers are 4 bytes, RAM is 64 KB at
0x20000000, string literals and functions are in read-only flash at 0x08000000,
and the peripheral region at 0x40000000 is readable and writable so register
code can be exercised. Every byte of RAM is tracked, so out-of-bounds accesses,
use after free, pointers to dead locals, null dereferences, division by zero
and out-of-range shifts are reported with a line number instead of corrupting
memory.

The interpreter covers the C that firmware uses: the preprocessor, all integer
and floating types, pointers, arrays, structs, unions, bit-fields, enums,
function pointers, designated initialisers, compound literals, packed structs
and the common parts of `<stdio.h>`, `<string.h>`, `<stdlib.h>` and `<ctype.h>`.
It does not support `goto`, variable-length arrays, user-defined variadic
functions or reading from standard input, and an uninitialised local holds a
fixed garbage pattern instead of being reported.

`npm test` also runs every runnable example in the guides and checks every
quiz, so a guide cannot ship with an example that fails.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm test        # simulator tests and frontend typecheck
npm run dev     # http://127.0.0.1:5173
```

The simulator and local sketches work with no backend. Challenges, accounts and
grading need the API from the `try-embedded-backend` repo running on port 8000; the
dev server proxies `/api` to it (override with `API_PROXY_TARGET`).

For production, build with `VITE_API_URL` set to the API's origin, then serve
the result with security headers:

```sh
VITE_API_URL=https://api.example.com npm run build
API_ORIGIN=https://api.example.com npm start    # http://127.0.0.1:4173
```

The original single-file and vanilla-JS prototypes are kept in
[legacy/](legacy/) for reference only.

## Current prototype

Implemented in [web/](web/) and [simulator/](simulator/):

- In-browser Arduino-style C/C++ interpreter
- Arduino Uno, Nano, and Mega board targets
- Compile, run, pause, single-step, reset, and simulation speed controls
- Interactive circuit canvas with pan, zoom, drag, rotate, undo, and redo
- LED, push button, potentiometer, servo, buzzer, TMP36, and seven-segment parts
- Digital I/O, analog I/O, PWM, timing, interrupts, tone, Servo, Serial, Wire,
	and SPI API coverage
- Serial monitor with host input
- Pin-state table and event timeline
- Compiler diagnostics with source-line navigation
- Starter projects for counters, PWM, interrupts, serial commands, and servo
	control
- Local autosave, project duplication, import/export, shareable project links,
	and state snapshots
- Responsive layout and keyboard shortcuts
- Embedded C section: eleven guides with runnable examples, knowledge checks and
	interview questions; a quick reference; 136 graded practice problems with
	hints, hidden tests and reference solutions; and a C playground

These are the foundation of the SiliconLab simulation experience, not yet the
full interview platform.

## Required Try Embedded features

### 1. Learning paths

- Beginner, intermediate, and advanced tracks
- Clear prerequisites and estimated time per lesson
- Embedded C and modern C++ fundamentals
- Binary, hexadecimal, bitwise operations, pointers, memory, and data layout
- Microcontroller architecture, registers, clocks, GPIO, timers, PWM, ADC, and
	interrupts
- UART, SPI, I2C, CAN, USB, and common debugging workflows
- RTOS concepts: tasks, queues, semaphores, mutexes, timing, and priorities
- Power, performance, reliability, safety, and hardware bring-up
- Diagrams, visual explanations, worked examples, and short knowledge checks

### 2. Hands-on labs

- A lesson-linked simulator project for every important concept
- Deliberately broken circuits and firmware for debugging exercises
- Expected behavior, observable symptoms, hints, and progressive reveal
- Automatic validation of code, wiring, timing, and output
- Resettable experiments with no permanent hardware damage
- Save, fork, share, and submit lab projects
- Hardware-to-simulation comparison notes for each lab

### 3. Interview practice

- Topic-based question bank with difficulty and company-style tags
- Multiple-choice, short-answer, code-writing, code-review, and system-design
	questions
- Timed practice sessions and full mock interviews
- Embedded debugging scenarios with logs, waveforms, and faulty code
- “Explain your answer” recording or written response workflow
- Rubrics covering correctness, tradeoffs, clarity, safety, and testability
- Spaced repetition for weak topics
- Progress dashboard with readiness by topic

### 4. Assessment and feedback

- Hidden tests for coding challenges
- Static checks for unsafe or suspicious embedded patterns
- Runtime assertions for timing, memory, pin conflicts, and protocol behavior
- Useful failure messages instead of only pass/fail results
- Personal recommendations based on mistakes and time-to-solve
- Exportable learner profile and interview-preparation report

### 5. Real embedded development workflow

- Project files that can be downloaded and built locally
- PlatformIO and Arduino CLI compatibility
- STM32CubeIDE and common GCC toolchain import paths
- GitHub import and export
- Serial, ELF, HEX, BIN, and map-file support
- Breakpoints, watches, call stack, registers, memory view, and GDB support
- VS Code extension or a first-class VS Code workflow

## Wokwi feature-parity backlog

Wokwi is the reference point for browser-based embedded simulation. The goal is
to learn from its capabilities and provide an interview-focused experience,
not to copy its implementation, branding, or proprietary assets.

### Boards and runtimes

- Arduino Uno, Nano, Mega, Leonardo, Micro, and ATtiny families
- ESP32 family, including Wi-Fi and Bluetooth-capable boards
- Raspberry Pi Pico and Pico W
- STM32 boards
- AVR and other popular embedded targets where licensing and emulation permit
- MicroPython support
- Rust and other embedded language support where toolchains are practical
- Board-specific pin maps, peripherals, memory limits, and clock behavior

### Components and peripherals

- LEDs, RGB LEDs, buttons, switches, potentiometers, buzzers, and relays
- Seven-segment displays, LED matrices, NeoPixels, LCDs, OLEDs, and e-paper
- Keypads, joysticks, rotary encoders, and touch input
- Temperature, humidity, light, motion, distance, pressure, and gas sensors
- Servos, stepper motors, DC motors, and motor drivers
- RTC modules, SD cards, EEPROMs, flash storage, and battery models
- Shift registers, multiplexers, level shifters, logic gates, and common ICs
- Wi-Fi access points, HTTP, MQTT, NTP, DNS, and simulated network services
- Custom chips and reusable community components

### Simulation and debugging

- Accurate digital and analog signal behavior where possible
- Logic-analyzer capture for UART, I2C, SPI, PWM, and arbitrary digital pins
- Waveform viewer with cursors, measurements, decoding, and export
- GDB debugging with breakpoints, stepping, watches, registers, and memory
- Runtime logs, serial terminals, assertions, and simulation-event inspection
- Reproducible simulations with deterministic seeds and virtual time controls
- Peripheral fault injection: stuck pins, noise, dropped bytes, bus contention,
	timing faults, and invalid sensor values
- Electrical warnings for missing power, short circuits, invalid voltage, and
	unsafe pin configurations

### Projects and collaboration

- Zero-install browser startup
- Public and private projects
- One-click share links and forkable examples
- Version history and project snapshots
- Import/export using a documented project format
- Searchable example library and community project gallery
- Comments, feedback, and collaborative review
- Classroom spaces, assignments, instructor dashboards, and grading

### Automation and integrations

- VS Code integration
- GitHub integration and pull-request workflows
- Headless simulation for CI
- Automated tests against serial output, pin state, timing, and logic traces
- CLI for local simulation and reproducible builds
- REST or JavaScript API for custom exercises and grading
- JetBrains integration where demand justifies the maintenance cost

## Suggested delivery order

### Phase 1: Interview-ready core

- Add Learn, Practice, and Interview navigation
- Ship one complete path: GPIO -> timers -> interrupts -> UART
- Add challenge runner, hidden tests, hints, scoring, and progress tracking
- Add code and wiring validation to the existing simulator
- Add 100 high-quality embedded interview questions with explanations

### Phase 2: Professional embedded workflow

- Add STM32 and ESP32 targets
- Add logic analyzer and waveform inspection
- Add breakpoints, watches, memory, and register views
- Add GitHub, project export, and local build support
- Add timed mock interviews and learner reports

### Phase 3: Wokwi-level platform breadth

- Expand board and component catalog
- Add Wi-Fi, SD card, custom chips, and advanced peripheral models
- Add MicroPython and additional language workflows
- Add VS Code and CI integrations
- Add community projects and classroom tooling

## Non-goals

- Building a generic electronics CAD tool
- Supporting every microcontroller on day one
- Replacing physical hardware for electrical certification or safety testing
- Adding components without a corresponding learning or interview use case

## Success metrics

- Learners complete a full path and pass its practical assessment
- Median time from opening a lab to first successful run is under five minutes
- Learners can diagnose a deliberately broken project without a solution reveal
- Interview challenge completion and explanation quality improve over time
- Projects can be reproduced locally and in CI
- Users return for spaced practice rather than only browsing examples

## Reference material

- [Wokwi documentation](https://docs.wokwi.com/)
- [Wokwi supported hardware](https://docs.wokwi.com/getting-started/supported-hardware)
- [Wokwi GDB debugging](https://docs.wokwi.com/gdb-debugging)
- [Wokwi logic analyzer](https://docs.wokwi.com/guides/logic-analyzer)
- [Wokwi Wi-Fi simulation](https://docs.wokwi.com/guides/esp32-wifi)
- [Wokwi VS Code integration](https://docs.wokwi.com/vscode/getting-started)
- [Wokwi CI](https://docs.wokwi.com/wokwi-ci/getting-started)