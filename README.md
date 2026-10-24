# RoadSense

RoadSense is an ESP32-based road-surface monitoring and repeat-pass warning system. A small vehicle records vertical impacts during an initial detection run, associates each event with a centimeter-scale position, stores routes and hazards in SpacetimeDB, and warns the operator before reaching the same location on a later pass. A browser dashboard provides live sensor status, route visualization, event history, data export, and integrated Claude-powered route assessment.

The current prototype is designed for a short, straight tabletop course. A VL53L0X measures the vehicle's distance from a fixed reference board. GPS provides approximate geographic context only and does not control the tabletop route marker.

## Key Features

- MPU6050 vertical-impact detection with stationary baseline calibration and smoothing
- VL53L0X centimeter-scale positioning relative to a fixed reference board
- Independent detection routes with saved hazard positions
- Repeat-pass warning approximately 3 cm before each saved hazard
- One synchronized vibration-motor and buzzer pulse per hazard per warning pass
- Live Web Serial dashboard with sensor health, route progress, events, and history
- SpacetimeDB route and event storage with live synchronization
- Integrated Claude route-level A/B/C assessment and repeat-pass prediction
- CSV and JSON data export with no automatically inserted demo events

## Architecture

```text
MPU6050 ----+
VL53L0X ----+                         +--> SpacetimeDB
GPS --------+--> ESP32 -- USB serial --> Web dashboard
Button -----+                         +--> Claude API
                                              |
Dashboard -- warning command --> ESP32 --> motor + buzzer
```

- The ESP32 samples sensors, detects vertical impacts, controls mode LEDs, and drives the motor and buzzer.
- The browser uses Web Serial to receive telemetry and send mode or alert commands.
- The dashboard converts reference-board distance into traveled distance and manages routes and hazards.
- SpacetimeDB stores synchronized route and event records.
- Claude is integrated for completed-route assessment. Detection, storage, and warning continue operating independently if the external API is temporarily unavailable.

## Hardware

- SparkFun ESP32 IoT RedBoard
- MPU6050 accelerometer and gyroscope
- VL53L0X time-of-flight distance sensor
- UART GPS module
- Vibration motor module
- Three-pin active-low buzzer module
- Blue and red LEDs
- Momentary mode button
- Fixed reference board
- USB data cable

## Wiring

| Function | ESP32 pin | Notes |
|---|---:|---|
| I2C SDA | GPIO 21 | Shared by MPU6050 and VL53L0X |
| I2C SCL | GPIO 22 | Shared by MPU6050 and VL53L0X |
| GPS TX | GPIO 16 | GPS TX to ESP32 RX |
| GPS RX | GPIO 17 | GPS RX to ESP32 TX |
| Vibration motor input | GPIO 25 | Detection feedback and saved-hazard warning |
| Active-low buzzer input | GPIO 27 | HIGH is silent; LOW sounds |
| Blue detection LED | GPIO 32 / A4 | On in detection mode |
| Red warning LED | GPIO 26 | On in warning mode |
| Mode button | GPIO 4 to GND | Uses the internal pull-up |

GPIO 33 is not used. All modules must share ground. Verify the voltage requirements of the exact sensor and actuator boards before powering them.

## Current Detection Parameters

| Parameter | Value | Purpose |
|---|---:|---|
| Sensor interval | 100 ms | MPU6050 and VL53L0X sampling interval |
| Vertical trigger | 1.00 m/s² | Starts tracking a possible bump |
| Return threshold | 0.45 m/s² | Confirms return toward baseline |
| Low-pass filter alpha | 0.22 | Smooths the vertical impact signal |
| Maximum bump duration | 2000 ms | Cancels an event that never returns to baseline |
| Motor settling time | 500 ms | Prevents feedback vibration from becoming a new event |
| Warning lead distance | 30 mm (3 cm) | Sends the warning before the saved position |
| Warning pass allowance | 40 mm | Avoids missing an alert because of a distance jump |
| Warning pulse | 250 ms | Motor and buzzer pulse duration |

Impact is the absolute difference between current Z-axis acceleration and the calibrated stationary Z-axis baseline, followed by exponential smoothing. A bump is recorded only after the signal exceeds `1.00 m/s²` and returns below `0.45 m/s²`. This reduces false detections caused by ordinary horizontal pushing.

These values are tuned for the current tabletop demonstration. They are not certified measurements for full-size vehicles or public-road safety decisions.

