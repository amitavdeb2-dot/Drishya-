import React, { useState, useEffect } from 'react';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs, addDoc, orderBy, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { Project, Scene, StoryboardFrame, SceneStatus, ProductionRole } from '../types';
import { Search, Image as ImageIcon, Plus, Trash2, Camera, Loader2, LayoutGrid, ScrollText, Zap, Sparkles, GripVertical, Save, X, CheckCircle2, Circle, Brush, Monitor } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { OperationType, handleFirestoreError, cn, hasFieldAccess, hasModuleAccess, hasPermission } from '../lib/utils';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GoogleGenAI, Type } from "@google/genai";

interface StoryboardModuleProps {
  project: Project;
  userRole?: ProductionRole;
}

export default function StoryboardModule({ project, userRole }: StoryboardModuleProps) {
  const [scenes, setScenes] = useState<(Scene & { frameCount?: number })[]>([]);
  const [frames, setFrames] = useState<StoryboardFrame[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const [editingFrame, setEditingFrame] = useState<StoryboardFrame | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);

  useEffect(() => {
    fetchScenes();
  }, [project]);

  useEffect(() => {
    if (selectedScene) {
      fetchFrames(selectedScene.id);
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
      
      // Fetch frame counts for each scene
      const countsPromises = sorted.map(async (scene) => {
        const sq = query(
          collection(db, 'storyboards'),
          where('sceneId', '==', scene.id)
        );
        const sSub = await getDocs(sq);
        return { ...scene, frameCount: sSub.size };
      });

      const scenesWithCounts = await Promise.all(countsPromises);
      setScenes(scenesWithCounts);
      
      if (scenesWithCounts.length > 0 && !selectedScene) {
        setSelectedScene(scenesWithCounts[0]);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'scenes', auth);
    } finally {
      setLoading(false);
    }
  };

  const fetchFrames = async (sceneId: string) => {
    try {
      const q = query(
        collection(db, 'storyboards'),
        where('sceneId', '==', sceneId),
        orderBy('order', 'asc')
      );
      const snapshot = await getDocs(q);
      setFrames(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StoryboardFrame)));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'storyboards', auth);
    }
  };

  const handleAddFrame = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedScene) return;

    setUploading(true);
    try {
      // Simulate upload and use base64 for persistent storage in Firestore
      // Note: In real app, we'd use Firebase Storage
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        
        // Firestore has 1MB limit, so resize/compress if needed
        // For now we'll just try to save it
        const frameData: Omit<StoryboardFrame, 'id'> = {
          projectId: project.id,
          ownerId: project.ownerId,
          sceneId: selectedScene.id,
          imageUrl: base64,
          title: 'New Frame',
          description: '',
          shotType: 'WIDE',
          cameraMovement: 'STATIC',
          cameraNotes: '',
          artNotes: '',
          technicalSpecs: '',
          order: frames.length
        };

        const docRef = await addDoc(collection(db, 'storyboards'), frameData);
        setFrames([...frames, { id: docRef.id, ...frameData }]);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'storyboards', auth);
    } finally {
      setUploading(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = frames.findIndex((f) => f.id === active.id);
    const newIndex = frames.findIndex((f) => f.id === over.id);
    const newFrames = arrayMove(frames, oldIndex, newIndex);
    
    setFrames(newFrames);

    // Persist to Firebase (simplified: update each order)
    try {
      const updates = (newFrames as StoryboardFrame[]).map((frame, index) => 
        updateDoc(doc(db, 'storyboards', frame.id), { order: index })
      );
      await Promise.all(updates);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'storyboards/reorder', auth);
    }
  };

  const generateSmartSuggestions = async () => {
    if (!selectedScene || isSuggesting) return;
    
    setIsSuggesting(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `As a professional cinematographer, suggest 3 key storyboard frames for this movie scene. 
      Scene #${selectedScene.number}: ${selectedScene.location}
      Synopsis: ${selectedScene.synopsis || "No synopsis provided. Infer from location."}
      
      Suggest frames in JSON format:
      [
        {"title": "string", "shotType": "WS|CU|POV|MS|OTS", "cameraMovement": "STATIC|PAN|TILT|TRACK|DOLLY", "cameraNotes": "string"}
      ]`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                shotType: { type: Type.STRING },
                cameraMovement: { type: Type.STRING },
                cameraNotes: { type: Type.STRING }
              },
              required: ["title", "shotType", "cameraMovement", "cameraNotes"]
            }
          }
        }
      });

      const suggestions = JSON.parse(response.text);
      
      // Auto-add suggested frames with placeholders
      for (const suggestion of suggestions) {
        const frameData: Omit<StoryboardFrame, 'id'> = {
          projectId: project.id,
          ownerId: project.ownerId,
          sceneId: selectedScene.id,
          imageUrl: "https://images.unsplash.com/photo-1542204172-55ae33e3478d?q=80&w=800&auto=format&fit=crop", // placeholder
          title: suggestion.title,
          description: "AI Suggested Shot",
          shotType: suggestion.shotType,
          cameraMovement: suggestion.cameraMovement,
          cameraNotes: suggestion.cameraNotes,
          order: frames.length
        };
        const docRef = await addDoc(collection(db, 'storyboards'), frameData);
        setFrames(prev => [...prev, { id: docRef.id, ...frameData }]);
      }
      
      // Update local scene count
      setScenes(prev => prev.map(s => s.id === selectedScene.id ? { ...s, frameCount: (s.frameCount || 0) + suggestions.length } : s));
      
    } catch (err) {
      console.error("AI Error:", err);
    } finally {
      setIsSuggesting(false);
    }
  };

  const updateSceneStatus = async (sceneId: string, framesData: StoryboardFrame[]) => {
    const completedCount = framesData.filter(f => f.completed).length;
    let newStatus: SceneStatus = SceneStatus.NOT_STARTED;
    
    if (completedCount === framesData.length && framesData.length > 0) {
      newStatus = SceneStatus.COMPLETED;
    } else if (completedCount > 0) {
      newStatus = SceneStatus.IN_PROGRESS;
    }

    try {
      await updateDoc(doc(db, 'scenes', sceneId), { status: newStatus });
      setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, status: newStatus } : s));
      if (selectedScene?.id === sceneId) {
        setSelectedScene(prev => prev ? { ...prev, status: newStatus } : null);
      }
    } catch (err) {
      console.error("Error updating scene status:", err);
    }
  };

  const toggleShotComplete = async (frame: StoryboardFrame) => {
    try {
      const newCompleted = !frame.completed;
      await updateDoc(doc(db, 'storyboards', frame.id), { completed: newCompleted });
      
      const updatedFrames = frames.map(f => f.id === frame.id ? { ...f, completed: newCompleted } : f);
      setFrames(updatedFrames);
      
      if (selectedScene) {
        await updateSceneStatus(selectedScene.id, updatedFrames);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `storyboards/${frame.id}`, auth);
    }
  };

  const markSceneComplete = async () => {
    if (!selectedScene) return;
    try {
      const updates = frames.map(frame => 
        updateDoc(doc(db, 'storyboards', frame.id), { completed: true })
      );
      await Promise.all(updates);
      
      await updateDoc(doc(db, 'scenes', selectedScene.id), { status: SceneStatus.COMPLETED });
      setScenes(prev => prev.map(s => s.id === selectedScene.id ? { ...s, status: SceneStatus.COMPLETED } : s));
      setSelectedScene(prev => prev ? { ...prev, status: SceneStatus.COMPLETED } : null);
      setFrames(prev => prev.map(f => ({ ...f, completed: true })));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `scenes/${selectedScene.id}`, auth);
    }
  };

  const handleUpdateFrameField = async (frameId: string, field: keyof StoryboardFrame, value: any) => {
    try {
      await updateDoc(doc(db, 'storyboards', frameId), { [field]: value });
      setFrames(prev => prev.map(f => f.id === frameId ? { ...f, [field]: value } : f));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `storyboards/${frameId}`, auth);
    }
  };

  const handleDeleteFrame = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'storyboards', id));
      setFrames(frames.filter(f => f.id !== id));
      // Update count
      if (selectedScene) {
        setScenes(prev => prev.map(s => s.id === selectedScene.id ? { ...s, frameCount: Math.max(0, (s.frameCount || 1) - 1) } : s));
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `storyboards/${id}`, auth);
    }
  };

  const handleDuplicateFrame = async (frame: StoryboardFrame) => {
    try {
      const { id, ...rest } = frame;
      const newFrameData: Omit<StoryboardFrame, 'id'> = {
        ...rest,
        title: `${frame.title} (Copy)`,
        order: frames.length
      };
      const docRef = await addDoc(collection(db, 'storyboards'), newFrameData);
      const newFrame = { id: docRef.id, ...newFrameData } as StoryboardFrame;
      setFrames(prev => [...prev, newFrame]);
      
      if (selectedScene) {
        setScenes(prev => prev.map(s => s.id === selectedScene.id ? { ...s, frameCount: (s.frameCount || 0) + 1 } : s));
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'storyboards/duplicate', auth);
    }
  };

  const handleMoveFrame = async (id: string, direction: 'up' | 'down') => {
    const index = frames.findIndex(f => f.id === id);
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === frames.length - 1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    const newFrames = arrayMove(frames, index, newIndex);
    setFrames(newFrames);

    try {
      const updates = (newFrames as StoryboardFrame[]).map((frame, idx) => 
        updateDoc(doc(db, 'storyboards', frame.id), { order: idx })
      );
      await Promise.all(updates);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'storyboards/move', auth);
    }
  };

  const getStatusIcon = (status?: SceneStatus) => {
    switch (status) {
      case 'completed': return <CheckCircle2 size={16} className="text-green-500" />;
      case 'in-progress': return <Circle size={16} className="text-brand-blue fill-brand-blue/20" />;
      default: return <Circle size={16} className="text-brand-gray-300" />;
    }
  };

  const filteredScenes = scenes.filter(s => 
    s.location.toLowerCase().includes(searchQuery.toLowerCase()) || 
    s.number.includes(searchQuery)
  );

  const canEdit = hasPermission(userRole, 'edit_storyboard');
  const canSuggest = canEdit || hasPermission(userRole, 'edit_storyboard_camera');

  if (loading) return <div className="h-full flex items-center justify-center italic text-brand-gray-500 font-sans uppercase tracking-[0.2em] text-[10px]">Syncing storyboard assets...</div>;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header Bar */}
      <div className="h-16 border-b border-brand-gray-200 flex items-center justify-between px-8 bg-white">
        <div className="flex items-center space-x-4">
          <div className="text-sm text-brand-gray-500">Production &rarr; Storyboard</div>
          <div className="h-4 w-px bg-brand-gray-300"></div>
          <div className="text-sm font-semibold">Visual References</div>
        </div>
        <div className="flex items-center gap-4">
          {canEdit && (
            <div className="relative group">
              <input 
                type="file" 
                accept="image/*" 
                onChange={handleAddFrame}
                className="absolute inset-0 opacity-0 cursor-pointer z-10"
                disabled={uploading || !selectedScene}
              />
              <button className="bg-brand-blue text-white px-6 py-2 rounded text-xs font-bold shadow-sm hover:bg-blue-700 transition-all flex items-center gap-2 uppercase tracking-widest">
                {uploading ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}
                {uploading ? 'UPLOADING...' : 'ADD FRAME'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* Mobile Scene Selector */}
        <div className="md:hidden p-4 border-b border-brand-gray-200 bg-brand-gray-50 shrink-0">
            <label className="text-[10px] uppercase font-bold text-brand-gray-400 block mb-1 tracking-widest">Gallery for Scene</label>
            <div className="relative">
              <select 
                value={selectedScene?.id || ''}
                onChange={(e) => setSelectedScene(scenes.find(s => s.id === e.target.value) || null)}
                className="w-full text-sm font-bold p-3 border border-brand-gray-300 rounded bg-white shadow-sm appearance-none"
              >
                {filteredScenes.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.status === 'completed' ? '✅ ' : (s.status === 'in-progress' ? '◐ ' : '☐ ')}
                    SCENE {s.number}: {s.location} ({s.frameCount || 0})
                  </option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-brand-gray-400">
                <LayoutGrid size={14} />
              </div>
            </div>
        </div>

        {/* Left Sidebar: Scene List - Hidden on Mobile */}
        <div className="hidden md:flex w-80 border-r border-brand-gray-200 bg-white flex-col shrink-0">
          <div className="p-4 bg-brand-gray-50 border-b border-brand-gray-200">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-gray-400" size={14} />
              <input 
                type="text" 
                placeholder="Jump to scene..." 
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
                  "w-full p-4 border-b border-brand-gray-100 border-l-4 text-left transition-all group flex justify-between items-center",
                  selectedScene?.id === scene.id ? "border-brand-blue bg-blue-50" : "border-transparent hover:bg-brand-gray-50"
                )}
              >
                <div className="flex gap-3">
                  <div className="mt-1 shrink-0">{getStatusIcon(scene.status)}</div>
                  <div>
                    <div className="text-[10px] font-bold text-brand-gray-400 mb-1 uppercase tracking-widest flex items-center gap-2">
                       SCENE {scene.number}
                    </div>
                    <div className="text-sm font-bold text-brand-gray-900 truncate max-w-[140px]">{scene.location}</div>
                  </div>
                </div>
                <div className="flex flex-col items-end">
                   <div className={cn(
                     "text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter",
                     scene.frameCount && scene.frameCount > 0 ? "bg-brand-blue text-white" : "bg-brand-gray-100 text-brand-gray-400"
                   )}>
                     {scene.frameCount || 0}
                   </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right Gallery Panel */}
        <div className="flex-1 overflow-y-auto p-4 md:p-10 bg-brand-gray-50 pb-24 md:pb-10">
          {selectedScene ? (
            <div className="max-w-6xl space-y-6 md:space-y-10">
              <header className="flex flex-col sm:flex-row justify-between items-start md:items-end gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-xl md:text-3xl font-black tracking-tight text-brand-gray-900 border-b-4 border-brand-blue md:pb-1 inline-block leading-tight uppercase italic">
                      Scene {selectedScene.number} — {frames.length} Shots
                    </h2>
                    {selectedScene.status === 'completed' && <CheckCircle2 size={24} className="text-green-500" />}
                  </div>
                  <p className="text-[10px] text-brand-gray-500 font-bold uppercase tracking-widest md:block hidden">Location: {selectedScene.location}</p>
                </div>
                <div className="flex items-center gap-3">
                  {selectedScene.status !== 'completed' && frames.length > 0 && (
                    <button 
                      onClick={markSceneComplete}
                      className="hidden md:flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded text-[10px] font-black uppercase tracking-widest shadow-lg hover:bg-green-700 transition-all active:scale-95"
                    >
                      <CheckCircle2 size={12} />
                      Wrap Scene
                    </button>
                  )}
                  {canSuggest && (
                    <button 
                      onClick={generateSmartSuggestions}
                      disabled={isSuggesting}
                      className="hidden md:flex items-center gap-2 px-4 py-2 bg-white border border-brand-blue/30 text-brand-blue rounded text-[10px] font-bold hover:bg-blue-50 transition-all shadow-sm disabled:opacity-50 uppercase tracking-widest"
                    >
                      {isSuggesting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      {isSuggesting ? 'ANALYZING...' : 'AI SUGGESTIONS'}
                    </button>
                  )}
                </div>
              </header>

              {frames.length > 0 ? (
                <DndContext 
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <div className="flex flex-col md:grid md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
                    <SortableContext 
                      items={frames.map(f => f.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <AnimatePresence>
                        {frames.map((frame, idx) => (
                          <SortableFrameItem 
                            key={frame.id} 
                            frame={frame} 
                            idx={idx} 
                            onDelete={() => handleDeleteFrame(frame.id)} 
                            onEdit={() => setEditingFrame(frame)}
                            onUpdateField={handleUpdateFrameField}
                            onDuplicate={() => handleDuplicateFrame(frame)}
                            onMoveUp={() => handleMoveFrame(frame.id, 'up')}
                            onMoveDown={() => handleMoveFrame(frame.id, 'down')}
                            onToggleComplete={() => toggleShotComplete(frame)}
                            isFirst={idx === 0}
                            isLast={idx === frames.length - 1}
                          />
                        ))}
                      </AnimatePresence>
                    </SortableContext>

                    {/* Desktop Add Frame Button */}
                    <div className="hidden md:flex relative group border-2 border-dashed border-brand-gray-200 rounded-2xl flex flex-col items-center justify-center p-12 hover:border-brand-blue hover:bg-blue-50 transition-all cursor-pointer aspect-video bg-white/50">
                      <input 
                        type="file" 
                        accept="image/*" 
                        onChange={handleAddFrame}
                        className="absolute inset-0 opacity-0 cursor-pointer z-10"
                      />
                      <Plus size={32} className="text-brand-gray-300 mb-2 group-hover:text-brand-blue" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-brand-gray-400 group-hover:text-brand-blue">Add Next Frame</span>
                    </div>

                    {/* Mobile Add Frame Button - Now at the end of vertical list */}
                    <div className="md:hidden relative group border-2 border-dashed border-brand-blue/30 rounded-2xl flex flex-col items-center justify-center p-10 bg-blue-50/30 w-full aspect-video overflow-hidden shadow-inner">
                        <input 
                          type="file" 
                          accept="image/*" 
                          onChange={handleAddFrame}
                          className="absolute inset-0 opacity-0 cursor-pointer z-10"
                        />
                        <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-md border border-brand-blue/20 mb-3 group-active:scale-90 transition-transform">
                          <Plus size={24} className="text-brand-blue" />
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-blue">ADD FRAME</span>
                    </div>
                  </div>
                </DndContext>
              ) : (
                <div className="bg-white border border-brand-gray-200 rounded-2xl p-12 md:p-20 flex flex-col items-center justify-center text-center shadow-sm">
                   <div className="w-16 h-16 md:w-24 md:h-24 bg-brand-gray-50 rounded-full flex items-center justify-center mb-6">
                      <ImageIcon size={32} className="text-brand-gray-200 md:hidden" />
                      <ImageIcon size={40} className="text-brand-gray-200 hidden md:block" />
                   </div>
                   <h3 className="text-lg md:text-2xl font-black text-brand-gray-900 mb-2 leading-tight uppercase italic px-4">No shots yet</h3>
                   <p className="text-xs md:text-sm text-brand-gray-400 max-w-sm mb-10 px-6 font-medium">
                     Start visualising Scene {selectedScene.number}. Upload your sketches or use AI to generate key shot suggestions.
                   </p>
                    <div className="flex flex-col gap-3 w-full max-w-xs">
                      {canEdit && (
                        <div className="relative">
                          <input 
                            type="file" 
                            accept="image/*" 
                            onChange={handleAddFrame}
                            className="absolute inset-0 opacity-0 cursor-pointer z-10"
                          />
                          <button className="w-full bg-brand-gray-900 text-white px-8 py-4 rounded-xl text-[10px] font-bold uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2">
                            <ImageIcon size={14} /> Upload First Shot
                          </button>
                        </div>
                      )}
                      {canSuggest && (
                        <button 
                          onClick={generateSmartSuggestions}
                          disabled={isSuggesting}
                          className="w-full border-2 border-brand-blue text-brand-blue px-8 py-4 rounded-xl text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-blue-50 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {isSuggesting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                          {isSuggesting ? 'ANALYZING...' : 'AI SUGGESTIONS'}
                        </button>
                      )}
                   </div>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-brand-gray-400 italic text-center p-10">Select a scene to view storyboard</div>
          )}
        </div>

        {/* Mobile Floating Action Button */}
        {canEdit && (
          <div className="md:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
             <div className="relative group">
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={handleAddFrame}
                  className="absolute inset-0 opacity-0 cursor-pointer z-10"
                  disabled={uploading || !selectedScene}
                />
                <button 
                  className="bg-brand-blue text-white w-14 h-14 rounded-full shadow-2xl flex items-center justify-center active:scale-90 transition-transform ring-4 ring-white"
                >
                  {uploading ? <Loader2 className="animate-spin" size={24} /> : <Plus size={24} />}
                </button>
                <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-brand-gray-900 text-white text-[9px] font-black px-3 py-1.5 rounded-lg whitespace-nowrap shadow-xl uppercase tracking-widest opacity-0 group-active:opacity-100 group-hover:opacity-100 transition-opacity pointer-events-none">
                  New Shot
                </div>
             </div>
          </div>
        )}
      </div>
      {/* Frame Edit Modal */}
      <AnimatePresence>
        {editingFrame && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-gray-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl"
            >
              <div className="flex flex-col md:flex-row h-[80vh] md:h-auto overflow-y-auto">
                <div className="md:w-1/2 aspect-video md:aspect-square bg-brand-gray-100 shrink-0">
                  <img src={editingFrame.imageUrl} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 p-6 flex flex-col">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-bold text-brand-gray-900 uppercase">Frame Specifications</h3>
                    <button onClick={() => setEditingFrame(null)} className="p-2 hover:bg-brand-gray-100 rounded-full transition-colors">
                      <X size={20} />
                    </button>
                  </div>
                  
                  <div className="space-y-4 flex-1">
                    {hasFieldAccess(userRole, 'storyboard', 'title') && (
                      <div>
                        <label className="text-[10px] uppercase font-bold text-brand-gray-400 block mb-1 tracking-widest">Shot Title</label>
                        <input 
                          value={editingFrame.title}
                          onChange={(e) => setEditingFrame({...editingFrame, title: e.target.value})}
                          className="w-full text-sm font-black border-b-2 border-brand-gray-100 focus:border-brand-blue focus:outline-none py-2"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      {hasFieldAccess(userRole, 'storyboard', 'shotType') && (
                        <div>
                          <label className="text-[10px] uppercase font-bold text-brand-gray-400 block mb-1 tracking-widest">Shot Type</label>
                          <select 
                            value={editingFrame.shotType}
                            onChange={(e) => setEditingFrame({...editingFrame, shotType: e.target.value as any})}
                            className="w-full text-xs font-bold bg-brand-gray-50 border-none rounded p-2"
                          >
                            {['WS', 'CU', 'POV', 'MS', 'OTS', 'ELS', 'ECU', 'LOW'].map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      )}
                      {hasFieldAccess(userRole, 'storyboard', 'cameraMovement') && (
                        <div>
                          <label className="text-[10px] uppercase font-bold text-brand-gray-400 block mb-1 tracking-widest">Movement</label>
                          <select 
                            value={editingFrame.cameraMovement}
                            onChange={(e) => setEditingFrame({...editingFrame, cameraMovement: e.target.value as any})}
                            className="w-full text-xs font-bold bg-brand-gray-50 border-none rounded p-2"
                          >
                            {['STATIC', 'PAN', 'TILT', 'TRACK', 'DOLLY', 'ZOOM', 'HANDHELD'].map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                      )}
                    </div>

                    {hasFieldAccess(userRole, 'storyboard', 'cameraNotes') && (
                      <div>
                        <label className="text-[10px] uppercase font-bold text-brand-gray-400 block mb-1 tracking-widest flex items-center gap-2">
                           <Camera size={10} className="text-brand-blue" />
                           Director / Action Notes
                        </label>
                        <textarea 
                          value={editingFrame.cameraNotes}
                          onChange={(e) => setEditingFrame({...editingFrame, cameraNotes: e.target.value})}
                          rows={3}
                          className="w-full text-xs font-medium bg-brand-gray-50 border-none rounded p-3 focus:ring-1 focus:ring-brand-blue"
                          placeholder="Action description or camera notes..."
                        />
                      </div>
                    )}

                    {hasFieldAccess(userRole, 'storyboard', 'technicalSpecs') && (
                      <div>
                        <label className="text-[10px] uppercase font-bold text-brand-gray-400 block mb-1 tracking-widest flex items-center gap-2">
                           <Monitor size={10} className="text-indigo-600" />
                           Cinematography / Technical Specs
                        </label>
                        <textarea 
                          value={editingFrame.technicalSpecs}
                          onChange={(e) => setEditingFrame({...editingFrame, technicalSpecs: e.target.value})}
                          rows={2}
                          className="w-full text-xs font-medium bg-indigo-50/30 border border-indigo-100 rounded p-3 focus:ring-1 focus:ring-indigo-400"
                          placeholder="Lens, filter, lighting notes..."
                        />
                      </div>
                    )}

                    {hasFieldAccess(userRole, 'storyboard', 'artNotes') && (
                      <div>
                        <label className="text-[10px] uppercase font-bold text-brand-gray-400 block mb-1 tracking-widest flex items-center gap-2">
                           <Brush size={10} className="text-orange-600" />
                           Set & Prop Notes (Art Director)
                        </label>
                        <textarea 
                          value={editingFrame.artNotes}
                          onChange={(e) => setEditingFrame({...editingFrame, artNotes: e.target.value})}
                          rows={2}
                          className="w-full text-xs font-medium bg-orange-50/30 border border-orange-100 rounded p-3 focus:ring-1 focus:ring-orange-400"
                          placeholder="Prop list, furniture, color palette..."
                        />
                      </div>
                    )}
                  </div>

                  <div className="mt-8 flex gap-3">
                    <button 
                      onClick={async () => {
                        const updates: any = {};
                        if (hasFieldAccess(userRole, 'storyboard', 'title')) updates.title = editingFrame.title;
                        if (hasFieldAccess(userRole, 'storyboard', 'shotType')) updates.shotType = editingFrame.shotType;
                        if (hasFieldAccess(userRole, 'storyboard', 'cameraMovement')) updates.cameraMovement = editingFrame.cameraMovement;
                        if (hasFieldAccess(userRole, 'storyboard', 'cameraNotes')) updates.cameraNotes = editingFrame.cameraNotes;
                        if (hasFieldAccess(userRole, 'storyboard', 'artNotes')) updates.artNotes = editingFrame.artNotes;
                        if (hasFieldAccess(userRole, 'storyboard', 'technicalSpecs')) updates.technicalSpecs = editingFrame.technicalSpecs;

                        try {
                           await updateDoc(doc(db, 'storyboards', editingFrame.id), updates);
                           setFrames(prev => prev.map(f => f.id === editingFrame.id ? { ...f, ...updates } : f));
                           setEditingFrame(null);
                        } catch (err) {
                           handleFirestoreError(err, OperationType.UPDATE, `storyboards/${editingFrame.id}`, auth);
                        }
                      }}
                      className="flex-1 bg-brand-blue text-white py-3 rounded-xl text-xs font-bold uppercase tracking-widest shadow-lg shadow-brand-blue/20 flex items-center justify-center gap-2"
                    >
                      <Save size={14} /> Update Shot
                    </button>
                    {hasModuleAccess(userRole, 'storyboard') && (
                      <button 
                        onClick={() => {
                          handleDeleteFrame(editingFrame.id);
                          setEditingFrame(null);
                        }}
                        className="bg-red-50 text-red-500 p-4 rounded-xl hover:bg-red-100 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SortableFrameItem({ frame, idx, onDelete, onEdit, onUpdateField, onDuplicate, onMoveUp, onMoveDown, onToggleComplete, isFirst, isLast }: { 
  frame: StoryboardFrame, 
  idx: number, 
  onDelete: () => void | Promise<void>, 
  onEdit: () => void,
  onUpdateField: (id: string, field: keyof StoryboardFrame, val: any) => void | Promise<void>,
  onDuplicate: () => void,
  onMoveUp: () => void,
  onMoveDown: () => void,
  onToggleComplete: () => void,
  isFirst: boolean,
  isLast: boolean,
  key?: React.Key
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: frame.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 0,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ delay: idx * 0.05 }}
      className={cn(
        "group bg-white border rounded-2xl overflow-hidden transition-all relative w-full flex flex-col shadow-sm hover:shadow-md",
        frame.completed ? "border-green-100 bg-green-50/20" : "border-brand-gray-200"
      )}
    >
      {/* Header with Checkbox and Title */}
      <div className="p-4 flex items-center gap-3 border-b border-brand-gray-100 bg-white">
        <button 
          onClick={(e) => {
             e.stopPropagation();
             onToggleComplete();
          }}
          className={cn(
            "w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all shrink-0",
            frame.completed 
              ? "bg-green-500 border-green-500 text-white" 
              : "border-brand-gray-300 hover:border-brand-blue"
          )}
        >
          {frame.completed ? <CheckCircle2 size={16} /> : <div className="w-1.5 h-1.5 bg-brand-gray-100 rounded-sm opacity-0 group-hover:opacity-100" />}
        </button>
        <h4 className={cn(
          "text-sm font-black uppercase tracking-tight truncate flex-1",
          frame.completed ? "text-green-700" : "text-brand-gray-900"
        )}>
          {frame.title}
        </h4>
        
        {/* Drag Handle */}
        <div 
          {...attributes} 
          {...listeners}
          className="p-1 text-brand-gray-300 cursor-grab active:cursor-grabbing hover:text-brand-gray-900 transition-colors"
        >
          <GripVertical size={16} />
        </div>
      </div>

      {/* Image Container */}
      <div className="aspect-video bg-brand-gray-100 relative overflow-hidden shrink-0 cursor-pointer" onClick={onEdit}>
          <img 
            src={frame.imageUrl} 
            alt={frame.title} 
            className={cn(
              "w-full h-full object-cover transition-all duration-500",
              frame.completed ? "grayscale-[0.5] opacity-80" : ""
            )} 
          />
          {frame.completed && (
            <div className="absolute inset-0 bg-green-500/10 pointer-events-none" />
          )}
      </div>

      {/* Info Area */}
      <div className="p-4 space-y-3 flex flex-col flex-1">
        <div className="flex items-center gap-3">
          <div className="bg-brand-gray-900 text-white px-2 py-0.5 rounded text-[9px] font-black tracking-widest uppercase">
            {frame.shotType || 'WIDE'}
          </div>
          <div className="text-[10px] font-black text-brand-gray-400 uppercase tracking-[0.15em] flex items-center gap-1.5">
            <Camera size={10} className="text-brand-blue" />
            {frame.cameraMovement}
          </div>
        </div>
        
        <div className="bg-brand-gray-50 p-3 rounded-lg border border-brand-gray-100 flex-1 space-y-2">
          {frame.cameraNotes ? (
            <p className="text-[11px] font-medium text-brand-gray-600 italic leading-relaxed">
              "{frame.cameraNotes}"
            </p>
          ) : (
            <p className="text-[10px] text-brand-gray-400 font-bold tracking-widest uppercase italic">No scene notes</p>
          )}

          {(frame.technicalSpecs || frame.artNotes) && (
            <div className="flex gap-2 pt-1 border-t border-brand-gray-100">
               {frame.technicalSpecs && (
                 <div className="flex items-center gap-1 text-[9px] font-bold text-indigo-500 uppercase tracking-tighter">
                   <Monitor size={10} /> Specs
                 </div>
               )}
               {frame.artNotes && (
                 <div className="flex items-center gap-1 text-[9px] font-bold text-orange-500 uppercase tracking-tighter">
                   <Brush size={10} /> Art
                 </div>
               )}
            </div>
          )}
        </div>

        {/* Quick Actions Footer */}
        <div className="pt-2 flex items-center gap-2">
          <button 
            onClick={onEdit}
            className="flex-1 py-2.5 bg-brand-gray-50 hover:bg-brand-gray-100 border border-brand-gray-100 rounded-xl text-[10px] font-black text-brand-gray-700 uppercase tracking-widest transition-all active:scale-95 shadow-sm"
          >
            Edit
          </button>
          <button 
            onClick={onDuplicate}
            className="flex-1 py-2.5 bg-brand-gray-50 hover:bg-brand-gray-100 border border-brand-gray-100 rounded-xl text-[10px] font-black text-brand-gray-700 uppercase tracking-widest transition-all active:scale-95 shadow-sm"
          >
            Duplicate
          </button>
          <button 
           onClick={onDelete}
           className="p-2.5 text-brand-gray-300 hover:text-red-500 transition-colors"
          >
            <Trash2 size={16} />
          </button>
        </div>

        {/* Reordering - Desktop Only */}
        <div className="hidden md:flex items-center justify-between pt-2 border-t border-brand-gray-50">
           <button 
             onClick={onMoveUp} 
             disabled={isFirst}
             className="p-1 text-brand-gray-300 hover:text-brand-gray-900 disabled:opacity-20"
           >
             Move Up
           </button>
           <button 
             onClick={onMoveDown} 
             disabled={isLast}
             className="p-1 text-brand-gray-300 hover:text-brand-gray-900 disabled:opacity-20"
           >
             Move Down
           </button>
        </div>
      </div>
    </motion.div>
  );
}
