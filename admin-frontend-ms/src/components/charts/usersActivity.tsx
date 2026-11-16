
import { motion } from 'framer-motion'
import { User, Users } from 'lucide-react'

const COLORS = ["#F59E0B", "#10B981"]
const userActivity = [
    {name: "En ligne aujourd'hui", value: 400},
    {name: "Actuellement connecté", value: 550}
]
function UsersActivity() {
  return (
    <motion.div
    className='bg-surface rounded-xl p-6 border border-line'
    initial={{opacity:0, y:20}}
    animate={{opacity:1, y:0}}
    transition={{duration:1, ease:"easeInOut"}}
    >
        <h2 className="text-lg font-medium text-fg-muted flex gap-2">< User color='#6366F1'/>Utilisateurs</h2>
        <div className="flex flex-wrap content-center justify-center gap-10">
            <div className="flex text-xl gap-2 justify-around"><Users size={25} color={COLORS[0]}/><p>{userActivity[0].value}</p></div>
            <div className="flex text-xl gap-2 justify-around"><Users size={25} color={COLORS[1]}/><p>{userActivity[1].value}</p></div>
        </div>
    </motion.div>
  )
}

export default UsersActivity
