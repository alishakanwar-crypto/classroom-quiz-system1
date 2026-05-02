import { useEffect, useState } from 'react'
import { Plus, Trash2, Play, ChevronDown, ChevronUp } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { getQuizzes, createQuiz, deleteQuiz, getQuestions, addQuestion, deleteQuestion, startSession } from '../utils/api'

export default function QuizManager() {
  const [quizzes, setQuizzes] = useState([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [questions, setQuestions] = useState([])
  const [newQ, setNewQ] = useState({ text: '', option_1: '', option_2: '', option_3: '', option_4: '', correct_option: null, time_limit: 15 })
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  const load = () => getQuizzes().then(setQuizzes).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const handleCreateQuiz = async (e) => {
    e.preventDefault()
    if (!title.trim()) return
    await createQuiz({ title: title.trim(), description: description.trim() || null })
    setTitle('')
    setDescription('')
    load()
  }

  const handleDeleteQuiz = async (id) => {
    if (!confirm('Delete this quiz and all its questions?')) return
    await deleteQuiz(id)
    if (expanded === id) setExpanded(null)
    load()
  }

  const toggleExpand = async (quizId) => {
    if (expanded === quizId) { setExpanded(null); return }
    const qs = await getQuestions(quizId)
    setQuestions(qs)
    setExpanded(quizId)
  }

  const handleAddQuestion = async (quizId) => {
    if (!newQ.text.trim() || !newQ.option_1.trim() || !newQ.option_2.trim()) return
    await addQuestion(quizId, {
      ...newQ,
      correct_option: newQ.correct_option || null,
    })
    setNewQ({ text: '', option_1: '', option_2: '', option_3: '', option_4: '', correct_option: null, time_limit: 15 })
    const qs = await getQuestions(quizId)
    setQuestions(qs)
    load()
  }

  const handleDeleteQuestion = async (qId, quizId) => {
    await deleteQuestion(qId)
    const qs = await getQuestions(quizId)
    setQuestions(qs)
    load()
  }

  const handleStart = async (quizId) => {
    try {
      const session = await startSession(quizId)
      navigate(`/session/${session.session_id}`)
    } catch (err) {
      alert(err.message)
    }
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Quiz Management</h2>

      <form onSubmit={handleCreateQuiz} className="bg-white rounded-xl shadow border p-4 space-y-3">
        <div className="flex gap-3">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Quiz title" className="flex-1 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500" required />
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" className="flex-1 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500" />
          <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-1.5 whitespace-nowrap">
            <Plus size={16} /> Create Quiz
          </button>
        </div>
      </form>

      <div className="space-y-3">
        {quizzes.map(q => (
          <div key={q.id} className="bg-white rounded-xl shadow border overflow-hidden">
            <div className="p-4 flex items-center justify-between">
              <button onClick={() => toggleExpand(q.id)} className="flex items-center gap-2 text-left flex-1">
                {expanded === q.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                <div>
                  <p className="font-semibold text-gray-800">{q.title}</p>
                  <p className="text-xs text-gray-500">{q.question_count} questions · {q.description || 'No description'}</p>
                </div>
              </button>
              <div className="flex gap-2">
                <button onClick={() => handleStart(q.id)} disabled={q.question_count === 0} className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-1">
                  <Play size={12} /> Start
                </button>
                <button onClick={() => handleDeleteQuiz(q.id)} className="text-red-500 hover:text-red-700 p-1.5">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {expanded === q.id && (
              <div className="border-t bg-gray-50 p-4 space-y-4">
                {questions.map(qn => (
                  <div key={qn.id} className="bg-white rounded-lg border p-3 flex justify-between items-start">
                    <div className="space-y-1">
                      <p className="font-medium text-sm">Q{qn.question_number}: {qn.text}</p>
                      <div className="flex gap-3 text-xs text-gray-500">
                        <span className={qn.correct_option === 1 ? 'text-green-600 font-bold' : ''}>1. {qn.option_1}</span>
                        <span className={qn.correct_option === 2 ? 'text-green-600 font-bold' : ''}>2. {qn.option_2}</span>
                        {qn.option_3 && <span className={qn.correct_option === 3 ? 'text-green-600 font-bold' : ''}>3. {qn.option_3}</span>}
                        {qn.option_4 && <span className={qn.correct_option === 4 ? 'text-green-600 font-bold' : ''}>4. {qn.option_4}</span>}
                      </div>
                      <p className="text-xs text-gray-400">Time limit: {qn.time_limit}s</p>
                    </div>
                    <button onClick={() => handleDeleteQuestion(qn.id, q.id)} className="text-red-400 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}

                <div className="bg-white rounded-lg border p-3 space-y-2">
                  <p className="text-sm font-medium text-gray-600">Add Question</p>
                  <input value={newQ.text} onChange={e => setNewQ({ ...newQ, text: e.target.value })} placeholder="Question text" className="w-full border rounded px-2 py-1.5 text-sm" />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={newQ.option_1} onChange={e => setNewQ({ ...newQ, option_1: e.target.value })} placeholder="Option 1 (1 finger)" className="border rounded px-2 py-1.5 text-sm" />
                    <input value={newQ.option_2} onChange={e => setNewQ({ ...newQ, option_2: e.target.value })} placeholder="Option 2 (2 fingers)" className="border rounded px-2 py-1.5 text-sm" />
                    <input value={newQ.option_3} onChange={e => setNewQ({ ...newQ, option_3: e.target.value })} placeholder="Option 3 (3 fingers)" className="border rounded px-2 py-1.5 text-sm" />
                    <input value={newQ.option_4} onChange={e => setNewQ({ ...newQ, option_4: e.target.value })} placeholder="Option 4 (4 fingers)" className="border rounded px-2 py-1.5 text-sm" />
                  </div>
                  <div className="flex gap-3 items-center">
                    <select value={newQ.correct_option || ''} onChange={e => setNewQ({ ...newQ, correct_option: e.target.value ? parseInt(e.target.value) : null })} className="border rounded px-2 py-1.5 text-sm">
                      <option value="">Correct answer (optional)</option>
                      <option value="1">Option 1</option>
                      <option value="2">Option 2</option>
                      <option value="3">Option 3</option>
                      <option value="4">Option 4</option>
                    </select>
                    <div className="flex items-center gap-1">
                      <label className="text-xs text-gray-500">Timer (s):</label>
                      <input type="number" value={newQ.time_limit} onChange={e => setNewQ({ ...newQ, time_limit: parseInt(e.target.value) || 15 })} className="border rounded px-2 py-1.5 text-sm w-16" min={5} max={120} />
                    </div>
                    <button onClick={() => handleAddQuestion(q.id)} className="bg-indigo-600 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-indigo-700 flex items-center gap-1 ml-auto">
                      <Plus size={12} /> Add
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        {quizzes.length === 0 && (
          <div className="text-center py-8 text-gray-400">No quizzes yet. Create one above.</div>
        )}
      </div>
    </div>
  )
}
