import React, { useEffect, useState, useRef } from 'react';
import { ref, onValue, off } from 'firebase/database';
import { 
  ShieldAlert, 
  ShieldCheck, 
  Wine, 
  Bell, 
  Timer, 
  AlertTriangle, 
  Radio, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Activity, 
  Info,
  PowerOff
} from 'lucide-react';
import { initFirebase, DEFAULT_RIDER_ID, ALCOHOL_THRESHOLD, isConfigValid } from './firebase';
import type { RiderData, ConnectionStatus } from './types';
import './App.css';

// If no packet is received for 5 seconds, mark the physical helmet as offline/disconnected
const DEVICE_TIMEOUT_MS = 5000;

export const App: React.FC = () => {
  const [riderData, setRiderData] = useState<RiderData | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDeviceOnline, setIsDeviceOnline] = useState<boolean>(false);
  const [secondsSinceLastSeen, setSecondsSinceLastSeen] = useState<number>(0);

  // Smooth client-side timer states
  const [interpolatedMissing, setInterpolatedMissing] = useState<number>(0);
  const [interpolatedBanRemaining, setInterpolatedBanRemaining] = useState<number>(120);

  const packetReceivedAtRef = useRef<number>(0);
  const riderDataRef = useRef<RiderData | null>(null);

  // Sync ref with state
  useEffect(() => {
    riderDataRef.current = riderData;
  }, [riderData]);

  // Real-time 100ms ticker for heartbeat check & timer interpolation
  useEffect(() => {
    const ticker = setInterval(() => {
      const lastPacket = packetReceivedAtRef.current;
      const data = riderDataRef.current;

      if (!data || lastPacket === 0) {
        setIsDeviceOnline(false);
        setSecondsSinceLastSeen(0);
        return;
      }

      const diffMs = Date.now() - lastPacket;
      const elapsedSec = Math.floor(diffMs / 1000);
      setSecondsSinceLastSeen(elapsedSec);

      // Heartbeat detection: if no new data arrived in last 5 seconds, device is powered off
      const online = diffMs < DEVICE_TIMEOUT_MS;
      setIsDeviceOnline(online);

      if (!online) {
        // Device is offline/powered off
        return;
      }

      // If online, perform smooth progress interpolation
      const elapsedSincePacket = diffMs / 1000;
      if (data.helmet) {
        setInterpolatedMissing(0);
        setInterpolatedBanRemaining(120);
      } else {
        const curMissing = Math.floor((data.helmetMissingSeconds || 0) + elapsedSincePacket);
        setInterpolatedMissing(curMissing);

        if (curMissing >= 20) {
          if ((data.banRemainingSeconds || 0) > 0) {
            setInterpolatedBanRemaining(Math.max(0, Math.floor(data.banRemainingSeconds - elapsedSincePacket)));
          } else {
            setInterpolatedBanRemaining(Math.max(0, 120 - (curMissing - 20)));
          }
        } else {
          setInterpolatedBanRemaining(120);
        }
      }
    }, 100);

    return () => clearInterval(ticker);
  }, []);

  useEffect(() => {
    let isMounted = true;

    if (!isConfigValid()) {
      setConnectionStatus('error');
      setErrorMessage(
        'Firebase configuration is missing or contains placeholder values. Please check your environment variables.'
      );
      return;
    }

    async function setupFirebaseSubscription() {
      try {
        setConnectionStatus('connecting');
        const { db } = await initFirebase();

        if (!isMounted || !db) return;

        const riderRef = ref(db, `riders/${DEFAULT_RIDER_ID}`);

        onValue(
          riderRef,
          (snapshot) => {
            if (!isMounted) return;
            const data = snapshot.val();

            if (!data) {
              setConnectionStatus('waiting_for_device');
              setRiderData(null);
              setIsDeviceOnline(false);
            } else {
              setRiderData(data as RiderData);
              packetReceivedAtRef.current = Date.now();
              setConnectionStatus('connected');
              setIsDeviceOnline(true);
              setErrorMessage(null);
            }
          },
          (error) => {
            if (!isMounted) return;
            console.error('Firebase Realtime Database error:', error);
            setConnectionStatus('error');
            setErrorMessage(`Database access error: ${error.message}`);
          }
        );

        return () => {
          off(riderRef);
        };
      } catch (err: unknown) {
        if (!isMounted) return;
        setConnectionStatus('error');
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Unknown error occurred while connecting to Firebase'
        );
      }
    }

    const cleanupPromise = setupFirebaseSubscription();

    return () => {
      isMounted = false;
      cleanupPromise.then((cleanup) => {
        if (typeof cleanup === 'function') cleanup();
      });
    };
  }, []);

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusColor = () => {
    if (connectionStatus === 'error') return '#ef4444';
    if (connectionStatus === 'connecting') return '#f59e0b';
    if (!isDeviceOnline) return '#ef4444'; // Red when helmet is switched off
    return '#10b981'; // Green when live telemetry is actively streaming
  };

  const getStatusLabel = () => {
    if (connectionStatus === 'error') return 'Connection Error';
    if (connectionStatus === 'connecting') return 'Connecting…';
    if (connectionStatus === 'waiting_for_device') return 'Waiting for device data';
    if (!isDeviceOnline) return `Helmet Offline (${secondsSinceLastSeen}s ago)`;
    return 'Live · Connected';
  };

  // Warning Progress (0 to 20 seconds warning threshold)
  const warningPercentage = isDeviceOnline ? Math.min(100, (interpolatedMissing / 20) * 100) : 0;

  // MQ-3 ADC Progress (0 to 4095 ESP32 12-bit ADC range)
  const alcoholPercentage = isDeviceOnline && riderData
    ? Math.min(100, (riderData.alcoholValue / 4095) * 100)
    : 0;

  return (
    <div className="dashboard-container">
      {/* Top Header */}
      <header className="dashboard-header">
        <div className="header-title-group">
          <h1>
            <Radio className="w-8 h-8 text-blue-500" style={{ color: isDeviceOnline ? '#3b82f6' : '#ef4444' }} />
            Smart Helmet Safety Hub
          </h1>
          <p className="header-subtitle">
            Rider Telemetry & Safety Enforcement · Monitored ID: <strong style={{ color: '#f1f5f9' }}>{DEFAULT_RIDER_ID}</strong>
          </p>
        </div>

        <div className="connection-pill">
          <span 
            className={`status-dot ${isDeviceOnline ? 'active' : ''}`}
            style={{ backgroundColor: getStatusColor() }}
          />
          <span>{getStatusLabel()}</span>
        </div>
      </header>

      {/* Global Alerts / Warnings */}
      {errorMessage && (
        <div className="alert-banner alert-danger">
          <AlertTriangle size={20} />
          <div>{errorMessage}</div>
        </div>
      )}

      {/* Helmet Offline Notice */}
      {!isDeviceOnline && riderData && !errorMessage && (
        <div className="alert-banner alert-danger" style={{ borderLeft: '4px solid #ef4444' }}>
          <PowerOff size={22} style={{ color: '#ef4444' }} />
          <div>
            <strong>HELMET POWERED OFF / DISCONNECTED:</strong> No live signals received from the helmet for over 5 seconds. The values below reflect the last recorded state before power was cut.
          </div>
        </div>
      )}

      {connectionStatus === 'waiting_for_device' && !errorMessage && (
        <div className="alert-banner alert-info">
          <Activity size={20} />
          <div>Waiting for device data: Connected to Firebase, but no telemetry has been published under <code>/riders/{DEFAULT_RIDER_ID}</code> yet. Ensure your ESP32 is powered on and connected to Wi-Fi.</div>
        </div>
      )}

      {isDeviceOnline && riderData?.banned && (
        <div className="alert-banner alert-danger">
          <XCircle size={20} />
          <div>
            <strong>RIDER BANNED:</strong> Helmet was not worn within the 20-second warning window. Safety lock is engaged!
          </div>
        </div>
      )}

      {/* Main Metric Cards */}
      <div className="dashboard-grid">
        {/* 1. Helmet Status */}
        <div className="card col-4">
          <div className="card-top">
            <span className="card-label">Helmet Status</span>
            <div className="card-icon-wrap">
              {!isDeviceOnline ? (
                <PowerOff size={22} style={{ color: '#ef4444' }} />
              ) : riderData?.helmet ? (
                <ShieldCheck size={22} style={{ color: '#10b981' }} />
              ) : (
                <ShieldAlert size={22} style={{ color: '#ef4444' }} />
              )}
            </div>
          </div>
          <div>
            <div className="card-value">
              {!isDeviceOnline ? 'Offline' : !riderData ? '—' : riderData.helmet ? 'Worn' : 'Not Worn'}
            </div>
            <span className={`card-pill ${
              !isDeviceOnline ? 'pill-danger' : 
              !riderData ? 'pill-neutral' : 
              riderData.helmet ? 'pill-success' : 'pill-danger'
            }`}>
              {!isDeviceOnline ? 'HELMET OFF' : !riderData ? 'NO DATA' : riderData.helmet ? 'HELMET DETECTED' : 'HELMET MISSING'}
            </span>
          </div>
          <p className="card-subtext">Monitored via IR Optical Sensor (GPIO 19, Active-LOW)</p>
        </div>

        {/* 2. Alcohol Detection */}
        <div className="card col-4">
          <div className="card-top">
            <span className="card-label">Alcohol Sensor (MQ-3)</span>
            <div className="card-icon-wrap">
              <Wine size={22} style={{ color: !isDeviceOnline ? '#64748b' : riderData?.alcohol ? '#ef4444' : '#10b981' }} />
            </div>
          </div>
          <div>
            <div className="card-value">
              {!isDeviceOnline ? 'Offline' : !riderData ? '—' : riderData.alcohol ? 'Detected' : 'Clear'}
            </div>
            <span className={`card-pill ${
              !isDeviceOnline ? 'pill-neutral' :
              !riderData ? 'pill-neutral' : 
              riderData.alcohol ? 'pill-danger' : 'pill-success'
            }`}>
              {!isDeviceOnline ? 'SENSOR OFF' : !riderData ? 'NO DATA' : riderData.alcohol ? 'ALCOHOL ALERT' : 'ALCOHOL FREE'}
            </span>
          </div>
          <p className="card-subtext">Calibrated trigger threshold: {ALCOHOL_THRESHOLD} ADC</p>
        </div>

        {/* 3. Rider Overall Status */}
        <div className="card col-4">
          <div className="card-top">
            <span className="card-label">Rider Status</span>
            <div className="card-icon-wrap">
              {!isDeviceOnline ? (
                <PowerOff size={22} style={{ color: '#ef4444' }} />
              ) : riderData?.banned ? (
                <XCircle size={22} style={{ color: '#ef4444' }} />
              ) : riderData?.buzzer ? (
                <AlertTriangle size={22} style={{ color: '#f59e0b' }} />
              ) : (
                <CheckCircle2 size={22} style={{ color: '#10b981' }} />
              )}
            </div>
          </div>
          <div>
            <div className="card-value">
              {!isDeviceOnline ? 'Offline' : !riderData ? 'Waiting…' : riderData.banned ? 'Banned' : riderData.buzzer ? 'Alert' : 'Normal'}
            </div>
            <span className={`card-pill ${
              !isDeviceOnline ? 'pill-danger' :
              !riderData ? 'pill-neutral' :
              riderData.banned ? 'pill-danger' :
              riderData.buzzer ? 'pill-warning' : 'pill-success'
            }`}>
              {!isDeviceOnline ? 'NO CONNECTION' : !riderData ? 'NO DATA' : riderData.banned ? 'BAN ACTIVE' : riderData.buzzer ? 'WARNING ALERT' : 'NORMAL'}
            </span>
          </div>
          <p className="card-subtext">Automated safety enforcement status</p>
        </div>

        {/* 4. Helmet Missing Time & Buzzer */}
        <div className="card col-8">
          <div className="card-top">
            <span className="card-label">Helmet Missing Warning Progression</span>
            <div className="card-icon-wrap">
              <Bell size={22} style={{ color: !isDeviceOnline ? '#64748b' : riderData?.buzzer ? '#ef4444' : '#94a3b8' }} />
            </div>
          </div>
          <div>
            <div className="card-value">
              {!isDeviceOnline ? '—' : `${interpolatedMissing} seconds missing`}
            </div>
            <div className="progress-container">
              <div className="progress-track">
                <div 
                  className="progress-bar" 
                  style={{ 
                    width: `${warningPercentage}%`,
                    backgroundColor: warningPercentage >= 100 ? '#ef4444' : '#f59e0b'
                  }} 
                />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.75rem' }}>
              <div>
                Warning Status: <strong style={{ color: !isDeviceOnline ? '#64748b' : interpolatedMissing >= 20 ? '#ef4444' : '#f59e0b' }}>
                  {!isDeviceOnline ? 'Device Offline' : interpolatedMissing >= 20 ? '⚠ 20s Warning Expired' : `${20 - interpolatedMissing}s to Buzzer`}
                </strong>
              </div>
              <div>Buzzer (GPIO 25): <strong style={{ color: !isDeviceOnline ? '#64748b' : riderData?.buzzer ? '#ef4444' : '#10b981' }}>{!isDeviceOnline ? 'OFFLINE' : riderData ? (riderData.buzzer ? 'ACTIVE (ON)' : 'OFF') : '—'}</strong></div>
            </div>
          </div>
          <p className="card-subtext">
            Buzzer activates after 20 seconds of helmet removal or immediately when alcohol is detected.
          </p>
        </div>

        {/* 5. Ban Countdown */}
        <div className="card col-4">
          <div className="card-top">
            <span className="card-label">Ban Countdown</span>
            <div className="card-icon-wrap">
              <Timer size={22} style={{ color: !isDeviceOnline ? '#64748b' : riderData?.banned ? '#ef4444' : '#60a5fa' }} />
            </div>
          </div>
          <div>
            <div className="card-value" style={{ fontFamily: 'monospace' }}>
              {!isDeviceOnline ? '--:--' : riderData?.banned ? 'BANNED' : formatCountdown(interpolatedBanRemaining)}
            </div>
            <span className={`card-pill ${
              !isDeviceOnline ? 'pill-neutral' :
              !riderData ? 'pill-neutral' :
              riderData.banned ? 'pill-danger' :
              interpolatedMissing >= 20 ? 'pill-warning' : 'pill-success'
            }`}>
              {!isDeviceOnline ? 'OFFLINE' : !riderData ? 'NO DATA' : riderData.banned ? 'BAN ACTIVE' : interpolatedMissing >= 20 ? 'COUNTDOWN RUNNING' : 'NOT BANNED'}
            </span>
          </div>
          <p className="card-subtext">2-minute ban begins after 20s warning period. Putting helmet on resets the ban.</p>
        </div>

        {/* 6. Raw MQ-3 Reading */}
        <div className="card col-6">
          <div className="card-top">
            <span className="card-label">Raw MQ-3 Gas Sensor Reading</span>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>12-bit ADC (GPIO 34)</span>
          </div>
          <div>
            <div className="card-value">
              {!isDeviceOnline ? '—' : `${riderData ? riderData.alcoholValue : '—'} / 4095`}
            </div>
            <div className="progress-container">
              <div className="progress-track">
                <div 
                  className="progress-bar" 
                  style={{ 
                    width: `${alcoholPercentage}%`,
                    backgroundColor: (riderData?.alcoholValue || 0) >= ALCOHOL_THRESHOLD ? '#ef4444' : '#3b82f6'
                  }} 
                />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.5rem' }}>
              <div>Baseline Range: 0 - 4095</div>
              <div>Threshold: <strong>{ALCOHOL_THRESHOLD} ADC</strong></div>
            </div>
          </div>
          <p className="card-subtext">Analog input conditioned safely to 0-3.3V range before reaching ESP32.</p>
        </div>

        {/* 7. Last Device Update */}
        <div className="card col-6">
          <div className="card-top">
            <span className="card-label">Last Device Telemetry</span>
            <div className="card-icon-wrap">
              <Clock size={22} style={{ color: isDeviceOnline ? '#3b82f6' : '#ef4444' }} />
            </div>
          </div>
          <div>
            <div className="card-value" style={{ fontSize: '1.4rem' }}>
              {!isDeviceOnline && secondsSinceLastSeen > 0 
                ? `Offline (${secondsSinceLastSeen}s ago)`
                : riderData?.updatedAt 
                  ? new Date(riderData.updatedAt).toLocaleTimeString() 
                  : 'Waiting for device…'}
            </div>
            <span className={`card-pill ${isDeviceOnline ? 'pill-success' : 'pill-danger'}`}>
              {isDeviceOnline ? 'LIVE DATA STREAM' : 'DISCONNECTED'}
            </span>
          </div>
          <p className="card-subtext">
            {isDeviceOnline 
              ? 'ESP32 syncing telemetry actively every second.' 
              : `Last heartbeat seen at ${riderData?.updatedAt ? new Date(riderData.updatedAt).toLocaleTimeString() : 'unknown'}.`}
          </p>
        </div>
      </div>

      {/* Safety Notice and Engineering Disclaimer */}
      <footer className="disclaimer-box">
        <Info size={24} style={{ flexShrink: 0, color: '#60a5fa' }} />
        <div>
          <strong>Engineering & Medical Disclaimer:</strong> The MQ-3 gas sensor readings displayed here are raw 12-bit analog-to-digital converter (ADC) counts intended solely for prototype demonstration. They are <em>not</em> certified breath-alcohol concentration (BAC) or legal evidentiary measurements. Environmental humidity, temperature, and cross-sensitivity to other gases affect uncalibrated semiconductor sensors. Do not use this prototype as a definitive legal or medical safety control.
        </div>
      </footer>
    </div>
  );
};

export default App;
