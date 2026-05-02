import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Play, Users, BookOpen, Clock } from 'lucide-react'
import { getQuizzes, getStudents, getSessions, startSession } from '../utils/api'

export default function TeacherDashboard() {
  const [quizzes, setQuizzes] = useState([])
  const [students, setStudents] = useState([])
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getQuizzes(), getStudents(), getSessions()])
      .then(([q, s, ss]) => { setQuizzes(q); setStudents(s); setSessions(ss) })
      .finally(() => setLoading(false))
  }, [])

  const handleStart = async (quizId) => {
    try {
      const session = await startSession(quizId)
      window.location.href = `/session/${session.session_id}`
    } catch (err) {
      alert(err.message)
    }
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>

  const activeSession = sessions.find(s => s.status === 'active')

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Teacher Dashboard</h2>

      {activeSession && (
        <Link
          to={`/session/${activeSession.id}`}
          className="block bg-green-50 border-2 border-green-300 rounded-xl p-4 hover:bg-green-100 transition"
        >
          <div className="flex items-center gap-3">
            <div className="bg-green-500 text-white p-2 rounded-lg animate-pulse">
              <Play size={20} />
            </div>
            <div>
              <p className="font-semibold text-green-800">Active Session: {activeSession.quiz_title}</p>
              <p className="text-sm text-green-600">Click to view live responses</p>
            </div>
          </div>
        </Link>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow p-5 border">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-indigo-100 text-indigo-600 p-2 rounded-lg"><BookOpen size={20} /></div>
            <h3 className="font-semibold text-gray-700">Quizzes</h3>
          </div>
          <p className="text-3xl font-bold text-gray-800">{quizzes.length}</p>
          <Link to="/quizzes" className="text-indigo-600 text-sm hover:underline">Manage quizzes →</Link>
        </div>

        <div className="bg-white rounded-xl shadow p-5 border">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-blue-100 text-blue-600 p-2 rounded-lg"><Users size={20} /></div>
            <h3 className="font-semibold text-gray-700">Students</h3>
          </div>
          <p className="text-3xl font-bold text-gray-800">{students.length}</p>
          <Link to="/students" className="text-blue-600 text-sm hover:underline">Manage students →</Link>
        </div>

        <div className="bg-white rounded-xl shadow p-5 border">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-purple-100 text-purple-600 p-2 rounded-lg"><Clock size={20} /></div>
            <h3 className="font-semibold text-gray-700">Sessions</h3>
          </div>
          <p className="text-3xl font-bold text-gray-800">{sessions.length}</p>
          <Link to="/results" className="text-purple-600 text-sm hover:underline">View results →</Link>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow border">
        <div className="p-4 border-b">
          <h3 className="font-semibold text-gray-700">Quick Start Quiz</h3>
        </div>
        <div className="divide-y">
          {quizzes.length === 0 ? (
            <div className="p-4 text-gray-500 text-center">
              No quizzes yet. <Link to="/quizzes" className="text-indigo-600 hover:underline">Create one</Link>
            </div>
          ) : (
            quizzes.map(q => (
              <div key={q.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                <div>
                  <p className="font-medium text-gray-800">{q.title}</p>
                  <p className="text-sm text-gray-500">{q.question_count} questions · {q.status}</p>
                </div>
                <button
                  onClick={() => handleStart(q.id)}
                  disabled={q.question_count === 0}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <Play size={14} /> Start
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
