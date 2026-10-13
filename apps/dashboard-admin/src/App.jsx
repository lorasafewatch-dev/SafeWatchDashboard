import React, { useState, useEffect } from 'react';
import { isCurrentGpsPoint, telemetryTimestamp } from '../../shared/gpsStatus.js';
import { ALERT_QUERY_FILTER, acknowledgeIncident, confirmationErrorMessage, groupAlertIncidents, needsBarangayAttention } from '../../shared/alertLifecycle.js';
import { enableAlertSounds, playAlertSound, stopAlertSounds } from '../../shared/alertSound.js';
import { SAN_ISIDRO_EAST_BOUNDARY, isInsidePolygon } from '../../shared/safeZone.js';
import { MapContainer, TileLayer, Marker, Popup, useMap, Polygon, Circle, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  LayoutDashboard,
  Users,
  MapPin,
  HeartPulse,
  Bell,
  ShieldAlert,
  Settings,
  HelpCircle,
  Search,
  Filter,
  Eye,
  EyeOff,
  User,
  Lock,
  Battery,
  Calendar,
  Clock,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  Shield,
  Maximize2,
  RefreshCw,
  Sun,
  LogOut,
  Activity,
  Heart,
  Home,
  Plus,
  X,
  Map,
  AlertCircle,
  Trash2
} from 'lucide-react';
import { getDashboardClient, verifyDashboardPassword } from './supabaseClient.js';
import AccountSettings from './components/AccountSettings.jsx';
import StatCard from './components/StatCard.jsx';
import useAccountSession from '../../shared/components/useAccountSession.js';
import AccountMfaGate from '../../shared/components/AccountMfaGate.jsx';
import AuthEntry from '../../shared/components/AuthEntry.jsx';
import PasswordRecovery from '../../shared/components/PasswordRecovery.jsx';
import RecoveryLinkConfirm from '../../shared/components/RecoveryLinkConfirm.jsx';
import AccountAccessDenied from '../../shared/components/AccountAccessDenied.jsx';
import { familyProfileFromUser } from '../../shared/familyProfile.js';

// Map Controller
const MapController = ({ center, zoom, trigger, bounds }) => {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, zoom, { duration: 1.5 });
    } else if (bounds) {
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 16, animate: false });
    }
  }, [center, zoom, map, trigger, bounds]);

  return null;
};

// Custom Marker Creator
const createCustomIcon = (name, type = 'normal') => {
  const color = type === 'trusted' ? 'bg-blue-500' : 'bg-emerald-500';
  const border = type === 'trusted' ? 'border-blue-500' : 'border-emerald-500';

  return L.divIcon({
    html: `
      <div class="relative w-12 h-12">
        <div class="w-12 h-12 rounded-full border-4 ${border} bg-white overflow-hidden shadow-lg">
          <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${name}" class="w-full h-full" />
        </div>
        <div class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-4 ${color} rotate-45 border-r border-b border-white shadow-md"></div>
      </div>
    `,
    className: '',
    iconSize: [48, 48],
    iconAnchor: [24, 48],
  });
};

