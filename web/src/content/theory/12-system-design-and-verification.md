# System design, verification and reliability

## What is hardware acceleration?

Hardware acceleration moves a computation out of general-purpose software into hardware built for it, which does the job faster, with less energy, or both.

Forms it takes:

- **Peripherals inside a microcontroller**: a CRC unit, AES and hash engines, a hardware divider, a DSP or FPU extension.
- **A separate processor**: a GPU, a DSP, a neural-network accelerator.
- **Custom logic**: an FPGA or an ASIC block.

It pays off when a task is computationally heavy, repetitive and well-defined: cryptography, signal filtering, video coding, motor control loops, machine-learning inference.

The costs are the overhead of moving data to and from the accelerator (which can cancel the gain for small jobs), extra design and verification effort, and less flexibility. Profile first, and accelerate only the part that dominates.

## How is an FPGA used for hardware acceleration?

An FPGA is a chip of configurable logic that can be programmed to become almost any digital circuit. For acceleration, the heavy part of an algorithm is implemented as a parallel, pipelined circuit while a processor handles control.

Why it is fast: logic computes many things in the same clock cycle, a pipeline accepts new data every cycle, and timing is exact to the nanosecond.

Typical uses: high-speed signal processing, software-defined radio, image pipelines, motor control with very fast loops, and protocol handling that is too quick for software.

How it connects: as a separate chip on SPI or a parallel bus, or in a system-on-chip that has processor cores and FPGA fabric together (Zynq, for example), where the accelerator appears to software as memory-mapped registers plus streaming or DMA interfaces.

Trade-offs: higher cost and power than a microcontroller, and hardware design is slower to develop and verify than software.

## How is a GPU used for acceleration in embedded systems?

A GPU has hundreds or thousands of simple cores designed to apply the same operation to many data elements at once. That suits graphics, and equally any data-parallel computation.

Embedded uses: computer vision, neural-network inference, image and video processing, sensor fusion in vehicles and robots. Platforms include system-on-chips with Mali, Adreno or PowerVR graphics and modules such as NVIDIA Jetson.

Software reaches it through OpenCL, Vulkan compute or CUDA, or indirectly through an inference framework.

Considerations:

- It helps only when the workload is parallel and large enough to outweigh the cost of transferring data.
- Power and heat are significant; embedded designs are limited by performance per watt.
- Timing is less predictable than a CPU or FPGA, so hard real-time control stays elsewhere.
- For inference alone, a dedicated neural processing unit is often more efficient.

## What is hardware verification?

Verification answers the question "does the design match its specification?" and is done **before** the hardware is manufactured, because a bug found in silicon costs a new fabrication run.

Methods:

- **Simulation**: a testbench drives the design's model with stimulus and checks the responses.
- **Constrained-random testing with coverage**: generate many random but legal stimuli and measure which parts of the design and its behaviours have been exercised.
- **Assertions**: properties written into the design that are checked continuously.
- **Formal verification**: mathematical proof that a property holds for all inputs.
- **Emulation and FPGA prototyping**: run the design much faster than simulation, with real software.
- **Static checks**: lint, clock-domain-crossing analysis, timing analysis.

Verification commonly takes more effort than the design itself. For firmware engineers it matters because verified models and prototypes are what software is developed against before chips exist.

## What is hardware validation?

Validation answers "does the real product do what the user needs?" and is done on **actual hardware**, after manufacture. Verification checks the design against the specification; validation checks the built thing in its real environment.

What it covers:

- **Board bring-up**: power rails, clocks, reset, then each interface in turn.
- **Functional testing** with the real firmware.
- **Electrical characterisation**: signal integrity, timing margins, power consumption.
- **Environmental and stress testing**: temperature, voltage and frequency corners, vibration, long soak runs.
- **Compliance**: electromagnetic compatibility and safety standards.
- **Interoperability** with the other equipment it must work with.

Firmware plays a large part: test firmware exercises each peripheral, and diagnostics built into the product help find faults in the field.

## How are formal methods used in hardware validation?

Formal methods prove properties mathematically instead of testing examples. A simulation shows that a design worked for the cases that were tried; a proof shows it works for every possible input and state.

Techniques:

- **Model checking**: a tool explores every reachable state and either proves a property or returns a counter-example trace showing how it fails.
- **Equivalence checking**: proves two descriptions do the same thing, for example the design before and after synthesis.
- **Theorem proving**: for properties too large for automatic tools, with human guidance.

Properties are written as assertions, such as "a request is always granted within four cycles" or "two grants are never active together".

