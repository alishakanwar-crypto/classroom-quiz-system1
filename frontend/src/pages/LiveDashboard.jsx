import { useEffect, useState, useRef } from 'react'
import { Camera, Radio, Users } from 'lucide-react'
import { getSessions, getSession, processFrameBase64, connectWS } from '../utils/api'
import { Link } from 'react-router-dom'

const OPTION_COLORS = {
  1: 'bg-blue-500',
  2: 'bg-green-500',
  3: 'bg-yellow-500',
  4: 'bg-purple-500',
}

export default function LiveDashboard() {
  const [sessions, setSessions] = useState([])
  const [activeSession, setActiveSession] = useState(null)
  const [detections, setDetections] = useState([])
  const wsRef = useRef(null)

  useEffect(() => {
    getSessions().then(setSessions)
    const ws = connectWS((msg) => {
      if (msg.type === 'detection_update') {
        setActiveSession(msg.data)
        if (msg.detections) setDetections(msg.detections)
      }
      if (msg.type === 'session_started' || msg.type === 'next_question') {
        setActiveSession(msg.data)
      }
      if (msg.type === 'session_ended') {
        setActiveSession(msg.data)
      }
    })
    wsRef.current = ws
    return () => ws.close()
  }, [])

  // Load active session on mount
  useEffect(() => {
    getSessions().then(ss => {
      setSessions(ss)
      const active = ss.find(s => s.status === 'active')
      if (active) getSession(active.id).then(setActiveSession)
    })
  }, [])

  const s = activeSession
  const q = s?.current_question

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Live Dashboard</h2>
        {s?.status === 'active' && (
          <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
            <Radio size={16} className="animate-pulse" /> Live
          </div>
        )}
      </div>

      {!s || s.status !== 'active' ? (
        <div className="bg-white rounded-xl shadow border p-12 text-center">
          <Camera size={48} className="mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500 mb-4">No active quiz session</p>
          <p className="text-sm text-gray-400">Start a quiz from the <Link to="/quizzes" className="text-indigo-600 hover:underline">Quiz Manager</Link> or <Link to="/" className="text-indigo-600 hover:underline">Dashboard</Link></p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Current Question */}
          {q && (
            <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl p-6 text-white shadow-lg">
              <p className="text-sm opacity-75 mb-1">{s.quiz_title} · Question {q.question_number}</p>
              <h3 className="text-2xl font-bold mb-4">{q.text}</h3>
              <div className="grid grid-cols-2 gap-2">
                {[1, 2, 3, 4].map(n => {
                  const optText = q[`option_${n}`]
                  if (!optText) return null
                  return (
                    <div key={n} className="bg-white/20 rounded-lg p-2 flex items-center gap-2 backdrop-blur">
                      <span className="bg-white/30 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">{n}</span>
                      <span className="text-sm">{optText}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Response Grid */}
          <div className="bg-white rounded-xl shadow border">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users size={18} className="text-gray-500" />
                <h3 className="font-semibold text-gray-700">Student Responses</h3>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-green-600 font-medium">{s.answered_count} answered</span>
                <span className="text-gray-400">|</span>
                <span className="text-gray-500">{s.total_students - s.answered_count} pending</span>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 p-4">
              {s.responses.map((r, i) => (
                <div
                  key={i}
                  className={`rounded-xl border-2 p-3 text-center transition-all ${
                    r.status === 'answered'
                      ? 'border-green-300 bg-green-50 shadow-sm'
                      : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-full mx-auto mb-2 flex items-center justify-center text-white text-lg font-bold ${
                    r.status === 'answered' && r.selected_option ? OPTION_COLORS[r.selected_option] : 'bg-gray-300'
                  }`}>
                    {r.status === 'answered' && r.selected_option ? r.selected_option : '?'}
                  </div>
                  <p className="text-xs font-medium text-gray-800 truncate">{r.student_name}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {r.status === 'answered' ? `Option ${r.selected_option}` : 'Waiting...'}
                  </p>
                </div>
              ))}
              {s.responses.length === 0 && (
                <div className="col-span-full py-8 text-center text-gray-400 text-sm">
                  No enrolled students
                </div>
              )}
            </div>
          </div>

          {/* Detection Feed */}
          {detections.length > 0 && (
            <div className="bg-white rounded-xl shadow border p-4">
              <h3 className="font-semibold text-sm text-gray-700 mb-3">Latest Detections</h3>
              <div className="space-y-2">
                {detections.map((d, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm bg-gray-50 rounded-lg p-2">
                    <div className={`w-2 h-2 rounded-full ${d.student_id ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <span className="font-medium">{d.student_name || 'Unknown'}</span>
                    {d.finger_count !== null && d.finger_count !== undefined && (
                      <span className="text-indigo-600 font-bold">{d.finger_count} finger{d.finger_count !== 1 ? 's' : ''} (stable)</span>
                    )}
                    {d.raw_finger_count !== null && d.raw_finger_count !== undefined && d.finger_count === null && (
                      <span className="text-gray-400">{d.raw_finger_count} finger{d.raw_finger_count !== 1 ? 's' : ''} (stabilizing...)</span>
                    )}
                    <span className="text-gray-400 text-xs ml-auto">{(d.confidence * 100).toFixed(0)}% confidence</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
