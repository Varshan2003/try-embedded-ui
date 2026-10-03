# Protocols, networking and storage

## How do you implement a communication protocol?

A protocol is an agreement on how bytes are grouped into messages and what each message means. Design the frame first, then write a parser that survives noise and partial data.

A typical frame: `start byte | length | type | payload | CRC`.

```c
typedef enum { WAIT_START, WAIT_LENGTH, WAIT_PAYLOAD, WAIT_CRC } rx_state_t;

void protocol_feed(uint8_t byte) {               // call for every received byte
  static rx_state_t state = WAIT_START;
  static uint8_t length, index, buffer[64];

  switch (state) {
    case WAIT_START:   if (byte == 0x7E) state = WAIT_LENGTH; break;
    case WAIT_LENGTH:
      if (byte > sizeof buffer) { state = WAIT_START; break; }     // reject, resynchronise
      length = byte; index = 0;
      state = length ? WAIT_PAYLOAD : WAIT_CRC;
      break;
    case WAIT_PAYLOAD: buffer[index++] = byte; if (index == length) state = WAIT_CRC; break;
    case WAIT_CRC:
      if (crc8(buffer, length) == byte) handle_message(buffer, length);
      state = WAIT_START;
      break;
  }
}
```

Essentials: a state machine fed one byte at a time, validation of every length before use, a checksum or CRC, a timeout that resets the parser when a frame stalls, a defined byte order, and a version field so the protocol can evolve.

## How do you implement a communication protocol stack?

A stack splits communication into layers. Each layer offers a service to the one above, uses the one below, and wraps the data in its own header on the way down and removes it on the way up.

| Layer | Job | Example |
|---|---|---|
| Application | Meaning of the messages | Commands, sensor reports |
| Transport | Reliability, ordering, splitting large messages | Sequence numbers, acknowledgements, retries |
| Network | Addressing and routing | Node addresses |
| Data link | Framing, error detection, access to the medium | Start byte, length, CRC |
| Physical | Bits on the wire | UART, RS-485, radio |

Implementation points:

- Give each layer a narrow interface: a `send` function downwards and a receive callback upwards, so layers can be tested and replaced separately.
- Pass buffers by pointer with space reserved for headers, to avoid copying at each layer.
- Run each layer as a state machine with its own timers.
- Keep ISRs to moving bytes; do the protocol work in a task.

## How do you implement a real-time communication protocol?

A real-time protocol must deliver messages within a known time, so the design aims at bounded latency rather than best effort.

Techniques:

- **Deterministic access to the medium.** Time slots (TDMA), a controller that polls each device, or priority-based arbitration as in CAN, where the lowest identifier always wins without destroying the frame.
- **Priorities.** Urgent messages go first, in the queue and on the wire.
- **Short, fixed-size frames**, so the wait behind another frame is bounded.
- **Time synchronisation** between nodes, when sending is scheduled by time.
- **Bounded retries.** Late data is often worse than no data, so periodic values are simply replaced by the next sample.
- **Timestamps and sequence numbers**, so the receiver can detect stale or missing data.

Examples: CAN and CAN FD, FlexRay, EtherCAT, PROFINET and Time-Sensitive Networking. Verify with worst-case latency analysis and measurement under full bus load.

## How do you implement a real-time communication protocol stack?

Combine the layering of a stack with real-time discipline at every layer, because the end-to-end latency is the sum of the delays in each.

- **Bound each layer's processing time**: no unbounded loops, no dynamic allocation; use pre-allocated buffer pools.
- **Avoid copies**: pass one buffer down through the layers.
- **Carry priority through the stack**: separate queues per priority, so a bulk transfer cannot delay a control message.
- **Split by urgency**: time-critical cyclic data takes a short path, often handled directly in the interrupt or a high-priority task; configuration and diagnostics take the slow path.
- **Use hardware support**: timestamping, DMA, hardware filtering of identifiers.
- **Schedule transmission by time** where the network supports it.
- **Supervise**: per-message timeouts, and a defined safe reaction when a deadline is missed.

In practice, industrial stacks such as CANopen and EtherCAT are bought or taken from open source and certified, not written from scratch.

## How do you implement a fault-tolerant communication protocol?

A fault-tolerant protocol keeps working, or fails safely, when frames are corrupted, lost, duplicated, reordered or delayed.

| Fault | Defence |
|---|---|
| Corruption | A CRC on every frame; discard on mismatch |
| Loss | Acknowledgement, timeout and retransmission with a retry limit |
| Duplication | Sequence numbers; ignore a repeat |
| Reordering | Sequence numbers; reorder or reject |
| Delay | Timestamps or a freshness counter |
| A dead peer | Heartbeat messages and a supervision timeout |
| A broken link | A redundant channel, with switch-over |
| Wrong recipient | Source and destination identifiers in the frame |

Choose the CRC length for the frame size and the error rate, back off between retries, and decide what the application does when communication is lost: usually hold a safe state. Safety protocols such as CANopen Safety and PROFIsafe add these measures on top of an ordinary link, treating it as an untrusted "black channel".