Good targets are control logic, arbiters, protocols and safety mechanisms. The limit is state-space explosion: large designs must be proved a block at a time. For software, the same idea appears in static analysers that prove the absence of run-time errors, and in languages such as SPARK.

## What is hardware-in-the-loop testing?

In hardware-in-the-loop (HIL) testing the real controller, running its real firmware, is connected to a simulator that imitates the rest of the system in real time. The controller cannot tell it is not in the real machine.

For an engine controller, the simulator computes the engine's behaviour, generates the crank, temperature and pressure signals the controller would see, and reads the injector and ignition outputs it produces.

Why it is used:

- Testing starts before the real machine exists.
- Dangerous or rare conditions can be tested safely: sensor failures, short circuits, extreme temperatures, crashes.
- Tests are repeatable and automated, so they run on every software change.
- It is far cheaper than a prototype vehicle or aircraft.

It needs a plant model accurate enough to be useful, a real-time simulator, and I/O hardware to produce and measure the electrical signals. Related forms are model-in-the-loop, software-in-the-loop and processor-in-the-loop.

## What is hardware-in-the-loop testing with virtual prototypes?

A virtual prototype is a software model of the hardware (the processor, its peripherals, sometimes the whole board) accurate enough to run the unmodified firmware binary. Used in loop testing, it replaces the physical controller, so the whole test bench is simulation: the virtual controller is connected to the plant model.

Advantages:

- Firmware testing starts long before boards exist.
- It scales: hundreds of instances run in parallel in a build farm.
- Complete visibility and control: any register or signal can be inspected, and time can be paused.
- Fault injection is easy: flip a bit, corrupt a bus, fail a sensor, with no risk to equipment.
- Runs are exactly reproducible.

Limits: the model is only as accurate as its authors made it, especially for timing and analog behaviour, so a final round on real hardware is still required. Tools include QEMU, Renode and commercial virtual platforms.

## What is hardware debugging?

Hardware debugging is finding out why a physical board, or the firmware running on it, misbehaves, using instruments that observe the real signals and the real processor.

The tools:

- **Multimeter**: supply voltages, continuity, shorts.
- **Oscilloscope**: the shape and timing of signals; noise, ringing, rise times.
- **Logic analyser**: many digital lines over time, with decoding of UART, SPI, I2C and CAN.
- **Debug probe** (JTAG or SWD): halt the CPU, set breakpoints, read memory and registers.
- **Trace** (SWO, ETM): a record of what the program did, without stopping it.
- **Current probe or power analyser**: consumption over time.

A sound order when a board does nothing: power, then clock, then reset, then whether the debugger can connect, then the program. Many "software" bugs turn out to be a floating pin, a missing pull-up, a marginal supply or a wrong clock.

## What is JTAG, and how is it used for debugging?

JTAG (IEEE 1149.1) is a standard serial interface for accessing the inside of chips. It was created for boundary scan, the testing of connections between chips on a board, and became the standard debug port.

Signals: TCK (clock), TMS (mode select), TDI (data in), TDO (data out) and optionally TRST (reset). Several devices can be chained, each with a test access port.

What it enables:

- **Debugging**: halt, single-step, breakpoints, watchpoints, reading and writing registers and memory.
- **Flash programming.**
- **Boundary scan**: drive and read the pins of a chip to find shorts and open joints.
- **FPGA configuration.**

ARM's **SWD** (serial wire debug) offers the same debug functions over two pins (SWDIO and SWCLK) and is what most Cortex-M boards use.

For security, production devices disable or lock the debug port, since it gives full access to the firmware and memory.

## What is hardware emulation?

Hardware emulation runs a chip design on special equipment that behaves like the chip, before the chip is manufactured. The design is compiled onto an emulator (a large system of FPGAs or custom processors) and then runs thousands of times faster than software simulation.

That speed makes it possible to boot an operating system, run real firmware and process realistic workloads on a design that does not yet exist as silicon, exposing hardware and software bugs together.

Compared with the alternatives:

| | Speed | Visibility into the design | Setup effort |
|---|---|---|---|
| Simulation | Slowest | Complete | Low |
| Emulation | Fast | Good | High |
| FPGA prototype | Fastest | Limited | High |

In firmware work "emulator" also means two other things: an **in-circuit emulator**, a debug tool that stands in for the processor, and a software emulator such as QEMU that runs a binary built for another CPU.

## What is hardware emulation using virtual platforms?

A virtual platform is a software model of a complete system (processor cores, memory, peripherals) that runs on a PC and executes the real, unmodified firmware. It is emulation with no special hardware.

