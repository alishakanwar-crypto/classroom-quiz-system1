const API_BASE = '/api'

async function request(path, options = {}) {
  const { headers: customHeaders, ...restOptions } = options
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...customHeaders },
    ...restOptions,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  return res.json()
}

// Students
export const getStudents = () => request('/students')
export const createStudent = (data) => request('/students', { method: 'POST', body: JSON.stringify(data) })
export const deleteStudent = (id) => request(`/students/${id}`, { method: 'DELETE' })
export const uploadStudentPhoto = async (id, file) => {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE}/students/${id}/photo`, { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Upload failed')
  }
  return res.json()
}

// Quizzes
export const getQuizzes = () => request('/quizzes')
export const createQuiz = (data) => request('/quizzes', { method: 'POST', body: JSON.stringify(data) })
export const getQuiz = (id) => request(`/quizzes/${id}`)
export const deleteQuiz = (id) => request(`/quizzes/${id}`, { method: 'DELETE' })

// Questions
export const getQuestions = (quizId) => request(`/quizzes/${quizId}/questions`)
export const addQuestion = (quizId, data) => request(`/quizzes/${quizId}/questions`, { method: 'POST', body: JSON.stringify(data) })
export const deleteQuestion = (id) => request(`/questions/${id}`, { method: 'DELETE' })

// Sessions
export const startSession = (quizId) => request('/sessions', { method: 'POST', body: JSON.stringify({ quiz_id: quizId }) })
export const getSession = (id) => request(`/sessions/${id}`)
export const getSessions = () => request('/sessions')
export const nextQuestion = (id) => request(`/sessions/${id}/next-question`, { method: 'POST' })
export const endSession = (id) => request(`/sessions/${id}/end`, { method: 'POST' })
export const getSessionResults = (id) => request(`/sessions/${id}/results`)

// Camera
export const processFrameBase64 = (imageData) =>
  request('/process-frame-base64', { method: 'POST', body: JSON.stringify({ image: imageData }) })

// WebSocket with managed reconnection
export function connectWS(onMessage) {
  const state = { ws: null, closed: false, reconnectTimeout: null }

  function connect() {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`)
    state.ws = ws
    ws.onmessage = (e) => {
      if (!state.closed) onMessage(JSON.parse(e.data))
    }
    ws.onclose = () => {
      if (!state.closed) {
        state.reconnectTimeout = setTimeout(connect, 3000)
      }
    }
  }

  connect()

  return {
    close() {
      state.closed = true
      if (state.reconnectTimeout) clearTimeout(state.reconnectTimeout)
      if (state.ws) state.ws.close()
    }
  }
}
