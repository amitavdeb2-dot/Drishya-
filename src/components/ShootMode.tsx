import React, { useState, useEffect } from 'react';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs, doc, updateDoc, onSnapshot, orderBy } from 'firebase/firestore';
import { Project, Scene, StoryboardFrame, SceneStatus, ProductionRole } from '../types';
import { ChevronLeft, ChevronRight, CheckCircle2, Circle, Play, SkipForward, FileEdit, Info, Camera, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { OperationType, handleFirestoreError, cn, hasFieldAccess, hasPermission } from '../lib/utils';

interface ShootModeProps {
  project: Project;
  userRole?: ProductionRole;
}

export default function ShootMode({ project, userRole }: ShootModeProps) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [frames, setFrames] = useState<StoryboardFrame[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentSceneIdx, setCurrentSceneIdx] = useState(0);
  const [currentFrameIdx, setCurrentFrameIdx] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const [newNote, setNewNote] = useState('');

  const canMarkShot = hasPermission(userRole, 'update_progress') || hasPermission(userRole, 'shoot_mode');

  const currentScene = scenes[currentSceneIdx];
  const currentFrame = frames[currentFrameIdx];

  useEffect(() => {
    fetchScenes();
  }, [project]);

  useEffect(() => {
    if (currentScene) {
      const unsubscribe = onSnapshot(
        query(
          collection(db, 'storyboards'),
          where('sceneId', '==', currentScene.id),
          orderBy('order', 'asc')
        ),
        (snapshot) => {
          const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StoryboardFrame));
          setFrames(data);
          // Try to find the first uncompleted frame if we just switched scenes
          if (currentFrameIdx >= data.length) {
             setCurrentFrameIdx(0);
          }
        },
        (error) => handleFirestoreError(error, OperationType.LIST, 'storyboards', auth)
      );
      return () => unsubscribe();
    }
  }, [currentScene]);

  const fetchScenes = async () => {
    try {
      const q = query(
        collection(db, 'scenes'),
        where('projectId', '==', project.id)
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Scene));
      setScenes(data.sort((a, b) => a.order - b.order));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'scenes', auth);
    } finally {
      setLoading(false);
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
      
      if (currentScene) {
        await updateSceneStatus(currentScene.id, updatedFrames);
      }
      
      if (newCompleted && currentFrameIdx < frames.length - 1) {
        setCurrentFrameIdx(prev => prev + 1);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `storyboards/${frame.id}`, auth);
    }
  };

  const markSceneComplete = async () => {
    if (!currentScene) return;
    try {
      // Mark all frames in the scene as complete
      const updates = frames.map(frame => 
        updateDoc(doc(db, 'storyboards', frame.id), { completed: true })
      );
      await Promise.all(updates);
      
      // Update scene status
      await updateDoc(doc(db, 'scenes', currentScene.id), { status: SceneStatus.COMPLETED });
      setScenes(prev => prev.map(s => s.id === currentScene.id ? { ...s, status: SceneStatus.COMPLETED } : s));
      
      // Move to next scene if available
      if (currentSceneIdx < scenes.length - 1) {
        setCurrentSceneIdx(prev => prev + 1);
        setCurrentFrameIdx(0);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `scenes/${currentScene.id}`, auth);
    }
  };

  const skipShot = () => {
    if (currentFrameIdx < frames.length - 1) {
      setCurrentFrameIdx(prev => prev + 1);
    }
  };

  const prevShot = () => {
    if (currentFrameIdx > 0) {
      setCurrentFrameIdx(prev => prev - 1);
    }
  };

  const handleUpdateNotes = async () => {
    if (!currentFrame || !newNote.trim()) return;
    try {
      const updatedNotes = currentFrame.cameraNotes ? `${currentFrame.cameraNotes}\n\n[ON-SET]: ${newNote}` : `[ON-SET]: ${newNote}`;
      await updateDoc(doc(db, 'storyboards', currentFrame.id), { cameraNotes: updatedNotes });
      setNewNote('');
      setShowNotes(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `storyboards/${currentFrame.id}`, auth);
    }
  };

  if (loading) return <div className="h-full flex items-center justify-center italic text-brand-gray-500 uppercase tracking-widest text-[10px]">Initializing Field Ops...</div>;

  if (!currentScene) return <div className="h-full flex items-center justify-center text-brand-gray-400 font-bold uppercase tracking-widest">No production data</div>;

  const completedCount = frames.filter(f => f.completed).length;
  const progress = frames.length > 0 ? (completedCount / frames.length) * 100 : 0;

  const getStatusIcon = (status?: SceneStatus) => {
    switch (status) {
      case 'completed': return <CheckCircle2 size={14} className="text-green-500" />;
      case 'in-progress': return <Circle size={14} className="text-brand-blue fill-brand-blue/20" />;
      default: return <Circle size={14} className="text-white/20" />;
    }
  };

  return (
    <div className="h-full flex flex-col bg-brand-gray-900 text-white overflow-hidden font-sans">
      {/* HUD Header */}
      <div className="bg-brand-gray-900 border-b border-white/5 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex flex-col">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-black tracking-[0.2em] text-brand-blue uppercase italic">Live Production</span>
            {getStatusIcon(currentScene.status)}
          </div>
          <h2 className="text-sm font-bold tracking-tight">SCENE {currentScene.number} — {currentScene.location}</h2>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] font-black text-brand-gray-400 uppercase tracking-widest">{currentScene.intExt} / {currentScene.dayNight}</span>
          <div className="text-[9px] font-bold text-white/40 mt-0.5">Scene {currentSceneIdx + 1} of {scenes.length}</div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-1 bg-white/5 shrink-0 relative">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          className="h-full bg-brand-blue relative z-10"
        />
        <div className="absolute inset-0 flex">
          {frames.map((_, i) => (
            <div key={i} className="flex-1 border-r border-white/5 last:border-none" />
          ))}
        </div>
      </div>

      {/* Main Viewfinder Area */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <AnimatePresence mode="wait">
          {currentFrame ? (
            <motion.div 
              key={currentFrame.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 flex flex-col overflow-hidden"
            >
              {/* Image Frame */}
              <div className="flex-1 bg-black relative flex items-center justify-center overflow-hidden">
                <img 
                  src={currentFrame.imageUrl} 
                  alt="Reference" 
                  className={cn(
                    "max-w-full max-h-full object-contain transition-all duration-500",
                    currentFrame.completed ? "grayscale opacity-40 blur-sm" : ""
                  )} 
                />
                
                {/* Completed Overlay */}
                <AnimatePresence>
                  {currentFrame.completed && (
                    <motion.div 
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="absolute inset-0 flex items-center justify-center bg-brand-blue/20"
                    >
                      <div className="flex flex-col items-center bg-brand-blue px-6 py-4 rounded-2xl shadow-2xl">
                         <CheckCircle2 size={48} className="text-white mb-2" />
                         <span className="text-xs font-black uppercase tracking-[0.2em]">Shot Recorded</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Overlaid Data */}
                <div className="absolute inset-0 pointer-events-none p-6 flex flex-col justify-between">
                  <div className="flex justify-between items-start">
                    <div className="bg-black/50 backdrop-blur-md px-3 py-2 rounded ring-1 ring-white/10">
                      <div className="text-[8px] font-black text-brand-gray-400 uppercase tracking-widest mb-0.5">Shot Type</div>
                      <div className="text-xs font-black text-white">{currentFrame.shotType || 'WIDE'}</div>
                    </div>
                    <div className="bg-black/50 backdrop-blur-md px-3 py-2 rounded ring-1 ring-white/10 text-right">
                      <div className="text-[8px] font-black text-brand-gray-400 uppercase tracking-widest mb-0.5">Sequence</div>
                      <div className="text-xs font-black text-white italic">{currentFrameIdx + 1} / {frames.length}</div>
                    </div>
                  </div>

                  <div className="flex justify-between items-end">
                    <div className="bg-black/50 backdrop-blur-md px-4 py-3 rounded-lg ring-1 ring-white/10 max-w-[70%]">
                      <h3 className="text-sm font-black uppercase tracking-tight text-brand-blue mb-1 truncate">{currentFrame.title}</h3>
                      <div className="text-[10px] font-medium text-white/80 line-clamp-3 leading-relaxed italic">
                        "{currentFrame.cameraNotes || 'No movement notes provided'}"
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Controls Footer */}
              <div className="bg-brand-gray-900 px-6 py-6 flex flex-col gap-4 shrink-0 border-t border-white/5 shadow-[0_-20px_40px_rgba(0,0,0,0.4)]">
                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => canMarkShot && toggleShotComplete(currentFrame)}
                    disabled={!canMarkShot}
                    className={cn(
                      "flex flex-col items-center justify-center gap-2 p-5 rounded-2xl font-black uppercase tracking-[0.1em] transition-all active:scale-95 border disabled:opacity-30",
                      currentFrame.completed 
                        ? "bg-green-500/20 text-green-500 border-green-500/50" 
                        : "bg-brand-blue text-white border-transparent shadow-lg shadow-brand-blue/20"
                    )}
                  >
                    <CheckCircle2 size={24} />
                    <span className="text-[9px]">{currentFrame.completed ? 'REDO SHOT' : 'MARK OK'}</span>
                  </button>
                  <button 
                    onClick={() => setShowNotes(true)}
                    className="flex flex-col items-center justify-center gap-2 p-5 rounded-2xl bg-white/5 text-white border border-white/10 transition-all active:scale-95"
                  >
                    <FileEdit size={24} />
                    <span className="text-[9px] font-black uppercase tracking-[0.1em]">On-Set Note</span>
                  </button>
                </div>

                <div className="flex items-center justify-between gap-4">
                   <button 
                     onClick={prevShot} 
                     disabled={currentFrameIdx === 0}
                     className="p-3 bg-white/5 rounded-xl disabled:opacity-20 transition-all hover:bg-white/10"
                   >
                     <ChevronLeft size={20} />
                   </button>
                   
                   <div className="flex-1 flex gap-1.5 overflow-x-auto justify-center px-4 no-scrollbar">
                      {frames.map((f, i) => (
                        <button 
                          key={f.id}
                          onClick={() => setCurrentFrameIdx(i)}
                          className={cn(
                            "w-1.5 h-1.5 rounded-full transition-all duration-300",
                            i === currentFrameIdx ? "w-5 bg-brand-blue" : (f.completed ? "bg-green-500" : "bg-white/10")
                          )}
                        />
                      ))}
                   </div>

                   <button 
                     onClick={skipShot}
                     disabled={currentFrameIdx === frames.length - 1}
                     className="p-3 bg-white/5 rounded-xl flex items-center gap-2 text-[9px] font-black uppercase tracking-widest disabled:opacity-20 hover:bg-white/10"
                   >
                     <SkipForward size={20} />
                   </button>
                </div>

                {currentScene.status !== 'completed' && canMarkShot && (
                  <button 
                    onClick={markSceneComplete}
                    className="w-full py-3 bg-white/5 hover:bg-white/10 rounded-xl border border-white/5 text-[9px] font-black uppercase tracking-[0.2em] text-brand-gray-400 transition-all flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 size={12} />
                    Wrap Scene {currentScene.number}
                  </button>
                )}
              </div>
            </motion.div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-brand-gray-500">
               <Camera size={48} className="mb-4 opacity-10" />
               <p className="text-xs font-black uppercase tracking-[0.2em] mb-2">No shots in queue</p>
               <p className="text-[10px] max-w-[200px] font-medium leading-relaxed">Please add storyboard frames to this scene to begin live production mode.</p>
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Note Modal */}
      <AnimatePresence>
        {showNotes && (
          <div className="fixed inset-0 z-[60] flex flex-col justify-end">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setShowNotes(false)}
            />
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              className="bg-brand-gray-900 border-t border-white/10 p-8 relative rounded-t-[40px] shadow-2xl"
            >
              <div className="w-12 h-1.5 bg-white/10 rounded-full mx-auto mb-8" onClick={() => setShowNotes(false)} />
              <div className="mb-6 flex items-center gap-3">
                 <div className="w-8 h-8 rounded bg-brand-blue flex items-center justify-center">
                    <FileEdit size={14} className="text-white" />
                 </div>
                 <h4 className="text-xs font-black uppercase tracking-[0.2em] text-white">Live Production Note</h4>
              </div>
              <textarea 
                autoFocus
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Issue with lighting? Actor line change? Note it here..."
                className="w-full bg-white/5 border border-white/10 rounded-2xl p-6 text-white text-sm focus:ring-2 focus:ring-brand-blue focus:outline-none mb-8 placeholder:text-white/20"
                rows={4}
              />
              <button 
                onClick={handleUpdateNotes}
                className="w-full bg-brand-blue text-white py-5 rounded-2xl text-xs font-black uppercase tracking-[0.2em] shadow-xl hover:bg-blue-600 active:scale-95 transition-all"
              >
                Sync with Storyboard
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Scene Switcher Overlay (Swipe/Drawer placeholder if user needs to switch scenes) */}
      <div className="fixed bottom-36 left-1/2 -translate-x-1/2 flex items-center gap-2">
         <button 
           onClick={() => {
             if (currentSceneIdx > 0) setCurrentSceneIdx(prev => prev - 1);
           }}
           className="p-3 bg-brand-gray-900/40 backdrop-blur-md rounded-full border border-white/10 text-white/40 hover:text-white transition-all shadow-xl"
         >
           <ChevronLeft size={20} />
         </button>
         <div className="bg-brand-gray-900/40 backdrop-blur-md px-6 py-2.5 rounded-full border border-white/10 text-[9px] font-black uppercase tracking-widest text-white/60 shadow-xl">
           Scene Navigation
         </div>
         <button 
            onClick={() => {
              if (currentSceneIdx < scenes.length - 1) setCurrentSceneIdx(prev => prev + 1);
            }}
           className="p-3 bg-brand-gray-900/40 backdrop-blur-md rounded-full border border-white/10 text-white/40 hover:text-white transition-all shadow-xl"
         >
           <ChevronRight size={20} />
         </button>
      </div>
    </div>
  );
}
