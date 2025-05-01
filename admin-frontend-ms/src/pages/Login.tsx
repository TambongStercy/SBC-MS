import { easeInOut, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useState, FormEvent, useEffect } from "react";
import { useAuth } from "../context/AuthContext";

function Login() {
  const navigate = useNavigate();
  const { login, isAdminAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

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
      await login({ email, password });
    } catch (error: any) {
      console.error('Login error caught in component:', error);
      setErrorMessage(error.message || 'Authentication failed. Please check credentials.');
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
                src="/src/assets/logo-sbc.png"
                alt="Logo SBC"
              />
              <p className="text-xl font-medium">
                Administrateur Sniper <br /> Business Center
              </p>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col">
              {errorMessage && (
                <div className="bg-red-500 bg-opacity-70 text-white p-2 rounded-lg mb-3 text-sm">
                  {errorMessage}
                </div>
              )}

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

              <motion.button
                type="submit"
                className="bg-gray-700 bg-opacity-60 text-white rounded-lg py-2 mt-6 hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 1.2, ease: "easeInOut" }}
                disabled={isAuthLoading}
              >
                {isAuthLoading ? 'Connexion...' : 'Se connecter'}
              </motion.button>
            </form>
          </motion.div>
        </div>
      </main>
    </>
  );
}

export default Login;
