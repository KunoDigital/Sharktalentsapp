import { Navigate, Outlet } from 'react-router-dom';
import { getAuthToken } from '../services/api';

export default function RequireAuth() {
  const token = getAuthToken();
  if (!token) return <Navigate to="/admin/login" replace />;
  return <Outlet />;
}
