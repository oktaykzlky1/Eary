import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { AlertTriangle, CheckCircle2, Loader2, LogOut, RefreshCw, ShieldCheck, UserX } from 'lucide-react';
import { auth, callAdminDashboard, callSetUserSuspended } from './firebase';

const formatDate = value => {
  if (!value) return 'Bilinmiyor';
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
};

export default function App() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  const filteredUsers = useMemo(() => {
    const term = query.trim().toLowerCase();
    const users = dashboard?.users || [];
    if (!term) return users;
    return users.filter(item => (
      item.username.includes(term) ||
      item.nickname.toLowerCase().includes(term) ||
      item.contactHint.toLowerCase().includes(term)
    ));
  }, [dashboard, query]);

  const loadDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await callAdminDashboard();
      setDashboard(result.data);
    } catch (err) {
      setError(err.message || 'Admin verileri alınamadı.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) loadDashboard();
    else setDashboard(null);
  }, [user]);

  const handleLogin = async event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setPassword('');
    } catch {
      setError('Giriş başarısız. Admin e-posta/şifre ve yetki kaydını kontrol edin.');
    } finally {
      setBusy(false);
    }
  };

  const toggleSuspended = async item => {
    setError('');
    try {
      await callSetUserSuspended({ username: item.username, suspended: !item.suspended });
      await loadDashboard();
    } catch (err) {
      setError(err.message || 'Kullanıcı durumu güncellenemedi.');
    }
  };

  if (!user) {
    return (
      <main className="login-shell">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="brand-mark">E</div>
          <h1>Eary Admin</h1>
          <p>Yalnızca yetkili hesaplar kullanıcı ve güvenlik yönetimine erişebilir.</p>
          {error && <div className="notice error"><AlertTriangle size={17} />{error}</div>}
          <label>E-posta<input value={email} onChange={event => setEmail(event.target.value)} type="email" autoComplete="email" required /></label>
          <label>Şifre<input value={password} onChange={event => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>
          <button type="submit" disabled={busy}>{busy ? 'Giriş yapılıyor...' : 'Giriş yap'}</button>
          <span className="hint">İlk admin için Firebase Console’da `adminUsers/&lt;uid&gt;/enabled = true` eklenmeli.</span>
        </form>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">Eary Admin</span>
          <h1>Kullanıcı ve Güvenlik</h1>
        </div>
        <div className="topbar-actions">
          <button type="button" className="secondary" onClick={loadDashboard} disabled={loading}><RefreshCw size={17} />Yenile</button>
          <button type="button" className="danger-soft" onClick={() => signOut(auth)}><LogOut size={17} />Çıkış</button>
        </div>
      </header>

      {error && <div className="notice error"><AlertTriangle size={17} />{error}</div>}

      <section className="stats-grid">
        <article><span>Kullanıcı</span><strong>{dashboard?.stats?.users ?? '-'}</strong></article>
        <article><span>Doğrulanmış</span><strong>{dashboard?.stats?.verifiedContacts ?? '-'}</strong></article>
        <article><span>Askıya alınan</span><strong>{dashboard?.stats?.suspendedUsers ?? '-'}</strong></article>
        <article><span>Silme talebi</span><strong>{dashboard?.stats?.deletionRequests ?? '-'}</strong></article>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Kayıtlı kullanıcılar</h2>
            <p>Son 100 kullanıcı, doğrulama ve askıya alma durumuyla listelenir.</p>
          </div>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Kullanıcı ara" />
        </div>

        {loading ? (
          <div className="empty"><Loader2 className="spin" size={24} />Yükleniyor...</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kullanıcı</th>
                  <th>İletişim</th>
                  <th>Kayıt</th>
                  <th>Durum</th>
                  <th>Aksiyon</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(item => (
                  <tr key={item.username}>
                    <td><strong>@{item.username}</strong><span>{item.nickname}</span></td>
                    <td><strong>{item.contactMethod}</strong><span>{item.contactHint || 'Bağlı değil'}</span></td>
                    <td>{formatDate(item.createdAt)}</td>
                    <td>{item.suspended ? <span className="badge danger">Askıda</span> : item.contactVerified ? <span className="badge ok"><CheckCircle2 size={14} />Doğrulu</span> : <span className="badge">Normal</span>}</td>
                    <td><button type="button" className={item.suspended ? 'secondary' : 'danger-soft'} onClick={() => toggleSuspended(item)}>{item.suspended ? <ShieldCheck size={16} /> : <UserX size={16} />}{item.suspended ? 'Aktifleştir' : 'Askıya al'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
