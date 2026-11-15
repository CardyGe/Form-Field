import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import LiveOutput from './ui/LiveOutput';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(location.hash === '#live-output' ? <LiveOutput /> : <React.StrictMode><App /></React.StrictMode>);
