import React from 'react'
import { motion } from 'framer-motion'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { BookAudio } from 'lucide-react'
import { useChartTheme } from '../../hooks/useChartTheme'

// const recap = [
//     {name: "Chiffre d'affaire", value: 400},
//     {name: "Benefice", value: 550},
//     {name: "Utilisateur", value: 880},
//     {name: "Abonnes", value: 450}
// ]
const COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b"]

interface ResumeChartProps {
    data: Array<{ name: string, value: number}>;
  }
  
  const ResumeChart: React.FC<ResumeChartProps> = ({ data }) =>  {
    const chart = useChartTheme()
  return (
    <motion.div
    className='bg-surface rounded-xl p-6 border border-line'
    initial={{opacity:0, y:20}}
    animate={{opacity:1, y:0}}
    transition={{duration:1, ease:"easeInOut"}}
    >
        <h2 className='text-lg font-medium mb-4 text-fg-muted pb-4 flex gap-2' ><BookAudio color='#6366f1'/>Résumé</h2>
        <div className="h-80">
            <ResponsiveContainer
            width={"100%"}
            height={"100%"}
            >
                <PieChart>
                    <Pie
                    data = {data}
                    cx={"50%"}
                    cy={"50%"}
                    labelLine ={false}
                    outerRadius={80}
                    fill='#8884d8'
                    dataKey='value'
                    label= {({ name, value }) => `${name} : ${value}`}
                    >
                        {data.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                    </Pie>
                    <Tooltip 
                    contentStyle={chart.tooltip.contentStyle}
                    labelStyle={chart.tooltip.labelStyle}
                    itemStyle={chart.tooltip.itemStyle}
                    />
                    <Legend wrapperStyle={{ color: chart.text }} />
                </PieChart>
            </ResponsiveContainer>
        </div>
    </motion.div>
  )
}

export default ResumeChart
