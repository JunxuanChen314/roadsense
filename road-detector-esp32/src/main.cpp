#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_VL53L0X.h>
#include <Arduino.h>
#include <TinyGPSPlus.h>
#include <Wire.h>

// Wiring confirmed with the physical prototype.
constexpr uint8_t PIN_LED_DETECTION = 32; // Blue LED / A4
constexpr uint8_t PIN_LED_WARNING = 26;   // Red LED
constexpr uint8_t PIN_MOTOR = 25;
constexpr uint8_t PIN_BUZZER = 27;
// The installed three-pin buzzer module is active-low: HIGH is silent and
// LOW sounds. Keep it silent during boot and outside saved-hazard warnings.
constexpr uint8_t BUZZER_OFF = HIGH;
constexpr uint8_t BUZZER_ON = LOW;
constexpr uint8_t PIN_MODE_BUTTON = 4;
constexpr uint8_t PIN_GPS_RX = 16;
constexpr uint8_t PIN_GPS_TX = 17;
constexpr uint8_t PIN_I2C_SDA = 21;
constexpr uint8_t PIN_I2C_SCL = 22;

constexpr uint32_t SERIAL_BAUD = 115200;
constexpr uint32_t GPS_BAUD = 9600;
constexpr uint32_t SENSOR_INTERVAL_MS = 100;
constexpr uint32_t STATUS_INTERVAL_MS = 500;
constexpr uint32_t GPS_MAX_AGE_MS = 2000;
constexpr uint32_t BUTTON_DEBOUNCE_MS = 40;
constexpr uint32_t MOTOR_PULSE_MS = 250;
constexpr uint32_t MOTOR_PULSE_GAP_MS = 180;
constexpr uint32_t MOTOR_SETTLE_MS = 500;
constexpr uint32_t BUMP_MAX_DURATION_MS = 2000;
constexpr float VERTICAL_TRIGGER_MS2 = 1.00F;
constexpr float VERTICAL_RETURN_MS2 = 0.45F;
constexpr float IMPACT_FILTER_ALPHA = 0.22F;

enum class Mode { IDLE, DETECTION, WARNING };

Adafruit_MPU6050 mpu;
Adafruit_VL53L0X tof;
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

Mode mode = Mode::IDLE;
bool mpuReady = false;
bool tofReady = false;
bool motorActive = false;
bool buzzerEnabledForPattern = false;
uint8_t pendingMotorPulses = 0;
bool lastButtonReading = HIGH;
bool stableButtonState = HIGH;

enum class BumpState { STABLE, TRACKING };
BumpState bumpState = BumpState::STABLE;

uint32_t lastSensorAt = 0;
uint32_t lastStatusAt = 0;
uint32_t motorStartedAt = 0;
uint32_t motorStoppedAt = 0;
uint32_t nextMotorPulseAt = 0;
uint32_t buttonChangedAt = 0;
uint32_t bumpStartedAt = 0;

float ax = 0.0F;
float ay = 0.0F;
float az = 0.0F;
float gravityBaseline = 9.81F;
float baselineAz = 9.81F;
float impact = 0.0F;
float baselinePitchDeg = 0.0F;
float baselineRollDeg = 0.0F;
float tiltDeg = 0.0F;
float previousTiltDeg = 0.0F;
float maxTiltDeg = 0.0F;
float peakImpact = 0.0F;
uint16_t peakDistanceMm = 0;
uint16_t distanceMm = 0;
bool distanceValid = false;

void calibrateMpu();

const char *modeName() {
  if (mode == Mode::DETECTION)
    return "DETECTION";
  if (mode == Mode::WARNING)
    return "WARNING";
  return "IDLE";
}

void renderModeLeds() {
  digitalWrite(PIN_LED_DETECTION, mode == Mode::DETECTION ? HIGH : LOW);
  digitalWrite(PIN_LED_WARNING, mode == Mode::WARNING ? HIGH : LOW);
}

void setMode(Mode nextMode) {
  mode = nextMode;
  bumpState = BumpState::STABLE;
  maxTiltDeg = 0.0F;
  peakImpact = 0.0F;
  renderModeLeds();
  Serial.printf("[MODE] %s\n", modeName());
  if (mode == Mode::DETECTION || mode == Mode::WARNING)
    calibrateMpu();
}

void beginMotorPulse() {
  motorActive = true;
  motorStartedAt = millis();
  digitalWrite(PIN_MOTOR, HIGH);
  digitalWrite(PIN_BUZZER,
               buzzerEnabledForPattern ? BUZZER_ON : BUZZER_OFF);
}

