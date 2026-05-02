import React, { useState, useEffect } from 'react';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { Project, Scene, ProductionRole } from '../types';
import { Search, MapPin, List, Save, User, Package, Shirt, FileText, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { OperationType, handleFirestoreError, cn, hasFieldAccess } from '../lib/utils';

interface BreakdownModuleProps {
  project: Project;
  userRole?: ProductionRole;
}

export default function BreakdownModule({ project, userRole }: BreakdownModuleProps) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);

  // Form states
  const [editData, setEditData] = useState<Partial<Scene>>({});

  useEffect(() => {
    fetchScenes();
  }, [project]);

  useEffect(() => {
    if (selectedScene) {
      setEditData({
        cast: selectedScene.cast || [],
        props: selectedScene.props || [],
        wardrobe: selectedScene.wardrobe || [],
        notes: selectedScene.notes || '',
        directorNotes: selectedScene.directorNotes || '',
        emotionalIntensity: selectedScene.emotionalIntensity || 5,
        characterMentalState: selectedScene.characterMentalState || '',
        location: selectedScene.location || '',
      });
    }
  }, [selectedScene]);

  const fetchScenes = async () => {
    try {
      const q = query(
        collection(db, 'scenes'),
        where('projectId', '==', project.id)
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Scene));
      const sorted = data.sort((a, b) => a.order - b.order);
      setScenes(sorted);
      if (sorted.length > 0 && !selectedScene) {
        setSelectedScene(sorted[0]);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'scenes', auth);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedScene || !selectedScene.id) return;
    setSaving(true);
    try {
      const sceneRef = doc(db, 'scenes', selectedScene.id);
      await updateDoc(sceneRef, editData);
      
      // Update local state
      const updatedScenes = scenes.map(s => s.id === selectedScene.id ? { ...s, ...editData } : s);
      setScenes(updatedScenes);
      setSelectedScene({ ...selectedScene, ...editData });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `scenes/${selectedScene.id}`, auth);
    } finally {
      setSaving(false);
    }
  };

  const addTag = (field: 'cast' | 'props' | 'wardrobe', value: string) => {
    if (!value.trim()) return;
    const current = (editData[field] as string[]) || [];
    if (current.includes(value.trim())) return;
    setEditData({ ...editData, [field]: [...current, value.trim()] });
  };

  const removeTag = (field: 'cast' | 'props' | 'wardrobe', index: number) => {
    const current = (editData[field] as string[]) || [];
    setEditData({ ...editData, [field]: current.filter((_, i) => i !== index) });
  };

  const filteredScenes = scenes.filter(s => 
    s.location.toLowerCase().includes(searchQuery.toLowerCase()) || 
    s.number.includes(searchQuery)
  );

  if (loading) return <div className="h-full flex items-center justify-center italic text-brand-gray-500 font-sans">Loading breakdown data...</div>;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header Bar */}
      <div className="h-16 border-b border-brand-gray-200 flex items-center justify-between px-8 bg-white">
        <div className="flex items-center space-x-4">
          <div className="text-sm text-brand-gray-500">Production &rarr; Scene Breakdown</div>
          <div className="h-4 w-px bg-brand-gray-300"></div>
          <div className="text-sm font-semibold">Breakdown Editor</div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !selectedScene}
          className="bg-brand-blue text-white px-6 py-2 rounded text-xs font-bold shadow-sm hover:bg-blue-700 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
          {saving ? 'SAVING...' : 'SAVE CHANGES'}
        </button>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* Mobile Scene Selector */}
        <div className="md:hidden p-4 border-b border-brand-gray-200 bg-brand-gray-50 shrink-0">
            <label className="text-[10px] uppercase font-bold text-brand-gray-400 block mb-1 tracking-widest">Select Scene for Breakdown</label>
            <select 
              value={selectedScene?.id || ''}
              onChange={(e) => setSelectedScene(scenes.find(s => s.id === e.target.value) || null)}
              className="w-full text-sm font-bold p-3 border border-brand-gray-300 rounded bg-white shadow-sm"
            >
              {filteredScenes.map(s => (
                <option key={s.id} value={s.id}>SCENE {s.number}: {s.location}</option>
              ))}
            </select>
        </div>

        {/* Left Sidebar: Scene List - Hidden on Mobile */}
        <div className="hidden md:flex w-80 border-r border-brand-gray-200 bg-white flex-col shrink-0">
          <div className="p-4 bg-brand-gray-50 border-b border-brand-gray-200">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-gray-400" size={14} />
              <input 
                type="text" 
                placeholder="Find scenes..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs pl-9 pr-3 py-2 border border-brand-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-brand-blue"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredScenes.map((scene) => (
              <button
                key={scene.id}
                onClick={() => setSelectedScene(scene)}
                className={cn(
                  "w-full p-4 border-b border-brand-gray-100 border-l-4 text-left transition-all",
                  selectedScene?.id === scene.id ? "border-brand-blue bg-blue-50" : "border-transparent hover:bg-brand-gray-50"
                )}
              >
                <div className="text-[10px] font-bold text-brand-gray-400 mb-1">SCENE {scene.number}</div>
                <div className="text-sm font-bold text-brand-gray-900 truncate">{scene.location}</div>
                <div className="flex gap-2 mt-2">
                  <TagCount icon={<User size={10} />} count={scene.cast?.length || 0} />
                  <TagCount icon={<Package size={10} />} count={scene.props?.length || 0} />
                  <TagCount icon={<Shirt size={10} />} count={scene.wardrobe?.length || 0} />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right Editor Panel */}
        <div className="flex-1 overflow-y-auto p-4 md:p-10 bg-[#FDFDFD] pb-24 md:pb-10">
          {selectedScene ? (
            <div className="max-w-4xl space-y-8 md:space-y-10">
              <header className="flex flex-col sm:flex-row justify-between items-start gap-4">
                <div>
                  <h2 className="text-xl md:text-3xl font-bold tracking-tight text-brand-gray-900 leading-tight">
                    Scene {selectedScene.number}: {selectedScene.location}
                  </h2>
                  <p className="text-[10px] text-brand-gray-500 uppercase tracking-widest mt-2">{selectedScene.intExt} / {selectedScene.dayNight}</p>
                </div>
                <div className="flex items-center gap-2">
                   <div className="bg-brand-gray-100 px-3 py-1 rounded-full text-[9px] md:text-[10px] font-bold text-brand-gray-500 uppercase ring-1 ring-brand-gray-200">
                    Breakdown in progress
                   </div>
                </div>
              </header>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
                 {/* Production Elements */}
                 <div className="space-y-6">
                    <TagInput 
                      label="Cast Members" 
                      icon={<User size={14} />} 
                      tags={editData.cast || []} 
                      onAdd={(v) => addTag('cast', v)} 
                      onRemove={(i) => removeTag('cast', i)} 
                    />
                    <TagInput 
                      label="Props" 
                      icon={<Package size={14} />} 
                      tags={editData.props || []} 
                      onAdd={(v) => addTag('props', v)} 
                      onRemove={(i) => removeTag('props', i)} 
                    />
                    <TagInput 
                      label="Wardrobe" 
                      icon={<Shirt size={14} />} 
                      tags={editData.wardrobe || []} 
                      onAdd={(v) => addTag('wardrobe', v)} 
                      onRemove={(i) => removeTag('wardrobe', i)} 
                    />
                 </div>

                 {/* Editorial Elements */}
                 <div className="space-y-6">
                    <section className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] uppercase font-bold text-brand-gray-400 block mb-2 tracking-widest">
                          Priority
                        </label>
                        <select 
                          value={editData.priority || 'MUST'}
                          onChange={(e) => setEditData({ ...editData, priority: e.target.value as any })}
                          className="w-full text-xs p-2 border border-brand-gray-300 rounded bg-white shadow-sm"
                        >
                          <option value="MUST">MUST</option>
                          <option value="SHOULD">SHOULD</option>
                          <option value="MAYBE">MAYBE</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] uppercase font-bold text-brand-gray-400 block mb-2 tracking-widest">
                          Mins
                        </label>
                        <input 
                          type="number"
                          value={editData.estimatedDuration || 60}
                          onChange={(e) => setEditData({ ...editData, estimatedDuration: parseInt(e.target.value) })}
                          className="w-full text-xs p-2 border border-brand-gray-300 rounded"
                        />
                      </div>
                    </section>
                    
                    <section>
                      <label className="text-[10px] uppercase font-bold text-brand-gray-400 block mb-2 tracking-widest">
                        Standardized Location
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input 
                          type="text"
                          value={editData.location || ''}
                          onChange={(e) => setEditData({ ...editData, location: e.target.value })}
                          className="flex-1 text-xs p-2 border border-brand-gray-300 rounded font-bold"
                        />
                        <button 
                          onClick={async () => {
                            if (!editData.location || !selectedScene) return;
                            const batch = writeBatch(db);
                            const oldLocation = selectedScene.location;
                            const newLocation = editData.location;
                            
                            const sameLocScenes = scenes.filter(s => s.location === oldLocation);
                            sameLocScenes.forEach(s => {
                              const ref = doc(db, 'scenes', s.id);
                              batch.update(ref, { location: newLocation });
                            });
                            
                            await batch.commit();
                            fetchScenes();
                          }}
                          className="px-3 py-2 text-[10px] font-bold text-brand-blue border border-brand-blue rounded hover:bg-blue-50 whitespace-nowrap"
                        >
                          Apply to All
                        </button>
                      </div>
                    </section>

                    <section>
                      <label className="text-[10px] uppercase font-bold text-brand-gray-400 block mb-2 tracking-widest flex items-center gap-2">
                        <Activity size={14} /> Emotional Intensity
                      </label>
                      <input 
                        type="range" 
                        min="1" max="10" 
                        value={editData.emotionalIntensity || 5}
                        onChange={(e) => setEditData({ ...editData, emotionalIntensity: parseInt(e.target.value) })}
                        className="w-full h-1.5 bg-brand-gray-200 rounded-lg appearance-none cursor-pointer accent-brand-blue"
                      />
                      <div className="flex justify-between text-[10px] text-brand-gray-400 font-bold mt-1">
                        <span>Low</span>
                        <span className="text-brand-blue">{editData.emotionalIntensity || 5}/10</span>
                        <span>High</span>
                      </div>
                    </section>
                 </div>
              </div>

              <div className="space-y-6 border-t border-brand-gray-200 pt-8">
                <TextareaField 
                  label="Character Mental State" 
                  value={editData.characterMentalState || ''} 
                  onChange={(v) => setEditData({ ...editData, characterMentalState: v })}
                />
                <TextareaField 
                  label="Director Notes" 
                  value={editData.directorNotes || ''} 
                  onChange={(v) => setEditData({ ...editData, directorNotes: v })}
                />
                <TextareaField 
                  label="General Production Notes" 
                  value={editData.notes || ''} 
                  onChange={(v) => setEditData({ ...editData, notes: v })}
                  rows={4}
                />
              </div>

              {/* Script Reference */}
              <div className="bg-brand-gray-100/50 border border-brand-gray-100 rounded-lg p-4 md:p-6">
                 <label className="text-[10px] uppercase font-bold text-brand-gray-400 block mb-3 md:mb-4 tracking-widest flex items-center gap-2">
                   <FileText size={14} /> Script Ref
                 </label>
                 <div className="font-mono text-xs text-brand-gray-700 leading-relaxed max-h-48 overflow-y-auto bg-white p-3 md:p-4 border border-brand-gray-100 rounded shadow-inner">
                    {selectedScene.synopsis}
                 </div>
              </div>

              <div className="md:hidden mt-8">
                <button
                  onClick={handleSave}
                  disabled={saving || !selectedScene}
                  className="w-full bg-brand-blue text-white p-4 rounded-xl text-sm font-bold shadow-lg flex items-center justify-center gap-3 active:scale-95 transition-transform"
                >
                  {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                  SAVE CHANGES
                </button>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-brand-gray-400 italic text-center p-10">Select a scene to begin breakdown</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Loader2({ className, size }: { className?: string, size?: number }) {
  return <Activity className={cn("animate-spin", className)} size={size} />;
}

function TagCount({ icon, count }: { icon: React.ReactNode, count: number }) {
  return (
    <div className="flex items-center gap-1 text-[10px] text-brand-gray-400 font-bold">
      {icon} <span>{count}</span>
    </div>
  );
}

function TagInput({ label, icon, tags, onAdd, onRemove }: { label: string, icon: React.ReactNode, tags: string[], onAdd: (v: string) => void, onRemove: (i: number) => void }) {
  const [input, setInput] = useState('');
  return (
    <section>
      <label className="text-[10px] uppercase font-bold text-brand-gray-400 block mb-2 tracking-widest flex items-center gap-2">
        {icon} {label}
      </label>
      <div className="flex flex-wrap gap-2 mb-3">
        {tags.map((tag, i) => (
          <span key={i} className="bg-white px-2 py-1 border border-brand-gray-200 text-[10px] font-bold text-brand-gray-700 flex items-center gap-2 rounded shadow-sm">
            {tag}
            <button onClick={() => onRemove(i)} className="text-red-400 hover:text-red-600 transition-colors">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input 
          type="text" 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Add ${label.toLowerCase()}...`}
          className="flex-1 text-xs px-3 py-2 border border-brand-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-brand-blue"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onAdd(input);
              setInput('');
            }
          }}
        />
        <button 
          onClick={() => { onAdd(input); setInput(''); }}
          className="px-3 py-2 bg-brand-gray-100 hover:bg-brand-gray-200 text-xs font-bold rounded transition-colors"
        >
          Add
        </button>
      </div>
    </section>
  );
}

function TextareaField({ label, value, onChange, placeholder = "", rows = 3 }: { label: string, value: string, onChange: (v: string) => void, placeholder?: string, rows?: number }) {
  return (
    <section>
      <label className="text-[10px] uppercase font-bold text-brand-gray-400 block mb-2 tracking-widest">
        {label}
      </label>
      <textarea 
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full text-xs px-3 py-2 border border-brand-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-brand-blue transition-all bg-white"
      />
    </section>
  );
}
