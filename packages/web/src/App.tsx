import { BrowserRouter, Route, Routes } from 'react-router-dom';
import LandingPage from './pages/LandingPage.tsx';
import RoomPage from './pages/RoomPage.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { ToastProvider } from './components/Toast.tsx';

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/r/:slug" element={<RoomPage />} />
            {/* Fallback */}
            <Route path="*" element={<LandingPage />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  );
}