## How do you implement a secure communication protocol stack?

Security adds four guarantees to a protocol: confidentiality, integrity, authenticity and freshness.

- **Use a standard protocol**: TLS over TCP, DTLS over UDP, or a link's own security (Bluetooth LE pairing, for example). Do not invent cryptography.
- **Use a proven library**, such as Mbed TLS or wolfSSL, and the chip's hardware crypto accelerators.
- **Authenticated encryption** (AES-GCM or ChaCha20-Poly1305) gives confidentiality and integrity together.
- **Authenticate both ends** with certificates or pre-shared keys.
- **Prevent replay** with nonces, counters or timestamps.
- **Protect the keys**: per-device keys, stored in a secure element or protected flash, never in source code.
- **Good randomness**: use the hardware true random number generator.
- **Secure the device too**: secure boot, signed firmware updates, debug port locked.

Budget for the cost: a TLS stack needs tens of kilobytes of flash and RAM, and a handshake using public-key operations can take seconds on a small microcontroller.

## How do you implement a distributed communication protocol stack?

In a distributed system many nodes communicate as peers, so the stack needs functions that a point-to-point link does not:

- **Addressing and discovery**: how nodes find each other and what services each offers.
- **Routing or forwarding**, if not every node can hear every other (mesh networks).
- **A communication model**: publish/subscribe (MQTT, DDS, CAN broadcasts) decouples senders from receivers better than request/response.
- **Time synchronisation**, so events from different nodes can be ordered.
- **Membership and failure detection**: heartbeats, and what happens when a node joins or leaves.
- **Consistency rules**: what happens when two nodes disagree, or a message arrives twice.

Design each node to keep working when the network is partitioned, make operations idempotent so retries are harmless, and version the messages so nodes with different firmware can interoperate.

## How do you implement a real-time network stack?

On a microcontroller this usually means integrating a small TCP/IP stack such as lwIP and making its behaviour predictable.

- **Driver**: receive by interrupt or DMA into pre-allocated buffers, and pass them to the stack without copying.
- **Memory**: fixed buffer pools, sized for the worst case; no heap in the data path.
- **Prefer UDP for time-critical data.** TCP's retransmission and congestion control make its timing unbounded; keep it for configuration and bulk transfer.
- **Prioritise**: a high-priority task and queue for real-time traffic, separate from general traffic.
- **Use the hardware**: checksum offload, timestamping for IEEE 1588 clock synchronisation, and Time-Sensitive Networking features where the network supports them.
- **Protect against overload**: rate-limit or drop low-priority traffic so a broadcast storm cannot starve the control task.

For hard real-time control, a dedicated industrial Ethernet protocol is used alongside or instead of TCP/IP.

## How do you implement an embedded web server?

An embedded web server lets a browser configure and monitor a device. It sits on top of a TCP/IP stack.

The core loop:

1. Listen on port 80 (or 443 for HTTPS).
2. Accept a connection and read the request line and headers: `GET /status HTTP/1.1`.
3. Route by method and path to a handler.
4. Send a status line, headers and a body, then close or keep the connection.

```c
static void handle_request(connection_t *c, const char *method, const char *path) {
  if (!strcmp(method, "GET") && !strcmp(path, "/status")) {
    char body[64];
    int n = snprintf(body, sizeof body, "{\"temp\":%d,\"uptime\":%lu}", read_temp(), (unsigned long)uptime_s());
    send_response(c, 200, "application/json", body, (size_t)n);
  } else send_response(c, 404, "text/plain", "Not found", 9);
}
```

Practical points: store static pages compressed in flash, expose data as a small JSON API, limit simultaneous connections and request sizes, parse defensively, and require authentication and TLS for anything beyond a private network. Libraries such as the lwIP httpd or Mongoose provide the server.

## How do you implement a real-time distributed system?

A real-time distributed system must meet end-to-end deadlines across several nodes, so the timing budget covers sensing, computing, the network and actuation together.

Building blocks:

