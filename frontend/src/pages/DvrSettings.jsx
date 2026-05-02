import { useEffect, useState } from 'react'
import { Server, Camera, Plus, Trash2, TestTube, Download, Upload } from 'lucide-react'
import {
  getDvrs, addDvr, deleteDvr, getDvrCameras, addDvrCamera,
  deleteCamera, testDvrCamera, importDvrConfig, importStudentFaces
} from '../utils/api'

export default function DvrSettings() {
  const [dvrs, setDvrs] = useState([])
  const [cameras, setCameras] = useState({})
  const [showAddDvr, setShowAddDvr] = useState(false)
  const [showAddCamera, setShowAddCamera] = useState(null)
  const [testImage, setTestImage] = useState(null)
  const [importPath, setImportPath] = useState('')
  const [dvrForm, setDvrForm] = useState({ name: '', ip: '', port: 80, username: 'admin', password: '', channels: 64 })
  const [camForm, setCamForm] = useState({ location: '', channel: 1, description: '' })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const loadDvrs = async () => {
    const data = await getDvrs()
    setDvrs(data)
    for (const dvr of data) {
      const cams = await getDvrCameras(dvr.id)
      setCameras(prev => ({ ...prev, [dvr.id]: cams }))
    }
  }

  useEffect(() => { loadDvrs() }, [])

  const handleAddDvr = async (e) => {
    e.preventDefault()
    await addDvr(dvrForm)
    setDvrForm({ name: '', ip: '', port: 80, username: 'admin', password: '', channels: 64 })
    setShowAddDvr(false)
    loadDvrs()
  }

  const handleDeleteDvr = async (id) => {
    if (!confirm('Delete this DVR and all its cameras?')) return
    await deleteDvr(id)
    loadDvrs()
  }

  const handleAddCamera = async (e, dvrId) => {
    e.preventDefault()
    await addDvrCamera(dvrId, camForm)
    setCamForm({ location: '', channel: 1, description: '' })
    setShowAddCamera(null)
    loadDvrs()
  }

  const handleDeleteCamera = async (id) => {
    await deleteCamera(id)
    loadDvrs()
  }

  const handleTest = async (dvrId, channel) => {
    setLoading(true)
    setTestImage(null)
    try {
      const result = await testDvrCamera(dvrId, channel)
      setTestImage(result.image)
      setMessage(`Snapshot captured (${(result.size_bytes / 1024).toFixed(1)} KB)`)
    } catch (err) {
      setMessage(`Test failed: ${err.message}`)
    }
    setLoading(false)
  }

  const handleImportConfig = async () => {
    if (!importPath) return
    setLoading(true)
    try {
      const result = await importDvrConfig(importPath)
      setMessage(`Imported ${result.dvrs_imported} DVRs, ${result.cameras_imported} cameras`)
      loadDvrs()
    } catch (err) {
      setMessage(`Import failed: ${err.message}`)
    }
    setLoading(false)
  }

  const handleImportFaces = async () => {
    if (!importPath) return
    setLoading(true)
    try {
      const result = await importStudentFaces(importPath)
      setMessage(`Imported ${result.students_imported} student face encodings`)
    } catch (err) {
      setMessage(`Import failed: ${err.message}`)
    }
    setLoading(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Server size={24} /> DVR Configuration
        </h2>
        <button onClick={() => setShowAddDvr(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-1.5">
          <Plus size={16} /> Add DVR
        </button>
      </div>

      {message && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-2 rounded-lg text-sm">
          {message}
          <button onClick={() => setMessage('')} className="ml-2 text-blue-500 hover:text-blue-700">&times;</button>
        </div>
      )}

      {/* Import from Campus Agent */}
      <div className="bg-white rounded-xl shadow border p-4">
        <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Download size={18} /> Import from Campus Agent
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={importPath}
            onChange={(e) => setImportPath(e.target.value)}
            placeholder="Path to campus agent database (e.g. /path/to/campus_agent.db)"
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
          />
          <button onClick={handleImportConfig} disabled={loading || !importPath}
            className="bg-green-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-1.5">
            <Server size={14} /> DVRs
          </button>
          <button onClick={handleImportFaces} disabled={loading || !importPath}
            className="bg-purple-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5">
            <Upload size={14} /> Faces
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1">Import DVR config and/or student face encodings from your campus agent setup</p>
      </div>

      {/* Add DVR Form */}
      {showAddDvr && (
        <form onSubmit={handleAddDvr} className="bg-white rounded-xl shadow border p-4 space-y-3">
          <h3 className="font-semibold text-gray-700">New DVR</h3>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Name (e.g. NVR-1)" value={dvrForm.name} onChange={(e) => setDvrForm({ ...dvrForm, name: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
            <input placeholder="IP Address" value={dvrForm.ip} onChange={(e) => setDvrForm({ ...dvrForm, ip: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" required />
            <input type="number" placeholder="Port" value={dvrForm.port} onChange={(e) => setDvrForm({ ...dvrForm, port: parseInt(e.target.value) })} className="border rounded-lg px-3 py-2 text-sm" />
            <input placeholder="Username" value={dvrForm.username} onChange={(e) => setDvrForm({ ...dvrForm, username: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
            <input type="password" placeholder="Password" value={dvrForm.password} onChange={(e) => setDvrForm({ ...dvrForm, password: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
            <input type="number" placeholder="Channels" value={dvrForm.channels} onChange={(e) => setDvrForm({ ...dvrForm, channels: parseInt(e.target.value) })} className="border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm">Save</button>
            <button type="button" onClick={() => setShowAddDvr(false)} className="bg-gray-200 px-4 py-2 rounded-lg text-sm">Cancel</button>
          </div>
        </form>
      )}

      {/* DVR List */}
      {dvrs.map(dvr => (
        <div key={dvr.id} className="bg-white rounded-xl shadow border">
          <div className="p-4 border-b flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <Server size={18} className="text-indigo-500" />
                {dvr.name || dvr.ip}
              </h3>
              <p className="text-xs text-gray-500">{dvr.ip}:{dvr.port} &middot; {dvr.channels} channels &middot; User: {dvr.username}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setShowAddCamera(dvr.id); setCamForm({ location: '', channel: 1, description: '' }) }}
                className="bg-green-100 text-green-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-200 flex items-center gap-1">
                <Plus size={14} /> Camera
              </button>
              <button onClick={() => handleDeleteDvr(dvr.id)} className="bg-red-100 text-red-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-200 flex items-center gap-1">
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          {showAddCamera === dvr.id && (
            <form onSubmit={(e) => handleAddCamera(e, dvr.id)} className="p-4 bg-gray-50 border-b space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <input placeholder="Location (e.g. Grade 3C)" value={camForm.location} onChange={(e) => setCamForm({ ...camForm, location: e.target.value })} className="border rounded px-2 py-1.5 text-sm" required />
                <input type="number" placeholder="Channel" value={camForm.channel} onChange={(e) => setCamForm({ ...camForm, channel: parseInt(e.target.value) })} className="border rounded px-2 py-1.5 text-sm" min="1" required />
                <input placeholder="Description" value={camForm.description} onChange={(e) => setCamForm({ ...camForm, description: e.target.value })} className="border rounded px-2 py-1.5 text-sm" />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="bg-green-600 text-white px-3 py-1 rounded text-sm">Add</button>
                <button type="button" onClick={() => setShowAddCamera(null)} className="bg-gray-200 px-3 py-1 rounded text-sm">Cancel</button>
              </div>
            </form>
          )}

          <div className="divide-y">
            {(cameras[dvr.id] || []).map(cam => (
              <div key={cam.id} className="p-3 flex items-center justify-between hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <Camera size={16} className="text-gray-400" />
                  <div>
                    <span className="font-medium text-sm">{cam.location || `Channel ${cam.channel}`}</span>
                    <span className="text-xs text-gray-500 ml-2">Ch. {cam.channel}</span>
                    {cam.description && <span className="text-xs text-gray-400 ml-2">{cam.description}</span>}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => handleTest(dvr.id, cam.channel)} disabled={loading}
                    className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-medium hover:bg-blue-200 flex items-center gap-1 disabled:opacity-50">
                    <TestTube size={12} /> Test
                  </button>
                  <button onClick={() => handleDeleteCamera(cam.id)}
                    className="bg-red-100 text-red-700 px-2 py-1 rounded text-xs hover:bg-red-200">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
            {(!cameras[dvr.id] || cameras[dvr.id].length === 0) && (
              <div className="p-4 text-center text-gray-400 text-sm">No cameras configured</div>
            )}
          </div>
        </div>
      ))}

      {dvrs.length === 0 && !showAddDvr && (
        <div className="bg-white rounded-xl shadow border p-8 text-center text-gray-400">
          <Server size={40} className="mx-auto mb-3 opacity-50" />
          <p>No DVRs configured</p>
          <p className="text-sm mt-1">Add your Hikvision NVR/DVR to start using classroom cameras</p>
        </div>
      )}

      {/* Test Snapshot Preview */}
      {testImage && (
        <div className="bg-white rounded-xl shadow border p-4">
          <h3 className="font-semibold text-gray-700 mb-2">Test Snapshot</h3>
          <img src={testImage} alt="DVR test snapshot" className="w-full rounded-lg" />
          <button onClick={() => setTestImage(null)} className="mt-2 text-sm text-gray-500 hover:text-gray-700">Close</button>
        </div>
      )}
    </div>
  )
}
