import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const rootElement = document.getElementById('root');
let appRendered = false;

const isFirebasePermissionError = error => {
  const message = [error?.code, error?.message, error?.stack, String(error || '')]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return message.includes('permission_denied') || message.includes('permission denied');
};

const showStartupError = error => {
  const message = error?.stack || error?.message || String(error || 'Bilinmeyen hata');
  if (!rootElement) return;
  rootElement.innerHTML = `
    <div style="min-height:100vh;padding:24px;font-family:Arial,sans-serif;background:#fff;color:#13201c">
      <h1 style="font-size:22px;margin:0 0 12px">Eary acilis hatasi</h1>
      <p style="font-size:14px;line-height:1.45;margin:0 0 16px">Uygulama baslarken bir hata yakalandi. Bu ekrani Codex'e gonder.</p>
      <pre style="white-space:pre-wrap;word-break:break-word;background:#f2f5f4;border:1px solid #d8e0dd;border-radius:8px;padding:12px;font-size:12px;line-height:1.4">${message.replace(/[<>&]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[char]))}</pre>
    </div>
  `;
};

const handleGlobalRuntimeError = error => {
  if (!appRendered) {
    showStartupError(error);
    return;
  }

  if (isFirebasePermissionError(error)) {
    console.warn('Firebase permission error ignored after app start:', error);
    return;
  }

  console.error('Runtime error after app start:', error);
};

window.addEventListener('error', event => handleGlobalRuntimeError(event.error || event.message));
window.addEventListener('unhandledrejection', event => {
  handleGlobalRuntimeError(event.reason);
  if (appRendered && isFirebasePermissionError(event.reason)) event.preventDefault();
});

class StartupErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    showStartupError(error);
  }

  render() {
    if (this.state.error) return null;
    return this.props.children;
  }
}

try {
  createRoot(rootElement).render(
    <StrictMode>
      <StartupErrorBoundary>
        <App />
      </StartupErrorBoundary>
    </StrictMode>,
  )
  appRendered = true;
} catch (error) {
  showStartupError(error);
}
