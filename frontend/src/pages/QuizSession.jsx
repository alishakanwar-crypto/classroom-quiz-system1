import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Camera, SkipForward, Square, Clock, Hand, User } from 'lucide-react'
import { getSession, nextQuestion, endSession, processFrameBase64, connectWS } from '../utils/api'

const OPTION_LABELS = { 1: '1 finger', 2: '2 fingers', 3: '3 fingers', 4: '4 fingers' }
const OPTION_COLORS = {
  1: 'bg-blue-100 text-blue-700 border-blue-300',
  2: 'bg-green-100 text-green-700 border-green-300',
  3: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  4: 'bg-purple-100 text-purple-700 border-purple-300',
}

export default function QuizSession() {
  const { sessionId } = useParams()
  const [session, setSession] = useState(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [timeLeft, setTimeLeft] = useState(null)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const intervalRef = useRef(null)
  const timerRef = useRef(null)
  const wsRef = useRef(null)

  const loadSession = useCallback(async () => {
    const data = await getSession(sessionId)
    setSession(data)
    if (data.current_question) {
      setTimeLeft(data.current_question.time_limit)
    }
  }, [sessionId])

  useEffect(() => {
    loadSession()
    const ws = connectWS((msg) => {
      if (msg.data?.session_id === parseInt(sessionId)) {
        setSession(msg.data)
      }
    })
    wsRef.current = ws
    return () => { ws.close(); stopCamera() }
  }, [sessionId, loadSession])

  // Countdown timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (session?.status === 'active' && timeLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) { clearInterval(timerRef.current); return 0 }
          return prev - 1
        })
      }, 1000)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [session?.current_question?.id, session?.status])

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        setCameraActive(true)
        // Start sending frames to backend
        intervalRef.current = setInterval(captureAndSend, 1000)
      } else {
        stream.getTracks().forEach(t => t.stop())
      }
    } catch (err) {
      alert('Camera access denied: ' + err.message)
    }
  }

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(t => t.stop())
      videoRef.current.srcObject = null
    }
    if (intervalRef.current) clearInterval(intervalRef.current)
    setCameraActive(false)
  }

  const captureAndSend = async () => {
    if (!videoRef.current || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    canvas.width = videoRef.current.videoWidth
    canvas.height = videoRef.current.videoHeight
    ctx.drawImage(videoRef.current, 0, 0)
    const imageData = canvas.toDataURL('image/jpeg', 0.7)
    try {
      await processFrameBase64(imageData)
    } catch {
      // Silently continue if frame processing fails
    }
  }

  const handleNext = async () => {
    const data = await nextQuestion(sessionId)
    setSession(data)
    if (data.current_question) setTimeLeft(data.current_question.time_limit)
  }

  const handleEnd = async () => {
    if (!confirm('End this quiz session?')) return
    stopCamera()
    const data = await endSession(sessionId)
    setSession(data)
  }

  if (!session) return <div className="text-center py-12 text-gray-500">Loading session...</div>

  const q = session.current_question
  const isActive = session.status === 'active'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">{session.quiz_title}</h2>
          <p className="text-sm text-gray-500">
            Session #{session.session_id} · Status: <span className={isActive ? 'text-green-600 font-semibold' : 'text-gray-600'}>{session.status}</span>
          </p>
        </div>
        {isActive && (
          <div className="flex gap-2">
            <button onClick={cameraActive ? stopCamera : startCamera} className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 ${cameraActive ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
              <Camera size={16} /> {cameraActive ? 'Stop Camera' : 'Start Camera'}
            </button>
            <button onClick={handleNext} className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-1.5">
              <SkipForward size={16} /> Next Question
            </button>
            <button onClick={handleEnd} className="bg-red-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-red-700 flex items-center gap-1.5">
              <Square size={16} /> End Quiz
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Question Display (Smart Board view) */}
        <div className="lg:col-span-2 space-y-4">
          {q ? (
            <div className="bg-white rounded-xl shadow-lg border-2 border-indigo-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-1 rounded">Question {q.question_number}</span>
                {isActive && (
                  <div className={`flex items-center gap-1.5 text-sm font-bold ${timeLeft <= 5 ? 'text-red-600 animate-pulse' : 'text-gray-600'}`}>
                    <Clock size={16} /> {timeLeft}s
                  </div>
                )}
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-4">{q.text}</h3>
              <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 4].map(n => {
                  const optText = q[`option_${n}`]
                  if (!optText) return null
                  const isCorrect = session.status === 'completed' && q.correct_option === n
                  return (
                    <div key={n} className={`rounded-lg border-2 p-3 flex items-center gap-3 ${isCorrect ? 'border-green-500 bg-green-50' : 'border-gray-200'}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${OPTION_COLORS[n]} border`}>
                        {n}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{optText}</p>
                        <p className="text-xs text-gray-400">{OPTION_LABELS[n]}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* Timer bar */}
              {isActive && q.time_limit > 0 && (
                <div className="mt-4 bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div className="bg-indigo-500 h-2 rounded-full transition-all duration-1000" style={{ width: `${(timeLeft / q.time_limit) * 100}%` }} />
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow border p-8 text-center text-gray-400">
              {session.status === 'completed' ? 'Quiz completed!' : 'No question loaded'}
            </div>
          )}

          {/* Camera feed */}
          <div className="bg-black rounded-xl overflow-hidden relative" style={{ minHeight: 300 }}>
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-auto" />
            <canvas ref={canvasRef} className="hidden" />
            {!cameraActive && (
              <div className="absolute inset-0 flex items-center justify-center text-white text-sm">
                <div className="text-center">
                  <Camera size={40} className="mx-auto mb-2 opacity-50" />
                  <p className="opacity-50">Camera feed will appear here</p>
                  {isActive && <button onClick={startCamera} className="mt-2 bg-blue-600 px-4 py-2 rounded-lg text-sm hover:bg-blue-700">Start Camera</button>}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Live Response Panel */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow border">
            <div className="p-3 border-b flex items-center justify-between">
              <h3 className="font-semibold text-sm text-gray-700">Live Responses</h3>
              <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                {session.answered_count}/{session.total_students}
              </span>
            </div>
            <div className="divide-y max-h-[500px] overflow-y-auto">
              {session.responses.length === 0 ? (
                <div className="p-4 text-center text-gray-400 text-sm">No students enrolled</div>
              ) : (
                session.responses.map((r, i) => (
                  <div key={i} className="p-3 flex items-center justify-between hover:bg-gray-50">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${r.status === 'answered' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                        {r.status === 'answered' ? <Hand size={14} /> : <User size={14} />}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{r.student_name}</p>
                        <p className="text-xs text-gray-400">{r.status === 'answered' ? `Option ${r.selected_option}` : 'Pending...'}</p>
                      </div>
                    </div>
                    {r.status === 'answered' && r.selected_option && (
                      <span className={`text-xs font-bold px-2 py-1 rounded border ${OPTION_COLORS[r.selected_option]}`}>
                        {r.selected_option}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Progress */}
          <div className="bg-white rounded-xl shadow border p-4">
            <h3 className="font-semibold text-sm text-gray-700 mb-2">Progress</h3>
            <div className="bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="bg-green-500 h-3 rounded-full transition-all"
                style={{ width: session.total_students ? `${(session.answered_count / session.total_students) * 100}%` : '0%' }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {session.answered_count} of {session.total_students} students answered
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
