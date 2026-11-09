import React, { useState, useEffect } from 'react';
import {
  Shield,
  Key,
  Users,
  CheckCircle,
  XCircle,
  Calendar,
  Search,
  Filter,
  Download,
  Trash2,
  X,
  RefreshCw,
  Sparkles,
  Phone,
  Mail,
  Clock,
  ArrowUpDown,
} from 'lucide-react';
import { weddingConfig } from '../config/weddingConfig';
import { fetchRsvpsFromSupabase, calculateStatsFromRsvps, deleteRsvpFromSupabase } from '../utils/rsvpService';

export function AdminDashboard({ isOpen, onClose }) {
  const { events } = weddingConfig;

  const [passcode, setPasscode] = useState(() => {
    try {
      return localStorage.getItem('wedding_admin_passcode') || '';
    } catch {
      return '';
    }
  });
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    try {
      return Boolean(localStorage.getItem('wedding_admin_passcode'));
    } catch {
      return false;
    }
  });
  const [authError, setAuthError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  // Data states with immediate localStorage cached fallback
  const [stats, setStats] = useState(() => {
    try {
      const cached = localStorage.getItem('wedding_cached_stats');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [rsvps, setRsvps] = useState(() => {
    try {
      const cached = localStorage.getItem('wedding_cached_rsvps');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [isLoadingData, setIsLoadingData] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [eventFilter, setEventFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');

  // Sync any offline submissions that were stored with _pendingSync
  const syncPendingSubmissions = async () => {
    try {
      const clientSaved = JSON.parse(localStorage.getItem('wedding_client_rsvps') || '[]');
      const pending = clientSaved.filter((r) => r && r._pendingSync);
      if (pending.length === 0) return;

      let hasChanges = false;
      for (const item of pending) {
        try {
          const res = await fetch('/api/rsvp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item),
          });
          const result = await res.json();
          if (res.ok && result.success) {
            item._pendingSync = false;
            if (result.data?.id) item.id = result.data.id;
            hasChanges = true;
          }
        } catch (e) {}
      }

      if (hasChanges) {
        localStorage.setItem('wedding_client_rsvps', JSON.stringify(clientSaved));
      }
    } catch (e) {}
  };

  // Load stats and RSVPs once authenticated
  const loadDashboardData = async (activePasscode) => {
    const code =
      activePasscode ||
      passcode ||
      (typeof localStorage !== 'undefined' ? localStorage.getItem('wedding_admin_passcode') : '') ||
      '';
    if (!code) return;

    // First ensure any pending offline submissions are synced to backend
    await syncPendingSubmissions();

    setIsLoadingData(true);
    try {
      let statsLoaded = false;
      // 1. Attempt to fetch stats from backend API
      try {
        const statsRes = await fetch('/api/admin/stats', {
          headers: { 'x-admin-passcode': code },
        });
        if (statsRes.status === 401) {
          setIsAuthenticated(false);
          setAuthError('Session expired. Please enter the administrator passcode again.');
          return;
        }
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          if (statsData.success && statsData.data) {
            setStats(statsData.data);
            statsLoaded = true;
            try {
              localStorage.setItem('wedding_cached_stats', JSON.stringify(statsData.data));
            } catch (e) {}
          }
        }
      } catch (e) {
        // Backend unavailable
      }

      // 2. Fetch RSVPs from backend API or Supabase Cloud
      let rawList = [];
      let fetchedSuccessfully = false;

      try {
        const params = new URLSearchParams({
          search: searchQuery,
          status: statusFilter,
          event: eventFilter,
          sort: sortOrder,
        });

        const rsvpsRes = await fetch(`/api/admin/rsvps?${params.toString()}`, {
          headers: { 'x-admin-passcode': code },
        });
        if (rsvpsRes.status === 401) {
          setIsAuthenticated(false);
          setAuthError('Session expired. Please enter the administrator passcode again.');
          return;
        }
        if (rsvpsRes.ok) {
          const rsvpsData = await rsvpsRes.json();
          if (rsvpsData.success && Array.isArray(rsvpsData.data) && rsvpsData.data.length > 0) {
            rawList = rsvpsData.data;
            fetchedSuccessfully = true;
          }
        }
      } catch (e) {
        // Backend unavailable
      }

      // If backend API did not return data, connect directly to Supabase Cloud
      if (!fetchedSuccessfully) {
        const cloudResult = await fetchRsvpsFromSupabase();
        if (cloudResult.success && Array.isArray(cloudResult.data) && cloudResult.data.length > 0) {
          rawList = cloudResult.data;
          fetchedSuccessfully = true;

          // Compute stats directly from cloud data if backend stats weren't loaded
          if (!statsLoaded) {
            const calculatedStats = calculateStatsFromRsvps(rawList);
            setStats(calculatedStats);
            try {
              localStorage.setItem('wedding_cached_stats', JSON.stringify(calculatedStats));
            } catch (e) {}
            statsLoaded = true;
          }

          // Apply search, event, status and sort filters to cloud data
          if (statusFilter !== 'all') {
            rawList = rawList.filter((r) => r.attendance_status === statusFilter);
          }
          if (eventFilter !== 'all') {
            rawList = rawList.filter((r) => {
              if (!Array.isArray(r.selected_events)) return false;
              if (eventFilter === 'wedding' || eventFilter === 'wedding_ceremony') {
                return r.selected_events.includes('wedding') || r.selected_events.includes('wedding_ceremony');
              }
              return r.selected_events.includes(eventFilter);
            });
          }
          if (searchQuery && searchQuery.trim() !== '') {
            const q = searchQuery.trim().toLowerCase();
            rawList = rawList.filter((r) => {
              const nameMatch = (r.guest_name || '').toLowerCase().includes(q);
              const emailMatch = (r.guest_email || '').toLowerCase().includes(q);
              const phoneMatch = (r.phone_number || '').toLowerCase().includes(q);
              const addMatch = (r.additional_guests || '').toLowerCase().includes(q);
              return nameMatch || emailMatch || phoneMatch || addMatch;
            });
          }
          if (sortOrder === 'name') {
            rawList.sort((a, b) => (a.guest_name || '').localeCompare(b.guest_name || ''));
          } else if (sortOrder === 'attendees') {
            rawList.sort((a, b) => (b.attendees_count || 0) - (a.attendees_count || 0));
          } else if (sortOrder === 'oldest') {
            rawList.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
          } else {
            rawList.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
          }
        }
      }

      if (fetchedSuccessfully || rawList.length > 0) {
        let mergedList = [...rawList];
        try {
          const deletedIds = new Set(
            JSON.parse(localStorage.getItem('wedding_deleted_ids') || '[]')
          );
          // Never display deleted entries
          mergedList = mergedList.filter((r) => r && r.id && !deletedIds.has(r.id));

          const clientSaved = JSON.parse(localStorage.getItem('wedding_client_rsvps') || '[]');
          if (Array.isArray(clientSaved) && clientSaved.length > 0) {
            const existingIds = new Set(
              mergedList.map((r) => r.id).filter(Boolean)
            );
            for (const clientRsvp of clientSaved) {
              if (!clientRsvp || !clientRsvp.id || deletedIds.has(clientRsvp.id)) {
                continue;
              }
              if (!existingIds.has(clientRsvp.id)) {
                // Apply active filters so client cache doesn't contaminate filter results
                if (statusFilter !== 'all' && clientRsvp.attendance_status !== statusFilter) {
                  continue;
                }
                if (eventFilter !== 'all') {
                  const evs = Array.isArray(clientRsvp.selected_events) ? clientRsvp.selected_events : [];
                  if (!evs.includes(eventFilter)) {
                    continue;
                  }
                }
                if (searchQuery && searchQuery.trim() !== '') {
                  const q = searchQuery.trim().toLowerCase();
                  const nameMatch = (clientRsvp.guest_name || '').toLowerCase().includes(q);
                  const emailMatch = (clientRsvp.guest_email || '').toLowerCase().includes(q);
                  const phoneMatch = (clientRsvp.phone_number || '').toLowerCase().includes(q);
                  const addMatch = (clientRsvp.additional_guests || '').toLowerCase().includes(q);
                  if (!nameMatch && !emailMatch && !phoneMatch && !addMatch) {
                    continue;
                  }
                }
                mergedList.unshift(clientRsvp);
                existingIds.add(clientRsvp.id);
              }
            }
          }
        } catch (e) {}

        setRsvps(mergedList);
        try {
          localStorage.setItem('wedding_cached_rsvps', JSON.stringify(mergedList));
        } catch (e) {}
      }
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setIsLoadingData(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    setIsVerifying(true);

    try {
      let isVerified = false;
      try {
        const res = await fetch('/api/admin/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passcode }),
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          isVerified = true;
        } else if (res.status === 401) {
          setAuthError(data.error || 'Invalid passcode. Access denied.');
          setIsVerifying(false);
          return;
        }
      } catch (networkErr) {
        // Fallback: verify against configured admin passcode when backend API is offline
        const expectedCode = import.meta.env.VITE_ADMIN_PASSCODE || 'yashmrudula2026';
        if (passcode.trim() === expectedCode) {
          isVerified = true;
        }
      }

      if (isVerified) {
        try {
          localStorage.setItem('wedding_admin_passcode', passcode);
        } catch (e) {}
        setIsAuthenticated(true);
        loadDashboardData(passcode);
      } else {
        setAuthError('Invalid passcode. Access denied.');
      }
    } catch (err) {
      setAuthError('Connection error. Could not verify passcode.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem('wedding_admin_passcode');
    } catch (e) {}
    setIsAuthenticated(false);
    setPasscode('');
  };

  // 1. Initial load on mount, modal opening, or filter change
  useEffect(() => {
    const savedPasscode =
      typeof localStorage !== 'undefined' ? localStorage.getItem('wedding_admin_passcode') : null;
    if (savedPasscode && isOpen) {
      loadDashboardData(savedPasscode);
    }
  }, [isOpen, searchQuery, statusFilter, eventFilter, sortOrder]);

  // 2. Real-time instant sync via CustomEvent, BroadcastChannel, storage events & polling
  useEffect(() => {
    if (!isOpen || !isAuthenticated) return;

    const handleSync = () => {
      loadDashboardData();
    };

    window.addEventListener('wedding-rsvp-updated', handleSync);
    window.addEventListener('storage', handleSync);

    let channel;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel('wedding_rsvp_channel');
        channel.onmessage = (e) => {
          if (e.data?.type === 'RSVP_SUBMITTED') {
            loadDashboardData();
          }
        };
      }
    } catch (e) {}

    // Multi-device poll interval (syncs changes from other guests/devices every 5 seconds)
    const pollInterval = setInterval(() => {
      loadDashboardData();
    }, 5000);

    return () => {
      window.removeEventListener('wedding-rsvp-updated', handleSync);
      window.removeEventListener('storage', handleSync);
      if (channel) channel.close();
      clearInterval(pollInterval);
    };
  }, [isOpen, isAuthenticated, passcode, searchQuery, statusFilter, eventFilter, sortOrder]);

  const handleExportCsv = () => {
    const code =
      passcode ||
      (typeof localStorage !== 'undefined' ? localStorage.getItem('wedding_admin_passcode') : '') ||
      '';
    if (!rsvps || rsvps.length === 0) {
      window.location.href = `/api/admin/export?passcode=${encodeURIComponent(code)}`;
      return;
    }
    try {
      const headers = [
        'ID',
        'Guest Name',
        'Email',
        'Phone',
        'Attendance Status',
        'Attendees Count',
        'Additional Guests',
        'Selected Events',
        'Dietary Requirements',
        'Special Requests',
        'Created At',
      ];
      const rows = rsvps.map((r) => [
        `"${(r.id || '').replace(/"/g, '""')}"`,
        `"${(r.guest_name || '').replace(/"/g, '""')}"`,
        `"${(r.guest_email || '').replace(/"/g, '""')}"`,
        `"${(r.phone_number || '').replace(/"/g, '""')}"`,
        `"${(r.attendance_status || '').replace(/"/g, '""')}"`,
        r.attendees_count || 0,
        `"${(r.additional_guests || '').replace(/"/g, '""')}"`,
        `"${(Array.isArray(r.selected_events) ? r.selected_events.join(', ') : '').replace(/"/g, '""')}"`,
        `"${(r.dietary_requirements || '').replace(/"/g, '""')}"`,
        `"${(r.special_requests || '').replace(/"/g, '""')}"`,
        `"${(r.created_at || '').replace(/"/g, '""')}"`,
      ]);
      const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `wedding_rsvps_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      window.location.href = `/api/admin/export?passcode=${encodeURIComponent(code)}`;
    }
  };

  const handleDeleteRsvp = async (id, name) => {
    if (!window.confirm(`Are you sure you want to remove the RSVP response for "${name}"?`)) {
      return;
    }

    try {
      const code =
        passcode ||
        (typeof localStorage !== 'undefined' ? localStorage.getItem('wedding_admin_passcode') : '') ||
        '';

      let deleteSuccess = false;
      try {
        const res = await fetch(`/api/admin/rsvps/${id}`, {
          method: 'DELETE',
          headers: { 'x-admin-passcode': code },
        });

        if (res.ok) {
          deleteSuccess = true;
        }
      } catch (e) {
        // Fallback directly to Supabase Cloud
        const cloudDelete = await deleteRsvpFromSupabase(id);
        if (cloudDelete.success) deleteSuccess = true;
      }

      if (deleteSuccess) {
        // Record deleted ID in tombstone list so it never resurrects from client cache
        try {
          const deletedIds = JSON.parse(localStorage.getItem('wedding_deleted_ids') || '[]');
          if (!deletedIds.includes(id)) {
            deletedIds.push(id);
            localStorage.setItem('wedding_deleted_ids', JSON.stringify(deletedIds.slice(-200)));
          }

          const clientSaved = JSON.parse(localStorage.getItem('wedding_client_rsvps') || '[]');
          const updatedClient = clientSaved.filter((r) => r.id !== id);
          localStorage.setItem('wedding_client_rsvps', JSON.stringify(updatedClient));

          const cachedList = JSON.parse(localStorage.getItem('wedding_cached_rsvps') || '[]');
          const updatedCached = cachedList.filter((r) => r.id !== id);
          localStorage.setItem('wedding_cached_rsvps', JSON.stringify(updatedCached));
        } catch (e) {}

        // Optimistically update local view
        setRsvps((prev) => prev.filter((r) => r.id !== id));

        // Re-fetch fresh stats & verified dataset
        loadDashboardData(code);
      } else {
        alert('Failed to delete RSVP record.');
      }
    } catch (err) {
      alert('Failed to delete RSVP record.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-stone-950/80 backdrop-blur-md animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-6xl max-h-[92vh] flex flex-col bg-cream-light rounded-3xl border-2 border-gold-rich shadow-2xl overflow-hidden my-auto">
        {/* Top Header Bar */}
        <div className="bg-maroon-royal text-ivory-50 px-6 py-4 flex items-center justify-between border-b border-gold-rich/40">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-maroon-800 text-gold-champagne border border-gold-rich/30">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-serif text-xl sm:text-2xl font-bold tracking-wide">
                Couple's RSVP Administration
              </h2>
              <span className="text-[11px] text-gold-champagne tracking-wider uppercase block">
                Yaswanth &amp; Mrudula • Private Guest Portal
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {isAuthenticated && (
              <button
                onClick={handleLogout}
                className="px-3 py-1.5 text-xs text-stone-200 hover:text-white rounded-lg border border-gold-rich/40 hover:bg-maroon-800 transition-colors uppercase tracking-wider font-semibold cursor-pointer"
              >
                Log Out
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-stone-300 hover:text-white rounded-full hover:bg-maroon-800 transition-colors cursor-pointer"
              aria-label="Close Admin Modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-8">
          {!isAuthenticated ? (
            /* Passcode Login Screen */
            <div className="max-w-md mx-auto my-12 text-center">
              <div className="w-16 h-16 rounded-full bg-gold-100 border border-gold-rich flex items-center justify-center mx-auto mb-6 text-maroon-royal shadow-sm">
                <Key className="w-8 h-8 text-gold-deep" />
              </div>

              <h3 className="font-serif text-3xl font-bold text-maroon-royal mb-2">
                Private Portal Access
              </h3>
              <p className="text-stone-600 text-sm mb-6 font-light">
                Please enter the wedding administrative passkey to access guest responses and analytics.
              </p>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <input
                    type="password"
                    required
                    placeholder="Enter admin passcode"
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gold-300 bg-white focus:outline-none focus:border-gold-rich focus:ring-2 focus:ring-gold-200 text-center text-lg font-mono tracking-widest"
                  />
                  {authError && (
                    <p className="text-xs text-red-600 mt-2 font-medium">
                      {authError}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isVerifying}
                  className="w-full py-3.5 rounded-xl bg-maroon-royal hover:bg-maroon-800 text-ivory-50 text-xs font-bold uppercase tracking-widest transition-all shadow-md"
                >
                  {isVerifying ? 'Authenticating...' : 'Unlock Guestbook'}
                </button>
              </form>
            </div>
          ) : (
            /* Authenticated Admin Dashboard */
            <div className="space-y-8">
              {/* Analytics Summary Cards */}
              {stats && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-serif text-2xl font-bold text-maroon-royal">
                      RSVP Metrics Overview
                    </h3>
                    <button
                      onClick={() => loadDashboardData()}
                      className="inline-flex items-center space-x-1.5 text-xs text-stone-600 hover:text-maroon-royal px-3 py-1.5 rounded-lg border border-gold-200 hover:bg-gold-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingData ? 'animate-spin' : ''}`} />
                      <span>Refresh</span>
                    </button>
                  </div>

                  {/* 4 Key KPI Cards */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Total Submissions */}
                    <div className="p-4 sm:p-5 rounded-2xl bg-white border border-gold-200 shadow-sm">
                      <div className="flex items-center justify-between text-stone-500 mb-2">
                        <span className="text-xs uppercase tracking-wider font-semibold">Total Responses</span>
                        <Users className="w-4 h-4 text-gold-deep" />
                      </div>
                      <div className="font-serif text-3xl sm:text-4xl font-bold text-maroon-royal">
                        {stats.totalSubmissions}
                      </div>
                      <span className="text-[11px] text-stone-500">Total submitted parties</span>
                    </div>

                    {/* Total Expected Attendees */}
                    <div className="p-4 sm:p-5 rounded-2xl bg-white border border-emerald-300 shadow-sm">
                      <div className="flex items-center justify-between text-emerald-800 mb-2">
                        <span className="text-xs uppercase tracking-wider font-semibold">Expected Guests</span>
                        <Users className="w-4 h-4 text-emerald-600" />
                      </div>
                      <div className="font-serif text-3xl sm:text-4xl font-bold text-emerald-900">
                        {stats.totalExpectedAttendees}
                      </div>
                      <span className="text-[11px] text-stone-500">Total individuals attending</span>
                    </div>

                    {/* Accepting Responses */}
                    <div className="p-4 sm:p-5 rounded-2xl bg-white border border-gold-200 shadow-sm">
                      <div className="flex items-center justify-between text-stone-500 mb-2">
                        <span className="text-xs uppercase tracking-wider font-semibold">Acceptances</span>
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                      </div>
                      <div className="font-serif text-3xl sm:text-4xl font-bold text-emerald-800">
                        {stats.attendingSubmissions}
                      </div>
                      <span className="text-[11px] text-stone-500">Parties joyfully attending</span>
                    </div>

                    {/* Declining Responses */}
                    <div className="p-4 sm:p-5 rounded-2xl bg-white border border-gold-200 shadow-sm">
                      <div className="flex items-center justify-between text-stone-500 mb-2">
                        <span className="text-xs uppercase tracking-wider font-semibold">Declines</span>
                        <XCircle className="w-4 h-4 text-stone-400" />
                      </div>
                      <div className="font-serif text-3xl sm:text-4xl font-bold text-stone-600">
                        {stats.declinedSubmissions}
                      </div>
                      <span className="text-[11px] text-stone-500">Parties unable to join</span>
                    </div>
                  </div>

                  {/* Attendance per Event Cards */}
                  <div className="mt-6 p-5 rounded-2xl bg-gold-50/70 border border-gold-200">
                    <h4 className="text-xs uppercase tracking-widest text-maroon-royal font-bold mb-3">
                      Expected Attendance by Celebration Event:
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {events.map((ev) => (
                        <div key={ev.id} className="p-3 bg-white rounded-xl border border-gold-200/80 text-center">
                          <span className="text-xs font-serif font-bold text-stone-800 line-clamp-1 block mb-1">
                            {ev.title}
                          </span>
                          <span className="font-serif text-2xl font-bold text-maroon-royal block">
                            {stats.eventCounts[ev.id] || 0}
                          </span>
                          <span className="text-[10px] text-stone-500">Guests</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Controls: Search, Filters, Export to CSV */}
              <div className="pt-4 border-t border-gold-200">
                <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 mb-6">
                  {/* Search box */}
                  <div className="relative flex-1 max-w-md">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-400">
                      <Search className="w-4 h-4" />
                    </div>
                    <input
                      type="text"
                      placeholder="Search by name, email, or phone..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gold-200 bg-white text-sm focus:outline-none focus:border-gold-rich focus:ring-1 focus:ring-gold-200"
                    />
                  </div>

                  {/* Filter Selects */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Status filter */}
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="px-3 py-2.5 rounded-xl border border-gold-200 bg-white text-xs font-medium text-stone-700 focus:outline-none"
                    >
                      <option value="all">All Responses</option>
                      <option value="attending">Attending Only</option>
                      <option value="declined">Declined Only</option>
                    </select>

                    {/* Event filter */}
                    <select
                      value={eventFilter}
                      onChange={(e) => setEventFilter(e.target.value)}
                      className="px-3 py-2.5 rounded-xl border border-gold-200 bg-white text-xs font-medium text-stone-700 focus:outline-none"
                    >
                      <option value="all">All Events</option>
                      {events.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.title}
                        </option>
                      ))}
                    </select>

                    {/* Export to CSV Button */}
                    <button
                      onClick={handleExportCsv}
                      className="inline-flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold uppercase tracking-wider transition-colors shadow-sm"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export CSV</span>
                    </button>
                  </div>
                </div>

                {/* Guest List Table */}
                <div className="rounded-2xl border border-gold-200 bg-white overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gold-50 text-stone-700 border-b border-gold-200 uppercase tracking-wider font-semibold text-[11px]">
                        <tr>
                          <th className="px-4 py-3.5">Guest &amp; Contact</th>
                          <th className="px-4 py-3.5 text-center">Status</th>
                          <th className="px-4 py-3.5 text-center">Party Size</th>
                          <th className="px-4 py-3.5">Selected Events</th>
                          <th className="px-4 py-3.5">Dietary / Notes</th>
                          <th className="px-4 py-3.5">Submitted</th>
                          <th className="px-4 py-3.5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {rsvps.length === 0 ? (
                          <tr>
                            <td colSpan="7" className="px-6 py-12 text-center text-stone-500 font-light italic">
                              No RSVP records match the current filter.
                            </td>
                          </tr>
                        ) : (
                          rsvps.map((rsvp) => {
                            const isAttending = rsvp.attendance_status === 'attending';

                            return (
                              <tr key={rsvp.id} className="hover:bg-gold-50/40 transition-colors">
                                {/* Guest Name & Contact */}
                                <td className="px-4 py-4">
                                  <div className="font-semibold text-stone-900 text-sm">
                                    {rsvp.guest_name}
                                  </div>
                                  {rsvp.guest_email ? (
                                    <div className="text-stone-500 flex items-center space-x-1.5 mt-0.5">
                                      <Mail className="w-3 h-3 text-gold-deep" />
                                      <span>{rsvp.guest_email}</span>
                                    </div>
                                  ) : null}
                                  {rsvp.phone_number ? (
                                    <div className="text-stone-500 flex items-center space-x-1.5 mt-0.5">
                                      <Phone className="w-3 h-3 text-gold-deep" />
                                      <span>{rsvp.phone_number}</span>
                                    </div>
                                  ) : null}
                                  {!rsvp.guest_email && !rsvp.phone_number && (
                                    <div className="text-stone-400 italic text-[11px] mt-0.5">
                                      No contact provided
                                    </div>
                                  )}
                                  {rsvp.additional_guests && (
                                    <div className="text-[11px] text-maroon-800 italic mt-1">
                                      + {rsvp.additional_guests}
                                    </div>
                                  )}
                                </td>

                                {/* Attendance Status */}
                                <td className="px-4 py-4 text-center">
                                  <span
                                    className={`inline-block px-2.5 py-1 rounded-full text-[10px] uppercase font-bold tracking-wider ${
                                      isAttending
                                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                        : 'bg-stone-100 text-stone-600 border border-stone-300'
                                    }`}
                                  >
                                    {isAttending ? 'Attending' : 'Declined'}
                                  </span>
                                </td>

                                {/* Total Attendees */}
                                <td className="px-4 py-4 text-center">
                                  <span className="font-serif text-base font-bold text-stone-800">
                                    {rsvp.attendees_count}
                                  </span>
                                </td>

                                {/* Selected Events */}
                                <td className="px-4 py-4">
                                  {Array.isArray(rsvp.selected_events) && rsvp.selected_events.length > 0 ? (
                                    <div className="flex flex-wrap gap-1 max-w-xs">
                                      {rsvp.selected_events.map((evId) => {
                                        const found =
                                          events.find((e) => e.id === evId) ||
                                          (evId === 'wedding_ceremony'
                                            ? events.find((e) => e.id === 'wedding')
                                            : null) ||
                                          (evId === 'pelli_ceremony' || evId === 'pelli_rituals'
                                            ? events.find((e) => e.id === 'pelli_rituals')
                                            : null) ||
                                          (evId === 'haldi' || evId === 'haldi_pelli'
                                            ? events.find((e) => e.id === 'haldi')
                                            : null) ||
                                          (evId === 'mehendi' || evId === 'mehendi_sangeeth'
                                            ? events.find((e) => e.id === 'mehendi')
                                            : null) ||
                                          (evId === 'sangeeth'
                                            ? events.find((e) => e.id === 'sangeeth')
                                            : null);
                                        return (
                                          <span
                                            key={evId}
                                            className="px-2 py-0.5 rounded-md bg-gold-100/70 border border-gold-200 text-stone-800 text-[10px] font-medium"
                                          >
                                            {found ? found.title : evId}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <span className="text-stone-400 italic">—</span>
                                  )}
                                </td>

                                {/* Dietary / Special Notes */}
                                <td className="px-4 py-4 max-w-xs">
                                  {rsvp.dietary_requirements && (
                                    <div className="text-stone-800 font-medium mb-1">
                                      🍽️ {rsvp.dietary_requirements}
                                    </div>
                                  )}
                                  {rsvp.special_requests && (
                                    <div className="text-stone-600 italic line-clamp-2">
                                      “{rsvp.special_requests}”
                                    </div>
                                  )}
                                  {!rsvp.dietary_requirements && !rsvp.special_requests && (
                                    <span className="text-stone-400 italic">—</span>
                                  )}
                                </td>

                                {/* Submitted Date */}
                                <td className="px-4 py-4 text-stone-500 whitespace-nowrap">
                                  {new Date(rsvp.created_at).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </td>

                                {/* Actions */}
                                <td className="px-4 py-4 text-right">
                                  <button
                                    onClick={() => handleDeleteRsvp(rsvp.id, rsvp.guest_name)}
                                    className="p-1.5 text-stone-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                                    title="Delete RSVP"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
