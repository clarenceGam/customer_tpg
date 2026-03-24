import { useEffect, useMemo, useState } from 'react';
import { useView } from '../hooks/useView';
import { VIEWS } from '../contexts/ViewContext';
import { barService } from '../services/barService';
import { reservationService } from '../services/reservationService';
import { socialService } from '../services/socialService';
import { eventService } from '../services/eventService';
import { paymentService } from '../services/paymentService';
import { formatDate, formatTime } from '../utils/dateHelpers';
import { imageUrl } from '../utils/imageUrl';
import { Flame, MessageCircle, Utensils, Wine, Star, Phone, Mail, Globe, MapPin, CalendarDays, CreditCard, Smartphone, ShoppingCart, Heart } from 'lucide-react';

const MENU_PLACEHOLDER = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='220' viewBox='0 0 400 220'%3E%3Crect width='400' height='220' fill='%23161616'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='44' fill='%23333333'%3E%F0%9F%8D%BD%3C/text%3E%3C/svg%3E`;
const CART_PERSIST_HOURS = 24;
const CART_STORAGE_PREFIX = 'bar_detail_cart_state_';

const toBool = (v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') return ['1','true','yes'].includes(v.trim().toLowerCase());
  return false;
};

const dayHoursByIndex = [
  'sunday_hours',
  'monday_hours',
  'tuesday_hours',
  'wednesday_hours',
  'thursday_hours',
  'friday_hours',
  'saturday_hours',
];

const parseClockToMinutes = (token) => {
  if (!token) return null;
  const cleaned = String(token).trim().toLowerCase();
  const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hh = Number(match[1]);
  const mm = Number(match[2] || 0);
  const meridiem = match[3] ? match[3].toLowerCase() : null;
  if (mm < 0 || mm > 59) return null;

  if (meridiem) {
    if (hh < 1 || hh > 12) return null;
    if (meridiem === 'am' && hh === 12) hh = 0;
    if (meridiem === 'pm' && hh !== 12) hh += 12;
  }

  if (hh < 0 || hh > 23) return null;
  return hh * 60 + mm;
};

const buildHourlySlots = (hoursText, reservationDate) => {
  if (!hoursText) return [];
  const normalized = String(hoursText).replace(/\s+to\s+/gi, ' - ').trim();
  const range = normalized.match(/(.+?)\s*-\s*(.+)/);
  if (!range) return [];
  const start = parseClockToMinutes(range[1]);
  const end = parseClockToMinutes(range[2]);
  if (start === null || end === null) return [];

  const slots = [];
  const startHour = Math.ceil(start / 60);
  const endHour = Math.ceil(end / 60);

  if (end > start) {
    for (let h = startHour; h < endHour; h += 1) slots.push(`${String(h).padStart(2, '0')}:00:00`);
  } else {
    for (let h = startHour; h < 24; h += 1) slots.push(`${String(h).padStart(2, '0')}:00:00`);
    for (let h = 0; h < endHour; h += 1) slots.push(`${String(h).padStart(2, '0')}:00:00`);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  if (reservationDate === todayStr) {
    const nowHour = new Date().getHours();
    return slots.filter((slot) => Number(slot.slice(0, 2)) > nowHour);
  }

  return slots;
};

const formatHourLabel = (value) => {
  const hh = Number(String(value).slice(0, 2));
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const suffix = hh >= 12 ? 'PM' : 'AM';
  return `${h12}:00 ${suffix}`;
};

function BarDetailView() {
  const { viewParams, navigate, goBack, canGoBack } = useView();
  const barId = viewParams.barId;
  const cartStorageKey = useMemo(() => (barId ? `${CART_STORAGE_PREFIX}${barId}` : null), [barId]);

  const [bar, setBar] = useState(null);
  const [menuItems, setMenuItems] = useState([]);
  const [events, setEvents] = useState([]);
  const [reviewData, setReviewData] = useState(null);
  const [myReview, setMyReview] = useState(null);
  const [reviewEligibility, setReviewEligibility] = useState(false);
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [submittingRev, setSubmittingRev] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  // Review form
  const [revRating, setRevRating] = useState(5);
  const [revComment, setRevComment] = useState('');

  // Table availability
  const [resDate, setResDate] = useState('');
  const [resTime, setResTime] = useState('');
  const [partySize, setPartySize] = useState(2);
  const [availableTables, setAvailableTables] = useState([]);
  const [checkingTables, setCheckingTables] = useState(false);
  const [tableMsg, setTableMsg] = useState('');
  const [hasChecked, setHasChecked] = useState(false);

  // Cart
  const [cartItems, setCartItems] = useState([]);
  const [cartTable, setCartTable] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('gcash');
  const [activeTab, setActiveTab] = useState('overview');

  const acceptGcash = useMemo(() => bar ? (toBool(bar.accept_gcash) && toBool(bar.accept_online_payment)) : false, [bar]);
  const acceptOnline = useMemo(() => bar ? toBool(bar.accept_online_payment) : false, [bar]);

  const menuTotal = cartItems.reduce((sum, i) => sum + i.price * i.qty, 0);
  const tableTotal = cartTable ? Number(cartTable.price || 0) : 0;
  const grandTotal = menuTotal + tableTotal;

  const openingHours = useMemo(() => {
    if (!bar) return [];
    return [
      ['Monday', bar.monday_hours], ['Tuesday', bar.tuesday_hours], ['Wednesday', bar.wednesday_hours],
      ['Thursday', bar.thursday_hours], ['Friday', bar.friday_hours], ['Saturday', bar.saturday_hours], ['Sunday', bar.sunday_hours],
    ];
  }, [bar]);

  const availableHourOptions = useMemo(() => {
    if (!resDate || !bar) return [];
    const d = new Date(`${resDate}T00:00:00`);
    if (Number.isNaN(d.getTime())) return [];
    const col = dayHoursByIndex[d.getDay()];
    return buildHourlySlots(bar?.[col], resDate);
  }, [bar, resDate]);

  useEffect(() => {
    if (!resDate) return;
    if (!availableHourOptions.length) {
      if (resTime) setResTime('');
      return;
    }
    if (!availableHourOptions.includes(resTime)) {
      setResTime(availableHourOptions[0]);
      setCartTable(null);
      setHasChecked(false);
      setTableMsg('');
    }
  }, [availableHourOptions, resDate, resTime]);

  const reviews = reviewData?.reviews || [];

  useEffect(() => {
    if (!barId) return;
    loadAll();
  }, [barId]);

  useEffect(() => {
    if (!cartStorageKey) return;
    try {
      const raw = localStorage.getItem(cartStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const ts = new Date(parsed?.timestamp || 0).getTime();
      const expiry = ts + CART_PERSIST_HOURS * 60 * 60 * 1000;
      if (!ts || Date.now() > expiry) {
        localStorage.removeItem(cartStorageKey);
        return;
      }

      if (Array.isArray(parsed.cartItems)) setCartItems(parsed.cartItems);
      if (parsed.cartTable) setCartTable(parsed.cartTable);
      if (typeof parsed.resDate === 'string') setResDate(parsed.resDate);
      if (typeof parsed.resTime === 'string') setResTime(parsed.resTime);
      if (parsed.partySize !== undefined && parsed.partySize !== null) setPartySize(parsed.partySize);
      if (typeof parsed.paymentMethod === 'string') setPaymentMethod(parsed.paymentMethod);
    } catch (_) {
      localStorage.removeItem(cartStorageKey);
    }
  }, [cartStorageKey]);

  useEffect(() => {
    if (!cartStorageKey) return;
    const hasData = Boolean(cartItems.length || cartTable || resDate || resTime);
    if (!hasData) {
      localStorage.removeItem(cartStorageKey);
      return;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      cartItems,
      cartTable,
      resDate,
      resTime,
      partySize,
      paymentMethod,
    };
    localStorage.setItem(cartStorageKey, JSON.stringify(payload));
  }, [cartStorageKey, cartItems, cartTable, resDate, resTime, partySize, paymentMethod]);

  useEffect(() => {
    if (!bar) return;
    if (acceptGcash) setPaymentMethod('gcash');
    else if (acceptOnline) setPaymentMethod('paymaya');
  }, [bar, acceptGcash, acceptOnline]);

  const loadAll = async () => {
    try {
      setLoading(true); setErr('');
      const [detail, ev, rev, mine, elig, fol] = await Promise.all([
        barService.detail(barId), barService.events(barId),
        barService.reviews(barId), barService.myReview(barId), barService.reviewEligibility(barId),
        socialService.followStatus(barId),
      ]);
      let menu = [];
      try {
        menu = await barService.menuWithBestSellers(barId);
      } catch (_) {
        menu = await barService.menu(barId);
      }

      setBar(detail); setMenuItems(menu); setEvents(ev); setReviewData(rev);
      setMyReview(mine); setReviewEligibility(Boolean(elig?.eligible));
      setFollowing(Boolean(fol?.following));
      if (mine) { setRevRating(mine.rating || 5); setRevComment(mine.comment || ''); }
    } catch (e) {
      setErr(e?.response?.data?.message || 'Failed to load bar details.');
    } finally { setLoading(false); }
  };

  // ── Cart handlers ──
  const addToCart = (item) => {
    const price = Number(item.price ?? item.selling_price ?? 0);
    const name = item.name || item.menu_name || 'Item';
    setCartItems(prev => {
      const existing = prev.find(i => i.id === item.id);
      if (existing) return prev.map(i => i.id === item.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { id: item.id, name, price, qty: 1, image_path: item.image_path }];
    });
  };

  const removeFromCart = (itemId) => {
    setCartItems(prev => {
      const existing = prev.find(i => i.id === itemId);
      if (!existing || existing.qty <= 1) return prev.filter(i => i.id !== itemId);
      return prev.map(i => i.id === itemId ? { ...i, qty: i.qty - 1 } : i);
    });
  };

  const getItemQty = (itemId) => cartItems.find(i => i.id === itemId)?.qty || 0;

  // ── Table availability ──
  const handleCheckTables = async () => {
    if (!resDate || !resTime || !partySize) return;
    setCheckingTables(true); setTableMsg(''); setAvailableTables([]); setHasChecked(false); setCartTable(null);
    try {
      const avail = await barService.availableTables(barId, { date: resDate, time: resTime, party_size: Number(partySize) });
      setAvailableTables(avail); setHasChecked(true);
      setTableMsg(avail.length ? `${avail.length} table(s) available — select one below.` : 'No available tables for the selected date and time.');
    } catch (e) {
      setTableMsg(e?.response?.data?.message || 'Failed to check table availability.');
    } finally { setCheckingTables(false); }
  };

  const selectTable = (table) => {
    setCartTable(prev => prev?.id === table.id ? null : { id: table.id, table_number: table.table_number, capacity: table.capacity, price: Number(table.price || 0) });
  };

  // ── Checkout ──
  const handleCheckout = async () => {
    if (!cartTable) { setErr('Please select a table before checking out.'); return; }
    if (!resDate || !resTime) { setErr('Please select a date and time for your reservation.'); return; }
    if (!acceptOnline && !acceptGcash) { setErr('This bar does not accept online payments at this time.'); return; }
    setCheckingOut(true); setErr(''); setMsg('');
    try {
      const orderNote = cartItems.length > 0
        ? `Order: ${cartItems.map(i => `${i.name} x${i.qty}`).join(', ')}`
        : '';
      const resResult = await reservationService.create({
        bar_id: Number(barId),
        table_id: Number(cartTable.id),
        reservation_date: resDate,
        reservation_time: resTime,
        party_size: Number(partySize),
        notes: orderNote,
        menu_items: cartItems.map(i => ({
          menu_item_id: i.id,
          quantity: i.qty,
          unit_price: i.price,
        })),
      });
      const resId = resResult?.data?.id || resResult?.id;
      if (!resId) throw new Error('Reservation could not be created. Please try again.');

      const baseUrl = window.location.origin;
      const pay = await paymentService.createPayment({
        payment_type: 'reservation',
        related_id: resId,
        amount: grandTotal,
        payment_method: paymentMethod,
        bar_id: Number(barId),
        success_url: `${baseUrl}/payment/success?ref={REFERENCE_ID}`,
        failed_url: `${baseUrl}/payment/failed?ref={REFERENCE_ID}`,
      });
      const checkoutUrl = pay?.data?.checkout_url || pay?.checkout_url;
      if (checkoutUrl) {
        window.location.href = checkoutUrl;
      } else {
        setMsg('Reservation submitted! You will be notified once confirmed.');
        setCartItems([]); setCartTable(null);
      }
    } catch (e) {
      setErr(e?.response?.data?.message || 'Checkout failed. Please try again.');
    } finally { setCheckingOut(false); }
  };

  const handleFollow = async () => {
    try {
      if (following) { const r = await socialService.unfollow(barId); setFollowing(r?.following || false); }
      else { const r = await socialService.follow(barId); setFollowing(r?.following ?? true); }
    } catch (e) { setErr(e?.response?.data?.message || 'Failed to update follow.'); }
  };

  const handleLikeEvent = async (ev) => {
    try {
      const r = await eventService.like(ev.id);
      setEvents(p => p.map(i => i.id === ev.id ? { ...i, like_count: r.likeCount ?? i.like_count + 1 } : i));
    } catch (_) {}
  };

  const handleReview = async (e) => {
    e.preventDefault(); setSubmittingRev(true); setErr(''); setMsg('');
    try {
      await barService.submitReview(barId, { rating: Number(revRating), comment: revComment.trim() });
      setMsg('Review saved.'); await loadAll();
    } catch (e) { setErr(e?.response?.data?.message || 'Failed to save review.'); }
    finally { setSubmittingRev(false); }
  };

  const handleDeleteReview = async () => {
    setSubmittingRev(true);
    try { await barService.deleteReview(barId); setMsg('Review removed.'); await loadAll(); }
    catch (e) { setErr(e?.response?.data?.message || 'Failed to delete review.'); }
    finally { setSubmittingRev(false); }
  };

  if (loading) return <div className="loading-state" style={{ minHeight: '50vh' }}><div className="spinner" /><span>Loading bar...</span></div>;
  if (err && !bar) return <p className="error-text">{err}</p>;
  if (!bar) return <div className="glass-card empty-state"><div className="empty-icon"><Wine size={32} /></div><h3 className="text-h3">Bar not found</h3></div>;

  return (
    <div className="flex flex-col gap-xl">
      {canGoBack && (
        <button className="btn btn-ghost btn-sm" onClick={goBack} style={{ alignSelf: 'flex-start' }}>← Back</button>
      )}

      {/* Hero */}
      <section className="glass-card" style={{ overflow: 'hidden' }}>
        <div className="detail-hero-wrap">
          <img
            className="detail-hero-img"
            src={imageUrl(bar.image_path) || `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='400' viewBox='0 0 1200 400'%3E%3Crect width='1200' height='400' fill='%23161616'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='72' fill='%23333'%3E%F0%9F%8D%B8%3C/text%3E%3C/svg%3E`}
            alt={bar.name}
            onError={e => { e.target.src = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='400' viewBox='0 0 1200 400'%3E%3Crect width='1200' height='400' fill='%23161616'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='72' fill='%23333'%3E%F0%9F%8D%B8%3C/text%3E%3C/svg%3E`; }}
          />
          <div className="detail-hero-overlay" />
          <div className="detail-hero-info">
            <div className="detail-hero-text" style={{ display: 'flex', alignItems: 'flex-start', gap: '1.25rem' }}>
              {bar.logo_path && (
                <img
                  src={imageUrl(bar.logo_path)}
                  alt={`${bar.name} logo`}
                  style={{
                    width: '120px',
                    height: '120px',
                    objectFit: 'cover',
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.1)',
                    padding: '6px',
                    backdropFilter: 'blur(10px)',
                    border: '3px solid rgba(255,255,255,0.2)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    flexShrink: 0
                  }}
                  onError={e => { e.target.style.display = 'none'; }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="land-live-badge" style={{ marginBottom: '0.5rem' }}>
                  <span className="land-live-dot" />
                  <span>{(bar.category || 'Bar').toUpperCase()}</span>
                </div>
                <h1 style={{ fontFamily: "'Sora', sans-serif", fontSize: 'clamp(1.5rem,4vw,2.5rem)', fontWeight: 800, lineHeight: 1.1, color: 'var(--text-primary)', letterSpacing: '-0.5px', textShadow: '0 2px 12px rgba(0,0,0,0.7)' }}>{bar.name}</h1>
                <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>{bar.address}, {bar.city}, {bar.state}</p>
                <p className="text-muted" style={{ fontSize: '0.82rem', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}><Star size={13} /> {bar.rating || '0.0'} ({bar.review_count || 0} reviews) · {bar.follower_count || 0} followers</p>
              </div>
            </div>
            <button className={`btn ${following ? 'btn-ghost' : 'btn-red'}`} onClick={handleFollow} style={{ flexShrink: 0 }}>
              {following ? 'Unfollow' : '+ Follow'}
            </button>
          </div>
        </div>
        {bar.description && (
          <div className="glass-card-body" style={{ paddingTop: '1.25rem', paddingBottom: '1.25rem' }}>
            <p className="text-body" style={{ fontSize: '0.9rem', lineHeight: 1.6 }}>{bar.description}</p>
          </div>
        )}
      </section>

      {msg && <div className="alert alert-info">{msg}</div>}
      {err && <div className="alert alert-err">{err}</div>}

      {/* Tab Navigation */}
      <section className="glass-card" style={{ padding: '0', overflow: 'hidden' }}>
        <div style={{ display: 'flex', borderBottom: '2px solid rgba(255,255,255,0.1)' }}>
          <button
            onClick={() => setActiveTab('overview')}
            style={{
              flex: 1,
              padding: '1rem 1.5rem',
              background: activeTab === 'overview' ? 'rgba(220, 38, 38, 0.2)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'overview' ? '3px solid var(--red)' : '3px solid transparent',
              color: activeTab === 'overview' ? 'var(--red)' : 'var(--text-muted)',
              fontWeight: activeTab === 'overview' ? 700 : 500,
              fontSize: '0.95rem',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              fontFamily: "'Sora', sans-serif"
            }}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('menu')}
            style={{
              flex: 1,
              padding: '1rem 1.5rem',
              background: activeTab === 'menu' ? 'rgba(220, 38, 38, 0.2)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'menu' ? '3px solid var(--red)' : '3px solid transparent',
              color: activeTab === 'menu' ? 'var(--red)' : 'var(--text-muted)',
              fontWeight: activeTab === 'menu' ? 700 : 500,
              fontSize: '0.95rem',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              fontFamily: "'Sora', sans-serif"
            }}
          >
            Bar Menu
          </button>
          <button
            onClick={() => setActiveTab('events')}
            style={{
              flex: 1,
              padding: '1rem 1.5rem',
              background: activeTab === 'events' ? 'rgba(220, 38, 38, 0.2)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'events' ? '3px solid var(--red)' : '3px solid transparent',
              color: activeTab === 'events' ? 'var(--red)' : 'var(--text-muted)',
              fontWeight: activeTab === 'events' ? 700 : 500,
              fontSize: '0.95rem',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              fontFamily: "'Sora', sans-serif"
            }}
          >
            All Events
          </button>
          <button
            onClick={() => setActiveTab('about')}
            style={{
              flex: 1,
              padding: '1rem 1.5rem',
              background: activeTab === 'about' ? 'rgba(220, 38, 38, 0.2)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'about' ? '3px solid var(--red)' : '3px solid transparent',
              color: activeTab === 'about' ? 'var(--red)' : 'var(--text-muted)',
              fontWeight: activeTab === 'about' ? 700 : 500,
              fontSize: '0.95rem',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              fontFamily: "'Sora', sans-serif"
            }}
          >
            About
          </button>
        </div>
      </section>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <>
          {/* Hours + Contact */}
      <section className="g g-2">
        <div className="glass-card glass-card-body">
          <h3 className="text-h3 mb-md">Operating Hours</h3>
          {openingHours.map(([day, hrs]) => (
            <div className="hours-row" key={day}>
              <span className="hours-day">{day}</span>
              <span className="hours-val">{hrs || 'Unavailable'}</span>
            </div>
          ))}
        </div>
        <div className="glass-card glass-card-body">
          <h3 className="text-h3 mb-md">Contact</h3>
          <p className="text-body" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Phone size={14} /> {bar.phone || 'No phone listed'}</p>
          <p className="text-body" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Mail size={14} /> {bar.email || 'No email listed'}</p>
          <p className="text-body" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Globe size={14} /> {bar.website || 'No website listed'}</p>
          <button className="btn btn-glass btn-sm mt-md" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }} onClick={() => navigate(VIEWS.MAP)}><MapPin size={14} /> View on Map</button>
        </div>
          </section>

          {/* Featured Events Preview */}
          {events.length > 0 && (
            <section>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2 className="text-h2">Upcoming Events</h2>
                <button 
                  className="btn btn-ghost btn-sm" 
                  onClick={() => setActiveTab('events')}
                  style={{ fontSize: '0.85rem' }}
                >
                  View All →
                </button>
              </div>
              <div className="g g-3">
                {events.slice(0, 3).map((ev) => (
                  <div className="glass-card" key={ev.id} style={{ overflow: 'hidden', position: 'relative' }}>
                    <div style={{ position: 'relative', overflow: 'hidden', height: '180px' }}>
                      <img 
                        src={imageUrl(ev.image_path) || `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='180' viewBox='0 0 400 180'%3E%3Crect width='400' height='180' fill='%23161616'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='48' fill='%23333'%3E%F0%9F%8E%89%3C/text%3E%3C/svg%3E`} 
                        alt={ev.title} 
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={e => { e.target.src = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='180' viewBox='0 0 400 180'%3E%3Crect width='400' height='180' fill='%23161616'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='48' fill='%23333'%3E%F0%9F%8E%89%3C/text%3E%3C/svg%3E`; }} 
                      />
                      <div style={{
                        position: 'absolute',
                        top: '10px',
                        right: '10px',
                        background: 'rgba(220, 38, 38, 0.95)',
                        backdropFilter: 'blur(10px)',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        color: 'white'
                      }}>
                        {formatDate(ev.event_date)}
                      </div>
                    </div>
                    <div className="glass-card-body" style={{ padding: '1rem' }}>
                      <h4 className="text-h4" style={{ marginBottom: '0.5rem' }}>{ev.title}</h4>
                      <p className="text-muted" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <CalendarDays size={12} /> {formatTime(ev.start_time)} — {formatTime(ev.end_time)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Reviews Preview */}
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 className="text-h2">Reviews</h2>
              <span className="text-muted" style={{ fontSize: '0.9rem' }}>
                {reviewData?.average_rating || 0} ★ ({reviewData?.review_count || 0} reviews)
              </span>
            </div>
            {reviews.length === 0 ? (
              <div className="glass-card empty-state">
                <div className="empty-icon"><MessageCircle size={32} /></div>
                <p className="text-muted">No reviews yet.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-md">
                {reviews.slice(0, 3).map(r => (
                  <div className="glass-card glass-card-body" key={r.id}>
                    <div className="review-header">
                      <div className="review-author">
                        {r.profile_picture
                          ? <img src={imageUrl(r.profile_picture)} className="review-avatar" alt="" />
                          : <div className="review-avatar-ph">{r.first_name?.[0]}{r.last_name?.[0]}</div>}
                        <div>
                          <strong className="text-white" style={{ fontSize: '0.9rem' }}>{r.first_name} {r.last_name}</strong>
                          <div className="star-rating">{[1,2,3,4,5].map(s => <span key={s} className={s <= r.rating ? 'star filled' : 'star'}>★</span>)}</div>
                        </div>
                      </div>
                      <span className="text-dim" style={{ fontSize: '0.75rem' }}>{formatDate(r.created_at)}</span>
                    </div>
                    <p className="text-body" style={{ fontSize: '0.9rem' }}>{r.comment || 'No written comment.'}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Bar Menu Tab */}
      {activeTab === 'menu' && (
        <>
      <section className="menu-cart-layout">
        {/* Left: Menu */}
        <div className="menu-section">
          <h2 className="text-h2 mb-md">Bar Menu</h2>
          {menuItems.length === 0 ? (
            <div className="glass-card empty-state">
              <div className="empty-icon"><Utensils size={32} /></div>
              <h3 className="text-h3">No menu yet</h3>
              <p className="text-muted mt-sm">This bar hasn't published their menu.</p>
            </div>
          ) : (
            <div className="g g-3">
              {menuItems.map((item) => {
                const qty = getItemQty(item.id);
                const name = item.name || item.menu_name || 'Menu Item';
                const desc = item.description || item.menu_description || '';
                const price = Number(item.price ?? item.selling_price ?? 0);
                const category = item.category || item.menu_category || '';
                const imgSrc = item.image_path ? imageUrl(item.image_path) : null;
                const totalSold = Number(item.total_sold || 0);
                const salesRank = Number(item.sales_rank || 0);
                const isBestSeller = toBool(item.is_best_seller) || (Number.isFinite(salesRank) && salesRank > 0 && salesRank <= 3);
                return (
                  <div className="glass-card menu-item-card" key={item.id}>
                    <img
                      src={imgSrc || MENU_PLACEHOLDER}
                      alt={name}
                      className="menu-item-img"
                      onError={(e) => { e.target.onerror = null; e.target.src = MENU_PLACEHOLDER; }}
                    />
                    <div className="menu-item-body">
                      <div className="flex justify-between items-start gap-sm">
                        <h4 className="text-h4" style={{ flex: 1 }}>{name}</h4>
                        <span className="menu-item-price">₱{price.toFixed(2)}</span>
                      </div>
                      {(isBestSeller || totalSold > 0) && (
                        <div className="flex gap-sm flex-wrap mt-sm">
                          {isBestSeller && <span className="badge-red" style={{ fontSize: '0.68rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><Flame size={12} /> Best Seller</span>}
                          {totalSold > 0 && <span className="badge-glass" style={{ fontSize: '0.68rem' }}>Sold: {totalSold}</span>}
                        </div>
                      )}
                      {desc && <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: '0.3rem', lineHeight: 1.5 }}>{desc}</p>}
                      {category && <span className="badge-glass" style={{ marginTop: '0.5rem', display: 'inline-block' }}>{category}</span>}
                      <div className="menu-item-actions">
                        {qty === 0 ? (
                          <button className="btn btn-red btn-sm" style={{ width: '100%' }} onClick={() => addToCart(item)}>
                            + Add to Order
                          </button>
                        ) : (
                          <div className="qty-control">
                            <button className="qty-btn" onClick={() => removeFromCart(item.id)}>−</button>
                            <span className="qty-value">{qty}</span>
                            <button className="qty-btn" onClick={() => addToCart(item)}>+</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Cart Panel */}
        <div className="cart-panel">
          <div className="cart-sticky glass-card glass-card-body">
            <h3 className="text-h3 mb-md" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><ShoppingCart size={18} /> Your Order</h3>

            {/* Table Reservation Picker */}
            <div className="cart-section">
              <p className="text-label mb-sm" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <CalendarDays size={13} /> Table Reservation
                <span className="text-red" style={{ fontSize: '0.65rem', marginLeft: '4px' }}>*required</span>
              </p>
              <div className="flex flex-col gap-sm">
                <input
                  className="glass-input"
                  type="date"
                  value={resDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={e => { setResDate(e.target.value); setCartTable(null); setHasChecked(false); setTableMsg(''); }}
                />
                <select
                  className="glass-input"
                  value={resTime}
                  onChange={e => { setResTime(e.target.value); setCartTable(null); setHasChecked(false); setTableMsg(''); }}
                >
                  <option value="">Select hour</option>
                  {availableHourOptions.map((slot) => (
                    <option key={slot} value={slot}>{formatHourLabel(slot)}</option>
                  ))}
                </select>
                {resDate && availableHourOptions.length === 0 && (
                  <p className="text-dim" style={{ fontSize: '0.7rem', marginTop: '-0.25rem' }}>
                    No available reservation slots for the selected date.
                  </p>
                )}
                <input
                  className="glass-input"
                  type="number"
                  min="1"
                  placeholder="Party size (number of guests)"
                  value={partySize}
                  onChange={e => { setPartySize(e.target.value); setCartTable(null); setHasChecked(false); setTableMsg(''); }}
                />
                <button
                  className="btn btn-glass btn-sm"
                  onClick={handleCheckTables}
                  disabled={checkingTables || !resDate || !resTime || !partySize}
                >
                  {checkingTables ? 'Checking...' : 'Check Availability'}
                </button>
              </div>

              {tableMsg && (
                <div className={`alert mt-sm ${availableTables.length > 0 ? 'alert-info' : 'alert-warn'}`}>
                  {tableMsg}
                </div>
              )}

              {hasChecked && availableTables.length > 0 && (
                <div className="table-grid mt-sm">
                  {availableTables.map(t => (
                    <button
                      key={t.id}
                      className={`table-option ${cartTable?.id === t.id ? 'selected' : ''}`}
                      onClick={() => selectTable(t)}
                    >
                      {t.image_path ? (
                        <img 
                          src={`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/${t.image_path}`}
                          alt={`Table ${t.table_number}`}
                          className="table-image"
                          style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '8px', marginBottom: '0.5rem' }}
                          onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <div className="table-placeholder" style={{ width: '100%', height: '120px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', display: t.image_path ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '0.5rem' }}>
                        <Utensils size={32} style={{ opacity: 0.3, color: 'var(--text-muted)' }} />
                      </div>
                      <span className="table-num">Table #{t.table_number}</span>
                      <span className="table-cap">Cap: {t.capacity} pax</span>
                      {Number(t.price) > 0 && <span className="table-price">₱{Number(t.price).toFixed(2)}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Cart Items */}
            {cartItems.length > 0 && (
              <div className="cart-section">
                <p className="text-label mb-sm" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><Utensils size={13} /> Menu Items ({cartItems.reduce((s, i) => s + i.qty, 0)})</p>
                <div className="cart-items-list">
                  {cartItems.map(item => (
                    <div className="cart-item-row" key={item.id}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p className="cart-item-name">{item.name}</p>
                        <p className="cart-item-sub">₱{item.price.toFixed(2)} × {item.qty}</p>
                      </div>
                      <div className="flex items-center gap-sm" style={{ flexShrink: 0 }}>
                        <span className="cart-item-total">₱{(item.price * item.qty).toFixed(2)}</span>
                        <div className="qty-control sm">
                          <button className="qty-btn" onClick={() => removeFromCart(item.id)}>−</button>
                          <span className="qty-value">{item.qty}</span>
                          <button className="qty-btn" onClick={() => addToCart({ id: item.id, name: item.name, price: item.price })}>+</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Order Total */}
            {(cartTable || cartItems.length > 0) && (
              <div className="cart-total-box">
                {cartTable && (
                  <div className="cart-total-row">
                    <span>Table #{cartTable.table_number}</span>
                    <span>₱{cartTable.price.toFixed(2)}</span>
                  </div>
                )}
                {cartItems.map(item => (
                  <div className="cart-total-row" key={item.id}>
                    <span>{item.name} ×{item.qty}</span>
                    <span>₱{(item.price * item.qty).toFixed(2)}</span>
                  </div>
                ))}
                <div className="cart-grand-total">
                  <span>Total</span>
                  <span>₱{grandTotal.toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* Payment Method */}
            {cartTable && (acceptGcash || acceptOnline) && (
              <div className="cart-section">
                <p className="text-label mb-sm" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><CreditCard size={13} /> Payment Method</p>
                <div className="pay-options">
                  {acceptGcash && (
                    <label className={`pay-option ${paymentMethod === 'gcash' ? 'selected' : ''}`}>
                      <input type="radio" name="pm" value="gcash" checked={paymentMethod === 'gcash'} onChange={e => setPaymentMethod(e.target.value)} />
                      <span className="pay-option-icon"><Smartphone size={18} /></span>
                      <span className="pay-option-label">GCash</span>
                    </label>
                  )}
                  {acceptOnline && (
                    <label className={`pay-option ${paymentMethod === 'paymaya' ? 'selected' : ''}`}>
                      <input type="radio" name="pm" value="paymaya" checked={paymentMethod === 'paymaya'} onChange={e => setPaymentMethod(e.target.value)} />
                      <span className="pay-option-icon"><CreditCard size={18} /></span>
                      <span className="pay-option-label">Card / PayMaya</span>
                    </label>
                  )}
                </div>
              </div>
            )}

            {cartTable && !acceptGcash && !acceptOnline && (
              <div className="alert alert-warn mt-sm">This bar does not accept online payments at this time.</div>
            )}

            {/* Checkout Button */}
            <button
              className="btn btn-red"
              style={{ width: '100%', marginTop: '1rem' }}
              disabled={!cartTable || checkingOut || grandTotal === 0 || (!acceptOnline && !acceptGcash)}
              onClick={handleCheckout}
            >
              {checkingOut
                ? 'Processing...'
                : !cartTable
                  ? 'Select a Table to Checkout'
                  : `Checkout — ₱${grandTotal.toFixed(2)}`}
            </button>

            {!cartTable && (
              <p className="text-dim mt-sm" style={{ fontSize: '0.75rem', textAlign: 'center' }}>
                A table reservation is required to complete your order.
              </p>
            )}
          </div>
          </div>
          </section>
        </>
      )}

      {/* All Events Tab */}
      {activeTab === 'events' && (
        events.length > 0 ? (
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <CalendarDays size={28} style={{ color: 'var(--red)' }} />
            <h2 className="text-h2" style={{ margin: 0 }}>All Events</h2>
            <span className="badge-glass" style={{ marginLeft: 'auto' }}>{events.length} event{events.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="g g-3">
            {events.map((ev) => {
              const isUpcoming = ev.event_date && new Date(ev.event_date + 'T23:59:59') >= new Date();
              return (
              <div className="glass-card" key={ev.id} style={{ overflow: 'hidden', position: 'relative', opacity: isUpcoming ? 1 : 0.72 }}>
                {!isUpcoming && (
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3, background: 'rgba(0,0,0,0.55)', padding: '0.3rem 0.75rem', fontSize: '0.7rem', fontWeight: 700, color: '#aaa', letterSpacing: '1px', textTransform: 'uppercase', textAlign: 'center' }}>Past Event</div>
                )}
                <div style={{ position: 'relative', overflow: 'hidden', height: '220px' }}>
                  <img 
                    src={imageUrl(ev.image_path) || `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='220' viewBox='0 0 400 220'%3E%3Crect width='400' height='220' fill='%23161616'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='64' fill='%23333'%3E%F0%9F%8E%89%3C/text%3E%3C/svg%3E`} 
                    alt={ev.title} 
                    style={{ 
                      width: '100%', 
                      height: '100%', 
                      objectFit: 'cover',
                      transition: 'transform 0.3s ease'
                    }}
                    onError={e => { e.target.src = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='220' viewBox='0 0 400 220'%3E%3Crect width='400' height='220' fill='%23161616'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='64' fill='%23333'%3E%F0%9F%8E%89%3C/text%3E%3C/svg%3E`; }} 
                  />
                  <div style={{
                    position: 'absolute',
                    top: '12px',
                    right: '12px',
                    background: 'rgba(220, 38, 38, 0.95)',
                    backdropFilter: 'blur(10px)',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    border: '1px solid rgba(255,255,255,0.2)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                  }}>
                    <span style={{ fontSize: '1.4rem', fontWeight: 800, lineHeight: 1, color: 'white' }}>
                      {new Date(ev.event_date).getDate()}
                    </span>
                    <span style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: 'rgba(255,255,255,0.9)' }}>
                      {new Date(ev.event_date).toLocaleDateString('en-US', { month: 'short' })}
                    </span>
                  </div>
                </div>
                <div className="glass-card-body" style={{ padding: '1.25rem' }}>
                  <h3 className="text-h3" style={{ marginBottom: '0.75rem', fontSize: '1.25rem', fontWeight: 700 }}>{ev.title}</h3>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.5rem', 
                    marginBottom: '0.75rem',
                    padding: '8px 12px',
                    background: 'rgba(255,255,255,0.05)',
                    borderRadius: '6px',
                    border: '1px solid rgba(255,255,255,0.1)'
                  }}>
                    <CalendarDays size={15} style={{ color: 'var(--red)', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {formatDate(ev.event_date)} · {formatTime(ev.start_time)} — {formatTime(ev.end_time)}
                    </span>
                  </div>
                  {/* Feature 3: Entrance fee display */}
                  <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {Number(ev.entry_price || 0) > 0 ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.6rem', fontSize: '0.75rem', fontWeight: 600, background: 'rgba(204,0,0,0.15)', color: '#f87171', borderRadius: '12px', border: '1px solid rgba(204,0,0,0.25)' }}>
                        🎟 ₱{Number(ev.entry_price).toLocaleString()} entrance
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.6rem', fontSize: '0.75rem', fontWeight: 600, background: 'rgba(74,222,128,0.1)', color: '#4ade80', borderRadius: '12px', border: '1px solid rgba(74,222,128,0.2)' }}>
                        FREE Entry
                      </span>
                    )}
                  </div>
                  {ev.description && (
                    <p className="text-muted" style={{ fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1rem' }}>
                      {ev.description}
                    </p>
                  )}
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    paddingTop: '0.75rem',
                    borderTop: '1px solid rgba(255,255,255,0.1)'
                  }}>
                    <span style={{ 
                      fontSize: '0.85rem', 
                      color: 'var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem'
                    }}>
                      <Heart size={14} style={{ color: 'var(--red)' }} />
                      {ev.like_count || 0} {(ev.like_count || 0) === 1 ? 'like' : 'likes'}
                    </span>
                    <button 
                      className="btn btn-ghost btn-sm" 
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }} 
                      onClick={() => handleLikeEvent(ev)}
                    >
                      <Heart size={14} /> Like Event
                    </button>
                  </div>
                </div>
              </div>
            );
            })}
          </div>
        </section>
        ) : (
          <div className="glass-card empty-state">
            <div className="empty-icon"><CalendarDays size={32} /></div>
            <h3 className="text-h3">No Events Yet</h3>
            <p className="text-muted mt-sm">This bar hasn't posted any events.</p>
          </div>
        )
      )}

      {/* About Tab */}
      {activeTab === 'about' && (
        <>
          {/* Bar Description */}
          {(bar.description || bar.category || bar.price_range) && (
            <section className="glass-card glass-card-body">
              <h3 className="text-h3 mb-md">About This Bar</h3>
              {bar.description && (
                <p className="text-body" style={{ lineHeight: 1.7, marginBottom: '1rem' }}>{bar.description}</p>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {bar.category && (
                  <span className="badge-red">{bar.category}</span>
                )}
                {bar.price_range && (
                  <span className="badge-glass">{bar.price_range}</span>
                )}
                {bar.city && (
                  <span className="badge-glass" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                    <MapPin size={11} /> {bar.city}{bar.state ? `, ${bar.state}` : ''}
                  </span>
                )}
                {bar.address && (
                  <span className="badge-glass">{bar.address}</span>
                )}
              </div>
            </section>
          )}

          {/* Hours + Contact */}
          <section className="g g-2">
            <div className="glass-card glass-card-body">
              <h3 className="text-h3 mb-md">Operating Hours</h3>
              {openingHours.map(([day, hrs]) => (
                <div className="hours-row" key={day}>
                  <span className="hours-day">{day}</span>
                  <span className="hours-val">{hrs || 'Unavailable'}</span>
                </div>
              ))}
            </div>
            <div className="glass-card glass-card-body">
              <h3 className="text-h3 mb-md">Contact</h3>
              <p className="text-body" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Phone size={14} /> {bar.phone || 'No phone listed'}</p>
              <p className="text-body" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Mail size={14} /> {bar.email || 'No email listed'}</p>
              <p className="text-body" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Globe size={14} /> {bar.website || 'No website listed'}</p>
              <button className="btn btn-glass btn-sm mt-md" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }} onClick={() => navigate(VIEWS.MAP)}><MapPin size={14} /> View on Map</button>
            </div>
          </section>

          {/* Reviews */}
          <section className="g g-2">
        <div>
          <h2 className="text-h2">Reviews</h2>
          <p className="text-muted mt-sm mb-md">Average: {reviewData?.average_rating || 0} ({reviewData?.review_count || 0} total)</p>
          {reviews.length === 0 ? (
            <div className="glass-card empty-state"><div className="empty-icon"><MessageCircle size={32} /></div><p className="text-muted">No reviews yet.</p></div>
          ) : (
            <div className="flex flex-col gap-md">
              {reviews.map(r => (
                <div className="glass-card glass-card-body" key={r.id}>
                  <div className="review-header">
                    <div className="review-author">
                      {r.profile_picture
                        ? <img src={imageUrl(r.profile_picture)} className="review-avatar" alt="" />
                        : <div className="review-avatar-ph">{r.first_name?.[0]}{r.last_name?.[0]}</div>}
                      <div>
                        <strong className="text-white" style={{ fontSize: '0.9rem' }}>{r.first_name} {r.last_name}</strong>
                        <div className="star-rating">{[1,2,3,4,5].map(s => <span key={s} className={s <= r.rating ? 'star filled' : 'star'}>★</span>)}</div>
                      </div>
                    </div>
                    <span className="text-dim" style={{ fontSize: '0.75rem' }}>{formatDate(r.created_at)}</span>
                  </div>
                  <p className="text-body" style={{ fontSize: '0.9rem' }}>{r.comment || 'No written comment.'}</p>
                  {r.reply && (
                    <div className="review-reply">
                      <div className="flex items-center gap-sm mb-sm">
                        <span className="owner-badge">Bar Owner</span>
                        <strong className="text-white" style={{ fontSize: '0.85rem' }}>{r.reply_author || 'Owner'}</strong>
                      </div>
                      <p className="text-muted" style={{ fontSize: '0.85rem' }}>{r.reply}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          {!reviewEligibility && !myReview ? (
            <div className="glass-card glass-card-body">
              <p className="text-muted">You can leave a review after completing a reservation at this bar.</p>
            </div>
          ) : (
            <form className="glass-card glass-card-body flex flex-col gap-md" onSubmit={handleReview}>
              <h3 className="text-h3">{myReview ? 'Update your review' : 'Write a review'}</h3>
              <div className="flex gap-md items-center">
                <select className="glass-select" value={revRating} onChange={e => setRevRating(e.target.value)} style={{ width: 'auto' }}>
                  {[1,2,3,4,5].map(v => <option key={v} value={v}>{v} Star{v > 1 ? 's' : ''}</option>)}
                </select>
                <button className="btn btn-red btn-sm" type="submit" disabled={submittingRev}>
                  {submittingRev ? 'Saving...' : myReview ? 'Update' : 'Submit'}
                </button>
              </div>
              <textarea className="glass-textarea" value={revComment} onChange={e => setRevComment(e.target.value)} placeholder="Share your experience..." />
              {myReview && (
                <button className="btn btn-ghost btn-sm" type="button" onClick={handleDeleteReview} disabled={submittingRev}>
                  Delete Review
                </button>
              )}
            </form>
          )}
        </div>
          </section>
        </>
      )}
    </div>
  );
}

export default BarDetailView;