## Operating Modes

| Mode | Behavior |
|---|---|
| Idle | Both mode LEDs are off. No impact or saved-hazard alert is generated. |
| Detection | Blue LED is on. Confirmed impacts are recorded and acknowledged with one short motor pulse; the buzzer remains silent. |
| Warning | Red LED is on. Live impact detection is disabled. Each saved hazard produces one synchronized motor and buzzer pulse approximately 3 cm before the saved position. |

## Route Workflow

1. Place the vehicle at the course start with the VL53L0X facing the fixed reference board.
2. Connect the dashboard to the ESP32 through Web Serial.
3. Select **Start Detection** and keep the vehicle still during baseline calibration.
4. Move forward through the course. Each confirmed bump is stored once.
5. Select **End Detection** to complete the route.
6. Return the vehicle to the same start point.
7. Select **Warning** and repeat the route.
8. The motor and buzzer pulse once approximately 3 cm before each saved hazard.
9. Analyze the completed route with Claude to obtain its grade and repeat-pass prediction.

Each hazard is warned once during a warning pass. Warning mode continues until the operator ends it.

## Technology Stack

- Firmware: C++, Arduino framework, PlatformIO
- Hardware: ESP32
- Sensor libraries: Adafruit MPU6050, Adafruit VL53L0X, TinyGPSPlus
- Frontend: HTML, CSS, JavaScript, Vite
- Device connection: Web Serial API
- Backend and live data: SpacetimeDB 2.x, TypeScript
- AI: Anthropic Claude Messages API with structured tool output
- Export: Node.js, CSV, JSON

## Repository Structure

```text
roadsense/
├── dashboard/
│   ├── index.html                 Dashboard markup
│   ├── styles.css                Dashboard styling
│   ├── vite.config.js            Vite and local Claude API endpoint
│   ├── src/roadsense/            Serial, route, state, and UI modules
│   ├── src/spacetime-client.ts   SpacetimeDB client integration
│   ├── src/module_bindings/      Generated SpacetimeDB TypeScript bindings
│   ├── spacetimedb/src/index.ts  Database schema and reducers
│   ├── scripts/                  Diagnostics and data export
│   └── data/README.md            Export format documentation
└── road-detector-esp32/
    ├── platformio.ini            Board and dependency configuration
    └── src/main.cpp              ESP32 firmware
```

## Prerequisites

- Node.js 20 or later and npm
- SpacetimeDB CLI 2.x available as `spacetime`
- PlatformIO Core or the PlatformIO IDE extension
- Chrome or Microsoft Edge with Web Serial support
- The assembled RoadSense prototype and a USB data cable
- An Anthropic API key for the integrated Claude route-analysis feature

Safari does not support the Web Serial workflow used by this project.

## Installation

### 1. Clone and install dashboard dependencies

```bash
git clone https://github.com/JunxuanChen314/roadsense.git
cd roadsense/dashboard
npm install
```

### 2. Configure the environment

```bash
cp .env.example .env
```

Edit `.env`:

```dotenv
ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_MODEL=claude-sonnet-4-6
VITE_SPACETIMEDB_URL=http://127.0.0.1:3000
VITE_SPACETIMEDB_DATABASE=roadsense-v3
```

RoadSense already includes the Claude integration. Each installation must provide a valid `ANTHROPIC_API_KEY` to run route analysis. Monitoring, storage, history, export, and warning remain available if the external API is temporarily unavailable. Never commit `.env`.

### 3. Start and publish SpacetimeDB

If the CLI was installed in its default user directory, add it to `PATH` in each new terminal:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Start the local database in one terminal:

```bash
spacetime start
```

From `roadsense/dashboard`, publish the module in a second terminal:

```bash
npm run stdb:publish
```

If the schema changes, regenerate the TypeScript bindings:

```bash
npm run stdb:generate
```

The public tables are:

- `road_route`: one record per detection run
- `road_event`: detected impacts linked to a route by `route_id`

The application does not insert demo or seed events.

### 4. Build and upload the ESP32 firmware

From the repository root:

```bash
cd road-detector-esp32
pio run
pio run --target upload
```

If the port is busy, disconnect the dashboard and close every serial monitor before retrying. The firmware serial baud rate is `115200`; GPS uses `9600` baud.

### 5. Start the dashboard

From `roadsense/dashboard`:

