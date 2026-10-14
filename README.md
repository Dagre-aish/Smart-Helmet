# 🪖 Smart Helmet IoT Safety & Telemetry System

An end-to-end IoT road safety solution built with **ESP32**, **Firebase Realtime Database**, and a responsive **Web Dashboard**. The system continuously monitors helmet compliance and alcohol impairment, sounds buzzer alarms, triggers safety bans, and streams real-time telemetry to the cloud.

---

## 🚀 Key Features

- **Helmet Compliance Detection**: Active IR optical sensor ensures the rider is wearing the helmet before and during the ride.
- **Alcohol Impairment Alert**: MQ-3 semiconductor gas sensor measures alcohol vapor and immediately triggers audible alarms if a threshold is crossed.
- **Progressive Safety Enforcement**:
  - **20-Second Warning Window**: Removing the helmet starts an active 20-second warning countdown.
  - **Buzzer Activation**: If the helmet remains off after 20 seconds, the warning buzzer turns **ON**.
  - **2-Minute Ban Countdown**: After the 20-second warning, a 2-minute safety ban countdown begins. If the helmet is not worn, the rider status is locked as **BANNED**.
  - **Automatic Restoration**: Putting the helmet back on immediately clears the ban and resets all safety timers.
- **Secure Cloud Telemetry**: ESP32 signs in via Firebase Authentication and pushes JSON telemetry over HTTPS to Firebase Realtime Database (~1 second interval).
- **Smooth Real-Time Dashboard**:
  - Sub-second client-side timer interpolation eliminates network stutter.
  - Live animated 20-second warning bar and 2-minute ban countdown.
  - Alcohol ADC level gauge with calibrated threshold.
  - Responsive dark-theme interface for desktop and mobile.

---

## 🛠️ Hardware Requirements & Pin Map

| Component | Pin / Connection | Description |
|---|---|---|
| **Microcontroller** | ESP32 DevKit (30/38 pin) | Main controller with 2.4 GHz Wi-Fi |
| **IR Helmet Sensor** | **GPIO 19** | Active-LOW: `LOW` = Helmet Detected / Worn |
| **Piezo Buzzer** | **GPIO 25** | Active-HIGH: `HIGH` = Buzzer ON |
| **MQ-3 Alcohol Sensor** | **GPIO 34** | ADC1 Channel 6 (12-bit, 0–4095 counts) |
| **Battery Power** | 7.4V LiPo Battery | Stepped down via buck converter |
| **Buck Converter** | 5.0V output $\rightarrow$ **VIN** & **GND** | Powers ESP32 and MQ-3 heater |

> ⚠️ **Important Electrical Safety Notice**:
> - The MQ-3 internal heater requires **5V**, but ESP32 GPIOs only accept a maximum of **3.3V**.
> - Use a voltage divider (e.g. 10kΩ / 20kΩ resistors) or a level shifter between the MQ-3 analog output and **GPIO 34** to safely keep the voltage between 0 and 3.3V.
> - Adjust the buck converter output to **5.0V** with a multimeter before connecting it to the ESP32 VIN pin.

---

## 📂 Project Structure

```text
smart-helmet/
├── esp32/
│   └── smart_helmet_firebase/
│       └── smart_helmet_firebase.ino   # ESP32 firmware (Wi-Fi, Firebase, Sensors)
├── portal/
│   └── index.html                      # Standalone zero-dependency Live Web Dashboard
├── web_dashboard/                      # React + TypeScript + Vite Dashboard
│   ├── src/
│   │   ├── App.tsx                     # Main dashboard component
│   │   ├── App.css                     # Responsive dark-theme styling
│   │   ├── firebase.ts                 # Firebase client & auth integration
│   │   └── types.ts                    # TypeScript data models
│   ├── .env.example                    # Environment variable template
│   ├── vercel.json                     # Vercel deployment routing configuration
│   └── package.json
├── firebase_rules/
│   └── database.rules.json             # Firebase Realtime Database security rules
└── README.md                           # Documentation & Setup Guide
```

---

## ⚙️ Firebase Setup