Kinds:

- **Instruction-accurate** models (QEMU, Renode, vendor fast models): quick enough to boot an OS; correct in function, approximate in timing.
- **Cycle-accurate** models: slower, with precise timing, used for performance work.

Uses: writing firmware before the chip exists, automated testing in continuous integration, testing networks of several devices, fault injection, and training.

Strengths are availability, scale, full visibility and determinism. The weakness is fidelity: a peripheral model may be simplified or wrong, analog behaviour is not represented, and timing-dependent bugs may not appear. A virtual platform complements testing on real boards; it does not replace it.

## What is hardware simulation?

Simulation runs a model of a circuit in software to see how it behaves, without building it. A simulator applies inputs to the model and computes the outputs over time.

Types:

- **Digital (RTL) simulation**: simulates a design written in Verilog or VHDL, driven by a testbench, producing waveforms and pass/fail checks.
- **Gate-level simulation**: the design after synthesis, with real delays.
- **Analog (SPICE) simulation**: voltages and currents in a circuit of transistors, resistors and capacitors.
- **Mixed-signal simulation**: both together.
- **System-level simulation**: abstract models of whole systems.

Simulation gives complete visibility of every signal and catches errors before manufacture. Its weaknesses are speed (a large chip simulates at a few cycles per second) and the fact that it only checks the cases the testbench tries. It is the foundation of hardware verification; emulation and prototyping take over when more speed is needed.

## What is hardware co-simulation?

Co-simulation runs two or more different simulators together, exchanging signals and keeping their clocks in step, so that parts of a system modelled in different ways can be tested as a whole.

Common pairings:

- **Hardware with software**: a simulated processor or instruction-set simulator runs the firmware while an RTL simulator runs the custom logic it talks to.
- **Digital with analog**: an RTL simulator coupled to a SPICE simulator.
- **Controller with plant**: the control hardware or code against a model of the physical system, for example in Simulink.

Its value is in the interfaces: it finds mismatched register definitions, wrong assumptions about timing and incorrect handshakes before hardware exists. The main cost is speed, since the whole runs at the pace of the slowest simulator; raising the abstraction of the less important parts (transaction-level models) keeps it usable.

## How is SystemC used for co-simulation?

SystemC is a C++ class library, standardised as IEEE 1666, for modelling hardware and whole systems. It adds to C++ what hardware needs: modules, ports, signals, concurrent processes and a notion of simulated time.

Its main use is **transaction-level modelling (TLM)**. Instead of modelling every wire of a bus on every clock edge, a model describes a whole read or write as one function call. That runs orders of magnitude faster than RTL, fast enough to run real firmware.

In co-simulation it is the common ground:

- A SystemC virtual platform runs the software on an instruction-set simulator.
- Blocks still under design are plugged in as RTL, through adapters between transactions and signals.
- Blocks are swapped from abstract to detailed as the design matures.

That lets architecture exploration, firmware development and hardware verification all work from one model, well before silicon.

## What is hardware modelling?

A hardware model is a description of hardware that can be executed or analysed in place of the real thing. Models are written at different levels of abstraction, trading speed for detail:

| Level | Describes | Used for |
|---|---|---|
| System / algorithmic | What is computed | Exploring algorithms and architecture |
| Transaction level | Reads and writes between blocks | Early software development |
| Register-transfer level (RTL) | Registers and the logic between them, per clock | Design and synthesis |
| Gate level | Logic gates and their delays | Checking timing after synthesis |
| Circuit level | Transistors, voltages and currents | Analog design |

Modelling lets a design be explored, verified and handed to software teams before it is built. A higher-level model is faster and available sooner; a lower-level one is closer to the truth. Most projects use several at once.

## How are hardware description languages used for modelling?

A hardware description language (HDL) describes digital circuits as text. The main ones are Verilog, SystemVerilog and VHDL.

They differ from software languages in essential ways: statements describe hardware that exists all at once, so everything runs concurrently; time and clocks are part of the language; and signals have widths in bits.

```text
// A 4-bit counter with a synchronous reset, in Verilog
module counter (input wire clk, input wire reset, output reg [3:0] count);
  always @(posedge clk) begin
    if (reset) count <= 4'd0;
    else       count <= count + 4'd1;
  end
endmodule
```

Two styles are used: **behavioural** code says what a block does, and **structural** code wires components together. Only a "synthesisable" subset can be turned into real logic; the rest of the language is for testbenches. The same description is simulated to verify it and synthesised to build it.

