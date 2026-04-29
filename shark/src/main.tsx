import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App';
import { config } from './config';
import './index.css';

const PUBLISHABLE_KEY = config.clerkPublishableKey;
const isPlaceholder = PUBLISHABLE_KEY.includes('replace') || PUBLISHABLE_KEY === 'pk_test_xxxxx';

const root = ReactDOM.createRoot(document.getElementById('root')!);

if (isPlaceholder) {
  root.render(
    <React.StrictMode>
      <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', color: '#b45309' }}>
        <h1>SharkTalents — Clerk no configurado</h1>
        <p>
          Setear <code>VITE_CLERK_PUBLISHABLE_KEY</code> en <code>shark/.env.development</code> con
          una key real de <a href="https://dashboard.clerk.com">Clerk dashboard</a>.
        </p>
      </div>
    </React.StrictMode>,
  );
} else {
  root.render(
    <React.StrictMode>
      <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
        <App />
      </ClerkProvider>
    </React.StrictMode>,
  );
}
