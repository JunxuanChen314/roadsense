# RoadSense ESP32

PlatformIO firmware for the SparkFun ESP32 IoT RedBoard.

## Wiring

| Function | ESP32 Pin |
|---|---:|
| I2C SDA | 21 |
| I2C SCL | 22 |
| GPS TX → ESP32 RX | 16 |
| GPS RX ← ESP32 TX | 17 |
| Vibration motor IN | 25 |
| Active buzzer IN | 27 |
| Blue detection LED | 32 / A4 |
| Red warning LED | 26 |
| Mode button | 4 → GND |

GPIO 33 is not used.

## Behavior

- Idle: both LEDs are off.
- Detection mode: the blue LED is on; an impact at or above `1.00 m/s²` is tracked and recorded after the vertical signal returns toward the calibrated baseline. A confirmed impact produces one short vibration.
- Warning mode: the red LED is on; when the dashboard reaches a saved hazard,
  the vibration motor and buzzer produce one synchronized short warning.
- Mode button: switches only between detection and warning modes.
- VL53L0X: measures the vehicle's distance from the fixed reference board; the board itself is not treated as an obstacle.

## Serial Commands

- `S`: start detection
- `E`: end detection and enter idle mode
- `D`: switch to detection mode
- `W`: switch to warning mode
- `A`: in warning mode only, trigger the saved-hazard motor and buzzer warning

The serial baud rate is `115200`.