- **A common time base**: clock synchronisation (IEEE 1588 or the bus's own mechanism) so nodes agree on when things happen.
- **A deterministic network**: CAN, FlexRay, EtherCAT or TSN, with bounded message latency.
- **A global schedule or priority scheme**: either time-triggered, where every node acts in assigned slots, or event-triggered with analysed priorities.
- **End-to-end budgeting**: split each deadline into per-node and per-hop allowances and verify each.
- **Fault handling**: heartbeats, timeouts on every expected message, redundancy for critical functions, and a defined degraded mode.
- **Data age**: timestamp values so a consumer can reject stale ones.

A car is the everyday example: dozens of controllers cooperate over CAN and Ethernet to deliver braking and steering functions within milliseconds.

## How do you implement an embedded database?

Most devices need to store records: settings, logs, measurements. The options, in rising order of capability:

1. **A key-value store on raw flash**: entries appended to a log, with the newest value for a key winning, and garbage collection when a page fills. Small, wear-levelled and power-fail safe. Examples: NVS in ESP-IDF and Zephyr.
2. **Fixed-size records in a circular log**, for time-series data.
3. **A database library on a file system**, such as SQLite, when queries and transactions are needed. It needs hundreds of kilobytes.

Requirements that shape the design:

- **Power-fail safety**: an update is either complete or absent. Write the new data first, then commit with one small atomic write.
- **Wear levelling**: spread erases across the flash.
- **Integrity**: a CRC on each record.
- **Bounded time and memory** for real-time use: static buffers, and garbage collection done in the background or in bounded steps.

## How do you implement a file system?

A file system organises raw storage blocks into named files and directories. In practice a proven one is integrated; the work is the layer underneath.

**Choose by the medium:**

- **FAT** (FatFs) for SD cards and USB drives that a PC must read. It is not power-fail safe.
- **LittleFS or SPIFFS** for raw NOR flash: they do wear levelling and survive power loss.
- **UBIFS, YAFFS or JFFS2** for raw NAND, which also needs bad-block management and error correction.

**Provide the block device interface** the file system asks for:

```c
int disk_read(uint32_t block, uint8_t *buffer, uint32_t count);
int disk_write(uint32_t block, const uint8_t *buffer, uint32_t count);
int disk_erase(uint32_t block, uint32_t count);
int disk_sync(void);
```

**Then handle the system concerns:** a lock if several tasks use it, flushing after important writes, what happens when power fails mid-write, and how the device behaves when the storage is full or worn out.

## What makes a file system suitable for real-time use?

A general file system can stall a write for a long, unpredictable time while it allocates blocks, erases flash or collects garbage. A real-time file system bounds that.

- **Bounded operation times**, or at least a documented worst case.
- **Pre-allocation**: reserve a file's space in advance so writes need no allocation.
- **Contiguous files** for streaming data, so access needs no searching.
- **Background or incremental garbage collection**, in bounded steps, instead of a long pause when space runs out.
- **Power-fail safety** without a lengthy check at start-up.
- **Priority-aware locking**, so a logging task cannot block a control task.

The usual design keeps storage out of the time-critical path altogether: the real-time task writes to a RAM buffer or queue, and a lower-priority task writes it to the file system.

## What is a file system journal, and how is it implemented?

A journal makes multi-step updates survive a crash. Before changing the file system's structures, the changes are first written to a dedicated log area. After a power failure, the log is replayed or discarded, leaving the file system consistent without a full scan.

The sequence for one transaction:

1. Write a description of the changes (the new metadata blocks) to the journal.
2. Write a **commit record**, with a checksum. This single write is the point of no return.
3. Apply the changes to their real locations (the checkpoint).
4. Mark the journal entry free.

Recovery at start-up: a transaction with a valid commit record is replayed; one without is ignored.

Trade-offs: journalling only metadata is cheaper but can leave file contents stale; journalling data too doubles the writes. On flash, extra writes mean extra wear, so flash file systems tend to be log-structured or copy-on-write instead (LittleFS, for example), which gives the same atomicity without writing everything twice.

## What is a virtual file system?

A virtual file system (VFS) is a layer that gives applications one file API (`open`, `read`, `write`, `close`) over several different file systems and devices. The application does not know or care whether a path lives on FAT, LittleFS or is really a device.

It works with a table of operations per file system and a mount table mapping path prefixes to them:

```c
typedef struct {
  int (*open)(void *fs, const char *path, int flags);
  int (*read)(void *fs, int fd, void *buffer, size_t length);
  int (*write)(void *fs, int fd, const void *buffer, size_t length);
  int (*close)(void *fs, int fd);
} fs_ops_t;

typedef struct { const char *prefix; const fs_ops_t *ops; void *fs; } mount_t;

static mount_t mounts[] = { { "/sd", &fat_ops, &sd_card }, { "/flash", &littlefs_ops, &internal } };
```

A call finds the mount whose prefix matches the path and forwards to that driver. For real-time use the layer itself must add only bounded overhead, with a fixed-size file-descriptor table and no allocation per call. ESP-IDF, Zephyr and NuttX all provide one.

## How do you implement a secure file system?

A secure file system protects stored data against reading and tampering by someone who has the device or its storage chip.

- **Confidentiality**: encrypt data at rest, typically with AES in XTS mode per block, or with an authenticated mode per file.
- **Integrity**: a MAC or authenticated encryption on each block, so modified data is detected rather than used.
- **Rollback protection**: a monotonic counter in secure hardware, so an attacker cannot restore an old copy of the storage.
- **Key management**: derive the key from a secret that never leaves the chip (a hardware unique key, a secure element or a trusted execution environment); never store it beside the data.
- **Access control**: which task or user may open which file.
- **Secure deletion**: on flash, overwriting does not erase old copies, so destroy the key instead.

It depends on the rest of the chain: secure boot, a locked debug port and protected key storage. Encrypted flash on ESP32 and encrypted LittleFS or NVS partitions are common real examples.
