import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { BookOpen, Users, Play, BarChart3, Camera } from 'lucide-react'
import TeacherDashboard from './pages/TeacherDashboard'
import StudentManager from './pages/StudentManager'
import QuizManager from './pages/QuizManager'
import QuizSession from './pages/QuizSession'
import LiveDashboard from './pages/LiveDashboard'
import Results from './pages/Results'

const NAV = [
  { path: '/', label: 'Dashboard', icon: BookOpen },
  { path: '/students', label: 'Students', icon: Users },
  { path: '/quizzes', label: 'Quizzes', icon: BookOpen },
  { path: '/live', label: 'Live', icon: Camera },
  { path: '/results', label: 'Results', icon: BarChart3 },
]

export default function App() {
  const location = useLocation()

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-indigo-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BookOpen size={24} />
            Classroom Quiz System
          </h1>
          <nav className="flex gap-1">
            {NAV.map(({ path, label, icon: Icon }) => (
              <Link
                key={path}
                to={path}
                className={`px-3 py-2 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${
                  location.pathname === path
                    ? 'bg-indigo-700 text-white'
                    : 'text-indigo-100 hover:bg-indigo-500'
                }`}
              >
                <Icon size={16} />
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-4 py-6 w-full">
        <Routes>
          <Route path="/" element={<TeacherDashboard />} />
          <Route path="/students" element={<StudentManager />} />
          <Route path="/quizzes" element={<QuizManager />} />
          <Route path="/session/:sessionId" element={<QuizSession />} />
          <Route path="/live" element={<LiveDashboard />} />
          <Route path="/results" element={<Results />} />
        </Routes>
      </main>
    </div>
  )
}
