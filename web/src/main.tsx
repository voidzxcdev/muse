import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import '@/hooks/theme';
import '@/lib/router';
import '@/lib/services';
import '@/player/store';
import App from './App';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
