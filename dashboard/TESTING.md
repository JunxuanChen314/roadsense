# RoadSense Test Guide

## Start the services

From the repository's `dashboard` directory, start SpacetimeDB in the first terminal:

```bash
spacetime start
```

In a second terminal:

```bash
cd roadsense/dashboard
npm run doctor
npm run dev
```

Open `http://127.0.0.1:8080/` in Chrome or Edge. Safari does not support Web Serial.

## Hardware test

1. Connect the ESP32 using a USB data cable.
2. Close every serial monitor that may be using the port.
3. Select **Connect ESP32** and choose the USB serial device.
4. Confirm that MPU6050 and VL53L0X report normal status.
5. Place the vehicle at the start with the distance sensor facing the reference board.
6. Select **Start Detection** and keep the vehicle still during calibration.
7. Drive the route and verify that each impact is saved once.
8. End detection, return to the same start, and select **Warning**.
9. Verify one synchronized motor and buzzer warning about 3 cm before each saved hazard.

## Validate SpacetimeDB

```bash
spacetime sql \
  --server http://127.0.0.1:3000 \
  --anonymous \
  roadsense-v3 \
  "SELECT * FROM road_event"
```

The backend table contains only events recorded by the dashboard. No demo or seed data is inserted by the application.

## Troubleshooting

- Dashboard unavailable: verify that `npm run dev` is running.
- Backend unavailable: verify that SpacetimeDB is running on port 3000.
- Browser cannot find the ESP32: use Chrome or Edge and close all serial monitors.
- MPU6050 or VL53L0X error: verify 3.3V, ground, SDA 21, and SCL 22.
- GPS remains in searching state: test outdoors and verify GPS TX to ESP32 GPIO16 at 9600 baud.