void startMotorPattern(const char *reason, uint8_t pulseCount,
                       bool includeBuzzer = false) {
  if (motorActive || pendingMotorPulses > 0 || pulseCount == 0)
    return;
  buzzerEnabledForPattern = includeBuzzer;
  pendingMotorPulses = pulseCount - 1;
  beginMotorPulse();
  Serial.printf("[MOTOR] pattern=%u reason=%s\n", pulseCount, reason);
}

void updateMotor() {
  const uint32_t now = millis();
  if (motorActive && now - motorStartedAt >= MOTOR_PULSE_MS) {
    digitalWrite(PIN_MOTOR, LOW);
    digitalWrite(PIN_BUZZER, BUZZER_OFF);
    motorActive = false;
    motorStoppedAt = now;
    nextMotorPulseAt = now + MOTOR_PULSE_GAP_MS;
    Serial.println("[MOTOR] pulse complete");
  }
  if (motorActive || pendingMotorPulses == 0 || now < nextMotorPulseAt)
    return;
  pendingMotorPulses -= 1;
  beginMotorPulse();
}

void readGps() {
  while (gpsSerial.available())
    gps.encode(gpsSerial.read());
}

void readSensors() {
  if (millis() - lastSensorAt < SENSOR_INTERVAL_MS)
    return;
  lastSensorAt = millis();

  if (mpuReady) {
    sensors_event_t acceleration, rotation, temperature;
    mpu.getEvent(&acceleration, &rotation, &temperature);
    ax = acceleration.acceleration.x;
    ay = acceleration.acceleration.y;
    az = acceleration.acceleration.z;
    // Use vertical movement relative to the stationary baseline. Horizontal
    // pushing should not be treated as a pothole.
    const float rawImpact = fabsf(az - baselineAz);
    impact += IMPACT_FILTER_ALPHA * (rawImpact - impact);
    const float pitchDeg = atan2f(ay, sqrtf(ax * ax + az * az)) *
                           180.0F / PI;
    const float rollDeg = atan2f(-ax, az) * 180.0F / PI;
    const float pitchOffset = pitchDeg - baselinePitchDeg;
    const float rollOffset = rollDeg - baselineRollDeg;
    previousTiltDeg = tiltDeg;
    tiltDeg = sqrtf(pitchOffset * pitchOffset + rollOffset * rollOffset);
  }

  if (tofReady) {
    VL53L0X_RangingMeasurementData_t measurement;
    tof.rangingTest(&measurement, false);
    distanceMm = measurement.RangeMilliMeter;
    distanceValid = measurement.RangeStatus == 0 && distanceMm >= 30 &&
                    distanceMm <= 1500;
  }
}

// A valid tabletop bump is one clear vertical movement followed by a return to
// the stationary baseline. Warning mode only replays saved hazards.
void detectImpact() {
  if (mode != Mode::DETECTION || !mpuReady || motorActive ||
      millis() - motorStoppedAt < MOTOR_SETTLE_MS)
    return;

  if (bumpState == BumpState::STABLE) {
    if (impact < VERTICAL_TRIGGER_MS2)
      return;
    bumpState = BumpState::TRACKING;
    bumpStartedAt = millis();
    maxTiltDeg = tiltDeg;
    peakImpact = impact;
    peakDistanceMm = distanceValid ? distanceMm : 0;
    Serial.printf("[BUMP] TRACKING vertical=%.2f\n", impact);
    return;
  }

  if (tiltDeg > maxTiltDeg)
    maxTiltDeg = tiltDeg;
  if (impact > peakImpact) {
    peakImpact = impact;
    peakDistanceMm = distanceValid ? distanceMm : peakDistanceMm;
  }

  if (millis() - bumpStartedAt > BUMP_MAX_DURATION_MS) {
    bumpState = BumpState::STABLE;
    Serial.println("[BUMP] CANCELLED reason=no-return");
    return;
  }

  if (impact > VERTICAL_RETURN_MS2)
    return;

  Serial.printf("[IMPACT] DETECTED value=%.2f distance_mm=%u tilt_deg=%.1f severity=NORMAL\n",
                peakImpact, peakDistanceMm, maxTiltDeg);
  startMotorPattern("impact-detected", 1);
  bumpState = BumpState::STABLE;
}

void readModeButton() {
  const bool reading = digitalRead(PIN_MODE_BUTTON);
  if (reading != lastButtonReading) {
    lastButtonReading = reading;
    buttonChangedAt = millis();
  }
  if (millis() - buttonChangedAt < BUTTON_DEBOUNCE_MS ||
      reading == stableButtonState)
    return;
  stableButtonState = reading;
  if (stableButtonState == LOW)
    setMode(mode == Mode::WARNING ? Mode::DETECTION : Mode::WARNING);
}

