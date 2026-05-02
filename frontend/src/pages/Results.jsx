import { useEffect, useState } from 'react'
import { BarChart3, CheckCircle, XCircle, MinusCircle } from 'lucide-react'
import { getSessions, getSessionResults } from '../utils/api'

export default function Results() {
  const [sessions, setSessions] = useState([])
  const [selectedSession, setSelectedSession] = useState(null)
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSessions().then(ss => {
      setSessions(ss)
      setLoading(false)
    })
  }, [])

  const loadResults = async (sessionId) => {
    setSelectedSession(sessionId)
    const data = await getSessionResults(sessionId)
    setResults(data)
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Quiz Results & Analytics</h2>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Session list */}
        <div className="bg-white rounded-xl shadow border overflow-hidden">
          <div className="p-3 border-b bg-gray-50">
            <h3 className="font-semibold text-sm text-gray-700">Past Sessions</h3>
          </div>
          <div className="divide-y max-h-[600px] overflow-y-auto">
            {sessions.length === 0 ? (
              <div className="p-4 text-center text-gray-400 text-sm">No sessions yet</div>
            ) : (
              sessions.map(s => (
                <button
                  key={s.id}
                  onClick={() => loadResults(s.id)}
                  className={`w-full text-left p-3 hover:bg-gray-50 transition ${selectedSession === s.id ? 'bg-indigo-50 border-l-4 border-indigo-500' : ''}`}
                >
                  <p className="font-medium text-sm text-gray-800">{s.quiz_title}</p>
                  <p className="text-xs text-gray-400">
                    {s.status} · {s.started_at ? new Date(s.started_at).toLocaleDateString() : ''}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Results detail */}
        <div className="lg:col-span-3">
          {!results ? (
            <div className="bg-white rounded-xl shadow border p-12 text-center">
              <BarChart3 size={48} className="mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500">Select a session to view results</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(results.summary).map(([name, stats]) => {
                  const pct = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0
                  return (
                    <div key={name} className="bg-white rounded-xl shadow border p-4">
                      <p className="font-medium text-sm text-gray-800 truncate">{name}</p>
                      <div className="mt-2 flex items-end justify-between">
                        <div>
                          <p className="text-2xl font-bold text-gray-900">{pct}%</p>
                          <p className="text-xs text-gray-400">{stats.correct}/{stats.total} correct</p>
                        </div>
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          pct >= 75 ? 'bg-green-100 text-green-600' :
                          pct >= 50 ? 'bg-yellow-100 text-yellow-600' :
                          'bg-red-100 text-red-600'
                        }`}>
                          {pct >= 75 ? <CheckCircle size={20} /> : pct >= 50 ? <MinusCircle size={20} /> : <XCircle size={20} />}
                        </div>
                      </div>
                      <div className="mt-2 bg-gray-200 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full ${pct >= 75 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Detailed results table */}
              <div className="bg-white rounded-xl shadow border overflow-hidden">
                <div className="p-3 border-b bg-gray-50">
                  <h3 className="font-semibold text-sm text-gray-700">Detailed Responses</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-gray-600">Student</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-600">Question</th>
                        <th className="text-center px-3 py-2 font-medium text-gray-600">Answer</th>
                        <th className="text-center px-3 py-2 font-medium text-gray-600">Correct</th>
                        <th className="text-center px-3 py-2 font-medium text-gray-600">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {results.details.map((r, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium">{r.student_name}</td>
                          <td className="px-3 py-2 text-gray-600">Q{r.question_number}</td>
                          <td className="px-3 py-2 text-center">
                            {r.selected_option ? (
                              <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded">
                                Option {r.selected_option}
                              </span>
                            ) : (
                              <span className="text-gray-400 text-xs">Not answered</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {r.correct_option ? (
                              <span className="text-xs text-gray-500">Option {r.correct_option}</span>
                            ) : '—'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {r.status !== 'answered' ? (
                              <MinusCircle size={16} className="mx-auto text-gray-300" />
                            ) : r.is_correct ? (
                              <CheckCircle size={16} className="mx-auto text-green-500" />
                            ) : (
                              <XCircle size={16} className="mx-auto text-red-500" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
