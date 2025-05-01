import { motion } from "framer-motion";
import Header from "../components/common/Header";
import LinksCard from "../components/linksCard"; // Import the LinksCard component
import { Link2 } from "lucide-react"; // Import the Link2 icon

const ModifyLinks = () => {
  return (
    <div className="flex-1 overflow-auto relative z-10">
      <Header title="Modifier les liens" />
      <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8 ">
        <motion.div
          className="justify-center grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: "easeInOut" }}
        >
          {/* WhatsApp Link Card */}
          <LinksCard
            name="WhatsApp"
            icon={Link2}
            color="#6366F1"
          />

          {/* Telegram Link Card */}
          <LinksCard
            name="Telegram"
            icon={Link2}
            color="#6366F1"
          />
        </motion.div>
      </main>
    </div>
  );
};

export default ModifyLinks;