```bash
npm run dev
```

Open `http://127.0.0.1:8080/`, select **Connect ESP32**, choose the USB serial device, and verify that the MPU6050 and VL53L0X report healthy status.

## Claude Route Assessment

Claude receives a summary of a completed route containing route length, hazard count, maximum and average vertical impact, hazard positions, and spacing. It returns:

- Grade `A`: high risk
- Grade `B`: moderate risk
- Grade `C`: low risk
- Confidence from 0 to 100
- A written route assessment
- A cautious prediction for a repeat pass

A completed route with zero detected impacts is defined as grade C. The result is relative to the tabletop demonstration and is not a certified real-road rating. The API key stays in the local Vite server process and is not exposed through a `VITE_` browser variable.

## Serial Commands

| Command | Meaning |
|---|---|
| `S` or `D` | Enter detection mode |
| `E` | Enter idle mode |
| `W` | Enter warning mode |
| `A` | In warning mode, trigger one synchronized motor and buzzer alert |

## Validation

From `roadsense/dashboard`:

```bash
npm run typecheck
npm run build
npm run doctor
```

From `roadsense/road-detector-esp32`:

```bash
pio run
```

`npm run doctor` checks Node.js, generated bindings, frontend dependencies, the local SpacetimeDB service, the `roadsense-v3` database, and Claude configuration.

## Data Export

With SpacetimeDB running:

```bash
npm run export:data
```

This generates local files that are intentionally excluded from Git:

- `dashboard/data/road-events.csv`
- `dashboard/data/road-events.json`

For continuous five-second export:

```bash
npm run export:watch
```

## Troubleshooting

### Dashboard does not open

Confirm that `npm run dev` is running and open `http://127.0.0.1:8080/`.

### Browser cannot find the ESP32

- Use Chrome or Edge.
- Use a USB data cable, not a charge-only cable.
- Close PlatformIO Serial Monitor and other programs using the port.
- Reconnect the ESP32 and select **Connect ESP32** again.

### Firmware upload says the port is busy

Disconnect the dashboard and close all serial monitors before uploading.

### MPU6050 or VL53L0X fails

- Verify 3.3 V and common ground.
- Verify SDA on GPIO 21 and SCL on GPIO 22.
- Expected I2C addresses are commonly `0x68` or `0x69` for the MPU6050 and `0x29` for the VL53L0X.

### Distance is invalid or traveled distance remains zero

- Point the VL53L0X at the fixed reference board.
- Place the vehicle at the start before beginning detection.
- Keep the reference board stationary for the entire detection and warning pass.
- The firmware accepts 30-1500 mm measurements, but practical range depends on target reflectivity and the environment.

### Horizontal pushing creates false impacts

- Keep the vehicle still during mode-entry calibration.
- Mount the MPU6050 securely with its Z axis aligned to the intended vertical direction.
- Change `VERTICAL_TRIGGER_MS2` only after collecting repeatable test data.

### GPS remains in waiting state

Test outdoors or near a window, verify GPS TX to GPIO 16, and confirm 9600-baud output. GPS does not control the tabletop route marker.

### SpacetimeDB is disconnected

- Confirm that `spacetime start` is running on port 3000.
- Republish `roadsense-v3` with `npm run stdb:publish`.
- Confirm the URL and database name in `.env`.

### Claude analysis fails

- Confirm that `.env` contains a valid `ANTHROPIC_API_KEY`.
- Restart `npm run dev` after changing `.env`.
- Confirm network access and API account availability.
- Detection and warning remain usable without Claude.

## Prototype Limitations

- The route model assumes forward travel along a straight path toward the fixed reference board.
- Traveled distance is not inferred from wheel encoders or GPS.
- Reverse motion is not part of the normal detection pass.
- GPS accuracy is insufficient for positioning on the tabletop course.
- Sensor mounting, board reflectivity, vibration, and manual handling can affect measurements.
- Thresholds and grades are demonstration-specific and are not road-safety certification results.
- Do not use this prototype as the sole basis for navigation or safety-critical decisions.

## Security and Privacy

- Keep `.env` and API keys out of version control.
- Review exported data before sharing it, especially when GPS coordinates are present.
- Web Serial access is granted explicitly through the browser device picker.
- The current system is designed for local operation; public deployment requires a separate security and hosting review.

## License

No open-source license has been added. All rights are reserved unless the repository owner adds a license.
