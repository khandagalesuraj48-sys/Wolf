import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Setup } from './screens/Setup';

// Only screens that work are listed here; each new one comes with its own piece of work (docs/DESIGN_INVENTORY.md → Route).
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