## What is hardware synthesis?

Synthesis is the automatic translation of a hardware description into a circuit. Logic synthesis takes RTL (Verilog or VHDL) and produces a netlist: a list of logic gates, or for an FPGA of look-up tables and flip-flops, and how they are connected.

The steps:

1. **Translate** the RTL into generic logic.
2. **Optimise** it for the constraints given: clock frequency, area, power.
3. **Map** it onto the cells of the target technology.

After synthesis, **place and route** decides where each cell goes and how the wires run, and **static timing analysis** confirms every path meets the clock period. For an FPGA the result is a bitstream; for an ASIC it is the layout sent for manufacture.

The designer's inputs are the RTL and the constraints. Code that simulates correctly can still synthesise badly, or not at all, if it is written outside the synthesisable subset.

## What is high-level synthesis, and how is it used in co-design?

High-level synthesis (HLS) generates RTL from a description in C, C++ or SystemC. The designer writes the algorithm; the tool decides the schedule (what happens in which clock cycle), the hardware resources and the control logic.

```c
void fir(const int16_t input[N], int16_t output[N], const int16_t coeff[TAPS]) {
  for (int i = TAPS - 1; i < N; i++) {
    #pragma HLS PIPELINE II=1          // ask for one new sample per clock cycle
    int32_t acc = 0;
    for (int t = 0; t < TAPS; t++) acc += input[i - t] * coeff[t];
    output[i] = (int16_t)(acc >> 15);
  }
}
```

In co-design it lowers the wall between hardware and software: the same C function can be run as software, profiled, and then moved into FPGA logic if it is the bottleneck. Directives control the trade between speed and area without rewriting the code.

Limits: only a restricted style of C is supported (no dynamic memory, no recursion, bounded loops), the result is usually less efficient than hand-written RTL, and good results still need an understanding of hardware.

## How are IP cores used in hardware co-design?

An IP (intellectual property) core is a reusable, pre-designed hardware block: a processor core, a UART, an Ethernet MAC, a USB controller, an encryption engine. A system-on-chip or FPGA design is largely assembled from them.

Kinds:

- **Soft IP**: delivered as synthesisable RTL; flexible and portable.
- **Firm IP**: a netlist, partly optimised for a technology.
- **Hard IP**: a finished physical layout; fixed, but with guaranteed performance.

Cores connect through standard buses such as AXI, AHB, APB or Wishbone, so they can be combined like components.

In co-design, each core comes with what software needs: a register map, a driver and often a simulation model, so firmware can be developed alongside the hardware. The benefits are shorter schedules and blocks that are already verified. The concerns are licence cost, integration effort, and trusting the quality and security of someone else's design.

## How do you implement a fault-tolerant system?

A fault-tolerant system continues to operate correctly, or reaches a safe state, when part of it fails. The steps are: detect the fault, contain it, then recover or degrade.

**Detection**

- Watchdog timers for hung software.
- CRCs and checksums on stored data, messages and the program image.
- Range and plausibility checks on sensor values.
- RAM and CPU self-tests at start-up and periodically.
- ECC memory, which also corrects single-bit errors.

**Containment**

- The MPU isolates tasks from each other.
- Defensive checks at module boundaries.

**Recovery**

- Retry a transient fault.
- Restart the failed task, or reset the device, quickly and into a known state.
- Switch to a redundant unit.
- Degrade: keep the essential function and drop the rest.

**Redundancy** comes as duplicated hardware with comparison, triple modular redundancy with voting, or diverse implementations. Start with an analysis (FMEA) of what can fail and what each failure would cause.

## How do you implement a real-time fault-tolerant system?

The added requirement is that detection and recovery must themselves finish within the deadline, so everything is time-bounded.

- **Bounded detection time.** Each mechanism has a known worst-case delay: a watchdog timeout, a heartbeat period, a deadline monitor on each task.
- **Bounded recovery time.** Choose techniques that fit the budget. A hot standby that runs in parallel takes over in milliseconds; a cold restart may take too long.
- **Fault-tolerant time interval.** The time from a fault occurring to a hazard resulting sets the limit for detection plus reaction, and drives the design.
- **Redundancy with voting** masks a fault with no interruption at all.
- **Time-triggered architecture.** A fixed schedule makes a missing or late message immediately visible.
- **Temporal isolation.** Budgets per task, so an overrunning task cannot make others miss deadlines.
- **A defined safe state**, reachable within the time allowed.

Standards such as IEC 61508 and ISO 26262 structure this work and require evidence that the timing holds under fault conditions.