void handleCommand(char command) {
  switch (command) {
  case 'S':
  case 's':
  case 'D':
  case 'd':
    setMode(Mode::DETECTION);
    break;
  case 'E':
  case 'e':
    setMode(Mode::IDLE);
    break;
  case 'W':
  case 'w':
    setMode(Mode::WARNING);
    break;
  case 'A':
  case 'a':
    if (mode == Mode::WARNING)
      startMotorPattern("saved-hazard-warning", 1, true);
    break;
  default:
    break;
  }
}

void readSerialCommands() {
  while (Serial.available())
    handleCommand(static_cast<char>(Serial.read()));
}

void printStatus() {
  if (millis() - lastStatusAt < STATUS_INTERVAL_MS)
    return;
  lastStatusAt = millis();

  Serial.printf("DATA mode=%s mpu=%s ax=%.2f ay=%.2f az=%.2f impact=%.2f tilt=%.1f ",
                modeName(), mpuReady ? "OK" : "FAIL", ax, ay, az, impact,
                tiltDeg);
  if (!tofReady)
    Serial.print("vl53=FAIL distance_mm=0 ");
  else if (!distanceValid)
    Serial.print("vl53=INVALID distance_mm=0 ");
  else
    Serial.printf("vl53=OK distance_mm=%u ", distanceMm);

  const uint32_t gpsAge = gps.location.age();
  if (gps.location.isValid() && gpsAge <= GPS_MAX_AGE_MS) {
    Serial.printf("gps=FIX sats=%lu lat=%.6f lng=%.6f age_ms=%lu hdop=%.1f ",
                  static_cast<unsigned long>(gps.satellites.value()),
                  gps.location.lat(), gps.location.lng(),
                  static_cast<unsigned long>(gpsAge),
                  gps.hdop.isValid() ? gps.hdop.hdop() : 99.9);
  } else if (gps.location.isValid()) {
    Serial.printf("gps=STALE sats=%lu age_ms=%lu ",
                  static_cast<unsigned long>(gps.satellites.value()),
                  static_cast<unsigned long>(gpsAge));
  } else {
    Serial.printf("gps=WAIT sats=%lu ",
                  static_cast<unsigned long>(gps.satellites.value()));
  }
  Serial.printf("motor=%s bump=%s\n", motorActive ? "ON" : "OFF",
                bumpState == BumpState::STABLE ? "STABLE" : "TRACKING");
}

void calibrateMpu() {
  if (!mpuReady)
    return;
  Serial.println("[MPU] Keep car still for calibration");
  float magnitudeSum = 0.0F;
  float azSum = 0.0F;
  float pitchSum = 0.0F;
  float rollSum = 0.0F;
  constexpr uint16_t sampleCount = 50;
  for (uint16_t i = 0; i < sampleCount; ++i) {
    sensors_event_t acceleration, rotation, temperature;
    mpu.getEvent(&acceleration, &rotation, &temperature);
    const float x = acceleration.acceleration.x;
    const float y = acceleration.acceleration.y;
    const float z = acceleration.acceleration.z;
    magnitudeSum += sqrtf(x * x + y * y + z * z);
    azSum += z;
    pitchSum += atan2f(y, sqrtf(x * x + z * z)) * 180.0F / PI;
    rollSum += atan2f(-x, z) * 180.0F / PI;
    delay(20);
  }
  gravityBaseline = magnitudeSum / sampleCount;
  baselineAz = azSum / sampleCount;
  baselinePitchDeg = pitchSum / sampleCount;
  baselineRollDeg = rollSum / sampleCount;
  impact = 0.0F;
  tiltDeg = 0.0F;
  previousTiltDeg = 0.0F;
  Serial.printf("[MPU] baseline=%.3f pitch=%.1f roll=%.1f\n",
                gravityBaseline, baselinePitchDeg, baselineRollDeg);
}

void setup() {
  digitalWrite(PIN_MOTOR, LOW);
  // Set the output latch before enabling the pin to avoid a startup beep.
  digitalWrite(PIN_BUZZER, BUZZER_OFF);
  pinMode(PIN_MOTOR, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_DETECTION, OUTPUT);
  pinMode(PIN_LED_WARNING, OUTPUT);
  pinMode(PIN_MODE_BUTTON, INPUT_PULLUP);
  renderModeLeds();

  Serial.begin(SERIAL_BAUD);
  delay(500);
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(100000);
  mpuReady = mpu.begin(0x68, &Wire) || mpu.begin(0x69, &Wire);
  tofReady = tof.begin(0x29, false, &Wire);
  if (mpuReady) {
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
    calibrateMpu();
  }
  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
  Serial.printf("[READY] MPU=%s VL53=%s\n", mpuReady ? "OK" : "FAIL",
                tofReady ? "OK" : "FAIL");
  Serial.println("[COMMANDS] S=start E=end W=warning A=alert");
}

void loop() {
  readGps();
  readSensors();
  readModeButton();
  readSerialCommands();
  updateMotor();
  detectImpact();
  printStatus();
}
