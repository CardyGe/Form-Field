import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import LiveOutput from './ui/LiveOutput';
import MapOutput from './ui/MapOutput';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(location.hash === '#live-output' ? <LiveOutput /> : location.hash === '#map-output' ? <MapOutput /> : <React.StrictMode><App /></React.StrictMode>);
