import { useEffect, useState } from 'react'
import { UserPlus, Trash2, Upload, CheckCircle, AlertCircle } from 'lucide-react'
import { getStudents, createStudent, deleteStudent, uploadStudentPhoto } from '../utils/api'

export default function StudentManager() {
  const [students, setStudents] = useState([])
  const [name, setName] = useState('')
  const [rollNumber, setRollNumber] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => getStudents().then(setStudents).finally(() => setLoading(false))

  useEffect(() => { load() }, [])

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    await createStudent({ name: name.trim(), roll_number: rollNumber.trim() || null })
    setName('')
    setRollNumber('')
    load()
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this student?')) return
    await deleteStudent(id)
    load()
  }

  const handlePhoto = async (studentId, file) => {
    try {
      await uploadStudentPhoto(studentId, file)
      load()
    } catch (err) {
      alert('Failed to upload photo: ' + (err.message || 'Unknown error'))
    }
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Student Management</h2>

      <form onSubmit={handleAdd} className="bg-white rounded-xl shadow border p-4 flex gap-3 items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-600 mb-1">Student Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Enter student name"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            required
          />
        </div>
        <div className="w-40">
          <label className="block text-sm font-medium text-gray-600 mb-1">Roll Number</label>
          <input
            value={rollNumber}
            onChange={e => setRollNumber(e.target.value)}
            placeholder="Optional"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
        <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-1.5">
          <UserPlus size={16} /> Add Student
        </button>
      </form>

      <div className="bg-white rounded-xl shadow border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Roll #</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Face Registered</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Photo</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {students.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-gray-400">No students added yet</td></tr>
            ) : (
              students.map(s => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3 text-gray-500">{s.roll_number || '—'}</td>
                  <td className="px-4 py-3">
                    {s.has_face_encoding ? (
                      <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">
                        <CheckCircle size={14} /> Registered
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-medium">
                        <AlertCircle size={14} /> Not registered
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <label className="cursor-pointer inline-flex items-center gap-1 text-indigo-600 text-xs hover:underline">
                      <Upload size={14} /> Upload
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => e.target.files[0] && handlePhoto(s.id, e.target.files[0])}
                      />
                    </label>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDelete(s.id)} className="text-red-500 hover:text-red-700">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
