/*
  Smart Helmet IoT System - ESP32 Firmware
  Target Board: ESP32 DevKit (30-pin / 38-pin)
  Communication: HTTPS REST to Firebase Realtime Database
  
  HARDWARE CONFIGURATION:
  - IR Helmet Sensor: GPIO 19 or GPIO 21 (Configured below, INPUT_PULLUP enabled)
  - Piezo Buzzer: GPIO 25 (Active-HIGH)
  - MQ-3 Alcohol Gas Sensor: GPIO 34 (ADC1 Channel 6, Input-Only pin)
  
  POWER SUPPLY & VOLTAGE SAFETY:
  - Power: 7.4V LiPo Battery connected to high-efficiency DC-DC Buck Converter stepped down to 5.0V.
  - Connect Buck Converter 5.0V output to ESP32 VIN (or 5V pin) and GND.
  - IMPORTANT: MQ-3 heater requires 5V. However, ESP32 GPIOs (including GPIO 34) are NOT 5V tolerant (Max 3.3V).
    Use a 2-resistor voltage divider (e.g., 10k / 20k) on the MQ-3 analog pin to condition 0-5V down to 0-3.3V.
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ==========================================
// 1. NETWORK & FIREBASE CONFIGURATION
// ==========================================
const char* WIFI_SSID     = "YOUR_PHONE_HOTSPOT_NAME";
const char* WIFI_PASSWORD = "YOUR_PHONE_HOTSPOT_PASSWORD";

// Firebase Web API Key (From Firebase Console > Project Settings > General)
const char* FIREBASE_API_KEY = "AIzaSyCP5DJHNgHqYlhZ6WG2nqEjkSZR8i5Vd2c";

// Firebase Realtime Database URL (without trailing slash)
const char* FIREBASE_DATABASE_URL = "https://helmet-project-5b2b6-default-rtdb.firebaseio.com";

// Rider Identifier
const char* RIDER_ID = "RIDER_001";

// ==========================================
// 2. HARDWARE PIN DEFINITIONS & SETTINGS
// ==========================================
// PIN SELECTION:
// If your IR sensor wire is plugged into GPIO 19, keep 19. If it's plugged into GPIO 21, change to 21.
#define IR_PIN       19   
#define BUZZER_PIN   25   // GPIO 25: Warning Buzzer
#define ALCOHOL_PIN  34   // GPIO 34: MQ-3 ADC Input (0 - 4095)

// SENSOR ACTIVE LOGIC:
// Most IR obstacle sensors output LOW when an obstacle (helmet) is detected.
// If your sensor module outputs HIGH when obstacle detected, flip this to false.
const bool IR_ACTIVE_LOW = true; 

#define ALCOHOL_THRESHOLD 1000  // Calibrate based on MQ-3 baseline

// Timing constants
const unsigned long HELMET_WARNING_DELAY = 20UL * 1000UL;      // 20 seconds warning
const unsigned long BAN_TIME             = 2UL * 60UL * 1000UL; // 2 minutes ban duration
const unsigned long UPLOAD_INTERVAL      = 1000UL;              // Upload telemetry every ~1 sec
const unsigned long TOKEN_REFRESH_MARGIN = 5UL * 60UL * 1000UL; // Refresh token 5 mins prior to expiry

// ==========================================
// 3. SYSTEM STATE VARIABLES
// ==========================================
bool helmetWorn        = false;
bool alcoholDetected   = false;
bool buzzerState       = false;
bool banned            = false;
int  alcoholValue      = 0;
int  rawIrState        = 1;

unsigned long helmetRemovedAt   = 0;
unsigned long banStartedAt      = 0;
unsigned long lastUploadAt      = 0;
unsigned long tokenObtainedAt   = 0;
unsigned long tokenExpiresInMs  = 0;

String idToken;
String refreshToken;
bool firebaseReady = false;

// ==========================================
// 4. HELPER FUNCTIONS
// ==========================================
String databaseBaseUrl() {
  String url = String(FIREBASE_DATABASE_URL);
  while (url.endsWith("/")) {
    url.remove(url.length() - 1);
  }
  return url;
}

void configureClientTLS(WiFiClientSecure& client) {
  // Use setInsecure for fast, resilient connection in mobile hotspot environments
  client.setInsecure();
}

bool parseAuthResponse(const String& response, bool isRefresh) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, response);
  if (err) {
    Serial.printf("[AUTH] JSON parse error: %s\n", err.c_str());
    return false;
  }

  if (doc["error"]["message"].is<const char*>()) {
    Serial.print("[AUTH] Firebase error: ");
    Serial.println((const char*)doc["error"]["message"]);
    return false;
  }

  const char* newIdToken = doc["idToken"] | "";
  if (strlen(newIdToken) == 0) {
    Serial.println("[AUTH] Response did not contain idToken.");
    return false;
  }
  idToken = String(newIdToken);

  const char* newRefreshToken = doc["refreshToken"] | "";
  if (strlen(newRefreshToken) > 0) {
    refreshToken = String(newRefreshToken);
  }

  unsigned long expiresSeconds = 3600;
  if (doc["expiresIn"].is<const char*>()) {
    expiresSeconds = String((const char*)doc["expiresIn"]).toInt();
  } else if (doc["expiresIn"].is<unsigned long>()) {
    expiresSeconds = doc["expiresIn"].as<unsigned long>();
  }

  tokenObtainedAt = millis();
  tokenExpiresInMs = expiresSeconds * 1000UL;
  Serial.println(isRefresh ? "[AUTH] Firebase ID token refreshed." : "[AUTH] Firebase Anonymous sign-in success.");
  return true;
}

bool firebaseAnonymousSignIn() {
  if (String(FIREBASE_API_KEY).startsWith("YOUR_") ||
      String(FIREBASE_DATABASE_URL).indexOf("YOUR_PROJECT_ID") >= 0) {
    Serial.println("[ERROR] Please configure FIREBASE_API_KEY and FIREBASE_DATABASE_URL.");
    return false;
  }

  WiFiClientSecure client;
  configureClientTLS(client);
  
  HTTPClient https;
  String url = "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + String(FIREBASE_API_KEY);
  
  if (!https.begin(client, url)) {
    Serial.println("[AUTH] Could not connect to Google Identity Toolkit endpoint.");
    return false;
  }
  
  https.addHeader("Content-Type", "application/json");
  int httpCode = https.POST("{\"returnSecureToken\":true}");
  String response = https.getString();
  https.end();

  if (httpCode < 200 || httpCode >= 300) {
    Serial.printf("[AUTH] Sign-in failed with HTTP code: %d\n", httpCode);
    Serial.println(response);
    return false;
  }

  return parseAuthResponse(response, false);
}

bool firebaseRefreshToken() {
  if (refreshToken.length() == 0) {
    return firebaseAnonymousSignIn();
  }

  WiFiClientSecure client;
  configureClientTLS(client);
  
  HTTPClient https;
  String url = "https://securetoken.googleapis.com/v1/token?key=" + String(FIREBASE_API_KEY);
  
  if (!https.begin(client, url)) {
    Serial.println("[AUTH] Could not connect to SecureToken refresh endpoint.");
    return false;
  }

  https.addHeader("Content-Type", "application/x-www-form-urlencoded");
  String body = "grant_type=refresh_token&refresh_token=" + refreshToken;
  int httpCode = https.POST(body);
  String response = https.getString();
  https.end();

  if (httpCode < 200 || httpCode >= 300) {
    Serial.printf("[AUTH] Token refresh failed with HTTP code: %d\n", httpCode);
    Serial.println(response);
    return false;
  }

  return parseAuthResponse(response, true);
}

bool ensureFirebaseToken() {
  if (idToken.length() == 0) {
    return firebaseAnonymousSignIn();
  }

  unsigned long elapsed = millis() - tokenObtainedAt;
  if (tokenExpiresInMs > TOKEN_REFRESH_MARGIN &&
      elapsed < (tokenExpiresInMs - TOKEN_REFRESH_MARGIN)) {
    return true;
  }

  return firebaseRefreshToken();
}

bool uploadRiderData(unsigned long helmetMissingSeconds, unsigned long banRemainingSeconds) {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (!ensureFirebaseToken()) return false;

  JsonDocument doc;
  doc["riderId"]               = RIDER_ID;
  doc["helmet"]                = helmetWorn;
  doc["alcohol"]               = alcoholDetected;
  doc["alcoholValue"]          = alcoholValue;
  doc["buzzer"]                = buzzerState;
  doc["banned"]                = banned;
  doc["helmetMissingSeconds"]  = helmetMissingSeconds;
  doc["banRemainingSeconds"]   = banRemainingSeconds;
  doc["updatedAt"][".sv"]       = "timestamp";

  String payload;
  serializeJson(doc, payload);

  WiFiClientSecure client;
  configureClientTLS(client);
  
  HTTPClient https;
  String url = databaseBaseUrl() + "/riders/" + String(RIDER_ID) + ".json?auth=" + idToken;
  
  if (!https.begin(client, url)) {
    Serial.println("[UPLOAD] Could not begin HTTPS session.");
    return false;
  }

  https.addHeader("Content-Type", "application/json");
  int httpCode = https.PUT(payload);
  String response = https.getString();
  https.end();

  if (httpCode < 200 || httpCode >= 300) {
    Serial.printf("[UPLOAD] Database error (%d): %s\n", httpCode, response.c_str());
    return false;
  }

  Serial.println("[UPLOAD] Telemetry synced to Firebase successfully.");
  return true;
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[WIFI] Connecting to '%s' (2.4 GHz)", WIFI_SSID);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - startAttempt < 20000UL)) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WIFI] Connected! Assigned IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("[WIFI] Initial connection attempt timed out. Reconnection loop active.");
  }
}

// ==========================================
// 5. SETUP
// ==========================================
void setup() {
  Serial.begin(115200);

  // Use INPUT_PULLUP to eliminate floating pin and false LOW readings
  pinMode(IR_PIN, INPUT_PULLUP);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // Startup test beep (150ms) to verify physical buzzer and GPIO 25 connection
  digitalWrite(BUZZER_PIN, HIGH);
  delay(150);
  digitalWrite(BUZZER_PIN, LOW);

  analogReadResolution(12);

  delay(500);
  Serial.println("{\"type\":\"boot\",\"device\":\"ESP32_Smart_Helmet\",\"rider\":\"RIDER_001\"}");

  connectWiFi();

  if (WiFi.status() == WL_CONNECTED) {
    firebaseReady = firebaseAnonymousSignIn();
  }

  Serial.println("{\"type\":\"ready\"}");
}

// ==========================================
// 6. MAIN LOOP
// ==========================================
void loop() {
  // --- Auto-reconnect Wi-Fi if dropped ---
  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long lastWiFiCheck = 0;
    if (millis() - lastWiFiCheck >= 5000UL) {
      lastWiFiCheck = millis();
      Serial.println("[WIFI] Connection lost. Attempting reconnection...");
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
  }

  // --- Read Sensors ---
  rawIrState = digitalRead(IR_PIN);
  
  // Apply sensor logic
  if (IR_ACTIVE_LOW) {
    helmetWorn = (rawIrState == LOW);
  } else {
    helmetWorn = (rawIrState == HIGH);
  }

  alcoholValue = analogRead(ALCOHOL_PIN);
  alcoholDetected = (alcoholValue >= ALCOHOL_THRESHOLD);

  // --- Helmet & Warning Logic ---
  if (helmetWorn) {
    // When helmet is worn: reset timers and clear ban
    helmetRemovedAt = 0;
    banStartedAt    = 0;
    banned          = false;
    buzzerState     = alcoholDetected;
  } else {
    // Helmet not worn: start 20s warning timer
    if (helmetRemovedAt == 0) {
      helmetRemovedAt = millis();
    }

    unsigned long helmetMissingTime = millis() - helmetRemovedAt;

    // After 20 seconds warning delay
    if (helmetMissingTime >= HELMET_WARNING_DELAY) {
      buzzerState = true;

      // Start 2-minute ban timer
      if (banStartedAt == 0) {
        banStartedAt = millis();
      }

      unsigned long banElapsed = millis() - banStartedAt;
      if (banElapsed >= BAN_TIME) {
        banned = true;
        buzzerState = true;
      }
    } else {
      buzzerState = false;
    }
  }

  // Alcohol detection overrides buzzer state immediately
  if (alcoholDetected) {
    buzzerState = true;
  }

  // Drive physical buzzer pin
  digitalWrite(BUZZER_PIN, buzzerState ? HIGH : LOW);

  // Calculate missing & ban timers
  unsigned long helmetMissingSeconds = 0;
  if (helmetRemovedAt > 0) {
    helmetMissingSeconds = (millis() - helmetRemovedAt) / 1000UL;
  }

  unsigned long banRemainingSeconds = 0;
  if (banStartedAt > 0 && !banned) {
    unsigned long elapsed = millis() - banStartedAt;
    if (elapsed < BAN_TIME) {
      banRemainingSeconds = (BAN_TIME - elapsed) / 1000UL;
    }
  }

  // --- Output Debug JSON to Serial Monitor (115200 baud) ---
  // Includes "rawIrState" so you can immediately see what pin level is being read
  JsonDocument serialDoc;
  serialDoc["riderId"]               = RIDER_ID;
  serialDoc["irPin"]                 = IR_PIN;
  serialDoc["rawIrState"]            = rawIrState;
  serialDoc["helmet"]                = helmetWorn;
  serialDoc["alcohol"]               = alcoholDetected;
  serialDoc["alcoholValue"]          = alcoholValue;
  serialDoc["buzzer"]                = buzzerState;
  serialDoc["banned"]                = banned;
  serialDoc["helmetMissingSeconds"]  = helmetMissingSeconds;
  serialDoc["banRemainingSeconds"]   = banRemainingSeconds;
  serializeJson(serialDoc, Serial);
  Serial.println();

  // --- Upload to Firebase Realtime Database (~1 sec interval) ---
  if (millis() - lastUploadAt >= UPLOAD_INTERVAL) {
    lastUploadAt = millis();
    if (WiFi.status() == WL_CONNECTED) {
      uploadRiderData(helmetMissingSeconds, banRemainingSeconds);
    }
  }

  delay(200);
}
