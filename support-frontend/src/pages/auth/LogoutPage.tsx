import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/context';
import { FullScreenLoader } from '../../components/FullScreenLoader';

/** Revokes the session, then goes to the sign-in screen. */
export default function LogoutPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    void logout().then(() => { if (active) navigate('/connexion', { replace: true }); });
    return () => { active = false; };
  }, [logout, navigate]);
  return <FullScreenLoader label="Déconnexion…" />;
}
