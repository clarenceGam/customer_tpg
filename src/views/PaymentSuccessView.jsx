import { useEffect, useState, useRef } from 'react';
import { useView } from '../hooks/useView';
import { VIEWS } from '../contexts/ViewContext';
import { paymentService } from '../services/paymentService';
import { CheckCircle } from 'lucide-react';

const CART_STORAGE_KEY = 'bar_cart_data';

function PaymentSuccessView() {
  const { viewParams, navigate } = useView();
  const referenceId = viewParams.ref;
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState(5);
  const countdownRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const verifyPayment = async () => {
      if (!referenceId) {
        setLoading(false);
        navigate(VIEWS.RESERVATIONS);
        return;
      }

      // Mark this payment as seen immediately
      const paymentSessionKey = `payment_success_${referenceId}`;
      sessionStorage.setItem(paymentSessionKey, 'true');

      // Immediately replace URL to prevent reload loop
      window.history.replaceState({}, '', '/');

      try {
        await paymentService.confirmPaymentByReference(referenceId);
      } catch (_) {
        // fallback to read-only status if confirm cannot be resolved yet
      }

      try {
        const details = await paymentService.getPaymentByReference(referenceId);
        if (!cancelled) {
          setPayment(details);
          // BUG 5: Clear cart after confirmed successful payment
          if (details?.status === 'paid') {
            localStorage.removeItem(CART_STORAGE_KEY);
          }
        }
      } catch (_) {
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    verifyPayment();
    return () => {
      cancelled = true;
    };
  }, [referenceId, navigate]);

  useEffect(() => {
    if (loading) return;
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current);
          navigate(VIEWS.RESERVATIONS);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(countdownRef.current);
  }, [loading, navigate]);

  if (loading) {
    return (
      <div className="result-page">
        <div className="glass-card result-card">
          <div className="spinner" style={{ margin: '0 auto' }} />
          <p className="text-muted mt-md">Verifying payment...</p>
        </div>
      </div>
    );
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':');
    const hour = parseInt(h);
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const h12 = hour % 12 || 12;
    return `${h12}:${m} ${suffix}`;
  };

  return (
    <div className="result-page">
      <div className="glass-card result-card">
        <div className="result-icon"><CheckCircle size={52} strokeWidth={1.5} style={{ color: '#22c55e' }} /></div>
        <h1 style={{ fontFamily: "'Sora', sans-serif", fontSize: 'clamp(1.4rem, 3vw, 1.8rem)', fontWeight: 800, lineHeight: 1.1, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>PAYMENT <span style={{ color: 'var(--color-red-primary)' }}>CONFIRMED</span></h1>
        <p className="text-muted mt-sm">Your payment has been processed successfully.</p>

        {payment && (
          <div className="result-details">
            <div className="detail-row">
              <span>Reference Number</span>
              <strong>#{payment.transaction_number || payment.reference_id}</strong>
            </div>
            
            {payment.bar_name && (
              <div className="detail-row">
                <span>Bar</span>
                <strong>{payment.bar_name}</strong>
              </div>
            )}
            
            {payment.table_number && (
              <div className="detail-row">
                <span>Table</span>
                <strong>{payment.table_number}</strong>
              </div>
            )}
            
            {payment.reservation_date && (
              <div className="detail-row">
                <span>Date & Time</span>
                <strong>
                  {formatDate(payment.reservation_date)}
                  {payment.reservation_time && ` · ${formatTime(payment.reservation_time)}`}
                </strong>
              </div>
            )}
            
            {payment.party_size && (
              <div className="detail-row">
                <span>Party Size</span>
                <strong>{payment.party_size} {payment.party_size === 1 ? 'guest' : 'guests'}</strong>
              </div>
            )}

            {payment.line_items && payment.line_items.length > 0 && (
              <div className="detail-section mt-md">
                <p className="text-label mb-sm">Items Ordered:</p>
                {payment.line_items.map((item, idx) => (
                  <div key={idx} className="detail-row" style={{ fontSize: '0.9rem' }}>
                    <span>{item.item_name} x{item.quantity}</span>
                    <span>₱{Number(item.line_total || 0).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="detail-row mt-md" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.75rem' }}>
              <span>Total Paid</span>
              <strong style={{ fontSize: '1.2rem', color: '#dc2626' }}>₱{Number(payment.amount || 0).toFixed(2)}</strong>
            </div>
            
            <div className="detail-row">
              <span>Payment Method</span>
              <strong>{(payment.payment_method || '').toUpperCase()}</strong>
            </div>
          </div>
        )}

        <p className="text-muted" style={{ fontSize: '0.78rem', marginTop: '1rem' }}>
          Redirecting to reservations in <strong style={{ color: '#22c55e' }}>{countdown}s</strong>…
        </p>
        <div className="flex gap-md justify-center mt-sm">
          <button className="btn btn-red" onClick={() => { clearInterval(countdownRef.current); navigate(VIEWS.RESERVATIONS); }}>
            View My Reservations
          </button>
          <button className="btn btn-glass" onClick={() => { clearInterval(countdownRef.current); navigate(VIEWS.HOME); }}>
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}

export default PaymentSuccessView;