const SidebarItem = ({ icon: Icon, label, active, badge, onClick }) => (
  <button
    type="button"
    aria-current={active ? 'page' : undefined}
    onClick={onClick}
    className={`sidebar-item ${active ? 'sidebar-item-active' : 'sidebar-item-default'}`}
  >
    <div className="flex items-center gap-3">
      <Icon className={`w-[18px] h-[18px] ${active ? 'text-white' : 'text-gray-400'}`} />
      <span>{label}</span>
    </div>
    {badge && (
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${active ? 'bg-white/20 text-white' : 'bg-red-500 text-white'}`}>{badge}</span>
    )}
  </button>
);

const PolygonWithLegend = ({ positions, name }) => (
  <>
    <Polygon positions={positions} pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.1, weight: 2 }} />
    <div className="absolute bottom-6 left-6 z-[1000] bg-white px-4 py-2 rounded-xl shadow-lg border border-slate-50 flex items-center gap-2">
      <div className="w-2.5 h-2.5 bg-blue-500 rounded-full"></div>
      <span className="text-[10px] font-bold text-slate-500">{name}</span>
    </div>
  </>
);

function App({ client, verifyCurrentPassword = verifyDashboardPassword } = {}) {
  const supabase = client || getDashboardClient();
  const { isLoggedIn, isLoadingAuth, userId, accountUser, accountPermission, pendingAccess, accessDenied, recoveryAccess, recoveryLink, authLinkError, authNotice, setAuthNotice, authError, retryAuth } = useAccountSession(supabase, 'dashboard');
  const [confirmingAlerts, setConfirmingAlerts] = useState(false);
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const accountMenuRef = React.useRef(null);
  const accountButtonRef = React.useRef(null);
  const signOutBusy = React.useRef(false);
  const profile = familyProfileFromUser(accountUser);
  const accountName = profile.fullName || profile.email || 'My account';
  const accountInitials = (profile.fullName || profile.email.split('@')[0] || 'User')
    .split(/\s+/).filter(Boolean).map(part => Array.from(part)[0]).slice(0, 2).join('').toUpperCase();
  const [isAddingSenior, setIsAddingSenior] = useState(false);
  const [isPickingLocation, setIsPickingLocation] = useState(false);
  const [isAddingLocationDetails, setIsAddingLocationDetails] = useState(false);
  const [newLocation, setNewLocation] = useState({ name: '', lat: '', lng: '', radius: 30 });
  const [liveTime, setLiveTime] = useState(new Date());
  const [selectedSeniorLoc, setSelectedSeniorLoc] = useState(null);
  const [geofenceCenter, setGeofenceCenter] = useState(null);
  const [geofenceCenterTrigger, setGeofenceCenterTrigger] = useState(0);
  const [mapStyle, setMapStyle] = useState('standard');
  const [dismissedAlerts, setDismissedAlerts] = useState(new Set());
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const prevAlertIds = React.useRef(new Set());
  const previousIncidents = React.useRef([]);
  const alertFetchSequence = React.useRef(0);
  const pendingAlertTone = React.useRef(null);
  const confirmationBusy = React.useRef(false);
  const confirmedKeys = React.useRef(new Set());
  const activeAlertKeys = React.useRef(new Set());
  const soundStorageKey = userId ? `safewatch.barangay.alerts.v1:${userId}` : null;

  const tileLayers = {
    standard: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
  };

  // Map Click Listener for Geofencing
  const LocationPicker = () => {
    useMapEvents({
      click(e) {
        if (isPickingLocation) {
          setNewLocation(prev => ({
            ...prev,
            lat: e.latlng.lat.toFixed(6),
            lng: e.latlng.lng.toFixed(6)
          }));
        }
      },
    });
    return null;
  };

  useEffect(() => {
    const timer = setInterval(() => setLiveTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const closeOutside = event => {
      if (!accountMenuRef.current?.contains(event.target)) setAccountMenuOpen(false);
    };
    const closeWithEscape = event => {
      if (event.key === 'Escape') {
        setAccountMenuOpen(false);
        accountButtonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    if (!isLoggedIn) {
      setAccountMenuOpen(false);
      setLogoutError('');
    }
  }, [isLoggedIn]);

  const handleLogout = async () => {
    if (signOutBusy.current) return;
    signOutBusy.current = true;
    setSigningOut(true);
    setLogoutError('');
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setAccountMenuOpen(false);
      setActiveTab('Dashboard');
    } catch {
      setLogoutError('Logout failed. Please check your connection and try again.');
    } finally {
      signOutBusy.current = false;
      setSigningOut(false);
    }
  };

  useEffect(() => {
    const unlock = async event => {
      if (await enableAlertSounds() && pendingAlertTone.current && !confirmationBusy.current
          && !event.target?.closest?.('[data-confirm-alert]')
          && activeAlertKeys.current.has(pendingAlertTone.current.key)) {
        playAlertSound(pendingAlertTone.current.tone);
        pendingAlertTone.current = null;
      }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    alertFetchSequence.current += 1;
    previousIncidents.current = [];
    confirmedKeys.current.clear();
    activeAlertKeys.current.clear();
    pendingAlertTone.current = null;
    prevAlertIds.current = new Set();
    setSosAlerts([]);
    stopAlertSounds();
    if (soundStorageKey) {
      try {
        const keys = JSON.parse(localStorage.getItem(soundStorageKey) || '[]');
        if (Array.isArray(keys)) prevAlertIds.current = new Set(keys);
      } catch { /* Ignore an invalid sound cache. */ }
    }
  }, [soundStorageKey]);

  const timeStr = liveTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = liveTime.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const [trustedLocations, setTrustedLocations] = useState([
    { id: 1, name: "Relative's House", lat: 14.044, lng: 121.132, radius: 100, label: "Trusted Zone" }
  ]);

  const handleSaveLocation = () => {
    if (!newLocation.name || !newLocation.lat) return;

    const newHub = {
      id: Date.now(),
      name: newLocation.name,
      lat: parseFloat(newLocation.lat),
      lng: parseFloat(newLocation.lng),
      radius: newLocation.radius,
      label: "Trusted Zone"
    };

    setTrustedLocations([...trustedLocations, newHub]);
    setIsAddingLocationDetails(false);
    setNewLocation({ name: '', lat: '', lng: '', radius: 30 });
  };

  const [seniors, setSeniors] = useState([]);
  const [sosAlerts, setSosAlerts] = useState([]);

  // Registration Form States
  const [registerName, setRegisterName] = useState('');
  const [registerDeviceId, setRegisterDeviceId] = useState('');
  const [registerAge, setRegisterAge] = useState(70);
  const [registerGender, setRegisterGender] = useState('Male');

  // WKB Hex Parser to extract Latitude & Longitude from PostGIS geography point
  const parseWkbPoint = (hex) => {
    if (!hex || hex.length < 50) return null;
    try {
      // Little-endian double reading from hex string
      const readDoubleLE = (hexStr, offset) => {
        const bytes = new Uint8Array(8);
        for (let i = 0; i < 8; i++) {
          const byteVal = parseInt(hexStr.slice(offset + i * 2, offset + i * 2 + 2), 16);
          bytes[i] = byteVal;
        }
        const view = new DataView(bytes.buffer);
        return view.getFloat64(0, true);
      };

      const type = parseInt(hex.slice(2, 10), 16);
      const hasSrid = (type & 0x20000000) !== 0;
      const coordOffset = hasSrid ? 18 * 2 : 9 * 2;

      const lng = readDoubleLE(hex, coordOffset);
      const lat = readDoubleLE(hex, coordOffset + 16);
      return { lat, lng };
    } catch (e) {
      console.error("WKB parse error:", e);
      return null;
    }
  };

  // Supabase Fetch & Realtime Sync
  const fetchSeniors = async () => {
    try {
      const { data: devicesList, error: devError } = await supabase
        .from('devices')
        .select('*');

      if (devError) throw devError;

      const activeDevices = (devicesList || []).filter(d => d.patient_name !== '[HIDDEN]');

      const seniorsWithTelemetry = await Promise.all(
        activeDevices.map(async (device) => {
          const { data: telList, error: telError } = await supabase
            .from('telemetry')
            .select('*')
            .eq('device_id', device.id)
            .order('created_at', { ascending: false })
            .limit(1);

          const latestTelemetry = telList && telList[0] ? telList[0] : null;
          const packetTime = telemetryTimestamp(latestTelemetry);

          // Parse coordinates from PostGIS point using WKB hex parser
          let lat = 14.0049; // Default to Lipa City / Marawoy area
          let lng = 121.1614;
          let hasGpsLock = false;
          if (latestTelemetry && latestTelemetry.location) {
            const parsed = parseWkbPoint(latestTelemetry.location);
            if (isCurrentGpsPoint(parsed, packetTime)) {
              hasGpsLock = true;
              lat = parsed.lat;
              lng = parsed.lng;
            }
          }

          const isInSafeZone = hasGpsLock && isInsidePolygon(lat, lng, sanIsidroEastGeofence);
          const isInTrustedZone = hasGpsLock && trustedLocations.some(loc => {
            const R = 6371000;
            const dLat = (lat - loc.lat) * Math.PI / 180;
            const dLng = (lng - loc.lng) * Math.PI / 180;
            const a = Math.sin(dLat/2)**2 + Math.cos(loc.lat*Math.PI/180)*Math.cos(lat*Math.PI/180)*Math.sin(dLng/2)**2;
            const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            return dist <= loc.radius;
          });

          let zoneStatus = 'Outside Safe Zone';
          let zoneType = 'outside';
          if (latestTelemetry && latestTelemetry.is_sos) {
            zoneStatus = 'SOS ALERT!';
            zoneType = 'sos';
          } else if (!hasGpsLock) {
            zoneStatus = 'No current GPS fix';
            zoneType = 'waiting';
          } else if (isInSafeZone) {
            zoneStatus = 'Inside Safe Zone';
            zoneType = 'normal';
          } else if (isInTrustedZone) {
            zoneStatus = 'Trusted Location';
            zoneType = 'trusted';
          }

          const details = device.device_name ? device.device_name.split(' (') : [];
          const gender = details[1] ? details[1].replace(')', '').replace(' [MUTED]', '') : 'Male';

          return {
            id: device.id,
            name: device.patient_name,
            phone: device.id,
            age: device.age ?? (device.device_name?.split(' (')[2]?.replace(')', '').replace(' [MUTED]', '').trim() || '--'),
            gender: gender,
            status: zoneStatus,
            pulse: latestTelemetry ? latestTelemetry.heart_rate : 0,
            spo2: latestTelemetry ? latestTelemetry.spo2 : 0,
            battery: latestTelemetry ? latestTelemetry.battery_percent : 0,
            rssi: Number.isFinite(latestTelemetry?.rssi_dbm) ? latestTelemetry.rssi_dbm : null,
            snr: Number.isFinite(latestTelemetry?.snr_db) ? latestTelemetry.snr_db : null,
            location: hasGpsLock ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : 'No current GPS fix',
            hasGpsLock,
            lat: lat,
            lng: lng,
            time: packetTime ? new Date(packetTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'N/A',
            date: packetTime ? new Date(packetTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A',
            isSOS: latestTelemetry ? latestTelemetry.is_sos : false,
            type: zoneType
          };
        })
      );
      setSeniors(seniorsWithTelemetry);
    } catch (e) {
      console.error("Error fetching seniors:", e);
    }
  };

  const fetchAlerts = async () => {
    if (confirmationBusy.current) return;
    const request = ++alertFetchSequence.current;
    try {
      const { data, error } = await supabase.from('alerts')
        .select('*, devices(patient_name, device_name)')
        .or(ALERT_QUERY_FILTER)
        .order('created_at', { ascending: false }).limit(500);
      if (error) throw error;
      if (request !== alertFetchSequence.current) return;
      const incidents = groupAlertIncidents(data || [], previousIncidents.current);
      previousIncidents.current = incidents;
      const escalated = incidents.filter(incident => needsBarangayAttention(incident)
        && !confirmedKeys.current.has(incident.key));
      const mapped = escalated.map(incident => ({
        ...incident, seniorName: incident.devices?.patient_name || 'Unknown Device',
        seniorId: incident.device_id, deviceId: incident.device_id,
        date: new Date(incident.created_at).toLocaleDateString(),
        time: new Date(incident.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        fullTime: new Date(incident.created_at).toLocaleString(), status: 'ESCALATED_BHW',
        rawType: incident.alert_type, rawDetails: incident.details || {},
        deviceName: incident.devices?.device_name || '',
      }));
      activeAlertKeys.current = new Set(mapped.map(incident => incident.key));
      if (pendingAlertTone.current && !activeAlertKeys.current.has(pendingAlertTone.current.key)) {
        pendingAlertTone.current = null;
        stopAlertSounds();
      }
      const newlyEscalated = mapped.filter(incident => !prevAlertIds.current.has(incident.key));
      if (newlyEscalated.length) {
        const incident = newlyEscalated.find(item => item.rawType === 'SOS') || newlyEscalated[0];
        const tone = incident.rawType === 'SOS' ? 'sos' : 'geofence';
        if (!playAlertSound(tone)) pendingAlertTone.current = { key: incident.key, tone };
        for (const incident of newlyEscalated) prevAlertIds.current.add(incident.key);
        if (soundStorageKey) {
          try { localStorage.setItem(soundStorageKey, JSON.stringify([...prevAlertIds.current].slice(-512))); }
          catch { /* Notifications still work without persistent browser storage. */ }
        }
      }
      if (!mapped.length) { pendingAlertTone.current = null; stopAlertSounds(); }
      setSelectedAlert(current => current && activeAlertKeys.current.has(current.key) ? current : null);
      setSosAlerts(mapped);
    } catch (error) { console.error('Error fetching alerts:', error.message); }
  };

  const commitConfirmation = incident => {
    confirmedKeys.current.add(incident.key);
    activeAlertKeys.current.delete(incident.key);
    setSosAlerts(items => items.filter(item => item.key !== incident.key));
    setSelectedAlert(current => current?.key === incident.key ? null : current);
  };

  const handleDismissAlertDB = async (incident) => {
    if (confirmationBusy.current) return;
    confirmationBusy.current = true;
    setConfirmingAlerts(true);
    pendingAlertTone.current = null;
    stopAlertSounds();
    try {
      alertFetchSequence.current += 1;
      await acknowledgeIncident(supabase, incident, 'barangay');
      commitConfirmation(incident);
    } catch (error) {
      console.error('Error confirming alert:', error.message);
      window.alert(confirmationErrorMessage(error));
    } finally {
      confirmationBusy.current = false;
      setConfirmingAlerts(false);
      await fetchAlerts();
    }
  };

  const handleDismissAllDB = async () => {
    if (confirmationBusy.current) return;
    confirmationBusy.current = true;
    setConfirmingAlerts(true);
    pendingAlertTone.current = null;
    stopAlertSounds();
    try {
      alertFetchSequence.current += 1;
      for (const incident of sosAlerts.filter(item => !dismissedAlerts.has(item.id))) {
        await acknowledgeIncident(supabase, incident, 'barangay');
        commitConfirmation(incident);
      }
    } catch (error) {
      console.error('Error confirming alerts:', error.message);
      window.alert(confirmationErrorMessage(error));
    } finally {
      confirmationBusy.current = false;
      setConfirmingAlerts(false);
      await fetchAlerts();
    }
  };

  useEffect(() => {
    if (!isLoggedIn) {
      pendingAlertTone.current = null;
      previousIncidents.current = [];
      prevAlertIds.current = new Set();
      stopAlertSounds();
      setSosAlerts([]);
      return;
    }
    // Check every 10 seconds so we can auto-escalate alerts that cross the 3-min threshold
    const timer = setInterval(() => {
      setLiveTime(new Date());
      fetchAlerts();
    }, 10000);

    // Initial fetch
    fetchSeniors();
    fetchAlerts();

    // Subscribe to changes
    const telemetrySubscription = supabase
      .channel('public:telemetry')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'telemetry' }, () => {
        fetchSeniors();
      })
      .subscribe();

    const alertsSubscription = supabase
      .channel('public:alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => {
        fetchAlerts();
      })
      .subscribe();

    return () => {
      alertFetchSequence.current += 1;
      clearInterval(timer);
      supabase.removeChannel(telemetrySubscription);
      supabase.removeChannel(alertsSubscription);
    };
  }, [isLoggedIn, userId]);

  const handleRegisterSenior = async () => {
    if (!registerName || !registerDeviceId) {
      alert("Please fill in both the Patient Name and the Watch ID.");
      return;
    }

    try {
      const { error } = await supabase
        .from('devices')
        .upsert([
          {
            id: registerDeviceId.trim(),
            patient_name: registerName,
            device_name: `SafeWatch Watch (${registerGender})`
          }
        ]);

      if (error) {
        alert("Registration failed: " + error.message);
      } else {
        setIsAddingSenior(false);
        setRegisterName('');
        setRegisterDeviceId('');
        fetchSeniors();
      }
    } catch (e) {
      alert("Error: " + e.message);
    }
  };

  const sanIsidroEastGeofence = SAN_ISIDRO_EAST_BOUNDARY;

  if (isLoadingAuth) {
    return <div className="min-h-screen flex items-center justify-center bg-[#f0f4ec]"><RefreshCw className="w-8 h-8 animate-spin text-emerald-600" aria-label="Checking login" /></div>;
  }

  if (recoveryLink) return <RecoveryLinkConfirm client={supabase} link={recoveryLink} onVerified={retryAuth} />;
  if (pendingAccess || authError) return <AccountMfaGate key={pendingAccess?.user.id || 'error'} client={supabase} access={pendingAccess} error={authError} onVerified={retryAuth} />;
  if (accessDenied) return <AccountAccessDenied client={supabase} access={accessDenied} user={accountUser} app='dashboard' onRetry={retryAuth} />;
  if (recoveryAccess) return <PasswordRecovery key={recoveryAccess.user?.id || 'invalid'} client={supabase} {...recoveryAccess} onNotice={setAuthNotice} onFinished={retryAuth} />;

  if (!isLoggedIn) return <AuthEntry client={supabase} app='dashboard' initialError={authLinkError} notice={authNotice} onRecovered={retryAuth} />;

  const renderContent = () => {
    const visibleAlerts = sosAlerts.filter(a => !dismissedAlerts.has(a.id));
    const totalSeniors = seniors.length.toString();
    const safeSeniorsCount = seniors.filter(s => s.type === 'normal' || s.type === 'trusted').length.toString().padStart(2, '0');
    const activeAlertsCount = visibleAlerts.length.toString().padStart(2, '0');

    const allVitalsNormal = seniors.length === 0 || seniors.every(s => s.spo2 >= 95 && s.pulse >= 60 && s.pulse <= 100);
    const healthStatusStr = allVitalsNormal ? "Good" : "Warning";
    const healthStatusColor = allVitalsNormal ? "text-[#4a7c59]" : "text-orange-600";
    const healthStatusBg = allVitalsNormal ? "bg-[#e8f5e9]" : "bg-orange-50";
    const healthStatusText = allVitalsNormal ? "All vitals normal" : "Check vitals";

    const avgPulse = seniors.length > 0 ? Math.round(seniors.reduce((acc, s) => acc + s.pulse, 0) / seniors.length).toString() : "0";
    const avgSpo2 = seniors.length > 0 ? Math.round(seniors.reduce((acc, s) => acc + s.spo2, 0) / seniors.length).toString() + "%" : "0%";

    if (activeTab === 'Dashboard') {
      return (
        <div className="p-8 space-y-6 tab-content">
          {/* Welcome Banner */}
          <div className="gradient-banner p-8 text-white animate-enter">
            <div className="relative z-10 flex justify-between items-center">
              <div>
                <p className="text-white/60 text-sm font-medium mb-1">Welcome back,</p>
                <h2 className="text-2xl font-bold tracking-tight">{familyProfileFromUser(accountUser).fullName || 'Barangay Health Worker'}</h2>
                <p className="text-white/50 text-sm mt-1">San Isidro East, Malvar, Batangas</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold tabular-nums tracking-tight">{timeStr}</p>
                <p className="text-white/50 text-sm">{dateStr}</p>
              </div>
            </div>
          </div>

          {/* Top Stats Row */}
          <div className="grid grid-cols-4 gap-5">
            <div className="animate-enter animate-enter-d1"><StatCard icon={Users} value={totalSeniors} label="Seniors Monitored" subtext="View Seniors" color="text-[#4a7c59]" iconBg="bg-[#e8f5e9]" signal={parseInt(totalSeniors) > 0 ? 100 : 0} /></div>
            <div className="animate-enter animate-enter-d2"><StatCard icon={MapPin} value={safeSeniorsCount} label="Inside Safe Zone" subtext="View Map" color="text-[#4a7c59]" iconBg="bg-[#e8f5e9]" signal={parseInt(totalSeniors) > 0 ? (parseInt(safeSeniorsCount) / parseInt(totalSeniors)) * 100 : 0} /></div>
            <div className="animate-enter animate-enter-d3"><StatCard icon={Bell} value={activeAlertsCount} label="Active Alerts" subtext="Require Attention" color={activeAlertsCount !== "00" ? "text-red-600" : "text-[#4a7c59]"} iconBg={activeAlertsCount !== "00" ? "bg-red-50" : "bg-[#e8f5e9]"} signal={activeAlertsCount === "00" ? 100 : Math.max(0, 100 - (parseInt(activeAlertsCount) * 20))} /></div>
            <div className="animate-enter animate-enter-d4"><StatCard icon={HeartPulse} value={healthStatusStr} label="Health Status" subtext={healthStatusText} color={healthStatusColor} iconBg={healthStatusBg} signal={allVitalsNormal ? 100 : 40} /></div>
          </div>

          {/* 2-Column Grid */}
          <div className="grid grid-cols-12 gap-6">
            {/* Live Location Map */}
            <div className="col-span-8 card overflow-hidden flex flex-col h-[480px] relative">
              <div className="px-6 py-4 border-b border-[#e2e8d8]/50 flex justify-between items-center bg-white/50 backdrop-blur-md z-10">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-800">Live Location Map</h3>
                  <div className="live-dot"></div>
                </div>
                <button onClick={() => setActiveTab('Live Location')} className="text-xs font-bold text-[#4a7c59] bg-[#4a7c59]/10 px-3 py-1.5 rounded-lg hover:bg-[#4a7c59]/20 transition-colors flex items-center gap-1"><Maximize2 className="w-3 h-3" /> Expand Map</button>
              </div>
              <div className="flex-1 relative z-0">
                <MapContainer bounds={sanIsidroEastGeofence} boundsOptions={{ padding: [24, 24] }} className="h-full w-full" zoomControl={false}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
                  <PolygonWithLegend positions={sanIsidroEastGeofence} name="San Isidro East" />
                  {trustedLocations.map(loc => (
                    <Circle key={loc.id} center={[loc.lat, loc.lng]} radius={loc.radius} pathOptions={{ color: '#4a7c59', fillColor: '#4a7c59', fillOpacity: 0.15, weight: 2, dashArray: '5, 10' }} />
                  ))}
                  {seniors.filter(senior => senior.hasGpsLock).map(senior => (
                    <Marker key={senior.id} position={[senior.lat, senior.lng]} icon={createCustomIcon(senior.name, senior.type)} />
                  ))}
                </MapContainer>
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] bg-white/90 backdrop-blur px-5 py-2 rounded-full shadow-lg border border-white/50 flex items-center gap-5">
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-[#4a7c59] rounded-full shadow-[0_0_8px_#4a7c59]"></div><span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">Safe Zone</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-blue-500 rounded-full shadow-[0_0_8px_#3b82f6]"></div><span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">Trusted</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-red-500 rounded-full shadow-[0_0_8px_#ef4444]"></div><span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">Outside</span></div>
                </div>
              </div>
            </div>

            {/* Critical Alerts Panel */}
            <div className="col-span-4 card overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b border-[#e2e8d8] flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-800">Critical Alerts Panel</h3>
                  {sosAlerts.filter(a => !dismissedAlerts.has(a.id)).length > 0 && (
                    <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">
                      {sosAlerts.filter(a => !dismissedAlerts.has(a.id)).length}
                    </span>
                  )}
                </div>
                <button
                  data-confirm-alert disabled={confirmingAlerts}
                  onClick={handleDismissAllDB}
                  className="text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors"
                >
                  Dismiss All
                </button>
              </div>
              <div className="flex-1 p-4 space-y-3 overflow-y-auto max-h-[360px]">
                {sosAlerts.filter(a => !dismissedAlerts.has(a.id)).length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 text-center">
                    <div className="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center mb-2">
                      <Shield className="w-5 h-5 text-green-500" />
                    </div>
                    <p className="text-sm font-medium text-gray-500">All Clear</p>
                    <p className="text-xs text-gray-400">No active alerts</p>
                  </div>
                ) : (
                  sosAlerts.filter(a => !dismissedAlerts.has(a.id)).map(alert => (
                    <div key={alert.id} className={`p-4 rounded-xl border ${
                      alert.rawType === 'SOS' ? 'border-red-200 bg-red-50/50' :
                      alert.rawType === 'GEOFENCE' ? 'border-orange-200 bg-orange-50/50' :
                      'border-yellow-200 bg-yellow-50/50'
                    }`}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-2 h-2 rounded-full animate-pulse ${
                          alert.rawType === 'SOS' ? 'bg-red-500' : 'bg-orange-400'
                        }`}></div>
                        <span className={`badge ${
                          alert.rawType === 'SOS' ? 'badge-red' : 'badge-orange'
                        }`}>{alert.rawType === 'SOS' ? '🚨 SOS' : '⚠️ Geofence'}</span>
                        <span className="text-[10px] text-gray-400 ml-auto">{alert.time}</span>
                      </div>
                      <p className="text-sm font-semibold text-gray-800 mb-1">{alert.seniorName}</p>
                      <p className="text-xs text-gray-400 mb-3">
                        {alert.rawType === 'SOS' ? '🔴 SOS button pressed — immediate attention required!' :
                         '📍 Senior moved outside the safe zone boundary'}
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setSelectedAlert(alert)}
                          className="btn-outline !py-1.5 !px-3 !text-xs flex-1"
                        >View Details</button>
                        <button
                          data-confirm-alert disabled={confirmingAlerts}
                          onClick={() => handleDismissAlertDB(alert)}
                          className="btn-outline !py-1.5 !px-3 !text-xs flex-1 !text-gray-400 hover:!text-red-500"
                        >Dismiss</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Bottom Row: Monitored Seniors List */}
          <div className="card overflow-hidden">
            <div className="px-6 py-4 border-b border-[#e2e8d8] flex justify-between items-center">
              <h3 className="text-sm font-semibold text-gray-800">Monitored Seniors</h3>
              <button onClick={() => setActiveTab('Senior Monitoring')} className="text-xs font-medium text-[#4a7c59] hover:underline">View All →</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="bg-[#f7f9f4]">
                  <th className="table-header">Senior</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Pulse</th>
                  <th className="table-header">SpO2</th>
                  <th className="table-header">Battery</th>
                  <th className="table-header">LoRa (last packet)</th>
                  <th className="table-header">Last Update</th>
                </tr></thead>
                <tbody className="divide-y divide-[#e2e8d8]/50">
                  {seniors.map(senior => (
                    <tr key={senior.id} className="hover:bg-[#f7f9f4]/50 transition-colors">
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${senior.name}`} className="w-9 h-9 rounded-full bg-[#f7f9f4]" alt={senior.name} />
                          <div>
                            <p className="font-semibold text-gray-800 text-sm">{senior.name}</p>
                            <p className="text-[10px] text-gray-400">{senior.age}y • {senior.gender}</p>
                          </div>
                        </div>
                      </td>
                      <td className="table-cell"><span className={`badge ${senior.type === 'trusted' ? 'badge-blue' : 'badge-green'}`}>{senior.type === 'trusted' ? 'Trusted Loc' : 'Safe Zone'}</span></td>
                      <td className="table-cell"><span className="font-semibold">{senior.pulse}</span> <span className="text-gray-400 text-xs">bpm</span></td>
                      <td className="table-cell"><span className="font-semibold">{senior.spo2}</span><span className="text-gray-400 text-xs">%</span></td>
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-gray-100"><div className={`h-full rounded-full ${senior.battery < 20 ? 'bg-red-400' : 'bg-[#4a7c59]'}`} style={{width:`${senior.battery}%`}}></div></div>
                          <span className={`text-xs font-medium ${senior.battery < 20 ? 'text-red-500' : 'text-gray-600'}`}>{senior.battery}%</span>
                        </div>
                      </td>
                      <td className="table-cell text-xs" title="Signal measured by the gateway for the last received packet; it is not a live connection reading.">
                        {senior.rssi !== null && senior.snr !== null ? (
                          <><p className="font-semibold text-slate-700">RSSI {senior.rssi.toFixed(1)} dBm</p><p className="text-slate-500">SNR {senior.snr.toFixed(1)} dB</p></>
                        ) : <span className="text-gray-400">No measurement</span>}
                      </td>
                      <td className="table-cell text-xs text-gray-400">{senior.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    } else if (activeTab === 'Senior Monitoring') {
      const filteredSeniors = seniors.filter(s => {
        const matchesName = s.name.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = statusFilter === 'All Status' || s.status === statusFilter;
        return matchesName && matchesStatus;
      });

      return (
        <div className="p-8 space-y-8 flex-1 overflow-y-auto">
          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-6">
            <StatCard icon={Users} value={totalSeniors} label="Seniors Monitored" subtext="View All Seniors" color="text-emerald-600" iconBg="bg-emerald-100" signal={parseInt(totalSeniors) > 0 ? 100 : 0} />
            <StatCard icon={MapPin} value={safeSeniorsCount} label="Inside Safe Zone" subtext="Inside Safe Zone" color="text-blue-600" iconBg="bg-blue-100" signal={parseInt(totalSeniors) > 0 ? (parseInt(safeSeniorsCount) / parseInt(totalSeniors)) * 100 : 0} />
            <StatCard icon={Bell} value={activeAlertsCount} label="Active Alerts" subtext="View Alerts" color="text-orange-600" iconBg="bg-orange-100" signal={activeAlertsCount === "00" ? 100 : Math.max(0, 100 - (parseInt(activeAlertsCount) * 20))} />
            <StatCard icon={HeartPulse} value={healthStatusStr} label="Overall Health Status" subtext={healthStatusText} color={healthStatusColor} iconBg={healthStatusBg} signal={allVitalsNormal ? 100 : 40} />
          </div>

          {/* Table Section */}
          <div className="card overflow-hidden">
            <div className="px-6 py-4 border-b border-[#e2e8d8] flex justify-between items-center">
              <div className="flex items-center gap-3 flex-1 max-w-lg">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type="text" placeholder="Search senior by name..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="input-field !pl-10" />
                </div>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input-field !w-auto">
                  <option value="All Status">All Status</option>
                  <option value="Inside Safe Zone">Inside Safe Zone</option>
                  <option value="Trusted Location">Trusted Location</option>
                  <option value="Outside Safe Zone">Outside Safe Zone</option>
                  <option value="SOS ALERT!">SOS ALERT!</option>
                </select>
              </div>
              <div className="flex items-center gap-3">
                <button className="btn-outline flex items-center gap-2">
                  <Filter className="w-4 h-4" />
                  Filter
                </button>
                <button
                  onClick={() => setIsAddingSenior(true)}
                  className="btn-primary flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Register Senior
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#f7f9f4]">
                    <th className="table-header">Senior</th>
                    <th className="table-header">Age / Gender</th>
                    <th className="table-header">Safe Zone Status</th>
                    <th className="table-header">Pulse Rate</th>
                    <th className="table-header">Battery</th>
                    <th className="table-header">Last Location</th>
                    <th className="table-header">LoRa (last packet)</th>
                    <th className="table-header">Last Update</th>
                    <th className="table-header">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredSeniors.map(senior => (
                    <tr key={senior.id} className="hover:bg-[#f7f9f4]/50 transition-colors">
                      <td className="table-cell text-sm">
                        <div className="flex items-center gap-3">
                          <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${senior.name}`} className="w-9 h-9 rounded-full bg-[#f7f9f4]" alt={senior.name} />
                          <div>
                            <p className="font-semibold text-gray-800">{senior.name}</p>
                            <p className="text-[10px] text-gray-400">ID: {senior.phone}</p>
                          </div>
                        </div>
                      </td>
                      <td className="table-cell">
                        <p className="font-bold text-slate-600">{senior.age}</p>
                        <p className="text-[10px] text-slate-400 font-medium">{senior.gender}</p>
                      </td>
                      <td className="table-cell">
                        <span className={`badge ${senior.type === 'trusted' ? 'badge-blue' : senior.type === 'sos' ? 'badge-red' : senior.type === 'normal' ? 'badge-green' : 'badge-orange'}`}>
                          {senior.status}
                        </span>
                      </td>
                      <td className="table-cell">
                        <p className={`font-bold ${senior.pulse < 60 ? 'text-red-500' : 'text-emerald-500'}`}>{senior.pulse} bpm</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${senior.pulse < 60 ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'}`}>{senior.pulse < 60 ? 'Low' : 'Good'}</span>
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-1.5">
                          <Battery className={`w-4 h-4 ${senior.battery < 20 ? 'text-red-500 rotate-180' : 'text-emerald-500'}`} />
                          <p className="font-bold text-slate-600">{senior.battery}%</p>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${senior.battery < 20 ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'}`}>{senior.battery < 20 ? 'Low' : 'Good'}</span>
                      </td>
                      <td className="table-cell">
                        <p className="font-medium text-slate-600 leading-tight">{senior.location.split(',')[0]}</p>
                        <p className="text-[10px] text-slate-400 font-bold">{senior.location.split(',')[1]}</p>
                      </td>
                      <td className="table-cell text-xs" title="Signal measured by the gateway for the last received packet; it is not a live connection reading.">
                        {senior.rssi !== null && senior.snr !== null ? (
                          <><p className="font-semibold text-slate-700">RSSI {senior.rssi.toFixed(1)} dBm</p><p className="text-slate-500">SNR {senior.snr.toFixed(1)} dB</p></>
                        ) : <span className="text-gray-400">No measurement</span>}
                      </td>
                      <td className="table-cell text-xs">
                        <p className="font-bold text-slate-800">{senior.time}</p>
                        <p className="text-[10px] text-slate-400 font-medium">{senior.date}</p>
                      </td>
                      <td className="table-cell">
                        <button onClick={() => { setSelectedSeniorLoc([senior.lat, senior.lng]); setActiveTab('Live Location'); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg font-bold hover:bg-emerald-100 transition-all">
                          <Eye className="w-4 h-4" />
                          <span className="text-[10px]">View</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    } else if (activeTab === 'Live Location') {
      return (
        <div className="flex-1 flex overflow-hidden p-6 gap-6 relative">
          {/* Interactive Sidebar */}
          <div className="w-80 flex flex-col gap-4 z-10 animate-enter">
            <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white flex flex-col gap-4 shrink-0">
              <h3 className="text-lg font-bold text-slate-800">Track Seniors</h3>
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="text" placeholder="Search name..." className="w-full bg-slate-50 border border-slate-100 rounded-xl py-2.5 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-[#4a7c59]/20 transition-all" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pb-4">
              {seniors.map(senior => (
                <div
                  key={senior.id}
                  onClick={() => setSelectedSeniorLoc([senior.lat, senior.lng])}
                  className="bg-white/80 backdrop-blur-xl p-4 rounded-2xl shadow-sm border border-white cursor-pointer hover:shadow-md hover:-translate-y-1 transition-all group"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${senior.name}`} className="w-10 h-10 rounded-full bg-slate-100" />
                    <div>
                      <p className="font-bold text-slate-800 text-sm group-hover:text-[#4a7c59] transition-colors">{senior.name}</p>
                      <p className="text-[10px] text-slate-400 font-semibold uppercase">{senior.status}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-slate-500 font-medium">
                      <Battery className={`w-3.5 h-3.5 ${senior.battery < 20 ? 'text-red-500' : 'text-[#4a7c59]'}`} />
                      {senior.battery}%
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-500 font-medium">
                      <HeartPulse className="w-3.5 h-3.5 text-red-400" />
                      {senior.pulse} bpm
                    </div>
                    <button className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center group-hover:bg-[#4a7c59] group-hover:text-white transition-colors">
                      <MapPin className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Map Container */}
          <div className="flex-1 relative rounded-[2.5rem] overflow-hidden border border-white shadow-[0_8px_30px_rgb(0,0,0,0.06)] bg-slate-100 z-0">
            <MapContainer bounds={sanIsidroEastGeofence} boundsOptions={{ padding: [24, 24] }} className="h-full w-full" zoomControl={false}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
              <MapController center={selectedSeniorLoc} zoom={18} />
              {seniors.filter(senior => senior.hasGpsLock).map(senior => (
                <Marker key={senior.id} position={[senior.lat, senior.lng]} icon={createCustomIcon(senior.name, senior.type)}>
                  <Popup className="premium-popup">
                    <div className="text-slate-800 p-2 min-w-[150px]">
                      <div className="flex items-center gap-3 mb-2">
                        <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${senior.name}`} className="w-8 h-8 rounded-full" />
                        <div>
                          <p className="font-bold leading-tight">{senior.name}</p>
                          <p className="text-[10px] font-bold text-[#4a7c59] uppercase">{senior.status}</p>
                        </div>
                      </div>
                      <p className="text-xs text-slate-500 border-t border-slate-100 pt-2 mt-2"><MapPin className="w-3 h-3 inline mr-1" />{senior.location}</p>
                    </div>
                  </Popup>
                </Marker>
              ))}
              <PolygonWithLegend positions={sanIsidroEastGeofence} name="San Isidro East" />
            </MapContainer>

            {/* Map Floating UI */}
            <div className="absolute top-6 right-6 z-[1000] flex flex-col gap-2">
              <button className="w-10 h-10 bg-white/90 backdrop-blur rounded-xl shadow-lg border border-white flex items-center justify-center text-slate-600 hover:text-[#4a7c59] transition-colors"><Plus className="w-5 h-5" /></button>
              <button className="w-10 h-10 bg-white/90 backdrop-blur rounded-xl shadow-lg border border-white flex items-center justify-center text-slate-600 hover:text-[#4a7c59] transition-colors"><span className="text-xl font-medium leading-none mb-0.5">-</span></button>
              <button onClick={() => setSelectedSeniorLoc([14.039, 121.123])} className="w-10 h-10 mt-2 bg-white/90 backdrop-blur rounded-xl shadow-lg border border-white flex items-center justify-center text-blue-500 hover:bg-blue-50 transition-colors"><Map className="w-5 h-5" /></button>
            </div>
          </div>
        </div>
      );
    } else if (activeTab === 'Health Overview') {
      return (
        <div className="p-8 space-y-8 flex-1 overflow-y-auto">
          {/* Health Summary Row */}
          <div className="grid grid-cols-4 gap-6">
            <StatCard icon={HeartPulse} value={avgPulse} label="Avg. Pulse Rate" subtext="Across all seniors" color="text-purple-600" iconBg="bg-purple-100" signal={parseInt(avgPulse) >= 60 && parseInt(avgPulse) <= 100 ? 100 : 50} />
            <StatCard icon={Activity} value={avgSpo2} label="Avg. Blood Oxygen" subtext="Stable status" color="text-emerald-600" iconBg="bg-emerald-100" signal={parseInt(avgSpo2) >= 95 ? 100 : parseInt(avgSpo2) >= 90 ? 70 : 30} />
            <StatCard icon={Bell} value={activeAlertsCount} label="Critical Alerts" subtext="Active now" color="text-red-600" iconBg="bg-red-100" signal={activeAlertsCount === "00" ? 100 : Math.max(0, 100 - (parseInt(activeAlertsCount) * 20))} />
            <StatCard icon={Shield} value="100%" label="Uptime Status" subtext="Device connectivity" color="text-blue-600" iconBg="bg-blue-100" signal={100} />
          </div>

          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-50">
              <h3 className="font-bold text-slate-800">Real-time Health Vitals</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="table-header">Senior</th>
                    <th className="table-header">Pulse Rate (bpm)</th>
                    <th className="table-header">Blood Oxygen (%)</th>
                    <th className="table-header">Battery Status</th>
                    <th className="table-header">Last Record</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {seniors.map(senior => (
                    <tr key={senior.id} className="hover:bg-slate-50/30 transition-colors">
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${senior.name}`} className="w-10 h-10 rounded-full" />
                          <span className="font-bold text-slate-800">{senior.name}</span>
                        </div>
                      </td>
                      <td className="table-cell">
                        <div className="flex items-baseline gap-2">
                          <span className="text-lg font-black text-slate-800">{senior.pulse}</span>
                          <span className="text-[10px] font-bold text-emerald-500 uppercase">Normal</span>
                        </div>
                      </td>
                      <td className="table-cell">
                        <div className="flex items-baseline gap-2">
                          <span className="text-lg font-black text-slate-800">{senior.spo2}</span>
                          <span className="text-[10px] font-bold text-emerald-500 uppercase">{senior.spo2 >= 95 ? 'Stable' : 'Warning'}</span>
                        </div>
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          <div className={`w-12 h-2 rounded-full ${senior.battery < 20 ? 'bg-red-100' : 'bg-emerald-100'}`}>
                            <div className={`h-full rounded-full ${senior.battery < 20 ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${senior.battery}%` }}></div>
                          </div>
                          <span className="text-xs font-bold text-slate-600">{senior.battery}%</span>
                        </div>
                      </td>
                      <td className="table-cell">
                        <p className="text-xs font-bold text-slate-800">{senior.time}</p>
                        <p className="text-[10px] text-slate-400 font-medium">{senior.date}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    } else if (activeTab === 'SOS Alerts') {
      return (
        <div className="p-8 space-y-8 flex-1 overflow-y-auto">
          {/* Alert Summary Card */}
          <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 flex items-center gap-6 w-fit">
            <div className="w-20 h-20 bg-red-500 rounded-full flex items-center justify-center animate-pulse">
              <Bell className="w-10 h-10 text-white" />
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black text-slate-800">{parseInt(activeAlertsCount)}</span>
                <span className="text-lg font-bold text-slate-500">Active Alerts</span>
              </div>
              <p className="text-sm font-bold text-red-500 uppercase tracking-widest mt-1">Require Attention</p>
            </div>
          </div>

          {/* Alerts Table */}
          <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-50">
              <div className="relative max-w-md">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="text" placeholder="Search by senior name..." className="w-full pl-11 pr-4 py-3 bg-slate-50 border-none rounded-2xl text-sm outline-none" />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="table-header py-6">Senior</th>
                    <th className="table-header py-6">Alert Time</th>
                    <th className="table-header py-6">Escalation Status</th>
                    <th className="table-header py-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {visibleAlerts.map(alert => (
                    <tr key={alert.id} className="hover:bg-slate-50/30 transition-colors">
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-4">
                          <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${alert.seniorName}`} className="w-14 h-14 rounded-full bg-slate-100" />
                          <div>
                            <p className="font-bold text-slate-800 text-base">{alert.seniorName}</p>
                            <p className="text-xs text-slate-400 font-bold tracking-wider">ID: {alert.seniorId}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <div className="text-slate-600">
                          <p className="font-bold text-sm">{alert.date}</p>
                          <p className="text-xs font-medium text-slate-400">{alert.time}</p>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg w-fit ${alert.status === 'ESCALATED_BHW' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                          {alert.status === 'ESCALATED_BHW' ? <AlertCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                          <span className="text-[10px] font-black uppercase tracking-wider">{alert.status === 'ESCALATED_BHW' ? 'Escalated' : alert.status}</span>
                        </div>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <button data-confirm-alert disabled={confirmingAlerts} onClick={() => handleDismissAlertDB(alert)} className="px-4 py-2 bg-slate-800 text-white text-[10px] font-black uppercase rounded-lg hover:bg-slate-900 transition-all disabled:opacity-50">Acknowledge</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    } else if (activeTab === 'Geofence Zones') {
      return (
        <div className="p-8 space-y-8 flex-1 overflow-y-auto">
          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-6">
            <StatCard icon={MapPin} value="1" label="Geofencing Zone" subtext="Currently in use" color="text-emerald-600" iconBg="bg-emerald-100" signal={100} />
            <StatCard icon={Users} value={totalSeniors} label="Seniors Assigned" subtext="Across the zone" color="text-blue-600" iconBg="bg-blue-100" signal={parseInt(totalSeniors) > 0 ? 100 : 0} />
            <StatCard icon={Bell} value={activeAlertsCount} label="Active Alerts" subtext="Outside safe zone" color="text-orange-600" iconBg="bg-orange-100" signal={activeAlertsCount === "00" ? 100 : Math.max(0, 100 - (parseInt(activeAlertsCount) * 20))} />
            <StatCard icon={Clock} value={parseInt(totalSeniors) - parseInt(safeSeniorsCount)} label="Outside Safes" subtext="Current trips" color="text-purple-600" iconBg="bg-purple-100" signal={parseInt(totalSeniors) > 0 ? ((parseInt(totalSeniors) - parseInt(safeSeniorsCount)) / parseInt(totalSeniors)) * 100 : 0} />
          </div>

          <div className="grid grid-cols-5 gap-8">
            <div className="col-span-2 bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden flex flex-col h-[500px]">
              <div className="p-6 border-b border-slate-50">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-slate-800">Active Zones</h3>
                  <button
                    onClick={() => {
                      setNewLocation({ name: '', lat: '', lng: '', radius: 30 });
                      setIsPickingLocation(true);
                    }}
                    className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-all flex items-center gap-2 text-[10px] font-black uppercase"
                  >
                    <Plus className="w-3 h-3" /> Add Safe Hub
                  </button>
                </div>
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input type="text" placeholder="Search zone..." className="w-full pl-11 pr-4 py-3 bg-slate-50 border-none rounded-2xl text-sm outline-none" />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Main Geofence */}
                <button type="button"
                  onClick={() => { setGeofenceCenter(null); setGeofenceCenterTrigger(prev => prev + 1); }}
                  className="p-5 w-full text-left rounded-3xl border border-emerald-100 bg-emerald-50/30 flex items-center justify-between cursor-pointer group hover:bg-emerald-50 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm text-emerald-500">
                      <LayoutDashboard className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="font-bold text-slate-800">San Isidro East</p>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Main District Area</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold text-slate-400">{seniors.length} Seniors</span>
                    <span className="px-2.5 py-1 bg-emerald-100 text-emerald-600 text-[9px] font-black uppercase rounded-lg">Active</span>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 transition-colors" />
                  </div>
                </button>

                {/* Additional Trusted Hubs */}
                {trustedLocations.map(loc => (
                  <div
                    key={loc.id}
                    onClick={() => { setGeofenceCenter([loc.lat, loc.lng]); setGeofenceCenterTrigger(prev => prev + 1); }}
                    className="p-5 rounded-3xl border border-slate-100 bg-white flex items-center justify-between cursor-pointer group hover:border-blue-200 transition-all shadow-sm"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-500">
                        <MapPin className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="font-bold text-slate-800">{loc.name}</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Radius: {loc.radius}m</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="px-2.5 py-1 bg-blue-50 text-blue-600 text-[9px] font-black uppercase rounded-lg">Trusted Hub</span>
                      <button
                         onClick={(e) => {
                           e.stopPropagation();
                           setTrustedLocations(prev => prev.filter(l => l.id !== loc.id));
                         }}
                         className="p-1.5 hover:bg-red-50 text-slate-300 hover:text-red-500 rounded-lg transition-colors"
                         title="Remove Safe Hub"
                      >
                         <Trash2 className="w-4 h-4" />
                      </button>
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-colors" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-4 bg-slate-50/50 text-[10px] text-slate-400 font-medium px-8">Showing {trustedLocations.length + 1} zones</div>
            </div>
            <div className="col-span-3 relative rounded-[2.5rem] overflow-hidden border border-white shadow-[0_8px_30px_rgb(0,0,0,0.06)] bg-white h-[500px]">
              <MapContainer bounds={sanIsidroEastGeofence} boundsOptions={{ padding: [32, 32] }} className="h-full w-full" zoomControl={false}>
                <TileLayer url={tileLayers[mapStyle]} attribution="&copy; OpenStreetMap contributors" />
                <MapController center={geofenceCenter} zoom={17} trigger={geofenceCenterTrigger} bounds={sanIsidroEastGeofence} />
                <PolygonWithLegend positions={sanIsidroEastGeofence} name="San Isidro East" />
                <LocationPicker />

                {/* Show all saved trusted locations */}
                {trustedLocations.map(loc => (
                  <React.Fragment key={loc.id}>
                    <Marker position={[loc.lat, loc.lng]} icon={createCustomIcon(loc.name, 'trusted')} />
                    <Circle
                      center={[loc.lat, loc.lng]}
                      radius={loc.radius}
                      pathOptions={{ color: '#4a7c59', fillColor: '#4a7c59', fillOpacity: 0.15, weight: 2, dashArray: '5, 10' }}
                    />
                  </React.Fragment>
                ))}

                {/* Show current picking preview */}
                {newLocation.lat && newLocation.lng && (
                  <>
                    <Marker position={[newLocation.lat, newLocation.lng]} />
                    <Circle
                      center={[newLocation.lat, newLocation.lng]}
                      radius={newLocation.radius}
                      pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.2 }}
                    />
                  </>
                )}
              </MapContainer>

              {/* Map Style Toggle */}
              <div className="absolute top-6 left-6 z-[1000]">
                <button
                  onClick={() => setMapStyle(prev => prev === 'standard' ? 'satellite' : 'standard')}
                  className="bg-white/90 backdrop-blur-md px-4 py-2 rounded-xl shadow-lg border border-white text-[10px] font-black uppercase tracking-widest text-slate-700 hover:text-[#4a7c59] transition-all flex items-center gap-2"
                >
                  <Map className="w-4 h-4" />
                  {mapStyle === 'standard' ? 'Satellite View' : 'Standard View'}
                </button>
              </div>

              {isPickingLocation && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center gap-4 animate-enter">
                  <div className="bg-white/90 backdrop-blur-md text-slate-800 px-6 py-3 rounded-2xl shadow-xl border border-white text-sm font-bold flex items-center gap-3">
                    <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
                    {newLocation.lat ? 'Location selected. You can drag or click again.' : 'Tap anywhere on the map to place the hub.'}
                  </div>
                  {newLocation.lat && (
                    <button
                      onClick={() => {
                        setIsPickingLocation(false);
                        setIsAddingLocationDetails(true);
                      }}
                      className="px-8 py-4 bg-blue-600 text-white font-black rounded-2xl shadow-lg shadow-blue-500/30 hover:bg-blue-700 transition-all uppercase tracking-widest text-sm flex items-center gap-2 hover:-translate-y-1"
                    >
                      <MapPin className="w-5 h-5" /> Confirm Location
                    </button>
                  )}
                </div>
              )}
              {isPickingLocation && (
                 <button
                  onClick={() => setIsPickingLocation(false)}
                  className="absolute top-6 right-6 z-[1000] w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center text-slate-400 hover:bg-slate-50 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        </div>
      );
    } else if (activeTab === 'Settings') {
      return <AccountSettings key={userId} client={supabase} user={accountUser} permission={accountPermission} onUpdated={retryAuth} verifyCurrentPassword={verifyCurrentPassword} />;
    } else if (activeTab === 'Help & Support') {
      return (
        <div className="p-8 flex-1 overflow-y-auto">
          <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-slate-100 max-w-2xl">
            <h3 className="text-2xl font-bold text-slate-800 mb-2">Contact Support</h3>
            <p className="text-sm text-slate-400 font-medium mb-10">Need more help? Our support team is ready to assist you.</p>

            <div className="space-y-8 mb-10">
              <div className="flex items-center gap-6">
                <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
                  <Bell className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-bold text-slate-800">Email Support</p>
                  <p className="text-emerald-600 font-bold">shamelsolmia@gmail.com</p>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
                  <MapPin className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-bold text-slate-800">Phone Support</p>
                  <p className="text-emerald-600 font-bold">09123456789</p>
                  <p className="text-xs text-slate-400 font-medium">Mon - Fri, 8:00 AM - 5:00 PM</p>
                </div>
              </div>
            </div>

            <button className="w-full py-4 rounded-2xl border-2 border-emerald-500 text-emerald-600 font-bold text-sm hover:bg-emerald-50 transition-all flex items-center justify-center gap-2">
              <Eye className="w-4 h-4" /> Send us a Message
            </button>
          </div>
        </div>
      );
    }
  };

  return (
    <div className="flex h-dvh w-full bg-[#eef2ea] text-gray-800 overflow-hidden relative" style={{fontFamily:"'Outfit',system-ui,sans-serif"}}>
      {/* Background Mesh Gradient */}
      <div className="absolute inset-0 z-0 opacity-40 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-emerald-200 blur-[100px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-blue-100 blur-[120px]"></div>
      </div>

      {/* Sidebar */}
      <aside className="w-64 shrink-0 min-h-0 h-full bg-white/60 backdrop-blur-2xl border-r border-white/50 flex flex-col z-10 shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
        <div className="p-5 shrink-0 flex items-center gap-2.5 mb-2">
          <div className="w-8 h-8 bg-[#4a7c59] rounded-lg flex items-center justify-center">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-bold text-gray-800 tracking-tight">SafeWatch</span>
        </div>

        <div className="px-5 mb-3 shrink-0">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Main</p>
        </div>

        <nav aria-label="Main navigation" className="flex-1 min-h-0 overflow-y-auto space-y-0.5 pb-2">
          <SidebarItem icon={LayoutDashboard} label="Dashboard" onClick={() => setActiveTab('Dashboard')} active={activeTab === 'Dashboard'} />
          <SidebarItem icon={Users} label="Senior Monitoring" onClick={() => setActiveTab('Senior Monitoring')} active={activeTab === 'Senior Monitoring'} />
          <SidebarItem icon={MapPin} label="Live Location" onClick={() => setActiveTab('Live Location')} active={activeTab === 'Live Location'} />
          <SidebarItem icon={HeartPulse} label="Health Overview" onClick={() => setActiveTab('Health Overview')} active={activeTab === 'Health Overview'} />
          <SidebarItem icon={Shield} label="Geofence Zones" onClick={() => setActiveTab('Geofence Zones')} active={activeTab === 'Geofence Zones'} />
          <SidebarItem icon={Settings} label="Settings" onClick={() => setActiveTab('Settings')} active={activeTab === 'Settings'} />
        </nav>

        <div className="border-t border-[#e2e8d8] shrink-0 space-y-0.5 py-2">
          <SidebarItem icon={Bell} label="Alerts" onClick={() => setActiveTab('SOS Alerts')} active={activeTab === 'SOS Alerts'} badge={sosAlerts.length ? sosAlerts.length : null} />
          <SidebarItem icon={HelpCircle} label="Help & Support" onClick={() => setActiveTab('Help & Support')} active={activeTab === 'Help & Support'} />
          <button type="button" onClick={handleLogout} disabled={signingOut} className="sidebar-item text-red-600 hover:text-red-700 hover:bg-red-50 disabled:opacity-60">
            <div className="flex items-center gap-3">
              <LogOut className="w-[18px] h-[18px]" />
              <span>{signingOut ? 'Logging out…' : 'Logout'}</span>
            </div>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 h-full flex flex-col overflow-hidden z-10 relative">
        {/* Top Bar */}
        <header className="px-8 py-5 flex justify-between items-center gap-4 bg-white/40 backdrop-blur-xl border-b border-white/50 shrink-0 z-20">
          <div className="relative flex-1 max-w-lg">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Search seniors, alerts, or zones..." className="input-field !pl-10 !py-2.5 !rounded-xl !bg-[#f7f9f4]" />
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <button aria-label={`Alerts: ${sosAlerts.length}`} onClick={() => setActiveTab('SOS Alerts')} className="w-9 h-9 rounded-xl bg-[#f7f9f4] border border-[#e2e8d8] flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors relative">
              <Bell className="w-4 h-4" />
              {sosAlerts.length > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[8px] text-white font-bold flex items-center justify-center">{sosAlerts.length}</span>}
            </button>
            <button type="button" aria-label="Help & Support" onClick={() => setActiveTab('Help & Support')} className="w-9 h-9 rounded-xl bg-[#f7f9f4] border border-[#e2e8d8] flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors">
              <HelpCircle className="w-4 h-4" />
            </button>
            <div className="relative" ref={accountMenuRef}>
              <button type="button" ref={accountButtonRef} aria-label={`Account: ${accountName}`} aria-expanded={accountMenuOpen} aria-controls="account-menu" onClick={() => setAccountMenuOpen(open => !open)} className="w-10 h-10 rounded-full bg-[#4a7c59] border-2 border-white shadow-sm text-white text-sm font-semibold hover:bg-[#3d6a4a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a7c59]">
                {accountInitials}
              </button>
              {accountMenuOpen && (
                <div id="account-menu" role="region" aria-label="Account menu" className="absolute right-0 top-full mt-3 w-64 rounded-2xl border border-[#e2e8d8] bg-white shadow-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-[#e2e8d8]">
                    <p className="font-semibold text-sm break-words">{accountName}</p>
                    <p className="text-xs text-gray-500 break-all">{profile.email}</p>
                  </div>
                  <button type="button" onClick={() => { setActiveTab('Settings'); setAccountMenuOpen(false); }} className="flex items-center gap-3 w-full px-4 py-3 text-sm text-left hover:bg-[#f7f9f4]">
                    <Settings className="w-4 h-4" /> Account settings
                  </button>
                  <button type="button" onClick={handleLogout} disabled={signingOut} className="flex items-center gap-3 w-full px-4 py-3 text-sm text-left text-red-600 hover:bg-red-50 disabled:opacity-60">
                    <LogOut className="w-4 h-4" /> {signingOut ? 'Logging out…' : 'Logout'}
                  </button>
                </div>
              )}
            </div>
            <button onClick={() => setIsAddingSenior(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Senior
            </button>
          </div>
        </header>
        {logoutError && <p role="alert" className="px-8 py-3 bg-red-50 text-red-700 text-sm">{logoutError}</p>}
        <div className="flex-1 overflow-y-auto flex flex-col">
          {renderContent()}
        </div>
      </main>


      {/* Register Senior Modal */}
      {isAddingSenior && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center p-8 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-2xl rounded-[3rem] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
            <div className="p-10 border-b border-slate-50 flex justify-between items-center bg-[#4a7c59] text-white">
              <div>
                <h3 className="text-2xl font-bold tracking-tight">Register New Senior</h3>
                <p className="text-emerald-100 text-xs font-bold mt-1 uppercase tracking-widest">Complete the profile to start monitoring.</p>
              </div>
              <button onClick={() => setIsAddingSenior(false)} className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-all">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-10 grid grid-cols-2 gap-8 overflow-y-auto">
              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Full Name</label>
                <input
                  type="text"
                  placeholder="e.g. Juan Dela Cruz"
                  value={registerName}
                  onChange={(e) => setRegisterName(e.target.value)}
                  className="w-full px-6 py-4 bg-slate-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-emerald-500/20 font-bold"
                />
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center ml-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Device / Watch ID</label>
                  <span className="text-[9px] font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded">Check Watch Settings</span>
                </div>
                <input
                  type="text"
                  placeholder="e.g. 00000000-0000-0000-0000-a0f262e10c94"
                  value={registerDeviceId}
                  onChange={(e) => setRegisterDeviceId(e.target.value)}
                  className="w-full px-6 py-4 bg-slate-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-emerald-500/20 font-bold text-xs"
                />
                <p className="text-[9px] text-gray-400 font-bold ml-1 leading-tight">Find this ID on your smartwatch screen: Swipe to settings grid, tap the purple "SYSTEM" icon, and copy the "Watch ID" listed there.</p>
              </div>
              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Age</label>
                <input
                  type="number"
                  placeholder="70"
                  value={registerAge}
                  onChange={(e) => setRegisterAge(parseInt(e.target.value))}
                  className="w-full px-6 py-4 bg-slate-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-emerald-500/20 font-bold"
                />
              </div>
              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Gender</label>
                <select
                  value={registerGender}
                  onChange={(e) => setRegisterGender(e.target.value)}
                  className="w-full px-6 py-4 bg-slate-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-emerald-500/20 font-bold text-slate-600"
                >
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>
              <div className="col-span-2 space-y-4 pt-4">
                <button
                  onClick={handleRegisterSenior}
                  className="w-full py-5 bg-[#4a7c59] text-white font-bold rounded-2xl shadow-lg hover:bg-[#3d6a4a] transition-all text-sm"
                >
                  Confirm Registration
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Safe Hub Modal Details - Now as a Floating Panel */}
      {isAddingLocationDetails && (
        <div className="fixed inset-0 z-[5000] pointer-events-none flex items-start justify-end p-8">
          <div className="bg-white/95 backdrop-blur-xl w-full max-w-sm rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.15)] overflow-hidden flex flex-col animate-in slide-in-from-right duration-500 pointer-events-auto border border-white mt-20 mr-4">
            <div className="p-7 border-b border-slate-50 flex justify-between items-center bg-blue-600 text-white relative overflow-hidden">
              <div className="absolute right-0 top-0 opacity-10">
                <Map className="w-24 h-24 -mt-2 -mr-2" />
              </div>
              <div className="relative z-10">
                <h3 className="text-lg font-bold tracking-tight">Name Your Safe Hub</h3>
                <p className="text-blue-100 text-[9px] font-bold mt-0.5 uppercase tracking-widest">Finalize safe zone details.</p>
              </div>
              <button onClick={() => setIsAddingLocationDetails(false)} className="w-9 h-9 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-all relative z-10">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-7 space-y-6">
              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Location Name</label>
                <input
                  type="text"
                  placeholder="e.g. Relative's House"
                  value={newLocation.name}
                  onChange={(e) => setNewLocation({ ...newLocation, name: e.target.value })}
                  className="w-full px-5 py-3.5 bg-slate-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-blue-500/20 font-bold text-sm"
                />
              </div>

              <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100 flex items-center gap-3">
                 <div className="w-10 h-10 bg-white text-blue-500 rounded-xl flex items-center justify-center shadow-sm shrink-0">
                    <MapPin className="w-4 h-4" />
                 </div>
                 <div className="min-w-0">
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest truncate">Coordinates</p>
                    <p className="font-bold text-slate-800 text-[11px] mt-0.5 truncate">{newLocation.lat}, {newLocation.lng}</p>
                 </div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center px-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Safe Radius: <span className="text-blue-600">{newLocation.radius}m</span></label>
                  <span className="text-[9px] font-bold text-slate-400 uppercase">Coverage</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="200"
                  step="5"
                  value={newLocation.radius}
                  onChange={(e) => setNewLocation({ ...newLocation, radius: parseInt(e.target.value) })}
                  className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <div className="flex justify-between text-[7px] font-bold text-slate-300 uppercase px-1">
                  <span>10m</span>
                  <span>100m</span>
                  <span>200m</span>
                </div>
              </div>

              <button
                onClick={handleSaveLocation}
                className="w-full py-4 bg-blue-600 text-white font-black rounded-2xl shadow-lg shadow-blue-500/20 hover:bg-blue-700 transition-all uppercase tracking-widest text-xs flex items-center justify-center gap-2 mt-2"
              >
                <Plus className="w-3 h-3" /> Save Trusted Place
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alert Details Modal */}
      {selectedAlert && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-100">
            {/* Header */}
            <div className={`p-6 text-white ${
              selectedAlert.rawType === 'SOS' ? 'bg-red-500' : 'bg-orange-500'
            }`}>
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md">
                    {selectedAlert.rawType === 'SOS' ? <ShieldAlert className="w-6 h-6" /> : <MapPin className="w-6 h-6" />}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">{selectedAlert.rawType === 'SOS' ? 'SOS Alert' : 'Geofence Breach'}</h2>
                    <p className="text-white/80 text-sm">{selectedAlert.fullTime}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedAlert(null)} className="text-white/80 hover:text-white hover:bg-white/20 p-2 rounded-xl transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Senior Details</p>
                <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl">
                  <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${selectedAlert.seniorName}`} className="w-12 h-12 rounded-full bg-white shadow-sm border border-slate-200" alt={selectedAlert.seniorName} />
                  <div>
                    <p className="font-bold text-slate-800 text-lg">{selectedAlert.seniorName}</p>
                    <p className="text-xs font-medium text-slate-500">Watch ID: {selectedAlert.deviceId}</p>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Alert Description</p>
                <p className="text-sm font-medium text-slate-700 bg-slate-50 p-4 rounded-2xl">
                  {selectedAlert.rawType === 'SOS'
                    ? `An SOS alert was triggered manually by ${selectedAlert.seniorName} from their SafeWatch device. Immediate assistance may be required.`
                    : `${selectedAlert.seniorName} has moved outside the designated San Isidro East safe zone boundary.`
                  }
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setSelectedAlert(null)}
                  className="flex-1 py-3.5 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-colors text-sm"
                >
                  Close
                </button>
                <button
                  data-confirm-alert disabled={confirmingAlerts}
                  onClick={() => handleDismissAlertDB(selectedAlert)}
                  className={`flex-1 py-3.5 text-white font-bold rounded-2xl transition-colors shadow-lg text-sm ${
                    selectedAlert.rawType === 'SOS' ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20' : 'bg-orange-500 hover:bg-orange-600 shadow-orange-500/20'
                  }`}
                >
                  Acknowledge & Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