1. Go to the [Firebase Console](https://console.firebase.google.com/) and open your project (`helmet-project-5b2b6`).
2. **Enable Authentication**:
   - Go to **Build → Authentication → Sign-in method**.
   - Enable **Anonymous** authentication and click **Save**.
3. **Configure Realtime Database**:
   - Go to **Build → Realtime Database**.
   - Note your database URL: `https://helmet-project-5b2b6-default-rtdb.firebaseio.com`.
4. **Publish Security Rules**:
   - Open the **Rules** tab in Realtime Database.
   - Copy the contents of [`firebase_rules/database.rules.json`](firebase_rules/database.rules.json) and paste it into the editor.
   - Click **Publish**.

```json
{
  "rules": {
    "riders": {
      "$rider_id": {
        ".read": "auth != null",
        ".write": "auth != null",
        ".validate": "newData.hasChildren(['riderId', 'helmet', 'alcohol', 'alcoholValue', 'buzzer', 'banned', 'helmetMissingSeconds', 'banRemainingSeconds', 'updatedAt'])",
        "riderId": {
          ".validate": "newData.isString() && newData.val() === $rider_id"
        },
        "helmet": {
          ".validate": "newData.isBoolean()"
        },
        "alcohol": {
          ".validate": "newData.isBoolean()"
        },
        "alcoholValue": {
          ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 4095"
        },
        "buzzer": {
          ".validate": "newData.isBoolean()"
        },
        "banned": {
          ".validate": "newData.isBoolean()"
        },
        "helmetMissingSeconds": {
          ".validate": "newData.isNumber() && newData.val() >= 0"
        },
        "banRemainingSeconds": {
          ".validate": "newData.isNumber() && newData.val() >= 0"
        },
        "updatedAt": {
          ".validate": "newData.isNumber()"
        },
        "$other": {
          ".validate": false
        }
      }
    }
  }
}
```

---

## 💻 Firmware Installation (ESP32)

1. Open **Arduino IDE**.
2. Install board support:
   - Go to **File → Preferences → Additional Boards Manager URLs**:
     `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   - In **Tools → Board → Boards Manager**, search for `esp32` by Espressif and install it.
3. Install required library:
   - In **Tools → Manage Libraries**, search for `ArduinoJson` (v7 or v6) by Benoit Blanchon and install it.
4. Open `esp32/smart_helmet_firebase/smart_helmet_firebase.ino`.
5. Enter your phone hotspot Wi-Fi credentials:
   ```cpp
   const char* WIFI_SSID     = "YOUR_PHONE_HOTSPOT";
   const char* WIFI_PASSWORD = "YOUR_PASSWORD";
   ```
6. Select your board under **Tools → Board → esp32 → ESP32 Dev Module**.
7. Select the COM port under **Tools → Port**.
8. Click **Upload**.
9. Open the **Serial Monitor** at **115200 baud** to view real-time diagnostics:
   ```json
   {"riderId":"RIDER_001","irPin":19,"rawIrState":1,"helmet":false,"alcohol":false,"alcoholValue":420,"buzzer":false,"banned":false,"helmetMissingSeconds":0,"banRemainingSeconds":0}
   ```

---

## 🌐 Running the Web Dashboard

### Option A: Standalone Dashboard (Instant)
Serve `portal/index.html` using any local web server:
```bash
# Using Python
cd portal
python -m http.server 8080

# Or using Node serve
npx serve portal
```
Open `http://localhost:8080` in your web browser.

### Option B: React + TypeScript Dashboard (Full Stack)
```bash
cd web_dashboard
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

To create an optimized production build:
```bash
npm run build
```

---

## ☁️ Deployment to Vercel

1. Push this repository to GitHub.
2. Go to [Vercel](https://vercel.com/) and click **Add New Project**.
3. Import your GitHub repository.
4. Set the **Root Directory** to `web_dashboard` (or deploy `portal` if using the static version).
5. Add the following **Environment Variables** under Project Settings:
   - `VITE_FIREBASE_API_KEY`: Your Firebase Web API Key
   - `VITE_FIREBASE_AUTH_DOMAIN`: `helmet-project-5b2b6.firebaseapp.com`
   - `VITE_FIREBASE_DATABASE_URL`: `https://helmet-project-5b2b6-default-rtdb.firebaseio.com`
   - `VITE_FIREBASE_PROJECT_ID`: `helmet-project-5b2b6`
   - `VITE_FIREBASE_APP_ID`: `1:937161768358:web:1c7645187ef04d5541a367`
   - `VITE_DEFAULT_RIDER_ID`: `RIDER_001`
   - `VITE_ALCOHOL_THRESHOLD`: `1000`
6. Click **Deploy**.

---

## 🧪 Testing & Validation

1. **Power & Network**:
   - Turn on your phone's 2.4 GHz Wi-Fi hotspot.
   - Power the ESP32. The buzzer will emit a short startup test beep (150ms).
   - Serial Monitor prints: `[WIFI] Connected!`, `[AUTH] Firebase Anonymous sign-in success.`, and `[UPLOAD] Telemetry synced to Firebase successfully.`
2. **Helmet Verification**:
   - Cover the IR sensor (simulating helmet worn): Status shows **HELMET DETECTED**, timers remain at 0.
   - Uncover the sensor: The **Helmet missing duration** smoothly increments: `1, 2, 3... 20s`.
   - At 20 seconds: The buzzer turns **ON** and the **Ban countdown** starts counting down from `02:00`.
   - Wearing the helmet again immediately silences the buzzer and restores rider status to **ACTIVE**.
3. **Alcohol Sensor Verification**:
   - Exposing the MQ-3 to alcohol vapor causes the ADC count to rise above the 1000 threshold.
   - The buzzer activates immediately and the status switches to **ALCOHOL ALERT**.

---

## 📄 License & Disclaimer

This project is developed for educational, academic, and prototyping purposes. 
Raw MQ-3 analog sensor readings are not certified breath-alcohol concentration (BAC) measurements. Do not use this prototype as an evidentiary or legal safety system without certified industrial sensors and fail-safe hardware interlocks.
