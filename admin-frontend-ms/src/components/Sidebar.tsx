import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart2,
  Users,
  HandshakeIcon,
  Grip,
  Power,
  Package,
  Ticket,
  Receipt,
  Settings,
  Wallet,
  Send,
  Bell,
  Hammer
} from "lucide-react";
import { Link, NavLink } from "react-router-dom";

const SIDEBAR_ITEMS = [
  {
    name: "Resume",
    icon: BarChart2,
    color: "#6366f1",
    path: "/",
  },
  {
    name: "Fix FeexPay Payments",
    icon: Hammer,
    color: "#f59e0b",
    path: "/fix-feexpay-payments",
  },
  {
    name: "Utilisateurs",
    icon: Users,
    color: "#8b5cf6",
    path: "/users",
  },
  {
    name: "Partenaires",
    icon: HandshakeIcon,
    color: "#ec4899",
    path: "/partners",
  },
  {
    name: "Produits",
    icon: Package,
    color: "#10b981",
    path: "/products",
  },
  {
    name: "Tombola",
    icon: Ticket,
    color: "#3b82f6",
    path: "/tombola",
  },
  {
    name: "Transactions",
    icon: Receipt,
    color: "#f472b6",
    path: "/transactions",
  },
  {
    name: "Account Transactions",
    icon: Wallet,
    color: "#10b981",
    path: "/account-transactions",
  },
  {
    name: "Settings",
    icon: Settings,
    color: "#ec4899",
    path: "/settings",
  },
  {
    name: "Notifications",
    icon: Send,
    color: "#10b981",
    path: "/notifications",
  },
  {
    name: "Deconnexion",
    icon: Power,
    color: "red",
    path: "/logout",
  },
];

function Sidebar() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Define helper function for NavLink classes
  const linkClasses = (isActive: boolean): string => {
    const baseClasses = "flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors duration-150 ease-in-out";
    if (isActive) {
      return `${baseClasses} bg-gray-900 text-white`;
    } else {
      return `${baseClasses} text-gray-300 hover:bg-gray-700 hover:text-white`;
    }
  };

  return (
    <motion.div
      className={`relative z-10 transition-all duration-300 ease-in-out flex-shrink-0 ${isSidebarOpen ? "w-64" : "w-20"}`}
      animate={{ width: isSidebarOpen ? 256 : 80 }}
    >
      <div className="h-full bg-gray-800 bg-opacity-50 backdrop-blur-md p-4 flex flex-col border-r border-gray-700">
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 1.1 }}
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="p-2 rounded-full hover:bg-gray-700 transition-colors max-w-fit"
        >
          <Grip size={24} />
        </motion.button>
        <nav className="mt-8 flex-grow">
          {SIDEBAR_ITEMS.map((item) => (
            <Link key={item.path} to={item.path}>
              <motion.div className="flex items-center p-4 text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors mb-2">
                <item.icon
                  size={20}
                  style={{ color: item.color, minWidth: "20px" }}
                />

                <AnimatePresence>
                  {isSidebarOpen && (
                    <motion.span
                      className="ml-4 whitespace-nowrap"
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: "auto" }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.2, delay: 0.3 }}
                    >
                      {item.name}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.div>
            </Link>
          ))}
        </nav>
      </div>
    </motion.div>
  );
}

export default Sidebar;
