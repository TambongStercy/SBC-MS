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
  Hammer,
  HardDrive,
  LifeBuoy,
  MessageSquare,
  Activity,
  Target,
  CheckSquare,
  ChevronDown,
  ChevronRight
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";

// Define menu groups with collapsible sections
const SIDEBAR_GROUPS = [
  {
    id: "dashboard",
    name: "Dashboard",
    items: [
      {
        name: "Resume",
        icon: BarChart2,
        color: "#6366f1",
        path: "/",
      },
    ]
  },
  {
    id: "admin-tools",
    name: "Admin Tools",
    items: [
      {
        name: "Fix FeexPay Payments",
        icon: Hammer,
        color: "#f59e0b",
        path: "/fix-feexpay-payments",
      },
      {
        name: "Récupération de Paiement",
        icon: LifeBuoy,
        color: "#10b981",
        path: "/manual-payment-recovery",
      },
    ]
  },
  {
    id: "core",
    name: "Core Management",
    items: [
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
    ]
  },
  {
    id: "financial",
    name: "Financial",
    items: [
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
        name: "Withdrawal Approvals",
        icon: CheckSquare,
        color: "#f59e0b",
        path: "/withdrawals/approvals",
      },
    ]
  },
  {
    id: "relance",
    name: "Relance",
    items: [
      {
        name: "Dashboard",
        icon: Activity,
        color: "#06b6d4",
        path: "/relance/dashboard",
      },
      {
        name: "Messages",
        icon: MessageSquare,
        color: "#8b5cf6",
        path: "/relance/messages",
      },
      {
        name: "Campaigns",
        icon: Target,
        color: "#a855f7",
        path: "/relance/campaigns",
      },
    ]
  },
  {
    id: "system",
    name: "System",
    items: [
      {
        name: "Settings",
        icon: Settings,
        color: "#ec4899",
        path: "/settings",
      },
      {
        name: "Storage Monitor",
        icon: HardDrive,
        color: "#06b6d4",
        path: "/storage",
      },
      {
        name: "Notifications",
        icon: Send,
        color: "#10b981",
        path: "/notifications",
      },
    ]
  },
];

function Sidebar() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([
    "dashboard", // Dashboard always expanded by default
    "financial", // Financial expanded to show new Withdrawal Approvals
  ]);
  const location = useLocation();

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) =>
      prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId]
    );
  };

  const isGroupActive = (groupItems: any[]) => {
    return groupItems.some((item) => location.pathname === item.path);
  };

  return (
    <motion.div
      className={`relative z-20 transition-all duration-300 ease-in-out flex-shrink-0 ${isSidebarOpen ? "w-64" : "w-20"}`}
      animate={{ width: isSidebarOpen ? 256 : 80 }}
    >
      <div className="h-screen bg-gray-800 bg-opacity-90 backdrop-blur-md flex flex-col border-r border-gray-700 shadow-lg">
        {/* Header with toggle button */}
        <div className="p-4 border-b border-gray-700">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 rounded-lg hover:bg-gray-700 transition-colors w-full flex justify-center text-gray-300 hover:text-white"
            title={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <Grip size={24} className="text-gray-300" />
          </motion.button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
          <div className="space-y-3">
            {SIDEBAR_GROUPS.map((group) => {
              const isExpanded = expandedGroups.includes(group.id);
              const isActive = isGroupActive(group.items);

              return (
                <div key={group.id} className="space-y-1">
                  {/* Group Header - Only show when sidebar is open */}
                  {isSidebarOpen ? (
                    <motion.button
                      onClick={() => toggleGroup(group.id)}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider rounded-lg transition-all ${
                        isActive
                          ? "text-white bg-gray-700"
                          : "text-gray-400 hover:text-gray-200 hover:bg-gray-700"
                      }`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <span>{group.name}</span>
                      {isExpanded ? (
                        <ChevronDown size={16} />
                      ) : (
                        <ChevronRight size={16} />
                      )}
                    </motion.button>
                  ) : (
                    // Divider when sidebar is collapsed
                    <div className="h-px bg-gray-700 mx-2" />
                  )}

                  {/* Group Items */}
                  <AnimatePresence>
                    {(isExpanded || !isSidebarOpen) && (
                      <motion.div
                        initial={isSidebarOpen ? { height: 0, opacity: 0 } : undefined}
                        animate={isSidebarOpen ? { height: "auto", opacity: 1 } : undefined}
                        exit={isSidebarOpen ? { height: 0, opacity: 0 } : undefined}
                        transition={{ duration: 0.2 }}
                        className="space-y-1"
                      >
                        {group.items.map((item) => {
                          const isItemActive = location.pathname === item.path;

                          return (
                            <Link key={item.path} to={item.path}>
                              <motion.div
                                className={`flex items-center px-3 py-3 text-sm font-medium rounded-lg transition-all duration-200 group relative ${
                                  isItemActive
                                    ? "bg-gray-700 text-white shadow-md"
                                    : "text-gray-300 hover:bg-gray-700 hover:text-white"
                                }`}
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                              >
                                {/* Icon container with fixed width */}
                                <div className="flex items-center justify-center w-6 h-6 flex-shrink-0">
                                  <item.icon
                                    size={20}
                                    className={`transition-colors duration-200 ${
                                      isItemActive
                                        ? "text-white"
                                        : "text-gray-400 group-hover:text-white"
                                    }`}
                                    style={{
                                      color: isItemActive ? "white" : item.color,
                                    }}
                                  />
                                </div>

                                {/* Text with animation */}
                                <AnimatePresence>
                                  {isSidebarOpen && (
                                    <motion.span
                                      className="ml-3 whitespace-nowrap overflow-hidden"
                                      initial={{ opacity: 0, width: 0 }}
                                      animate={{ opacity: 1, width: "auto" }}
                                      exit={{ opacity: 0, width: 0 }}
                                      transition={{ duration: 0.2, delay: 0.1 }}
                                    >
                                      {item.name}
                                    </motion.span>
                                  )}
                                </AnimatePresence>

                                {/* Tooltip for collapsed state */}
                                {!isSidebarOpen && (
                                  <div className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                                    {item.name}
                                  </div>
                                )}
                              </motion.div>
                            </Link>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}

            {/* Logout - Always visible, not in a group */}
            <div className="pt-3 border-t border-gray-700 mt-3">
              <Link to="/logout">
                <motion.div
                  className="flex items-center px-3 py-3 text-sm font-medium rounded-lg transition-all duration-200 group text-red-400 hover:bg-red-900 hover:text-white relative"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="flex items-center justify-center w-6 h-6 flex-shrink-0">
                    <Power size={20} />
                  </div>

                  <AnimatePresence>
                    {isSidebarOpen && (
                      <motion.span
                        className="ml-3 whitespace-nowrap overflow-hidden"
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: "auto" }}
                        exit={{ opacity: 0, width: 0 }}
                        transition={{ duration: 0.2, delay: 0.1 }}
                      >
                        Deconnexion
                      </motion.span>
                    )}
                  </AnimatePresence>

                  {!isSidebarOpen && (
                    <div className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                      Deconnexion
                    </div>
                  )}
                </motion.div>
              </Link>
            </div>
          </div>
        </nav>

        {/* Footer */}
        {isSidebarOpen && (
          <motion.div
            className="p-4 border-t border-gray-700"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, delay: 0.1 }}
          >
            <div className="text-xs text-gray-400 text-center">
              Admin Panel v1.0
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

export default Sidebar;
