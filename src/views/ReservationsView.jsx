import { useEffect, useState } from 'react';
import { useView } from '../hooks/useView';
import { VIEWS } from '../contexts/ViewContext';
import { reservationService } from '../services/reservationService';
import { paymentService } from '../services/paymentService';
import { formatDate, formatTime } from '../utils/dateHelpers';
import { CalendarDays, Clock, Utensils, BookMarked } from 'lucide-react';

function parseOrderItems(notes) {
  if (!notes) return [];
  const match = notes.match(/Order:\s*(.+)/i);
  if (!match) return [];
  return match[1].split(',').map(s => s.trim()).filter(Boolean);
}

function ReservationModal({ reservation, onClose, onCancel }) {
  if (!reservation) return null;
  const items = parseOrderItems(reservation.notes || '');
  const isPaid = (reservation.payment_status || '').toLowerCase() === 'paid';
  const isConfirmed = (reservation.status || '').toLowerCase() === 'confirmed';
  const isApproved = (reservation.status || '').toLowerCase() === 'approved';
  const isCancelled = (reservation.status || '').toLowerCase().includes('cancel');
  const isRejected = (reservation.status || '').toLowerCase() === 'rejected';

  const badgeClass = isPaid || isConfirmed ? 'paid'
    : isCancelled || isRejected ? 'cancelled'
    : isApproved ? 'approved'
    : 'pending';

  const badgeLabel = isPaid || isConfirmed ? 'Reserved'
    : isCancelled ? 'Cancelled'
    : isRejected ? 'Rejected'
    : isApproved ? 'Approved'
    : 'Pending';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: '500px' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="text-h3">Reservation Details</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body flex flex-col gap-md">
          {/* Transaction Number */}
          {reservation.transaction_number && (
            <div style={{ background: 'rgba(232,0,30,0.08)', border: '1px solid var(--red-primary)', borderRadius: '8px', padding: '0.6rem 1rem' }}>
              <p className="text-label" style={{ fontSize: '0.7rem', marginBottom: '0.2rem' }}>TRANSACTION NUMBER</p>
              <p style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1rem', letterSpacing: '0.05em', color: 'var(--red-primary)' }}>{reservation.transaction_number}</p>
              <p className="text-dim" style={{ fontSize: '0.7rem', marginTop: '0.2rem' }}>Share this with the bar to confirm your reservation</p>
            </div>
          )}
          {/* Status */}
          <div className="flex gap-sm items-center">
            <span className={`payment-status ${badgeClass}`}>
              {badgeLabel}
            </span>
            {reservation.bar_name && <span className="badge-glass">{reservation.bar_name}</span>}
          </div>

          {/* Table info */}
          <div className="res-detail-section">
            <p className="text-label mb-sm">Table</p>
            <p className="text-body">Table #{reservation.table_number || reservation.table_id} &nbsp;·&nbsp; Party of {reservation.party_size}</p>
          </div>

          {/* Date & Time */}
          <div className="res-detail-section">
            <p className="text-label mb-sm">Date & Time</p>
            <p className="text-body" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}><CalendarDays size={14} /> {formatDate(reservation.reservation_date)} &nbsp;·&nbsp; <Clock size={14} /> {formatTime(reservation.reservation_time)}</p>
          </div>

          {/* Menu items */}
          {items.length > 0 && (
            <div className="res-detail-section">
              <p className="text-label mb-sm">Menu Items Ordered</p>
              <div className="flex flex-col gap-sm">
                {items.map((item, i) => (
                  <div key={i} className="phc-item">
                    <Utensils size={14} style={{ flexShrink: 0 }} />
                    <span className="text-body">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Total */}
          {reservation.payment_amount && (
            <div className="res-detail-section">
              <p className="text-label mb-sm">Total Payment</p>
              <p className="phc-amount">₱{Number(reservation.payment_amount).toFixed(2)}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-sm mt-sm">
            {reservation.bar_id && (
              <button className="btn btn-glass btn-sm" onClick={() => { onClose(); }}>
                Close
              </button>
            )}
            {!isCancelled && !isPaid && (
              <button className="btn btn-ghost btn-sm" onClick={() => onCancel(reservation.id)}>
                Cancel Reservation
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReservationsView() {
  const { navigate } = useView();
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [selected, setSelected] = useState(null);
  const [recheckingId, setRecheckingId] = useState(null);
  const [nowTs, setNowTs] = useState(Date.now());

  const load = async () => {
    try {
      setLoading(true); setErr('');
      const data = await reservationService.myReservations();
      const list = Array.isArray(data) ? data : [];
      setReservations(list);

      // Auto-check reservations with pending payment that are NOT already confirmed
      const pendingRefs = list
        .filter(r =>
          (r.payment_status || '').toLowerCase() === 'pending' &&
          !['confirmed', 'cancelled'].includes((r.status || '').toLowerCase()) &&
          r.reference_id
        )
        .map(r => r.reference_id);
      if (pendingRefs.length) {
        await Promise.allSettled(pendingRefs.map(ref => paymentService.confirmPaymentByReference(ref)));
        const refreshed = await reservationService.myReservations();
        setReservations(Array.isArray(refreshed) ? refreshed : list);
      }
    } catch (e) {
      setErr(e?.response?.data?.message || 'Failed to load reservations.');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const handleCancel = async (id) => {
    if (!confirm('Cancel this reservation?')) return;
    setErr(''); setMsg('');
    try {
      await reservationService.cancel(id);
      setMsg('Reservation cancelled.');
      setSelected(null);
      load();
    } catch (e) {
      setErr(e?.response?.data?.message || 'Failed to cancel.');
    }
  };

  const handleRecheck = async (id) => {
    setRecheckingId(id);
    setErr(''); setMsg('');
    try {
      const result = await reservationService.recheckPayment(id);
      setMsg(result.message || 'Status rechecked.');
      load();
    } catch (e) {
      setErr(e?.response?.data?.message || 'Failed to recheck status.');
    } finally {
      setRecheckingId(null);
    }
  };

  const handleCheckIn = async (id) => {
    setErr(''); setMsg('');
    try {
      const result = await reservationService.checkIn(id);
      setMsg(result.message || 'Checked in successfully.');
      load();
    } catch (e) {
      setErr(e?.response?.data?.message || 'Failed to check in.');
    }
  };

  if (loading) return <div className="loading-state" style={{ minHeight: '50vh' }}><div className="spinner" /><span>Loading reservations...</span></div>;

  return (
    <div className="flex flex-col gap-xl">
      <div className="flex justify-between items-center flex-wrap gap-md">
        <div>
          <span className="home-eyebrow">RESERVATIONS</span>
          <h1 className="home-section-title" style={{ marginTop: '0.5rem' }}>MY <span className="home-accent">RESERVATIONS</span></h1>
          <p className="home-section-sub">Click any reservation to view full details.</p>
        </div>
        <button className="btn btn-red btn-red-pulse" onClick={() => navigate(VIEWS.BARS)}>+ New Reservation</button>
      </div>

      {msg && <div className="alert alert-info">{msg}</div>}
      {err && <div className="alert alert-err">{err}</div>}

      {reservations.length === 0 ? (
        <div className="glass-card empty-state">
          <div className="empty-icon"><BookMarked size={32} /></div>
          <h3 className="text-h3">No reservations yet</h3>
          <p className="text-muted mt-sm">Browse bars and reserve a table to get started.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-md">
          {reservations.map(r => {
            const isPaid = (r.payment_status || '').toLowerCase() === 'paid';
            const isConfirmed = (r.status || '').toLowerCase() === 'confirmed';
            const isCheckedIn = (r.status || '').toLowerCase() === 'checked_in';
            const isNoShow = (r.status || '').toLowerCase() === 'no_show';
            const isApproved = (r.status || '').toLowerCase() === 'approved';
            const isCancelled = (r.status || '').toLowerCase().includes('cancel');
            const isRejected = (r.status || '').toLowerCase() === 'rejected';

            const badgeClass = isPaid || isConfirmed || isCheckedIn ? 'paid'
              : isCancelled || isRejected ? 'cancelled'
              : isNoShow ? 'cancelled'
              : isApproved ? 'approved'
              : 'pending';

            const badgeLabel = isPaid || isConfirmed || isCheckedIn ? 'Reserved'
              : isCancelled ? 'Cancelled'
              : isRejected ? 'Rejected'
              : isNoShow ? 'No Show'
              : isApproved ? 'Approved'
              : 'Pending';

            const startDt = new Date(`${r.reservation_date}T${r.reservation_time}`);
            const graceEnd = new Date(startDt.getTime() + 30 * 60 * 1000);
            const inGraceWindow = isConfirmed && !r.checked_in_at && nowTs >= startDt.getTime() && nowTs < graceEnd.getTime();
            const remainingMs = inGraceWindow ? Math.max(0, graceEnd.getTime() - nowTs) : 0;
            const remMin = Math.floor(remainingMs / 60000);
            const remSec = Math.floor((remainingMs % 60000) / 1000);

            return (
              <div
                className="glass-card res-card"
                key={r.id}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelected(r)}
              >
                <div className="res-header">
                  <div>
                    <h3 className="text-h3">{r.bar_name || `Bar #${r.bar_id}`}</h3>
                    <p className="text-muted" style={{ fontSize: '0.85rem' }}>
                      Table #{r.table_number || r.table_id} · Party of {r.party_size}
                    </p>
                  </div>
                  <span className={`payment-status ${badgeClass}`}>
                    {badgeLabel}
                  </span>
                </div>
                <div className="flex gap-lg mt-sm flex-wrap">
                  <span className="text-body" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><CalendarDays size={13} /> {formatDate(r.reservation_date)}</span>
                  <span className="text-body" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><Clock size={13} /> {formatTime(r.reservation_time)}</span>
                </div>
                {inGraceWindow && (
                  <div className="alert alert-info mt-sm" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <span style={{ fontSize: '0.85rem' }}>
                      Grace period: <strong>{String(remMin).padStart(2, '0')}:{String(remSec).padStart(2, '0')}</strong> remaining
                    </span>
                    <button
                      className="btn btn-red btn-sm"
                      onClick={(e) => { e.stopPropagation(); handleCheckIn(r.id); }}
                    >
                      Check In
                    </button>
                  </div>
                )}
                {r.transaction_number && (
                  <p className="text-muted mt-sm" style={{ fontSize: '0.72rem', fontFamily: 'monospace' }}>#{r.transaction_number}</p>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.75rem' }}>
                  <p className="text-dim" style={{ fontSize: '0.75rem', margin: 0 }}>Tap to view full details →</p>
                  {isCancelled && (
                    <button
                      className="btn btn-glass"
                      style={{ fontSize: '0.72rem', padding: '0.25rem 0.75rem', borderRadius: 6, opacity: recheckingId === r.id ? 0.6 : 1 }}
                      disabled={recheckingId === r.id}
                      onClick={(e) => { e.stopPropagation(); handleRecheck(r.id); }}
                    >
                      {recheckingId === r.id ? 'Checking…' : 'Recheck Status'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <ReservationModal
          reservation={selected}
          onClose={() => setSelected(null)}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}

export default ReservationsView;
