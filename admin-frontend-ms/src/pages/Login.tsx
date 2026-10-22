import { easeInOut, motion } from "framer-motion";
// Imported, not a "/src/..." string: that path only exists on the dev server,
// so the logo 404'd on every deployed build (preprod AND prod).
import logoSbc from "../assets/logo-sbc.png";
import { useNavigate } from "react-router-dom";
import { useState, FormEvent, useEffect } from "react";
import { useAuth } from "../context/AuthContext";

function Login() {
  const navigate = useNavigate();
  const { login, verifyLoginCode, isAdminAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  // Set once the password is accepted: the admin then types the emailed code.
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [code, setCode] = useState('');

  useEffect(() => {
    if (isAdminAuthenticated) {
      navigate('/');
    }
  }, [isAdminAuthenticated, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!email) {
      setErrorMessage('Email is required');
      return;
    }
    if (!password) {
      setErrorMessage('Password is required');
      return;
    }

    try {
      const challenge = await login({ email, password });
      setPendingUserId(challenge.userId);
      setCode('');
    } catch (error: any) {
      setErrorMessage(error.message || 'Authentication failed. Please check credentials.');
    }
  };

  const handleCodeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    if (!pendingUserId) return;
    if (!code.trim()) {
      setErrorMessage('Entrez le code reçu par email');
      return;
    }
    try {
      await verifyLoginCode(pendingUserId, code.trim());
    } catch (error: any) {
      setErrorMessage(error.message || 'Code invalide ou expiré');
    }
  };

  return (
    <>
      <main className="flex flex-col w-full h-full overflow-auto  z-10 background">
        <div className="h-full w-auto flex justify-center items-center">
          <motion.div
            className="flex flex-col gap-5 justify-center bg-gray-700 bg-opacity-30 backdrop-blur-md shadow-lg rounded-xl p-6  content-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: easeInOut }}
          >
            <div className="flex items-center gap-2 justify-center">
              <img
                className="w-20 h-20 rounded-full object-cover"
                src={logoSbc}
                alt="Logo SBC"
              />
              <p className="text-xl font-medium">
                Administrateur Sniper <br /> Business Center
              </p>
            </div>
            <form onSubmit={pendingUserId ? handleCodeSubmit : handleSubmit} className="flex flex-col">
              {errorMessage && (
                <div className="bg-red-500 bg-opacity-70 text-white p-2 rounded-lg mb-3 text-sm">
                  {errorMessage}
                </div>
              )}

              {pendingUserId ? (
                <>
                  <p className="text-sm text-gray-300 mb-3">
                    Un code de connexion a été envoyé à {email}.
                  </p>
                  <input
                    type="text"
                    autoComplete="one-time-code"
                    placeholder="Code reçu par email"
                    className="bg-gray-700 bg-opacity-60 text-white placeholder-gray-400 rounded-lg pl-3 py-2 pr-4 sm:py-3 md:py-4 focus:outline-none focus:ring-2 focus:ring-gray-700 tracking-widest"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    disabled={isAuthLoading}
                    autoFocus
                    required
                  />
                  <button
                    type="button"
                    className="text-xs text-gray-400 hover:text-gray-200 mt-3 self-start"
                    onClick={() => { setPendingUserId(null); setCode(''); setErrorMessage(''); }}
                    disabled={isAuthLoading}
                  >
                    Retour
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="email"
                    placeholder="Email"
                    className="bg-gray-700 bg-opacity-60 text-white placeholder-gray-400 rounded-lg pl-3 py-2 pr-4 sm:py-3 md:py-4 focus:outline-none focus:ring-2 focus:ring-gray-700 mb-3"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isAuthLoading}
                    required
                  />

                  <input
                    type="password"
                    placeholder="Mot de passe"
                    className="bg-gray-700 bg-opacity-60 text-white placeholder-gray-400 rounded-lg pl-3 py-2 pr-4 sm:py-3 md:py-4 focus:outline-none focus:ring-2 focus:ring-gray-700"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isAuthLoading}
                    required
                  />
                </>
              )}

              <motion.button
                type="submit"
                className="bg-gray-700 bg-opacity-60 text-white rounded-lg py-2 mt-6 hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 1.2, ease: "easeInOut" }}
                disabled={isAuthLoading}
              >
                {isAuthLoading ? 'Connexion...' : pendingUserId ? 'Valider le code' : 'Se connecter'}
              </motion.button>
            </form>
          </motion.div>
        </div>
      </main>
    </>
  );
}

export default Login;
