import { useEffect, useState, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { socialService } from '../../services/socialService';
import '../../styles/enhancements.css';

const navItems = [
  { to: '/dashboard', label: 'Home' },
  { to: '/dashboard/bars', label: 'Bars' },
  { to: '/map', label: 'Map' },
  { to: '/dashboard/events', label: 'Events' },
  { to: '/dashboard/reservations', label: 'Reservations' },
  { to: '/dashboard/payments', label: 'Payments' },
  { to: '/dashboard/profile', label: 'Profile' },
];

function Navbar() {
  const navigate = useNavigate();
  const { user, logout, isAuthenticated } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchUnread = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const data = await socialService.notifications(1);
      setUnreadCount(data?.unread_count || 0);
    } catch (_err) {
      // ignore
    }
  }, [isAuthenticated]);

  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
  }, [fetchUnread]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="navbar-wrap">
      <div className="container navbar">
        <div>
          <div className="brand">Party<span className="brand-accent">Goers</span></div>
          <div className="brand-sub">Discover · Reserve · Experience</div>
        </div>

        <nav className="nav-links">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="user-tools">
          <NavLink to="/dashboard/notifications" className="notification-bell" title="Notifications">
            🔔
            {unreadCount > 0 && <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </NavLink>
          <div className="user-profile-info">
            {user?.profile_picture ? (
              <img 
                src={`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/${user.profile_picture}`} 
                alt={user.first_name}
                className="user-avatar"
              />
            ) : (
              <div className="user-avatar-placeholder">{user?.first_name?.charAt(0) || 'U'}</div>
            )}
            <span className="desktop-only">{user?.first_name}</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={handleLogout} type="button">
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}

export default Navbar;
